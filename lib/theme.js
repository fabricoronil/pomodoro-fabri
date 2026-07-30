"use client";

import { useSyncExternalStore } from "react";

/**
 * Sistema de temas.
 *
 * Todos los colores de Tailwind (bg-accent, text-ink, border-line, …) apuntan a
 * variables CSS `--c-*` que guardan los canales RGB sueltos ("139 92 246"), así
 * que sigue funcionando la sintaxis de opacidad (`bg-accent/15`).
 * Cambiar el tema es simplemente reescribir esas variables en <html>.
 */

// ------------------------------------------------------------------ helpers

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const p = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Mezcla dos colores hex. t=0 → a, t=1 → b */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
}

/** Luminancia relativa aproximada (0 oscuro … 1 claro) */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isLight = (hex) => luminance(hex) > 0.45;

/**
 * Texto legible sobre un color. El empate matemático de contraste WCAG está en
 * 0.179, pero ahí los acentos saturados (violeta, azul) quedan con texto negro
 * y se ven mal; 0.35 los deja en blanco y manda a negro solo los pasteles.
 */
export const readableOn = (hex) => (luminance(hex) > 0.35 ? "#0b0d14" : "#ffffff");

const channels = (hex) => hexToRgb(hex).join(" ");

// ------------------------------------------------------------------ presets

export const BG_STYLES = [
  { id: "aurora", label: "Aurora", desc: "Halos difusos en las esquinas" },
  { id: "mesh", label: "Malla", desc: "Degradado tipo mesh, más saturado" },
  { id: "beams", label: "Haces", desc: "Franjas diagonales suaves" },
  { id: "grid", label: "Cuadrícula", desc: "Rejilla técnica con brillo central" },
  { id: "dots", label: "Puntos", desc: "Trama de puntos sutil" },
  { id: "vignette", label: "Viñeta", desc: "Foco central, bordes oscuros" },
  { id: "solid", label: "Sólido", desc: "Sin textura, solo el color de fondo" },
  { id: "image", label: "Imagen", desc: "Una URL de imagen propia" },
];

export const PRESETS = [
  {
    id: "violeta",
    label: "Violeta",
    theme: {
      base: "#07080d",
      ink: "#e9ecf6",
      accent: "#8b5cf6",
      accent2: "#22d3ee",
      focus: "#f0616d",
      rest: "#34d399",
      bg: "aurora",
    },
  },
  {
    id: "medianoche",
    label: "Medianoche",
    theme: {
      base: "#05070f",
      ink: "#dfe7fb",
      accent: "#3b82f6",
      accent2: "#38bdf8",
      focus: "#fb7185",
      rest: "#2dd4bf",
      bg: "beams",
    },
  },
  {
    id: "bosque",
    label: "Bosque",
    theme: {
      base: "#060c0a",
      ink: "#e2f0e9",
      accent: "#10b981",
      accent2: "#84cc16",
      focus: "#f59e0b",
      rest: "#34d399",
      bg: "mesh",
    },
  },
  {
    id: "atardecer",
    label: "Atardecer",
    theme: {
      base: "#120a09",
      ink: "#fbeae3",
      accent: "#fb7185",
      accent2: "#fbbf24",
      focus: "#f43f5e",
      rest: "#fcd34d",
      bg: "mesh",
    },
  },
  {
    id: "carbon",
    label: "Carbón",
    theme: {
      base: "#0c0c0d",
      ink: "#ededf0",
      accent: "#a1a1aa",
      accent2: "#71717a",
      focus: "#e4e4e7",
      rest: "#a3a3a3",
      bg: "grid",
    },
  },
  {
    id: "neon",
    label: "Neón",
    theme: {
      base: "#06020e",
      ink: "#f2e9ff",
      accent: "#d946ef",
      accent2: "#22d3ee",
      focus: "#fb7185",
      rest: "#4ade80",
      bg: "beams",
    },
  },
  {
    id: "papel",
    label: "Papel",
    theme: {
      base: "#f6f5f1",
      ink: "#1c1a17",
      accent: "#7c3aed",
      accent2: "#0891b2",
      focus: "#dc2626",
      rest: "#15803d",
      bg: "dots",
    },
  },
  {
    id: "nube",
    label: "Nube",
    theme: {
      base: "#eef2f9",
      ink: "#111827",
      accent: "#2563eb",
      accent2: "#0ea5e9",
      focus: "#e11d48",
      rest: "#059669",
      bg: "aurora",
    },
  },
];

export const DEFAULT_THEME = {
  preset: "violeta",
  ...PRESETS[0].theme,
  bgIntensity: 100, // 0–200 %
  bgImage: "",
  bgBlur: 0, // px de desenfoque sobre la imagen
  bgDim: 55, // % de oscurecido sobre la imagen
};

export const findPreset = (id) => PRESETS.find((p) => p.id === id);

// ------------------------------------------------------------- derivación

/**
 * A partir de `base` (fondo) e `ink` (texto) deriva las superficies y líneas,
 * para que cualquier color de fondo elegido a mano quede coherente.
 */
export function buildPalette(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const { base, ink } = t;
  const light = isLight(base);

  // En oscuro las tarjetas se "elevan" aclarándose hacia el texto; en claro pasa
  // al revés (las tarjetas van hacia el blanco y el fondo queda más gris).
  const surface = light ? mix(base, "#ffffff", 0.8) : mix(base, ink, 0.05);
  const surface2 = light ? mix(base, "#ffffff", 0.45) : mix(base, ink, 0.085);
  const surface3 = mix(base, ink, light ? 0.12 : 0.14);

  return {
    base,
    surface,
    surface2,
    surface3,
    line: mix(base, ink, light ? 0.15 : 0.19),
    ink,
    muted: mix(base, ink, light ? 0.62 : 0.58),
    accent: t.accent,
    accent2: t.accent2,
    focus: t.focus,
    rest: t.rest,
    rest2: mix(t.rest, t.accent2, 0.5),
    // ámbar de aviso, más oscuro en temas claros para que se lea
    warn: light ? "#b45309" : "#fbbf24",
    onAccent: readableOn(t.accent),
  };
}

// ------------------------------------------------------------------ aplicar

/**
 * Acepta solo http(s) y data:image, y saca los caracteres que romperían el
 * `url("…")` del CSS.
 */
export function safeImageUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (!/^(https?:\/\/|data:image\/)/i.test(s)) return "";
  return s.replace(/["'\\\s()]/g, (c) => encodeURIComponent(c));
}

const listeners = new Set();
let version = 0;

/** Escribe el tema en <html> como variables CSS y atributos de fondo. */
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const p = buildPalette(t);
  const root = document.documentElement;

  Object.entries(p).forEach(([k, v]) => {
    root.style.setProperty(`--c-${k}`, channels(v));
  });

  root.style.setProperty("--bg-intensity", String(clamp(t.bgIntensity, 0, 200) / 100));
  root.style.setProperty("--bg-a", isLight(t.base) ? "1.6" : "1");
  root.style.setProperty("--bg-blur", `${clamp(t.bgBlur, 0, 40)}px`);
  root.style.setProperty("--bg-dim", String(clamp(t.bgDim, 0, 95) / 100));
  const img = safeImageUrl(t.bgImage);
  root.style.setProperty("--bg-image", t.bg === "image" && img ? `url("${img}")` : "none");
  root.dataset.bg = t.bg === "image" && !img ? "solid" : t.bg;
  root.style.colorScheme = isLight(t.base) ? "light" : "dark";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.base);

  version++;
  listeners.forEach((fn) => fn());
}

// ---------------------------------------------- leer colores desde JS (charts)

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getVersion = () => version;

/** Se re-renderiza cuando cambia el tema. Devuelve un número que va subiendo. */
export function useThemeVersion() {
  return useSyncExternalStore(subscribe, getVersion, () => 0);
}

const FALLBACK = buildPalette(DEFAULT_THEME);

/** Color del tema actual en hex, para librerías que no entienden CSS vars. */
export function themeColor(name) {
  if (typeof document === "undefined") return FALLBACK[name] || "#8b5cf6";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--c-${name}`)
    .trim();
  if (!raw) return FALLBACK[name] || "#8b5cf6";
  const [r, g, b] = raw.split(/[\s,]+/).map(Number);
  return rgbToHex([r, g, b]);
}

/** Igual que themeColor pero con transparencia: rgba(...) */
export function themeColorA(name, alpha) {
  const [r, g, b] = hexToRgb(themeColor(name));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Hook cómodo: devuelve la paleta actual como hex, reactiva al tema. */
export function useThemePalette() {
  useThemeVersion();
  const names = [
    "base", "surface", "surface2", "surface3", "line",
    "ink", "muted", "accent", "accent2", "focus", "rest", "rest2", "onAccent",
  ];
  return Object.fromEntries(names.map((n) => [n, themeColor(n)]));
}
