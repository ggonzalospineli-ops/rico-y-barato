// Dividir la cuenta. Cada persona paga los productos según cuántas piezas come, y el envío y la
// propina en partes iguales. Se redondea a $10 y la diferencia de redondeo la absorbe quien más paga,
// así la suma da exactamente el total.

export function splitBill({ subtotal, deliveryFee = 0, tipPct = 0, people }) {
  if (!people?.length) throw new Error('Hace falta al menos una persona');
  const units = people.reduce((s, p) => s + Math.max(0, p.units || 0), 0);
  const tip = Math.round(subtotal * tipPct / 100);
  const total = subtotal + deliveryFee + tip;
  const shared = (deliveryFee + tip) / people.length;
  const raw = people.map(p => (units ? subtotal * Math.max(0, p.units || 0) / units : subtotal / people.length) + shared);
  const rounded = raw.map(x => Math.round(x / 10) * 10);
  const diff = total - rounded.reduce((a, b) => a + b, 0);
  rounded[raw.indexOf(Math.max(...raw))] += diff;
  return {
    total, tip,
    shares: people.map((p, i) => ({ name: p.name || `Persona ${i + 1}`, units: p.units || 0, amount: rounded[i] })),
  };
}

// Texto listo para mandar por WhatsApp.
export function splitMessage({ restaurant, lines, split, fmt }) {
  const items = lines.map(l => `• ${l.qty}× ${l.name}`).join('\n');
  const shares = split.shares.map(s => `• ${s.name}${s.units ? ` (${s.units})` : ''}: ${fmt(s.amount)}`).join('\n');
  return `🍔 Pedido en ${restaurant}\n${items}\n\nTotal ${fmt(split.total)}${split.tip ? ` (con ${fmt(split.tip)} de propina)` : ''}\n\nCada uno pone:\n${shares}`;
}
