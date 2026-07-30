"use client";

import { useMemo } from "react";
import {
  PRESETS,
  BG_STYLES,
  DEFAULT_THEME,
  buildPalette,
  findPreset,
  isLight,
  safeImageUrl,
} from "@/lib/theme";

const COLOR_FIELDS = [
  { key: "accent", label: "Acento", desc: "Botones, pestaña activa, resaltados" },
  { key: "accent2", label: "Secundario", desc: "Segunda serie de los gráficos" },
  { key: "focus", label: "Enfoque", desc: "Color del pomodoro y de los avisos" },
  { key: "rest", label: "Descanso", desc: "Color de los descansos y los aciertos" },
  { key: "base", label: "Fondo", desc: "De acá salen las superficies y los bordes" },
  { key: "ink", label: "Texto", desc: "Color principal de la tipografía" },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function ColorField({ label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/50 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(v, HEX_RE.test(v));
          }}
          className="field w-24 px-2 py-1.5 text-center font-mono text-xs uppercase"
        />
        <label
          className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line"
          style={{ background: HEX_RE.test(value) ? value : "transparent" }}
          title={`Elegir ${label.toLowerCase()}`}
        >
          <input
            type="color"
            value={HEX_RE.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value, true)}
            className="absolute -left-2 -top-2 h-16 w-16 cursor-pointer border-0 bg-transparent p-0 opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step = 1, suffix = "" }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/50 py-3 last:border-0">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex shrink-0 items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32"
          style={{ accentColor: "rgb(var(--c-accent))" }}
        />
        <span className="tnum w-12 text-right text-xs text-muted">
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}

/** Miniatura de un preset: fondo + los cuatro colores clave */
function PresetCard({ preset, active, onClick }) {
  const p = buildPalette(preset.theme);
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
        active
          ? "border-accent ring-2 ring-accent/40"
          : "border-line hover:border-accent/50"
      }`}
      style={{ background: p.base }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(70% 60% at 15% 0%, ${p.accent}55, transparent 60%),
                       radial-gradient(60% 60% at 100% 100%, ${p.accent2}44, transparent 60%)`,
        }}
      />
      <div className="relative">
        <div className="mb-6 flex gap-1">
          {[p.accent, p.accent2, p.focus, p.rest].map((c, i) => (
            <span
              key={i}
              className="h-3 w-3 rounded-full ring-1 ring-black/20"
              style={{ background: c }}
            />
          ))}
        </div>
        <p className="text-xs font-semibold" style={{ color: p.ink }}>
          {preset.label}
        </p>
        <p className="text-[10px]" style={{ color: p.muted }}>
          {isLight(preset.theme.base) ? "Claro" : "Oscuro"}
        </p>
      </div>
    </button>
  );
}

export default function Appearance({ theme, setTheme }) {
  const t = useMemo(() => ({ ...DEFAULT_THEME, ...(theme || {}) }), [theme]);
  const palette = useMemo(() => buildPalette(t), [t]);

  /** Cualquier retoque manual desengancha el preset */
  const patch = (p, { keepPreset = false } = {}) =>
    setTheme({ ...t, ...p, preset: keepPreset ? t.preset : "custom" });

  const applyPreset = (preset) =>
    setTheme({ ...t, ...preset.theme, preset: preset.id });

  const activePreset = findPreset(t.preset);
  const imgOk = !!safeImageUrl(t.bgImage);

  return (
    <div className="card p-5">
      <p className="label">Apariencia</p>
      <p className="-mt-1 mb-4 text-xs text-muted">
        Los colores y el fondo se aplican al instante y quedan guardados en este dispositivo.
      </p>

      {/* ------------------------------------------------------------ presets */}
      <p className="mb-2 text-sm font-medium">Temas</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            active={t.preset === p.id}
            onClick={() => applyPreset(p)}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        {activePreset
          ? `Tema «${activePreset.label}».`
          : "Tema personalizado. Elegí uno de arriba para volver a un preset."}
      </p>

      {/* ------------------------------------------------------------ colores */}
      <div className="mt-6">
        <p className="mb-1 text-sm font-medium">Colores</p>
        <div className="rounded-xl border border-line/60 bg-surface2/40 px-3.5">
          {COLOR_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              desc={f.desc}
              value={t[f.key]}
              // el input de texto deja escribir un hex a medias sin repintar
              onChange={(v, valid) =>
                valid ? patch({ [f.key]: v }) : setTheme({ ...t, [f.key]: v })
              }
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Las superficies, los bordes y el texto apagado se calculan mezclando
          <b className="text-ink"> Fondo</b> y <b className="text-ink">Texto</b>.
        </p>
      </div>

      {/* ------------------------------------------------------------- fondo */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium">Fondo</p>
        <div className="flex flex-wrap gap-1.5">
          {BG_STYLES.map((b) => (
            <button
              key={b.id}
              onClick={() => patch({ bg: b.id })}
              title={b.desc}
              className={`chip ${t.bg === b.id ? "chip-on" : ""}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-line/60 bg-surface2/40 px-3.5">
          <Slider
            label={t.bg === "image" ? "Opacidad de la imagen" : "Intensidad"}
            value={t.bgIntensity}
            onChange={(v) => patch({ bgIntensity: v })}
            min={0}
            max={200}
            step={5}
            suffix="%"
          />
          {t.bg === "image" && (
            <>
              <Slider
                label="Desenfoque"
                value={t.bgBlur}
                onChange={(v) => patch({ bgBlur: v })}
                min={0}
                max={40}
                suffix="px"
              />
              <Slider
                label="Oscurecer"
                value={t.bgDim}
                onChange={(v) => patch({ bgDim: v })}
                min={0}
                max={95}
                suffix="%"
              />
            </>
          )}
        </div>

        {t.bg === "image" && (
          <div className="mt-3">
            <label className="label">URL de la imagen</label>
            <input
              type="url"
              value={t.bgImage}
              placeholder="https://…  ·  también sirve data:image/…"
              spellCheck={false}
              onChange={(e) => patch({ bgImage: e.target.value })}
              className="field"
            />
            {t.bgImage && !imgOk && (
              <p className="mt-1.5 text-xs text-focus">
                La URL tiene que empezar con http://, https:// o data:image/.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ preview */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium">Vista previa</p>
        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: palette.line, background: palette.surface }}
        >
          <div className="flex items-center gap-3 p-4">
            <div
              className="tnum text-3xl font-bold leading-none"
              style={{ color: palette.focus }}
            >
              25:00
            </div>
            <div className="ml-auto flex gap-2">
              <span
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ background: palette.accent, color: palette.onAccent }}
              >
                Empezar
              </span>
              <span
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{
                  borderColor: palette.line,
                  background: palette.surface2,
                  color: palette.ink,
                }}
              >
                Saltar
              </span>
            </div>
          </div>
          <div
            className="flex items-center gap-3 px-4 pb-4 text-xs"
            style={{ color: palette.muted }}
          >
            <span>Semana</span>
            <div
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: palette.surface3 }}
            >
              <div
                className="h-full w-2/3 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})`,
                }}
              />
            </div>
            <span style={{ color: palette.rest }}>+12%</span>
          </div>
        </div>
      </div>

      <button
        onClick={() => setTheme({ ...DEFAULT_THEME })}
        className="btn-quiet mt-4 px-0"
      >
        Restaurar apariencia
      </button>
    </div>
  );
}
