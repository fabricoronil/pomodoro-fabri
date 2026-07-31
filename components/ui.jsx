"use client";

import { useEffect, useState } from "react";
import { fmtDur } from "@/lib/utils";
import { goalStatus } from "@/lib/kinds";
import { themeColor } from "@/lib/theme";

export function Segmented({ value, onChange, options, className = "" }) {
  return (
    <div
      className={`inline-flex rounded-xl border border-line bg-surface2/60 p-1 ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === o.value
              ? "bg-accent text-onAccent shadow-[0_8px_20px_-10px_rgb(var(--c-accent)/.9)]"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        className={`card animate-pop w-full ${
          wide ? "max-w-2xl" : "max-w-md"
        } max-h-[88dvh] overflow-y-auto rounded-b-none p-5 sm:rounded-2xl`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="btn-quiet -mr-2 -mt-1 px-2 py-1 text-lg">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Campo numérico con −/+.
 *
 * Las flechitas nativas del navegador son diminutas, aparecen solo al pasar el
 * mouse y en el celular directamente no existen. Estas se ven siempre, se
 * pueden tocar con el dedo y suman de a `step`.
 *
 * Mientras escribís se guarda el texto tal cual (para poder borrar todo o
 * dejar un "1." a medio tipear) y recién al salir del campo se acomoda al
 * rango permitido.
 */
export function NumField({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  className = "",
  ...rest
}) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const clamp = (n) => Math.min(max, Math.max(min, n));
  const round = (n) => Math.round(n * 100) / 100;

  const bump = (dir) => {
    const base = Number(draft);
    const next = round(clamp((Number.isNaN(base) ? min : base) + dir * step));
    setDraft(String(next));
    onChange(next);
  };

  const type = (raw) => {
    setDraft(raw);
    const n = Number(raw);
    if (raw !== "" && !Number.isNaN(n) && n >= min && n <= max) onChange(round(n));
  };

  const settle = () => {
    const n = Number(draft);
    const next = draft === "" || Number.isNaN(n) ? min : round(clamp(n));
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className={`field flex items-center gap-1 px-1 py-1 ${className}`}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => bump(-1)}
        disabled={Number(draft) <= min}
        className="stepper"
        aria-label="Restar"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => type(e.target.value)}
        onBlur={settle}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(-1);
          }
        }}
        className="tnum min-w-0 flex-1 bg-transparent text-center text-sm font-semibold text-ink outline-none"
        {...rest}
      />
      {suffix && <span className="shrink-0 pr-1 text-xs text-muted">{suffix}</span>}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => bump(1)}
        disabled={Number(draft) >= max}
        className="stepper"
        aria-label="Sumar"
      >
        +
      </button>
    </div>
  );
}

export function Stat({ label, value, sub, accent, right }) {
  return (
    <div className="kpi">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">
          {label}
        </p>
        {right}
      </div>
      <p
        className="tnum mt-1.5 text-2xl font-bold leading-tight"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-line/80 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function Bar({ pct, color, height = 8 }) {
  color = color || "rgb(var(--c-accent))";
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-surface3"
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 72%, transparent))`,
        }}
      />
    </div>
  );
}

/**
 * Una barra de objetivo. Sirve para los dos sentidos: si es meta se llena hacia
 * el verde, y si es límite avisa cuando estás cerca y se pone en rojo al pasarte.
 */
export function GoalLine({ label, sec, goalMin, type, compact = false }) {
  const st = goalStatus(sec, goalMin, type);
  if (!st) return null;
  const color = themeColor(st.token);
  const goalTxt = `${Math.round((goalMin / 60) * 10) / 10}h`;
  const strong = st.over || st.done;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted">
          {label}
          {!compact && ` · ${type === "limite" ? "límite" : "meta"} ${goalTxt}`}
        </span>
        <span className="tnum font-semibold" style={{ color }}>
          {fmtDur(sec)} / {goalTxt}
        </span>
      </div>
      <Bar pct={st.pct} color={color} height={7} />
      <p
        className={`mt-1 text-[11px] ${strong ? "font-semibold" : "text-muted"}`}
        style={strong ? { color } : undefined}
      >
        {type === "limite"
          ? st.over
            ? `Te pasaste por ${fmtDur(-st.rest)}`
            : `Te queda ${fmtDur(st.rest)}`
          : st.done
          ? "✓ Cumplida"
          : `Faltan ${fmtDur(st.rest)}`}
      </p>
    </div>
  );
}

export function Delta({ value, suffix = "%" }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const up = value >= 0;
  return (
    <span
      className={`tnum inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
        up ? "bg-rest/15 text-rest" : "bg-focus/15 text-focus"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}
