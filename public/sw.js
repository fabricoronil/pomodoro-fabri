/* eslint-disable no-undef */
/**
 * Service worker de Pomodoro Fabri.
 *
 * Es lo único de la app que sigue vivo con la web cerrada. No hace caché ni
 * nada offline: está solo para recibir el push que manda la Edge Function
 * `notify-timers` cuando un pomodoro termina y vos no tenés la página abierta.
 *
 * Tres cosas:
 *   · push                   -> muestra la notificación (salvo que ya haya una ventana a la vista)
 *   · notificationclick      -> enfoca la ventana que ya estaba, o abre una nueva
 *   · pushsubscriptionchange -> el navegador rotó el endpoint: re-suscribe y avisa a la base
 */

const CONFIG_DB = "pf-push";
const CONFIG_STORE = "config";
const CONFIG_KEY = "config";

// ------------------------------------------------------------------ IndexedDB
//  Guardamos acá lo mínimo para poder re-suscribirnos sin la página abierta:
//  la clave VAPID pública, la URL del proyecto y el último token conocido.

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CONFIG_STORE)) {
        req.result.createObjectStore(CONFIG_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readConfig() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG_STORE, "readonly");
      const req = tx.objectStore(CONFIG_STORE).get(CONFIG_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeConfig(patch) {
  try {
    const current = (await readConfig()) || {};
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG_STORE, "readwrite");
      tx.objectStore(CONFIG_STORE).put({ ...current, ...patch }, CONFIG_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* modo privado o sin espacio: no es crítico */
  }
}

// --------------------------------------------------------------- ciclo de vida

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// La página nos pasa la configuración apenas se suscribe (y en cada arranque,
// para refrescar el token de acceso, que dura poco).
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "pf-config") event.waitUntil(writeConfig(msg.config || {}));
});

// ---------------------------------------------------------------------- push

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Pomodoro Fabri";
  const options = {
    body: data.body || "Terminó tu bloque.",
    tag: data.tag || "pomodoro",
    renotify: true,
    // Sin badge/icon propios: el navegador usa el del manifest.
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    (async () => {
      // Si ya tenés la app a la vista, no mostramos nada: la propia página
      // hace sonar la alarma y avisa. Si no, sería doble aviso.
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const aLaVista = wins.some((c) => c.visibilityState === "visible");
      if (aLaVista) return;

      await self.registration.showNotification(title, options);
    })()
  );
});

// ------------------------------------------------------------ click en el aviso

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Preferimos volver a la pestaña que ya estaba abierta antes que abrir otra.
      for (const c of wins) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          if ("navigate" in c && new URL(c.url).pathname !== url) {
            try {
              await c.navigate(url);
            } catch {
              /* algunos navegadores no dejan navegar: alcanza con enfocar */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});

// ------------------------------------------- el navegador rotó la suscripción

/** base64url (la clave VAPID) -> Uint8Array, que es lo que pide subscribe() */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const keyOf = (sub, name) => {
  const raw = sub.getKey(name);
  if (!raw) return null;
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
};

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const cfg = await readConfig();
      if (!cfg || !cfg.vapidPublicKey) return;

      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
      });

      const row = {
        user_id: cfg.userId,
        endpoint: sub.endpoint,
        p256dh: keyOf(sub, "p256dh"),
        auth: keyOf(sub, "auth"),
        device_id: cfg.deviceId || null,
        user_agent: self.navigator ? self.navigator.userAgent : null,
      };

      // Intentamos actualizar la fila ya mismo. El token de acceso dura ~1 hora,
      // así que esto funciona si abriste la app hace poco; si falla no se pierde
      // nada: la próxima vez que abras la web, syncPushSubscription() reconcilia
      // la fila con la suscripción real de este navegador.
      if (cfg.supabaseUrl && cfg.anonKey && cfg.accessToken && cfg.userId) {
        try {
          await fetch(`${cfg.supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
            method: "POST",
            headers: {
              apikey: cfg.anonKey,
              Authorization: `Bearer ${cfg.accessToken}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify(row),
          });
        } catch {
          /* sin red o token vencido: lo arregla la página al abrirse */
        }
      }

      await writeConfig({ endpoint: sub.endpoint, pending: true });
    })()
  );
});
