"use client";

/**
 * Dónde bajar la app de escritorio y en qué estado está *este* dispositivo.
 *
 * Hay dos cosas que solo se saben en el navegador y que conviene escuchar
 * temprano:
 *
 * - `beforeinstallprompt` lo dispara Chrome/Edge una sola vez, poco después de
 *   cargar la página, y si nadie lo agarra se pierde. La tarjeta de descarga
 *   vive en Ajustes y se monta mucho después, así que el evento se guarda acá,
 *   a nivel módulo, apenas se evalúa el bundle.
 * - la cáscara de Electron se anuncia sola con `window.pomodoroDesktop`
 *   (lo pone desktop/preload.js).
 *
 * Al sacar una versión nueva de la cáscara: subís los .exe al release y
 * cambiás DESKTOP_VERSION. Nada más — la web no lleva los binarios adentro.
 */

export const DESKTOP_VERSION = "1.1.0";

const REPO = "https://github.com/fabricoronil/pomodoro-desktop-releases";

export const RELEASES_URL = `${REPO}/releases`;
export const SETUP_URL = `${REPO}/releases/download/v${DESKTOP_VERSION}/Pomodoro-Setup-${DESKTOP_VERSION}.exe`;
export const PORTABLE_URL = `${REPO}/releases/download/v${DESKTOP_VERSION}/Pomodoro-portable-${DESKTOP_VERSION}.exe`;

let deferred = null; // el beforeinstallprompt guardado
let justInstalled = false; // la instaló en esta misma visita
const subs = new Set();

const notify = () => subs.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sin esto Chrome muestra su propio cartel, cuando quiere
    deferred = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
}

/** Avisa cuando cambia algo de lo de arriba. Devuelve la baja. */
export function subscribeInstall(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Estado de instalación de este dispositivo. En el servidor devuelve todo apagado. */
export function installState() {
  if (typeof window === "undefined") {
    return { desktop: null, os: "other", canPrompt: false, standalone: false, justInstalled: false };
  }
  return {
    desktop: window.pomodoroDesktop?.isDesktop ? window.pomodoroDesktop : null,
    os: detectOS(),
    canPrompt: !!deferred,
    standalone: isStandalone(),
    justInstalled,
  };
}

/** Dispara el instalador nativo del navegador. true si aceptó. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; // el evento sirve una sola vez
  notify();
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true // iOS no soporta display-mode
  );
}

function detectOS() {
  // userAgentData es lo confiable donde existe; el UA queda de respaldo.
  const p = navigator.userAgentData?.platform?.toLowerCase();
  if (p) {
    if (p.includes("win")) return "windows";
    if (p.includes("android")) return "android";
    if (p.includes("mac")) return "mac";
    if (p.includes("linux")) return "linux";
  }
  const ua = navigator.userAgent;
  if (/Windows|Win64|Win32/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android"; // antes que Linux: Android dice "Linux" también
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}
