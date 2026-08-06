/**
 * Lo único que expone la cáscara a la web: una marca para que la app pueda
 * saber que corre en escritorio (por ejemplo, para esconder el cartel de
 * "instalá la PWA") y el puente del login por navegador. Sin acceso a Node ni
 * a nada del sistema.
 */

const { contextBridge, ipcRenderer } = require("electron");

const flag = process.argv.find((a) => a.startsWith("--pomodoro-version="));

/**
 * La sesión puede llegar antes de que React monte su listener (el navegador es
 * rápido y la página todavía está hidratando), así que se escucha acá —el
 * preload corre antes que cualquier script de la página— y se guarda hasta que
 * alguien la pida. Sin esto, un login rápido se perdía en el aire.
 */
let guardada = null;
let escucha = null;

ipcRenderer.on("pomodoro:sesion", (_e, tokens) => {
  if (escucha) escucha(tokens);
  else guardada = tokens;
});

contextBridge.exposeInMainWorld("pomodoroDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: flag ? flag.split("=")[1] : null,

  /** Abre el navegador del sistema para iniciar sesión. */
  abrirLogin: () => ipcRenderer.invoke("pomodoro:abrir-login"),

  /** Avisa cuando el navegador nos devolvió una sesión. Devuelve la baja. */
  onSesion: (cb) => {
    escucha = cb;
    if (guardada) {
      const t = guardada;
      guardada = null;
      cb(t);
    }
    return () => {
      escucha = null;
    };
  },
});
