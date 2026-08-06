/**
 * Pomodoro de escritorio.
 *
 * Esto es una cáscara: no empaqueta la app adentro, la carga desde el deploy de
 * Vercel en cada arranque (y forzando revalidación del HTML, así nunca queda
 * pegada a una versión vieja). Traducido: hacés `git push`, Vercel despliega, y
 * la próxima vez que abrís la ventana ya está la versión nueva. El .exe solo
 * hay que rehacerlo si tocás esta carpeta.
 *
 * La URL sale, en este orden, de:
 *   1. la variable de entorno POMODORO_URL
 *   2. config.json en la carpeta de datos (Ayuda → Abrir carpeta de configuración)
 *   3. el valor por defecto de acá abajo
 */

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  ipcMain,
  screen,
  session,
  shell,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_URL = "https://pomodoro-fabri.vercel.app";

// Antes de cualquier getPath(): fija la carpeta de datos (%APPDATA%\Pomodoro) y
// hace que las notificaciones de Windows salgan con el nombre y el icono bien.
app.setName("Pomodoro");
app.setAppUserModelId("com.fabricoronil.pomodoro");

// La alarma del timer suena sola cuando termina el bloque, sin click de por
// medio: sin esto Chromium la silencia.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// ---------------------------------------------------------------- configuración

const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");
const LOGIN_FILE = path.join(app.getPath("userData"), "login-pendiente.json");

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  } catch {
    /* si no se puede escribir no pasa nada: son preferencias */
  }
}

const config = readJson(CONFIG_FILE, { url: DEFAULT_URL });
const APP_URL = String(process.env.POMODORO_URL || config.url || DEFAULT_URL).replace(/\/+$/, "");
const APP_ORIGIN = new URL(APP_URL).origin;

// Dejamos el archivo creado para que se pueda apuntar a otro deploy sin recompilar.
if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, { url: APP_URL });

// ------------------------------------------------------------------ navegación

/**
 * Qué se abre adentro de la ventana y qué se manda al navegador del sistema.
 *
 * Google ya no entra acá: rechaza el login en navegadores embebidos, así que
 * eso se hace afuera y la sesión vuelve por `pomodoro://` (más abajo). Lo único
 * que sigue navegando adentro es la app y Supabase, que es a dónde apuntan los
 * links de confirmar mail y reestablecer contraseña.
 */
function esDeLaApp(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.origin === APP_ORIGIN) return true;
    host = u.hostname;
  } catch {
    return false;
  }
  return [".supabase.co", ".supabase.in"].some((h) => host.endsWith(h));
}

// ------------------------------------------------- login por el navegador
//
// Google corta el login cuando detecta un navegador embebido ("este navegador
// puede no ser seguro"), y disfrazar el user-agent ya no alcanza: lo detecta
// igual. Así que el login se hace en el navegador de verdad y la web nos
// devuelve la sesión por un link `pomodoro://auth?...`.
//
// El `estado` es un número al azar que va en el link de ida y tiene que volver
// igual. Sin eso, cualquier página que visites podría dispararnos un
// `pomodoro://` con los tokens de otra cuenta y meternos en una sesión ajena.
// Va también a disco porque el login puede terminar con la app ya cerrada.

const PROTOCOLO = "pomodoro";
const VENTANA_LOGIN_MS = 10 * 60 * 1000;

let sesionPendiente = null; // llegó antes de que la página estuviera lista

function registrarProtocolo() {
  // En desarrollo (`electron .`) Windows necesita saber con qué argumentos
  // relanzarnos; empaquetado alcanza con el ejecutable.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOLO, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOLO);
  }
}

function abrirLoginEnNavegador() {
  const estado = crypto.randomUUID();
  writeJson(LOGIN_FILE, { estado, vence: Date.now() + VENTANA_LOGIN_MS });
  shell.openExternal(`${APP_URL}/?escritorio=${encodeURIComponent(estado)}`);
}

/** Saca la sesión de un `pomodoro://auth?...`, si es uno que pedimos nosotros. */
function procesarDeepLink(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return;
  }
  if (u.protocol !== `${PROTOCOLO}:`) return;

  const pedido = readJson(LOGIN_FILE, { estado: null, vence: 0 });
  const vigente = pedido.estado && pedido.vence > Date.now();
  if (!vigente || u.searchParams.get("estado") !== pedido.estado) return;

  // de un solo uso: si el link se repite, ya no vale
  try {
    fs.unlinkSync(LOGIN_FILE);
  } catch {
    /* no existía */
  }

  const access_token = u.searchParams.get("access_token");
  const refresh_token = u.searchParams.get("refresh_token");
  if (!access_token || !refresh_token) return;

  sesionPendiente = { access_token, refresh_token };
  volcarSesion();

  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus(); // que la ventana aparezca sola al volver del navegador
  }
}

/** Le pasa la sesión a la página, o espera a que termine de cargar. */
function volcarSesion() {
  if (!sesionPendiente || !win || win.isDestroyed()) return;
  if (win.webContents.isLoadingMainFrame()) return; // se reintenta en did-finish-load
  win.webContents.send("pomodoro:sesion", sesionPendiente);
  sesionPendiente = null;
}

/** El link puede venir como argumento (Windows) o por evento (macOS). */
function linkDeArgv(argv) {
  return argv.find((a) => a.startsWith(`${PROTOCOLO}://`)) || null;
}

// --------------------------------------------------------------------- ventana

let win = null;

/** Si la posición guardada quedó fuera de las pantallas actuales, la descartamos. */
function posicionVisible(state) {
  if (state.x == null || state.y == null) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      state.x + state.width > a.x &&
      state.x < a.x + a.width &&
      state.y + 40 > a.y &&
      state.y < a.y + a.height
    );
  });
}

function crearVentana() {
  const state = readJson(STATE_FILE, { width: 1180, height: 860, maximized: false });
  if (!posicionVisible(state)) {
    delete state.x;
    delete state.y;
  }

  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 420,
    minHeight: 560,
    show: false,
    backgroundColor: "#07080d", // mismo fondo que la app: evita el flash blanco
    autoHideMenuBar: true, // el menú aparece con Alt
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--pomodoro-version=${app.getVersion()}`],
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const guardarEstado = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    writeJson(STATE_FILE, { ...b, maximized: win.isMaximized() });
  };
  win.on("resize", guardarEstado);
  win.on("move", guardarEstado);
  win.on("close", guardarEstado);

  // Links externos (target="_blank", window.open) -> navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (esDeLaApp(url)) {
      win.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (esDeLaApp(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Si la sesión llegó del navegador mientras la página cargaba, se entrega acá.
  win.webContents.on("did-finish-load", volcarSesion);

  // Sin red o Vercel caído: pantalla propia con reintento, no el error de Chromium.
  win.webContents.on("did-fail-load", (event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* abortada */) return;
    win.loadFile(path.join(__dirname, "offline.html"), {
      hash: encodeURIComponent(APP_URL) + "|" + encodeURIComponent(desc || String(code)),
    });
  });

  cargarApp();
}

/** Carga la app pidiendo el HTML sin caché: así siempre agarra el último deploy. */
function cargarApp() {
  win.loadURL(APP_URL, { extraHeaders: "pragma: no-cache\ncache-control: no-cache\n" });
}

// ----------------------------------------------------------------------- menú

function construirMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Archivo",
        submenu: [
          { label: "Ir al inicio", accelerator: "Alt+Home", click: cargarApp },
          {
            label: "Buscar actualizaciones",
            accelerator: "CmdOrCtrl+R",
            click: () => win && win.webContents.reloadIgnoringCache(),
          },
          { type: "separator" },
          { role: "quit", label: "Salir" },
        ],
      },
      {
        label: "Editar",
        submenu: [
          { role: "undo", label: "Deshacer" },
          { role: "redo", label: "Rehacer" },
          { type: "separator" },
          { role: "cut", label: "Cortar" },
          { role: "copy", label: "Copiar" },
          { role: "paste", label: "Pegar" },
          { role: "selectAll", label: "Seleccionar todo" },
        ],
      },
      {
        label: "Ver",
        submenu: [
          { role: "resetZoom", label: "Zoom normal" },
          { role: "zoomIn", label: "Acercar" },
          { role: "zoomOut", label: "Alejar" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Pantalla completa" },
          { role: "toggleDevTools", label: "Herramientas de desarrollo" },
        ],
      },
      {
        label: "Ayuda",
        submenu: [
          {
            label: "Iniciar sesión en el navegador",
            click: abrirLoginEnNavegador,
          },
          { label: "Abrir en el navegador", click: () => shell.openExternal(APP_URL) },
          {
            label: "Abrir carpeta de configuración",
            click: () => shell.showItemInFolder(CONFIG_FILE),
          },
          { type: "separator" },
          { label: `Servidor: ${APP_URL}`, enabled: false },
          { label: `Versión: ${app.getVersion()}`, enabled: false },
        ],
      },
    ])
  );
}

// ------------------------------------------------------------------- arranque

// Segunda instancia: en vez de abrir otra ventana, enfoca la que ya está.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows no reabre la app con el deep link: relanza el .exe con la URL como
  // argumento, el lock lo rebota, y llega acá.
  app.on("second-instance", (_event, argv) => {
    const link = linkDeArgv(argv);
    if (link) procesarDeepLink(link);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // macOS, que sí usa un evento propio.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    procesarDeepLink(url);
  });

  ipcMain.handle("pomodoro:abrir-login", () => abrirLoginEnNavegador());

  app.whenReady().then(() => {
    registrarProtocolo();

    // Nos presentamos como el Chrome de siempre (sacamos "Electron/…" y el
    // nombre de la app). El login de Google ya no depende de esto —se hace en
    // el navegador—, pero varios servicios sirven páginas rotas o directamente
    // te bloquean si leen "Electron" en el user-agent.
    const ua = session.defaultSession
      .getUserAgent()
      .replace(/\sElectron\/\S+/, "")
      .replace(/\sPomodoro\/\S+/, "");
    session.defaultSession.setUserAgent(ua);

    // La app pide permiso para notificar; acá ya está concedido de entrada.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(["notifications", "clipboard-sanitized-write", "fullscreen"].includes(permission));
    });

    if (!Notification.isSupported()) {
      console.warn("Este sistema no soporta notificaciones nativas.");
    }

    construirMenu();
    crearVentana();

    // Arranque en frío disparado por el link (la app estaba cerrada cuando
    // terminaste de loguearte en el navegador).
    const link = linkDeArgv(process.argv);
    if (link) procesarDeepLink(link);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
