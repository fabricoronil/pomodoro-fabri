/**
 * Genera un par de claves VAPID para los avisos push.
 *
 *   node scripts/vapid.mjs
 *
 * Usa solo node:crypto, así que no hace falta instalar nada.
 * La pública va al front (NEXT_PUBLIC_VAPID_PUBLIC_KEY) y la privada a los
 * secretos de Supabase (VAPID_PRIVATE_KEY). La privada NO se sube al repo.
 *
 * Ojo: si rotás las claves, todas las suscripciones que ya existen dejan de
 * servir. Hay que vaciar la tabla push_subscriptions y volver a activarlo en
 * cada dispositivo.
 */

import { generateKeyPairSync } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// Los últimos 65 bytes del SPKI son el punto sin comprimir (0x04 + X + Y),
// que es exactamente el formato que espera applicationServerKey.
const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
const { d } = privateKey.export({ format: "jwk" }); // ya viene en base64url

console.log("");
console.log("# --- .env.local (front) y variables de Vercel ---");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log("");
console.log("# --- secretos de Supabase (supabase secrets set ...) ---");
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log("");
