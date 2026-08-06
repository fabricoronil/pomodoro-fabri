"use client";

import { useEffect, useState } from "react";
import {
  friendlyError,
  sendPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
} from "@/lib/auth";
import { DESKTOP_VERSION, SETUP_URL } from "@/lib/install";

/** Logotipo de Google, con sus cuatro colores oficiales */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.2v5.7C7.8 41.1 15.3 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 28.2c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-5.7H4.2C2.6 16.8 1.7 20.3 1.7 23.8s.9 7 2.5 10.1l7.4-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.3c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 3.8 30 1.7 24 1.7 15.3 1.7 7.8 6.6 4.2 13.7l7.4 5.7C13.3 14.2 18.2 10.3 24 10.3z"
      />
    </svg>
  );
}

export default function Auth() {
  const [tab, setTab] = useState("in"); // in | up
  // Adentro de la app de escritorio el botón de Google no sirve: Google corta
  // el login en navegadores embebidos. Ahí se sale al navegador de verdad.
  //
  // Ojo con "escritorio" a secas: la web se actualiza sola en cada arranque,
  // pero la cáscara no. Una v1.0.0 instalada carga esta misma página sin tener
  // idea de qué es `abrirLogin`, así que hay que preguntar por la función y no
  // solo por isDesktop. Si no, el botón aparece y explota al tocarlo.
  const [escritorio, setEscritorio] = useState({ es: false, sabeAbrirLogin: false });
  const [esperandoNavegador, setEsperandoNavegador] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const isUp = tab === "up";

  useEffect(() => {
    const d = window.pomodoroDesktop;
    setEscritorio({
      es: !!d?.isDesktop,
      sabeAbrirLogin: typeof d?.abrirLogin === "function",
    });
  }, []);

  // Si Google rebota, Supabase vuelve con el motivo en el fragmento de la URL.
  // Sin esto la pantalla se queda muda y parece que no pasó nada.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("error")) return;
    const p = new URLSearchParams(hash.slice(1));
    const desc = p.get("error_description") || p.get("error");
    if (desc) setError(decodeURIComponent(desc.replace(/\+/g, " ")));
    history.replaceState(null, "", window.location.pathname);
  }, []);

  const withGoogle = async () => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await signInWithGoogle(); // se va a Google; vuelve con la sesión hecha
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  const enNavegador = async () => {
    setError("");
    setInfo("");
    setEsperandoNavegador(true);
    try {
      await window.pomodoroDesktop.abrirLogin();
    } catch {
      setError(
        "No pude abrir el navegador. Entrá a pomodoro-fabri.vercel.app a mano y logueate ahí."
      );
      setEsperandoNavegador(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setInfo("");
    if (!email.trim() || !password) {
      setError("Completá el email y la contraseña.");
      return;
    }
    if (isUp && !name.trim()) {
      setError("Escribí tu nombre para saber cómo llamarte.");
      return;
    }
    if (isUp && password.length < 6) {
      setError("La contraseña necesita al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      if (isUp) {
        const { needsConfirmation } = await signUp(email, password, name);
        if (needsConfirmation) {
          setInfo(
            "Cuenta creada. Te mandamos un mail para confirmarla: abrilo y volvé a entrar."
          );
          setTab("in");
        }
        // si no pide confirmación, el AuthProvider ya recibe la sesión
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Escribí tu email primero y volvé a tocar acá.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setInfo("Te mandamos un mail para reestablecer la contraseña.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(620px 420px at 50% 22%, rgb(var(--c-accent) / .22), transparent 65%)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fadeUp">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10">
            <div className="h-5 w-5 rounded-full border-[3px] border-accent border-t-transparent" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-accent via-focus to-accent2 bg-clip-text text-transparent">
              Pomodoro
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Entrá con tu cuenta y seguí tu pomodoro desde cualquier dispositivo.
          </p>
        </div>

        <div className="card p-5">
          {escritorio.es && !escritorio.sabeAbrirLogin ? (
            // Cáscara vieja: no sabe abrir el navegador ni recibir la sesión de
            // vuelta, y Google no la deja entrar desde adentro. Sin actualizar
            // no hay forma; el mail y contraseña de abajo sí le funciona.
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-warn">
              <b>Tu app de escritorio quedó vieja.</b> Esta versión no sabe abrir el
              navegador para iniciar sesión, así que con Google no vas a poder entrar
              desde acá.
              <a href={SETUP_URL} className="btn-primary mt-3 w-full text-sm">
                Descargar la versión {DESKTOP_VERSION}
              </a>
              <p className="mt-2 text-[11px] opacity-80">
                Se instala encima de la que tenés. Mientras tanto, podés entrar con tu
                email y contraseña acá abajo.
              </p>
            </div>
          ) : escritorio.es ? (
            <>
              <button
                type="button"
                onClick={enNavegador}
                disabled={busy}
                className="btn-primary w-full py-3"
              >
                {esperandoNavegador ? "Esperando el navegador…" : "Iniciar sesión en el navegador"}
              </button>
              <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted">
                {esperandoNavegador ? (
                  <>
                    Terminá de entrar en la pestaña que se abrió y volvé acá: la sesión
                    aparece sola. Si no se abrió nada, tocá el botón de nuevo.
                  </>
                ) : (
                  <>
                    Se abre tu navegador, entrás con Google o con tu email, y la app queda
                    logueada sola. Google no permite hacerlo desde acá adentro.
                  </>
                )}
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={withGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm font-semibold text-ink transition hover:bg-surface3 disabled:opacity-60"
            >
              <GoogleMark />
              Continuar con Google
            </button>
          )}

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] uppercase tracking-[.18em] text-muted">o</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="mb-5 flex gap-1 rounded-xl border border-line bg-surface2/60 p-1">
            {[
              { id: "in", label: "Iniciar sesión" },
              { id: "up", label: "Crear cuenta" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setError("");
                  setInfo("");
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  tab === t.id ? "bg-accent text-onAccent" : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            {isUp && (
              <>
                <label className="label" htmlFor="pf-name">
                  Nombre
                </label>
                <input
                  id="pf-name"
                  type="text"
                  autoComplete="given-name"
                  className="field mb-4"
                  placeholder="¿Cómo te llamamos?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            )}

            <label className="label" htmlFor="pf-email">
              Email
            </label>
            <input
              id="pf-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              className="field"
              placeholder="vos@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="label mt-4" htmlFor="pf-pass">
              Contraseña
            </label>
            <input
              id="pf-pass"
              type="password"
              autoComplete={isUp ? "new-password" : "current-password"}
              className="field"
              placeholder={isUp ? "mínimo 6 caracteres" : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && (
              <p className="mt-4 rounded-xl border border-focus/40 bg-focus/10 p-3 text-xs font-medium text-focus">
                {error}
              </p>
            )}
            {info && (
              <p className="mt-4 rounded-xl border border-rest/40 bg-rest/10 p-3 text-xs font-medium text-rest">
                {info}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary mt-5 w-full py-3">
              {busy ? "Un segundo…" : isUp ? "Crear cuenta" : "Entrar"}
            </button>
          </form>

          {!isUp && (
            <button
              type="button"
              onClick={forgot}
              disabled={busy}
              className="btn-quiet mt-2 w-full text-xs"
            >
              Olvidé mi contraseña
            </button>
          )}
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted">
          Tus grupos, sesiones y el pomodoro en curso quedan guardados en tu cuenta.
          Podés cerrar la web: el timer sigue corriendo.
        </p>
      </div>
    </div>
  );
}
