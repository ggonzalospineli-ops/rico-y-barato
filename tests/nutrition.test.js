import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateNutrition, parseGrams, dailyKcal } from '../engine/nutrition.js';

const it = (name, yields, description = '') => ({ name, description, yields });

test('nutrición: una ensalada con pollo grillado es más sana y liviana que una hamburguesa doble con bacon y papas', () => {
  const salad = estimateNutrition(it('Ensalada Caesar con pollo grillado', { ensaladas: 1 }, 'lechuga, pollo grillado, parmesano'));
  const burger = estimateNutrition(it('Doble Bacon Cheddar + Papas Grandes', { hamburguesa: 1 }, 'doble carne, bacon, cheddar'));
  assert.ok(salad.health > burger.health + 30, `${salad.health} vs ${burger.health}`);
  assert.ok(salad.kcal < burger.kcal / 2);
  assert.equal(salad.label, 'Liviano y sano');
  assert.ok(burger.reasons.includes('✗ frito') === false && burger.reasons.includes('+ papas grandes'));
});

test('nutrición: escala con la cantidad y lo frito suma', () => {
  const n10 = estimateNutrition(it('McNuggets x10', { nuggets: 10 }));
  const n20 = estimateNutrition(it('McNuggets x20', { nuggets: 20 }));
  assert.ok(Math.abs(n20.kcal - 2 * n10.kcal) <= 10);
  const horno = estimateNutrition(it('Empanada de carne al horno', { empanadas: 1 }));
  const frita = estimateNutrition(it('Empanada de carne frita', { empanadas: 1 }));
  assert.ok(frita.kcal > horno.kcal && frita.health < horno.health);
});

test('nutrición: el peso del menú afina la estimación y la gaseosa zero no suma', () => {
  assert.equal(parseGrams('medallón de carne de 180 g, cheddar'), 180);
  assert.equal(parseGrams('pizza de 8 porciones'), null);
  assert.equal(parseGrams('1/2 kg de helado'), 500);
  const big = estimateNutrition(it('Hamburguesa', { hamburguesa: 1 }, 'medallón de 250 g'));
  const small = estimateNutrition(it('Hamburguesa', { hamburguesa: 1 }, 'medallón de 90 g'));
  assert.ok(big.kcal > small.kcal && big.confidence === 'media');
  const coke = estimateNutrition(it('Combo hamburguesa + Coca', { hamburguesa: 1 }));
  const zero = estimateNutrition(it('Combo hamburguesa + Coca Zero', { hamburguesa: 1 }));
  assert.equal(coke.kcal - zero.kcal, 210);
});

test('nutrición: lo que necesitás por día según peso y objetivo', () => {
  assert.equal(dailyKcal(70, 'mantener'), 2100);
  assert.ok(dailyKcal(70, 'bajar') < dailyKcal(70, 'subir'));
  assert.equal(dailyKcal(5), null);
});
