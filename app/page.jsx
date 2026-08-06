"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Welcome from "@/components/Welcome";
import Auth from "@/components/Auth";
import Timer from "@/components/Timer";
import Analytics from "@/components/Analytics";
import Sleep from "@/components/Sleep";
import GroupsManager from "@/components/GroupsManager";
import SettingsPanel from "@/components/Settings";
import { DownloadButton } from "@/components/InstallApp";
import DesktopHandoff, { pedidoDeEscritorio, olvidarPedido } from "@/components/DesktopHandoff";
import {
  listSessions,
  loadSettings,
  fetchSettings,
  saveSettings,
  seedIfEmpty,
  listGroups,
  DEFAULT_SETTINGS,
} from "@/lib/db";
import { syncPushSubscription } from "@/lib/push";
import { AuthProvider, displayName, useAuth, useSignOut } from "@/lib/auth";
import { fmtDur, periodRange, todayKey } from "@/lib/utils";
import { applyTheme } from "@/lib/theme";
import { KINDS, dailyGoalMin, goalTypeOf, kindOf } from "@/lib/kinds";

const TABS = [
  { id: "timer", label: "Timer" },
  { id: "stats", label: "Analítica" },
  { id: "sleep", label: "Sueño" },
  { id: "groups", label: "Grupos" },
  { id: "settings", label: "Ajustes" },
];

export default function Page() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

/** Pantalla de cuenta primero; la app recién cuando hay sesión */
function Gate() {
  const { user, loading, needsAuth } = useAuth();

  // Login que empezó en la app de escritorio: la cáscara abre el navegador acá
  // y espera que le devolvamos la sesión. Se lee en un efecto (y no en el
  // primer render) porque el HTML lo genera el servidor, donde no hay URL.
  const [pedido, setPedido] = useState(null);

  // el tema se pinta también en la pantalla de login
  useEffect(() => {
    applyTheme(loadSettings().theme);
    setPedido(pedidoDeEscritorio());
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        Cargando…
      </div>
    );
  }
  if (needsAuth) return <Auth />;

  // ya hay sesión: si la pidió la app de escritorio, se la damos antes de
  // entrar (si no, quedaría logueado el navegador y la app seguiría afuera)
  if (pedido) {
    return (
      <DesktopHandoff
        estado={pedido}
        onSeguirAca={() => {
          olvidarPedido();
          setPedido(null);
        }}
      />
    );
  }

  // key: al cambiar de cuenta la app se reinicia limpia
  return (
    <App
      key={user?.id || "local"}
      userId={user?.id || null}
      email={user?.email || ""}
      name={displayName(user)}
    />
  );
}

function App({ userId, email, name }) {
  const signOut = useSignOut();
  const [showWelcome, setShowWelcome] = useState(true);
  const [tab, setTab] = useState("timer");
  const [groups, setGroups] = useState([]);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [weekSessions, setWeekSessions] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);

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
    // primero la caché local (arranque instantáneo, sin parpadeo)…
    setSettingsState(loadSettings());
    (async () => {
      // …y después lo que diga la nube, que es la fuente de verdad
      try {
        setSettingsState(await fetchSettings());
      } catch (e) {
        setError(e.message || String(e));
      }
      try {
        await seedIfEmpty();
      } catch (e) {
        setError(e.message || String(e));
      }
      await refresh();
      setReady(true);
      // si este dispositivo ya estaba suscripto a los avisos, revalida la
      // fila en la base (el navegador puede haber rotado el endpoint)
      syncPushSubscription(userId).catch(() => {});
    })();
  }, [refresh, userId]);

  // el tema vive en los ajustes: cada cambio se pinta en <html>
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // agregados de la semana en curso
  const { todaySec, weekByGroup, todayByGroup, todayByKind } = useMemo(() => {
    const gmap = Object.fromEntries(groups.map((g) => [g.id, g]));
    const tk = todayKey();
    let today = 0;
    const week = {};
    const day = {};
    const kinds = {};
    weekSessions.forEach((s) => {
      const isToday = s.local_date === tk;
      if (isToday) today += s.duration_seconds;
      const g = gmap[s.group_id];
      if (!g) return;
      const root = g.parent_id ? gmap[g.parent_id] || g : g;
      week[g.id] = (week[g.id] || 0) + s.duration_seconds;
      if (g.parent_id) week[g.parent_id] = (week[g.parent_id] || 0) + s.duration_seconds;
      if (isToday) {
        day[g.id] = (day[g.id] || 0) + s.duration_seconds;
        if (g.parent_id) day[g.parent_id] = (day[g.parent_id] || 0) + s.duration_seconds;
        kinds[kindOf(root)] = (kinds[kindOf(root)] || 0) + s.duration_seconds;
      }
    });
    return { todaySec: today, weekByGroup: week, todayByGroup: day, todayByKind: kinds };
  }, [weekSessions, groups]);

  const weekTotal = weekSessions.reduce((a, s) => a + s.duration_seconds, 0);

  // Límites diarios pasados. Es el aviso de "che, ya está" que pediste: mira
  // solo los grupos con límite diario y compara con lo de hoy.
  const passedLimits = useMemo(
    () =>
      groups
        .filter((g) => !g.parent_id && goalTypeOf(g) === "limite" && dailyGoalMin(g) > 0)
        .map((g) => ({
          id: g.id,
          name: g.name,
          emoji: KINDS[kindOf(g)].emoji,
          sec: todayByGroup[g.id] || 0,
          goalSec: dailyGoalMin(g) * 60,
        }))
        .filter((x) => x.sec > x.goalSec),
    [groups, todayByGroup]
  );

  return (
    <>
      {showWelcome && <Welcome name={name} onDone={() => setShowWelcome(false)} />}

      <div className="mx-auto min-h-dvh w-full max-w-7xl px-4 pb-24 pt-5 sm:px-6">
        {/* -------- header -------- */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
              <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">
                {name ? (
                  <>
                    Hola, <span className="text-accent">{name}</span>
                  </>
                ) : (
                  "Hola"
                )}
              </p>
              <p className="text-xs text-muted">Es hora de trabajar</p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-[.14em] text-muted">Hoy</p>
              <p className="tnum text-sm font-bold">{fmtDur(todaySec)}</p>
            </div>
            {todayByKind.despeje > 0 && (
              <>
                <div className="h-8 w-px bg-line" />
                <div title="Tiempo de despeje de hoy">
                  <p className="text-[10px] uppercase tracking-[.14em] text-muted">
                    {KINDS.despeje.emoji} Despeje
                  </p>
                  <p
                    className={`tnum text-sm font-bold ${
                      passedLimits.length ? "text-focus" : ""
                    }`}
                  >
                    {fmtDur(todayByKind.despeje)}
                  </p>
                </div>
              </>
            )}
            <div className="h-8 w-px bg-line" />
            <div>
              <p className="text-[10px] uppercase tracking-[.14em] text-muted">Semana</p>
              <p className="tnum text-sm font-bold">{fmtDur(weekTotal)}</p>
            </div>

            {/* solo se dibuja en Windows y con la web en un navegador */}
            <DownloadButton />

            {userId && (
              <div className="relative">
                <button
                  onClick={() => setMenu((v) => !v)}
                  title={email}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface2/70 text-sm font-bold uppercase text-ink transition hover:bg-surface3"
                >
                  {(name || email || "?").charAt(0)}
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                    <div className="card absolute right-0 z-50 mt-2 w-60 p-3 text-left">
                      <p className="truncate text-xs text-muted">Sesión iniciada como</p>
                      {name && <p className="truncate text-sm font-semibold">{name}</p>}
                      <p className="mb-3 truncate text-xs text-muted">{email}</p>
                      <button
                        onClick={() => {
                          setMenu(false);
                          setTab("settings");
                        }}
                        className="btn-quiet w-full justify-start text-sm"
                      >
                        Cuenta y ajustes
                      </button>
                      <button onClick={signOut} className="btn-ghost mt-1 w-full text-sm">
                        Cerrar sesión
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
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
                  ? "bg-accent text-onAccent shadow-[0_10px_26px_-14px_rgb(var(--c-accent))]"
                  : "text-muted hover:bg-surface2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {passedLimits.length > 0 && (
          <div className="mb-5 rounded-xl border border-focus/40 bg-focus/10 p-4 text-sm text-focus">
            {passedLimits.map((l) => (
              <p key={l.id}>
                {l.emoji} <b>{l.name}</b>: {fmtDur(l.sec)} hoy · te pasaste del límite de{" "}
                {fmtDur(l.goalSec)} por {fmtDur(l.sec - l.goalSec)}.
              </p>
            ))}
          </div>
        )}

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
                todayByGroup={todayByGroup}
                userId={userId}
                name={name}
              />
            )}
            {tab === "stats" && (
              <Analytics groups={groups} refreshKey={refreshKey} onChange={refresh} />
            )}
            {tab === "sleep" && (
              <Sleep onChange={refresh} goalHours={settings.sleepGoalHours} />
            )}
            {tab === "groups" && (
              <GroupsManager
                groups={groups}
                weekByGroup={weekByGroup}
                todayByGroup={todayByGroup}
                onChange={refresh}
              />
            )}
            {tab === "settings" && (
              <SettingsPanel
                settings={settings}
                setSettings={setSettings}
                onChange={refresh}
                email={email}
                userId={userId}
              />
            )}
          </main>
        )}
      </div>
    </>
  );
}
