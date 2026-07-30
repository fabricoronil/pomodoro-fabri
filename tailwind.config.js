/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#07080d",
        surface: "#10131c",
        surface2: "#171b27",
        surface3: "#1f2534",
        line: "#262c3d",
        ink: "#e9ecf6",
        muted: "#8e95ad",
        accent: "#8b5cf6",
        accent2: "#22d3ee",
        focus: "#f0616d",
        rest: "#34d399",
        rest2: "#38bdf8",
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
