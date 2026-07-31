// =====================================================================
//  notify-timers · Edge Function (Deno)
//
//  El navegador no puede avisar nada si no está abierto. Así que el que mira
//  el reloj es el servidor: un cron la despierta cada minuto y esta función
//
//    1. busca los bloques vencidos (status='running' y ends_at <= now)
//    2. los cierra EXACTAMENTE como los cierra el cliente, con el mismo
//       UPDATE condicional: gana uno solo, así la sesión nunca se guarda dos
//       veces cuando además tenés la web abierta en otro lado
//    3. guarda la sesión con la hora real de fin (ends_at, no "ahora")
//    4. manda el push a todos los dispositivos suscriptos de ese usuario
//
//  Las reglas (duraciones, "descanso largo cada N", auto-start) salen de
//  user_settings: por eso esa tabla es prerrequisito.
//
//  Deploy:   supabase functions deploy notify-timers
//  Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//            (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen dadas)
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// Un bloque que venció hace más de esto se cierra en silencio, sin arrancar
// el siguiente. Es el mismo valor que usa components/Timer.jsx (STALE_SEC).
const STALE_SEC = 90;

// Si el dispositivo estuvo desconectado más que esto, el aviso ya no sirve:
// que no aparezca "terminó tu pomodoro" media hora tarde.
const PUSH_TTL_SEC = 300;

const DEFAULT_SETTINGS = {
  focus_min: 25,
  short_min: 5,
  long_min: 15,
  long_every: 4,
  auto_start_breaks: true,
  auto_start_focus: false,
  ask_note: true,
  time_zone: null as string | null,
};

type Settings = typeof DEFAULT_SETTINGS;

const iso = (ms: number) => new Date(ms).toISOString();

/** Fecha "YYYY-MM-DD" en la zona horaria del usuario, igual que toKey() en el front */
function localDateKey(ms: number, timeZone: string | null): string {
  try {
    // en-CA formatea como YYYY-MM-DD, que es justo lo que guarda la app
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const durationOf = (mode: string, s: Settings) =>
  (mode === "focus" ? s.focus_min : mode === "short" ? s.short_min : s.long_min) * 60;

/** Qué viene después de terminar el bloque actual (misma regla que el cliente) */
function nextModeAfter(mode: string, cycle: number, s: Settings): string {
  if (mode !== "focus") return "focus";
  const cyc = cycle + 1;
  const candidate = cyc % Math.max(1, s.long_every) === 0 ? "long" : "short";
  return durationOf(candidate, s) > 0 ? candidate : "focus";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:pomodoro@example.com";

  if (!vapidPublic || !vapidPrivate) {
    return json({ error: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY" }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  // service role: esta función tiene que ver y tocar filas de cualquier usuario,
  // así que pasa por encima de RLS. Nunca sale del servidor.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const nowIso = new Date().toISOString();
  const stats = { revisados: 0, cerrados: 0, sesiones: 0, avisos: 0, bajas: 0, errores: [] as string[] };

  // ---------------------------------------------------- bloques vencidos
  //  free_mode queda afuera a propósito: el cronómetro libre no tiene ends_at,
  //  no se notifica y no se cierra nunca (lo frena la persona).
  const { data: due, error: dueErr } = await admin
    .from("active_timer")
    .select("*")
    .eq("status", "running")
    .eq("free_mode", false)
    .not("ends_at", "is", null)
    .lte("ends_at", nowIso)
    .limit(500);

  if (dueErr) return json({ error: dueErr.message }, 500);

  // Ya avisado: notified_at se compara contra ends_at, y como un bloque nuevo
  // siempre termina en el futuro, cada bloque avisa exactamente una vez.
  const pendientes = (due ?? []).filter(
    (r) => !r.notified_at || Date.parse(r.notified_at) < Date.parse(r.ends_at)
  );
  stats.revisados = pendientes.length;

  if (!pendientes.length) return json(stats);

  // ------------------------------------------------- ajustes de esos usuarios
  const userIds = [...new Set(pendientes.map((r) => r.user_id))];
  const { data: settingsRows } = await admin
    .from("user_settings")
    .select("*")
    .in("user_id", userIds);

  const settingsByUser = new Map<string, Settings>();
  for (const row of settingsRows ?? []) {
    settingsByUser.set(row.user_id, { ...DEFAULT_SETTINGS, ...row });
  }

  for (const row of pendientes) {
    try {
      const s = settingsByUser.get(row.user_id) ?? DEFAULT_SETTINGS;

      const endedMs = Date.parse(row.ends_at);
      const staleSec = (Date.now() - endedMs) / 1000;
      const wasFocus = row.mode === "focus";
      const blockSec =
        row.duration_seconds ??
        Math.max(0, (endedMs - Date.parse(row.started_at ?? row.ends_at)) / 1000);

      const nextMode = nextModeAfter(row.mode, row.cycle ?? 0, s);
      const nextDur = durationOf(nextMode, s);
      const autoStart =
        staleSec < STALE_SEC &&
        nextDur > 0 &&
        (nextMode === "focus" ? s.auto_start_focus : s.auto_start_breaks);
      const startMs = Date.now();

      const next = {
        mode: nextMode,
        cycle: wasFocus ? (row.cycle ?? 0) + 1 : row.cycle ?? 0,
        status: autoStart ? "running" : "idle",
        started_at: autoStart ? iso(startMs) : null,
        ends_at: autoStart ? iso(startMs + nextDur * 1000) : null,
        remaining_seconds: null,
        duration_seconds: autoStart ? Math.round(nextDur) : null,
        elapsed_seconds: 0,
        run_start: null,
        device_id: "server",
        updated_at: iso(startMs),
        notified_at: iso(startMs),
      };

      // ------------------------------------------------------ reclamar
      //  Idéntico al claimExpired() del cliente: solo pisa la fila si sigue
      //  'running' con el MISMO ends_at. Si el cliente estaba abierto y llegó
      //  primero, acá no entra ninguna fila y nos vamos sin hacer nada: ni
      //  sesión duplicada ni notificación (la app ya avisó sola).
      const { data: claimed, error: claimErr } = await admin
        .from("active_timer")
        .update(next)
        .eq("user_id", row.user_id)
        .eq("status", "running")
        .eq("ends_at", row.ends_at)
        .select();

      if (claimErr) throw claimErr;
      if (!claimed || claimed.length === 0) continue; // lo cerró el cliente
      stats.cerrados++;

      // -------------------------------------------------- guardar la sesión
      //  Mismas condiciones que saveSession() en el cliente: solo enfoque,
      //  al menos 1 minuto y con grupo elegido.
      const gid = row.sub_group_id || row.group_id;
      if (wasFocus && gid && Math.round(blockSec) >= 60) {
        const { error: sesErr } = await admin.from("sessions").insert({
          user_id: row.user_id,
          group_id: gid,
          mode: "focus",
          started_at: row.started_at ?? iso(endedMs - blockSec * 1000),
          ended_at: row.ends_at, // la hora REAL de fin, no la del cron
          duration_seconds: Math.round(blockSec),
          local_date: localDateKey(endedMs, s.time_zone),
        });
        if (sesErr) throw sesErr;
        stats.sesiones++;
      }

      // --------------------------------------------------------- avisar
      //  Si el bloque venció hace rato, el aviso ya no tiene sentido: la
      //  sesión igual quedó guardada arriba.
      if (staleSec >= STALE_SEC) continue;

      const payload = JSON.stringify({
        title: wasFocus ? "Pomodoro completado" : "Descanso terminado",
        body: wasFocus ? "Tomate un respiro, Fabri." : "Dale, volvé a la carga.",
        tag: "pomodoro",
        url: "/",
      });

      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", row.user_id);

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: PUSH_TTL_SEC, urgency: "high" }
          );
          stats.avisos++;
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          // El navegador desinstaló la suscripción: la fila ya no sirve.
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            stats.bajas++;
          } else {
            stats.errores.push(`push ${code ?? "?"}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      stats.errores.push(`${row.user_id}: ${(e as Error).message}`);
    }
  }

  console.log("notify-timers", JSON.stringify(stats));
  return json(stats);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
