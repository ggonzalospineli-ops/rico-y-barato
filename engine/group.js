// Pedido grupal por link: la página no tiene servidor, así que el pedido viaja en la URL
// (#grupo=...). Cada uno abre el link, suma lo suyo y lo vuelve a compartir.
//
// Formato compacto: { v: 1, r: restaurantId, p: [[nombre, [[productId, cantidad], ...]], ...] }
// en JSON → UTF-8 → base64url. Los productId son la parte del itemId que va después de "restaurantId:".

const MAX_PEOPLE = 20, MAX_LINES = 30, MAX_QTY = 20, MAX_NAME = 24;

const toB64 = s => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

export function emptyGroup(restaurantId) {
  return { restaurantId, people: [] };
}

export function encodeGroup(group) {
  const prefix = `${group.restaurantId}:`;
  const p = group.people.map(person => [
    person.name,
    person.lines.map(l => [l.itemId.startsWith(prefix) ? l.itemId.slice(prefix.length) : l.itemId, l.qty]),
  ]);
  return toB64(JSON.stringify({ v: 1, r: group.restaurantId, p }));
}

// Lo que viene en un link es de cualquiera: se valida todo y se descarta lo que no cierra.
// itemExists(itemId) dice si el producto existe en el catálogo actual.
export function decodeGroup(code, itemExists = () => true) {
  let raw;
  try { raw = JSON.parse(fromB64(String(code))); } catch { return null; }
  if (!raw || raw.v !== 1 || typeof raw.r !== 'string' || !Array.isArray(raw.p)) return null;
  const restaurantId = raw.r.slice(0, 120);
  const people = [];
  for (const entry of raw.p.slice(0, MAX_PEOPLE)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
    const name = cleanName(entry[0]);
    if (!name) continue;
    const lines = [];
    for (const l of entry[1].slice(0, MAX_LINES)) {
      if (!Array.isArray(l)) continue;
      const itemId = `${restaurantId}:${String(l[0]).slice(0, 40)}`;
      const qty = Math.round(+l[1]);
      if (qty >= 1 && qty <= MAX_QTY && itemExists(itemId)) lines.push({ itemId, qty });
    }
    people.push({ name, lines });
  }
  return { restaurantId, people };
}

export function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME);
}

// Suma o reemplaza lo que pide una persona (por nombre, sin distinguir mayúsculas).
export function setPersonLines(group, name, lines) {
  const clean = cleanName(name);
  if (!clean) throw new Error('Falta el nombre');
  const kept = lines.filter(l => l.qty > 0).map(l => ({ itemId: l.itemId, qty: Math.min(MAX_QTY, Math.round(l.qty)) }));
  const others = group.people.filter(p => p.name.toLowerCase() !== clean.toLowerCase());
  return { ...group, people: kept.length ? [...others, { name: clean, lines: kept }] : others };
}

// Cuánto pone cada uno: lo suyo + una parte igual del envío. Redondeo a $10; la diferencia la
// absorbe quien más pone, así la suma da justo el total.
export function groupTotals(group, priceOf, deliveryFee = 0) {
  const people = group.people.filter(p => p.lines.length);
  const own = people.map(p => p.lines.reduce((s, l) => s + (priceOf(l.itemId) || 0) * l.qty, 0));
  const subtotal = own.reduce((a, b) => a + b, 0);
  const fee = people.length ? deliveryFee : 0;
  const total = subtotal + fee;
  const raw = own.map(x => x + fee / Math.max(1, people.length));
  const rounded = raw.map(x => Math.round(x / 10) * 10);
  if (rounded.length) rounded[raw.indexOf(Math.max(...raw))] += total - rounded.reduce((a, b) => a + b, 0);
  return {
    subtotal, deliveryFee: fee, total,
    shares: people.map((p, i) => ({ name: p.name, own: own[i], amount: rounded[i] })),
  };
}

// Todas las líneas juntas (mismo producto de varias personas se suma).
export function mergedLines(group) {
  const byId = new Map();
  for (const p of group.people) for (const l of p.lines) byId.set(l.itemId, (byId.get(l.itemId) || 0) + l.qty);
  return [...byId].map(([itemId, qty]) => ({ itemId, qty }));
}
