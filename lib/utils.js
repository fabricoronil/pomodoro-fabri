// ---------- Fechas (siempre en hora local del dispositivo) ----------

export const pad = (n) => String(n).padStart(2, "0");

/** Date -> "YYYY-MM-DD" en hora local */
export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" -> Date a las 00:00 local */
export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toKey(new Date());
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Semana que arranca el lunes */
export function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return d;
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Devuelve { startKey, endKey, label } para el período pedido */
export function periodRange(period, anchor) {
  const a = new Date(anchor);
  if (period === "day") {
    const k = toKey(a);
    return { startKey: k, endKey: k, label: longDate(a) };
  }
  if (period === "week") {
    const s = startOfWeek(a);
    const e = addDays(s, 6);
    return {
      startKey: toKey(s),
      endKey: toKey(e),
      label: `${shortDate(s)} — ${shortDate(e)}`,
    };
  }
  if (period === "month") {
    const s = startOfMonth(a);
    const e = endOfMonth(a);
    return {
      startKey: toKey(s),
      endKey: toKey(e),
      label: capitalize(
        a.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
      ),
    };
  }
  // year
  const s = new Date(a.getFullYear(), 0, 1);
  const e = new Date(a.getFullYear(), 11, 31);
  return { startKey: toKey(s), endKey: toKey(e), label: String(a.getFullYear()) };
}

export function shiftAnchor(period, anchor, dir) {
  if (period === "day") return addDays(anchor, dir);
  if (period === "week") return addDays(anchor, 7 * dir);
  if (period === "month") return addMonths(anchor, dir);
  return addMonths(anchor, 12 * dir);
}

export function eachDayKey(startKey, endKey) {
  const out = [];
  let d = fromKey(startKey);
  const end = fromKey(endKey);
  while (d <= end) {
    out.push(toKey(d));
    d = addDays(d, 1);
  }
  return out;
}

export function longDate(d) {
  return capitalize(
    d.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  );
}

export function shortDate(d) {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Duraciones ----------

/** segundos -> "2h 15m" */
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0 && m === 0) return s > 0 ? "<1m" : "0m";
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** segundos -> "25:00" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export const toHours = (sec) => Math.round((sec / 3600) * 100) / 100;

// ---------- Sueño ----------

/** "23:30" + "07:15" -> 7.75 horas (cruza la medianoche) */
export function sleepHours(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

// ---------- Estadística ----------

/** Coeficiente de correlación de Pearson */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

export function pctDelta(now, before) {
  if (!before) return now > 0 ? 100 : 0;
  return Math.round(((now - before) / before) * 100);
}

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const PALETTE = [
  "#8b5cf6",
  "#22d3ee",
  "#f0616d",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#60a5fa",
  "#a3e635",
  "#fb923c",
  "#c084fc",
];
