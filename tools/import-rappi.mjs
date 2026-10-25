// Uso:
//   node tools/import-rappi.mjs <rappi_todos_productos.json> [--google reputacion.md] [--prefs preferencias.json]
//                               [--pages data/rappi-pages.json] [--signals data/signals.json] [--out data/rappi-catalog.json]
// Genera el catálogo que lee sources/json.js y muestra cuánto pudo medir por categoría.
// --pages es la salida de tools/fetch-rappi-pages.mjs (fotos, envío, demora, reseñas); si existe se usa sola.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { convert, parseGoogleTable } from '../importers/rappi.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const googlePath = flag('--google'), prefsPath = flag('--prefs');
const defaultPages = new URL('../data/rappi-pages.json', import.meta.url);
const pagesPath = flag('--pages') || (existsSync(defaultPages) ? defaultPages : null);
const defaultSignals = new URL('../data/signals.json', import.meta.url);
const signalsPath = flag('--signals') || (existsSync(defaultSignals) ? defaultSignals : null);
const out = flag('--out') || new URL('../data/rappi-catalog.json', import.meta.url);
const dataFile = name => new URL(`../data/${name}`, import.meta.url);
const readJson = url => JSON.parse(readFileSync(url, 'utf8'));
const home = existsSync(dataFile('home.json')) ? readJson(dataFile('home.json')) : null;
const otherApps = existsSync(dataFile('other-apps.json')) ? readJson(dataFile('other-apps.json')).items : {};
const pricesDir = dataFile('prices/');
const priceSnapshots = existsSync(pricesDir)
  ? readdirSync(pricesDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => ({ date: f.slice(0, 10), prices: readJson(new URL(f, pricesDir)) }))
  : [];
const input = args[0];
if (!input) { console.error('Falta el JSON de productos de Rappi.'); process.exit(1); }

const catalog = convert(JSON.parse(readFileSync(input, 'utf8')), {
  google: googlePath ? parseGoogleTable(readFileSync(googlePath, 'utf8')) : {},
  preferences: prefsPath ? JSON.parse(readFileSync(prefsPath, 'utf8')) : null,
  pages: pagesPath ? JSON.parse(readFileSync(pagesPath, 'utf8')) : {},
  signals: signalsPath ? JSON.parse(readFileSync(signalsPath, 'utf8')) : null,
  home, priceSnapshots, otherApps,
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
const withSchedule = catalog.restaurants.filter(r => r.schedule).length;
const withDistance = catalog.restaurants.filter(r => r.distanceKm != null);
console.log(`horarios: ${withSchedule} locales · distancia a ${home?.address || '(sin data/home.json)'}: ${withDistance.length} locales`
  + (withDistance.length ? ` (mediana ${withDistance.map(r => r.distanceKm).sort((a, b) => a - b)[withDistance.length >> 1]} km)` : ''));
console.log(`precios: días ${catalog.meta.priceDays.join(', ') || '-'} · con historial ${catalog.items.filter(i => i.priceHistory).length}`
  + ` · cambiaron ${catalog.items.filter(i => i.priceChange).length} · otras apps ${catalog.items.filter(i => i.otherApps).length}`);
console.log(`señales Google/Morfy: ${catalog.restaurants.filter(r => r.mentions).length} locales, ${catalog.items.filter(i => i.signals).length} productos`
  + (catalog.meta.unmatchedSignals.length ? ` · SIN MATCH: ${catalog.meta.unmatchedSignals.join(', ')}` : ''));
console.log(`descartados por precio implausible (${catalog.meta.discarded.length}):`, catalog.meta.discarded.slice(0, 15));
