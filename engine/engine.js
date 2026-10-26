// Fachada del motor. La UI solo habla con lo que devuelve createEngine().
// Estado persistente: perfil (apetito, exclusiones), favoritos, presupuesto, carrito y pedidos.

import { CATEGORIES, BIG_FOUR } from '../data/catalog.js';
import { cheapestCover } from './planner.js';
import { quality, isHiddenGem, cheapnessByRank, clamp01 } from './scoring.js';
import { buildTaste, affinity, describeTaste } from './taste.js';
import { openStatus } from './hours.js';

export const HUNGER = {
  poco:   { label: 'Picoteo',      factor: n => n.normal * 0.6 },
  normal: { label: 'Hambre',       factor: n => n.normal },
  mucho:  { label: 'Mucha hambre', factor: n => (n.normal + n.max) / 2 },
  bestia: { label: 'Modo bestia',  factor: n => n.max },
};

const DEFAULT_APPETITE = {
  nuggets: { normal: 10, max: 20 }, sushi: { normal: 20, max: 30 }, hamburguesa: { normal: 1, max: 2 },
  empanadas: { normal: 4, max: 8 }, pizza: { normal: 4, max: 8 }, milanesa: { normal: 1, max: 1 },
  pollo: { normal: 3, max: 6 }, pasta: { normal: 1, max: 2 },
  tacos: { normal: 3, max: 5 }, wraps: { normal: 1, max: 2 }, carnes: { normal: 1, max: 2 },
  ensaladas: { normal: 1, max: 2 }, sandwiches: { normal: 1, max: 2 }, tartas: { normal: 2, max: 4 },
  wok: { normal: 1, max: 2 },
};

const CATEGORY_SCHEMA_VERSION = 2;
const ADDED_CATEGORIES = ['tacos', 'wraps', 'carnes', 'ensaladas', 'sandwiches', 'tartas', 'wok'];

function defaultState() {
  return {
    profile: {
      appetite: structuredClone(DEFAULT_APPETITE),
      enabledCategories: Object.keys(CATEGORIES),
      categorySchemaVersion: CATEGORY_SCHEMA_VERSION,
      excludedTags: [],            // ej: ['cerdo', 'tacc', 'lacteos']
    },
    hiddenItems: [],               // productos que el usuario marcó como mal medidos o que no quiere ver
    favorites: [],                 // ids de productos
    disliked: [],                  // productos calificados 👎: bajan en "rico" y nunca salen como favoritos
    seededFavorites: [],           // sugeridos por la fuente ya aplicados (para no re-agregar los que el usuario sacó)
    budget: { monthly: 0 },        // 0 = sin tope mensual
    cart: [],                      // planes guardados "por gastar"
    orders: [],                    // { id, planId, restaurantId, title, total, at, lines, rating, source }
  };
}

export function createEngine({ source, storage = memoryStorage(), now = () => Date.now() } = {}) {
  const listeners = new Set();
  const saved = storage.get('state') || {};
  const base = defaultState();
  const savedProfile = saved.profile || {};
  const enabledCategories = savedProfile.categorySchemaVersion === CATEGORY_SCHEMA_VERSION
    ? (savedProfile.enabledCategories || base.profile.enabledCategories)
    : [...new Set([...(savedProfile.enabledCategories || base.profile.enabledCategories), ...ADDED_CATEGORIES])];
  let state = {
    ...base, ...saved,
    profile: {
      ...base.profile, ...savedProfile,
      appetite: { ...base.profile.appetite, ...(savedProfile.appetite || {}) },
      enabledCategories,
      categorySchemaVersion: CATEGORY_SCHEMA_VERSION,
    },
  };
  let meta = {};
  let restaurants = [], items = [], byRestaurant = {}, restaurantsById = {}, medianUnitPrice = {};

  function emit(type) {
    storage.set('state', state);
    for (const fn of listeners) fn({ type, state: snapshot() });
  }
  const snapshot = () => structuredClone(state);

  async function load() {
    const data = await source.load();
    ({ restaurants, items } = data);
    meta = data.meta || {};
    restaurantsById = Object.fromEntries(restaurants.map(r => [r.id, r]));
    byRestaurant = {};
    for (const it of items) (byRestaurant[it.restaurantId] ||= []).push(it);
    medianUnitPrice = computeMedians(items);
    for (const id of data.suggestedFavorites || []) {
      if (state.seededFavorites.includes(id)) continue;
      state.seededFavorites.push(id);
      if (!state.favorites.includes(id)) state.favorites.push(id);
    }
    emit('catalog');
  }

  // extra: exclusiones solo para este pedido ("uno no come carne"), sin tocar el perfil.
  const allowed = (it, extra = []) => !state.hiddenItems.includes(it.id)
    && !it.tags.some(t => state.profile.excludedTags.includes(t) || extra.includes(t));
  const taste = () => buildTaste(items.filter(i => state.favorites.includes(i.id)), restaurantsById, medianUnitPrice);

  function targetFor(category, hunger) {
    const a = state.profile.appetite[category];
    return Math.max(1, Math.round(HUNGER[hunger].factor(a)));
  }

  // Opciones para comer ya. Cada opción es un plan completo de un local.
  // people: "somos N" — la cantidad objetivo se multiplica (cada uno con el apetito del perfil).
  // map: true devuelve además todos los planes que entran en la plata, para el mapa Rico × Barato.
  // openOnly: sin locales cerrados en el momento `at` (por defecto, ahora).
  function recommend({ hunger = 'normal', money = Infinity, categories, ricoWeight = 0.5, limit = 12, people = 1, map = false,
    openOnly = true, at = null, exclude = [], maxEta = null, maxKm = null } = {}) {
    const n = Math.max(1, Math.round(people));
    const when = new Date(at ?? now());
    const status = Object.fromEntries(restaurants.map(r => [r.id, openStatus(r.schedule, when)]));
    const closed = new Set(restaurants.filter(r => !status[r.id].open).map(r => r.id));
    // Con filtro de demora o distancia, un local sin el dato queda afuera: "llega en 30" tiene que ser cierto.
    const tooFar = r => (maxEta != null && !(r.etaMin <= maxEta)) || (maxKm != null && !(r.distanceKm <= maxKm));
    let farCount = 0;
    const cats = categories?.length ? categories : state.profile.enabledCategories;
    const t = taste();
    const available = Math.min(money, budgetSummary().remaining);
    const plans = [];

    for (const category of cats) {
      const target = targetFor(category, hunger) * n;
      for (const r of restaurants) {
        if (openOnly && closed.has(r.id)) continue;
        if (tooFar(r)) { if (category === cats[0]) farCount++; continue; }
        const products = (byRestaurant[r.id] || []).filter(it => allowed(it, exclude));
        const cover = cheapestCover(products, category, target);
        if (!cover?.best) continue;
        const mk = (c, variant) => makePlan(r, category, target, c, variant, t, status[r.id]);
        plans.push(mk(cover.best, 'completo'));
        if (cover.short) plans.push(mk(cover.short, 'un-poco-menos'));
        // Lo más barato del local no siempre es lo que vale la pena. Se arma además un plan con tus
        // favoritos y otro con lo respaldado afuera (Morfy, Google), si son distintos al más barato.
        const seen = [cover.best];
        for (const [variant, keep] of [
          ['tu-favorito', p => state.favorites.includes(p.id) && !state.disliked.includes(p.id)],
          ['recomendado', p => p.signals?.length],
        ]) {
          const backed = products.filter(keep);
          const best = backed.length ? cheapestCover(backed, category, target)?.best : null;
          if (best && !seen.some(s => sameLines(s, best))) { seen.push(best); plans.push(mk(best, variant)); }
        }
      }
    }

    // "Barato" se mide dentro de cada categoría: 30 piezas de sushi no compiten con 4 empanadas.
    for (const category of cats) {
      const group = plans.filter(p => p.category === category);
      cheapnessByRank(group.map(p => p.unitCost)).forEach((c, i) => { group[i].scores.barato = c; });
    }
    markCheapestChainPerCategory(plans);

    for (const p of plans) {
      p.scores.total = ricoWeight * p.scores.rico + (1 - ricoWeight) * p.scores.barato;
      p.overBudgetBy = Math.max(0, p.total - available);
    }
    const affordable = plans.filter(p => !p.overBudgetBy);
    markSweetSpots(affordable);
    const byScore = (a, b) => b.scores.total - a.scores.total;
    const ranked = maxPerRestaurant(affordable.sort(byScore), 2);
    return {
      target: Object.fromEntries(cats.map(c => [c, targetFor(c, hunger) * n])),
      people: n,
      closed: openOnly ? closed.size : 0,   // locales que se saltearon por estar cerrados
      far: farCount,                        // abiertos que quedaron afuera por demora o distancia
      at: at ?? null,
      available: Number.isFinite(available) ? available : null,
      options: ranked.slice(0, limit),
      total: ranked.length,                 // cuántas hay en total (options trae solo las primeras `limit`)
      overBudget: plans.filter(p => p.overBudgetBy).sort((a, b) => a.overBudgetBy - b.overBudgetBy).slice(0, 5),
      ...(map ? { all: affordable } : {}),
    };
  }

  function makePlan(r, category, target, cover, variant, t, open = openStatus(r.schedule, new Date(now()))) {
    const total = cover.subtotal + (r.deliveryFee || 0);
    const aff = Math.max(...cover.lines.map(l => affinity(t, l.product, r)));
    const badges = [];
    if (isHiddenGem(r)) badges.push('joya-oculta');
    if (cover.lines.some(l => l.product.salesRank <= 3)) badges.push('mas-vendido');
    if (cover.lines.some(l => l.product.originalPrice)) badges.push('descuento');
    if (cover.lines.some(l => l.product.signals?.some(s => s.source === 'morfy' && s.approval >= 95))) badges.push('aprobado-morfy');
    else if (cover.lines.some(l => l.product.signals?.some(s => s.source === 'google'))) badges.push('popular-google');
    if (r.googleNegative >= 15) badges.push('opiniones-divididas');
    if (cover.lines.some(l => state.favorites.includes(l.product.id))) badges.push('favorito');
    if (cover.lines.some(l => l.product.priceChange?.pct <= -5)) badges.push('bajo-precio');
    if (cover.lines.some(l => l.product.inflatedOriginal)) badges.push('tachado-inflado');
    if (cover.lines.some(l => l.product.otherApps?.some(o => o.same && o.price < l.product.price))) badges.push('mas-barato-en-otra');
    if (cover.lines.some(l => state.disliked.includes(l.product.id))) badges.push('no-te-gusto');
    if (open.closingSoon) badges.push('cierra-pronto');
    return {
      id: `${r.id}:${category}:${variant}:${cover.quantity}`,
      restaurant: { ...publicRestaurant(r), open },
      category, variant, target,
      quantity: cover.quantity,
      unit: CATEGORIES[category]?.unit || 'unidades',
      lines: cover.lines.map(l => ({
        itemId: l.product.id, name: l.product.name, qty: l.qty, price: l.product.price,
        originalPrice: l.product.originalPrice || null, discount: l.product.discount || null,
        imageUrl: l.product.imageUrl || null, signals: l.product.signals || [],
        priceChange: l.product.priceChange || null, inflatedOriginal: !!l.product.inflatedOriginal,
        otherApps: l.product.otherApps || [],
      })),
      subtotal: cover.subtotal,
      deliveryFee: r.deliveryFee || 0,
      total,
      unitCost: Math.round(total / cover.quantity),
      scores: { rico: clamp01(0.7 * quality(r) + 0.3 * aff + signalBonus(r, cover.lines, state.favorites, state.disliked)), barato: 0, total: 0 },
      badges,
      orderUrl: source.orderUrl(r),
    };
  }

  function markCheapestChainPerCategory(plans) {
    const seen = new Set();
    for (const p of [...plans].sort((a, b) => a.unitCost - b.unitCost)) {
      if (!BIG_FOUR.includes(p.restaurant.brand) || seen.has(p.category)) continue;
      seen.add(p.category);
      p.badges.push('franquicia-barata');
    }
  }

  // salesRank: posición en la sección de populares del local (1 = el más pedido).
  // A igual posición, primero los locales mejor puntuados.
  function rankings({ limit = 10 } = {}) {
    const visible = items.filter(it => allowed(it) && it.salesRank);
    const q = it => quality(restaurantsById[it.restaurantId]);
    return {
      bestSellers: visible.sort((a, b) => a.salesRank - b.salesRank || q(b) - q(a)).slice(0, limit).map(publicItem),
      topRated: [...restaurants].sort((a, b) => quality(b) - quality(a)).slice(0, limit).map(publicRestaurant),
      hiddenGems: restaurants.filter(isHiddenGem).sort((a, b) => quality(b) - quality(a)).map(publicRestaurant),
    };
  }

  // Gastos por semana (lunes a domingo, hora local) y por comida, y cuánto se ahorró contra el precio por
  // unidad típico de la zona (mediana del catálogo, sin envío). El ahorro solo se cuenta en pedidos de la
  // app con categoría medible; los cargados a mano no tienen con qué compararse.
  function spendingSummary({ weeks = 8 } = {}) {
    const monday = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
    const thisWeek = monday(now());
    const byWeek = Array.from({ length: weeks }, (_, i) => {
      const start = new Date(thisWeek); start.setDate(start.getDate() - 7 * (weeks - 1 - i));
      return { start: start.getTime(), total: 0, orders: 0 };
    });
    const byCategory = {};
    let saved = 0, comparable = 0;
    for (const o of state.orders) {
      const w = byWeek.find(x => x.start === monday(o.at));
      if (w) { w.total += o.total; w.orders++; }
      const cat = o.category && CATEGORIES[o.category] ? o.category : 'otro';
      (byCategory[cat] ||= { category: cat, total: 0, orders: 0 });
      byCategory[cat].total += o.total; byCategory[cat].orders++;
      const median = medianUnitPrice[o.category];
      if (median && o.quantity > 0 && o.subtotal != null) { saved += Math.round(median * o.quantity - o.subtotal); comparable++; }
    }
    const total = state.orders.reduce((s, o) => s + o.total, 0);
    return {
      weeks: byWeek, categories: Object.values(byCategory).sort((a, b) => b.total - a.total),
      total, orders: state.orders.length, average: state.orders.length ? Math.round(total / state.orders.length) : 0,
      saved, comparable,
    };
  }

  function budgetSummary() {
    const month = new Date(now()).toISOString().slice(0, 7);
    const spent = state.orders.filter(o => new Date(o.at).toISOString().slice(0, 7) === month)
      .reduce((s, o) => s + o.total, 0);
    const planned = state.cart.reduce((s, p) => s + p.total, 0);
    const monthly = state.budget.monthly;
    return {
      month, monthly, spent, planned,
      remaining: monthly ? Math.max(0, monthly - spent) : Infinity,
      remainingAfterCart: monthly ? Math.max(0, monthly - spent - planned) : Infinity,
      totalSpentAllTime: state.orders.reduce((s, o) => s + o.total, 0),
    };
  }

  const publicRestaurant = r => ({
    id: r.id, name: r.name, brand: r.brand || r.id, chain: r.chain, demo: !!r.demo, tags: r.tags,
    address: r.address || null, url: r.url || null, logoUrl: r.logoUrl || null, coverUrl: r.coverUrl || null,
    rappiScore: r.rappiScore ?? null, rappiReviews: r.rappiReviews ?? null,
    googlePositive: r.googlePositive ?? null, googleNegative: r.googleNegative ?? null, mentions: r.mentions || [],
    googleRating: r.googleRating ?? null, googleReviews: r.googleReviews ?? null, rappiRating: r.rappiRating ?? null,
    deliveryFee: r.deliveryFee ?? null, etaMin: r.etaMin ?? null, quality: quality(r), hiddenGem: isHiddenGem(r),
    distanceKm: r.distanceKm ?? null, open: openStatus(r.schedule, new Date(now())),
    googleUrl: r.googleUrl || null, catalogStats: r.catalogStats || null,
  });
  const publicItem = it => ({
    id: it.id, name: it.name, description: it.description || '', section: it.section || null,
    price: it.price, originalPrice: it.originalPrice || null, discount: it.discount || null,
    imageUrl: it.imageUrl || null, signals: it.signals || [],
    priceHistory: it.priceHistory || null, priceChange: it.priceChange || null, inflatedOriginal: !!it.inflatedOriginal,
    otherApps: it.otherApps || [], disliked: state.disliked.includes(it.id),
    yields: it.yields, tags: it.tags, salesRank: it.salesRank ?? null,
    source: it.source || null, sourceType: it.sourceType || null, sourceUrl: it.sourceUrl || null,
    officialSource: !!it.officialSource, sourceValidity: it.sourceValidity || null, sourceScope: it.sourceScope || null,
    branch: it.branch || null, rappiRank: it.rappiRank ?? null, opportunityScore: it.opportunityScore ?? null,
    restaurant: publicRestaurant(restaurantsById[it.restaurantId]),
    favorite: state.favorites.includes(it.id),
  });

  return {
    load,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState: snapshot,
    categories: () => structuredClone(CATEGORIES),
    hungerLevels: () => Object.fromEntries(Object.entries(HUNGER).map(([k, v]) => [k, v.label])),
    targetFor,               // (category, hunger) → cantidad que va a buscar recommend()
    notOnRappi: () => structuredClone(meta.notOnRappi || []), // locales recomendados por otras fuentes que Rappi no tiene
    item: id => { const it = items.find(i => i.id === id); return it ? publicItem(it) : null; },
    menu: restaurantId => (byRestaurant[restaurantId] || []).map(publicItem),
    // Plan de un solo producto elegido a mano desde el menú (para agregarlo al pedido). Si el producto no
    // es de una categoría que el motor mide (una tortilla, una bebida), queda como "otro" en unidades.
    planForItem(itemId, qty = 1) {
      const it = items.find(i => i.id === itemId);
      const r = it && restaurantsById[it.restaurantId];
      if (!r) return null;
      const n = Math.max(1, Math.round(qty));
      const category = Object.keys(it.yields || {})[0] || 'otro';
      const quantity = (it.yields?.[category] || 1) * n;
      return makePlan(r, category, quantity, { lines: [{ product: it, qty: n }], subtotal: it.price * n, quantity }, `item-${it.id}`, taste());
    },
    restaurants: () => restaurants.map(publicRestaurant),
    catalogSummary: () => ({
      rows: meta.catalogRows ?? items.length,
      restaurants: meta.restaurantCount ?? restaurants.length,
      deliveryRows: meta.deliveryRows ?? items.length,
      officialMenuRows: meta.officialMenuRows ?? 0,
      sources: structuredClone(meta.sourceCounts || {}),
      consolidatedAt: meta.consolidatedAt || meta.scrapedAt || null,
    }),
    recommend,
    rankings,
    budgetSummary,
    spendingSummary,
    tasteProfile: () => describeTaste(taste()),

    setAppetite(category, { normal, max }) {
      if (!CATEGORIES[category]) throw new Error(`Categoría desconocida: ${category}`);
      if (!(normal > 0) || !(max >= normal)) throw new Error('Apetito inválido: normal > 0 y max >= normal');
      state.profile.appetite[category] = { normal, max };
      emit('profile');
    },
    setEnabledCategories(list) {
      state.profile.enabledCategories = list.filter(c => CATEGORIES[c]);
      emit('profile');
    },
    setExcludedTags(tags) { state.profile.excludedTags = [...new Set(tags)]; emit('profile'); },
    toggleFavorite(itemId) {
      const i = state.favorites.indexOf(itemId);
      i < 0 ? state.favorites.push(itemId) : state.favorites.splice(i, 1);
      emit('favorites');
    },
    // "Esto está mal": el importador deduce cantidades del texto y a veces se equivoca.
    hideItem(itemId) { if (!state.hiddenItems.includes(itemId)) state.hiddenItems.push(itemId); emit('hidden'); },
    unhideItem(itemId) { state.hiddenItems = state.hiddenItems.filter(id => id !== itemId); emit('hidden'); },
    setMonthlyBudget(amount) { state.budget.monthly = Math.max(0, Math.round(amount || 0)); emit('budget'); },

    addToCart(plan) { state.cart.push(structuredClone(plan)); emit('cart'); },
    removeFromCart(planId) { state.cart = state.cart.filter(p => p.id !== planId); emit('cart'); },
    // El usuario confirma que pidió: pasa de "por gastar" a "gastado".
    confirmOrder(planId) {
      const plan = state.cart.find(p => p.id === planId);
      if (!plan) throw new Error(`No está en el carrito: ${planId}`);
      state.cart = state.cart.filter(p => p.id !== planId);
      state.orders.push({
        id: `o${now()}`, planId, restaurantId: plan.restaurant.id, restaurantName: plan.restaurant.name,
        title: `${plan.quantity} ${plan.unit} de ${CATEGORIES[plan.category]?.label || plan.lines[0]?.name || 'comida'} · ${plan.restaurant.name}`,
        total: plan.total, at: now(), rating: null, source: 'app',
        category: plan.category, quantity: plan.quantity, subtotal: plan.subtotal ?? null,
        lines: plan.lines.map(l => ({ itemId: l.itemId, name: l.name, qty: l.qty, price: l.price })),
      });
      emit('orders');
    },
    // Un pedido que no salió de la app (foto del ticket o carga a mano).
    addExternalOrder({ restaurantId = null, restaurantName, total, at = now(), deliveryFee = null, tip = null, lines = [], source = 'manual' }) {
      if (!(total > 0)) throw new Error('El total tiene que ser mayor a 0');
      const r = restaurantId && restaurantsById[restaurantId];
      const name = r?.name || restaurantName || 'Pedido';
      const order = {
        id: `o${now()}${Math.random().toString(36).slice(2, 6)}`, planId: null, restaurantId: r ? r.id : null, restaurantName: name,
        title: `${lines.length ? lines.map(l => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.name}`).join(' + ') : 'Pedido'} · ${name}`,
        total: Math.round(total), deliveryFee, tip, at, rating: null, source,
        lines: lines.map(l => ({ itemId: l.itemId || null, name: l.name, qty: l.qty || 1, price: l.price ?? null })),
      };
      state.orders.push(order);
      emit('orders');
      return structuredClone(order);
    },
    // ¿Estuvo rico? 👍 suma los productos a favoritos; 👎 los baja y los saca de favoritos.
    rateOrder(orderId, verdict) {
      const o = state.orders.find(x => x.id === orderId);
      if (!o) throw new Error(`Pedido desconocido: ${orderId}`);
      if (!['up', 'down', null].includes(verdict)) throw new Error('Calificación: up, down o null');
      o.rating = verdict;
      const ids = (o.lines || []).map(l => l.itemId).filter(Boolean);
      if (verdict === 'up') {
        for (const id of ids) if (!state.favorites.includes(id)) state.favorites.push(id);
        state.disliked = state.disliked.filter(id => !ids.includes(id));
      } else if (verdict === 'down') {
        state.favorites = state.favorites.filter(id => !ids.includes(id));
        for (const id of ids) if (!state.disliked.includes(id)) state.disliked.push(id);
      }
      emit('ratings');
    },
    // Pedidos sin calificar con más de `minutes` desde que se pidieron (para preguntar "¿estuvo rico?").
    pendingRatings({ minutes = 40 } = {}) {
      return structuredClone(state.orders.filter(o => o.rating == null && !o.ratingSkipped && now() - o.at >= minutes * 60000));
    },
    skipRating(orderId) { const o = state.orders.find(x => x.id === orderId); if (o) { o.ratingSkipped = true; emit('ratings'); } },
    // Bajas de precio en lo que te gusta (favoritos y lo que calificaste 👍).
    priceAlerts({ minPct = 5 } = {}) {
      return items.filter(it => state.favorites.includes(it.id) && it.priceChange && it.priceChange.pct <= -minPct)
        .map(publicItem).sort((a, b) => a.priceChange.pct - b.priceChange.pct);
    },
    priceTracking: () => ({ days: meta.priceDays || [] }),
    // Las bajas más grandes de la zona entre el último día relevado y el anterior.
    priceDrops({ limit = 30, minPct = 5 } = {}) {
      return items.filter(it => allowed(it) && Object.keys(it.yields).length && it.priceChange?.pct <= -minPct)
        .sort((a, b) => a.priceChange.pct - b.priceChange.pct).slice(0, limit).map(publicItem);
    },
    reset() { state = defaultState(); emit('reset'); },
  };
}

// Punto dulce = frontera de Pareto por categoría: no hay otra opción que sea a la vez
// más rica y más barata por unidad. Ninguna mezcla de pesos del slider la deja mal parada.
function markSweetSpots(plans) {
  const byCat = {};
  for (const p of plans) (byCat[p.category] ||= []).push(p);
  for (const group of Object.values(byCat)) {
    const sorted = [...group].sort((a, b) => a.unitCost - b.unitCost || b.scores.rico - a.scores.rico);
    let bestRico = -Infinity;
    for (const p of sorted) {
      if (p.scores.rico > bestRico) { p.badges.unshift('punto-dulce'); bestRico = p.scores.rico; }
    }
  }
}

// Señales sobre el plato: aprobación en Morfy pesa más que una mención en Google;
// un local con 15%+ de reseñas de 1-2 estrellas resta.
// Un favorito tuyo es la señal más fuerte: lo probaste vos.
// Algo que calificaste 👎 es lo que más resta.
function signalBonus(r, lines, favorites = [], disliked = []) {
  const sig = lines.flatMap(l => l.product.signals || []);
  let bonus = lines.some(l => favorites.includes(l.product.id)) ? 0.12 : 0;
  if (lines.some(l => disliked.includes(l.product.id))) bonus -= 0.25;
  if (sig.some(s => s.source === 'morfy' && s.approval >= 95)) bonus += 0.08;
  else if (sig.some(s => s.source === 'google')) bonus += 0.05;
  if (r.googleNegative >= 15) bonus -= 0.05;
  return bonus;
}

const sameLines = (a, b) => a.lines.length === b.lines.length
  && a.lines.every(l => b.lines.some(m => m.product.id === l.product.id && m.qty === l.qty));

function maxPerRestaurant(sortedPlans, max) {
  const count = {};
  return sortedPlans.filter(p => (count[p.restaurant.id] = (count[p.restaurant.id] || 0) + 1) <= max);
}

function computeMedians(items) {
  const per = {};
  for (const it of items) for (const [c, u] of Object.entries(it.yields)) (per[c] ||= []).push(it.price / u);
  const med = {};
  for (const [c, xs] of Object.entries(per)) { xs.sort((a, b) => a - b); med[c] = xs[Math.floor(xs.length / 2)]; }
  return med;
}

export function memoryStorage() {
  const m = new Map();
  return { get: k => m.get(k), set: (k, v) => m.set(k, structuredClone(v)) };
}
