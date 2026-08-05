"use client";

import { supabase, isSupabaseConfigured } from "./supabase";
import { uid, todayKey } from "./utils";
import { DEFAULT_THEME } from "./theme";

/**
 * Capa de datos con dos backends:
 *  - Supabase (si están las variables NEXT_PUBLIC_SUPABASE_*)
 *  - localStorage (fallback, para probar sin configurar nada)
 * Las dos exponen exactamente la misma API.
 */

export const backend = isSupabaseConfigured ? "supabase" : "local";

/**
 * Usuario logueado. Lo setea AuthProvider en cada cambio de sesión.
 * Con RLS activo Postgres ya filtra por usuario, pero los INSERT necesitan
 * el user_id explícito para que la política los acepte.
 */
let CURRENT_USER_ID = null;

export function setCurrentUserId(id) {
  CURRENT_USER_ID = id || null;
}

export function currentUserId() {
  return CURRENT_USER_ID;
}

const LS = {
  groups: "pf.groups",
  sessions: "pf.sessions",
  sleep: "pf.sleep",
  settings: "pf.settings",
};

const read = (k, fallback) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k, v) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(k, JSON.stringify(v));
};

// ------------------------------------------------------------------ GRUPOS

/**
 * Columnas de `groups` que llegaron después (tipo de actividad, meta/límite,
 * objetivo diario). Igual que con los ajustes, el front puede estar deployado
 * antes de que corras el SQL: si Postgres dice que no existen, se sacan del
 * payload y el resto del grupo se guarda igual. Al correr la migración vuelven
 * solas.
 */
const GROUP_EXTRA_COLUMNS = ["kind", "goal_type", "daily_goal_minutes"];
const missingGroupColumns = new Set();

const withoutMissing = (row) => {
  const out = { ...row };
  for (const c of missingGroupColumns) delete out[c];
  return out;
};

/**
 * Qué columnas nuevas le faltan a esta base. Sirve para avisar en la UI: sin
 * esto, elegir "Despeje" o poner un límite se guarda "bien" pero el campo se
 * cae en el camino y parece que el botón no hace nada.
 */
export const missingGroupFeatures = () => [...missingGroupColumns];

/** Defaults para las filas que vienen de una base sin las columnas nuevas */
const normalizeGroup = (g) => ({
  ...g,
  kind: g.kind || "productivo",
  goal_type: g.goal_type || (g.kind === "despeje" ? "limite" : "meta"),
  weekly_goal_minutes: Number(g.weekly_goal_minutes) || 0,
  daily_goal_minutes: Number(g.daily_goal_minutes) || 0,
});

export async function listGroups() {
  if (backend === "supabase") {
    const { data, error } = await supabase
      .from("groups")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    // marcamos las columnas que esta base todavía no tiene
    if (data?.length) {
      for (const col of GROUP_EXTRA_COLUMNS) {
        if (col in data[0]) missingGroupColumns.delete(col);
        else missingGroupColumns.add(col);
      }
    }
    return (data || []).map(normalizeGroup);
  }
  return read(LS.groups, []).map(normalizeGroup);
}

export async function createGroup(g) {
  const kind = g.kind || "productivo";
  const row = {
    id: uid(),
    user_id: CURRENT_USER_ID,
    name: g.name,
    color: g.color || "#8b5cf6",
    parent_id: g.parent_id || null,
    kind,
    goal_type: g.goal_type || (kind === "despeje" ? "limite" : "meta"),
    weekly_goal_minutes: g.weekly_goal_minutes ?? 0,
    daily_goal_minutes: g.daily_goal_minutes ?? 0,
    archived: false,
    sort_order: g.sort_order ?? 0,
    created_at: new Date().toISOString(),
  };
  if (backend === "supabase") {
    for (;;) {
      const { data, error } = await supabase
        .from("groups")
        .insert(withoutMissing(row))
        .select()
        .single();
      if (!error) return normalizeGroup(data);
      const col = undefinedColumn(error);
      if (!col || !GROUP_EXTRA_COLUMNS.includes(col) || missingGroupColumns.has(col)) throw error;
      missingGroupColumns.add(col); // y reintentamos sin ella
    }
  }
  const all = read(LS.groups, []);
  all.push(row);
  write(LS.groups, all);
  return row;
}

export async function updateGroup(id, patch) {
  if (backend === "supabase") {
    for (;;) {
      const { error } = await supabase.from("groups").update(withoutMissing(patch)).eq("id", id);
      if (!error) return;
      const col = undefinedColumn(error);
      if (!col || !GROUP_EXTRA_COLUMNS.includes(col) || missingGroupColumns.has(col)) throw error;
      missingGroupColumns.add(col);
    }
  }
  const all = read(LS.groups, []).map((g) => (g.id === id ? { ...g, ...patch } : g));
  write(LS.groups, all);
}

/** Borra el grupo, sus subgrupos y las sesiones asociadas */
export async function deleteGroup(id) {
  if (backend === "supabase") {
    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const groups = read(LS.groups, []);
  const kill = new Set([id, ...groups.filter((g) => g.parent_id === id).map((g) => g.id)]);
  write(LS.groups, groups.filter((g) => !kill.has(g.id)));
  write(
    LS.sessions,
    read(LS.sessions, []).filter((s) => !kill.has(s.group_id))
  );
}

// ---------------------------------------------------------------- SESIONES

export async function listSessions(startKey, endKey) {
  if (backend === "supabase") {
    let q = supabase.from("sessions").select("*").order("started_at", { ascending: false });
    if (startKey) q = q.gte("local_date", startKey);
    if (endKey) q = q.lte("local_date", endKey);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let all = read(LS.sessions, []);
  if (startKey) all = all.filter((s) => s.local_date >= startKey);
  if (endKey) all = all.filter((s) => s.local_date <= endKey);
  return all.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}

export async function createSession(s) {
  const row = {
    id: uid(),
    user_id: CURRENT_USER_ID,
    group_id: s.group_id || null,
    mode: s.mode || "focus",
    started_at: s.started_at,
    ended_at: s.ended_at,
    duration_seconds: Math.round(s.duration_seconds),
    note: s.note || null,
    local_date: s.local_date || todayKey(),
    created_at: new Date().toISOString(),
  };
  if (backend === "supabase") {
    const { data, error } = await supabase.from("sessions").insert(row).select().single();
    if (error) throw error;
    return data;
  }
  const all = read(LS.sessions, []);
  all.push(row);
  write(LS.sessions, all);
  return row;
}

export async function updateSession(id, patch) {
  if (backend === "supabase") {
    const { error } = await supabase.from("sessions").update(patch).eq("id", id);
    if (error) throw error;
    return;
  }
  write(
    LS.sessions,
    read(LS.sessions, []).map((s) => (s.id === id ? { ...s, ...patch } : s))
  );
}

export async function deleteSession(id) {
  if (backend === "supabase") {
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  write(
    LS.sessions,
    read(LS.sessions, []).filter((s) => s.id !== id)
  );
}

// ------------------------------------------------------------------- SUEÑO

export async function listSleep(startKey, endKey) {
  if (backend === "supabase") {
    let q = supabase.from("sleep_logs").select("*").order("local_date", { ascending: false });
    if (startKey) q = q.gte("local_date", startKey);
    if (endKey) q = q.lte("local_date", endKey);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  let all = read(LS.sleep, []);
  if (startKey) all = all.filter((s) => s.local_date >= startKey);
  if (endKey) all = all.filter((s) => s.local_date <= endKey);
  return all.sort((a, b) => (a.local_date < b.local_date ? 1 : -1));
}

export async function upsertSleep(entry) {
  const row = {
    user_id: CURRENT_USER_ID,
    local_date: entry.local_date,
    bed_time: entry.bed_time || null,
    wake_time: entry.wake_time || null,
    hours: entry.hours ?? null,
    quality: entry.quality ?? null,
    note: entry.note || null,
  };
  if (backend === "supabase") {
    const { data, error } = await supabase
      .from("sleep_logs")
      .upsert({ id: entry.id || uid(), ...row }, { onConflict: "user_id,local_date" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const all = read(LS.sleep, []);
  const i = all.findIndex((s) => s.local_date === row.local_date);
  if (i >= 0) all[i] = { ...all[i], ...row };
  else all.push({ id: uid(), created_at: new Date().toISOString(), ...row });
  write(LS.sleep, all);
  return all[i >= 0 ? i : all.length - 1];
}

export async function deleteSleep(id) {
  if (backend === "supabase") {
    const { error } = await supabase.from("sleep_logs").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  write(
    LS.sleep,
    read(LS.sleep, []).filter((s) => s.id !== id)
  );
}

// -------------------------------------------------------------- PREFERENCIAS
//
//  Los ajustes viven en la tabla `user_settings` (una fila por usuario) y
//  localStorage queda como caché: al abrir la app se pinta lo último que
//  sabíamos —sin parpadeo— y después se reconcilia con lo que dice la nube.
//
//  No es capricho: el servidor necesita las duraciones y el "descanso largo
//  cada N" para poder cerrar el bloque y decidir qué viene después cuando la
//  web está cerrada. De yapa, los ajustes ahora te siguen entre dispositivos.

export const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
  volume: 0.5,
  notifications: true,
  askNote: true,
  sleepGoalHours: 8,
  theme: DEFAULT_THEME,
};

/** camelCase de la app  ->  snake_case de la tabla */
const SETTINGS_COLUMNS = {
  focusMin: "focus_min",
  shortMin: "short_min",
  longMin: "long_min",
  longEvery: "long_every",
  autoStartBreaks: "auto_start_breaks",
  autoStartFocus: "auto_start_focus",
  sound: "sound",
  volume: "volume",
  notifications: "notifications",
  askNote: "ask_note",
  sleepGoalHours: "sleep_goal_hours",
  theme: "theme",
};

const withDefaults = (saved) => ({
  ...DEFAULT_SETTINGS,
  ...(saved || {}),
  theme: { ...DEFAULT_THEME, ...((saved || {}).theme || {}) },
});

function rowToSettings(row) {
  const out = {};
  for (const [key, col] of Object.entries(SETTINGS_COLUMNS)) {
    if (row[col] !== undefined && row[col] !== null) out[key] = row[col];
  }
  // las columnas numeric vuelven como string desde postgrest
  if (out.volume !== undefined) out.volume = Number(out.volume);
  if (out.sleepGoalHours !== undefined) out.sleepGoalHours = Number(out.sleepGoalHours);
  return withDefaults(out);
}

/**
 * Columnas que esta base todavía no tiene.
 *
 * La tabla va creciendo (sleep_goal_hours, theme, time_zone…) y el SQL se
 * corre a mano en Supabase, así que el deploy del front puede adelantarse a
 * la migración. Sin esto, mandar una columna inexistente hace que Postgres
 * rechace la fila ENTERA: dejarían de sincronizar todos los ajustes, no solo
 * el campo nuevo. Se descubren solas la primera vez que Postgres se queja y
 * se saltean de ahí en más; al correr el SQL, vuelven a viajar sin tocar nada.
 */
const missingColumns = new Set();

/** Saca el nombre de columna del error 42703 de Postgres */
function undefinedColumn(error) {
  if (!error || error.code !== "42703") return null;
  const m = /column "?(?:[a-z_]+\.)?([a-z_]+)"?/i.exec(error.message || "");
  return m ? m[1] : null;
}

function settingsToRow(s) {
  const row = {};
  for (const [key, col] of Object.entries(SETTINGS_COLUMNS)) {
    if (!missingColumns.has(col)) row[col] = s[key];
  }
  if (!missingColumns.has("time_zone")) row.time_zone = timeZone();
  row.updated_at = new Date().toISOString();
  return row;
}

/**
 * Upsert de la fila de ajustes, reintentando sin las columnas que la base no
 * conoce. Como mucho da una vuelta por columna faltante y después corta.
 */
async function upsertSettings(s) {
  for (let intento = 0; intento < Object.keys(SETTINGS_COLUMNS).length + 2; intento++) {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: CURRENT_USER_ID, ...settingsToRow(s) }, { onConflict: "user_id" });
    if (!error) return null;

    const col = undefinedColumn(error);
    if (!col || missingColumns.has(col)) return error;
    missingColumns.add(col); // y reintentamos sin ella
  }
  return null;
}

/** Zona horaria del navegador; el servidor la usa para el local_date */
function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Lectura instantánea desde la caché local. Se usa para el primer render. */
export function loadSettings() {
  return withDefaults(read(LS.settings, {}));
}

/** Guarda en la caché local y, si hay cuenta, empuja a la nube (sin bloquear) */
export function saveSettings(s) {
  write(LS.settings, s);
  pushSettings(s);
}

let settingsTimer = null;
let lastPushError = null;

/**
 * Sube los ajustes a la nube. Va con un pequeño retardo porque el slider de
 * volumen y los inputs numéricos disparan muchos cambios seguidos.
 */
export function pushSettings(s) {
  if (backend !== "supabase" || !CURRENT_USER_ID) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      lastPushError = await upsertSettings(s);
    } catch (e) {
      lastPushError = e;
    }
  }, 600);
}

export const settingsSyncError = () => lastPushError;

/**
 * Trae los ajustes de la nube y refresca la caché.
 * Si el usuario todavía no tiene fila, sube lo que había en este navegador:
 * así el primer arranque con cuenta no te resetea nada.
 */
export async function fetchSettings() {
  const local = loadSettings();
  if (backend !== "supabase" || !CURRENT_USER_ID) return local;

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", CURRENT_USER_ID)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    await upsertSettings(local);
    return local;
  }

  // `select("*")` devuelve solo las columnas que existen: si falta alguna, es
  // que a esta base todavía le falta correr la migración. Ese ajuste se queda
  // con el valor de este navegador en vez de volver al default, y no se manda
  // en los upsert hasta que la columna aparezca.
  for (const col of Object.values(SETTINGS_COLUMNS)) {
    if (col in data) missingColumns.delete(col);
    else missingColumns.add(col);
  }

  const remote = rowToSettings(data);
  for (const [key, col] of Object.entries(SETTINGS_COLUMNS)) {
    if (missingColumns.has(col)) remote[key] = local[key];
  }
  write(LS.settings, remote);

  // La zona horaria puede cambiar (viajás, o entrás desde otro dispositivo):
  // se actualiza en silencio para que el servidor guarde bien el local_date.
  const tz = timeZone();
  if (tz && data.time_zone !== tz) {
    supabase
      .from("user_settings")
      .update({ time_zone: tz })
      .eq("user_id", CURRENT_USER_ID)
      .then(() => {});
  }

  return remote;
}

// ------------------------------------------------------------- EXPORT/IMPORT

export async function exportAll() {
  const [groups, sessions, sleep] = await Promise.all([
    listGroups(),
    listSessions(),
    listSleep(),
  ]);
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    backend,
    groups,
    sessions,
    sleep,
    settings: loadSettings(),
  };
}

export async function importAll(payload) {
  if (!payload || !Array.isArray(payload.groups)) throw new Error("Archivo inválido");
  if (backend === "supabase") {
    // todo lo importado pasa a ser de la cuenta actual
    const mine = (rows) => (rows || []).map((r) => ({ ...r, user_id: CURRENT_USER_ID }));
    if (payload.groups.length) {
      const groups = mine(payload.groups);
      const parents = groups.filter((g) => !g.parent_id);
      const kids = groups.filter((g) => g.parent_id);
      if (parents.length) await supabase.from("groups").upsert(parents);
      if (kids.length) await supabase.from("groups").upsert(kids);
    }
    if (payload.sessions?.length)
      await supabase.from("sessions").upsert(mine(payload.sessions));
    if (payload.sleep?.length)
      await supabase
        .from("sleep_logs")
        .upsert(mine(payload.sleep), { onConflict: "user_id,local_date" });
  } else {
    write(LS.groups, payload.groups);
    write(LS.sessions, payload.sessions || []);
    write(LS.sleep, payload.sleep || []);
  }
  if (payload.settings) saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
}

/**
 * Lo que haya quedado guardado solo en este navegador (de cuando la app
 * andaba sin cuentas). Sirve para subirlo a la cuenta una sola vez.
 */
export function readLocalBackup() {
  return {
    version: 1,
    groups: read(LS.groups, []),
    sessions: read(LS.sessions, []),
    sleep: read(LS.sleep, []),
  };
}

// ------------------------------------------------------------------- SEMILLA

/**
 * Grupos con los que arranca una cuenta nueva.
 *
 * A propósito son genéricos y sin subgrupos: alcanzan para poder tirar el
 * primer pomodoro sin configurar nada, y cada uno los renombra, los borra o
 * les cuelga sus propias materias desde la pestaña Grupos.
 *
 * Vienen los tres tipos representados para que se vea de entrada que la app no
 * mide solo estudio: también el gimnasio y el tiempo de despeje (ese con un
 * límite en vez de una meta).
 */
const SEED = [
  { name: "Estudio", color: "#8b5cf6", kind: "productivo", children: [] },
  { name: "Trabajo", color: "#22d3ee", kind: "productivo", children: [] },
  { name: "Gimnasio", color: "#34d399", kind: "cuerpo", children: [] },
  { name: "Despeje", color: "#fbbf24", kind: "despeje", children: [] },
];

/** Evita sembrar dos veces si la llamada se dispara en paralelo */
let seeding = null;

/** Crea los grupos iniciales si la base está vacía */
export async function seedIfEmpty() {
  if (seeding) return seeding;
  seeding = (async () => {
    const existing = await listGroups();
    if (existing.length) return existing;
    let order = 0;
    for (const p of SEED) {
      const parent = await createGroup({
        name: p.name,
        color: p.color,
        kind: p.kind,
        weekly_goal_minutes: 0,
        daily_goal_minutes: 0,
        sort_order: order++,
      });
      let sub = 0;
      for (const c of p.children) {
        await createGroup({
          name: c,
          color: p.color,
          parent_id: parent.id,
          sort_order: sub++,
        });
      }
    }
    return listGroups();
  })();
  try {
    return await seeding;
  } finally {
    seeding = null;
  }
}
