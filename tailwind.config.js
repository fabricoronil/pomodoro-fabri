/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Cada color apunta a una variable CSS con los canales RGB sueltos
      // (ver lib/theme.js). Así el tema se puede cambiar en caliente sin perder
      // la sintaxis de opacidad de Tailwind (bg-accent/15, border-line/50, …).
      colors: {
        base: "rgb(var(--c-base) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        surface2: "rgb(var(--c-surface2) / <alpha-value>)",
        surface3: "rgb(var(--c-surface3) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        accent2: "rgb(var(--c-accent2) / <alpha-value>)",
        focus: "rgb(var(--c-focus) / <alpha-value>)",
        rest: "rgb(var(--c-rest) / <alpha-value>)",
        rest2: "rgb(var(--c-rest2) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        onAccent: "rgb(var(--c-onAccent) / <alpha-value>)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        glow: {
          "0%, 100%": { opacity: ".3" },
          "50%": { opacity: ".7" },
        },
      },
      animation: {
        fadeUp: "fadeUp .7s cubic-bezier(.16,1,.3,1) both",
        pop: "pop .5s cubic-bezier(.16,1,.3,1) both",
        glow: "glow 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
