// Mezcla al azar con preferencia: cada elemento tiene un peso y los más pesados tienden a salir
// primero, pero cualquiera puede salir arriba (Efraimidis–Spirakis: clave = u^(1/peso)).
// rand se puede inyectar para los tests.
export function weightedShuffle(items, weight, rand = Math.random) {
  return items
    .map(it => ({ it, key: rand() ** (1 / Math.max(1e-6, weight(it))) }))
    .sort((a, b) => b.key - a.key)
    .map(x => x.it);
}

// Mazo de "Decidí por mí": un plan por local (variedad), mezclado con preferencia por el puntaje,
// y sin repetir arriba el mismo plan que la última vez si hay alternativa.
export function decideDeck(plans, { size = 12, lastFirstId = null, rand = Math.random } = {}) {
  const seen = new Set();
  const onePerPlace = plans.filter(p => (seen.has(p.restaurant.id) ? false : seen.add(p.restaurant.id)));
  // +0,15 para que hasta la peor opción tenga chances reales de salir.
  const deck = weightedShuffle(onePerPlace, p => (p.scores?.total ?? 0.5) + 0.15, rand).slice(0, size);
  if (deck.length > 1 && deck[0].id === lastFirstId) deck.push(deck.shift());
  return deck;
}
