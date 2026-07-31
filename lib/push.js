"use client";

import { supabase, isSupabaseConfigured } from "./supabase";
import { deviceId } from "./timerSync";

/**
 * Avisos push con la web cerrada.
 *
 * El timer ya sobrevivía a cerrar la pestaña (el fin está guardado en la nube,
 * ver timerSync.js), pero la alarma no: para sonar hacía falta tener la página
 * abierta. Acá el que mira el reloj es el servidor.
 *
 * El flujo es:
 *   1. registramos el service worker (public/sw.js)
 *   2. pedimos permiso de notificaciones
 *   3. pushManager.subscribe() con la clave VAPID pública
 *   4. guardamos endpoint + claves en `push_subscriptions`
 * y a partir de ahí la Edge Function `notify-timers` te manda el aviso
 * aunque no haya ni una pestaña abierta.
 *
 * Todo esto es API del navegador: no suma ninguna dependencia al front.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY) && isSupabaseConfigured;

/** ¿Este navegador puede recibir push? (iOS solo desde 16.4 y con la app en la pantalla de inicio) */
export function pushSupported() {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iOS/iPadOS exige que la web esté agregada a la pantalla de inicio */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// ------------------------------------------------------------------ helpers

/** base64url (la clave VAPID) -> Uint8Array, que es lo que pide subscribe() */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const keyOf = (sub, name) => {
  const raw = sub.getKey(name);
  if (!raw) return null;
  return window.btoa(String.fromCharCode(...new Uint8Array(raw)));
};

async function getRegistration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) || null;
}

/** Registra el SW solo cuando hace falta (en modo local ni se toca) */
async function ensureRegistration() {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Le pasa al service worker lo mínimo para poder re-suscribirse solo si el
 * navegador rota el endpoint (evento pushsubscriptionchange).
 */
async function primeServiceWorker(reg, userId) {
  try {
    const { data } = await supabase.auth.getSession();
    reg.active?.postMessage({
      type: "pf-config",
      config: {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        accessToken: data?.session?.access_token || null,
        userId,
        deviceId: deviceId(),
        vapidPublicKey: VAPID_PUBLIC_KEY,
      },
    });
  } catch {
    /* no es crítico: la página reconcilia la fila al abrirse */
  }
}

// -------------------------------------------------------------------- estado

/**
 * Estado para la UI. No pide permisos ni registra nada: solo mira.
 * Devuelve { supported, configured, permission, subscribed, needsHomeScreen }.
 */
export async function getPushState() {
  const base = {
    supported: pushSupported(),
    configured: pushConfigured,
    permission: typeof Notification !== "undefined" ? Notification.permission : "default",
    subscribed: false,
    needsHomeScreen: isIOS() && !isStandalone(),
  };
  if (!base.supported) return base;
  const reg = await getRegistration();
  if (!reg) return base;
  const sub = await reg.pushManager.getSubscription();
  return { ...base, subscribed: !!sub };
}

/** Cuántos dispositivos tiene suscriptos esta cuenta */
export async function countSubscriptions(userId) {
  if (!isSupabaseConfigured || !userId) return 0;
  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return 0;
  return count || 0;
}

// ------------------------------------------------------------------- guardar

async function saveSubscription(userId, sub) {
  const row = {
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: keyOf(sub, "p256dh"),
    auth: keyOf(sub, "auth"),
    device_id: deviceId(),
    user_agent: navigator.userAgent.slice(0, 300),
  };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" });
  if (error) throw error;

  // Si el navegador había rotado el endpoint, la fila vieja de este mismo
  // dispositivo queda huérfana: la borramos para no mandar dos veces.
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", row.device_id)
    .neq("endpoint", row.endpoint);
}

// ------------------------------------------------------------------- activar

/**
 * Pide permiso y suscribe este dispositivo.
 * Devuelve { ok: true } o { ok: false, reason } con un motivo entendible.
 */
export async function enablePush(userId) {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!pushConfigured) return { ok: false, reason: "unconfigured" };
  if (!userId) return { ok: false, reason: "no-account" };
  if (isIOS() && !isStandalone()) return { ok: false, reason: "home-screen" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission };

  const reg = await ensureRegistration();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  await saveSubscription(userId, sub);
  await primeServiceWorker(reg, userId);
  return { ok: true };
}

// ------------------------------------------------------------------- apagar

/** Da de baja este dispositivo (el permiso del navegador queda como está) */
export async function disablePush(userId) {
  const reg = await getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* si falla igual borramos la fila: sin fila no se manda nada */
  }
  if (isSupabaseConfigured && userId) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
}

// --------------------------------------------------------------- reconciliar

/**
 * Se llama al abrir la app. Si este navegador ya estaba suscripto, se asegura
 * de que la fila en la base coincida con la suscripción real (el endpoint
 * puede haber rotado con la web cerrada) y refresca el token que guarda el SW.
 * Si no había suscripción, no hace nada: no pide permisos por su cuenta.
 */
export async function syncPushSubscription(userId) {
  if (!pushConfigured || !userId || !pushSupported()) return;
  const reg = await getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await saveSubscription(userId, sub);
  await primeServiceWorker(reg, userId);
}
