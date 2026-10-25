// Convierte el scrapeo de Rappi (rappi_todos_productos_*.json) al formato del motor.
// Rappi no dice cuánto rinde cada producto: lo deducimos del texto ("x10", "24 piezas",
// "media docena", "grande"). Funciones puras para poder testearlas.

const CATEGORY_RULES = [
  // El orden importa: "Roll New Mila" es sushi, "Milanesa fugazzeta" es milanesa;
  // "empanados" y "empanaditas" no son empanadas.
  ['nuggets',     /\bmc ?nugg?ets?\b|\bnugg?ets?\b|bocaditos? de pollo/],
  ['empanadas',   /\bempanadas?\b|\bampanadas?\b|\bempanadazas?\b/],
  ['sushi',       /\bsushi\b|\brolls?\b|\bnigu?iris?\b|\bsashimis?\b|\bmakis?\b|\buramakis?\b|\bgeishas?\b|\bhossomakis?\b/],
  ['milanesa',    /\bmilanes|\bmila\b|\bmilas\b|\bsuprema/],
  ['pizza',       /\bpizz|\bpizet|\bfugazz|\bpala\b/],
  ['hamburguesa', /\bhamburgues|\bburgers?\b|\bwhopper|\bcuarto de libra|\bbig mac|\bsmash|\bcheeseburger|\bstacker|\bmc ?combo/],
  ['pollo',       /\bpresas?\b|\bbucket\b|\bpollo entero\b|\b1\/2 pollo\b|\bmedio pollo\b/],
  ['pasta',       /\bravioles|\bsorrentinos|\bñoquis|\bnoquis|\btallarines|\bspaghetti|\bfett?uccin|\blasa[gñ]n|\bcanelones|\bpenne|\bfideos|\bagnolotti|\bcappellett|\bpappardelle|\brigatoni/],
];

// Cosas que caen en una categoría por una palabra pero no son eso (sobre el nombre normalizado).
const CATEGORY_EXCLUDE = {
  pasta:    /\barroz\b|\bravioles chinos\b|\bwan ?tan|\bgyozas?\b|\bdumplings?\b|\bsopa\b/,
  milanesa: /\bbites\b|\bbocaditos\b|\bentradita\b|\bpastelito/,
  pizza:    /\bfainuzza\b|\bpastelito|\bcanastita|\ba la pizza\b|\bmatambre/, // "Matambre a la pizza" no es pizza
};

// Secciones donde todo lo que hay es de esa categoría, diga lo que diga el nombre.
const SECTION_DECIDES = ['empanadas', 'pizza'];

// Secciones del menú o productos que nunca son "la comida" aunque mencionen una.
const NOT_A_MEAL_SECTION = /bebida|cerveza|vino|trago|postre|helado|salsa|aderezo|extra|adicional|cafeter|desayuno|merienda/i;
// Se prueba sobre el nombre normalizado (sin tildes).
const NOT_A_MEAL_NAME = /^(salsa|dip|aderezo|adicional|extra)\b|\bsalsa para\b|\bsin cargo\b|\bfaina\b|\bpan de pizza\b|\bcachito\b|\bcaramel|\bmacchiato|\bcanela\b|\bnutella\b|\bdulce de leche\b/;
// Arepas, empanadas venezolanas, etc. que toman nombres de hamburguesa.
const NOT_WHAT_IT_SAYS = /\barepa|harina de maiz|masa de maiz/;

// Por debajo de esta fracción de la mediana por unidad, el precio es un "desde" o un error de carga.
// Las promos reales llegan a ~16% de la mediana (sushi Turbo); un "desde $499" queda en ~1.5%.
const MIN_UNIT_PRICE_RATIO = 0.1;

const TAG_RULES = [
  ['cerdo',       /\bcerdo|\bbondiola|\bjam[oó]n|\bpanceta|\bbacon|\bcantimpalo|\bchorizo|\bsalame|\bleb?erwurst|\bpanceta/],
  ['lacteos',     /\bqueso|\bmuzz|\bmozz|\bphila|\bcheddar|\bcrema\b|\bprovolone|\broquefort|\bparmesano|\bcheese/],
  ['pescado',     /\bsalm[oó]n|\bat[uú]n|\blangostin|\bkanikama|\bpescado|\bmariscos|\bpulpo|\bcamar[oó]n/],
  ['vegetariano', /\bveggie|\bvegetarian|\bvegetal(es)?\b|a base de plantas|\bvegan/],
  ['sin-tacc',    /sin tacc|gluten free|sin gluten/],
  ['frito',       /\bfrit[oa]s?\b|\brebozad|\bempanizad|\btempura|\bcrispy|\bcrocante/],
  ['picante',     /\bpicante|\bspicy|\bjalape/],
];

const BIG_FOUR_BRANDS = [
  ['mcdonalds',  /mc ?donald/i],
  ['burgerking', /burger king/i],
  ['kfc',        /\bkfc\b/i],
  ['mostaza',    /^mostaza\b/i],
];

export function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n');
}

function detectCategory(text) {
  const t = normalize(text);
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return null;
}

// Cantidad explícita en un texto: "x10", "24 piezas", "(15 pz)", "docena".
function explicitCount(text, category) {
  const t = normalize(text);
  if (/media docena|1\/2 docena/.test(t)) return 6;
  if (/\bdocena\b/.test(t)) return 12;
  const unit = category === 'pizza' ? 'porciones?|porc\\.?'
    : category === 'pollo' ? 'presas?'
    : 'piezas?|pzas?|pz|unidades|unid\\.?|uni|u\\b|bocaditos?|nugg?ets?|rolls?|makis?|nigu?iris?|empanadas?';
  const m = t.match(new RegExp(`\\b(\\d{1,3})\\s?(?:${unit})\\b`))
    || t.match(/\bx\s?(\d{1,3})\b/)
    || t.match(/\bpor\s(\d{1,3})\b/);
  return m ? +m[1] : null;
}

// Cuánto rinde una "parte" del nombre ya clasificada. desc solo se usa como respaldo.
function countFor(category, part, desc, sectionName) {
  const name = normalize(part);
  const lead = name.match(/^(\d{1,2})\s(?!quesos|estaciones|carnes|sabores|gustos)/); // "2 Milanesas", no "4 Quesos"
  const leadN = lead ? +lead[1] : 1;
  const fromName = explicitCount(part, category);

  switch (category) {
    case 'nuggets':
      return fromName ?? explicitCount(desc, category);
    case 'sushi': {
      if (fromName) return fromName;
      const d = normalize(desc);
      const total = d.match(/\btotal:?\s*(\d{1,3})\b/) || d.match(/\b(\d{1,3})\s?(?:piezas?|pzas?|pz)\b/);
      if (total) return +total[1];
      // Tablas que listan la composición: "10 roll de kanikama, 10 roll de vegetales, 5 roll..." = 25.
      const listed = [...d.matchAll(/\b(\d{1,2})\s?(?:rolls?|nigu?iris?|sashimis?|makis?|geishas?|hossomakis?|uramakis?|unidades|u\b)/g)];
      if (listed.length) return listed.reduce((s, m) => s + +m[1], 0);
      // Los nombres de combos suelen llevar el número pelado: "Recoleta 40", "Alaska 12".
      const bare = name.match(/\b(\d{1,3})\b/);
      return bare ? inRange(+bare[1], 4, 120) : null;
    }
    case 'empanadas':
      if (fromName) return fromName;
      if (/\btrio\b/.test(name)) return 3;
      if (lead) return leadN;
      // De la descripción solo creemos "docena": un número suelto suele ser otra cosa
      // ("se calculan 6 por persona"). Si no, es la unidad.
      if (/media docena|1\/2 docena/.test(normalize(desc))) return 6;
      if (/\bdocena\b/.test(normalize(desc))) return 12;
      return 1;
    case 'pizza': {
      if (/^porc(ion|\.|\b)|\bporcion\b/.test(name)) return leadN; // "Porción de fugazzeta", "Fugazzeta Porción"
      const portions = explicitCount(part, 'pizza') ?? explicitCount(desc, 'pizza');
      if (portions) return portions;
      const sizeText = `${name} ${normalize(sectionName)} ${normalize(desc)}`;
      const per = /piz+et+a|individual|personal/.test(sizeText) ? 4
        : /\bchica/.test(sizeText) ? 6
        : /mediana/.test(sizeText) ? 6
        : 8;
      return leadN * per;
    }
    case 'pollo': {
      if (/pollo entero/.test(name)) return 8;
      if (/1\/2 pollo|medio pollo/.test(name)) return 4;
      return fromName ?? explicitCount(desc, 'pollo');
    }
    default: { // hamburguesa, milanesa, pasta: unidades/porciones; "doble" son medallones, no 2.
      if (lead) return leadN;
      // "Dos hamburguesas de carne..." sí; "Tres medallones..." es una sola hamburguesa.
      const word = normalize(desc).match(/^(dos|tres|cuatro)\s(?:hamburguesas|burgers|milanesas|supremas|porciones)\b/);
      return word ? { dos: 2, tres: 3, cuatro: 4 }[word[1]] : 1;
    }
  }
}

function inRange(n, lo, hi) { return n >= lo && n <= hi ? n : null; }

// Qué rinde un producto. Devuelve {} si no es una comida que el motor sepa medir.
function rawYields(product, restaurantName = '') {
  if (NOT_A_MEAL_SECTION.test(product.category || '') || NOT_A_MEAL_NAME.test(normalize(product.name))
    || NOT_WHAT_IT_SAYS.test(normalize(product.description))) return {};
  const desc = product.description || '';
  const yields = {};

  // En la sección "Empanadas", "Cheeseburger" es un gusto de empanada, no una hamburguesa.
  // Una sección mixta ("Sandwiches y Hamburguesas") no decide nada.
  const section = product.category || '';
  const sectionCat = /\sy\s|&|,|\//.test(section) ? null : detectCategory(section);
  if (/^empanada\b/.test(normalize(desc)) && detectCategory(product.name) !== 'empanadas'
    && !explicitCount(product.name, 'empanadas')) return { empanadas: 1 };
  const nameCat = detectCategory(product.name);
  const nameWins = SECTION_DECIDES.includes(nameCat) && nameCat !== sectionCat; // "Empanada de Carne" en "Pizzas"
  if (SECTION_DECIDES.includes(sectionCat) && !nameWins && !/combo|promo|\+/i.test(product.name)) {
    const n = countFor(sectionCat, product.name, desc, product.category);
    return n > 0 ? { [sectionCat]: n } : {};
  }

  // Combos mixtos: "Pizza Muzzarella + 2 Empanadas" se mide por partes.
  const parts = product.name.split(/\s*\+\s*|\s+y\s+(?=\d)/);
  for (const part of parts) {
    const cat = detectCategory(part);
    if (!cat || yields[cat]) continue;
    const n = countFor(cat, part, parts.length === 1 ? desc : '', product.category);
    if (n > 0) yields[cat] = n;
  }
  if (Object.keys(yields).length) return yields;

  // El nombre no dice qué es ("Combo promo 15 pz"): probar con descripción, sección y rubro del local.
  // Del rubro solo si el nombre habla de piezas: "Palitos Chinos X2" en un sushi no es sushi.
  const cat = detectCategory(desc) || sectionCat
    || (/sushi/i.test(restaurantName) && /\b\d{1,3}\s?(?:piezas?|pzas?|pz)\b/i.test(product.name) ? 'sushi' : null);
  if (!cat) return {};
  const n = countFor(cat, product.name, desc, product.category);
  return n > 0 ? { [cat]: n } : {};
}

// Qué rinde un producto, con las exclusiones por categoría aplicadas. {} si no se puede medir.
export function parseYields(product, restaurantName = '') {
  const yields = rawYields(product, restaurantName);
  const name = normalize(product.name);
  for (const cat of Object.keys(yields)) if (CATEGORY_EXCLUDE[cat]?.test(name)) delete yields[cat];
  return yields;
}

export function parseTags(product) {
  const t = normalize(`${product.name} ${product.description || ''}`);
  return TAG_RULES.filter(([, re]) => re.test(t)).map(([tag]) => tag);
}

export function brandOf(restaurantName) {
  for (const [id, re] of BIG_FOUR_BRANDS) if (re.test(restaurantName)) return id;
  // "Sushi Pop - Palermo" / "Burger King Turbo - Balvanera" → "sushi pop" / "burger king"
  return normalize(restaurantName).split(' - ')[0].replace(/\bturbo\b/g, '').trim();
}

// Tabla markdown "Restaurante | Rating Rappi | Google Maps | Opiniones en Google | ..."
export function parseGoogleTable(md) {
  const out = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\[?([^\]|]+?)\]?(?:\([^)]*\))?\s*\|\s*[\d,]+\s*\|\s*([\d,]+)\s*\|\s*([\d.]+)\s*\|/);
    if (m) out[normalize(m[1]).trim()] = { googleRating: +m[2].replace(',', '.'), googleReviews: +m[3].replace(/\./g, '') };
  }
  return out;
}

const slug = s => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PRODUCT_IMG = 'https://images.rappi.com.ar/products/';
// Rappi achica al vuelo y nunca agranda: pedimos 600px y la UI descarta lo que llegue más chico.
const sized = url => url && `${url.split('?')[0]}?d=600x600&e=webp&q=80`;

// pages: salida de tools/fetch-rappi-pages.mjs, indexada por URL del local.
export function convert(scrape, { google = {}, preferences = null, minPrice = 300, pages = {} } = {}) {
  const brandCount = {};
  for (const r of scrape.restaurants) { const b = brandOf(r.restaurant); brandCount[b] = (brandCount[b] || 0) + 1; }
  const genericImages = findGenericImages(scrape, pages);

  const restaurants = [], items = [], seenItemIds = new Set();
  for (const r of scrape.restaurants) {
    const id = slug(r.restaurant);
    const brand = brandOf(r.restaurant);
    const g = google[normalize(r.restaurant).trim()] || {};
    const page = pages[r.url] || {};
    restaurants.push({
      id, name: r.restaurant, brand, url: r.url, address: r.address || null,
      chain: BIG_FOUR_BRANDS.some(([b]) => b === brand) || brandCount[brand] > 1,
      tags: [], rappiRating: r.rating ?? null, ...g,
      // Lo siguiente sale de la página del local; envío y demora son para la ubicación por defecto de Rappi.
      rappiScore: page.score ?? null, rappiReviews: page.reviews ?? null,
      deliveryFee: page.deliveryPrice ?? null,
      etaMin: page.eta ? parseInt(page.eta, 10) || null : null,
      logoUrl: page.logo ? `${page.logo.split('?')[0]}?d=200x200&e=webp&q=80` : null,
      coverUrl: page.background ? `${page.background.split('?')[0]}?d=900x600&e=webp&q=80` : null,
    });

    let popular = 0;
    for (const p of r.products) {
      if (!(p.price_ars >= minPrice)) continue;
      const itemId = `${id}:${p.product_id}`;
      if (seenItemIds.has(itemId)) continue; // Rappi repite productos entre secciones
      seenItemIds.add(itemId);
      // Solo la foto que Rappi asigna a ESTE product_id, y nunca una genérica del local.
      const file = page.products?.[p.product_id];
      const scraped = p.image_url && !p.image_url.startsWith('data:') ? p.image_url : null;
      const imageUrl = file && !genericImages.has(file) ? sized(PRODUCT_IMG + file)
        : !file && scraped && !genericImages.has(scraped.split('/').pop().split('?')[0]) ? sized(scraped) : null;
      items.push({
        id: itemId, restaurantId: id, name: p.name.trim(), description: p.description || '',
        section: p.category, price: Math.round(p.price_ars),
        originalPrice: p.original_price_ars > p.price_ars ? Math.round(p.original_price_ars) : null,
        discount: p.discount || null,
        imageUrl,
        yields: parseYields(p, r.restaurant), tags: parseTags(p),
        salesRank: /^populares$/i.test(p.category) ? ++popular : null,
      });
    }
  }

  const discarded = dropImplausiblePrices(items);
  return { meta: { source: scrape.source, address: scrape.delivery_address, scrapedAt: scrape.scraped_at, discarded },
    restaurants, items, suggestedFavorites: matchPreferences(preferences, restaurants, items) };
}

// Una foto que el local usa para 3+ productos distintos, o que comparten marcas distintas,
// es un placeholder ("logo", "foto ilustrativa"): mostrarla sería mostrar la foto equivocada.
function findGenericImages(scrape, pages) {
  const names = new Map();   // archivo → nombres de producto distintos (por local)
  const brands = new Map();  // archivo → marcas que lo usan
  for (const r of scrape.restaurants) {
    const page = pages[r.url];
    if (!page?.products) continue;
    const brand = brandOf(r.restaurant);
    const byId = Object.fromEntries(r.products.map(p => [p.product_id, normalize(p.name)]));
    for (const [pid, file] of Object.entries(page.products)) {
      const key = `${r.url}|${file}`;
      if (!names.has(key)) names.set(key, new Set());
      names.get(key).add(byId[pid] ?? pid);
      if (!brands.has(file)) brands.set(file, new Set());
      brands.get(file).add(brand);
    }
  }
  const generic = new Set();
  for (const [key, set] of names) if (set.size >= 3) generic.add(key.split('|')[1]);
  for (const [file, set] of brands) if (set.size >= 2) generic.add(file);
  return generic;
}

// "Pizza grande $499" es el precio base antes de elegir gustos: no sirve para medir.
// El producto queda en el menú, pero sin yields. Devuelve los nombres descartados.
function dropImplausiblePrices(items) {
  const unitPrices = {};
  for (const it of items) for (const [c, n] of Object.entries(it.yields)) (unitPrices[c] ||= []).push(it.price / n);
  const median = {};
  for (const [c, xs] of Object.entries(unitPrices)) { xs.sort((a, b) => a - b); median[c] = xs[xs.length >> 1]; }
  const discarded = [];
  for (const it of items) {
    if (Object.entries(it.yields).some(([c, n]) => it.price / n < median[c] * MIN_UNIT_PRICE_RATIO)) {
      discarded.push(`${it.name} ($${it.price}, ${JSON.stringify(it.yields)})`);
      it.yields = {};
    }
  }
  return discarded;
}

// preferencias_comida_usuario.json → ids de productos que el usuario ya probó y le gustaron.
function matchPreferences(prefs, restaurants, items) {
  if (!prefs?.must_have) return [];
  const ids = [];
  for (const pref of prefs.must_have) {
    const want = normalize(pref.restaurant);
    const rIds = new Set(restaurants.filter(r => normalize(r.name).startsWith(want.split(' - ')[0])).map(r => r.id));
    const names = (pref.closest_current_rappi_matches || []).map(m => normalize(m.name));
    for (const it of items) if (rIds.has(it.restaurantId) && names.includes(normalize(it.name))) ids.push(it.id);
  }
  return [...new Set(ids)];
}
