import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine/engine.js';
import { cheapestCover } from '../engine/planner.js';
import { bayesRating } from '../engine/scoring.js';
import { demoSource } from '../sources/demo.js';

const box = (id, size, price) => ({ id, name: id, price, yields: { nuggets: size }, tags: [] });

test('planner: 27 nuggets con cajas de 4/10/20 elige la combinación más barata', () => {
  const r = cheapestCover([box('x4', 4, 4200), box('x10', 10, 8900), box('x20', 20, 15900)], 'nuggets', 27);
  // 20+4+4 = 28 piezas por 24300 es más barato que 20+10 = 30 por 24800.
  assert.equal(r.best.subtotal, 24300);
  assert.equal(r.best.quantity, 28);
});

test('planner: ofrece "un poco menos" sólo si ahorra al menos 15%', () => {
  const r = cheapestCover([box('x20', 20, 10000), box('x4', 4, 9000)], 'nuggets', 22);
  assert.equal(r.best.subtotal, 19000);          // 20 + 4
  assert.equal(r.short.quantity, 20);            // 20 piezas por 10000 (≥ 80% de 22)
});

test('bayes: pocas reseñas tiran hacia el promedio', () => {
  assert.ok(bayesRating(4.9, 12) < bayesRating(4.6, 900));
});

async function engine() {
  const e = createEngine({ source: demoSource(), now: () => Date.parse('2026-10-24T20:00:00Z') });
  await e.load();
  return e;
}

test('recommend: modo bestia escala con el apetito del usuario', async () => {
  const e = await engine();
  e.setAppetite('nuggets', { normal: 20, max: 30 });
  const r = e.recommend({ hunger: 'bestia', categories: ['nuggets'] });
  assert.equal(r.target.nuggets, 30);
  assert.ok(r.options.every(o => o.quantity >= 24)); // completas (≥30) o "un poco menos" (≥80%)
});

test('recommend: respeta la plata disponible y separa lo que se pasa', async () => {
  const e = await engine();
  const r = e.recommend({ hunger: 'normal', money: 12000, categories: ['sushi'] });
  assert.ok(r.options.every(o => o.total <= 12000));
  assert.ok(r.overBudget.every(o => o.overBudgetBy > 0));
});

test('recommend: con peso 0 manda el más barato por unidad, con 1 el más rico', async () => {
  const e = await engine();
  const cheap = e.recommend({ categories: ['sushi'], ricoWeight: 0 }).options[0];
  const tasty = e.recommend({ categories: ['sushi'], ricoWeight: 1 }).options[0];
  assert.equal(cheap.restaurant.id, 'ninja');
  assert.equal(tasty.restaurant.id, 'kansai');
});

test('badges: joya oculta y franquicia barata', async () => {
  const e = await engine();
  const opts = e.recommend({ categories: ['nuggets', 'sushi'], limit: 100 }).options;
  assert.ok(opts.find(o => o.restaurant.id === 'kansai').badges.includes('joya-oculta'));
  assert.equal(opts.filter(o => o.category === 'nuggets' && o.badges.includes('franquicia-barata')).length, 1);
});

test('exclusiones: sin cerdo desaparece la triple bacon', async () => {
  const e = await engine();
  e.setExcludedTags(['cerdo']);
  const lines = e.recommend({ categories: ['hamburguesa'], limit: 100 }).options.flatMap(o => o.lines);
  assert.ok(!lines.some(l => l.itemId === 'lb-trip'));
});

test('presupuesto: carrito es "por gastar", confirmar lo pasa a "gastado"', async () => {
  const e = await engine();
  e.setMonthlyBudget(100000);
  const plan = e.recommend({ categories: ['empanadas'] }).options[0];
  e.addToCart(plan);
  assert.equal(e.budgetSummary().planned, plan.total);
  e.confirmOrder(plan.id);
  const s = e.budgetSummary();
  assert.equal(s.planned, 0);
  assert.equal(s.spent, plan.total);
  assert.equal(s.remaining, 100000 - plan.total);
});

test('favoritos: el perfil de gusto detecta preferencia por locales', async () => {
  const e = await engine();
  ['ka-20', 'ga-nug24', 'er-mila'].forEach(id => e.toggleFavorite(id));
  const p = e.tasteProfile();
  assert.ok(p.insights.some(s => s.includes('barrio')));
});

test('persistencia: el estado sobrevive a recrear el motor', async () => {
  const store = new Map();
  const storage = { get: k => store.get(k), set: (k, v) => store.set(k, structuredClone(v)) };
  const a = createEngine({ source: demoSource(), storage });
  await a.load();
  a.setAppetite('sushi', { normal: 30, max: 45 });
  const b = createEngine({ source: demoSource(), storage });
  assert.deepEqual(b.getState().profile.appetite.sushi, { normal: 30, max: 45 });
});

test('migración: perfiles guardados reciben los filtros y apetitos nuevos', () => {
  const storage = {
    get: key => key === 'state' ? { profile: { appetite: { sushi: { normal: 30, max: 45 } }, enabledCategories: ['sushi'] } } : null,
    set() {},
  };
  const e = createEngine({ source: demoSource(), storage });
  const profile = e.getState().profile;
  for (const category of ['tacos', 'wraps', 'carnes', 'ensaladas']) {
    assert.ok(profile.enabledCategories.includes(category));
    assert.ok(e.targetFor(category, 'normal') > 0);
  }
  assert.deepEqual(profile.appetite.sushi, { normal: 30, max: 45 });
});

test('calidad con reseñas de Rappi: 4.6 con 300 reseñas le gana a 5.0 con 4', async () => {
  const { quality, isHiddenGem } = await import('../engine/scoring.js');
  const solid = { rappiScore: 4.6, rappiReviews: 300 };
  const lucky = { rappiScore: 5.0, rappiReviews: 4 };
  assert.ok(quality(solid) > quality(lucky));
  assert.ok(isHiddenGem({ ...solid, chain: false }));
  assert.ok(!isHiddenGem({ ...solid, chain: true }));
  assert.ok(!isHiddenGem({ rappiScore: 4.6, rappiReviews: 2000, chain: false })); // ya es conocido
});

test('punto dulce: ninguna opción marcada tiene otra más rica y más barata a la vez', async () => {
  const e = await engine();
  const r = e.recommend({ categories: ['sushi'], limit: 100, map: true });
  const sweet = r.all.filter(p => p.badges.includes('punto-dulce'));
  assert.ok(sweet.length >= 1);
  for (const s of sweet) {
    assert.ok(!r.all.some(o => o !== s && o.unitCost <= s.unitCost && o.scores.rico > s.scores.rico));
  }
});

test('somos N: la cantidad objetivo se multiplica por la cantidad de personas', async () => {
  const e = await engine();
  const solo = e.recommend({ categories: ['empanadas'] }).target.empanadas;
  const tres = e.recommend({ categories: ['empanadas'], people: 3 });
  assert.equal(tres.target.empanadas, solo * 3);
  assert.ok(tres.options.every(o => o.quantity >= Math.ceil(solo * 3 * 0.8)));
});
