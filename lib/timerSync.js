"use client";

import { supabase, isSupabaseConfigured } from "./supabase";
import { uid } from "./utils";

/**
 * Estado del timer compartido entre dispositivos.
 *
 * La idea clave: mientras el pomodoro corre NO se guardan "segundos
 * restantes" sino el instante en que termina (ends_at). El navegador solo
 * mira el reloj y resta. Entonces:
 *   · cerrás la web            -> el pomodoro sigue corriendo igual
 *   · abrís en el celular      -> ve exactamente el mismo tiempo restante
 *   · se completa sin nadie mirando -> al volver se detecta y se guarda
 * y solo se detiene si vos lo cancelás.
 *
 * En modo libre pasa lo mismo con run_start (cuenta para arriba).
 */

const DEVICE_KEY = "pf.device";
const MIRROR_KEY = "pf.timer"; // copia local: arranque instantáneo y modo sin cuenta

export const EMPTY_TIMER = {
  status: "idle", // idle | running | paused
  mode: "focus", // focus | short | long
  free_mode: false,
  group_id: null,
  sub_group_id: null,
  started_at: null,
  ends_at: null,
  remaining_seconds: null,
  duration_seconds: null,
  elapsed_seconds: 0,
  run_start: null,
  cycle: 0,
  device_id: null,
  updated_at: null,
};

const FIELDS = Object.keys(EMPTY_TIMER);

/** Deja solo las columnas de la tabla y completa lo que falte */
export function normalize(row) {
  const out = { ...EMPTY_TIMER };
  if (!row) return out;
  for (const k of FIELDS) if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  if (!["idle", "running", "paused"].includes(out.status)) out.status = "idle";
  return out;
}

/** Id estable de este navegador, para ignorar el eco de los propios cambios */
export function deviceId() {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uid();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const mirrorKey = (userId) => (userId ? `${MIRROR_KEY}.${userId}` : MIRROR_KEY);

export function readMirror(userId) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(mirrorKey(userId));
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeMirror(userId, state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(mirrorKey(userId), JSON.stringify(state));
  } catch {
    /* sin espacio o modo privado: no es crítico */
  }
}

const remote = (userId) => isSupabaseConfigured && !!userId;

// ------------------------------------------------------------------ leer

export async function fetchTimer(userId) {
  if (!remote(userId)) return readMirror(userId);
  const { data, error } = await supabase
    .from("active_timer")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalize(data) : null;
}

// --------------------------------------------------------------- escribir

/** Guarda el estado (nube + copia local). Devuelve el estado sellado. */
export async function pushTimer(userId, state) {
  const stamped = {
    ...normalize(state),
    device_id: deviceId(),
    updated_at: new Date().toISOString(),
  };
  writeMirror(userId, stamped);
  if (!remote(userId)) return stamped;

  const { error } = await supabase
    .from("active_timer")
    .upsert({ user_id: userId, ...stamped }, { onConflict: "user_id" });
  if (error) throw error;
  return stamped;
}

/**
 * Cierra un bloque que ya venció, pero solo si nadie lo cerró antes.
 * El UPDATE condicional (mismo ends_at, todavía 'running') hace que entre
 * varios dispositivos abiertos gane uno solo: así la sesión no se guarda
 * dos veces. Devuelve true si este dispositivo se quedó con el bloque.
 */
export async function claimExpired(userId, expectedEndsAt, nextState) {
  const stamped = {
    ...normalize(nextState),
    device_id: deviceId(),
    updated_at: new Date().toISOString(),
  };
  if (!remote(userId)) {
    writeMirror(userId, stamped);
    return true;
  }

  const { data, error } = await supabase
    .from("active_timer")
    .update(stamped)
    .eq("user_id", userId)
    .eq("status", "running")
    .eq("ends_at", expectedEndsAt)
    .select();
  if (error) throw error;
  const won = Array.isArray(data) && data.length > 0;
  if (won) writeMirror(userId, stamped);
  return won;
}

// --------------------------------------------------------------- escuchar

/** Avisa cuando otro dispositivo toca el timer. Devuelve la baja. */
export function subscribeTimer(userId, onChange) {
  if (!remote(userId)) return () => {};
  const channel = supabase
    .channel(`active_timer:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "active_timer",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (!payload.new || !payload.new.status) return;
        const next = normalize(payload.new);
        if (next.device_id === deviceId()) return; // es nuestro propio cambio
        onChange(next);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
