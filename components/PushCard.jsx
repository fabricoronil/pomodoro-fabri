"use client";

import { useCallback, useEffect, useState } from "react";
import {
  countSubscriptions,
  disablePush,
  enablePush,
  getPushState,
  pushConfigured,
} from "@/lib/push";

/**
 * "Avisarme aunque la web esté cerrada".
 *
 * El timer ya seguía corriendo con la web cerrada; lo que faltaba era el
 * aviso. Acá se suscribe este dispositivo: el servidor mira el reloj y manda
 * la notificación aunque no haya ninguna pestaña abierta.
 *
 * La suscripción es POR DISPOSITIVO: hay que activarlo una vez en la compu y
 * una vez en el celular. El aviso llega a todos los que estén suscriptos.
 */
export default function PushCard({ userId }) {
  const [state, setState] = useState(null);
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setState(await getPushState());
    setDevices(await countSubscriptions(userId));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const activar = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await enablePush(userId);
      if (res.ok) {
        setMsg("Listo. Ya podés cerrar la web: el aviso te va a llegar igual.");
      } else {
        setErr(MOTIVOS[res.reason] || "No se pudo activar.");
      }
    } catch (e) {
      setErr(e.message || String(e));
    }
    await load();
    setBusy(false);
    setTimeout(() => setMsg(""), 6000);
  };

  const desactivar = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await disablePush(userId);
      setMsg("Este dispositivo ya no recibe avisos.");
    } catch (e) {
      setErr(e.message || String(e));
    }
    await load();
    setBusy(false);
    setTimeout(() => setMsg(""), 6000);
  };

  if (!state) {
    return (
      <div className="card p-5">
        <p className="label">Avisarme aunque la web esté cerrada</p>
        <p className="text-xs text-muted">Revisando…</p>
      </div>
    );
  }

  const { supported, permission, subscribed, needsHomeScreen } = state;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label mb-1">Avisarme aunque la web esté cerrada</p>
          <p className="text-xs leading-relaxed text-muted">
            El pomodoro ya sigue corriendo con la web cerrada. Activando esto, además{" "}
            <b className="text-ink">te llega la notificación</b> cuando termina, sin tener
            ninguna pestaña abierta.
          </p>
        </div>
        <span
          className={`chip shrink-0 ${subscribed ? "chip-on" : ""}`}
          title="Estado en este dispositivo"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: subscribed ? "rgb(var(--c-rest))" : "rgb(var(--c-surface3))" }}
          />
          {subscribed ? "Activado" : "Apagado"}
        </span>
      </div>

      {/* ------------------------------- casos en los que no se puede ------- */}

      {!pushConfigured && (
        <Aviso tono="warn">
          Falta configurar las claves VAPID. Poné <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> en el
          entorno del front y <code>VAPID_PRIVATE_KEY</code> en los secretos de Supabase (está
          explicado en el README).
        </Aviso>
      )}

      {pushConfigured && !supported && (
        <Aviso tono="warn">
          Este navegador no soporta notificaciones push. Probá con Chrome, Edge, Firefox o Safari
          actualizado.
        </Aviso>
      )}

      {pushConfigured && supported && needsHomeScreen && (
        <Aviso tono="warn">
          En iPhone y iPad los avisos solo funcionan desde <b>iOS 16.4</b> en adelante y con la app{" "}
          <b>agregada a la pantalla de inicio</b>. Abrí el menú de compartir en Safari →{" "}
          <i>Agregar a inicio</i>, y activalo desde ahí.
        </Aviso>
      )}

      {pushConfigured && supported && !needsHomeScreen && permission === "denied" && (
        <Aviso tono="warn">
          Bloqueaste las notificaciones para este sitio, así que el navegador ni siquiera me deja
          preguntarte. Tocá el candado (o el ícono de ajustes) a la izquierda de la barra de
          direcciones → <i>Notificaciones</i> → <b>Permitir</b>, y recargá la página.
        </Aviso>
      )}

      {/* ---------------------------------------------------- botones ------ */}

      {pushConfigured && supported && !needsHomeScreen && permission !== "denied" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {subscribed ? (
            <button onClick={desactivar} disabled={busy} className="btn-ghost text-sm">
              {busy ? "Dando de baja…" : "Desactivar en este dispositivo"}
            </button>
          ) : (
            <button onClick={activar} disabled={busy} className="btn-primary text-sm">
              {busy ? "Activando…" : "Activar en este dispositivo"}
            </button>
          )}
          <button onClick={load} disabled={busy} className="btn-quiet text-sm">
            Revisar estado
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- detalle ------ */}

      <div className="mt-4 border-t border-line/50 pt-3 text-[11px] leading-relaxed text-muted">
        <p>
          Dispositivos suscriptos en tu cuenta: <b className="text-ink">{devices}</b>. Hay que
          activarlo una vez por dispositivo; el aviso llega a todos.
        </p>
        <p className="mt-1.5">
          El aviso puede tardar <b className="text-ink">hasta un minuto</b> en llegar: el servidor
          revisa los pomodoros vencidos una vez por minuto. La sesión, en cambio, siempre queda
          guardada con la hora exacta en la que terminó.
        </p>
        <p className="mt-1.5">
          Si tenés la app a la vista no te va a llegar la notificación del servidor: ya te avisa la
          página con el sonido, no tiene sentido avisarte dos veces.
        </p>
      </div>

      {err && <p className="mt-3 text-xs font-semibold text-focus">{err}</p>}
      {msg && <p className="mt-3 text-xs font-semibold text-rest">{msg}</p>}
    </div>
  );
}

const MOTIVOS = {
  unsupported: "Este navegador no soporta notificaciones push.",
  unconfigured: "Faltan las claves VAPID (mirá el README).",
  "no-account": "Necesitás una cuenta para recibir avisos con la web cerrada.",
  "home-screen": "En iPhone/iPad hay que agregar la app a la pantalla de inicio primero.",
  denied: "Rechazaste el permiso. Habilitalo desde el candado de la barra de direcciones.",
  default: "No diste el permiso todavía. Volvé a intentar y elegí «Permitir».",
};

function Aviso({ tono = "warn", children }) {
  const clases =
    tono === "warn"
      ? "border-warn/40 bg-warn/10 text-warn"
      : "border-rest/30 bg-rest/10 text-rest";
  return (
    <div className={`mt-4 rounded-xl border p-3 text-xs leading-relaxed ${clases}`}>{children}</div>
  );
}
