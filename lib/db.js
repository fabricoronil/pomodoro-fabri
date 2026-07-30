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

export async function listGroups() {
  if (backend === "supabase") {
    const { data, error } = await supabase
      .from("groups")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return read(LS.groups, []);
}

export async function createGroup(g) {
  const row = {
    id: uid(),
    name: g.name,
    color: g.color || "#8b5cf6",
    parent_id: g.parent_id || null,
    weekly_goal_minutes: g.weekly_goal_minutes ?? 0,
    archived: false,
    sort_order: g.sort_order ?? 0,
    created_at: new Date().toISOString(),
  };
  if (backend === "supabase") {
    const { data, error } = await supabase.from("groups").insert(row).select().single();
    if (error) throw error;
    return data;
  }
  const all = read(LS.groups, []);
  all.push(row);
  write(LS.groups, all);
  return row;
}

export async function updateGroup(id, patch) {
  if (backend === "supabase") {
    const { error } = await supabase.from("groups").update(patch).eq("id", id);
    if (error) throw error;
    return;
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
      .upsert({ id: entry.id || uid(), ...row }, { onConflict: "local_date" })
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
  theme: DEFAULT_THEME,
};

export function loadSettings() {
  const saved = read(LS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    theme: { ...DEFAULT_THEME, ...(saved.theme || {}) },
  };
}

export function saveSettings(s) {
  write(LS.settings, s);
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
    if (payload.groups.length) {
      const parents = payload.groups.filter((g) => !g.parent_id);
      const kids = payload.groups.filter((g) => g.parent_id);
      if (parents.length) await supabase.from("groups").upsert(parents);
      if (kids.length) await supabase.from("groups").upsert(kids);
    }
    if (payload.sessions?.length) await supabase.from("sessions").upsert(payload.sessions);
    if (payload.sleep?.length)
      await supabase.from("sleep_logs").upsert(payload.sleep, { onConflict: "local_date" });
  } else {
    write(LS.groups, payload.groups);
    write(LS.sessions, payload.sessions || []);
    write(LS.sleep, payload.sleep || []);
  }
  if (payload.settings) saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
}

// ------------------------------------------------------------------- SEMILLA

const SEED = [
  {
    name: "Facultad",
    color: "#8b5cf6",
    goal: 600,
    children: [
      "Física II",
      "Paradigma y Lenguaje de Programación II",
      "Portugués A",
      "Sistema de Representación",
      "Sistemas Operativos",
    ],
  },
  {
    name: "Inglés",
    color: "#22d3ee",
    goal: 300,
    children: ["Vocabulario", "Speaking", "Listening", "Gramática", "Reading"],
  },
  { name: "Personal", color: "#34d399", goal: 0, children: ["Proyectos", "Lectura"] },
];

/** Crea los grupos iniciales si la base está vacía */
export async function seedIfEmpty() {
  const existing = await listGroups();
  if (existing.length) return existing;
  let order = 0;
  for (const p of SEED) {
    const parent = await createGroup({
      name: p.name,
      color: p.color,
      weekly_goal_minutes: p.goal,
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
}
