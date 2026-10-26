// Se carga dentro de la página de un local de PedidosYa (lo sirve tools/pedidosya-receiver.mjs) y extrae
// el menú: PedidosYa dibuja solo los productos visibles, así que se baja de a poco juntando lo que aparece.
// Frena si aparece el desafío anti-bot.

export async function run(file, brand) {
  const w = ms => new Promise(r => setTimeout(r, ms));
  if (/confirma que eres un humano|ha sido denegado/i.test(document.body.innerText)) return { bloqueo: true };
  if (!/-menu/.test(location.href)) return { redirigio: location.href };
  const money = t => +t.replace(/[^\d]/g, '');
  const isPrice = e => e.children.length === 0 && /^\$\s?[\d.]+$/.test(e.textContent.trim());
  const found = new Map();
  const collect = () => {
    const seen = new Set();
    for (const p of [...document.querySelectorAll('#main-content *')].filter(isPrice)) {
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
  for (let y = 0; y < document.body.scrollHeight + 600; y += 500) { window.scrollTo(0, y); await w(350); collect(); }
  const estado = (document.body.innerText.match(/ABRE A LAS [0-9:]+|CERRADO[^\n]*/i) || ['abierto'])[0];
  const store = document.title.replace(/ a Domicilio.*$/, '');
  if (!found.size) return { store, estado, n: 0 };
  const r = await fetch('http://127.0.0.1:4190/guardar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, brand, store, url: location.href, products: [...found.values()] }),
  });
  return { store, estado, n: found.size, guardado: r.status === 200 };
}
