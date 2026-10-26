import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGroup, encodeGroup, decodeGroup, setPersonLines, groupTotals, mergedLines } from '../engine/group.js';

const R = 'mcdonald-s-almagro';
const prices = { [`${R}:1`]: 8000, [`${R}:2`]: 5500 };

test('grupal: el link ida y vuelta conserva quién pide qué (con tildes y emojis)', () => {
  let g = emptyGroup(R);
  g = setPersonLines(g, 'Gonzalo', [{ itemId: `${R}:1`, qty: 2 }]);
  g = setPersonLines(g, 'Ñandú 🍔', [{ itemId: `${R}:2`, qty: 1 }]);
  const back = decodeGroup(encodeGroup(g), id => id in prices);
  assert.deepEqual(back, g);
  assert.ok(!encodeGroup(g).includes(R)); // los ids van cortos
});

test('grupal: un link roto o manipulado no rompe nada', () => {
  assert.equal(decodeGroup('basura!!'), null);
  const evil = btoa(JSON.stringify({ v: 1, r: R, p: [['<script>', [['1', 2]]], ['Ana', [['no-existe', 1], ['1', 999], ['2', 1]]]] }));
  const g = decodeGroup(evil, id => id in prices);
  assert.equal(g.people[0].name, 'script');
  assert.deepEqual(g.people[1].lines, [{ itemId: `${R}:2`, qty: 1 }]);
});

test('grupal: cada uno pone lo suyo más una parte del envío, y la suma da el total', () => {
  let g = emptyGroup(R);
  g = setPersonLines(g, 'A', [{ itemId: `${R}:1`, qty: 1 }]);
  g = setPersonLines(g, 'B', [{ itemId: `${R}:2`, qty: 1 }]);
  g = setPersonLines(g, 'C', [{ itemId: `${R}:1`, qty: 1 }]);
  const t = groupTotals(g, id => prices[id], 1000);
  assert.equal(t.total, 8000 + 5500 + 8000 + 1000);
  assert.equal(t.shares.reduce((s, x) => s + x.amount, 0), t.total);
  assert.equal(t.shares.find(s => s.name === 'B').amount, 5830);
  assert.deepEqual(mergedLines(g), [{ itemId: `${R}:1`, qty: 2 }, { itemId: `${R}:2`, qty: 1 }]);
  // Volver a cargar lo mismo con otro nombre en mayúsculas reemplaza, y vacío saca a la persona.
  assert.equal(setPersonLines(g, 'a', [{ itemId: `${R}:2`, qty: 1 }]).people.length, 3);
  assert.equal(setPersonLines(g, 'B', []).people.length, 2);
});
