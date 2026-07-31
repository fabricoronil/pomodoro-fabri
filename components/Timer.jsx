"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSession, updateSession } from "@/lib/db";
import { fmtClock, fmtDur, toKey, todayKey } from "@/lib/utils";
import { readableOn, themeColor, useThemeVersion } from "@/lib/theme";
import {
  EMPTY_TIMER,
  claimExpired,
  deviceId,
  fetchTimer,
  normalize,
  pushTimer,
  readMirror,
  subscribeTimer,
  writeMirror,
} from "@/lib/timerSync";
import { Modal, Bar } from "./ui";

const MODES = {
  focus: { label: "Enfoque", token: "focus", short: "Enfoque" },
  short: { label: "Descanso", token: "rest", short: "Descanso" },
  long: { label: "Descanso largo", token: "rest2", short: "Pausa larga" },
};

const PRESETS = {
  focus: [15, 25, 30, 45, 50, 60, 90],
  short: [0, 3, 5, 10, 15],
  long: [0, 10, 15, 20, 30, 45],
};

/** Un bloque que venció hace más de esto se cierra en silencio (sin auto-start) */
const STALE_SEC = 90;

const iso = (ms) => new Date(ms).toISOString();

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
  userId = null,
  name = "",
}) {
  const parents = useMemo(() => groups.filter((g) => !g.parent_id && !g.archived), [groups]);

  // ---- estado sincronizado (la fila active_timer) ----
  const [t, setT] = useState(EMPTY_TIMER);
  const tRef = useRef(t);
  const [hydrated, setHydrated] = useState(false);
  const [syncError, setSyncError] = useState("");

  // ---- reloj de pared: todo lo que se ve se deriva de acá ----
  const [now, setNow] = useState(() => Date.now());

  // ---- UI ----
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftMin, setDraftMin] = useState("");
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const shellRef = useRef(null);
  const idleTimer = useRef(null);
  const claiming = useRef(false);
  const retryAfter = useRef(0);

  const say = useCallback((msg, ms = 3200) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? "" : f)), ms);
  }, []);

  const durationOf = useCallback(
    (m) =>
      (m === "focus" ? settings.focusMin : m === "short" ? settings.shortMin : settings.longMin) *
      60,
    [settings]
  );

  // ------------------------------------------------------ escribir estado

  /** Aplica un cambio local y lo manda a la nube */
  const commit = useCallback(
    (patch) => {
      const next = {
        ...normalize({ ...tRef.current, ...patch }),
        device_id: deviceId(),
        updated_at: new Date().toISOString(),
      };
      tRef.current = next;
      setT(next);
      setNow(Date.now());
      writeMirror(userId, next);
      pushTimer(userId, next)
        .then(() => setSyncError(""))
        .catch((e) => setSyncError(e.message || String(e)));
      return next;
    },
    [userId]
  );

  /** Aplica un estado que vino de la nube (otro dispositivo) */
  const applyRemote = useCallback(
    (row) => {
      const next = normalize(row);
      tRef.current = next;
      setT(next);
      setNow(Date.now());
      writeMirror(userId, next);
    },
    [userId]
  );

  // ------------------------------------------------------------ hidratar

  useEffect(() => {
    let alive = true;
    setHydrated(false);

    const mirror = readMirror(userId);
    if (mirror) {
      tRef.current = mirror;
      setT(mirror);
    }

    (async () => {
      try {
        const row = await fetchTimer(userId);
        if (!alive) return;
        if (row) applyRemote(row);
        setSyncError("");
      } catch (e) {
        if (alive) setSyncError(e.message || String(e));
      }
      if (alive) {
        setNow(Date.now());
        setHydrated(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId, applyRemote]);

  // ------------------------------------- escuchar los otros dispositivos

  useEffect(() => {
    if (!userId) return;
    return subscribeTimer(userId, applyRemote);
  }, [userId, applyRemote]);

  // Red de seguridad por si Realtime no está habilitado: al volver a la
  // pestaña y cada 20s se relee el estado.
  useEffect(() => {
    if (!userId) return;
    const sync = async () => {
      try {
        const row = await fetchTimer(userId);
        if (row && row.device_id !== deviceId()) applyRemote(row);
        setSyncError("");
      } catch {
        /* sin conexión: seguimos con el reloj local */
      }
    };
    const onVisible = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = setInterval(sync, 20000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(id);
    };
  }, [userId, applyRemote]);

  // ---------------------------------------------------------- derivados

  const countUp = t.free_mode && t.mode === "focus";
  const running = t.status === "running";

  const duration =
    t.status === "idle" ? durationOf(t.mode) : t.duration_seconds ?? durationOf(t.mode);

  const remaining = countUp
    ? 0
    : running && t.ends_at
    ? Math.max(0, (Date.parse(t.ends_at) - now) / 1000)
    : t.status === "paused"
    ? t.remaining_seconds ?? duration
    : duration;

  const elapsed = running && t.run_start ? Math.max(0, (now - Date.parse(t.run_start)) / 1000) : t.elapsed_seconds || 0;

  const groupId = t.group_id || parents[0]?.id || "";
  const subId = t.sub_group_id || "";
  const subs = useMemo(
    () => groups.filter((g) => g.parent_id === groupId && !g.archived),
    [groups, groupId]
  );
  const activeGroupId = subId || groupId;

  const progress = countUp
    ? (elapsed % 3600) / 3600
    : duration > 0
    ? 1 - remaining / duration
    : 0;

  // -------------------------------------------------------------- tick

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    document.title = running
      ? `${fmtClock(countUp ? elapsed : remaining)} · ${MODES[t.mode].short}`
      : "Pomodoro";
  }, [remaining, elapsed, running, t.mode, countUp]);

  // ------------------------------------------------------ guardar sesión

  const saveSession = useCallback(
    async ({ seconds, startedAt, endedAt, groupId: gid }) => {
      const secs = Math.round(seconds);
      if (secs < 60 || !gid) return null;
      const end = endedAt || iso(Date.now());
      try {
        const saved = await createSession({
          group_id: gid,
          mode: "focus",
          started_at: startedAt || iso(Date.parse(end) - secs * 1000),
          ended_at: end,
          duration_seconds: secs,
          local_date: toKey(new Date(end)),
        });
        onSaved?.();
        return saved;
      } catch (e) {
        say("Error al guardar: " + (e.message || e), 5000);
        return null;
      }
    },
    [onSaved, say]
  );

  const askNote = useCallback(
    (saved) => {
      if (saved && settings.askNote) {
        setNote("");
        setNoteFor(saved.id);
      }
    },
    [settings.askNote]
  );

  /** Qué viene después de terminar el bloque actual */
  const nextModeAfter = useCallback(
    (state) => {
      if (state.mode !== "focus") return "focus";
      const cyc = state.cycle + 1;
      const candidate = cyc % Math.max(1, settings.longEvery) === 0 ? "long" : "short";
      return durationOf(candidate) > 0 ? candidate : "focus";
    },
    [durationOf, settings.longEvery]
  );

  // --------------------------------------------- el bloque llegó a cero
  //  Corre tanto si estabas mirando como si volvés días después: el fin
  //  está guardado en la nube, así que la sesión se registra igual.

  const handleExpired = useCallback(
    async (state) => {
      if (claiming.current || Date.now() < retryAfter.current) return;
      claiming.current = true;
      try {
        const endsAt = state.ends_at;
        const endedMs = Date.parse(endsAt);
        const staleSec = (Date.now() - endedMs) / 1000;
        const wasFocus = state.mode === "focus";
        const blockSec = state.duration_seconds ?? Math.max(0, (endedMs - Date.parse(state.started_at || endsAt)) / 1000);

        const nextMode = nextModeAfter(state);
        const nextDur = durationOf(nextMode);
        const autoStart =
          staleSec < STALE_SEC &&
          nextDur > 0 &&
          (nextMode === "focus" ? settings.autoStartFocus : settings.autoStartBreaks);
        const startMs = Date.now();

        const next = {
          ...state,
          mode: nextMode,
          cycle: wasFocus ? state.cycle + 1 : state.cycle,
          status: autoStart ? "running" : "idle",
          started_at: autoStart ? iso(startMs) : null,
          ends_at: autoStart ? iso(startMs + nextDur * 1000) : null,
          remaining_seconds: null,
          duration_seconds: autoStart ? Math.round(nextDur) : null,
          elapsed_seconds: 0,
          run_start: null,
        };

        // Solo un dispositivo se queda con el bloque vencido: así la
        // sesión nunca se guarda dos veces.
        const won = await claimExpired(userId, endsAt, next);
        if (!won) {
          const row = await fetchTimer(userId);
          const yaCerrado = row && (row.status !== "running" || row.ends_at !== endsAt);
          if (yaCerrado) {
            applyRemote(row); // lo cerró otro dispositivo
            return;
          }
          // no había fila que reclamar (p. ej. veníamos de la copia local):
          // la escribimos nosotros y seguimos
          await pushTimer(userId, next);
        }
        applyRemote({ ...next, device_id: deviceId(), updated_at: new Date().toISOString() });

        if (wasFocus) {
          const saved = await saveSession({
            seconds: blockSec,
            startedAt: state.started_at,
            endedAt: endsAt,
            groupId: state.sub_group_id || state.group_id,
          });
          if (staleSec >= STALE_SEC) {
            say(
              saved
                ? `Tu pomodoro terminó mientras no estabas · ${fmtDur(blockSec)} guardados`
                : "Tu pomodoro terminó mientras no estabas",
              6000
            );
          } else {
            say(saved ? `Guardado · ${fmtDur(blockSec)}` : "Pomodoro completado");
          }
          askNote(saved);
        } else if (staleSec >= STALE_SEC) {
          say("El descanso ya había terminado", 4000);
        }

        if (staleSec < STALE_SEC) {
          if (settings.sound) beep(settings.volume, 3);
          if (settings.notifications) {
            notify(
              wasFocus ? "Pomodoro completado" : "Descanso terminado",
              wasFocus
                ? name
                  ? `Tomate un respiro, ${name}.`
                  : "Tomate un respiro."
                : "Dale, volvé a la carga."
            );
          }
        }
      } catch (e) {
        retryAfter.current = Date.now() + 8000; // no martillar si no hay red
        setSyncError(e.message || String(e));
      } finally {
        claiming.current = false;
      }
    },
    [applyRemote, askNote, durationOf, name, nextModeAfter, saveSession, say, settings, userId]
  );

  useEffect(() => {
    if (!hydrated) return;
    if (t.status !== "running" || t.free_mode || !t.ends_at) return;
    if (Date.parse(t.ends_at) > Date.now()) return;
    handleExpired(t);
  }, [t, now, hydrated, handleExpired]);

  // ----------------------------------------------------------- controles

  const start = () => {
    if (!countUp && duration <= 0) return;
    if (settings.notifications && typeof Notification !== "undefined") {
      if (Notification.permission === "default") Notification.requestPermission();
    }
    const ms = Date.now();
    if (countUp) {
      commit({
        status: "running",
        group_id: groupId || null,
        sub_group_id: subId || null,
        started_at: t.started_at || iso(ms),
        run_start: iso(ms - (t.elapsed_seconds || 0) * 1000),
      });
      return;
    }
    const secs = remaining > 0 ? remaining : duration;
    commit({
      status: "running",
      group_id: groupId || null,
      sub_group_id: subId || null,
      started_at: t.started_at || iso(ms),
      ends_at: iso(ms + secs * 1000),
      duration_seconds: Math.round(duration),
      remaining_seconds: null,
      elapsed_seconds: 0,
      run_start: null,
    });
  };

  const pause = () => {
    if (countUp) {
      commit({ status: "paused", elapsed_seconds: elapsed, run_start: null });
      return;
    }
    commit({ status: "paused", remaining_seconds: Math.max(0, remaining), ends_at: null });
  };

  /** Cancelar: la única forma de frenar el pomodoro sin guardarlo */
  const cancel = () => {
    const hadRun = t.status !== "idle";
    commit({
      status: "idle",
      started_at: null,
      ends_at: null,
      remaining_seconds: null,
      duration_seconds: null,
      elapsed_seconds: 0,
      run_start: null,
    });
    if (hadRun) say("Pomodoro cancelado");
  };

  /** Corta el bloque en curso: guarda lo hecho (si es enfoque) y sigue */
  const finishNow = async (save) => {
    const state = tRef.current;
    const done = Math.max(0, duration - remaining);
    const wasFocus = state.mode === "focus";
    const nextMode = nextModeAfter(state);

    commit({
      mode: nextMode,
      cycle: wasFocus ? state.cycle + 1 : state.cycle,
      status: "idle",
      started_at: null,
      ends_at: null,
      remaining_seconds: null,
      duration_seconds: null,
      elapsed_seconds: 0,
      run_start: null,
    });

    if (settings.sound) beep(settings.volume, 1);
    if (!save || !wasFocus) return;

    const saved = await saveSession({
      seconds: done,
      startedAt: state.started_at,
      endedAt: iso(Date.now()),
      groupId: state.sub_group_id || state.group_id || activeGroupId,
    });
    if (saved) say(`Guardado · ${fmtDur(done)}`);
    askNote(saved);
  };

  /** Modo libre: frenar y guardar lo cronometrado */
  const stopFree = async () => {
    const state = tRef.current;
    const secs = elapsed;
    commit({
      status: "idle",
      started_at: null,
      elapsed_seconds: 0,
      run_start: null,
      remaining_seconds: null,
      duration_seconds: null,
    });
    if (settings.sound) beep(settings.volume, 2);
    const saved = await saveSession({
      seconds: secs,
      startedAt: state.started_at,
      endedAt: iso(Date.now()),
      groupId: state.sub_group_id || state.group_id || activeGroupId,
    });
    if (saved) say(`Guardado · ${fmtDur(secs)}`);
    askNote(saved);
  };

  const switchMode = (m) => {
    commit({
      mode: m,
      status: "idle",
      started_at: null,
      ends_at: null,
      remaining_seconds: null,
      duration_seconds: null,
      elapsed_seconds: 0,
      run_start: null,
    });
  };

  const toggleFree = () => {
    commit({
      free_mode: !t.free_mode,
      mode: "focus",
      status: "idle",
      started_at: null,
      ends_at: null,
      remaining_seconds: null,
      duration_seconds: null,
      elapsed_seconds: 0,
      run_start: null,
    });
  };

  const applyMinutes = (min) => {
    const v = Math.max(0, Math.min(600, Math.round(Number(min) || 0)));
    const key = t.mode === "focus" ? "focusMin" : t.mode === "short" ? "shortMin" : "longMin";
    if (t.mode === "focus" && v < 1) return;
    setSettings({ ...settings, [key]: v });
    commit({
      status: "idle",
      started_at: null,
      ends_at: null,
      remaining_seconds: null,
      duration_seconds: null,
    });
    setEditing(false);
  };

  const saveNote = async () => {
    if (noteFor && note.trim()) {
      await updateSession(noteFor, { note: note.trim() });
      onSaved?.();
    }
    setNoteFor(null);
  };

  // ---------------------------------------------------- pantalla completa

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

  // ---------------------------------------------------------- meta semanal

  const parent = parents.find((g) => g.id === groupId);
  const goalMin = parent?.weekly_goal_minutes || 0;
  const weekSec = weekByGroup?.[groupId] || 0;
  const goalPct = goalMin ? (weekSec / 60 / goalMin) * 100 : 0;

  useThemeVersion(); // repinta el reloj cuando cambian los colores
  const color = themeColor(MODES[t.mode].token);
  const R = 132;
  const C = 2 * Math.PI * R;
  const clock = fmtClock(countUp ? elapsed : remaining);
  const activeName = groups.find((g) => g.id === activeGroupId)?.name || "Sin grupo";
  const startLabel = countUp
    ? elapsed > 0
      ? "Seguir"
      : "Iniciar"
    : t.status === "paused" || remaining < duration
    ? "Seguir"
    : "Iniciar";

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
        {t.mode === "focus" ? activeName : MODES[t.mode].label}
      </p>

      <div
        className="tnum select-none font-bold leading-none tracking-tight"
        style={{
          fontSize: "min(26vw, 34vh)",
          color: running ? "rgb(var(--c-ink))" : color,
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
            className="btn px-8 py-3 text-base font-bold"
            style={{ background: color, color: readableOn(color) }}
          >
            {startLabel}
          </button>
        )}
        {countUp ? (
          <button onClick={stopFree} className="btn-ghost px-6 py-3">
            Frenar y guardar
          </button>
        ) : (
          <button onClick={cancel} className="btn-ghost px-6 py-3">
            Cancelar
          </button>
        )}
        <button onClick={toggleFs} className="btn-quiet px-6 py-3">
          Salir
        </button>
      </div>

      {flash && <p className="mt-6 text-sm font-semibold text-rest animate-fadeUp">{flash}</p>}
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
                const c = themeColor(v.token);
                return (
                  <button
                    key={k}
                    onClick={() => switchMode(k)}
                    className={`chip ${t.mode === k ? "chip-on" : ""} ${off ? "opacity-45" : ""}`}
                    style={
                      t.mode === k ? { borderColor: `${c}88`, background: `${c}1f` } : undefined
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                    {v.label}
                    {off && <span className="text-[10px]">· off</span>}
                  </button>
                );
              })}
              <button
                onClick={toggleFree}
                className={`chip ${t.free_mode ? "chip-on" : ""}`}
                title="Cronómetro libre, sin límite de tiempo"
              >
                ∞ Libre
              </button>
            </div>

            <div className="relative mx-auto mt-7 flex h-[300px] w-[300px] items-center justify-center">
              <svg width="300" height="300" className="absolute -rotate-90">
                <circle
                  cx="150"
                  cy="150"
                  r={R}
                  fill="none"
                  stroke="rgb(var(--c-surface3))"
                  strokeWidth="12"
                />
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
                      min={t.mode === "focus" ? 1 : 0}
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
                      <button
                        onClick={() => applyMinutes(draftMin)}
                        className="btn-primary px-3 py-1 text-xs"
                      >
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
                      {countUp ? "Modo libre" : MODES[t.mode].label}
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
                          background:
                            i < t.cycle % Math.max(1, settings.longEvery)
                              ? color
                              : "rgb(var(--c-surface3))",
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
                {PRESETS[t.mode].map((p) => (
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
                  className="btn min-w-[130px] py-3 text-base font-bold"
                  style={{
                    background: color,
                    color: readableOn(color),
                    boxShadow: `0 12px 34px -14px ${color}`,
                  }}
                >
                  {startLabel}
                </button>
              )}

              {countUp ? (
                <button onClick={stopFree} disabled={elapsed < 60} className="btn-ghost py-3">
                  Frenar y guardar
                </button>
              ) : (
                <>
                  <button onClick={cancel} className="btn-ghost py-3">
                    {t.status === "idle" ? "Reiniciar" : "Cancelar"}
                  </button>
                  {t.mode === "focus" && remaining < duration - 59 && (
                    <button onClick={() => finishNow(true)} className="btn-ghost py-3">
                      Frenar y guardar
                    </button>
                  )}
                  <button onClick={() => finishNow(false)} className="btn-quiet py-3">
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
            {t.mode === "focus" && !activeGroupId && (
              <p className="relative mt-4 text-center text-xs text-focus">
                Elegí un grupo para que la sesión se guarde.
              </p>
            )}
            {syncError && (
              <p className="relative mt-3 text-center text-xs text-warn">
                Sin sincronizar: {syncError}
              </p>
            )}
          </>
        )}
      </div>

      {/* ---------------- panel lateral ---------------- */}
      <div className={`flex flex-col gap-4 ${fs ? "hidden" : ""}`}>
        <div className="card p-5">
          <p className="label">¿En qué estás trabajando?</p>
          <select
            className="field"
            value={groupId}
            onChange={(e) => commit({ group_id: e.target.value || null, sub_group_id: null })}
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
                  onClick={() => commit({ group_id: groupId || null, sub_group_id: null })}
                  className={`chip ${!subId ? "chip-on" : ""}`}
                >
                  General
                </button>
                {subs.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => commit({ group_id: groupId || null, sub_group_id: s.id })}
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
              <Bar pct={goalPct} color={parent?.color || "rgb(var(--c-accent))"} />
              <p className="mt-1.5 text-[11px] text-muted">
                {goalPct >= 100
                  ? "Meta cumplida. Crack."
                  : `Te faltan ${fmtDur(goalMin * 60 - weekSec)} esta semana`}
              </p>
            </div>
          )}
        </div>

        {userId && (
          <div className="card p-5 text-xs leading-relaxed text-muted">
            <p className="label">Timer en la nube</p>
            <p>
              {running
                ? "Está corriendo en tu cuenta: podés cerrar la web o seguir desde el celular, sigue igual."
                : "Cuando lo inicies va a seguir corriendo aunque cierres la web. Solo se detiene si lo cancelás."}
            </p>
          </div>
        )}

        <div className="card p-5 text-xs leading-relaxed text-muted">
          <p className="label">Atajos</p>
          <p>
            <b className="text-ink">Espacio</b> iniciar / pausar · <b className="text-ink">R</b>{" "}
            cancelar · <b className="text-ink">F</b> pantalla completa
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
          placeholder="Ej: ejercicios 4 a 9 del práctico"
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
        onR={cancel}
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
