"use client";

import { useRef, useState } from "react";
import { backend, exportAll, importAll, DEFAULT_SETTINGS } from "@/lib/db";
import { todayKey } from "@/lib/utils";

function Row({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/50 py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition ${on ? "bg-accent" : "bg-surface3"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Num({ value, onChange, min = 1, max = 600 }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      className="field w-20 text-center"
    />
  );
}

export default function Settings({ settings, setSettings, onChange }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");

  const set = (k, v) => setSettings({ ...settings, [k]: v });

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pomodoro-fabri-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file) => {
    try {
      const text = await file.text();
      await importAll(JSON.parse(text));
      await onChange();
      setMsg("Datos importados correctamente.");
    } catch (e) {
      setMsg("Error al importar: " + (e.message || e));
    }
    setTimeout(() => setMsg(""), 5000);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Ajustes</h2>
        <p className="text-sm text-muted">Se guardan en este dispositivo.</p>
      </div>

      <div className="card p-5">
        <p className="label">Duraciones</p>
        <p className="-mt-1 mb-2 text-xs text-muted">
          También podés cambiarlas tocando el número del reloj en la pestaña Timer.
        </p>
        <Row title="Enfoque" desc="minutos por pomodoro">
          <Num value={settings.focusMin} onChange={(v) => set("focusMin", v)} min={1} max={600} />
        </Row>
        <Row title="Descanso corto" desc="minutos · 0 = sin descanso">
          <Num value={settings.shortMin} onChange={(v) => set("shortMin", v)} min={0} />
        </Row>
        <Row title="Descanso largo" desc="minutos · 0 = sin descanso">
          <Num value={settings.longMin} onChange={(v) => set("longMin", v)} min={0} />
        </Row>
        <Row title="Descanso largo cada" desc="cantidad de pomodoros">
          <Num value={settings.longEvery} onChange={(v) => set("longEvery", v)} min={2} max={12} />
        </Row>
      </div>

      <div className="card p-5">
        <p className="label">Comportamiento</p>
        <Row title="Arrancar descansos solo" desc="al terminar un pomodoro">
          <Toggle on={settings.autoStartBreaks} onChange={(v) => set("autoStartBreaks", v)} />
        </Row>
        <Row title="Arrancar el siguiente pomodoro solo" desc="al terminar el descanso">
          <Toggle on={settings.autoStartFocus} onChange={(v) => set("autoStartFocus", v)} />
        </Row>
        <Row title="Pedir nota al terminar" desc="para anotar qué hiciste">
          <Toggle on={settings.askNote} onChange={(v) => set("askNote", v)} />
        </Row>
      </div>

      <div className="card p-5">
        <p className="label">Alertas</p>
        <Row title="Sonido" desc="alarma al terminar">
          <Toggle on={settings.sound} onChange={(v) => set("sound", v)} />
        </Row>
        <Row title="Volumen">
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={(e) => set("volume", Number(e.target.value))}
            className="w-28 accent-[#8b5cf6]"
          />
        </Row>
        <Row title="Notificaciones del navegador" desc="aunque estés en otra pestaña">
          <Toggle
            on={settings.notifications}
            onChange={(v) => {
              set("notifications", v);
              if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
                Notification.requestPermission();
              }
            }}
          />
        </Row>
      </div>

      <div className="card p-5">
        <p className="label">Datos</p>
        <div
          className={`mb-4 rounded-xl border p-3 text-xs ${
            backend === "supabase"
              ? "border-rest/30 bg-rest/10 text-rest"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          {backend === "supabase" ? (
            <>
              <b>Supabase conectado.</b> Tus datos se sincronizan entre todos tus dispositivos.
            </>
          ) : (
            <>
              <b>Modo local.</b> Los datos viven solo en este navegador. Configurá las variables
              NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY para sincronizar.
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={doExport} className="btn-ghost">
            Exportar JSON
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-ghost">
            Importar JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
          />
          <button
            onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
            className="btn-quiet"
          >
            Restaurar ajustes
          </button>
        </div>
        {msg && <p className="mt-3 text-sm font-semibold text-rest">{msg}</p>}
      </div>
    </div>
  );
}
