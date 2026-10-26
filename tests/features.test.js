import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStatus, distanceKm } from '../engine/hours.js';
import { splitBill } from '../engine/split.js';
import { parseIntent } from '../engine/intent.js';
import { isArgentineVoice, isFemaleVoice, rankFemaleVoices } from '../engine/voice.js';

const week = (open, close, days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) =>
  days.map(day => ({ day, time: { openTime: open, closeTime: close } }));
// 2026-10-24 es sábado
const at = (hh, mm = 0, d = 24) => new Date(2026, 9, d, hh, mm);

test('horarios: abierto, cerrado y próxima apertura', () => {
  const s = week('11:00', '23:00');
  assert.equal(openStatus(s, at(12)).open, true);
  assert.equal(openStatus(s, at(12)).closesAt, '23:00');
  const closed = openStatus(s, at(9));
  assert.equal(closed.open, false);
  assert.match(closed.label, /hoy a las 11:00/);
  assert.match(openStatus(s, at(23, 30)).label, /mañana a las 11:00/);
});

test('horarios: una franja que cruza la medianoche sigue abierta de madrugada', () => {
  const s = week('20:00', '02:00', ['Viernes']);
  assert.equal(openStatus(s, at(1, 30)).open, true);            // sábado 01:30, abierto desde el viernes
  assert.equal(openStatus(s, at(3)).open, false);
  assert.equal(openStatus(s, new Date(2026, 9, 23, 21)).open, true); // viernes 21:00
});

test('horarios: 00:00-23:59 es todo el día; sin datos se asume abierto', () => {
  assert.equal(openStatus(week('00:00', '23:59'), at(23, 58)).open, true);
  assert.equal(openStatus(week('00:00', '23:59'), at(4)).label, 'Abierto todo el día');
  assert.deepEqual(openStatus(null, at(4)), { known: false, open: true, label: 'Horario sin datos' });
});

test('horarios: avisa cuando cierra pronto', () => {
  assert.equal(openStatus(week('11:00', '23:00'), at(22, 30)).closingSoon, true);
  assert.equal(openStatus(week('11:00', '23:00'), at(20)).closingSoon, false);
});

test('distancia: Billinghurst 1292 a McDonald\'s Córdoba 3821 ~ 0,7 km', () => {
  const d = distanceKm([-34.594839, -58.4136437], [-34.5974825646, -58.420787640786]);
  assert.ok(d > 0.6 && d < 0.8, `dio ${d}`);
});

test('dividir: por piezas, envío y propina parejos, y la suma da el total exacto', () => {
  const r = splitBill({ subtotal: 30000, deliveryFee: 1390, tipPct: 10, people: [{ name: 'Gonza', units: 20 }, { name: 'Nico', units: 10 }] });
  assert.equal(r.total, 30000 + 1390 + 3000);
  assert.equal(r.shares.reduce((s, x) => s + x.amount, 0), r.total);
  assert.ok(r.shares[0].amount > r.shares[1].amount);
  assert.equal(r.shares[1].amount, Math.round((10000 + 2195) / 10) * 10);
});

test('dividir: sin piezas cargadas, parejo', () => {
  const r = splitBill({ subtotal: 10000, people: [{}, {}, {}] });
  assert.equal(r.shares.reduce((s, x) => s + x.amount, 0), 10000);
  assert.deepEqual(r.shares.map(s => s.name), ['Persona 1', 'Persona 2', 'Persona 3']);
});

test('frases: el pedido típico', () => {
  const r = parseIntent('somos 3, uno no come carne, tenemos 25 lucas y estamos re cagados de hambre');
  assert.equal(r.people, 3);
  assert.equal(r.money, 25000);
  assert.equal(r.hunger, 'bestia');
  assert.deepEqual(r.exclude.sort(), ['carne', 'cerdo']);
});

test('voz: prioriza una mujer argentina y nunca elige una voz masculina', () => {
  const voices = [
    { voice_id: 'mx', name: 'Sofía', labels: { gender: 'female', accent: 'Mexican Spanish' } },
    { voice_id: 'ar', name: 'Mila', labels: { gender: 'female', accent: 'Argentinian' } },
    { voice_id: 'man', name: 'Diego', labels: { gender: 'male', accent: 'Argentinian' } },
  ];
  const ranked = rankFemaleVoices(voices);
  assert.equal(ranked[0].voice_id, 'ar');
  assert.ok(isArgentineVoice(ranked[0]));
  assert.ok(ranked.every(isFemaleVoice));
});

test('voz: respeta un Voice ID configurado aunque sea una voz personalizada sin etiquetas', () => {
  const ranked = rankFemaleVoices([{ voice_id: 'custom', name: 'Mi voz' }], 'custom');
  assert.equal(ranked[0].voice_id, 'custom');
});

test('frases: plata en todas sus formas', () => {
  assert.equal(parseIntent('tengo $18.500').money, 18500);
  assert.equal(parseIntent('con 20k').money, 20000);
  assert.equal(parseIntent('15 mil').money, 15000);
  assert.equal(parseIntent('veinte lucas').money, 20000);
  assert.equal(parseIntent('sin límite').money, Infinity);
  assert.equal(parseIntent('30 piezas de sushi').money, null);   // piezas no son plata
});

test('frases: comida, hambre y rico/barato', () => {
  assert.equal(parseIntent('unas empanadas para picar').category, 'empanadas');
  assert.equal(parseIntent('unas empanadas para picar').hunger, 'poco');
  assert.equal(parseIntent('con mi novia, algo rico de sushi').people, 2);
  assert.equal(parseIntent('con mi novia, algo rico de sushi').ricoWeight, 0.85);
  assert.equal(parseIntent('pizza, lo más barato').ricoWeight, 0.15);
  assert.equal(parseIntent('mucha hambre, hamburguesas').hunger, 'mucho');
  assert.equal(parseIntent('cualquier cosa menos pizza, sin pizza').category, null);
  assert.deepEqual(parseIntent('vegano').exclude.sort(), ['carne', 'cerdo', 'lacteos', 'pescado', 'pollo']);
});

test('frases: reconoce los filtros nuevos de comida', () => {
  assert.equal(parseIntent('quiero tacos').category, 'tacos');
  assert.equal(parseIntent('un wrap o burrito').category, 'wraps');
  assert.equal(parseIntent('algo de parrilla, un bife').category, 'carnes');
  assert.equal(parseIntent('una ensalada caesar').category, 'ensaladas');
});

import { convert, parseTags, priceHistory, isInflatedOriginal } from '../importers/rappi.js';
import { createEngine } from '../engine/engine.js';
import { jsonSource } from '../sources/json.js';

const prod = (id, name, price, extra = {}) => ({ product_id: id, name, description: '', category: 'Hamburguesas', price_ars: price, original_price_ars: price, ...extra });
const URL_A = 'https://www.rappi.com.ar/restaurantes/1-a', URL_B = 'https://www.rappi.com.ar/restaurantes/2-b';
const scrape = {
  scraped_at: '2026-10-20T10:00:00Z',
  restaurants: [
    { restaurant: 'Abierto - Palermo', url: URL_A, rating: 4.5, products: [prod('1', 'Cheeseburger', 9000), prod('2', 'Doble bacon', 12000)] },
    { restaurant: 'Cerrado - Recoleta', url: URL_B, rating: 4.5, products: [prod('9', 'Cheeseburger', 5000)] },
  ],
};
const sat = (h) => new Date(2026, 9, 24, h).getTime();
const pages = {
  [URL_A]: { location: [-58.4207876, -34.5974825], schedule: [{ day: 'Sábado', time: { openTime: '10:00', closeTime: '23:00' } }],
    prices: { 1: [8000, 9000], 2: [12000, 12000] } },
  [URL_B]: { location: [-58.40, -34.59], schedule: [{ day: 'Sábado', time: { openTime: '20:00', closeTime: '23:00' } }] },
};
const build = (opts = {}) => convert(scrape, { pages, home: { lat: -34.594839, lng: -58.4136437 },
  priceSnapshots: [{ date: '2026-10-24', prices: { [URL_A]: { 1: 8000, 2: 12000 } } }], ...opts });
const engineAt = async (cat, h) => {
  const e = createEngine({ source: jsonSource(async () => structuredClone(cat)), now: () => sat(h) });
  await e.load();
  return e;
};

test('abierto ahora: un local cerrado no se recomienda, y se cuenta', async () => {
  const e = await engineAt(build(), 13);
  const r = e.recommend({ categories: ['hamburguesa'], limit: 10 });
  assert.ok(r.options.every(o => o.restaurant.id === 'abierto-palermo'));
  assert.equal(r.closed, 1);
  assert.equal(e.recommend({ categories: ['hamburguesa'], openOnly: false }).closed, 0);
  const night = (await engineAt(build(), 21)).recommend({ categories: ['hamburguesa'], limit: 10 });
  assert.ok(night.options.some(o => o.restaurant.id === 'cerrado-recoleta'));
});

test('distancia a casa y precio más nuevo de la página', () => {
  const cat = build();
  const a = cat.restaurants.find(r => r.id === 'abierto-palermo');
  assert.ok(a.distanceKm > 0.6 && a.distanceKm < 0.8);
  const cheese = cat.items.find(i => i.id === 'abierto-palermo:1');
  assert.equal(cheese.price, 8000);
  assert.equal(cheese.originalPrice, 9000);
  assert.equal(cheese.discount, '-11%');
});

test('historial: baja de precio entre días y alerta en favoritos', async () => {
  const cat = build();
  const cheese = cat.items.find(i => i.id === 'abierto-palermo:1');
  assert.deepEqual(cheese.priceHistory, [['2026-10-20', 9000], ['2026-10-24', 8000]]);
  assert.deepEqual(cheese.priceChange, { from: 9000, to: 8000, pct: -11, since: '2026-10-20' });
  assert.deepEqual(cat.meta.priceDays, ['2026-10-20', '2026-10-24']);
  const e = await engineAt(cat, 13);
  assert.deepEqual(e.priceAlerts(), []);
  e.toggleFavorite('abierto-palermo:1');
  assert.equal(e.priceAlerts()[0].id, 'abierto-palermo:1');
  assert.ok(e.recommend({ categories: ['hamburguesa'] }).options.some(o => o.badges.includes('bajo-precio')));
});

test('historial: tachado inflado solo con una semana y 3+ días de datos', () => {
  assert.equal(isInflatedOriginal(20000, [['2026-10-01', 10000], ['2026-10-05', 10500], ['2026-10-09', 10000]]), true);
  assert.equal(isInflatedOriginal(20000, [['2026-10-01', 10000], ['2026-10-02', 10000], ['2026-10-03', 10000]]), false);
  assert.equal(isInflatedOriginal(10500, [['2026-10-01', 10000], ['2026-10-05', 10500], ['2026-10-09', 10000]]), false);
  assert.deepEqual(priceHistory('u', '1', '2026-10-01', 100, []), {});
});

test('otras apps: "más barato en otra" solo si es el mismo producto', async () => {
  const cat = build({ otherApps: {
    'abierto-palermo:1': [{ app: 'pedidosya', price: 7000, same: true }],
    'abierto-palermo:2': [{ app: 'morfy', price: 1000, same: false, note: 'combo distinto' }],
  } });
  const e = await engineAt(cat, 13);
  const plans = e.recommend({ categories: ['hamburguesa'], limit: 10, map: true }).all;
  const by = id => plans.find(p => p.lines.some(l => l.itemId === id));
  assert.ok(by('abierto-palermo:1').badges.includes('mas-barato-en-otra'));
  assert.ok(!by('abierto-palermo:2')?.badges.includes('mas-barato-en-otra'));
});

test('¿estuvo rico?: 👍 suma a favoritos, 👎 los saca y baja el puntaje', async () => {
  let t = sat(13);
  const cat = build();
  const e = createEngine({ source: jsonSource(async () => structuredClone(cat)), now: () => t });
  await e.load();
  const plan = e.recommend({ categories: ['hamburguesa'] }).options.find(o => o.lines[0].itemId === 'abierto-palermo:1');
  const ricoAntes = plan.scores.rico;
  e.addToCart(plan); e.confirmOrder(plan.id);
  assert.deepEqual(e.pendingRatings(), []);                 // recién pedido: todavía no se pregunta
  t += 41 * 60000;
  const [o] = e.pendingRatings();
  assert.equal(o.lines[0].itemId, 'abierto-palermo:1');
  e.rateOrder(o.id, 'up');
  assert.ok(e.getState().favorites.includes('abierto-palermo:1'));
  e.rateOrder(o.id, 'down');
  assert.ok(!e.getState().favorites.includes('abierto-palermo:1'));
  assert.ok(e.getState().disliked.includes('abierto-palermo:1'));
  const after = e.recommend({ categories: ['hamburguesa'] }).options.find(x => x.lines[0].itemId === 'abierto-palermo:1');
  assert.ok(after.scores.rico < ricoAntes && after.badges.includes('no-te-gusto'));
  assert.deepEqual(e.pendingRatings(), []);
});

test('pedido externo (ticket o a mano): suma al gasto del mes', async () => {
  const e = await engineAt(build(), 13);
  const o = e.addExternalOrder({ restaurantName: 'Mi Barrio', total: 27700, tip: 2000, source: 'ticket' });
  assert.equal(e.budgetSummary().spent, 27700);
  assert.equal(o.source, 'ticket');
  assert.throws(() => e.addExternalOrder({ total: 0 }));
});

test('etiquetas: carne y pollo para "no como carne"', () => {
  const tags = (name, description = '') => parseTags({ name, description });
  assert.ok(tags('Cheeseburger doble').includes('carne'));
  assert.ok(!tags('Crispy chicken burger').includes('carne'));
  assert.ok(tags('Crispy chicken burger').includes('pollo'));
  assert.ok(!tags('Veggie burger de lentejas').includes('carne'));
  assert.ok(tags('Milanesa napolitana').includes('carne'));
  assert.ok(!tags('Milanesa de berenjena').includes('carne'));
  assert.ok(tags('Nuggets x10').includes('pollo'));
  assert.ok(!tags('Pizza muzzarella').includes('carne'));
});

test('exclusiones del pedido: no tocan el perfil', async () => {
  const e = await engineAt(build(), 13);
  const r = e.recommend({ categories: ['hamburguesa'], exclude: ['carne', 'cerdo'] }); // lo que hace "no come carne"
  assert.equal(r.options.length, 0);                       // todas las de prueba son de carne
  assert.deepEqual(e.getState().profile.excludedTags, []);
  assert.ok(e.recommend({ categories: ['hamburguesa'] }).options.length > 0);
});

test('frases: "morimos de hambre" y "que no sea frito"', () => {
  assert.equal(parseIntent('somos cinco y morimos de hambre').hunger, 'bestia');
  assert.equal(parseIntent('somos cinco y morimos de hambre').people, 5);
  assert.deepEqual(parseIntent('algo livianito que no sea frito').exclude, ['frito']);
});

import { weightedShuffle, decideDeck } from '../engine/shuffle.js';

const plan = (id, rest, total) => ({ id, restaurant: { id: rest }, scores: { total } });

test('decidí por mí: no siempre arranca con la mejor, pero la mejor sale primero más seguido', () => {
  const plans = [plan('a', 'r1', 0.9), plan('b', 'r2', 0.6), plan('c', 'r3', 0.5), plan('d', 'r4', 0.3)];
  const firsts = {};
  for (let i = 0; i < 4000; i++) { const f = decideDeck(plans)[0].id; firsts[f] = (firsts[f] || 0) + 1; }
  assert.equal(Object.keys(firsts).length, 4);              // todas pueden salir primero
  assert.ok(firsts.a > firsts.b && firsts.b > firsts.d);    // pero con preferencia por el puntaje
});

test('decidí por mí: un plan por local y sin repetir la primera carta', () => {
  const plans = [plan('a1', 'r1', 0.9), plan('a2', 'r1', 0.8), plan('b', 'r2', 0.6)];
  const deck = decideDeck(plans, { rand: () => 0.5 });
  assert.deepEqual(deck.map(p => p.restaurant.id).sort(), ['r1', 'r2']);
  const first = deck[0].id;
  assert.notEqual(decideDeck(plans, { rand: () => 0.5, lastFirstId: first })[0].id, first);
  assert.deepEqual(weightedShuffle([], () => 1), []);
});

import { fullSchedule } from '../importers/rappi.js';
import { openStatus as openAt } from '../engine/hours.js';

test('horarios: el tramo de madrugada solo no deja al local cerrado de día, y los tramos completos mandan', () => {
  const page = { schedule: [{ day: 'Lunes', time: { openTime: '00:00', closeTime: '03:30' } }, { day: 'Martes', time: { openTime: '11:00', closeTime: '23:00' } }] };
  const lunes17 = new Date('2026-10-26T17:00:00'); // lunes
  assert.equal(openAt(fullSchedule(page), lunes17).open, true);
  assert.equal(openAt(fullSchedule(page), lunes17).known, false);
  const full = { ...page, weekSchedules: { mon: [['00:00', '03:30'], ['11:00', '16:00']] } };
  assert.equal(openAt(fullSchedule(full), lunes17).open, false);              // con el horario completo, sí cerró
  assert.equal(openAt(fullSchedule(full), new Date('2026-10-26T12:00:00')).open, true);
});
