// Cruza los menús relevados en PedidosYa (data/pedidosya/*.json) con el catálogo de Rappi y escribe las
// entradas "pedidosya" de data/other-apps.json (las de otras apps, como Morfy, se conservan).
//
//   node tools/import-pedidosya.mjs        (después: node tools/import-rappi.mjs ... para regenerar)
//
// Formato de cada archivo: { store, brand, url, fetchedAt, products: [[nombre, precio, precioSinDescuento|null]] }
// El relevamiento se hace desde el navegador (PedidosYa no deja pedir las páginas por HTTP) y con los
// locales abiertos: cerrados solo muestran los productos con descuento.
//
// Solo se cruza el mismo producto (nombre igual, sin importar mayúsculas, tildes ni espacios). El cruce
// "parecido" de las fotos no sirve acá: ignora el tamaño, y un Big Mac Grande no cuesta lo que uno Mediano.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { photoKey, brandOf } from '../importers/rappi.js';

const dataDir = new URL('../data/', import.meta.url);
const pyaDir = new URL('pedidosya/', dataDir);
const catalog = JSON.parse(readFileSync(new URL('rappi-catalog.json', dataDir), 'utf8'));
const otherPath = new URL('other-apps.json', dataDir);
const other = existsSync(otherPath) ? JSON.parse(readFileSync(otherPath, 'utf8')) : { items: {} };

// Sacar lo de PedidosYa de corridas anteriores.
for (const [id, list] of Object.entries(other.items)) {
  const kept = list.filter(o => o.app !== 'pedidosya');
  if (kept.length) other.items[id] = kept; else delete other.items[id];
}

const restaurantsById = Object.fromEntries(catalog.restaurants.map(r => [r.id, r]));
let matched = 0, files = 0;
for (const file of existsSync(pyaDir) ? readdirSync(pyaDir).filter(f => f.endsWith('.json')) : []) {
  const store = JSON.parse(readFileSync(new URL(file, pyaDir), 'utf8'));
  files++;
  const byKey = new Map(store.products.map(([name, price, original]) => [photoKey(name), { name, price, original }]));
  const day = store.fetchedAt.slice(0, 10);
  for (const it of catalog.items) {
    const r = restaurantsById[it.restaurantId];
    if (!r || (r.brand || brandOf(r.name)) !== store.brand) continue;
    const hit = byKey.get(photoKey(it.name));
    if (!hit) continue;
    (other.items[it.id] ||= []).push({
      app: 'pedidosya', name: hit.name, price: hit.price, same: true,
      note: `${store.store}${hit.original ? `, con descuento (sin descuento ${hit.original.toLocaleString('es-AR')})` : ''}; relevado el ${day}`,
    });
    matched++;
  }
}
writeFileSync(otherPath, JSON.stringify(other, null, 2) + '\n');
console.log(`PedidosYa: ${files} local(es) · ${matched} productos del catálogo con precio en PedidosYa`);
