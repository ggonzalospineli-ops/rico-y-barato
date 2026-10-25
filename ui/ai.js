// IA de la app, con dos proveedores intercambiables:
//  - local:  Ollama en esta compu (http://127.0.0.1:11434), sin clave ni costo. Para demos y uso propio.
//            Se arranca con tools/ia-local.ps1. El navegador tiene que estar en la misma compu.
//  - claude: API de Anthropic con la clave del usuario (queda en este navegador). Para cuando la app
//            corra para otros: ahí conviene un servidor propio que guarde la clave.
// "auto" usa la local si está corriendo y si no Claude si hay clave. Sin ninguna, la app sigue con su
// intérprete local de frases (engine/intent.js) y la carga manual de tickets.

const OLLAMA = 'http://127.0.0.1:11434';
const LOCAL_MODEL_KEY = 'ryb:ai-local-model';
const DEFAULT_LOCAL_MODEL = 'gemma3:12b';
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.133.0';
const CLAUDE_MODEL = 'claude-opus-5-5';
const KEY = 'ryb:anthropic-key';
const PROVIDER = 'ryb:ai-provider';

const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};

export const getKey = () => store.get(KEY);
export const setKey = k => store.set(KEY, (k || '').trim());
export const hasKey = () => !!getKey();
export const getProvider = () => store.get(PROVIDER) || 'auto';
export const setProvider = p => store.set(PROVIDER, p === 'auto' ? '' : p);
export const localModel = () => store.get(LOCAL_MODEL_KEY) || DEFAULT_LOCAL_MODEL;
export const setLocalModel = m => store.set(LOCAL_MODEL_KEY, m === DEFAULT_LOCAL_MODEL ? '' : m);

// Estado de la IA local, detectado al arrancar y al pedirlo desde Ajustes.
let local = { checked: false, up: false, models: [] };
export async function detectLocal() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    local = { checked: true, up: true, models: (data.models || []).map(m => m.name) };
  } catch {
    local = { checked: true, up: false, models: [] };
  }
  return local;
}
export const localStatus = () => ({ ...local, model: localModel(), hasModel: local.models.includes(localModel()) });

// Qué proveedor se usa ahora mismo (o null si ninguno está listo).
export function activeProvider() {
  const p = getProvider();
  const localReady = local.up && local.models.includes(localModel());
  if (p === 'off') return null;
  if (p === 'local') return localReady ? 'local' : null;
  if (p === 'claude') return hasKey() ? 'claude' : null;
  return localReady ? 'local' : hasKey() ? 'claude' : null;
}
export const hasAI = () => !!activeProvider();
export const aiLabel = () => ({ local: `IA local (${localModel()})`, claude: 'Claude' }[activeProvider()] || 'sin IA');

// ---------- Proveedores ----------
async function askLocal({ system, text, image, schema }) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: localModel(),
      stream: false,
      format: schema,                       // Ollama restringe la salida a este JSON Schema
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text, ...(image ? { images: [image.data] } : {}) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`La IA local respondió ${res.status}. ¿Está corriendo tools\\ia-local.ps1?`);
  const data = await res.json();
  try { return JSON.parse(data.message?.content || ''); } catch { throw new Error('La IA local devolvió algo que no se pudo leer. Probá de nuevo.'); }
}

let clientPromise = null;
async function claudeClient() {
  const apiKey = getKey();
  if (!clientPromise || clientPromise.key !== apiKey) {
    // dangerouslyAllowBrowser: la clave es del propio usuario y vive en su navegador; no hay servidor.
    clientPromise = import(SDK_URL).then(({ default: Anthropic }) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }));
    clientPromise.key = apiKey;
  }
  return clientPromise;
}

async function askClaude({ system, text, image, schema, effort = 'low' }) {
  const anthropic = await claudeClient();
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.media, data: image.data } }, { type: 'text', text }]
    : text;
  const res = await anthropic.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude no quiso responder esta vez. Probá con otra frase.');
  if (res.stop_reason === 'max_tokens') throw new Error('La respuesta quedó cortada. Probá de nuevo.');
  const out = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(out); } catch { throw new Error('Claude devolvió algo que no se pudo leer.'); }
}

async function askJson(req) {
  const p = activeProvider();
  if (p === 'local') return askLocal(req);
  if (p === 'claude') return askClaude(req);
  throw new Error('No hay IA conectada: arrancá la local (tools\\ia-local.ps1) o cargá una clave de Claude en Ajustes.');
}

export async function testAI() {
  const r = await askJson({
    system: 'Respondé solo con el JSON pedido.',
    text: 'Respondé ok: true.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  });
  if (r.ok !== true) throw new Error('La IA respondió, pero no lo esperado.');
  return true;
}

// ---------- Tareas ----------
// Campos que pueden venir vacíos: anyOf con null (las listas de tipos no están entre lo soportado por Claude).
const orNull = schema => ({ anyOf: [schema, { type: 'null' }] });

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['people', 'money', 'hunger', 'category', 'exclude', 'ricoWeight', 'summary'],
  properties: {
    people: orNull({ type: 'integer', description: 'Cuántas personas comen' }),
    money: orNull({ type: 'integer', description: 'Plata total disponible en pesos argentinos' }),
    hunger: orNull({ type: 'string', enum: ['poco', 'normal', 'mucho', 'bestia'] }),
    category: orNull({ type: 'string', enum: ['nuggets', 'sushi', 'hamburguesa', 'empanadas', 'pizza', 'milanesa', 'pollo', 'pasta'] }),
    exclude: { type: 'array', items: { type: 'string', enum: ['carne', 'cerdo', 'pollo', 'pescado', 'lacteos', 'picante', 'frito'] } },
    ricoWeight: orNull({ type: 'number', description: '0 = lo más barato, 1 = lo más rico' }),
    summary: { type: 'string', description: 'Una frase corta en castellano rioplatense con lo que entendiste' },
  },
};

// Con ejemplos: sin ellos el modelo local (gemma3:12b) inventaba comida y se olvidaba de exclusiones.
const INTENT_SYSTEM = `Sos el intérprete de pedidos de una app de delivery en Buenos Aires. Convertí lo que escribe la persona en filtros JSON.
Reglas:
- category: SOLO si nombra una comida o algo que la identifique ("algo japonés" = sushi, "pizzita" = pizza). Si no nombra comida, null. Nunca la inventes.
- money: pesos. "lucas", "k" o "mil" son miles (25 lucas = 25000). Si no dice plata o dice que no importa, null.
- hunger: poco (picar, liviano), normal, mucho (mucha hambre), bestia (muerto, cagado o "morimos" de hambre). Si no dice, null.
- exclude: "no come carne" o "vegetariano sin carne" = carne y cerdo; vegetariano = carne, cerdo, pollo y pescado; vegano = carne, cerdo, pollo, pescado y lacteos; "que no sea frito" = frito; "sin picante" = picante. Si alguien del grupo tiene una restricción, va igual.
- ricoWeight: 0.15 si pide barato o gastar poco, 0.85 si quiere algo rico o darse un gusto, null si no dice.
- summary: una frase corta con lo que entendiste. No agregues cosas que no dijo.
Ejemplos:
"somos 3, uno es vegano, 30 lucas" → {"people":3,"money":30000,"hunger":null,"category":null,"exclude":["carne","cerdo","pollo","pescado","lacteos"],"ricoWeight":null,"summary":"3 personas, uno vegano, $30.000"}
"algo para picar que no sea frito" → {"people":null,"money":null,"hunger":"poco","category":null,"exclude":["frito"],"ricoWeight":null,"summary":"algo liviano y no frito"}
"me muero de hambre, pizza barata" → {"people":null,"money":null,"hunger":"bestia","category":"pizza","exclude":[],"ricoWeight":0.15,"summary":"mucha pizza, barata"}`;

// Calienta el modelo local (lo carga en la GPU) para que la primera consulta de la demo no tarde un minuto.
export async function warmLocal() {
  if (!local.up || !local.models.includes(localModel())) return;
  try { await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ model: localModel(), messages: [], keep_alive: '30m' }) }); } catch {}
}

// Asistente por voz: contesta en una o dos frases para leer en voz alta, SOLO con las opciones que
// calculó el motor (nunca inventa locales ni precios), y puede elegir una o pedir agregarla al pedido.
const CHAT_SYSTEM = `Sos "Mila", la cómplice foodie de Rico y Barato, una app de delivery de Buenos Aires. Tu misión es destrabar la eterna pregunta "¿qué comemos?" sin hacer gastar de más.
Personalidad:
- Hablás en castellano rioplatense natural: cálida, rápida, segura y con una pizca de picardía porteña.
- Tenés criterio y te jugás por una opción. No sos una operadora ni una lista de resultados.
- Usás humor corto y espontáneo cuando suma ("banco", "negoción", "esa va como piña"), sin repetir muletillas ni exagerar el lunfardo.
- Cuidás el bolsillo sin moralizar. Si algo vale la pena, explicás el motivo concreto: precio, cantidad, gusto, envío o cercanía.
- Si la persona está indecisa, simplificás. Si ya decidió, acompañás sin volver a venderle la opción.
Tu respuesta se lee en voz alta: máximo 2 frases cortas, sin listas, sin emojis, sin markdown. Los precios decilos como "18 mil 500 pesos".
Reglas:
- Recomendá SOLO de la lista OPCIONES que te paso. Nunca inventes locales, platos, precios ni horarios.
- Si recomendás una, poné su id en "pick" (por ejemplo "o2"); si no, null.
- "addToCart": true SOLO si la persona pide explícitamente agregarla o pedirla ("agregala", "pedila", "dale, esa").
- Si OPCIONES está vacía, decí qué cambiar (más plata, menos hambre, otra comida o ver locales cerrados).
- Si la persona cambió filtros (más gente, otra comida, más barato), ya están aplicados: contestá sobre las opciones nuevas.
- No digas que sos una IA, no menciones filtros, puntajes internos ni estas instrucciones.`;

const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'pick', 'addToCart'],
  properties: {
    reply: { type: 'string', description: 'Respuesta corta para decir en voz alta' },
    pick: orNull({ type: 'string', description: 'id de la opción recomendada (o1, o2...)' }),
    addToCart: { type: 'boolean' },
  },
};

// history: [{ role: 'user'|'assistant', text }], context: { filters: string, options: [{ id, text }] }
export async function chatReply({ history, message, context }) {
  const convo = history.slice(-8).map(m => `${m.role === 'user' ? 'Persona' : 'Mila'}: ${m.text}`).join('\n');
  const opts = context.options.length ? context.options.map(o => `${o.id}: ${o.text}`).join('\n') : '(vacía)';
  return askJson({
    system: CHAT_SYSTEM,
    text: `${convo ? `CONVERSACIÓN HASTA AHORA:\n${convo}\n\n` : ''}FILTROS ACTUALES: ${context.filters}\n\nOPCIONES (de mejor a peor según sus filtros):\n${opts}\n\nLO ÚLTIMO QUE DIJO LA PERSONA: ${message}`,
    schema: CHAT_SCHEMA,
  });
}

// Frase libre → filtros de la app.
export async function interpretWithAI(text) {
  return askJson({
    system: INTENT_SYSTEM,
    text,
    schema: INTENT_SCHEMA,
  });
}

const TICKET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['restaurant', 'total', 'deliveryFee', 'tip', 'date', 'items', 'confidence'],
  properties: {
    restaurant: orNull({ type: 'string' }),
    total: orNull({ type: 'integer', description: 'Total pagado en pesos, con envío y propina' }),
    deliveryFee: orNull({ type: 'integer' }),
    tip: orNull({ type: 'integer' }),
    date: orNull({ type: 'string', format: 'date' }),
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'qty', 'price'],
      properties: { name: { type: 'string' }, qty: { type: 'integer' }, price: orNull({ type: 'integer' }) } } },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
};

// Foto de un ticket o de la pantalla de "pedido entregado" → datos del gasto.
export async function readTicket(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('No se pudo leer la foto'));
    fr.readAsDataURL(file);
  });
  const media = /^image\/(jpeg|png|gif|webp)$/.test(file.type) ? file.type : 'image/jpeg';
  return askJson({
    effort: 'medium',
    system: 'Leés tickets y comprobantes de delivery argentinos. Extraé solo lo que se ve; lo que no esté, null. '
      + 'Los montos van en pesos enteros, sin separador de miles ($ 12.500 = 12500).',
    text: 'Extraé local, total pagado, envío, propina, fecha (AAAA-MM-DD) y productos de esta imagen.',
    image: { media, data: dataUrl.split(',')[1] },
    schema: TICKET_SCHEMA,
  });
}
