"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listSleep, upsertSleep, deleteSleep } from "@/lib/db";
import {
  addDays,
  eachDayKey,
  fromKey,
  shortDate,
  sleepHours,
  todayKey,
  toKey,
} from "@/lib/utils";
import { Empty, Stat, Segmented } from "./ui";

const IDEAL = 8;

const colorFor = (h) =>
  h >= 7.5 ? "#34d399" : h >= 6.5 ? "#fbbf24" : h > 0 ? "#f0616d" : "#2a3145";

export default function Sleep({ onChange }) {
  const [logs, setLogs] = useState([]);
  const [span, setSpan] = useState(14);
  const [dateKey, setDateKey] = useState(todayKey());
  const [bed, setBed] = useState("23:30");
  const [wake, setWake] = useState("07:30");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const formRef = useRef(null);

  const load = async () => setLogs(await listSleep());

  useEffect(() => {
    load();
  }, []);

  // al cambiar de fecha, precargar lo que ya haya guardado ese día
  useEffect(() => {
    const found = logs.find((l) => l.local_date === dateKey);
    if (found) {
      setBed(found.bed_time || "23:30");
      setWake(found.wake_time || "07:30");
      setNote(found.note || "");
    } else {
      setNote("");
    }
  }, [dateKey, logs]);

  const hours = sleepHours(bed, wake);

  const save = async () => {
    if (!hours) return;
    setSaving(true);
    try {
      await upsertSleep({
        local_date: dateKey,
        bed_time: bed,
        wake_time: wake,
        hours,
        note: note.trim() || null,
      });
      await load();
      onChange?.();
      setMsg("Guardado");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg("Error: " + (e.message || e));
      setTimeout(() => setMsg(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("¿Borrar este registro?")) return;
    await deleteSleep(id);
    await load();
    onChange?.();
  };

  const byDate = useMemo(() => {
    const m = {};
    logs.forEach((l) => (m[l.local_date] = l));
    return m;
  }, [logs]);

  const chartData = useMemo(() => {
    const end = todayKey();
    const start = toKey(addDays(new Date(), -(span - 1)));
    return eachDayKey(start, end).map((k) => ({
      key: k,
      label: shortDate(fromKey(k)),
      hours: byDate[k]?.hours ? Number(byDate[k].hours) : 0,
    }));
  }, [byDate, span]);

  const avg = (n) => {
    const vals = chartData.slice(-n).map((d) => d.hours).filter((h) => h > 0);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const avg7 = avg(7);
  const avgSpan = avg(span);
  const debt = useMemo(() => {
    const vals = chartData.slice(-7).filter((d) => d.hours > 0);
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, d) => a + (IDEAL - d.hours), 0) * 10) / 10;
  }, [chartData]);
  const streak = useMemo(() => {
    let n = 0;
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].hours >= 7) n++;
      else break;
    }
    return n;
  }, [chartData]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Sueño</h2>
        <p className="text-sm text-muted">
          Anotá a qué hora te acostaste y a qué hora te despertaste. La fecha es el día en
          que te levantaste.
        </p>
      </div>

      <TodayCard
        log={byDate[todayKey()]}
        onLoad={() => {
          setDateKey(todayKey());
          formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Promedio 7 días"
          value={avg7 ? `${avg7} h` : "—"}
          sub={avg7 ? (avg7 >= 7.5 ? "Vas bien" : avg7 >= 6.5 ? "Justito" : "Estás durmiendo poco") : "Sin datos"}
          accent={avg7 ? colorFor(avg7) : undefined}
        />
        <Stat label={`Promedio ${span} días`} value={avgSpan ? `${avgSpan} h` : "—"} />
        <Stat
          label="Deuda de sueño (7d)"
          value={debt === null ? "—" : `${debt > 0 ? "+" : ""}${debt} h`}
          sub={debt === null ? "" : debt > 0 ? `vs. ${IDEAL}h por noche` : "Estás al día"}
          accent={debt !== null && debt > 3 ? "#f0616d" : "#34d399"}
        />
        <Stat label="Racha ≥7h" value={`${streak} ${streak === 1 ? "día" : "días"}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div ref={formRef} className="card p-5">
          <p className="label">Fecha (día que te levantaste)</p>
          <input
            type="date"
            className="field"
            value={dateKey}
            max={todayKey()}
            onChange={(e) => setDateKey(e.target.value)}
          />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="label">Me acosté</p>
              <input type="time" className="field" value={bed} onChange={(e) => setBed(e.target.value)} />
            </div>
            <div>
              <p className="label">Me desperté</p>
              <input type="time" className="field" value={wake} onChange={(e) => setWake(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface2/60 p-4 text-center">
            <p className="text-[11px] uppercase tracking-[.14em] text-muted">Dormiste</p>
            <p className="tnum text-3xl font-bold" style={{ color: colorFor(hours || 0) }}>
              {hours ? `${hours} h` : "—"}
            </p>
          </div>

          <p className="label mt-4">Nota (opcional)</p>
          <input
            className="field"
            placeholder="Ej: me desperté 2 veces"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button onClick={save} disabled={saving || !hours} className="btn-primary mt-4 w-full py-3">
            {byDate[dateKey] ? "Actualizar registro" : "Guardar"}
          </button>
          {msg && <p className="mt-2 text-center text-xs font-semibold text-rest">{msg}</p>}
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="label mb-0">Últimos días</p>
            <Segmented
              value={span}
              onChange={setSpan}
              options={[
                { value: 7, label: "7d" },
                { value: 14, label: "14d" },
                { value: 30, label: "30d" },
              ]}
            />
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} domain={[0, 12]} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,.04)" }}
                  contentStyle={{
                    background: "#141821",
                    border: "1px solid #262c3d",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${v} h`, "Sueño"]}
                />
                <ReferenceLine y={IDEAL} stroke="#8b5cf6" strokeDasharray="4 4" />
                <RBar dataKey="hours" radius={[6, 6, 0, 0]} maxBarSize={34}>
                  {chartData.map((d) => (
                    <Cell key={d.key} fill={colorFor(d.hours)} />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <p className="label">Historial</p>
        {logs.length === 0 ? (
          <Empty>Todavía no cargaste ninguna noche.</Empty>
        ) : (
          <div className="divide-y divide-line/60">
            {logs.slice(0, 30).map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: colorFor(Number(l.hours)) }}
                />
                <span className="w-28 shrink-0 text-muted">{shortDate(fromKey(l.local_date))}</span>
                <span className="tnum w-16 shrink-0 font-semibold">{l.hours} h</span>
                <span className="tnum w-32 shrink-0 text-muted">
                  {l.bed_time} → {l.wake_time}
                </span>
                <span className="flex-1 truncate text-muted">{l.note}</span>
                <button
                  onClick={() => remove(l.id)}
                  className="btn-quiet shrink-0 px-2 py-1 text-xs hover:text-focus"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TodayCard({ log, onLoad }) {
  const hours = log?.hours ? Number(log.hours) : null;
  const c = colorFor(hours || 0);

  if (!hours) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-4 border-accent/30 bg-accent/[0.06] p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted">
            Sueño de hoy
          </p>
          <p className="mt-1 text-lg font-bold">Todavía no lo cargaste</p>
          <p className="text-sm text-muted">
            Anotá a qué hora te acostaste anoche y a qué hora te despertaste.
          </p>
        </div>
        <button onClick={onLoad} className="btn-primary shrink-0 px-5 py-3">
          Cargar ahora
        </button>
      </div>
    );
  }

  const verdict =
    hours >= 7.5
      ? "Dormiste bien. Buen día para exigirte."
      : hours >= 6.5
      ? "Justito. Bajá un cambio si te cuesta concentrarte."
      : "Dormiste poco. Ojo con encadenar pomodoros largos hoy.";

  return (
    <div
      className="card flex flex-wrap items-center justify-between gap-5 p-5"
      style={{ borderColor: `${c}55`, background: `${c}0f` }}
    >
      <div className="flex items-center gap-5">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted">
            Sueño de hoy
          </p>
          <p className="tnum text-4xl font-bold leading-tight" style={{ color: c }}>
            {hours} h
          </p>
        </div>
        <div className="h-12 w-px bg-line" />
        <div className="text-sm">
          <p className="tnum font-semibold">
            {log.bed_time} → {log.wake_time}
          </p>
          <p className="mt-0.5 text-muted">{verdict}</p>
          {log.note && <p className="mt-1 text-xs text-muted/80">“{log.note}”</p>}
        </div>
      </div>
      <button onClick={onLoad} className="btn-ghost shrink-0">
        Editar
      </button>
    </div>
  );
}
