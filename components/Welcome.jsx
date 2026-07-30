"use client";

import { useEffect, useState } from "react";

const NAME = "Fabri";

export default function Welcome({ onDone }) {
  const [step, setStep] = useState(0); // 0 saludo · 1 frase · 2 saliendo

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1500);
    const t2 = setTimeout(() => setStep(2), 3100);
    const t3 = setTimeout(() => onDone?.(), 3800);
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, [onDone]);

  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? "Buenas noches" : hour < 13 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <div
      onClick={() => onDone?.()}
      className={`fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center bg-base transition-all duration-700 ${
        step === 2 ? "pointer-events-none scale-105 opacity-0" : "opacity-100"
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0 animate-glow"
        style={{
          background:
            "radial-gradient(600px 400px at 50% 45%, rgb(var(--c-accent) / .28), transparent 65%)",
        }}
      />

      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10 animate-pop">
          <div className="h-6 w-6 rounded-full border-[3px] border-accent border-t-transparent" />
        </div>

        <h1
          className={`text-4xl font-extrabold tracking-tight transition-all duration-700 sm:text-6xl ${
            step === 0 ? "animate-fadeUp" : "-translate-y-1 opacity-90"
          }`}
        >
          <span className="text-muted">{greeting}, </span>
          <span className="bg-gradient-to-r from-accent via-focus to-accent2 bg-clip-text text-transparent">
            {`Bienvenido ${NAME}`}
          </span>
        </h1>

        <p
          className={`mt-6 text-lg font-semibold tracking-[.2em] text-ink/90 transition-all duration-700 sm:text-2xl ${
            step >= 1 ? "animate-fadeUp" : "translate-y-3 opacity-0"
          }`}
        >
          ES HORA DE TRABAJAR
        </p>

        <div
          className={`mt-10 h-[2px] w-56 overflow-hidden rounded-full bg-surface3 transition-opacity duration-500 ${
            step >= 1 ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent2"
            style={{
              width: step >= 1 ? "100%" : "0%",
              transition: "width 1.6s cubic-bezier(.16,1,.3,1)",
            }}
          />
        </div>

        <p className="mt-8 text-[11px] uppercase tracking-[.2em] text-muted/60">
          tocá para entrar
        </p>
      </div>
    </div>
  );
}
