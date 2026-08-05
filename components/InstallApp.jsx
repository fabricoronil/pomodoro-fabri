"use client";

import { useEffect, useState } from "react";
import {
  DESKTOP_VERSION,
  PORTABLE_URL,
  RELEASES_URL,
  SETUP_URL,
  installState,
  promptInstall,
  subscribeInstall,
} from "@/lib/install";

/**
 * "Tenerla como app".
 *
 * Muestra una cosa distinta según dónde estés parado, porque el botón útil no
 * es el mismo: en Windows el .exe, en el resto la PWA, y adentro de la propia
 * cáscara nada (ya la tenés instalada).
 */
export default function InstallApp() {
  // arranca en null a propósito: el primer render lo hace el servidor, donde no
  // hay navigator ni beforeinstallprompt. Si adivinara acá, la hidratación no
  // coincidiría con el HTML que ya vino.
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setSt(installState());
    return subscribeInstall(() => setSt(installState()));
  }, []);

  if (!st) {
    return (
      <div className="card p-5">
        <p className="label">Tenerla como app</p>
        <p className="text-xs text-muted">Revisando…</p>
      </div>
    );
  }

  const { desktop, os, canPrompt, standalone, justInstalled } = st;

  // ---------------------------------------------- ya estás en la de escritorio
  if (desktop) {
    return (
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label mb-1">App de escritorio</p>
            <p className="text-xs leading-relaxed text-muted">
              Estás usándola. La ventana es una cáscara: el contenido lo baja del deploy
              en cada arranque, así que <b className="text-ink">se actualiza sola</b> y no
              hay que reinstalar nada cuando sale algo nuevo.
            </p>
          </div>
          <span className="chip chip-on shrink-0">
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--c-rest))" }} />
            Instalada
          </span>
        </div>
        <p className="mt-4 border-t border-line/50 pt-3 text-[11px] leading-relaxed text-muted">
          Versión de la cáscara: <b className="text-ink">{desktop.version || "?"}</b>
          {desktop.version && desktop.version !== DESKTOP_VERSION && (
            <>
              {" "}· hay una más nueva ({DESKTOP_VERSION}).{" "}
              <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline">
                Bajarla
              </a>
            </>
          )}
          . Solo hace falta actualizarla si cambia la ventana en sí (el menú, las
          notificaciones nativas), no cuando cambia la web.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------ resto
  const install = async () => {
    const ok = await promptInstall();
    setMsg(
      ok
        ? "Listo, quedó instalada. Buscala en el menú Inicio."
        : "Quedó pendiente. Podés instalarla cuando quieras desde el icono de la barra de direcciones."
    );
    setTimeout(() => setMsg(""), 6000);
  };

  const yaEsPwa = standalone || justInstalled;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label mb-1">Tenerla como app</p>
          <p className="text-xs leading-relaxed text-muted">
            Ventana propia, sin barra del navegador, con su icono en el escritorio y en
            Inicio. Los datos son los mismos: es la misma cuenta.
          </p>
        </div>
        {yaEsPwa && (
          <span className="chip chip-on shrink-0">
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--c-rest))" }} />
            Instalada
          </span>
        )}
      </div>

      {os === "windows" ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a href={SETUP_URL} className="btn-primary text-sm">
              <Flecha /> Descargar para Windows
            </a>
            {canPrompt && !yaEsPwa && (
              <button onClick={install} className="btn-ghost text-sm">
                O instalar desde el navegador
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Instalador · {DESKTOP_VERSION} · 75 MB · Windows 64 bits. ¿No querés instalar nada?{" "}
            <a href={PORTABLE_URL} className="underline hover:text-ink">
              versión portable
            </a>{" "}
            (un solo archivo, lo abrís y listo).
          </p>
          <div className="mt-4 border-t border-line/50 pt-3 text-[11px] leading-relaxed text-muted">
            <p>
              El ejecutable no está firmado con certificado de código, así que Windows puede
              mostrar <i>"Windows protegió tu PC"</i>. Es esperable:{" "}
              <b className="text-ink">Más información → Ejecutar de todas formas</b>.
            </p>
            <p className="mt-1.5">
              Una vez instalada se actualiza sola: carga la web del deploy en cada arranque.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canPrompt && !yaEsPwa ? (
              <button onClick={install} className="btn-primary text-sm">
                <Flecha /> Instalar app
              </button>
            ) : (
              !yaEsPwa && <p className="text-xs text-muted">{COMO_INSTALAR[os] || COMO_INSTALAR.other}</p>
            )}
          </div>
          <p className="mt-3 border-t border-line/50 pt-3 text-[11px] leading-relaxed text-muted">
            El ejecutable propio existe solo para Windows por ahora. En{" "}
            {os === "mac" ? "Mac" : os === "ios" ? "iPhone y iPad" : os === "android" ? "Android" : "este sistema"}{" "}
            se instala desde el navegador y queda igual de separada.{" "}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline hover:text-ink">
              Descargas de Windows
            </a>
            .
          </p>
        </>
      )}

      {msg && <p className="mt-3 text-xs font-semibold text-rest">{msg}</p>}
    </div>
  );
}

/**
 * El mismo botón, pero chiquito, para el header.
 *
 * Aparece solo si tiene sentido: en Windows, con la web abierta en un navegador
 * de verdad. Adentro de la cáscara o con la PWA ya instalada no se muestra
 * nada — sería ofrecerte algo que ya tenés.
 */
export function DownloadButton() {
  const [st, setSt] = useState(null); // ver el comentario de arriba sobre la hidratación

  useEffect(() => {
    setSt(installState());
    return subscribeInstall(() => setSt(installState()));
  }, []);

  if (!st || st.desktop || st.standalone || st.justInstalled || st.os !== "windows") return null;

  return (
    <a
      href={SETUP_URL}
      title={`Descargar la app de escritorio · ${DESKTOP_VERSION} · 75 MB`}
      className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface2/70 px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface3 hover:text-ink sm:inline-flex"
    >
      <Flecha />
      Descargar app
    </a>
  );
}

/** Cuando el navegador no ofrece el prompt hay que explicarlo a mano. */
const COMO_INSTALAR = {
  ios: "En Safari: botón de compartir → Agregar a inicio.",
  mac: "En Chrome o Edge: icono de instalar en la barra de direcciones (o menú ⋮ → Aplicaciones → Instalar).",
  android: "En Chrome: menú ⋮ → Instalar aplicación / Agregar a la pantalla principal.",
  linux: "En Chrome o Edge: icono de instalar en la barra de direcciones.",
  other: "En Chrome o Edge: icono de instalar en la barra de direcciones.",
};

function Flecha() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
