"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * El puente entre el navegador y la app de escritorio.
 *
 * La app abre el navegador en `/?escritorio=<estado>`. Acá, una vez que hay
 * sesión, se la devolvemos por un link `pomodoro://auth?...` con el mismo
 * `estado` que mandó. La cáscara comprueba que coincida y recién ahí acepta
 * los tokens (si no, cualquier página podría meterte en una cuenta ajena).
 *
 * Todo esto existe porque Google rechaza el login dentro de un navegador
 * embebido: hay que salir al navegador de verdad sí o sí.
 */

const CLAVE = "pf.login-escritorio";
const VENTANA_MS = 10 * 60 * 1000;

/**
 * Anota el pedido que vino en la URL y dice si hay uno en curso.
 *
 * Se guarda porque el login con Google se lleva la pestaña a accounts.google.com
 * y vuelve al origen pelado, sin el `?escritorio=`. Sin esta nota, al volver no
 * sabríamos que el login lo empezó la app.
 */
export function pedidoDeEscritorio() {
  if (typeof window === "undefined") return null;

  const estado = new URLSearchParams(window.location.search).get("escritorio");
  if (estado) {
    guardar({ estado, vence: Date.now() + VENTANA_MS });
    // la URL queda limpia: que no se comparta ni quede en el historial
    const limpia = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", limpia);
    return estado;
  }

  const anotado = leer();
  return anotado && anotado.vence > Date.now() ? anotado.estado : null;
}

export function olvidarPedido() {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    /* modo incógnito con storage bloqueado */
  }
}

function guardar(v) {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(v));
  } catch {
    /* idem */
  }
}

function leer() {
  try {
    return JSON.parse(window.localStorage.getItem(CLAVE) || "null");
  } catch {
    return null;
  }
}

export default function DesktopHandoff({ estado, onSeguirAca }) {
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [reintento, setReintento] = useState(false);

  const entregar = useCallback(async () => {
    const { data, error: err } = await supabase.auth.getSession();
    const s = data?.session;
    if (err || !s?.access_token || !s?.refresh_token) {
      setError("No pude leer la sesión. Probá cerrar sesión y entrar de nuevo.");
      return;
    }
    const url =
      `pomodoro://auth?estado=${encodeURIComponent(estado)}` +
      `&access_token=${encodeURIComponent(s.access_token)}` +
      `&refresh_token=${encodeURIComponent(s.refresh_token)}`;
    setLink(url);
    // El pedido se cumplió: si no lo borramos, la próxima vez que abras la web
    // en este navegador te volvería a mandar a la app.
    olvidarPedido();
    window.location.href = url; // Windows pregunta "¿Abrir Pomodoro?"

    // Si el navegador no hace nada (protocolo sin registrar, o cancelaste el
    // cartel), a los pocos segundos ofrecemos el botón a mano.
    setTimeout(() => setReintento(true), 2500);
  }, [estado]);

  useEffect(() => {
    entregar();
  }, [entregar]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(620px 420px at 50% 22%, rgb(var(--c-accent) / .22), transparent 65%)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fadeUp text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10">
          <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
        </div>

        <h1 className="text-xl font-extrabold tracking-tight">Listo, ya entraste</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Estamos pasándole la sesión a la app de escritorio. Deberías ver un cartel de
          Windows preguntando si abrís <b className="text-ink">Pomodoro</b>: decile que sí.
        </p>

        {error && (
          <p className="mt-5 rounded-xl border border-focus/40 bg-focus/10 p-3 text-xs font-medium text-focus">
            {error}
          </p>
        )}

        {reintento && !error && (
          <div className="card mt-6 p-4 text-left">
            <p className="text-xs leading-relaxed text-muted">
              ¿No pasó nada? Puede que el cartel se haya cerrado solo, o que la app no
              esté instalada todavía.
            </p>
            <a href={link} className="btn-primary mt-3 w-full text-sm">
              Abrir la app de escritorio
            </a>
          </div>
        )}

        <button onClick={onSeguirAca} className="btn-quiet mx-auto mt-4 text-xs">
          Seguir usándola acá, en el navegador
        </button>

        <p className="mt-6 text-[11px] leading-relaxed text-muted">
          Ya podés cerrar esta pestaña. La sesión queda guardada en la app: esto se hace
          una sola vez.
        </p>
      </div>
    </div>
  );
}
