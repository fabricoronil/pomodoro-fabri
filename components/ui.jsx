"use client";

import { useEffect } from "react";

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
              ? "bg-accent text-white shadow-[0_8px_20px_-10px_rgba(139,92,246,.9)]"
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

export function Bar({ pct, color = "#8b5cf6", height = 8 }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-surface3"
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: `linear-gradient(90deg, ${color}, ${color}bb)`,
        }}
      />
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
