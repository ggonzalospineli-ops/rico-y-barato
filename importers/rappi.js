// Convierte el scrapeo de Rappi (rappi_todos_productos_*.json) al formato del motor.
// Rappi no dice cuánto rinde cada producto: lo deducimos del texto ("x10", "24 piezas",
// "media docena", "grande"). Funciones puras para poder testearlas.

import { distanceKm } from '../engine/hours.js';

const CATEGORY_RULES = [
  // El orden importa: "Roll New Mila" es sushi, "Milanesa fugazzeta" es milanesa;
  // "empanados" y "empanaditas" no son empanadas.
  ['nuggets',     /\bmc ?nugg?ets?\b|\bnugg?ets?\b|bocaditos? de pollo/],
  ['empanadas',   /\bempanadas?\b|\bampanadas?\b|\bempanadazas?\b/],
  ['sushi',       /\bsushi\b|\brolls?\b|\bnigu?iris?\b|\bsashimis?\b|\bmakis?\b|\buramakis?\b|\bgeishas?\b|\bhossomakis?\b/],
  ['milanesa',    /\bmilanes|\bmila\b|\bmilas\b|\bmilangas?\b|\bsuprema/],
  ['pizza',       /\bpizz|\bpizet|\bfugazz|\bpala\b/],
  ['hamburguesa', /\bhamburgues|\bburgers?\b|\bwhopper|\bcuarto de libra|\bbig mac|\bsmash|\bcheeseburger|\bstacker|\bmc ?combo/],
  ['pollo',       /\bpresas?\b|\bbucket\b|\bpollo entero\b|\b1\/2 pollo\b|\bmedio pollo\b/],
  ['pasta',       /\bravioles|\bsorrentinos|\bñoquis|\bnoquis|\btallarines|\bspaghetti|\bfett?uccin|\blasa[gñ]n|\bcanelones|\bpenne|\bfideos|\bagnolotti|\bcappellett|\bpappardelle|\brigatoni/],
  ['tacos',       /\btacos?\b|\btaquitos?\b|\bquesadillas?\b/],
  ['wraps',       /\bwraps?\b|\bburritos?\b|\bfajitas?\b/],
  ['ensaladas',   /\bensaladas?\b|\bcaesar\b|\bcesar\b/],
  ['sandwiches',  /\bsandwich(?:es)?\b|\bsanguche?s?\b|\blomitos?\b|\bchoripanes?\b|\bchoripan\b|\bbaguettes?\b/],
  ['tartas',      /\btartas?\b|\bquiches?\b/],
  ['wok',         /\bwoks?\b|\bbowls?\b|\bpokes?\b/],
  // Debe ir al final: muchos platos de carne también nombran su formato (taco, sándwich, etc.).
  ['carnes',      /\bparrill(?:as?|adas?)\b|\basados?\b|\bbifes?\b|\bojo de bife\b|\bentra[nñ]as?\b|\bvacio\b|\bmatambres?\b|\bchurrascos?\b|\bribs?\b|\bcostillas?\b|\bbondiolas?\b/],
];

// Cosas que caen en una categoría por una palabra pero no son eso (sobre el nombre normalizado).
const CATEGORY_EXCLUDE = {
  pasta:    /\barroz\b|\bravioles chinos\b|\bwan ?tan|\bgyozas?\b|\bdumplings?\b|\bsopa\b/,
  milanesa: /\bbites\b|\bbocaditos\b|\bentradita\b|\bpastelito/,
  pizza:    /\bfainuzza\b|\bpastelito|\bcanastita|\ba la pizza\b|\bmatambre|\bpan de\b/, // "Matambre a la pizza", "Pan de provolone"
  hamburguesa: /\bpanchos?\b|\bhot ?dogs?\b|\bsalchicha/,                // "Pancho Cuarto de Libra" tampoco
  carnes: /\ba la pizza\b|\bempanadas?\b|\btartas?\b/,
  ensaladas: /\bensaladas? de frutas?\b|\bmacedonia\b/,                // es un postre
};

// Categorías que solo cuentan si las dice el nombre o la sección, nunca la descripción.
const DESC_UNRELIABLE = ['carnes', 'ensaladas', 'wok', 'sandwiches', 'tartas', 'wraps', 'tacos'];

// Secciones donde todo lo que hay es de esa categoría, diga lo que diga el nombre.
const SECTION_DECIDES = ['empanadas', 'pizza'];

// Secciones del menú o productos que nunca son "la comida" aunque mencionen una.
// Fatay/lahmacun: comida, pero el motor no sabe medirla (y sus descripciones hablan de "pizza").
const NOT_A_MEAL_SECTION = /bebida|cerveza|vino|trago|postre|helado|salsa|aderezo|extra|adicional|cafeter|desayuno|merienda|fatay|lahmacun|lehmeyun|sfiha/i;
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
    : 'piezas?|pzas?|pz|unidades|unid\\.?|uni|u\\b|bocaditos?|nugg?ets?|rolls?|makis?|nigu?iris?|empanadas?|tacos?|taquitos?|wraps?|burritos?|sandwich(?:es)?';
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
    case 'tacos':
    case 'wraps':
    case 'sandwiches':
      return fromName ?? leadN;
    default: { // hamburguesa, milanesa, pasta, carnes, ensaladas, tartas y wok: una porción.
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
  // Las categorías amplias no se deducen de la descripción: "morrones asados" o "con ensalada" no hacen
  // de un shawarma una parrillada ni de una milanesa una ensalada. Esas salen del nombre o la sección.
  const descCat = detectCategory(desc);
  const cat = (DESC_UNRELIABLE.includes(descCat) ? null : descCat) || sectionCat
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

// "carne" (vacuna, cordero, etc.) y "pollo" sirven para "no como carne" / vegetariano.
// Una hamburguesa o milanesa es de carne salvo que diga de qué otra cosa es.
const MEAT = /\bcarne|\bvacun|\bternera|\bbife|\blomo\b|\blomito|\basado|\bpicada|\bcuarto de libra|\bbig mac|\bwhopper|\bmedallon|\bentran|\bvacio\b|\bmatambre|\bpastrami|\bkebab|\bshawarma|\bcordero|\bangus|\bbarbacoa de res/;
const BEEF_BY_DEFAULT = /\bhamburgues|\bburgers?\b|\bsmash|\bcheeseburger|\bmilanes|\bmila\b|\bmilas\b/;
const NOT_BEEF = /\bpollo|\bchicken|\bsuprema|\bveggie|\bvegan|\bvegetal|\blenteja|\bgarbanzo|\bsoja|\bseitan|\btofu|\bberenjena|\bhongo|\bcalabaza|\bzucchini|\bzapallito|\bpescado|\bsalmon|\batun\b|\bnot ?burger|\bplant/;
const POULTRY = /\bpollo|\bchicken|\bnugg?ets?\b|\bsuprema|\balitas|\bwings\b|\bpechuga|\bpresas?\b|\bpavita|\bpavo\b/;

export function parseTags(product) {
  const t = normalize(`${product.name} ${product.description || ''}`);
  const tags = TAG_RULES.filter(([, re]) => re.test(t)).map(([tag]) => tag);
  if (MEAT.test(t) || (BEEF_BY_DEFAULT.test(t) && !NOT_BEEF.test(t))) tags.push('carne');
  if (POULTRY.test(t)) tags.push('pollo');
  return tags;
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
// home: { lat, lng } de la dirección de entrega (para la distancia a cada local).
// priceSnapshots: [{ date: 'AAAA-MM-DD', prices: { url: { productId: precio } } }] en cualquier orden.
// otherApps: { itemId: [{ app, name, price, same, note }] } — precios del mismo producto en otras apps.
export function convert(scrape, { google = {}, preferences = null, minPrice = 300, pages = {}, signals = null,
  home = null, priceSnapshots = [], otherApps = {}, extraPhotos = {} } = {}) {
  const snapshots = [...priceSnapshots].sort((a, b) => a.date.localeCompare(b.date));
  const scrapeDay = scrape.scraped_at ? scrape.scraped_at.slice(0, 10) : null;
  const brandCount = {};
  for (const r of scrape.restaurants) { const b = brandOf(r.restaurant); brandCount[b] = (brandCount[b] || 0) + 1; }
  const genericImages = findGenericImages(scrape, pages);
  const brandPhotos = photosByBrand(scrape, pages, genericImages);
  const officialPhotos = new Map(Object.entries(extraPhotos)
    .map(([brand, list]) => [brand, new Map(list.map(x => [photoKey(x.name), x.url]))]));

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
      coverUrl: page.background ? `${page.background.split('?')[0]}?d=1600x1200&e=webp&q=82` : null, // la CDN no agranda: si el original es menor, llega el original
      schedule: fullSchedule(page),
      // Coordenadas del local: permiten recalcular la distancia cuando quien usa la app cambia su dirección.
      lat: page.location?.[1] ?? null,
      lng: page.location?.[0] ?? null,
      distanceKm: home && page.location ? +distanceKm([home.lat, home.lng], [page.location[1], page.location[0]]).toFixed(2) : null,
    });
    if (!r.address && page.address) restaurants[restaurants.length - 1].address = page.address.trim();

    const pageIndex = photoIndex(page, genericImages);
    let popular = 0;
    for (const p of r.products) {
      if (!(p.price_ars >= minPrice)) continue;
      const itemId = `${id}:${p.product_id}`;
      if (seenItemIds.has(itemId)) continue; // Rappi repite productos entre secciones
      seenItemIds.add(itemId);
      // Solo la foto que Rappi asigna a ESTE product_id, y nunca una genérica del local.
      // Una foto genérica cuenta como si no hubiera: así se prueba el cruce por nombre.
      const ownFile = page.products?.[p.product_id];
      const file = ownFile && !genericImages.has(ownFile) ? ownFile : null;
      const rawScraped = p.image_url && !p.image_url.startsWith('data:') ? p.image_url : null;
      const scraped = rawScraped && !genericImages.has(rawScraped.split('/').pop().split('?')[0]) ? rawScraped : null;
      // Si el id no está en la página (las cadenas grandes usan otro id), se cruza por nombre: primero en
      // la misma página y después en otra sucursal de la misma marca.
      const byName = !file && !scraped ? bestPhoto(pageIndex, p.name) || bestPhoto(brandPhotos.get(brand), p.name) : null;
      // Último recurso: foto oficial de la marca (data/extra-photos.json), para cadenas que Rappi deja sin foto.
      const official = !file && !scraped && !byName ? bestPhoto(officialPhotos.get(brand), p.name) : null;
      const imageUrl = file ? sized(PRODUCT_IMG + file)
        : !ownFile && scraped ? sized(scraped)
        : byName ? sized(PRODUCT_IMG + byName) : official;
      // El precio de la página del local es más nuevo que el del scrapeo: si está, manda.
      const fresh = page.prices?.[p.product_id];
      const price = Math.round(fresh ? fresh[0] : p.price_ars);
      const real = Math.round(fresh ? fresh[1] : p.original_price_ars);
      const history = priceHistory(r.url, p.product_id, scrapeDay, p.price_ars, snapshots);
      items.push({
        id: itemId, restaurantId: id, name: p.name.trim(), description: p.description || '',
        section: p.category, price,
        originalPrice: real > price ? real : null,
        discount: fresh ? (real > price ? `-${Math.round((1 - price / real) * 100)}%` : null) : p.discount || null,
        ...history,
        ...(otherApps[itemId] ? { otherApps: otherApps[itemId] } : {}),
        imageUrl,
        yields: parseYields(p, r.restaurant), tags: parseTags(p),
        salesRank: /^populares$/i.test(p.category) ? ++popular : null,
      });
    }
  }

  for (const it of items) if (isInflatedOriginal(it.originalPrice, it.priceHistory)) it.inflatedOriginal = true;
  const discarded = dropImplausiblePrices(items);
  const unmatched = applySignals(signals, restaurants, items);
  return { meta: { source: scrape.source, address: scrape.delivery_address, scrapedAt: scrape.scraped_at, discarded,
    unmatchedSignals: unmatched, notOnRappi: signals?.notOnRappi || [],
    home, priceDays: [...new Set([scrapeDay, ...snapshots.map(s => s.date)].filter(Boolean))].sort() },
    restaurants, items, suggestedFavorites: matchPreferences(preferences, restaurants, items) };
}

// data/signals.json: Google y Morfy ya cruzados a mano con la sucursal correcta (por dirección).
// Pisa la tabla de Google vieja porque trae % de reseñas positivas y negativas.
// Devuelve las claves que no encontró, para que un cambio de ids en Rappi no pase en silencio.
function applySignals(signals, restaurants, items) {
  if (!signals) return [];
  const rById = Object.fromEntries(restaurants.map(r => [r.id, r]));
  const iById = Object.fromEntries(items.map(i => [i.id, i]));
  const missing = [];
  for (const [id, s] of Object.entries(signals.restaurants || {})) {
    const r = rById[id];
    if (!r) { missing.push(id); continue; }
    Object.assign(r, {
      googleRating: s.google?.rating ?? r.googleRating, googleReviews: s.google?.reviews ?? r.googleReviews,
      googlePositive: s.google?.positive ?? null, googleNegative: s.google?.negative ?? null,
      mentions: s.mentions || [],
    });
  }
  for (const [id, list] of Object.entries(signals.items || {})) {
    if (!iById[id]) { missing.push(id); continue; }
    (iById[id].signals ||= []).push(...list);
  }
  for (const [rid, byCat] of Object.entries(signals.categoryMentions || {})) {
    if (!rById[rid]) { missing.push(rid); continue; }
    for (const it of items) {
      if (it.restaurantId !== rid) continue;
      for (const [cat, text] of Object.entries(byCat)) {
        if (it.yields[cat]) (it.signals ||= []).push({ source: 'google', text });
      }
    }
  }
  return missing;
}

// Horario de la semana para engine/hours.js. Rappi da un solo tramo por día en scheduleData (a veces solo
// el de la madrugada, "00:00-03:30") y los tramos completos solo del día consultado (weekSchedules, que la
// descarga diaria va juntando). Un día con solo el tramo de madrugada queda como partial: no se sabe si
// abre de día, y la app no lo da por cerrado.
const DAY_KEYS = { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };
export function fullSchedule(page) {
  if (!page?.schedule && !page?.weekSchedules) return null;
  const full = page.weekSchedules || {};
  const out = [];
  for (const [key, day] of Object.entries(DAY_KEYS)) {
    if (full[key]?.length) { for (const [o, c] of full[key]) out.push({ day, time: { openTime: o, closeTime: c } }); continue; }
    for (const s of (page.schedule || []).filter(x => normalize(x.day) === normalize(day) && x.time)) {
      const tail = s.time.openTime === '00:00' && s.time.closeTime <= '06:00';
      out.push(tail ? { ...s, partial: true } : s);
    }
  }
  return out.length ? out : null;
}

// Nombre de producto para cruzar fotos: "Cajita Feliz McNuggets x 6" = "cajita feliz mcnuggets x6".
export function photoKey(name) {
  return normalize(name).replace(/[^a-z0-9]+/g, ' ').replace(/\bx (\d)/g, 'x$1').trim();
}

// Foto para un nombre entre { nombre normalizado → archivo }: igual, o parecido con los mismos números
// ("McNuggets X10 Mediano" ≈ "McNuggets x10", nunca ≈ "McNuggets x20"). null si nada se parece lo suficiente.
// Palabras que no cambian la foto: tamaño del combo y "sin TACC" (misma comida, otra cocina).
// "simple" y "doble" sí cuentan: un Cuarto doble no es la foto de uno simple.
const SIZE_WORDS = new Set(['mediano', 'mediana', 'grande', 'chico', 'chica', 'pequeno', 'pequena', 'combo', 'mccombo', 'promo', 'sin', 'tacc', 'gluten']);
const STACK = ['doble', 'triple', 'cuadruple'];
export function bestPhoto(byKey, name) {
  if (!byKey?.size) return null;
  const key = photoKey(name);
  if (byKey.has(key)) return byKey.get(key);
  const words = k => k.split(' ').filter(w => w && !SIZE_WORDS.has(w));
  const nums = ws => ws.filter(w => /\d/.test(w)).sort().join(',');
  const mine = words(key);
  if (!mine.length) return null;
  let best = null, bestScore = 0;
  for (const [k, file] of byKey) {
    const theirs = words(k);
    if (nums(theirs) !== nums(mine)) continue;
    if (STACK.some(w => mine.includes(w) !== theirs.includes(w))) continue; // un doble no es la foto de un simple
    const common = mine.filter(w => theirs.includes(w)).length;
    const score = common / new Set([...mine, ...theirs]).size;
    if (score > bestScore) { bestScore = score; best = file; }
  }
  // Con una sola palabra ("mcnifica") tiene que ser exacta; con más, parecida.
  return bestScore >= (mine.length === 1 ? 1 : 0.75) ? best : null;
}

// El producto sin tamaño ni cantidad: "Nuevo Alaska 15 Full Salmón" y "Nuevo Alaska 40" son la misma
// familia y pueden compartir foto; un logo de plataforma cae en familias distintas.
const FAMILY_FILLER = new Set(['pz', 'pzs', 'piezas', 'pieza', 'unidades', 'u', 'x', 'extra', 'nuevo', 'nueva', 'de', 'del', 'con', 'y', 'la', 'el']);
export function familyKey(name) {
  const key = photoKey(name);
  return key.split(' ').filter(w => w && !/\d/.test(w) && !SIZE_WORDS.has(w) && !FAMILY_FILLER.has(w)).join(' ') || key;
}

function photoIndex(page, generic, into = new Map()) {
  for (const [pid, n] of Object.entries(page?.names || {})) {
    const file = page.products?.[pid];
    if (file && !generic.has(file) && !into.has(photoKey(n))) into.set(photoKey(n), file);
  }
  return into;
}

// marca → { nombre → foto }, juntando todas las sucursales de la marca.
function photosByBrand(scrape, pages, generic) {
  const out = new Map();
  for (const r of scrape.restaurants) {
    const brand = brandOf(r.restaurant);
    out.set(brand, photoIndex(pages[r.url], generic, out.get(brand)));
  }
  return out;
}

// Una foto que el local usa para 3+ productos distintos, o que comparten marcas distintas,
// es un placeholder ("logo", "foto ilustrativa"): mostrarla sería mostrar la foto equivocada.
function findGenericImages(scrape, pages) {
  const names = new Map();   // archivo → nombres de producto distintos (por local)
  const global = new Map();  // archivo → nombres de producto distintos (en todos los locales)
  for (const r of scrape.restaurants) {
    const page = pages[r.url];
    if (!page?.products) continue;
    const byId = Object.fromEntries(r.products.map(p => [p.product_id, normalize(p.name)]));
    for (const [pid, n] of Object.entries(page.names || {})) byId[pid] ??= normalize(n);
    for (const [pid, file] of Object.entries(page.products)) {
      const key = `${r.url}|${file}`;
      if (!names.has(key)) names.set(key, new Set());
      names.get(key).add(familyKey(byId[pid] ?? pid));
      // Entre locales se compara por nombre: marcas hermanas (Monti / Monti Milas, SushiPop / Izakaya by
      // Sushi Pop) comparten fotos reales del mismo producto; un logo de plataforma cae en productos distintos.
      if (!global.has(file)) global.set(file, new Set());
      global.get(file).add(familyKey(byId[pid] ?? pid));
    }
  }
  const generic = new Set();
  for (const [key, set] of names) if (set.size >= 3) generic.add(key.split('|')[1]);
  for (const [file, set] of global) if (set.size >= 3) generic.add(file);
  return generic;
}

// Historial de un producto: un punto por día (el último del día gana). Solo se guarda si hay
// al menos dos días; priceChange compara el último día con el anterior. El tachado es "inflado"
// cuando, con 3+ días y al menos una semana de datos, nunca lo vimos venderse a ese precio.
export function priceHistory(url, productId, scrapeDay, scrapePrice, snapshots) {
  const byDay = new Map();
  if (scrapeDay && scrapePrice > 0) byDay.set(scrapeDay, Math.round(scrapePrice));
  for (const s of snapshots) {
    const v = s.prices?.[url]?.[productId];
    if (v > 0) byDay.set(s.date, Math.round(v));
  }
  const points = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (points.length < 2) return {};
  const [prevDay, prev] = points[points.length - 2], [, cur] = points[points.length - 1];
  const out = { priceHistory: points };
  if (cur !== prev) out.priceChange = { from: prev, to: cur, pct: Math.round(((cur - prev) / prev) * 100), since: prevDay };
  return out;
}

export function isInflatedOriginal(originalPrice, points) {
  if (!originalPrice || !points || points.length < 3) return false;
  const days = (Date.parse(points[points.length - 1][0]) - Date.parse(points[0][0])) / 86400000;
  return days >= 7 && originalPrice > Math.max(...points.map(p => p[1])) * 1.05;
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
