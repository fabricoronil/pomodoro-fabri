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

const { app, BrowserWindow, Menu, Notification, screen, session, shell } = require("electron");
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
 * El login con Google pasa por accounts.google.com y vuelve por Supabase: si eso
 * se abriera afuera, la sesión quedaría en el navegador y no en la app.
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
  return [
    "accounts.google.com",
    "accounts.youtube.com",
    ".google.com",
    ".supabase.co",
    ".supabase.in",
  ].some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
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
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Google bloquea el login de navegadores embebidos, así que nos presentamos
    // como el Chrome de siempre (sacamos "Electron/…" y el nombre de la app).
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

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
