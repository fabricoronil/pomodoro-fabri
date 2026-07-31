"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";
import { setCurrentUserId } from "./db";

/**
 * Sesión de usuario sobre Supabase Auth (email + contraseña).
 *
 * Si no hay Supabase configurado, la app sigue funcionando en "modo local"
 * (todo en este navegador, sin cuentas): needsAuth queda en false.
 */

const AuthCtx = createContext({
  user: null,
  loading: true,
  needsAuth: false,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCurrentUserId(null);
      setLoading(false);
      return;
    }

    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        const u = data.session?.user ?? null;
        setCurrentUserId(u?.id ?? null);
        setUser(u);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setCurrentUserId(u?.id ?? null);
      setUser(u);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ user, loading, needsAuth: isSupabaseConfigured && !user }),
    [user, loading]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** El nombre tal cual quedó guardado (el que escribió o el que mandó Google) */
export function fullName(user) {
  const m = user?.user_metadata || {};
  return String(m.full_name || m.name || m.user_name || "").trim();
}

/**
 * Cómo llamar a la persona en pantalla.
 *
 * Por orden: el nombre que escribió al crear la cuenta, el que manda Google,
 * y si no hay nada, la parte del mail antes de la arroba (capitalizada).
 */
export function displayName(user) {
  if (!user) return "";
  const clean = fullName(user);
  if (clean) return clean.split(/\s+/)[0]; // saludamos por el primer nombre
  const local = (user.email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!local) return "";
  const first = local.split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ------------------------------------------------------------- acciones

const ERRORS = {
  "Invalid login credentials": "Email o contraseña incorrectos.",
  "Email not confirmed": "Confirmá tu email antes de entrar (mirá tu casilla).",
  "User already registered": "Ese email ya tiene una cuenta. Iniciá sesión.",
  "Password should be at least 6 characters":
    "La contraseña necesita al menos 6 caracteres.",
  "Unable to validate email address: invalid format": "El email no parece válido.",
  "Signups not allowed for this instance":
    "El registro está desactivado en Supabase (Authentication → Providers → Email).",
  "For security purposes, you can only request this after 60 seconds":
    "Esperá un minuto antes de volver a intentar.",
  "Unsupported provider: provider is not enabled":
    "Google todavía no está habilitado en Supabase (Authentication → Providers → Google).",
  "Error getting user email from external provider":
    "Google no compartió tu email. Volvé a intentar y aceptá el permiso de email.",
};

export function friendlyError(e) {
  const msg = e?.message || String(e || "");
  return ERRORS[msg] || msg || "Algo salió mal.";
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

/**
 * Devuelve { needsConfirmation: true } si Supabase pide confirmar el mail.
 *
 * El nombre viaja en user_metadata.full_name: es el mismo campo que llena
 * Google, así que después da igual por dónde entró la persona.
 */
export async function signUp(email, password, name = "") {
  const full_name = name.trim();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: full_name ? { data: { full_name } } : undefined,
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

/** Cambia el nombre visible del usuario logueado */
export async function updateName(name) {
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: name.trim() },
  });
  if (error) throw error;
  return data.user;
}

/**
 * Entrada con Google. No hay "registro" separado: la primera vez Supabase
 * crea la cuenta sola y las siguientes reconoce el mismo email.
 *
 * Ojo con el redirectTo: tiene que estar en la lista blanca de Supabase
 * (Authentication -> URL Configuration -> Redirect URLs), si no vuelve al
 * Site URL y en local te manda a producción.
 *
 * No devuelve sesión: el navegador se va a Google y vuelve con los tokens
 * en la URL. De eso se encarga `detectSessionInUrl` en lib/supabase.js, y
 * el AuthProvider se entera por onAuthStateChange.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      queryParams: {
        // para que te deje elegir la cuenta en vez de entrar con la última
        prompt: "select_account",
      },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  if (error) throw error;
}

/** Cambia la contraseña del usuario logueado (útil tras el link de reset) */
export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export function useSignOut() {
  return useCallback(async () => {
    if (isSupabaseConfigured) await signOut();
  }, []);
}
