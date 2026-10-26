// Se carga dentro de una página de PedidosYa (lo sirve tools/pedidosya-receiver.mjs) y extrae menús.
// PedidosYa dibuja solo los productos visibles, así que se baja de a poco juntando lo que aparece.
// Frena si aparece el desafío anti-bot.
//
//   run(file, brand)            → el menú de la página actual
//   runAll(lista, { pausa })    → abre cada local en un marco de la misma pestaña, uno por vez, con pausa

// Las esperas pasan por el receptor: en una pestaña en segundo plano Chrome demora los setTimeout hasta
// un minuto, pero no las respuestas de red.
const w = ms => fetch(`http://127.0.0.1:4190/esperar?ms=${ms}`).catch(() => new Promise(r => setTimeout(r, ms)));
const BLOCK = /confirma que eres un humano|ha sido denegado/i;

async function extract(win) {
  const doc = win.document;
  if (BLOCK.test(doc.body.innerText)) return { bloqueo: true };
  if (!/-menu/.test(win.location.href)) return { redirigio: win.location.href };
  const money = t => +t.replace(/[^\d]/g, '');
  const isPrice = e => e.children.length === 0 && /^\$\s?[\d.]+$/.test(e.textContent.trim());
  const found = new Map();
  const collect = () => {
    const seen = new Set();
    for (const p of [...doc.querySelectorAll('#main-content *')].filter(isPrice)) {
      let card = p.parentElement;
      for (let i = 0; i < 7 && card; i++) {
        if ([...card.querySelectorAll('*')].some(e => e.children.length === 0 && !isPrice(e) && e.textContent.trim().length > 2)) break;
        card = card.parentElement;
      }
      if (!card || seen.has(card)) continue;
      seen.add(card);
      const leaves = [...card.querySelectorAll('*')].filter(e => e.children.length === 0);
      const prices = leaves.filter(isPrice).map(e => money(e.textContent));
      const text = leaves.filter(e => !isPrice(e)).map(e => e.textContent.trim()).filter(t => t.length > 2);
      if (text[0] && !found.has(text[0])) found.set(text[0], [text[0], Math.min(...prices), prices.length > 1 ? Math.max(...prices) : null]);
    }
  };
  for (let y = 0; y < doc.body.scrollHeight + 600; y += 500) { win.scrollTo(0, y); await w(350); collect(); }
  const estado = (doc.body.innerText.match(/ABRE A LAS [0-9:]+|CERRADO[^\n]*/i) || ['abierto'])[0];
  return { store: doc.title.replace(/ a Domicilio.*$/, ''), estado, url: win.location.href, products: [...found.values()] };
}

async function save(file, brand, r) {
  const res = await fetch('http://127.0.0.1:4190/guardar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, brand, store: r.store, url: r.url, products: r.products }),
  });
  return res.status === 200;
}

export async function run(file, brand) {
  const r = await extract(window);
  if (!r.products?.length) return r;
  return { store: r.store, estado: r.estado, n: r.products.length, guardado: await save(file, brand, r) };
}

// lista: [{ file, brand, url }]. Progreso en window.__pyaProgress (se puede consultar mientras corre).
export async function runAll(lista, { pausa = 6000 } = {}) {
  const prog = window.__pyaProgress = { total: lista.length, hechos: 0, guardados: 0, vacios: [], redirigidos: [], bloqueo: false, actual: null };
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1200px;height:900px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(frame);
  for (const item of lista) {
    if (prog.detener) break;
    prog.actual = item.url;
    await Promise.race([new Promise(res => { frame.onload = res; frame.src = item.url; }), w(20000)]);
    await w(5000); // que termine de dibujar el menú
    let r;
    try { r = await extract(frame.contentWindow); } catch (e) { r = { error: String(e) }; }
    if (r.bloqueo) { prog.bloqueo = true; break; }
    if (r.redirigio) prog.redirigidos.push(item.url);
    else if (!r.products?.length) prog.vacios.push(item.url);
    else if (await save(item.file, item.brand, r)) prog.guardados++;
    prog.hechos++;
    await w(pausa);
  }
  frame.remove();
  prog.actual = null;
  prog.terminado = true;
  return prog;
}
