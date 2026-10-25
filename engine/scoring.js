// Puntajes 0..1. "Rico" sale de reseñas + gusto personal; "barato" del costo por unidad
// comparado con las otras opciones de la misma categoría.

const PRIOR_RATING = 4.2;  // a qué rating tiende un local con pocas reseñas
const PRIOR_WEIGHT = 150;  // cuántas reseñas "vale" ese supuesto

// Promedio bayesiano: un 4.9 con 12 reseñas no le gana a un 4.6 con 900.
export function bayesRating(rating, reviews) {
  if (!rating) return PRIOR_RATING;
  const n = reviews || 0;
  return (n * rating + PRIOR_WEIGHT * PRIOR_RATING) / (n + PRIOR_WEIGHT);
}

// El rating del LISTADO de Rappi puntúa alto: ~0.55 más que Google.
const RAPPI_INFLATION = 0.55;
// Un 5.0 en Rappi suele ser un local nuevo con pocas calificaciones.
const RAPPI_PERFECT_AS = 4.7;

// El de la PÁGINA del local (rappiScore, con cantidad de reseñas) es más duro: ~0.35 menos que Google
// (McDonald's 3.2 vs 3.8, Burger King 3.7 vs 4.0, Romario 3.7 vs 3.9). Mediana de la zona: 4.0.
const RAPPI_SCORE_TO_GOOGLE = 0.35;
const RAPPI_SCORE_PRIOR = 3.9;
const RAPPI_SCORE_WEIGHT = 40;

export function rappiScoreBayes(restaurant) {
  const n = restaurant.rappiReviews || 0;
  return (n * (restaurant.rappiScore || RAPPI_SCORE_PRIOR) + RAPPI_SCORE_WEIGHT * RAPPI_SCORE_PRIOR) / (n + RAPPI_SCORE_WEIGHT);
}

// Calidad del local en 0..1, en escala Google (3.5 estrellas o menos = 0, 5 = 1).
export function quality(restaurant) {
  if (restaurant.rappiReviews != null) {
    const rappi = rappiScoreBayes(restaurant) + RAPPI_SCORE_TO_GOOGLE;
    const stars = restaurant.googleRating
      ? 0.6 * bayesRating(restaurant.googleRating, restaurant.googleReviews) + 0.4 * rappi
      : rappi;
    return clamp01((stars - 3.5) / 1.5);
  }
  let rappi = restaurant.rappiRating;
  if (rappi >= 5) rappi = RAPPI_PERFECT_AS;
  const hasGoogle = !!restaurant.googleRating;
  if (!hasGoogle && !rappi) return clamp01((PRIOR_RATING - 3.5) / 1.5);
  const google = hasGoogle ? bayesRating(restaurant.googleRating, restaurant.googleReviews) : rappi - RAPPI_INFLATION;
  const stars = rappi ? 0.65 * google + 0.35 * (rappi - RAPPI_INFLATION) : google;
  return clamp01((stars - 3.5) / 1.5);
}

// Joya oculta: no es cadena, muy bien puntuado y todavía poco conocido.
// Con Google: 4.5+ y entre 50 y 1000 reseñas. Con Rappi: 4.25+ (ya ajustado por reseñas) y entre 20 y 500,
// que en la zona relevada es ~6% de los locales que no son cadena.
export function isHiddenGem(restaurant) {
  if (restaurant.chain) return false;
  if (restaurant.googleRating) {
    return restaurant.googleRating >= 4.5 && (restaurant.googleReviews || 0) >= 50 && restaurant.googleReviews < 1000;
  }
  const n = restaurant.rappiReviews || 0;
  return n >= 20 && n < 500 && rappiScoreBayes(restaurant) >= 4.25;
}

// Percentil invertido: la opción más barata por unidad = 1, la más cara = 0.
export function cheapnessByRank(values) {
  if (values.length === 1) return [1];
  const sorted = [...values].sort((a, b) => a - b);
  const firstIndex = new Map();
  sorted.forEach((v, i) => { if (!firstIndex.has(v)) firstIndex.set(v, i); });
  return values.map(v => 1 - firstIndex.get(v) / (sorted.length - 1));
}

export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
