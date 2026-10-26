// Calorías y "qué tan sano" ESTIMADOS a partir del nombre, la descripción, la categoría y los gramos que
// diga el menú. Rappi no publica información nutricional: esto es una aproximación con valores típicos
// de porciones argentinas, y siempre se muestra como estimado y con los motivos.
//
// estimateNutrition(item) → { kcal, range: [min, max], health: 0-100, label, reasons: [...], confidence }

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// kcal por unidad de cada categoría (la unidad es la del catálogo: pieza, porción, unidad, presa).
const BASE_KCAL = {
  nuggets: 48, sushi: 45, hamburguesa: 560, empanadas: 300, pizza: 285, milanesa: 620, pollo: 280,
  pasta: 650, tacos: 220, wraps: 560, carnes: 650, ensaladas: 360, sandwiches: 560, tartas: 340, wok: 640,
};
// Punto de partida de "qué tan sano" por categoría (antes de mirar ingredientes y cocción).
const BASE_HEALTH = {
  nuggets: 30, sushi: 62, hamburguesa: 34, empanadas: 42, pizza: 38, milanesa: 40, pollo: 28,
  pasta: 48, tacos: 50, wraps: 52, carnes: 50, ensaladas: 78, sandwiches: 44, tartas: 50, wok: 60,
};

// Ajustes multiplicativos del plato principal (sobre lo que diga el nombre).
const MAIN_MODIFIERS = [
  [/\btriple\b/, 1.85, null], [/\bdoble\b/, 1.45, null], [/\bcuadruple\b/, 2.2, null],
  [/\bfrit[oa]s?\b|\brebozad|\bempanizad|\bcrispy|\bcrocante|\btempura|\bfry\b/, 1.25, null],
  [/\bal horno\b|\bhorneada?s?\b/, 0.92, null],
  [/\bnapolitana\b|\bfugazzeta\b|\b4 quesos\b|\bcuatro quesos\b|\bextra queso\b|\bcheddar\b/, 1.12, null],
  [/\bbacon\b|\bpanceta\b/, 1.15, null],
  [/\bphiladelphia\b|\bqueso crema\b/, 1.1, null],
  [/\bchica\b|\bmini\b|\bjr\.?\b|\bjunior\b|\bmedia porcion\b|\bkids\b|\bcajita\b/, 0.7, null],
  [/\bgrande\b|\bxl\b|\bmaxi\b|\bmega\b|\bgigante\b/, 1.2, null],
  [/\bplancha\b|\bgrill(e|ad)|\ba la parrilla\b|\bvapor\b/, 0.9, null],
  [/\blight\b|\bfit\b|\bkcal\b/, 0.8, null],
];

// Agregados que suman kcal fijas (acompañamientos y bebidas de los combos). Dentro de un grupo cuenta solo
// el primero que aparezca: "papas chicas" no son además "papas fritas".
const ADDONS = [
  ['papas', [
    [/\bpapas? (fritas? )?(grandes?|xl)\b/, 480, 'papas grandes'],
    [/\bpapas? (fritas? )?(chicas?|pequenas?|kids)\b/, 230, 'papas chicas'],
    [/\bpapas? (fritas? )?medianas?\b|\b(con|\+|y) (fritas|papas)\b|\bpapas fritas\b/, 340, 'papas fritas'],
  ]],
  ['entrada', [[/\bnachos\b/, 420, 'nachos'], [/\baros de cebolla\b/, 380, 'aros de cebolla']]],
  ['postre', [[/\bmc ?flurry\b|\bhelado\b|\bsundae\b|\bpostre\b|\bbrownie\b|\bvolcan\b|\bflan\b/, 330, 'postre']]],
  ['bebida', [
    [/\b(gaseosa|coca|pepsi|sprite|fanta|7 ?up|bebida|refresco)\b(?![^,.;]*\b(zero|light|sin azucar|agua)\b)/, 210, 'gaseosa'],
    [/\bcerveza\b/, 190, 'cerveza'],
  ]],
];

// Ingredientes que bajan o suben el puntaje de salud.
const HEALTH_SIGNS = [
  [/\bfrit[oa]s?\b|\brebozad|\bempanizad|\bcrispy|\bcrocante|\btempura\b/, -18, 'frito'],
  [/\bbacon\b|\bpanceta\b|\bsalchich|(?<!bife de )\bchorizo\b|\bmorcilla\b|\bsalame\b|\bjamon\b|\bfiambre|\bpancho/, -10, 'embutidos o fiambre'],
  [/\b4 quesos\b|\bcuatro quesos\b|\bextra queso\b|\bfugazzeta\b|\bcheddar\b|\broquefort\b|\bprovolone\b|\bqueso crema\b|\bphiladelphia\b/, -8, 'mucho queso'],
  [/\bmayo(nesa)?\b|\bsalsa (bbq|barbacoa|golf|cheddar)\b|\bdulce de leche\b|\bnutella\b|\bchocolate\b/, -6, 'salsas o azúcar'],
  // Lechuga, tomate y cebolla de una hamburguesa no hacen sano un plato: cuentan verduras de verdad.
  [/\bensalada|\bverdura|\bvegetal|\brucula\b|\bespinaca|\bbrocoli|\bzanahoria|\bzuc+hini|\bberenjena|\bpalta\b|\bchampi|\bhongos\b|\bcalabaza\b|\bremolacha\b/, 8, 'verduras'],
  [/\bpollo (grill|a la plancha|al horno)|\bpechuga\b|\bsalmon\b|\batun\b|\bpescado\b|\bhuevo\b|\bgarbanzo|\blenteja|\bporoto|\btofu\b|\bquinoa\b/, 10, 'proteína magra o legumbres'],
  [/\bintegral|\byamani\b|\bquinoa\b|\bavena\b|\bsemillas\b/, 8, 'integral o semillas'],
  [/\bplancha\b|\bgrill(e|ad)|\bal horno\b|\bvapor\b|\bhorneada?\b/, 8, 'a la plancha o al horno'],
  [/\bvegan|\bveggie\b|\bvegetarian/, 5, 'vegetariano'],
];

// Gramos del plato principal ("medallón de 180 g", "1/2 kg", "300gr"). Solo pesos razonables de comida.
export function parseGrams(text) {
  const t = norm(text);
  if (/\b1\/2 ?kg\b|\bmedio kilo\b/.test(t)) return 500;
  if (/\b1 ?kg\b|\bun kilo\b/.test(t)) return 1000;
  const m = t.match(/\b(\d{2,4})\s?(g|gr|grs|gramos)\b/);
  return m && +m[1] >= 40 && +m[1] <= 1500 ? +m[1] : null;
}

// En platos armados (ensaladas, wok, bowls, wraps) las calorías dependen de lo que llevan: se parte de una
// base liviana y se suma cada ingrediente que nombra el menú.
const BUILT = { ensaladas: 220, wok: 420, wraps: 380 };
const INGREDIENT_KCAL = [
  [/\bpollo\b|\bpechuga\b|\bpavita\b/, 150], [/\batun\b|\bsalmon\b|\blangostin|\bcamaron/, 130],
  [/\bcarne\b|\bternera\b|\blomo\b|\bbife\b/, 190], [/\bhuevos?\b/, 80],
  [/\bqueso\b|\bparmesano\b|\bfeta\b|\bmozzarella\b|\bmuzzarella\b|\bcheddar\b|\bbrie\b|\broquefort\b/, 100],
  [/\bpalta\b|\bguacamole\b/, 120], [/\bcroutones\b|\bcrutones\b|\bpan\b/, 80],
  [/\baderezo\b|\bcaesar\b|\bcesar\b|\bmayo|\bsalsa\b|\bdressing\b/, 90],
  [/\barroz\b|\bquinoa\b|\bfideos\b|\bnoodles\b|\bpapa\b|\bpapas\b|\bfideo\b/, 180],
  [/\bjamon\b|\bpanceta\b|\bbacon\b/, 110], [/\bnuez|\bnueces\b|\balmendras?\b|\bsemillas\b|\bmani\b|\bsesamo\b/, 90],
  [/\bgarbanzos?\b|\blentejas?\b|\bporotos?\b|\bfalafel\b/, 140],
];

// kcal por gramo del ingrediente principal, cuando el menú dice el peso.
const KCAL_PER_GRAM = { hamburguesa: 2.6, carnes: 2.4, milanesa: 2.4, pasta: 1.6, wok: 1.3, ensaladas: 1.1, pollo: 2.5 };

export function estimateNutrition(item) {
  const name = norm(item.name);
  const text = `${name} ${norm(item.description)}`;
  const yields = Object.entries(item.yields || {});
  const reasons = [];
  let kcal = 0, health = 50, weight = 0, confidence = 'baja';

  if (yields.length) {
    for (const [cat, n] of yields) {
      let unit = BASE_KCAL[cat] ?? 450;
      if (BUILT[cat] && n === 1) {
        const parts = INGREDIENT_KCAL.filter(([re]) => re.test(text));
        if (parts.length) { unit = BUILT[cat] + parts.reduce((sum, [, k]) => sum + k, 0); confidence = 'media'; }
      }
      for (const [re, f] of MAIN_MODIFIERS) if (re.test(name)) unit *= f;
      const grams = parseGrams(text);
      // Con peso del menú se usa para la porción (una sola unidad), si no la base típica.
      if (grams && n === 1 && KCAL_PER_GRAM[cat]) {
        const fromGrams = grams * KCAL_PER_GRAM[cat] + (cat === 'hamburguesa' ? 260 : 0); // pan y aderezos
        unit = (unit + fromGrams) / 2;
        confidence = 'media';
      }
      kcal += unit * n;
      health += (BASE_HEALTH[cat] ?? 50) - 50;
      weight += n;
    }
  } else {
    kcal = 450; // algo que el motor no mide (una tortilla, un plato del día): valor genérico
  }

  for (const [, group] of ADDONS) {
    const hit = group.find(([re]) => re.test(text));
    if (hit) { kcal += hit[1]; reasons.push(`+ ${hit[2]}`); }
  }
  // Nuggets y pollo frito son fritos aunque el nombre no lo diga; y lo frito no suma como "magro" ni "a la plancha".
  const FRIED = HEALTH_SIGNS[0][0];
  // "Alcaparras fritas", "cebolla crispy" o "papas fritas" de acompañamiento no hacen frito al plato.
  const TOPPING = /\b(cebollas?|alcaparras|ajos?|papas?|batatas?|verdeo|puerros?|garbanzos?|croutones|tortillas?) (crispy|fritas?|fritos?|crocantes?)\b|\bcroutones\b/g;
  const mainText = text.replace(TOPPING, ' ');
  const fried = FRIED.test(mainText) || yields.some(([c]) => c === 'nuggets' || c === 'pollo');
  if (!fried && TOPPING.test(text) && !/\bpapas fritas\b/.test(text)) { health -= 4; reasons.push('✗ con algo frito encima'); }
  for (const [re, delta, label] of HEALTH_SIGNS) {
    const applies = re === FRIED ? fried : re.test(text);
    if (!applies || (fried && /magra|plancha/.test(label))) continue;
    health += delta;
    reasons.push(delta > 0 ? `✓ ${label}` : `✗ ${label}`);
  }

  // Mucha energía en un solo pedido también pesa.
  const perServing = weight > 1 ? kcal / Math.max(1, Math.round(weight / unitsPerServing(yields))) : kcal;
  if (perServing > 1200) { health -= 15; reasons.push('✗ muy calórico'); }
  else if (perServing > 900) { health -= 8; reasons.push('✗ bastante calórico'); }

  health = Math.max(5, Math.min(95, Math.round(health)));
  kcal = Math.round(kcal / 10) * 10;
  const spread = confidence === 'media' ? 0.15 : 0.25;
  const units = yields.reduce((s, [, n]) => s + n, 0);
  return {
    kcal,
    perUnit: units > 1 ? Math.round(kcal / units / 10) * 10 : null,
    range: [Math.round((kcal * (1 - spread)) / 10) * 10, Math.round((kcal * (1 + spread)) / 10) * 10],
    health,
    label: healthLabel(health),
    reasons: [...new Set(reasons)],
    confidence,
  };
}

// Cuántas unidades son "una porción para una persona" (para no penalizar una pizza entera o 30 piezas).
function unitsPerServing(yields) {
  const cat = yields[0]?.[0];
  return { nuggets: 10, sushi: 15, empanadas: 3, pizza: 3, pollo: 3, tacos: 3, tartas: 2 }[cat] || 1;
}

export function healthLabel(h) {
  return h >= 70 ? 'Liviano y sano' : h >= 50 ? 'Equilibrado' : h >= 30 ? 'Pesado' : 'Muy pesado';
}

// Lo que necesita una persona por día según su peso y objetivo (aproximación simple: kcal por kilo).
export function dailyKcal(weightKg, goal = 'mantener') {
  if (!(weightKg >= 30 && weightKg <= 250)) return null;
  const perKg = { bajar: 25, mantener: 30, subir: 35 }[goal] || 30;
  return Math.round((weightKg * perKg) / 50) * 50;
}
