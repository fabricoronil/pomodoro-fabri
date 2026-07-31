"use client";

import { useEffect, useRef, useState } from "react";
import { backend, exportAll, importAll, readLocalBackup, DEFAULT_SETTINGS } from "@/lib/db";
import {
  fullName,
  friendlyError,
  updateName,
  updatePassword,
  useAuth,
  useSignOut,
} from "@/lib/auth";
import { todayKey } from "@/lib/utils";
import { NumField } from "./ui";
import Appearance from "./Appearance";
import PushCard from "./PushCard";

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
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
          on ? "left-[22px] bg-onAccent" : "left-0.5 bg-ink/85"
        }`}
      />
    </button>
  );
}

function Num({ value, onChange, min = 1, max = 600 }) {
  return (
    <NumField value={value} onChange={onChange} min={min} max={max} className="w-32" />
  );
}

function Account({ email }) {
  const signOut = useSignOut();
  const { user } = useAuth();
  const current = fullName(user);
  const [name, setName] = useState(current);
  const [nameMsg, setNameMsg] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // si el nombre cambió en otra pestaña, seguimos lo que diga la sesión
  useEffect(() => setName(current), [current]);

  const saveName = async () => {
    setNameMsg("");
    setNameErr("");
    if (!name.trim()) {
      setNameErr("Escribí un nombre.");
      return;
    }
    setSavingName(true);
    try {
      await updateName(name);
      setNameMsg("Nombre actualizado.");
    } catch (e) {
      setNameErr(friendlyError(e));
    } finally {
      setSavingName(false);
    }
  };

  const change = async () => {
    setMsg("");
    setErr("");
    if (pass.length < 6) {
      setErr("La contraseña necesita al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(pass);
      setPass("");
      setMsg("Contraseña actualizada.");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <p className="label">Cuenta</p>
      <Row title="Sesión iniciada" desc={email}>
        <button onClick={signOut} className="btn-ghost text-xs">
          Cerrar sesión
        </button>
      </Row>
      <div className="border-b border-line/50 pt-3.5 pb-3.5">
        <p className="text-sm font-medium">Tu nombre</p>
        <p className="text-xs text-muted">Así te saluda la app al entrar.</p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            autoComplete="given-name"
            placeholder="Tu nombre"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={saveName}
            disabled={savingName || !name.trim() || name.trim() === current}
            className="btn-ghost shrink-0"
          >
            Guardar
          </button>
        </div>
        {nameErr && <p className="mt-2 text-xs font-semibold text-focus">{nameErr}</p>}
        {nameMsg && <p className="mt-2 text-xs font-semibold text-rest">{nameMsg}</p>}
      </div>

      <div className="pt-3.5">
        <p className="text-sm font-medium">Cambiar contraseña</p>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="nueva contraseña"
            className="field"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button onClick={change} disabled={busy || !pass} className="btn-ghost shrink-0">
            Cambiar
          </button>
        </div>
        {err && <p className="mt-2 text-xs font-semibold text-focus">{err}</p>}
        {msg && <p className="mt-2 text-xs font-semibold text-rest">{msg}</p>}
      </div>
    </div>
  );
}

const UPLOADED_KEY = "pf.localUploaded";

export default function Settings({ settings, setSettings, onChange, email, userId }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");
  const [uploaded, setUploaded] = useState(
    () => typeof window !== "undefined" && !!window.localStorage.getItem(UPLOADED_KEY)
  );

  const set = (k, v) => setSettings({ ...settings, [k]: v });

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pomodoro-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // datos que hayan quedado de la época sin cuentas, en este navegador
  const local = userId ? readLocalBackup() : { groups: [], sessions: [] };
  const hasLocal =
    (local.groups.length > 0 || local.sessions.length > 0) && !uploaded;

  const uploadLocal = async () => {
    try {
      await importAll(local);
      await onChange();
      window.localStorage.setItem(UPLOADED_KEY, "1");
      setUploaded(true);
      setMsg("Listo: los datos de este navegador quedaron en tu cuenta.");
    } catch (e) {
      setMsg("Error al subir: " + (e.message || e));
    }
    setTimeout(() => setMsg(""), 6000);
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
        <p className="text-sm text-muted">
          {userId
            ? "Todo vive en tu cuenta: los ajustes, los grupos, las sesiones y el pomodoro en curso. Cambiás algo acá y te sigue a cualquier dispositivo."
            : "Las preferencias se guardan en este navegador. Configurá Supabase para que te sigan entre dispositivos."}
        </p>
      </div>

      {userId && <Account email={email} />}

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
        <p className="label">Metas</p>
        <p className="-mt-1 mb-2 text-xs text-muted">
          Las metas y los límites (diarios y semanales) se ponen por grupo, en la
          pestaña Grupos.
        </p>
        <Row title="Meta de sueño" desc="horas por noche · la línea del gráfico y la deuda salen de acá">
          <NumField
            value={settings.sleepGoalHours}
            onChange={(v) => set("sleepGoalHours", v)}
            min={4}
            max={14}
            step={0.5}
            suffix="h"
            className="w-32"
          />
        </Row>
      </div>

      <Appearance theme={settings.theme} setTheme={(t) => set("theme", t)} />

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
            className="w-28"
            style={{ accentColor: "rgb(var(--c-accent))" }}
          />
        </Row>
        <Row title="Notificaciones del navegador" desc="con la web abierta, aunque estés en otra pestaña">
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

      {userId && <PushCard userId={userId} />}

      <div className="card p-5">
        <p className="label">Datos</p>
        <div
          className={`mb-4 rounded-xl border p-3 text-xs ${
            backend === "supabase"
              ? "border-rest/30 bg-rest/10 text-rest"
              : "border-warn/40 bg-warn/10 text-warn"
          }`}
        >
          {backend === "supabase" ? (
            <>
              <b>Supabase conectado.</b> Tus datos y el timer se sincronizan entre todos tus
              dispositivos: podés cerrar la web y el pomodoro sigue corriendo.
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
        {hasLocal && (
          <div className="mt-4 rounded-xl border border-line bg-surface2/50 p-3">
            <p className="text-xs text-muted">
              Encontré datos guardados solo en este navegador ({local.groups.length} grupos ·{" "}
              {local.sessions.length} sesiones), de antes de tener cuenta.
            </p>
            <button onClick={uploadLocal} className="btn-ghost mt-2 text-xs">
              Subirlos a mi cuenta
            </button>
          </div>
        )}
        {msg && <p className="mt-3 text-sm font-semibold text-rest">{msg}</p>}
      </div>
    </div>
  );
}
