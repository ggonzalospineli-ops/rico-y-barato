// Modelo de gusto a partir de favoritos. Es un análisis local y explicable (sin servidor):
// arma un vector de afinidad por tags y categorías, y lo traduce a frases.

import { CATEGORIES } from '../data/catalog.js';

export function buildTaste(favoriteItems, restaurantsById, medianUnitPrice) {
  const tagWeights = {};
  const categoryWeights = {};
  let localCount = 0, priceRatios = [];

  for (const item of favoriteItems) {
    const r = restaurantsById[item.restaurantId];
    for (const t of [...item.tags, ...r.tags]) tagWeights[t] = (tagWeights[t] || 0) + 1;
    for (const [cat, units] of Object.entries(item.yields)) {
      categoryWeights[cat] = (categoryWeights[cat] || 0) + 1;
      if (medianUnitPrice[cat]) priceRatios.push(item.price / units / medianUnitPrice[cat]);
    }
    if (!r.chain) localCount++;
  }

  normalize(tagWeights);
  normalize(categoryWeights);
  const n = favoriteItems.length;
  return {
    size: n,
    tagWeights,
    categoryWeights,
    localShare: n ? localCount / n : 0.5,
    priceRatio: priceRatios.length ? avg(priceRatios) : 1,
  };
}

// Afinidad 0..1 de un producto con el gusto. Sin favoritos devuelve 0.5 (neutro).
export function affinity(taste, item, restaurant) {
  if (!taste.size) return 0.5;
  const tags = new Set([...item.tags, ...restaurant.tags]);
  let tagScore = 0;
  for (const t of tags) tagScore += taste.tagWeights[t] || 0;
  tagScore /= Math.sqrt(tags.size || 1);
  const catScore = Math.max(0, ...Object.keys(item.yields).map(c => taste.categoryWeights[c] || 0));
  const localFit = restaurant.chain ? 1 - taste.localShare : taste.localShare;
  return Math.min(1, 0.45 * tagScore + 0.35 * catScore + 0.2 * localFit);
}

export function describeTaste(taste) {
  if (!taste.size) return { headline: 'Marcá favoritos y te armo tu perfil de gusto.', insights: [] };
  const topCats = top(taste.categoryWeights, 2).map(c => CATEGORIES[c]?.label || c);
  const topTags = top(taste.tagWeights, 3);
  const insights = [];

  insights.push(`Lo tuyo es ${topCats.join(' y ')}.`);
  if (topTags.length) insights.push(`Se repite: ${topTags.join(', ')}.`);
  if (taste.localShare >= 0.6) insights.push('Preferís locales de barrio antes que cadenas: te priorizo joyas ocultas.');
  else if (taste.localShare <= 0.3) insights.push('Vas a lo seguro con cadenas: te muestro sus opciones más baratas.');
  if (taste.priceRatio <= 0.85) insights.push('Tus favoritos son de los más baratos por unidad: sabés comprar.');
  else if (taste.priceRatio >= 1.2) insights.push('Elegís calidad aunque cueste más: subí el peso de "rico".');

  return {
    headline: `Perfil armado con ${taste.size} favorito${taste.size === 1 ? '' : 's'}.`,
    insights,
    suggestedRicoWeight: taste.priceRatio >= 1.2 ? 0.7 : taste.priceRatio <= 0.85 ? 0.35 : 0.5,
  };
}

function normalize(obj) {
  const max = Math.max(0, ...Object.values(obj));
  if (max) for (const k in obj) obj[k] /= max;
}
function top(obj, n) { return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]); }
function avg(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
