"use client";

import { useState } from "react";
import { friendlyError, sendPasswordReset, signIn, signUp } from "@/lib/auth";

export default function Auth() {
  const [tab, setTab] = useState("in"); // in | up
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const isUp = tab === "up";

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setInfo("");
    if (!email.trim() || !password) {
      setError("Completá el email y la contraseña.");
      return;
    }
    if (isUp && password.length < 6) {
      setError("La contraseña necesita al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      if (isUp) {
        const { needsConfirmation } = await signUp(email, password);
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
            Pomodoro{" "}
            <span className="bg-gradient-to-r from-accent via-focus to-accent2 bg-clip-text text-transparent">
              Fabri
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Entrá con tu cuenta y seguí tu pomodoro desde cualquier dispositivo.
          </p>
        </div>

        <div className="card p-5">
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
