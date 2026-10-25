// Uso:
//   node tools/import-rappi.mjs <rappi_todos_productos.json> [--google reputacion.md] [--prefs preferencias.json]
//                               [--pages data/rappi-pages.json] [--out data/rappi-catalog.json]
// Genera el catálogo que lee sources/json.js y muestra cuánto pudo medir por categoría.
// --pages es la salida de tools/fetch-rappi-pages.mjs (fotos, envío, demora, reseñas); si existe se usa sola.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { convert, parseGoogleTable } from '../importers/rappi.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const googlePath = flag('--google'), prefsPath = flag('--prefs');
const defaultPages = new URL('../data/rappi-pages.json', import.meta.url);
const pagesPath = flag('--pages') || (existsSync(defaultPages) ? defaultPages : null);
const out = flag('--out') || new URL('../data/rappi-catalog.json', import.meta.url);
const input = args[0];
if (!input) { console.error('Falta el JSON de productos de Rappi.'); process.exit(1); }

const catalog = convert(JSON.parse(readFileSync(input, 'utf8')), {
  google: googlePath ? parseGoogleTable(readFileSync(googlePath, 'utf8')) : {},
  preferences: prefsPath ? JSON.parse(readFileSync(prefsPath, 'utf8')) : null,
  pages: pagesPath ? JSON.parse(readFileSync(pagesPath, 'utf8')) : {},
});
writeFileSync(out, JSON.stringify(catalog));

const perCat = {};
for (const it of catalog.items) for (const c of Object.keys(it.yields)) perCat[c] = (perCat[c] || 0) + 1;
const measured = catalog.items.filter(it => Object.keys(it.yields).length);
console.log(`${catalog.restaurants.length} locales, ${catalog.items.length} productos, ${measured.length} medibles`);
console.log('por categoría:', perCat);
console.log('con datos de Google:', catalog.restaurants.filter(r => r.googleRating).length);
console.log(`con página de Rappi: ${catalog.restaurants.filter(r => r.rappiReviews != null).length}`
  + ` · fotos: ${catalog.items.filter(i => i.imageUrl).length} (${measured.filter(i => i.imageUrl).length} de los medibles)`);
console.log('favoritos sugeridos:', catalog.suggestedFavorites);
console.log(`descartados por precio implausible (${catalog.meta.discarded.length}):`, catalog.meta.discarded.slice(0, 15));
