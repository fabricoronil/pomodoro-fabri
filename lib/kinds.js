/**
 * Tipos de actividad.
 *
 * No todo el tiempo se mide igual: hay cosas que querés empujar hacia arriba
 * (estudiar, entrenar) y cosas que querés tener a raya (jugar, series, redes).
 * Por eso cada grupo tiene un tipo y su objetivo puede ser una META (mínimo a
 * alcanzar) o un LÍMITE (máximo a no pasar).
 *
 * El tipo vive en el grupo raíz: los subgrupos heredan el del padre.
 */

export const KINDS = {
  productivo: {
    id: "productivo",
    label: "Productivo",
    emoji: "📚",
    hint: "Estudio, trabajo, proyectos",
    token: "accent",
    defaultGoalType: "meta",
  },
  cuerpo: {
    id: "cuerpo",
    label: "Cuerpo",
    emoji: "💪",
    hint: "Gym, deporte, caminatas",
    token: "rest",
    defaultGoalType: "meta",
  },
  despeje: {
    id: "despeje",
    label: "Despeje",
    emoji: "🎮",
    hint: "Juegos, series, redes, ocio",
    token: "accent2",
    defaultGoalType: "limite",
  },
};

export const KIND_LIST = Object.values(KINDS);
export const DEFAULT_KIND = "productivo";

/** Orden fijo para que los totales no bailen entre renders */
export const KIND_ORDER = ["productivo", "cuerpo", "despeje"];

/** Tipo de un grupo (tolera bases sin la columna todavía) */
export const kindOf = (g) => (g && KINDS[g.kind] ? g.kind : DEFAULT_KIND);

export const kindMeta = (g) => KINDS[kindOf(g)];

/** "meta" (mínimo) o "limite" (máximo). Si no está seteado, según el tipo. */
export const goalTypeOf = (g) =>
  g?.goal_type === "limite" || g?.goal_type === "meta"
    ? g.goal_type
    : KINDS[kindOf(g)].defaultGoalType;

export const isLimit = (g) => goalTypeOf(g) === "limite";

export const weeklyGoalMin = (g) => Number(g?.weekly_goal_minutes) || 0;
export const dailyGoalMin = (g) => Number(g?.daily_goal_minutes) || 0;

export const hasGoal = (g) => weeklyGoalMin(g) > 0 || dailyGoalMin(g) > 0;

/**
 * Cómo pintar el avance.
 *  - meta:   vas sumando, verde cuando llegás.
 *  - límite: vas gastando, ámbar cuando estás cerca y rojo si te pasaste.
 */
export function goalStatus(sec, goalMinutes, type) {
  const goalSec = goalMinutes * 60;
  if (!goalSec) return null;
  const pct = (sec / goalSec) * 100;
  const rest = goalSec - sec;
  if (type === "limite") {
    return {
      pct,
      rest,
      over: rest < 0,
      token: pct >= 100 ? "focus" : pct >= 80 ? "warn" : "rest",
    };
  }
  return {
    pct,
    rest,
    done: rest <= 0,
    token: pct >= 100 ? "rest" : "accent",
  };
}
