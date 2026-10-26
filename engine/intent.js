// "Pedir hablando", versión local y sin IA: entiende las frases típicas de un pedido en castellano
// rioplatense y devuelve los mismos filtros que la pantalla. Lo que no entiende queda en `unknown`
// para que la UI lo diga (y, si el usuario cargó su clave, se lo pase a Claude).
//
// parseIntent('somos 3, uno no come carne, tenemos 25 lucas y re hambre') →
//   { people: 3, money: 25000, hunger: 'bestia', exclude: ['carne', 'cerdo'], ... }

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const NUMBER_WORDS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const num = w => (/^\d+$/.test(w) ? +w : NUMBER_WORDS[w]);

const CATEGORY_WORDS = {
  nuggets: /\bnugg?ets?\b|\bbocaditos\b/,
  sushi: /\bsushi\b|\broll(s)?\b|\bpiezas de sushi\b|\bjapones/,
  hamburguesa: /\bhamburgues|\bburgers?\b|\bhambur/,
  empanadas: /\bempanad/,
  pizza: /\bpizz/,
  milanesa: /\bmilanes|\bmila(s)?\b/,
  pollo: /\bpollo frito\b|\bpresas\b|\bpollo entero\b/,
  pasta: /\bpastas?\b|\bfideos\b|\bravioles\b|\bsorrentinos\b|\bnoquis\b/,
  tacos: /\btacos?\b|\btaquitos?\b|\bquesadillas?\b/,
  wraps: /\bwraps?\b|\bburritos?\b|\bfajitas?\b/,
  carnes: /\bparrilla\b|\basado\b|\bbife\b|\bentrana\b|\bvacio\b|\bmatambre\b/,
  ensaladas: /\bensaladas?\b|\bcaesar\b|\bcesar\b/,
  sandwiches: /\bsandwich(?:es)?\b|\bsanguche?s?\b|\blomitos?\b/,
  tartas: /\btartas?\b|\bquiches?\b/,
  wok: /\bwoks?\b|\bbowls?\b|\bpokes?\b/,
};

export function parseIntent(text) {
  const t = norm(text);
  const out = { people: null, money: null, hunger: null, category: null, exclude: [], ricoWeight: null, understood: [], unknown: [] };
  if (!t.trim()) return out;

  // Personas: "somos 3", "para dos", "con mi novia" (=2), "yo solo" (=1)
  const people = t.match(/\b(?:somos|para|seremos|vamos a ser)\s+(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
  if (people) out.people = num(people[1]);
  else if (/\bcon (mi|la|el) (novi[ao]|pareja|vieja|viejo|herman[ao]|amig[ao])\b/.test(t)) out.people = 2;
  else if (/\b(yo solo|solo yo|para mi)\b/.test(t)) out.people = 1;
  if (out.people) out.understood.push(`somos ${out.people}`);

  // Plata: "$25.000", "25000", "25 lucas", "25k", "25 mil", "veinte lucas"
  const money = t.match(/\$\s*([\d.]+)/) || t.match(/\b(\d{1,3}(?:\.\d{3})+|\d{4,6})\b(?!\s*(?:piezas|unidades|porciones))/)
    || t.match(/\b(\d{1,3})\s*(?:lucas|luca|k|mil|mangos? mil)\b/) || t.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta)\s*(?:lucas|mil)\b/);
  if (money) {
    const word = { veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50 }[money[1]] ?? num(money[1]);
    const raw = money[0];
    let n = word ?? +money[1].replace(/\./g, '');
    if (/lucas|luca|\d\s*k\b|mil/.test(raw) && n < 1000) n *= 1000; // "20k" lleva la k pegada
    if (n >= 1000) { out.money = n; out.understood.push(`$${n.toLocaleString('es-AR')}`); }
  }
  if (/\bsin (limite|tope)\b|\bno importa (la plata|el precio)\b/.test(t)) { out.money = Infinity; out.understood.push('sin límite de plata'); }

  // Hambre
  if (/\b(cagad[oa]s?|muert[oa]s?|morimos|me muero|terrible|una banda de|bestial|famelic\w*)\b.{0,12}\bhambre\b|\bbestia\b|\bme comeria un caballo\b/.test(t)) out.hunger = 'bestia';
  else if (/\b(re|mucha|muchisima|bastante)\b.{0,8}\bhambre\b/.test(t)) out.hunger = 'mucho';
  else if (/\bpicar\b|\bpicoteo\b|\bpoca hambre\b|\balgo liviano\b|\bpoquito\b/.test(t)) out.hunger = 'poco';
  else if (/\bhambre\b/.test(t)) out.hunger = 'normal';
  if (out.hunger) out.understood.push(`hambre: ${out.hunger}`);

  // Qué comida
  for (const [cat, re] of Object.entries(CATEGORY_WORDS)) {
    const match = t.match(re);
    const prefix = match ? t.slice(Math.max(0, match.index - 28), match.index) : '';
    if (match && !/\b(?:no|sin|ni|menos|excepto)\s+(?:\w+\s+){0,2}$/.test(prefix)) {
      out.category = cat; out.understood.push(cat); break;
    }
  }

  // Qué no come
  const ex = new Set();
  if (/\bvegetarian|\bveggie\b|\bno com\w* (nada de )?carne|\bsin carne\b/.test(t)) ['carne', 'cerdo'].forEach(x => ex.add(x));
  if (/\bvegan/.test(t)) ['carne', 'cerdo', 'pollo', 'pescado', 'lacteos'].forEach(x => ex.add(x));
  if (/\bvegetarian/.test(t)) ['pollo', 'pescado'].forEach(x => ex.add(x));
  if (/\b(sin|no com\w*) cerdo\b|\bkosher\b|\bhalal\b/.test(t)) ex.add('cerdo');
  if (/\b(sin|no com\w*) (pescado|mariscos)\b/.test(t)) ex.add('pescado');
  if (/\b(sin|no com\w*) (lacteos|queso|leche)\b|\bintolerante a la lactosa\b/.test(t)) ex.add('lacteos');
  if (/\b(sin|no com\w*) (picante|aji)\b/.test(t)) ex.add('picante');
  if (/\b(sin|no com\w*|no sea|nada) (frito|fritura)s?\b/.test(t)) ex.add('frito');
  if (/\b(sin|no com\w*) pollo\b/.test(t)) ex.add('pollo');
  out.exclude = [...ex];
  if (out.exclude.length) out.understood.push(`sin ${out.exclude.join(', ')}`);

  // Rico o barato
  if (/\b(lo mas barato|barat\w*|economic\w*|ratonear|amarrete|poca plata|ajustad\w*)\b/.test(t)) out.ricoWeight = 0.15;
  else if (/\b(lo mas rico|algo rico|que este bueno|darnos un gusto|nos damos un gusto|premium|lo mejor)\b/.test(t)) out.ricoWeight = 0.85;
  if (out.ricoWeight != null) out.understood.push(out.ricoWeight < 0.5 ? 'priorizar barato' : 'priorizar rico');

  // Lo que no se usó (aproximado): palabras largas que ninguna regla tocó.
  const used = /somos|para|tenemos|tengo|lucas|luca|mil|hambre|plata|precio|sin|no|como|come|comemos|barat|rico|bueno|gusto|vegetarian|vegan|cerdo|carne|pescado|lacteos|picante|frito|pollo|bestia|picar|poca|mucha|nugg|sushi|hambur|burger|empanad|pizz|milanes|mila|pasta|fideos|ravioles|sorrentinos|noquis|taco|quesadilla|wrap|burrito|fajita|parrilla|asado|bife|entrana|vacio|matambre|ensalada|caesar|cesar|sandwich|sanguche|lomito|tarta|quiche|wok|bowl|poke|limite|tope|algo|queremos|quiero|pedir|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|mas|menos|que|con|los|las|del|una|unos|unas|esta|este|estamos|vamos/;
  out.unknown = t.split(/[^a-z0-9ñ]+/).filter(w => w.length > 4 && !used.test(w) && !/^\d+$/.test(w));
  return out;
}
