"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Welcome from "@/components/Welcome";
import Timer from "@/components/Timer";
import Analytics from "@/components/Analytics";
import Sleep from "@/components/Sleep";
import GroupsManager from "@/components/GroupsManager";
import SettingsPanel from "@/components/Settings";
import {
  listSessions,
  loadSettings,
  saveSettings,
  seedIfEmpty,
  listGroups,
  DEFAULT_SETTINGS,
} from "@/lib/db";
import { fmtDur, periodRange, todayKey } from "@/lib/utils";

const TABS = [
  { id: "timer", label: "Timer" },
  { id: "stats", label: "Analítica" },
  { id: "sleep", label: "Sueño" },
  { id: "groups", label: "Grupos" },
  { id: "settings", label: "Ajustes" },
];

export default function Page() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [tab, setTab] = useState("timer");
  const [groups, setGroups] = useState([]);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [weekSessions, setWeekSessions] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const setSettings = (s) => {
    setSettingsState(s);
    saveSettings(s);
  };

  const refresh = useCallback(async () => {
    try {
      const gs = await listGroups();
      setGroups(gs);
      const r = periodRange("week", new Date());
      setWeekSessions(await listSessions(r.startKey, r.endKey));
      setRefreshKey((k) => k + 1);
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    setSettingsState(loadSettings());
    (async () => {
      try {
        await seedIfEmpty();
      } catch (e) {
        setError(e.message || String(e));
      }
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  // agregados de la semana en curso
  const { todaySec, weekByGroup } = useMemo(() => {
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g]));
    const tk = todayKey();
    let today = 0;
    const week = {};
    weekSessions.forEach((s) => {
      if (s.local_date === tk) today += s.duration_seconds;
      const g = gmap[s.group_id];
      if (!g) return;
      week[g.id] = (week[g.id] || 0) + s.duration_seconds;
      if (g.parent_id) week[g.parent_id] = (week[g.parent_id] || 0) + s.duration_seconds;
    });
    return { todaySec: today, weekByGroup: week };
  }, [weekSessions, groups]);

  const weekTotal = weekSessions.reduce((a, s) => a + s.duration_seconds, 0);

  return (
    <>
      {showWelcome && <Welcome onDone={() => setShowWelcome(false)} />}

      <div className="mx-auto min-h-dvh w-full max-w-7xl px-4 pb-24 pt-5 sm:px-6">
        {/* -------- header -------- */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
              <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">
                Hola, <span className="text-accent">Fabri</span>
              </p>
              <p className="text-xs text-muted">Es hora de trabajar</p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-[.14em] text-muted">Hoy</p>
              <p className="tnum text-sm font-bold">{fmtDur(todaySec)}</p>
            </div>
            <div className="h-8 w-px bg-line" />
            <div>
              <p className="text-[10px] uppercase tracking-[.14em] text-muted">Semana</p>
              <p className="tnum text-sm font-bold">{fmtDur(weekTotal)}</p>
            </div>
          </div>
        </header>

        {/* -------- nav -------- */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface/60 p-1.5 backdrop-blur">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === t.id
                  ? "bg-accent text-white shadow-[0_10px_26px_-14px_rgba(139,92,246,1)]"
                  : "text-muted hover:bg-surface2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="mb-5 rounded-xl border border-focus/40 bg-focus/10 p-4 text-sm text-focus">
            <b>Error de conexión:</b> {error}
            <p className="mt-1 text-xs opacity-80">
              Revisá que hayas corrido el SQL en Supabase y que las variables de entorno estén bien.
            </p>
          </div>
        )}

        {!ready ? (
          <div className="py-24 text-center text-sm text-muted">Cargando…</div>
        ) : (
          <main className="animate-fadeUp">
            {tab === "timer" && (
              <Timer
                groups={groups}
                settings={settings}
                setSettings={setSettings}
                onSaved={refresh}
                todaySec={todaySec}
                weekByGroup={weekByGroup}
              />
            )}
            {tab === "stats" && (
              <Analytics groups={groups} refreshKey={refreshKey} onChange={refresh} />
            )}
            {tab === "sleep" && <Sleep onChange={refresh} />}
            {tab === "groups" && (
              <GroupsManager groups={groups} weekByGroup={weekByGroup} onChange={refresh} />
            )}
            {tab === "settings" && (
              <SettingsPanel settings={settings} setSettings={setSettings} onChange={refresh} />
            )}
          </main>
        )}
      </div>
    </>
  );
}
