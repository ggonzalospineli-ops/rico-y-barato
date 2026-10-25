// Arma, dentro de un mismo local, la combinación más barata de productos que cubre
// una cantidad objetivo de una categoría (ej: 27 nuggets con cajas de 4, 10 y 20).
// Es una mochila no acotada de mínimo costo: dp[q] = costo mínimo para tener exactamente q.

export function cheapestCover(products, category, target) {
  const packs = products
    .filter(p => (p.yields[category] || 0) > 0)
    .map(p => ({ product: p, size: p.yields[category] }));
  if (!packs.length || target <= 0) return null;

  const maxSize = Math.max(...packs.map(p => p.size));
  const limit = target + maxSize - 1; // pasarse más que eso nunca es necesario
  const cost = new Array(limit + 1).fill(Infinity);
  const pick = new Array(limit + 1).fill(-1);
  cost[0] = 0;

  for (let q = 1; q <= limit; q++) {
    for (let i = 0; i < packs.length; i++) {
      const prev = q - packs[i].size;
      if (prev < 0 || cost[prev] === Infinity) continue;
      const c = cost[prev] + packs[i].product.price;
      if (c < cost[q]) { cost[q] = c; pick[q] = i; }
    }
  }

  return { best: bestIn(target, limit), short: shortOption() };

  // Entre todas las cantidades >= target, la más barata; a igual precio, la más cercana.
  function bestIn(from, to) {
    let bestQ = -1;
    for (let q = from; q <= to; q++) {
      if (cost[q] < (bestQ < 0 ? Infinity : cost[bestQ])) bestQ = q;
    }
    return bestQ < 0 ? null : rebuild(bestQ);
  }

  // Variante "comés un poco menos": >= 80% del objetivo y al menos 15% más barata.
  function shortOption() {
    const full = bestIn(target, limit);
    const alt = bestIn(Math.ceil(target * 0.8), target - 1);
    if (!full || !alt || alt.subtotal > full.subtotal * 0.85) return null;
    return alt;
  }

  function rebuild(q) {
    const counts = new Map();
    for (let r = q; r > 0; r -= packs[pick[r]].size) {
      const p = packs[pick[r]].product;
      counts.set(p.id, { product: p, qty: (counts.get(p.id)?.qty || 0) + 1 });
    }
    return { quantity: q, subtotal: cost[q], lines: [...counts.values()] };
  }
}
