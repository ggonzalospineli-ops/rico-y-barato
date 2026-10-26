// Receptor local para el relevamiento de PedidosYa: la página (abierta en Chrome) le manda el menú
// extraído y acá se guarda en data/pedidosya/<archivo>.json. Solo escucha en 127.0.0.1 y solo acepta
// pedidos que vengan de pedidosya.com.ar.
//
//   node tools/pedidosya-receiver.mjs          (puerto 4190)
//
// POST /guardar  { file, store, brand, url, products: [[nombre, precio, original]] }

import { createServer } from 'node:http';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const dir = new URL('../data/pedidosya/', import.meta.url);
mkdirSync(dir, { recursive: true });
const ORIGIN = /^https:\/\/www\.pedidosya\.com\.ar$/;

createServer((req, res) => {
  const origin = req.headers.origin || '';
  if (!ORIGIN.test(origin)) { res.writeHead(403).end(); return; }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  // Espera del lado del servidor: Chrome frena los setTimeout de las pestañas en segundo plano (uno por
  // minuto), pero no las respuestas de red. El extractor espera pidiendo /esperar?ms=N.
  if (req.method === 'GET' && req.url.startsWith('/esperar')) {
    const ms = Math.min(30000, Math.max(0, +(new URL(req.url, 'http://x').searchParams.get('ms')) || 0));
    setTimeout(() => res.writeHead(204).end(), ms);
    return;
  }
  if (req.method === 'GET' && req.url === '/lista') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(readFileSync(new URL('../.cache/pedidosya-lista.json', import.meta.url)));
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/scrape.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      .end(readFileSync(new URL('pedidosya-scrape.js', import.meta.url)));
    return;
  }
  // Lista de locales que entregan en la dirección (para saber qué menús bajar): .cache/pedidosya-cerca.json
  if (req.method === 'POST' && req.url === '/indice') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const list = JSON.parse(body).items.filter(x => /^https:\/\/www\.pedidosya\.com\.ar\/restaurantes\//.test(x.url))
          .map(x => ({ name: String(x.name).slice(0, 120), url: x.url.split('?')[0], info: String(x.info || '').slice(0, 200) }));
        mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
        writeFileSync(new URL('../.cache/pedidosya-cerca.json', import.meta.url), JSON.stringify(list, null, 1));
        console.log(`índice: ${list.length} locales`);
        res.writeHead(200).end(JSON.stringify({ ok: true, n: list.length }));
      } catch (e) { res.writeHead(400).end(String(e.message)); }
    });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/guardar') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => {
    try {
      const d = JSON.parse(body);
      const file = String(d.file || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!file || !Array.isArray(d.products) || !d.products.length) throw new Error('faltan datos');
      const products = d.products
        .filter(p => Array.isArray(p) && typeof p[0] === 'string' && p[1] > 0)
        .map(([n, price, original]) => [n.slice(0, 160), Math.round(price), original > price ? Math.round(original) : null]);
      const out = { store: String(d.store).slice(0, 120), brand: String(d.brand).slice(0, 60), url: String(d.url).slice(0, 300),
        fetchedAt: new Date().toISOString(), products };
      writeFileSync(new URL(`${file}.json`, dir), JSON.stringify(out, null, 1) + '\n');
      console.log(`guardado ${file}.json · ${products.length} productos · ${out.store}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, n: products.length }));
    } catch (e) {
      res.writeHead(400).end(String(e.message));
    }
  });
}).listen(4190, '127.0.0.1', () => console.log('receptor PedidosYa en http://127.0.0.1:4190'));
