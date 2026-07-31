"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listSessions, listSleep, deleteSession } from "@/lib/db";
import {
  addDays,
  eachDayKey,
  fmtDur,
  fromKey,
  longDate,
  pctDelta,
  pearson,
  periodRange,
  shiftAnchor,
  shortDate,
  todayKey,
  toHours,
  toKey,
} from "@/lib/utils";
import { themeColor, themeColorA, useThemeVersion } from "@/lib/theme";
import {
  KINDS,
  KIND_ORDER,
  dailyGoalMin,
  goalTypeOf,
  hasGoal,
  kindMeta,
  kindOf,
  weeklyGoalMin,
} from "@/lib/kinds";
import { Bar as ProgressBar, Delta, Empty, GoalLine, Segmented, Stat } from "./ui";
import LogTime from "./LogTime";

// Recharts recibe colores como atributos SVG, así que necesitan ser hex reales
// y no `var(--…)`: los leemos del tema en cada render.
const tooltipStyle = {
  background: "rgb(var(--c-surface))",
  border: "1px solid rgb(var(--c-line))",
  borderRadius: 12,
  fontSize: 12,
  color: "rgb(var(--c-ink))",
};

const legendStyle = () => ({ color: themeColor("muted"), fontSize: 12 });

const PERIODS = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "year", label: "Año" },
];

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Vistas secundarias: viven detrás del resumen para no ensuciar lo importante.
const EXTRAS = [
  { id: "sesiones", label: "Ver sesión por sesión" },
  { id: "sueno", label: "Sueño vs. rendimiento" },
  { id: "comparar", label: "Comparar dos fechas" },
];

const EXTRA_TITLES = {
  sesiones: "Sesión por sesión",
  sueno: "Sueño vs. rendimiento",
  comparar: "Comparar dos fechas",
};

/**
 * Título del bloque principal, en criollo según el período que estés mirando.
 * A propósito no dice "estudiaste": acá adentro entra todo lo que medís, desde
 * un parcial hasta el gimnasio o la tarde de juegos.
 */
function heroTitle(period, isCurrent) {
  if (period === "day") return isCurrent ? "Hoy le metiste" : "Ese día le metiste";
  if (period === "week") return isCurrent ? "Esta semana le metiste" : "Esa semana le metiste";
  if (period === "month") return isCurrent ? "Este mes le metiste" : "Ese mes le metiste";
  return isCurrent ? "Este año le metiste" : "Ese año le metiste";
}

const chartTitle = (period) =>
  period === "day"
    ? "A qué hora"
    : period === "week"
    ? "Qué días"
    : period === "year"
    ? "Mes a mes"
    : "Día a día";

/** Duración grande, con las unidades en chico: 3h 25m */
function BigDur({ sec }) {
  const s = Math.max(0, Math.round(sec));
  let h = Math.floor(s / 3600);
  let m = Math.round((s % 3600) / 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  const U = ({ children }) => (
    <span className="ml-1 mr-2.5 text-2xl font-semibold text-muted">{children}</span>
  );
  if (!h && !m)
    return (
      <span className="tnum">
        0<U>m</U>
      </span>
    );
  return (
    <span className="tnum">
      {h > 0 && (
        <>
          {h}
          <U>h</U>
        </>
      )}
      {m > 0 && (
        <>
          {m}
          <U>m</U>
        </>
      )}
    </span>
  );
}

const hhmm = (iso) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

export default function Analytics({ groups, refreshKey, onChange }) {
  useThemeVersion(); // los gráficos leen los colores del tema en cada render
  const [period, setPeriod] = useState("day");
  const [anchor, setAnchor] = useState(new Date());
  const [sessions, setSessions] = useState([]);
  const [sleep, setSleep] = useState([]);
  const [tab, setTab] = useState("resumen");
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([listSessions(range.startKey, range.endKey), listSleep()])
      .then(([a, b]) => {
        if (!alive) return;
        setSessions(a);
        setSleep(b);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range.startKey, range.endKey, refreshKey]);

  const gmap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const rootOf = (id) => {
    const g = gmap[id];
    if (!g) return null;
    return g.parent_id ? gmap[g.parent_id] || g : g;
  };
  const fullName = (id) => {
    const g = gmap[id];
    if (!g) return "Sin grupo";
    return g.parent_id ? `${gmap[g.parent_id]?.name || "?"} · ${g.name}` : g.name;
  };

  const totalSec = sessions.reduce((a, s) => a + s.duration_seconds, 0);

  const isCurrent = useMemo(
    () => periodRange(period, new Date()).startKey === range.startKey,
    [period, range]
  );

  // ---- en qué le metiste tiempo: grupo raíz + sus subgrupos, todo junto ----
  const breakdown = useMemo(() => {
    const roots = {};
    sessions.forEach((s) => {
      const g = gmap[s.group_id];
      const root = rootOf(s.group_id);
      const rid = root?.id || "none";
      if (!roots[rid])
        roots[rid] = {
          id: rid,
          name: root?.name || "Sin grupo",
          color: root?.color || themeColor("surface3"),
          kind: kindOf(root),
          sec: 0,
          count: 0,
          kids: {},
        };
      const R = roots[rid];
      R.sec += s.duration_seconds;
      R.count++;

      const kid = g?.parent_id ? g.id : "_general";
      if (!R.kids[kid])
        R.kids[kid] = {
          id: kid,
          name: g?.parent_id ? g.name : "General",
          color: g?.color || R.color,
          sec: 0,
          count: 0,
        };
      R.kids[kid].sec += s.duration_seconds;
      R.kids[kid].count++;
    });

    return Object.values(roots)
      .map((r) => ({
        ...r,
        kids: Object.values(r.kids).sort((a, b) => b.sec - a.sec),
      }))
      .sort((a, b) => b.sec - a.sec);
  }, [sessions, gmap]);

  // ---- el mismo total, partido por tipo: cuánto fue productivo y cuánto no ----
  const byKind = useMemo(() => {
    const m = {};
    breakdown.forEach((r) => {
      m[r.kind] = (m[r.kind] || 0) + r.sec;
    });
    return KIND_ORDER.filter((k) => m[k] > 0).map((k) => ({ ...KINDS[k], sec: m[k] }));
  }, [breakdown]);

  // ------------------------- datos sueltos del período -------------------------
  const facts = useMemo(() => {
    if (!sessions.length) return [];
    const out = [{ label: "Sesiones", value: String(sessions.length) }];

    if (period === "day") {
      const longest = Math.max(...sessions.map((s) => s.duration_seconds));
      const times = sessions.map((s) => new Date(s.started_at)).sort((a, b) => a - b);
      out.push({ label: "La más larga", value: fmtDur(longest) });
      out.push({
        label: "Entre",
        value: `${hhmm(times[0])} y ${hhmm(times[times.length - 1])}`,
      });
      return out;
    }

    const perDay = {};
    sessions.forEach((s) => {
      perDay[s.local_date] = (perDay[s.local_date] || 0) + s.duration_seconds;
    });
    const days = Object.entries(perDay).sort((a, b) => b[1] - a[1]);
    const totalDays = eachDayKey(range.startKey, range.endKey).length;

    out.push({
      label: "Promedio por día activo",
      value: fmtDur(totalSec / days.length),
    });
    out.push({ label: "Días activos", value: `${days.length} de ${totalDays}` });
    if (days.length > 1)
      out.push({
        label: "Tu mejor día",
        value: `${fmtDur(days[0][1])} · ${shortDate(fromKey(days[0][0]))}`,
      });
    return out;
  }, [sessions, period, range, totalSec]);

  // ----------------------------- serie temporal -----------------------------
  const series = useMemo(() => {
    const tk = todayKey();

    if (period === "day") {
      const hours = Array.from({ length: 24 }, (_, h) => ({
        label: `${h}h`,
        hour: h,
        sec: 0,
      }));
      sessions.forEach((s) => {
        hours[new Date(s.started_at).getHours()].sec += s.duration_seconds;
      });
      const active = hours.filter((h) => h.sec > 0);
      if (!active.length) return [];
      // recorta el gráfico a las horas en las que pasó algo (+1 de aire a cada lado)
      const lo = Math.max(0, Math.min(...active.map((h) => h.hour)) - 1);
      const hi = Math.min(23, Math.max(...active.map((h) => h.hour)) + 1);
      return hours.slice(lo, hi + 1).map((h) => ({ ...h, horas: toHours(h.sec) }));
    }

    if (period === "year") {
      const nowM = new Date().getMonth();
      const thisYear = new Date().getFullYear() === fromKey(range.startKey).getFullYear();
      const months = Array.from({ length: 12 }, (_, m) => ({
        label: new Date(2020, m, 1).toLocaleDateString("es-AR", { month: "short" }),
        sec: 0,
        now: thisYear && m === nowM,
      }));
      sessions.forEach((s) => {
        months[fromKey(s.local_date).getMonth()].sec += s.duration_seconds;
      });
      return months.map((m) => ({ ...m, horas: toHours(m.sec) }));
    }

    const keys = eachDayKey(range.startKey, range.endKey);
    const m = Object.fromEntries(keys.map((k) => [k, 0]));
    sessions.forEach((s) => {
      if (m[s.local_date] !== undefined) m[s.local_date] += s.duration_seconds;
    });
    return keys.map((k) => {
      const d = fromKey(k);
      return {
        key: k,
        label: period === "week" ? DOW[(d.getDay() + 6) % 7] : String(d.getDate()),
        sec: m[k],
        horas: toHours(m[k]),
        now: k === tk,
      };
    });
  }, [sessions, period, range]);

  const hasNow = series.some((d) => d.now);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ---------- vista secundaria: volver ---------- */}
      {tab !== "resumen" && (
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setTab("resumen")} className="btn-ghost px-3 py-2 text-sm">
            ‹ Volver al resumen
          </button>
          <span className="text-sm font-semibold">{EXTRA_TITLES[tab]}</span>
        </div>
      )}

      {/* ---------- cabecera: período + navegación ---------- */}
      {(tab === "resumen" || tab === "sesiones") && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented value={period} onChange={setPeriod} options={PERIODS} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAnchor(shiftAnchor(period, anchor, -1))}
              className="btn-ghost px-3 py-2"
              aria-label="Anterior"
            >
              ‹
            </button>
            <span className="min-w-[190px] text-center text-sm font-semibold">
              {period === "day" && isCurrent ? "Hoy" : range.label}
            </span>
            <button
              onClick={() => setAnchor(shiftAnchor(period, anchor, 1))}
              disabled={isCurrent}
              className="btn-ghost px-3 py-2"
              aria-label="Siguiente"
            >
              ›
            </button>
            {!isCurrent && (
              <button onClick={() => setAnchor(new Date())} className="btn-quiet px-3 py-2 text-xs">
                Hoy
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "resumen" && (
        <>
          {/* ---------- 1. cuánto tiempo le metiste ---------- */}
          <div className="card p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted">
              {heroTitle(period, isCurrent)}
            </p>
            <p
              className={`mt-1 text-5xl font-bold leading-none transition-opacity sm:text-6xl ${
                loading ? "opacity-30" : ""
              }`}
            >
              <BigDur sec={totalSec} />
            </p>

            {/* de dónde sale ese total: productivo, cuerpo, despeje */}
            {byKind.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {byKind.map((k) => (
                  <div key={k.id} className="flex items-baseline gap-2">
                    <span
                      className="h-2 w-2 translate-y-[-1px] rounded-full"
                      style={{ background: themeColor(k.token) }}
                    />
                    <span className="text-sm text-muted">
                      {k.emoji} {k.label}
                    </span>
                    <span className="tnum text-sm font-bold">{fmtDur(k.sec)}</span>
                    {totalSec > 0 && (
                      <span className="text-[11px] text-muted">
                        {Math.round((k.sec / totalSec) * 100)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {facts.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-line/60 pt-4">
                {facts.map((f) => (
                  <div key={f.label}>
                    <p className="text-[11px] uppercase tracking-[.1em] text-muted">{f.label}</p>
                    <p className="tnum mt-0.5 text-sm font-semibold">{f.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------- 2. en qué se fue ese tiempo ---------- */}
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <p className="label mb-0">En qué le metiste tiempo</p>
              <div className="flex items-baseline gap-3">
                {breakdown.length > 1 && (
                  <span className="text-xs text-muted">{breakdown.length} grupos</span>
                )}
                <button onClick={() => setLogging(true)} className="chip text-[11px]">
                  + Cargar tiempo a mano
                </button>
              </div>
            </div>

            {loading ? (
              <Empty>Cargando…</Empty>
            ) : breakdown.length === 0 ? (
              <Empty>
                {period === "day" && isCurrent
                  ? "Todavía no registraste tiempo hoy. Arrancá un pomodoro —o cargá a mano lo que ya hiciste— y aparece acá."
                  : "No hay sesiones en este período."}
              </Empty>
            ) : (
              <>
                {/* barra de reparto: todo el período de un vistazo */}
                {breakdown.length > 1 && (
                  <div className="mb-5 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
                    {breakdown.map((g) => (
                      <div
                        key={g.id}
                        title={`${g.name} · ${fmtDur(g.sec)}`}
                        style={{
                          width: `${(g.sec / totalSec) * 100}%`,
                          background: g.color,
                        }}
                        className="rounded-full"
                      />
                    ))}
                  </div>
                )}

                <div className="space-y-4">
                  {breakdown.map((g) => (
                    <GroupRow key={g.id} group={g} total={totalSec} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ---------- 3. cuándo ---------- */}
          {series.length > 0 && totalSec > 0 && (
            <div className="card p-5">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <p className="label mb-0">{chartTitle(period)}</p>
                {hasNow && (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: themeColor("accent2") }}
                    />
                    {period === "year" ? "este mes" : "hoy"}
                  </span>
                )}
              </div>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis tickLine={false} axisLine={false} unit="h" />
                    <Tooltip
                      cursor={{ fill: themeColorA("ink", 0.05) }}
                      contentStyle={tooltipStyle}
                      formatter={(v, n, p) => [fmtDur(p.payload.sec), "Tiempo"]}
                    />
                    <RBar dataKey="horas" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {series.map((d, i) => (
                        <Cell
                          key={i}
                          fill={themeColor(d.now ? "accent2" : "accent")}
                        />
                      ))}
                    </RBar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <GoalsPanel groups={groups} />

          {/* ---------- 4. lo demás, fuera del camino ---------- */}
          <div className="pt-3 text-center">
            <p className="mb-2 text-xs text-muted">¿Querés mirar algo más?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXTRAS.map((e) => (
                <button key={e.id} onClick={() => setTab(e.id)} className="chip">
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "sesiones" && (
        <SessionsList
          sessions={sessions}
          period={period}
          rootOf={rootOf}
          fullName={fullName}
          onChange={onChange}
        />
      )}

      {tab === "sueno" && (
        <SleepVsStudy sleep={sleep} groups={groups} refreshKey={refreshKey} />
      )}

      {tab === "comparar" && <Compare groups={groups} refreshKey={refreshKey} />}

      <LogTime
        groups={groups}
        open={logging}
        onClose={() => setLogging(false)}
        onSaved={onChange}
      />
    </div>
  );
}

/* ------------------------------------------------ FILA DE GRUPO + SUBGRUPOS */

function GroupRow({ group, total }) {
  const pct = total ? (group.sec / total) * 100 : 0;
  const kind = KINDS[group.kind] || KINDS.productivo;
  // "General" solo cuando es el único hijo: no aporta nada desglosarlo
  const kids =
    group.kids.length === 1 && group.kids[0].id === "_general" ? [] : group.kids;

  return (
    <div className="rounded-xl border border-line/60 bg-surface2/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2 font-semibold">
          <span
            className="h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full"
            style={{ background: group.color }}
          />
          <span className="truncate">{group.name}</span>
        </span>
        <span className="tnum shrink-0 font-bold">{fmtDur(group.sec)}</span>
      </div>

      <div className="mt-2">
        <ProgressBar pct={pct} color={group.color} height={6} />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {kind.emoji} {kind.label} · {Math.round(pct)}% de tu tiempo · {group.count}{" "}
        {group.count === 1 ? "sesión" : "sesiones"}
      </p>

      {kids.length > 0 && (
        <div className="mt-3.5 space-y-2 border-t border-line/50 pt-3">
          {kids.map((k) => (
            <div key={k.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-muted">{k.name}</span>
              <div className="hidden h-1.5 w-28 shrink-0 sm:block">
                <ProgressBar pct={(k.sec / group.sec) * 100} color={k.color} height={6} />
              </div>
              <span className="tnum w-16 shrink-0 text-right font-semibold">
                {fmtDur(k.sec)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ METAS */

/**
 * Metas y límites.
 *
 * Siempre mira la semana en curso y el día de hoy, sin importar qué período
 * estés viendo arriba: es el tablero de "¿cómo vengo?", no del pasado.
 */
function GoalsPanel({ groups }) {
  const [sec, setSec] = useState({ week: {}, today: {} });
  const withGoal = groups.filter((g) => !g.parent_id && hasGoal(g));

  useEffect(() => {
    if (!withGoal.length) return;
    const r = periodRange("week", new Date());
    const tk = todayKey();
    listSessions(r.startKey, r.endKey).then((ss) => {
      const gmap = Object.fromEntries(groups.map((g) => [g.id, g]));
      const week = {};
      const today = {};
      ss.forEach((s) => {
        const g = gmap[s.group_id];
        const rootId = g?.parent_id || g?.id;
        if (!rootId) return;
        week[rootId] = (week[rootId] || 0) + s.duration_seconds;
        if (s.local_date === tk) today[rootId] = (today[rootId] || 0) + s.duration_seconds;
      });
      setSec({ week, today });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  if (!withGoal.length) return null;

  const anyLimit = withGoal.some((g) => goalTypeOf(g) === "limite");

  return (
    <div className="card p-5">
      <p className="label">{anyLimit ? "Metas y límites" : "Metas de esta semana"}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {withGoal.map((g) => {
          const type = goalTypeOf(g);
          const kind = kindMeta(g);
          const day = dailyGoalMin(g);
          const week = weeklyGoalMin(g);
          return (
            <div key={g.id}>
              <div className="mb-2 flex items-baseline gap-2">
                <span
                  className="h-2.5 w-2.5 translate-y-[-1px] rounded-full"
                  style={{ background: g.color }}
                />
                <span className="text-sm font-semibold">{g.name}</span>
                <span className="text-[11px] text-muted">
                  {kind.emoji} {type === "limite" ? "límite" : "meta"}
                </span>
              </div>
              <div className="space-y-3">
                {day > 0 && (
                  <GoalLine
                    label="Hoy"
                    sec={sec.today[g.id] || 0}
                    goalMin={day}
                    type={type}
                  />
                )}
                {week > 0 && (
                  <GoalLine
                    label="Esta semana"
                    sec={sec.week[g.id] || 0}
                    goalMin={week}
                    type={type}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- SESIONES */

function SessionsList({ sessions, period, rootOf, fullName, onChange }) {
  const byDay = useMemo(() => {
    const m = {};
    sessions.forEach((s) => {
      if (!m[s.local_date]) m[s.local_date] = [];
      m[s.local_date].push(s);
    });
    return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [sessions]);

  if (!sessions.length)
    return (
      <div className="card p-5">
        <p className="label">Sesiones</p>
        <Empty>No hay sesiones en este período.</Empty>
      </div>
    );

  return (
    <div className="card p-5">
      <p className="label">Sesiones ({sessions.length})</p>
      <div className="space-y-5">
        {byDay.map(([key, list]) => (
          <div key={key}>
            {period !== "day" && (
              <div className="mb-1 flex items-baseline justify-between border-b border-line/60 pb-1.5">
                <span className="text-xs font-semibold">{longDate(fromKey(key))}</span>
                <span className="tnum text-xs text-muted">
                  {fmtDur(list.reduce((a, s) => a + s.duration_seconds, 0))}
                </span>
              </div>
            )}
            <div className="divide-y divide-line/50">
              {list.map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-3 text-sm">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: rootOf(s.group_id)?.color || themeColor("surface3") }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{fullName(s.group_id)}</p>
                    <p className="text-xs text-muted">
                      {hhmm(s.started_at)}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                  </div>
                  <span className="tnum shrink-0 font-semibold">
                    {fmtDur(s.duration_seconds)}
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm("¿Borrar esta sesión?")) return;
                      await deleteSession(s.id);
                      onChange?.();
                    }}
                    className="btn-quiet shrink-0 px-2 py-0.5 text-xs hover:text-focus"
                    aria-label="Borrar sesión"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- COMPARAR */

const COMPARE_PRESETS = [
  { k: "week", l: "Esta semana" },
  { k: "lastweek", l: "Semana pasada" },
  { k: "month", l: "Este mes" },
  { k: "lastmonth", l: "Mes pasado" },
  { k: "last7", l: "Últimos 7d" },
  { k: "prev7", l: "7d previos" },
];

function RangeBox({ title, value, setValue, which, color, total, sessions, onPreset }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <p className="text-sm font-bold">{title}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="label">Desde</p>
          <input
            type="date"
            className="field"
            value={value.from}
            onChange={(e) => setValue({ ...value, from: e.target.value })}
          />
        </div>
        <div>
          <p className="label">Hasta</p>
          <input
            type="date"
            className="field"
            value={value.to}
            onChange={(e) => setValue({ ...value, to: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {COMPARE_PRESETS.map((p) => (
          <button key={p.k} onClick={() => onPreset(which, p.k)} className="chip text-[11px]">
            {p.l}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-line/60 pt-4">
        <span className="text-xs text-muted">{sessions} sesiones</span>
        <span className="tnum text-2xl font-bold" style={{ color }}>
          {fmtDur(total)}
        </span>
      </div>
    </div>
  );
}

function Compare({ groups, refreshKey }) {
  useThemeVersion();
  const thisWeek = periodRange("week", new Date());
  const lastWeek = periodRange("week", addDays(new Date(), -7));

  const [a, setA] = useState({ from: thisWeek.startKey, to: thisWeek.endKey });
  const [b, setB] = useState({ from: lastWeek.startKey, to: lastWeek.endKey });
  const [da, setDa] = useState([]);
  const [db, setDb] = useState([]);

  useEffect(() => {
    listSessions(a.from, a.to).then(setDa);
  }, [a.from, a.to, refreshKey]);
  useEffect(() => {
    listSessions(b.from, b.to).then(setDb);
  }, [b.from, b.to, refreshKey]);

  const gmap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const rootId = (id) => {
    const g = gmap[id];
    return g ? g.parent_id || g.id : "none";
  };

  const agg = (list) => {
    const m = {};
    list.forEach((s) => {
      const id = rootId(s.group_id);
      m[id] = (m[id] || 0) + s.duration_seconds;
    });
    return m;
  };

  const ma = agg(da);
  const mb = agg(db);
  const ids = Array.from(new Set([...Object.keys(ma), ...Object.keys(mb)]));

  const chart = ids.map((id) => ({
    name: gmap[id]?.name || "Sin grupo",
    A: toHours(ma[id] || 0),
    B: toHours(mb[id] || 0),
    secA: ma[id] || 0,
    secB: mb[id] || 0,
  }));

  const totA = da.reduce((x, s) => x + s.duration_seconds, 0);
  const totB = db.reduce((x, s) => x + s.duration_seconds, 0);

  const preset = (which, kind) => {
    const now = new Date();
    let r;
    if (kind === "week") r = periodRange("week", now);
    if (kind === "lastweek") r = periodRange("week", addDays(now, -7));
    if (kind === "month") r = periodRange("month", now);
    if (kind === "lastmonth") r = periodRange("month", new Date(now.getFullYear(), now.getMonth() - 1, 1));
    if (kind === "last7") r = { startKey: toKey(addDays(now, -6)), endKey: todayKey() };
    if (kind === "prev7") r = { startKey: toKey(addDays(now, -13)), endKey: toKey(addDays(now, -7)) };
    const v = { from: r.startKey, to: r.endKey };
    which === "a" ? setA(v) : setB(v);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <RangeBox
          title="Período A"
          value={a}
          setValue={setA}
          which="a"
          color={themeColor("accent")}
          total={totA}
          sessions={da.length}
          onPreset={preset}
        />
        <RangeBox
          title="Período B"
          value={b}
          setValue={setB}
          which="b"
          color={themeColor("accent2")}
          total={totB}
          sessions={db.length}
          onPreset={preset}
        />
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label mb-0">A vs B por grupo</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Diferencia</span>
            <span
              className="tnum font-bold"
              style={{ color: themeColor(totA >= totB ? "rest" : "focus") }}
            >
              {totA >= totB ? "+" : "−"}
              {fmtDur(Math.abs(totA - totB))}
            </span>
            <Delta value={pctDelta(totA, totB)} />
          </div>
        </div>
        <div className="mt-4 h-[300px]">
          {chart.length === 0 ? (
            <Empty>No hay datos en ninguno de los dos períodos.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} unit="h" />
                <Tooltip
                  cursor={{ fill: themeColorA("ink", 0.05) }}
                  contentStyle={tooltipStyle}
                  formatter={(v, n, p) => [fmtDur(n === "A" ? p.payload.secA : p.payload.secB), n === "A" ? "Período A" : "Período B"]}
                />
                <Legend formatter={(v) => <span style={legendStyle()}>{v === "A" ? "Período A" : "Período B"}</span>} />
                <RBar dataKey="A" fill={themeColor("accent")} radius={[4, 4, 0, 0]} maxBarSize={34} />
                <RBar dataKey="B" fill={themeColor("accent2")} radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- SUEÑO VS RENDIMIENTO */

/**
 * Acá solo entra el tiempo productivo: cruzar el sueño contra las horas de
 * PlayStation no dice nada útil (y además ensuciaría la correlación).
 */
function SleepVsStudy({ sleep, groups, refreshKey }) {
  useThemeVersion();
  const [span, setSpan] = useState(30);
  const [sessions, setSessions] = useState([]);

  const startKey = toKey(addDays(new Date(), -(span - 1)));
  const endKey = todayKey();

  useEffect(() => {
    listSessions(startKey, endKey).then(setSessions);
  }, [startKey, endKey, refreshKey]);

  const gmap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);

  const data = useMemo(() => {
    const study = {};
    sessions.forEach((s) => {
      const g = gmap[s.group_id];
      const root = g?.parent_id ? gmap[g.parent_id] || g : g;
      if (kindOf(root) !== "productivo") return;
      study[s.local_date] = (study[s.local_date] || 0) + s.duration_seconds;
    });
    const sl = {};
    sleep.forEach((s) => (sl[s.local_date] = Number(s.hours)));
    return eachDayKey(startKey, endKey).map((k) => ({
      key: k,
      label: shortDate(fromKey(k)),
      productivo: toHours(study[k] || 0),
      sueno: sl[k] ?? null,
      sec: study[k] || 0,
    }));
  }, [sessions, sleep, gmap, startKey, endKey]);

  const paired = data.filter((d) => d.sueno !== null && d.sueno > 0);
  const r = pearson(paired.map((d) => d.sueno), paired.map((d) => d.productivo));

  const buckets = useMemo(() => {
    const defs = [
      { label: "< 6 h", test: (h) => h < 6, color: themeColor("focus") },
      { label: "6 – 7 h", test: (h) => h >= 6 && h < 7, color: "#fb923c" },
      { label: "7 – 8 h", test: (h) => h >= 7 && h < 8, color: "#fbbf24" },
      { label: "≥ 8 h", test: (h) => h >= 8, color: themeColor("rest") },
    ];
    return defs.map((d) => {
      const rows = paired.filter((p) => d.test(p.sueno));
      const avg = rows.length
        ? Math.round((rows.reduce((a, b) => a + b.productivo, 0) / rows.length) * 100) / 100
        : 0;
      return { ...d, avg, n: rows.length };
    });
  }, [paired]);

  const best = buckets.filter((b) => b.n > 0).sort((a, b) => b.avg - a.avg)[0];

  const reading =
    r === null
      ? "Cargá al menos 3 noches con tiempo productivo el mismo día para calcular la correlación."
      : r > 0.4
      ? "Correlación positiva clara: los días que dormís más, rendís más."
      : r > 0.15
      ? "Correlación positiva leve: dormir mejor parece ayudarte un poco."
      : r > -0.15
      ? "Sin relación clara entre tus horas de sueño y tu tiempo productivo."
      : r > -0.4
      ? "Correlación negativa leve: los días que más producís, dormís algo menos."
      : "Correlación negativa clara: estás recortando sueño para meterle más horas.";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">Sueño vs. productividad</h3>
          <p className="text-sm text-muted">
            Cruza tus horas de sueño con las horas productivas de ese mismo día
            (el despeje y el gimnasio no cuentan acá).
          </p>
        </div>
        <Segmented
          value={span}
          onChange={setSpan}
          options={[
            { value: 14, label: "14d" },
            { value: 30, label: "30d" },
            { value: 90, label: "90d" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Correlación (r)"
          value={r === null ? "—" : r}
          sub={`${paired.length} días con ambos datos`}
          accent={r === null ? undefined : themeColor(r > 0.15 ? "rest" : r < -0.15 ? "focus" : "muted")}
        />
        <Stat
          label="Tu mejor franja de sueño"
          value={best && best.n ? best.label : "—"}
          sub={best && best.n ? `${best.avg} h productivas promedio` : "sin datos"}
          accent={best?.color}
        />
        <Stat
          label="Días registrados"
          value={paired.length}
          sub={`de ${span} días`}
        />
      </div>

      <div className="card p-5">
        <p className="label">Día a día</p>
        <div className="h-[300px]">
          {paired.length === 0 ? (
            <Empty>Todavía no hay suficientes datos.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} unit="h" />
                <Tooltip
                  cursor={{ fill: themeColorA("ink", 0.05) }}
                  contentStyle={tooltipStyle}
                  formatter={(v, n) => [
                    v === null ? "—" : `${v} h`,
                    n === "productivo" ? "Productivo" : "Sueño",
                  ]}
                />
                <Legend
                  formatter={(v) => (
                    <span style={legendStyle()}>
                      {v === "productivo" ? "Productivo" : "Sueño"}
                    </span>
                  )}
                />
                <RBar dataKey="productivo" fill={themeColor("accent")} radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Line
                  type="monotone"
                  dataKey="sueno"
                  stroke={themeColor("accent2")}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: themeColor("accent2") }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-3 rounded-xl border border-line bg-surface2/50 p-3 text-sm text-muted">
          {reading}
        </p>
      </div>

      <div className="card p-5">
        <p className="label">Horas productivas promedio según cuánto dormiste</p>
        <div className="mt-3 space-y-3">
          {buckets.map((b) => (
            <div key={b.label}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium">{b.label}</span>
                <span className="tnum text-muted">
                  {b.n ? `${b.avg} h · ${b.n} ${b.n === 1 ? "día" : "días"}` : "sin datos"}
                </span>
              </div>
              <ProgressBar
                pct={best?.avg ? (b.avg / best.avg) * 100 : 0}
                color={b.color}
                height={7}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
