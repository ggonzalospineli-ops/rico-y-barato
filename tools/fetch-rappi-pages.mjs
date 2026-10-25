// Baja la página de cada local de Rappi y guarda lo que el scrapeo de menús no trae:
// foto de cada producto (por product_id), envío, demora, logo, portada y rating con cantidad de reseñas.
//
// Uso: node tools/fetch-rappi-pages.mjs <rappi_todos_productos.json> [--out data/rappi-pages.json] [--delay 1000]
// Es reanudable: cada local queda en .cache/pages/<id>.json y no se vuelve a pedir.
// Uso personal y a ritmo de persona (una página por segundo).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const out = flag('--out', new URL('../data/rappi-pages.json', import.meta.url));
const delay = +flag('--delay', 1000);
const input = args[0];
if (!input) { console.error('Falta el JSON de productos de Rappi.'); process.exit(1); }

const cacheDir = new URL('../.cache/pages/', import.meta.url);
mkdirSync(cacheDir, { recursive: true });
const scrape = JSON.parse(readFileSync(input, 'utf8'));
const urls = [...new Set(scrape.restaurants.map(r => r.url).filter(Boolean))];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Accept-Language': 'es-AR,es;q=0.9',
};

function extract(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('sin __NEXT_DATA__');
  const pageProps = JSON.parse(m[1]).props?.pageProps || {};
  const fallback = pageProps.fallback || {};
  const r = fallback[Object.keys(fallback).find(k => k.includes('restaurant/'))];
  if (!r) throw new Error('sin datos del local');
  const products = {}, prices = {};
  for (const c of r.corridors || []) for (const p of c.products || []) {
    if (p.image) products[p.id] = p.image;
    if (p.price != null) prices[p.id] = [p.price, p.realPrice ?? p.price];
  }
  return {
    v: VERSION, fetchedAt: new Date().toISOString(),
    storeId: r.id, name: r.name, brandName: r.brandName || null, address: r.address || null,
    location: r.location || null,                    // [lng, lat] del local
    status: r.status || null, schedule: pageProps.scheduleData || null, // horario de toda la semana
    deliveryPrice: r.deliveryPrice ?? null, eta: r.eta || null,
    logo: r.logo || null, background: r.backgroundImage || null,
    score: r.ratingData?.score ?? r.rating ?? null, reviews: r.ratingData?.total_reviews ?? null,
    products, prices,                                // prices: id → [precio, precio sin descuento]
  };
}

// Subir VERSION cuando extract() guarde campos nuevos: las entradas viejas de la caché se vuelven a pedir.
const VERSION = 2;
const fresh = file => { try { return JSON.parse(readFileSync(file, 'utf8')).v === VERSION; } catch { return false; } };

let fetched = 0, cached = 0, failed = [];
for (const [i, url] of urls.entries()) {
  const id = url.split('/').pop();
  const file = new URL(`${encodeURIComponent(id)}.json`, cacheDir);
  if (existsSync(file) && fresh(file)) { cached++; continue; }
  try {
    let res = await fetch(url, { headers: HEADERS });
    if (res.status === 429 || res.status >= 500) { await sleep(10000); res = await fetch(url, { headers: HEADERS }); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, JSON.stringify({ url, ...extract(await res.text()) }));
    fetched++;
  } catch (e) {
    failed.push(`${url} (${e.message})`);
  }
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${urls.length} · nuevos ${fetched} · en caché ${cached} · fallidos ${failed.length}`);
  await sleep(delay);
}

const pages = {};
for (const url of urls) {
  const file = new URL(`${encodeURIComponent(url.split('/').pop())}.json`, cacheDir);
  if (existsSync(file)) pages[url] = JSON.parse(readFileSync(file, 'utf8'));
}
writeFileSync(out, JSON.stringify(pages));

// Foto de precios del día para el historial: data/prices/AAAA-MM-DD.json = { url: { productId: precio } }.
const day = new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local (Argentina), no UTC
const pricesDir = new URL('../data/prices/', import.meta.url);
mkdirSync(pricesDir, { recursive: true });
const snapshot = {};
for (const [url, p] of Object.entries(pages)) {
  if (!p.prices) continue;
  snapshot[url] = Object.fromEntries(Object.entries(p.prices).map(([id, [price]]) => [id, price]));
}
writeFileSync(new URL(`${day}.json`, pricesDir), JSON.stringify(snapshot));
console.log(`precios del ${day}: ${Object.values(snapshot).reduce((n, s) => n + Object.keys(s).length, 0)} productos`);
console.log(`listo: ${Object.keys(pages).length}/${urls.length} locales · fallidos ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 20).join('\n'));
