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

const PRESETS = {
  focus: [15, 25, 30, 45, 50, 60, 90],
  short: [0, 3, 5, 10, 15],
  long: [0, 10, 15, 20, 30, 45],
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
      new Notification(title, { body, tag: "pomodoro" });
    }
  } catch {
    /* noop */
  }
}

export default function Timer({
  groups,
  settings,
  setSettings,
  onSaved,
  todaySec,
  weekByGroup,
}) {
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

  // modo libre (cuenta para arriba)
  const [freeMode, setFreeMode] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runStart, setRunStart] = useState(null);

  // edición inline de la duración
  const [editing, setEditing] = useState(false);
  const [draftMin, setDraftMin] = useState("");

  // pantalla completa
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const shellRef = useRef(null);
  const idleTimer = useRef(null);

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

  const countUp = freeMode && mode === "focus";

  // ---------- restaurar tras un refresh ----------
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      setMode(s.mode || "focus");
      setCycle(s.cycle || 0);
      setGroupId(s.groupId || "");
      setSubId(s.subId || "");
      setFreeMode(!!s.freeMode);

      if (s.freeMode && s.mode === "focus") {
        setElapsed(s.elapsed || 0);
        if (s.running && s.runStart) {
          setRunStart(s.runStart);
          setElapsed((Date.now() - s.runStart) / 1000);
          setStartedAt(s.startedAt);
          setRunning(true);
        }
        return;
      }
      if (s.running && s.endAt && s.endAt > Date.now()) {
        setEndAt(s.endAt);
        setStartedAt(s.startedAt);
        setRemaining((s.endAt - Date.now()) / 1000);
        setRunning(true);
        return;
      }
      setRemaining(s.remaining ?? durationOf(s.mode || "focus"));
    } catch {
      /* noop */
    }
  }, [durationOf]);

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
      JSON.stringify({
        mode,
        running,
        endAt,
        remaining,
        startedAt,
        cycle,
        groupId,
        subId,
        freeMode,
        elapsed,
        runStart,
      })
    );
  }, [mode, running, endAt, remaining, startedAt, cycle, groupId, subId, freeMode, elapsed, runStart]);

  useEffect(() => {
    if (!running && !countUp) setRemaining(durationOf(mode));
  }, [settings.focusMin, settings.shortMin, settings.longMin]); // eslint-disable-line

  const activeGroupId = subId || groupId;
  const duration = durationOf(mode);
  const progress = countUp
    ? (elapsed % 3600) / 3600
    : duration > 0
    ? 1 - remaining / duration
    : 0;

  // ---------- guardar sesión ----------
  const saveSession = useCallback(
    async (seconds) => {
      if (seconds < 60 || !activeGroupId) return null;
      try {
        const saved = await createSession({
          group_id: activeGroupId,
          mode: "focus",
          started_at: new Date(startedAt || Date.now() - seconds * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: seconds,
          local_date: todayKey(),
        });
        onSaved?.();
        setFlash(`Guardado · ${fmtDur(seconds)}`);
        setTimeout(() => setFlash(""), 3200);
        return saved;
      } catch (e) {
        setFlash("Error al guardar: " + (e.message || e));
        setTimeout(() => setFlash(""), 5000);
        return null;
      }
    },
    [activeGroupId, onSaved, startedAt]
  );

  const finish = useCallback(
    async (completed) => {
      const elapsedSec = completed ? duration : duration - remaining;
      const wasFocus = mode === "focus";
      setRunning(false);
      setEndAt(null);

      if (settings.sound) beep(settings.volume, completed ? 3 : 1);

      let saved = null;
      if (wasFocus) saved = await saveSession(elapsedSec);

      if (completed && settings.notifications) {
        notify(
          wasFocus ? "Pomodoro completado" : "Descanso terminado",
          wasFocus ? "Tomate un respiro, Fabri." : "Dale, volvé a la carga."
        );
      }

      // siguiente modo (si el descanso dura 0, se saltea)
      let next = "focus";
      let nextCycle = cycle;
      if (wasFocus) {
        nextCycle = cycle + 1;
        const candidate =
          nextCycle % Math.max(1, settings.longEvery) === 0 ? "long" : "short";
        next = durationOf(candidate) > 0 ? candidate : "focus";
      }
      setCycle(nextCycle);
      setMode(next);
      setRemaining(durationOf(next));
      setStartedAt(null);

      if (completed) {
        const auto = next === "focus" ? settings.autoStartFocus : settings.autoStartBreaks;
        if (auto && durationOf(next) > 0) {
          setStartedAt(Date.now());
          setEndAt(Date.now() + durationOf(next) * 1000);
          setRunning(true);
        }
      }

      if (saved && settings.askNote) {
        setNote("");
        setNoteFor(saved.id);
      }
    },
    [cycle, duration, durationOf, mode, remaining, saveSession, settings]
  );

  // ---------- tick ----------
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  useEffect(() => {
    if (!running) return;

    if (countUp) {
      const id = setInterval(() => {
        if (runStart) setElapsed((Date.now() - runStart) / 1000);
      }, 250);
      return () => clearInterval(id);
    }

    if (!endAt) return;
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
  }, [running, endAt, countUp, runStart]);

  useEffect(() => {
    document.title = running
      ? `${fmtClock(countUp ? elapsed : remaining)} · ${MODES[mode].short}`
      : "Pomodoro · Fabri";
  }, [remaining, elapsed, running, mode, countUp]);

  // ---------- controles ----------
  const start = () => {
    if (settings.notifications && typeof Notification !== "undefined") {
      if (Notification.permission === "default") Notification.requestPermission();
    }
    if (countUp) {
      setRunStart(Date.now() - elapsed * 1000);
      setStartedAt(startedAt || Date.now());
      setRunning(true);
      return;
    }
    setStartedAt(startedAt || Date.now());
    setEndAt(Date.now() + remaining * 1000);
    setRunning(true);
  };

  const pause = () => {
    if (countUp) {
      setElapsed(runStart ? (Date.now() - runStart) / 1000 : elapsed);
      setRunning(false);
      return;
    }
    setRemaining(Math.max(0, (endAt - Date.now()) / 1000));
    setEndAt(null);
    setRunning(false);
  };

  const reset = () => {
    setRunning(false);
    setEndAt(null);
    setStartedAt(null);
    setRunStart(null);
    setElapsed(0);
    setRemaining(durationOf(mode));
  };

  const stopFree = async () => {
    const secs = runStart && running ? (Date.now() - runStart) / 1000 : elapsed;
    setRunning(false);
    setRunStart(null);
    if (settings.sound) beep(settings.volume, 2);
    const saved = await saveSession(Math.round(secs));
    setElapsed(0);
    setStartedAt(null);
    if (saved && settings.askNote) {
      setNote("");
      setNoteFor(saved.id);
    }
  };

  const switchMode = (m) => {
    setRunning(false);
    setEndAt(null);
    setStartedAt(null);
    setRunStart(null);
    setElapsed(0);
    setMode(m);
    setRemaining(durationOf(m));
  };

  const applyMinutes = (min) => {
    const v = Math.max(0, Math.min(600, Math.round(Number(min) || 0)));
    const key = mode === "focus" ? "focusMin" : mode === "short" ? "shortMin" : "longMin";
    if (mode === "focus" && v < 1) return;
    setSettings({ ...settings, [key]: v });
    setRunning(false);
    setEndAt(null);
    setStartedAt(null);
    setRemaining(v * 60);
    setEditing(false);
  };

  const saveNote = async () => {
    if (noteFor && note.trim()) {
      await updateSession(noteFor, { note: note.trim() });
      onSaved?.();
    }
    setNoteFor(null);
  };

  // ---------- pantalla completa ----------
  const toggleFs = async () => {
    try {
      if (!document.fullscreenElement) await shellRef.current?.requestFullscreen?.();
      else await document.exitFullscreen();
    } catch {
      setFs((v) => !v); // fallback: overlay sin API nativa
    }
  };

  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  useEffect(() => {
    if (!fs) {
      setIdle(false);
      return;
    }
    const wake = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 3500);
    };
    const esc = (e) => {
      if (e.key === "Escape" && !document.fullscreenElement) setFs(false);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [fs]);

  // ---------- meta semanal ----------
  const parent = parents.find((g) => g.id === groupId);
  const goalMin = parent?.weekly_goal_minutes || 0;
  const weekSec = weekByGroup?.[groupId] || 0;
  const goalPct = goalMin ? (weekSec / 60 / goalMin) * 100 : 0;

  const color = MODES[mode].color;
  const R = 132;
  const C = 2 * Math.PI * R;
  const clock = fmtClock(countUp ? elapsed : remaining);
  const activeName =
    groups.find((g) => g.id === activeGroupId)?.name || "Sin grupo";

  /* ------------------------------------------------ PANTALLA COMPLETA */
  const fullscreenView = (
    <div
      onClick={() => setIdle(false)}
      className={`flex h-full w-full flex-col items-center justify-center bg-base transition-opacity ${
        idle ? "cursor-none" : ""
      }`}
    >
      <p
        className={`mb-6 text-sm font-semibold uppercase tracking-[.3em] text-muted transition-opacity duration-500 ${
          idle ? "opacity-30" : "opacity-100"
        }`}
      >
        {mode === "focus" ? activeName : MODES[mode].label}
      </p>

      <div
        className="tnum select-none font-bold leading-none tracking-tight"
        style={{
          fontSize: "min(26vw, 34vh)",
          color: running ? "#e9ecf6" : color,
          textShadow: `0 0 90px ${color}44`,
        }}
      >
        {clock}
      </div>

      <div
        className={`mt-12 flex items-center gap-3 transition-opacity duration-500 ${
          idle ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {running ? (
          <button onClick={pause} className="btn-ghost px-8 py-3 text-base">
            Pausar
          </button>
        ) : (
          <button
            onClick={start}
            className="btn px-8 py-3 text-base font-bold text-white"
            style={{ background: color }}
          >
            {countUp ? (elapsed > 0 ? "Seguir" : "Iniciar") : remaining < duration ? "Seguir" : "Iniciar"}
          </button>
        )}
        {countUp ? (
          <button onClick={stopFree} className="btn-ghost px-6 py-3">
            Frenar y guardar
          </button>
        ) : (
          <button onClick={reset} className="btn-ghost px-6 py-3">
            Reiniciar
          </button>
        )}
        <button onClick={toggleFs} className="btn-quiet px-6 py-3">
          Salir
        </button>
      </div>

      {flash && (
        <p className="mt-6 text-sm font-semibold text-rest animate-fadeUp">{flash}</p>
      )}
    </div>
  );

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ---------------- reloj ---------------- */}
      <div
        ref={shellRef}
        className={
          fs
            ? "fixed inset-0 z-[70] h-[100dvh] w-screen bg-base"
            : "card relative overflow-hidden p-6 sm:p-8"
        }
      >
        {fs ? (
          fullscreenView
        ) : (
          <>
            <div
              className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-[90px] transition-colors duration-700"
              style={{ background: `${color}33` }}
            />

            <div className="relative flex flex-wrap items-center justify-center gap-2">
              {Object.entries(MODES).map(([k, v]) => {
                const off = k !== "focus" && durationOf(k) === 0;
                return (
                  <button
                    key={k}
                    onClick={() => switchMode(k)}
                    className={`chip ${mode === k ? "chip-on" : ""} ${off ? "opacity-45" : ""}`}
                    style={
                      mode === k
                        ? { borderColor: `${v.color}88`, background: `${v.color}1f` }
                        : undefined
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: v.color }} />
                    {v.label}
                    {off && <span className="text-[10px]">· off</span>}
                  </button>
                );
              })}
              <button
                onClick={() => {
                  setFreeMode((v) => !v);
                  setRunning(false);
                  setEndAt(null);
                  setElapsed(0);
                  setRunStart(null);
                  setMode("focus");
                  setRemaining(durationOf("focus"));
                }}
                className={`chip ${freeMode ? "chip-on" : ""}`}
                title="Cronómetro libre, sin límite de tiempo"
              >
                ∞ Libre
              </button>
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
                {editing ? (
                  <div className="flex flex-col items-center gap-2">
                    <input
                      autoFocus
                      type="number"
                      min={mode === "focus" ? 1 : 0}
                      max="600"
                      value={draftMin}
                      onChange={(e) => setDraftMin(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyMinutes(draftMin);
                        if (e.key === "Escape") setEditing(false);
                      }}
                      className="field w-32 text-center text-3xl font-bold"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => applyMinutes(draftMin)} className="btn-primary px-3 py-1 text-xs">
                        Aplicar
                      </button>
                      <button onClick={() => setEditing(false)} className="btn-quiet px-3 py-1 text-xs">
                        Cancelar
                      </button>
                    </div>
                    <p className="text-[11px] text-muted">minutos</p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (countUp) return;
                        setDraftMin(String(Math.round(duration / 60)));
                        setEditing(true);
                      }}
                      className="tnum block text-[64px] font-bold leading-none tracking-tight transition hover:opacity-80 sm:text-[72px]"
                      title={countUp ? "" : "Tocá para cambiar la duración"}
                    >
                      {clock}
                    </button>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[.2em] text-muted">
                      {countUp ? "Modo libre" : MODES[mode].label}
                    </div>
                  </>
                )}

                {!editing && !countUp && (
                  <div className="mt-3 flex items-center justify-center gap-1.5">
                    {Array.from({ length: Math.max(1, settings.longEvery) }).map((_, i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full transition-colors"
                        style={{
                          background: i < cycle % Math.max(1, settings.longEvery) ? color : "#2a3145",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* presets rápidos */}
            {!countUp && (
              <div className="relative mt-5 flex flex-wrap items-center justify-center gap-1.5">
                {PRESETS[mode].map((p) => (
                  <button
                    key={p}
                    onClick={() => applyMinutes(p)}
                    className={`chip px-2.5 py-1 text-[11px] ${
                      Math.round(duration / 60) === p ? "chip-on" : ""
                    }`}
                  >
                    {p === 0 ? "sin descanso" : `${p}m`}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setDraftMin(String(Math.round(duration / 60)));
                    setEditing(true);
                  }}
                  className="chip border-dashed px-2.5 py-1 text-[11px]"
                >
                  otro…
                </button>
              </div>
            )}

            <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2.5">
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
                  {countUp
                    ? elapsed > 0
                      ? "Seguir"
                      : "Iniciar"
                    : remaining < duration
                    ? "Seguir"
                    : "Iniciar"}
                </button>
              )}

              {countUp ? (
                <button onClick={stopFree} disabled={elapsed < 60} className="btn-ghost py-3">
                  Frenar y guardar
                </button>
              ) : (
                <>
                  <button onClick={reset} className="btn-ghost py-3">
                    Reiniciar
                  </button>
                  {mode === "focus" && remaining < duration - 59 && (
                    <button onClick={() => finish(false)} className="btn-ghost py-3">
                      Frenar y guardar
                    </button>
                  )}
                  <button onClick={() => finish(false)} className="btn-quiet py-3">
                    Saltar →
                  </button>
                </>
              )}

              <button onClick={toggleFs} className="btn-quiet py-3" title="Pantalla completa">
                ⛶ Pantalla completa
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
          </>
        )}
      </div>

      {/* ---------------- panel lateral ---------------- */}
      <div className={`flex flex-col gap-4 ${fs ? "hidden" : ""}`}>
        <div className="card p-5">
          <p className="label">¿En qué estás trabajando?</p>
          <select className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
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
                <button onClick={() => setSubId("")} className={`chip ${!subId ? "chip-on" : ""}`}>
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
                  {fmtDur(weekSec)} / {Math.round((goalMin / 60) * 10) / 10}h
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
            reiniciar · <b className="text-ink">F</b> pantalla completa
          </p>
          <p className="mt-2">
            Tocá el número del reloj para cambiar la duración. Poné un descanso en{" "}
            <b className="text-ink">0</b> y el timer lo saltea.
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
        onF={toggleFs}
        disabled={editing || !!noteFor}
      />
    </div>
  );
}

function KeyBinds({ onSpace, onR, onF, disabled }) {
  useEffect(() => {
    if (disabled) return;
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") {
        e.preventDefault();
        onSpace();
      }
      if (e.key === "r" || e.key === "R") onR();
      if (e.key === "f" || e.key === "F") onF();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onSpace, onR, onF, disabled]);
  return null;
}
