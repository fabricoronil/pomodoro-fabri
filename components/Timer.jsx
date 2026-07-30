"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSession, updateSession } from "@/lib/db";
import { fmtClock, fmtDur, todayKey } from "@/lib/utils";
import { Modal, Bar } from "./ui";

const TIMER_KEY = "pf.timer";

const MODES = {
  focus: { label: "Enfoque", color: "#f0616d", short: "Enfoque" },
  short: { label: "Descanso", color: "#34d399", short: "Descanso" },
  long: { label: "Descanso largo", color: "#38bdf8", short: "Pausa larga" },
};

function beep(volume = 0.5, times = 3) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const t = now + i * 0.42;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(i === times - 1 ? 1046 : 784, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume), t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    }
    setTimeout(() => ctx.close(), times * 500 + 400);
  } catch {
    /* sin audio disponible */
  }
}

function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon.png", tag: "pomodoro" });
    }
  } catch {
    /* noop */
  }
}

export default function Timer({ groups, settings, onSaved, todaySec, weekByGroup }) {
  const parents = useMemo(() => groups.filter((g) => !g.parent_id && !g.archived), [groups]);

  const [mode, setMode] = useState("focus");
  const [running, setRunning] = useState(false);
  const [endAt, setEndAt] = useState(null);
  const [remaining, setRemaining] = useState(settings.focusMin * 60);
  const [startedAt, setStartedAt] = useState(null);
  const [cycle, setCycle] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [subId, setSubId] = useState("");
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");
  const restored = useRef(false);

  const durationOf = useCallback(
    (m) =>
      (m === "focus" ? settings.focusMin : m === "short" ? settings.shortMin : settings.longMin) *
      60,
    [settings]
  );

  const subs = useMemo(
    () => groups.filter((g) => g.parent_id === groupId && !g.archived),
    [groups, groupId]
  );

  // ---------- restaurar estado del timer tras un refresh ----------
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setMode(s.mode || "focus");
        setCycle(s.cycle || 0);
        setGroupId(s.groupId || "");
        setSubId(s.subId || "");
        if (s.running && s.endAt && s.endAt > Date.now()) {
          setEndAt(s.endAt);
          setStartedAt(s.startedAt);
          setRemaining((s.endAt - Date.now()) / 1000);
          setRunning(true);
          return;
        }
        setRemaining(s.remaining ?? durationOf(s.mode || "focus"));
      }
    } catch {
      /* noop */
    }
  }, [durationOf]);

  // ---------- primer grupo por defecto ----------
  useEffect(() => {
    if (!groupId && parents.length) setGroupId(parents[0].id);
  }, [parents, groupId]);

  const prevGroup = useRef(null);
  useEffect(() => {
    if (prevGroup.current !== null && prevGroup.current !== groupId) setSubId("");
    prevGroup.current = groupId;
  }, [groupId]);

  // ---------- persistir ----------
  useEffect(() => {
    if (!restored.current) return;
    localStorage.setItem(
      TIMER_KEY,
      JSON.stringify({ mode, running, endAt, remaining, startedAt, cycle, groupId, subId })
    );
  }, [mode, running, endAt, remaining, startedAt, cycle, groupId, subId]);

  // ---------- si cambian las duraciones y está parado ----------
  useEffect(() => {
    if (!running) setRemaining(durationOf(mode));
  }, [settings.focusMin, settings.shortMin, settings.longMin]); // eslint-disable-line

  const activeGroupId = subId || groupId;
  const duration = durationOf(mode);
  const progress = duration > 0 ? 1 - remaining / duration : 0;

  const finish = useCallback(
    async (completed) => {
      const elapsed = completed ? duration : duration - remaining;
      const wasFocus = mode === "focus";
      setRunning(false);
      setEndAt(null);

      if (settings.sound) beep(settings.volume, completed ? 3 : 1);

      let saved = null;
      if (wasFocus && elapsed >= 60 && activeGroupId) {
        try {
          saved = await createSession({
            group_id: activeGroupId,
            mode: "focus",
            started_at: new Date(startedAt || Date.now() - elapsed * 1000).toISOString(),
            ended_at: new Date().toISOString(),
            duration_seconds: elapsed,
            local_date: todayKey(),
          });
          onSaved?.();
          setFlash(`Guardado · ${fmtDur(elapsed)}`);
          setTimeout(() => setFlash(""), 3200);
        } catch (e) {
          setFlash("Error al guardar: " + (e.message || e));
          setTimeout(() => setFlash(""), 5000);
        }
      }

      if (completed && settings.notifications) {
        notify(
          wasFocus ? "Pomodoro completado" : "Descanso terminado",
          wasFocus ? "Tomate un respiro, Fabri." : "Dale, volvé a la carga."
        );
      }

      // siguiente modo
      let next = "focus";
      let nextCycle = cycle;
      if (wasFocus) {
        nextCycle = cycle + 1;
        next = nextCycle % Math.max(1, settings.longEvery) === 0 ? "long" : "short";
      }
      setCycle(nextCycle);
      setMode(next);
      setRemaining(durationOf(next));

      if (completed) {
        const auto = next === "focus" ? settings.autoStartFocus : settings.autoStartBreaks;
        if (auto) {
          const end = Date.now() + durationOf(next) * 1000;
          setStartedAt(Date.now());
          setEndAt(end);
          setRunning(true);
        }
      }

      if (saved && settings.askNote) {
        setNote("");
        setNoteFor(saved.id);
      }
    },
    [
      activeGroupId,
      cycle,
      duration,
      durationOf,
      mode,
      onSaved,
      remaining,
      settings,
      startedAt,
    ]
  );

  // ---------- tick ----------
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  useEffect(() => {
    if (!running || !endAt) return;
    const id = setInterval(() => {
      const left = (endAt - Date.now()) / 1000;
      if (left <= 0) {
        setRemaining(0);
        finishRef.current(true);
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, endAt]);

  // ---------- título de la pestaña ----------
  useEffect(() => {
    document.title = running
      ? `${fmtClock(remaining)} · ${MODES[mode].short}`
      : "Pomodoro · Fabri";
  }, [remaining, running, mode]);

  const start = () => {
    if (settings.notifications && typeof Notification !== "undefined") {
      if (Notification.permission === "default") Notification.requestPermission();
    }
    const end = Date.now() + remaining * 1000;
    setStartedAt(startedAt || Date.now());
    setEndAt(end);
    setRunning(true);
  };

  const pause = () => {
    setRemaining(Math.max(0, (endAt - Date.now()) / 1000));
    setEndAt(null);
    setRunning(false);
  };

  const reset = () => {
    setRunning(false);
    setEndAt(null);
    setStartedAt(null);
    setRemaining(durationOf(mode));
  };

  const switchMode = (m) => {
    setRunning(false);
    setEndAt(null);
    setStartedAt(null);
    setMode(m);
    setRemaining(durationOf(m));
  };

  const saveNote = async () => {
    if (noteFor && note.trim()) {
      await updateSession(noteFor, { note: note.trim() });
      onSaved?.();
    }
    setNoteFor(null);
  };

  // ---------- meta semanal ----------
  const parent = parents.find((g) => g.id === groupId);
  const goalMin = parent?.weekly_goal_minutes || 0;
  const weekSec = weekByGroup?.[groupId] || 0;
  const goalPct = goalMin ? (weekSec / 60 / goalMin) * 100 : 0;

  const color = MODES[mode].color;
  const R = 132;
  const C = 2 * Math.PI * R;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ---------------- reloj ---------------- */}
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-[90px] transition-colors duration-700"
          style={{ background: `${color}33` }}
        />

        <div className="relative flex flex-wrap items-center justify-center gap-2">
          {Object.entries(MODES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => switchMode(k)}
              className={`chip ${mode === k ? "chip-on" : ""}`}
              style={mode === k ? { borderColor: `${v.color}88`, background: `${v.color}1f` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: v.color }} />
              {v.label}
            </button>
          ))}
        </div>

        <div className="relative mx-auto mt-7 flex h-[300px] w-[300px] items-center justify-center">
          <svg width="300" height="300" className="absolute -rotate-90">
            <circle cx="150" cy="150" r={R} fill="none" stroke="#1c2131" strokeWidth="12" />
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              style={{
                transition: "stroke-dashoffset .3s linear, stroke .5s",
                filter: `drop-shadow(0 0 12px ${color}66)`,
              }}
            />
          </svg>
          <div className="relative text-center">
            <div className="tnum text-[64px] font-bold leading-none tracking-tight sm:text-[72px]">
              {fmtClock(remaining)}
            </div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-[.2em] text-muted">
              {MODES[mode].label}
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {Array.from({ length: Math.max(1, settings.longEvery) }).map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full transition-colors"
                  style={{
                    background:
                      i < cycle % Math.max(1, settings.longEvery) ? color : "#2a3145",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {running ? (
            <button onClick={pause} className="btn-ghost min-w-[130px] py-3 text-base">
              Pausar
            </button>
          ) : (
            <button
              onClick={start}
              className="btn min-w-[130px] py-3 text-base font-bold text-white"
              style={{ background: color, boxShadow: `0 12px 34px -14px ${color}` }}
            >
              {remaining < duration ? "Seguir" : "Iniciar"}
            </button>
          )}
          <button onClick={reset} className="btn-ghost py-3">
            Reiniciar
          </button>
          {mode === "focus" && remaining < duration - 59 && (
            <button onClick={() => finish(false)} className="btn-ghost py-3">
              Frenar y guardar
            </button>
          )}
          <button onClick={() => finish(false)} className="btn-quiet py-3" title="Saltar al siguiente">
            Saltar →
          </button>
        </div>

        {flash && (
          <p className="relative mt-4 text-center text-sm font-semibold text-rest animate-fadeUp">
            {flash}
          </p>
        )}
        {mode === "focus" && !activeGroupId && (
          <p className="relative mt-4 text-center text-xs text-focus">
            Elegí un grupo para que la sesión se guarde.
          </p>
        )}
      </div>

      {/* ---------------- panel lateral ---------------- */}
      <div className="flex flex-col gap-4">
        <div className="card p-5">
          <p className="label">¿En qué estás trabajando?</p>
          <select
            className="field"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            {parents.length === 0 && <option value="">Creá un grupo primero</option>}
            {parents.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          {subs.length > 0 && (
            <>
              <p className="label mt-4">Subgrupo</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSubId("")}
                  className={`chip ${!subId ? "chip-on" : ""}`}
                >
                  General
                </button>
                {subs.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSubId(s.id)}
                    className={`chip ${subId === s.id ? "chip-on" : ""}`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <p className="label mb-0">Hoy</p>
            <p className="tnum text-xl font-bold">{fmtDur(todaySec || 0)}</p>
          </div>
          {goalMin > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-muted">Meta semanal · {parent?.name}</span>
                <span className="tnum font-semibold">
                  {fmtDur(weekSec)} / {Math.round(goalMin / 60)}h
                </span>
              </div>
              <Bar pct={goalPct} color={parent?.color || "#8b5cf6"} />
              <p className="mt-1.5 text-[11px] text-muted">
                {goalPct >= 100
                  ? "Meta cumplida. Crack."
                  : `Te faltan ${fmtDur(goalMin * 60 - weekSec)} esta semana`}
              </p>
            </div>
          )}
        </div>

        <div className="card p-5 text-xs leading-relaxed text-muted">
          <p className="label">Atajos</p>
          <p>
            <b className="text-ink">Espacio</b> iniciar / pausar · <b className="text-ink">R</b>{" "}
            reiniciar
          </p>
        </div>
      </div>

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title="¿Qué hiciste en esta sesión?">
        <textarea
          autoFocus
          rows={4}
          className="field resize-none"
          placeholder="Ej: TP de Física II, ejercicios 4 a 9"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setNoteFor(null)} className="btn-quiet">
            Saltear
          </button>
          <button onClick={saveNote} className="btn-primary">
            Guardar nota
          </button>
        </div>
      </Modal>

      <KeyBinds
        onSpace={() => (running ? pause() : start())}
        onR={reset}
      />
    </div>
  );
}

function KeyBinds({ onSpace, onR }) {
  useEffect(() => {
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") {
        e.preventDefault();
        onSpace();
      }
      if (e.key === "r" || e.key === "R") onR();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onSpace, onR]);
  return null;
}
