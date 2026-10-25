// Fachada del motor. La UI solo habla con lo que devuelve createEngine().
// Estado persistente: perfil (apetito, exclusiones), favoritos, presupuesto, carrito y pedidos.

import { CATEGORIES, BIG_FOUR } from '../data/catalog.js';
import { cheapestCover } from './planner.js';
import { quality, isHiddenGem, cheapnessByRank, clamp01 } from './scoring.js';
import { buildTaste, affinity, describeTaste } from './taste.js';

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
};

function defaultState() {
  return {
    profile: {
      appetite: structuredClone(DEFAULT_APPETITE),
      enabledCategories: Object.keys(CATEGORIES),
      excludedTags: [],            // ej: ['cerdo', 'tacc', 'lacteos']
    },
    hiddenItems: [],               // productos que el usuario marcó como mal medidos o que no quiere ver
    favorites: [],                 // ids de productos
    seededFavorites: [],           // sugeridos por la fuente ya aplicados (para no re-agregar los que el usuario sacó)
    budget: { monthly: 0 },        // 0 = sin tope mensual
    cart: [],                      // planes guardados "por gastar"
    orders: [],                    // { id, planId, restaurantId, title, total, at }
  };
}

export function createEngine({ source, storage = memoryStorage(), now = () => Date.now() } = {}) {
  const listeners = new Set();
  let state = { ...defaultState(), ...(storage.get('state') || {}) };
  let restaurants = [], items = [], byRestaurant = {}, restaurantsById = {}, medianUnitPrice = {};

  function emit(type) {
    storage.set('state', state);
    for (const fn of listeners) fn({ type, state: snapshot() });
  }
  const snapshot = () => structuredClone(state);

  async function load() {
    const data = await source.load();
    ({ restaurants, items } = data);
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

  const allowed = it => !state.hiddenItems.includes(it.id) && !it.tags.some(t => state.profile.excludedTags.includes(t));
  const taste = () => buildTaste(items.filter(i => state.favorites.includes(i.id)), restaurantsById, medianUnitPrice);

  function targetFor(category, hunger) {
    const a = state.profile.appetite[category];
    return Math.max(1, Math.round(HUNGER[hunger].factor(a)));
  }

  // Opciones para comer ya. Cada opción es un plan completo de un local.
  // people: "somos N" — la cantidad objetivo se multiplica (cada uno con el apetito del perfil).
  // map: true devuelve además todos los planes que entran en la plata, para el mapa Rico × Barato.
  function recommend({ hunger = 'normal', money = Infinity, categories, ricoWeight = 0.5, limit = 12, people = 1, map = false } = {}) {
    const n = Math.max(1, Math.round(people));
    const cats = categories?.length ? categories : state.profile.enabledCategories;
    const t = taste();
    const available = Math.min(money, budgetSummary().remaining);
    const plans = [];

    for (const category of cats) {
      const target = targetFor(category, hunger) * n;
      for (const r of restaurants) {
        const products = (byRestaurant[r.id] || []).filter(allowed);
        const cover = cheapestCover(products, category, target);
        if (!cover?.best) continue;
        plans.push(makePlan(r, category, target, cover.best, 'completo', t));
        if (cover.short) plans.push(makePlan(r, category, target, cover.short, 'un-poco-menos', t));
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
    return {
      target: Object.fromEntries(cats.map(c => [c, targetFor(c, hunger) * n])),
      people: n,
      available: Number.isFinite(available) ? available : null,
      options: maxPerRestaurant(affordable.sort(byScore), 2).slice(0, limit),
      overBudget: plans.filter(p => p.overBudgetBy).sort((a, b) => a.overBudgetBy - b.overBudgetBy).slice(0, 5),
      ...(map ? { all: affordable } : {}),
    };
  }

  function makePlan(r, category, target, cover, variant, t) {
    const total = cover.subtotal + (r.deliveryFee || 0);
    const aff = Math.max(...cover.lines.map(l => affinity(t, l.product, r)));
    const badges = [];
    if (isHiddenGem(r)) badges.push('joya-oculta');
    if (cover.lines.some(l => l.product.salesRank <= 3)) badges.push('mas-vendido');
    if (cover.lines.some(l => l.product.originalPrice)) badges.push('descuento');
    if (cover.lines.some(l => state.favorites.includes(l.product.id))) badges.push('favorito');
    return {
      id: `${r.id}:${category}:${variant}:${cover.quantity}`,
      restaurant: publicRestaurant(r),
      category, variant, target,
      quantity: cover.quantity,
      unit: CATEGORIES[category].unit,
      lines: cover.lines.map(l => ({
        itemId: l.product.id, name: l.product.name, qty: l.qty, price: l.product.price,
        originalPrice: l.product.originalPrice || null, discount: l.product.discount || null,
        imageUrl: l.product.imageUrl || null,
      })),
      subtotal: cover.subtotal,
      deliveryFee: r.deliveryFee || 0,
      total,
      unitCost: Math.round(total / cover.quantity),
      scores: { rico: clamp01(0.7 * quality(r) + 0.3 * aff), barato: 0, total: 0 },
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
    googleRating: r.googleRating ?? null, googleReviews: r.googleReviews ?? null, rappiRating: r.rappiRating ?? null,
    deliveryFee: r.deliveryFee ?? null, etaMin: r.etaMin ?? null, quality: quality(r), hiddenGem: isHiddenGem(r),
  });
  const publicItem = it => ({
    id: it.id, name: it.name, description: it.description || '', section: it.section || null,
    price: it.price, originalPrice: it.originalPrice || null, discount: it.discount || null,
    imageUrl: it.imageUrl || null,
    yields: it.yields, tags: it.tags, salesRank: it.salesRank ?? null,
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
    item: id => { const it = items.find(i => i.id === id); return it ? publicItem(it) : null; },
    menu: restaurantId => (byRestaurant[restaurantId] || []).map(publicItem),
    restaurants: () => restaurants.map(publicRestaurant),
    recommend,
    rankings,
    budgetSummary,
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
        id: `o${now()}`, planId, restaurantId: plan.restaurant.id,
        title: `${plan.quantity} ${plan.unit} de ${CATEGORIES[plan.category].label} · ${plan.restaurant.name}`,
        total: plan.total, at: now(),
      });
      emit('orders');
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
