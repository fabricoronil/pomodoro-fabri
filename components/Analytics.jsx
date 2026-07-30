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
  Pie,
  PieChart,
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
  pctDelta,
  pearson,
  periodRange,
  shiftAnchor,
  shortDate,
  todayKey,
  toHours,
  toKey,
} from "@/lib/utils";
import { Bar as ProgressBar, Delta, Empty, Segmented, Stat } from "./ui";

const tooltipStyle = {
  background: "#141821",
  border: "1px solid #262c3d",
  borderRadius: 12,
  fontSize: 12,
};

const PERIODS = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "year", label: "Año" },
];

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function Analytics({ groups, refreshKey, onChange }) {
  const [period, setPeriod] = useState("week");
  const [anchor, setAnchor] = useState(new Date());
  const [sessions, setSessions] = useState([]);
  const [prevSessions, setPrevSessions] = useState([]);
  const [sleep, setSleep] = useState([]);
  const [drill, setDrill] = useState(null); // id de grupo raíz
  const [tab, setTab] = useState("resumen");
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const prevRange = useMemo(
    () => periodRange(period, shiftAnchor(period, anchor, -1)),
    [period, anchor]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      listSessions(range.startKey, range.endKey),
      listSessions(prevRange.startKey, prevRange.endKey),
      listSleep(),
    ])
      .then(([a, b, c]) => {
        if (!alive) return;
        setSessions(a);
        setPrevSessions(b);
        setSleep(c);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range.startKey, range.endKey, prevRange.startKey, prevRange.endKey, refreshKey]);

  const gmap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const rootOf = (id) => {
    const g = gmap[id];
    if (!g) return null;
    return g.parent_id ? gmap[g.parent_id] || g : g;
  };
  const nameOf = (id) => gmap[id]?.name || "Sin grupo";
  const fullName = (id) => {
    const g = gmap[id];
    if (!g) return "Sin grupo";
    return g.parent_id ? `${gmap[g.parent_id]?.name || "?"} · ${g.name}` : g.name;
  };

  const totalSec = sessions.reduce((a, s) => a + s.duration_seconds, 0);
  const prevSec = prevSessions.reduce((a, s) => a + s.duration_seconds, 0);

  // ------- por grupo raíz -------
  const byRoot = useMemo(() => {
    const m = {};
    sessions.forEach((s) => {
      const r = rootOf(s.group_id);
      const id = r?.id || "none";
      if (!m[id]) m[id] = { id, name: r?.name || "Sin grupo", color: r?.color || "#3a4360", sec: 0, count: 0 };
      m[id].sec += s.duration_seconds;
      m[id].count++;
    });
    return Object.values(m).sort((a, b) => b.sec - a.sec);
  }, [sessions, gmap]);

  const bySub = useMemo(() => {
    if (!drill) return [];
    const m = {};
    sessions.forEach((s) => {
      const r = rootOf(s.group_id);
      if (r?.id !== drill) return;
      const g = gmap[s.group_id];
      const id = s.group_id;
      const label = g?.parent_id ? g.name : "General";
      if (!m[id]) m[id] = { id, name: label, color: g?.color || "#3a4360", sec: 0, count: 0 };
      m[id].sec += s.duration_seconds;
      m[id].count++;
    });
    return Object.values(m).sort((a, b) => b.sec - a.sec);
  }, [sessions, drill, gmap]);

  // ------- serie temporal -------
  const series = useMemo(() => {
    if (period === "day") {
      const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${h}h`, sec: 0 }));
      sessions.forEach((s) => {
        const h = new Date(s.started_at).getHours();
        hours[h].sec += s.duration_seconds;
      });
      return hours.map((h) => ({ ...h, horas: toHours(h.sec) }));
    }
    if (period === "year") {
      const months = Array.from({ length: 12 }, (_, m) => ({
        label: new Date(2020, m, 1).toLocaleDateString("es-AR", { month: "short" }),
        sec: 0,
      }));
      sessions.forEach((s) => {
        const m = fromKey(s.local_date).getMonth();
        months[m].sec += s.duration_seconds;
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
        label:
          period === "week"
            ? DOW[(d.getDay() + 6) % 7]
            : d.getDate().toString(),
        sec: m[k],
        horas: toHours(m[k]),
      };
    });
  }, [sessions, period, range]);

  const activeDays = useMemo(
    () => new Set(sessions.map((s) => s.local_date)).size,
    [sessions]
  );
  const bestDay = useMemo(() => {
    const m = {};
    sessions.forEach((s) => (m[s.local_date] = (m[s.local_date] || 0) + s.duration_seconds));
    const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    return e ? { key: e[0], sec: e[1] } : null;
  }, [sessions]);

  const daysInRange = eachDayKey(range.startKey, range.endKey).length;
  const avgPerDay = daysInRange ? totalSec / daysInRange : 0;

  const isCurrent = useMemo(() => {
    const now = periodRange(period, new Date());
    return now.startKey === range.startKey;
  }, [period, range]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ---------- cabecera ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={period} onChange={setPeriod} options={PERIODS} />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnchor(shiftAnchor(period, anchor, -1))}
            className="btn-ghost px-3 py-2"
          >
            ‹
          </button>
          <span className="min-w-[190px] text-center text-sm font-semibold">{range.label}</span>
          <button
            onClick={() => setAnchor(shiftAnchor(period, anchor, 1))}
            disabled={isCurrent}
            className="btn-ghost px-3 py-2"
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

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "resumen", label: "Resumen" },
          { value: "comparar", label: "Comparar fechas" },
          { value: "sueno", label: "Sueño vs estudio" },
          { value: "sesiones", label: "Sesiones" },
        ]}
      />

      {tab === "resumen" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Tiempo total"
              value={fmtDur(totalSec)}
              sub={`vs. ${fmtDur(prevSec)} el período anterior`}
              right={<Delta value={pctDelta(totalSec, prevSec)} />}
            />
            <Stat
              label="Sesiones"
              value={sessions.length}
              sub={
                sessions.length
                  ? `promedio ${fmtDur(totalSec / sessions.length)} c/u`
                  : "sin sesiones"
              }
              right={<Delta value={pctDelta(sessions.length, prevSessions.length)} />}
            />
            <Stat
              label="Promedio por día"
              value={fmtDur(avgPerDay)}
              sub={`${activeDays} de ${daysInRange} días activos`}
            />
            <Stat
              label="Mejor día"
              value={bestDay ? fmtDur(bestDay.sec) : "—"}
              sub={bestDay ? shortDate(fromKey(bestDay.key)) : ""}
              accent="#34d399"
            />
          </div>

          <div className="card p-5">
            <p className="label">
              {period === "day"
                ? "Distribución por hora"
                : period === "year"
                ? "Por mes"
                : "Por día"}
            </p>
            <div className="h-[280px]">
              {totalSec === 0 && !loading ? (
                <Empty>No hay sesiones en este período.</Empty>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickLine={false} axisLine={false} unit="h" />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,.04)" }}
                      contentStyle={tooltipStyle}
                      formatter={(v, n, p) => [fmtDur(p.payload.sec), "Estudio"]}
                    />
                    <RBar dataKey="horas" radius={[6, 6, 0, 0]} maxBarSize={40} fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <p className="label">Reparto por grupo</p>
              {byRoot.length === 0 ? (
                <Empty>Sin datos.</Empty>
              ) : (
                <>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byRoot}
                          dataKey="sec"
                          nameKey="name"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {byRoot.map((d) => (
                            <Cell key={d.id} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtDur(v)} />
                        <Legend
                          verticalAlign="bottom"
                          formatter={(v) => <span style={{ color: "#8e95ad", fontSize: 12 }}>{v}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-3">
                    {byRoot.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setDrill(drill === g.id ? null : g.id)}
                        className="block w-full text-left"
                      >
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium">
                            {g.name}
                            <span className="ml-1.5 text-xs text-muted">({g.count})</span>
                          </span>
                          <span className="tnum text-muted">
                            {fmtDur(g.sec)} · {Math.round((g.sec / totalSec) * 100)}%
                          </span>
                        </div>
                        <ProgressBar pct={(g.sec / totalSec) * 100} color={g.color} height={6} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between">
                <p className="label mb-0">
                  {drill ? `Subgrupos · ${nameOf(drill)}` : "Subgrupos"}
                </p>
                {drill && (
                  <button onClick={() => setDrill(null)} className="btn-quiet px-2 py-1 text-xs">
                    limpiar
                  </button>
                )}
              </div>
              {!drill ? (
                <Empty>Tocá un grupo de la izquierda para ver el detalle.</Empty>
              ) : bySub.length === 0 ? (
                <Empty>Sin sesiones de este grupo.</Empty>
              ) : (
                <div className="mt-4 space-y-3">
                  {bySub.map((s) => {
                    const tot = bySub.reduce((a, b) => a + b.sec, 0);
                    return (
                      <div key={s.id}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium">{s.name}</span>
                          <span className="tnum text-muted">
                            {fmtDur(s.sec)} · {Math.round((s.sec / tot) * 100)}%
                          </span>
                        </div>
                        <ProgressBar pct={(s.sec / tot) * 100} color={s.color} height={6} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <GoalsPanel groups={groups} />
        </>
      )}

      {tab === "comparar" && <Compare groups={groups} refreshKey={refreshKey} />}

      {tab === "sueno" && <SleepVsStudy sleep={sleep} refreshKey={refreshKey} />}

      {tab === "sesiones" && (
        <div className="card p-5">
          <p className="label">Sesiones del período ({sessions.length})</p>
          {sessions.length === 0 ? (
            <Empty>No hay sesiones.</Empty>
          ) : (
            <div className="divide-y divide-line/60">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-3 text-sm">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: rootOf(s.group_id)?.color || "#3a4360" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{fullName(s.group_id)}</p>
                    <p className="text-xs text-muted">
                      {shortDate(fromKey(s.local_date))} ·{" "}
                      {new Date(s.started_at).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                  </div>
                  <span className="tnum shrink-0 font-semibold">{fmtDur(s.duration_seconds)}</span>
                  <button
                    onClick={async () => {
                      if (!confirm("¿Borrar esta sesión?")) return;
                      await deleteSession(s.id);
                      onChange?.();
                    }}
                    className="btn-quiet shrink-0 px-2 py-0.5 text-xs hover:text-focus"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ METAS */

function GoalsPanel({ groups }) {
  const [weekSec, setWeekSec] = useState({});
  const withGoal = groups.filter((g) => !g.parent_id && (g.weekly_goal_minutes || 0) > 0);

  useEffect(() => {
    const r = periodRange("week", new Date());
    listSessions(r.startKey, r.endKey).then((ss) => {
      const gmap = Object.fromEntries(groups.map((g) => [g.id, g]));
      const m = {};
      ss.forEach((s) => {
        const g = gmap[s.group_id];
        const rootId = g?.parent_id || g?.id;
        if (rootId) m[rootId] = (m[rootId] || 0) + s.duration_seconds;
      });
      setWeekSec(m);
    });
  }, [groups]);

  if (!withGoal.length) return null;

  return (
    <div className="card p-5">
      <p className="label">Metas de esta semana</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {withGoal.map((g) => {
          const sec = weekSec[g.id] || 0;
          const pct = (sec / 60 / g.weekly_goal_minutes) * 100;
          return (
            <div key={g.id}>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="font-medium">{g.name}</span>
                <span className="tnum text-muted">
                  {fmtDur(sec)} / {Math.round((g.weekly_goal_minutes / 60) * 10) / 10}h
                </span>
              </div>
              <ProgressBar pct={pct} color={g.color} />
              <p className="mt-1 text-[11px] text-muted">
                {pct >= 100
                  ? "✓ Meta cumplida"
                  : `${Math.round(pct)}% · faltan ${fmtDur(g.weekly_goal_minutes * 60 - sec)}`}
              </p>
            </div>
          );
        })}
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
          color="#8b5cf6"
          total={totA}
          sessions={da.length}
          onPreset={preset}
        />
        <RangeBox
          title="Período B"
          value={b}
          setValue={setB}
          which="b"
          color="#22d3ee"
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
              style={{ color: totA >= totB ? "#34d399" : "#f0616d" }}
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
                  cursor={{ fill: "rgba(255,255,255,.04)" }}
                  contentStyle={tooltipStyle}
                  formatter={(v, n, p) => [fmtDur(n === "A" ? p.payload.secA : p.payload.secB), n === "A" ? "Período A" : "Período B"]}
                />
                <Legend formatter={(v) => <span style={{ color: "#8e95ad", fontSize: 12 }}>{v === "A" ? "Período A" : "Período B"}</span>} />
                <RBar dataKey="A" fill="#8b5cf6" radius={[6, 6, 0, 0]} maxBarSize={34} />
                <RBar dataKey="B" fill="#22d3ee" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- SUEÑO VS ESTUDIO */

function SleepVsStudy({ sleep, refreshKey }) {
  const [span, setSpan] = useState(30);
  const [sessions, setSessions] = useState([]);

  const startKey = toKey(addDays(new Date(), -(span - 1)));
  const endKey = todayKey();

  useEffect(() => {
    listSessions(startKey, endKey).then(setSessions);
  }, [startKey, endKey, refreshKey]);

  const data = useMemo(() => {
    const study = {};
    sessions.forEach((s) => {
      study[s.local_date] = (study[s.local_date] || 0) + s.duration_seconds;
    });
    const sl = {};
    sleep.forEach((s) => (sl[s.local_date] = Number(s.hours)));
    return eachDayKey(startKey, endKey).map((k) => ({
      key: k,
      label: shortDate(fromKey(k)),
      estudio: toHours(study[k] || 0),
      sueno: sl[k] ?? null,
      sec: study[k] || 0,
    }));
  }, [sessions, sleep, startKey, endKey]);

  const paired = data.filter((d) => d.sueno !== null && d.sueno > 0);
  const r = pearson(paired.map((d) => d.sueno), paired.map((d) => d.estudio));

  const buckets = useMemo(() => {
    const defs = [
      { label: "< 6 h", test: (h) => h < 6, color: "#f0616d" },
      { label: "6 – 7 h", test: (h) => h >= 6 && h < 7, color: "#fb923c" },
      { label: "7 – 8 h", test: (h) => h >= 7 && h < 8, color: "#fbbf24" },
      { label: "≥ 8 h", test: (h) => h >= 8, color: "#34d399" },
    ];
    return defs.map((d) => {
      const rows = paired.filter((p) => d.test(p.sueno));
      const avg = rows.length
        ? Math.round((rows.reduce((a, b) => a + b.estudio, 0) / rows.length) * 100) / 100
        : 0;
      return { ...d, avg, n: rows.length };
    });
  }, [paired]);

  const best = buckets.filter((b) => b.n > 0).sort((a, b) => b.avg - a.avg)[0];

  const reading =
    r === null
      ? "Cargá al menos 3 noches con estudio el mismo día para calcular la correlación."
      : r > 0.4
      ? "Correlación positiva clara: los días que dormís más, estudiás más."
      : r > 0.15
      ? "Correlación positiva leve: dormir mejor parece ayudarte un poco."
      : r > -0.15
      ? "Sin relación clara entre tus horas de sueño y tu tiempo de estudio."
      : r > -0.4
      ? "Correlación negativa leve: los días que estudiás más, dormís algo menos."
      : "Correlación negativa clara: estás recortando sueño para estudiar más.";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">Sueño vs. productividad</h3>
          <p className="text-sm text-muted">
            Cruza tus horas de sueño con las horas de estudio de ese mismo día.
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
          accent={r === null ? undefined : r > 0.15 ? "#34d399" : r < -0.15 ? "#f0616d" : "#8e95ad"}
        />
        <Stat
          label="Tu mejor franja de sueño"
          value={best && best.n ? best.label : "—"}
          sub={best && best.n ? `${best.avg} h de estudio promedio` : "sin datos"}
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
                  cursor={{ fill: "rgba(255,255,255,.04)" }}
                  contentStyle={tooltipStyle}
                  formatter={(v, n) => [v === null ? "—" : `${v} h`, n === "estudio" ? "Estudio" : "Sueño"]}
                />
                <Legend
                  formatter={(v) => (
                    <span style={{ color: "#8e95ad", fontSize: 12 }}>
                      {v === "estudio" ? "Estudio" : "Sueño"}
                    </span>
                  )}
                />
                <RBar dataKey="estudio" fill="#8b5cf6" radius={[6, 6, 0, 0]} maxBarSize={26} />
                <Line
                  type="monotone"
                  dataKey="sueno"
                  stroke="#22d3ee"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "#22d3ee" }}
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
        <p className="label">Horas de estudio promedio según cuánto dormiste</p>
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
