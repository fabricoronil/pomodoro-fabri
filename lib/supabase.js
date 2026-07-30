import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  url && key && url.startsWith("http") && !url.includes("xxxxxxxx")
);

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        // la sesión queda guardada en el navegador y se renueva sola:
        // entrás una vez por dispositivo y listo
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "pf.auth",
      },
    })
  : null;
