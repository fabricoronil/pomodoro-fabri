/**
 * Lo único que expone la cáscara a la web: una marca para que la app pueda
 * saber que corre en escritorio (por ejemplo, para esconder el cartel de
 * "instalá la PWA"). Sin acceso a Node ni a nada del sistema.
 */

const { contextBridge } = require("electron");

const flag = process.argv.find((a) => a.startsWith("--pomodoro-version="));

contextBridge.exposeInMainWorld("pomodoroDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: flag ? flag.split("=")[1] : null,
});
