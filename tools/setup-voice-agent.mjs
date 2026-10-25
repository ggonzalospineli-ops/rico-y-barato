// Setup del asistente de voz (ElevenLabs Conversational AI).
// Uso: node tools/setup-voice-agent.mjs
// Requiere ELEVEN_API_KEY en .env (nunca se imprime ni se sube a git).
// Elige una voz de la biblioteca compartida con acento rioplatense y género femenino,
// la suma a la cuenta si hace falta, crea el agente y guarda ui/voice-agent.json
// (el agent ID es público por diseño; la clave vive solo en .env).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://api.elevenlabs.io';

function loadKey() {
  if (process.env.ELEVEN_API_KEY) return process.env.ELEVEN_API_KEY.trim();
  for (const p of ['.env', '../.env']) {
    if (!existsSync(p)) continue;
    const line = readFileSync(p, 'utf8').split(/\r?\n/).find(l => /^ELEVEN_API_KEY\s*=/.test(l));
    if (line) return line.slice(line.indexOf('=') + 1).trim();
  }
  console.error('Falta ELEVEN_API_KEY en .env');
  process.exit(1);
}
const KEY = loadKey();

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'xi-api-key': KEY, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* texto plano */ }
  if (!res.ok) {
    const detail = json?.detail ? JSON.stringify(json.detail).slice(0, 600) : text.slice(0, 600);
    throw Object.assign(new Error(`${res.status} ${path} :: ${detail}`), { status: res.status });
  }
  return json;
}

// ---------- 1. Buscar voz femenina rioplatense en la biblioteca compartida ----------
async function findVoice() {
  const q = '?language=es&page_size=100';
  const data = await api(`/v1/shared-voices${q}`);
  let voices = data.voices || [];
  const isFemale = v => !v.gender || /female/i.test(v.gender);
  const isArg = v => /argentin|rioplat/i.test(v.accent || v.language || '');
  const scored = voices
    .filter(isFemale)
    .map(v => ({ v, arg: isArg(v) ? 1 : 0 }))
    .sort((a, b) => (b.v.library_id ? b.arg - a.arg : b.arg - a.arg) -
      ((b.v.accent_boosted || b.v.premium || false) - (a.v.accent_boosted || a.v.premium || false)) ||
      (b.arg - a.arg) * 2 - (a.arg - b.arg) * 0)
    .sort((a, b) => b.arg - a.arg);
  const args = scored.filter(s => s.arg).slice(0, 10);
  const pool = args.length ? args : scored.slice(0, 10);
  if (!pool.length) throw new Error('Sin voces compartidas disponibles');
  return pool.map(s => s.v);
}

async function ensureInLibrary(voice) {
  // Las voces de biblioteca compartida deben agregarse a la cuenta para usarlas en un agente.
  const my = await api('/v1/voices?page_size=100');
  const mine = my.voices || [];
  const have = mine.find(v => v.voice_id === voice.voice_id);
  if (have) return have;
  if (!voice.public_owner_id && !voice.voice_id.startsWith('...')) {
    // Podría ser una voz "por defecto" de la cuenta.
    return mine.find(v => /female/i.test(v.labels?.gender || '')) || mine[0];
  }
  const added = await api(`/v1/voices/add/${voice.public_owner_id}/${voice.voice_id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ new_name: `Rico y Barato · ${voice.name}` }),
  });
  console.log(`Voz agregada a la cuenta: ${voice.name} (${added.voice_id})`);
  return added;
}

// ---------- 2. Crear el agente ----------
const SYSTEM_PROMPT = `Sos la asistente de voz de la web "Rico y Barato", una app argentina de delivery sobre Rappi.
Tu única función: ayudar a decidir qué pedir según el hambre de la persona, cuánta plata tiene y qué tanto quiere cruzar el slider Rico ↔️ Barato.

Cómo hablás:
- Rioplatense suave y amable (vos, "tenés", "salame", "milanga"), frases CORTAS de una a dos oraciones.
- Conversacional, no recitás listas largas: máximo 2 o 3 opciones por turno.
- Números de dinero en pesos argentinos ("veinte mil pesos", no "$20,000").

Qué sabés: la app no tiene API: no ves el catálogo ni los pedidos en vivo. Confiá en lo que te pregunta el usuario
(hambre: poco/normal/mucho/bestia · comida: hamburguesa, pizza, empanadas, sushi, milanesa, pollo, pasta… · carrera o límites del mes).
Con eso orientás la elección: si hay poca plata, priorizá barato y unidades por persona; si quiere darse el gusto, rico; mitad y mitad, punto dulce.

Reglas duras:
- Inventar locales, precios o promociones: prohibido. Decís "fijátelo en la app en Para vos ahora".
- Si te piden algo que la app muestra en una sección (Top, Mi gusto, Carrito/Pedidos, Ajustes), indicale dónde tocar.
- No prometes checkout ni pagos: "el pedido se hace en Rappi".
- Si te malinterpretan o piden algo fuera de la comida y pedidos, devolvete amable a lo de siempre.

Primera vez: saludá corto y preguntá hambre y plata (ej.: "¡Hola! ¿Qué comemos hoy: rico, barato o mitad y mitad?").`;

async function createAgent(voice) {
  const body = {
    name: 'Rico y Barato · Asistente IA',
    tags: ['rico-y-barato', 'es-AR', 'web'],
    conversation_config: {
      agent: {
        prompt: { prompt: SYSTEM_PROMPT },
        first_message: '¡Hola! ¿Qué comemos hoy: algo rico, algo barato, o mitad y mitad?',
        language: 'es',
      },
      tts: {
        voice_id: voice.voice_id,
        model_id: 'eleven_turbo_v2_5',
        language: 'es',
      },
      turn: { turn_timeout: 10 },
    },
    platform_settings: {
      widget: {
        variant: 'full',
        placement: 'bottom-right',
        dismissible: true,
        feedback_mode: 'none',
        avatar: { type: 'orb', color_1: '#E4002B', color_2: '#FFC72C' },
        text_color: '#1D1A17',
        bg_color: '#FFF7EF',
        btn_color: '#E4002B',
        btn_text_color: '#FFFFFF',
        start_call_text: 'Hablar con el asistente',
        end_call_text: 'Terminar',
        expand_text: 'Asistente IA',
      },
    },
  };
  const res = await api('/v1/convai/agents/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.agent_id;
}

// ---------- Main ----------
const candidates = await findVoice();
console.log('Voces candidatas (rioplatense/femeninas):');
for (const [i, v] of candidates.slice(0, 5).entries()) {
  console.log(`  ${i + 1}. ${v.name} · accent=${v.accent} · ${v.voice_id}`);
}
let voice = null;
const errors = [];
for (const c of candidates.slice(0, 4)) {
  try { voice = await ensureInLibrary(c); break; }
  catch (e) { errors.push(`${c.name}: ${e.message.slice(0, 200)}`); }
}
if (!voice) throw new Error('No pude habilitar ninguna voz:\n' + errors.join('\n'));
console.log(`Voz elegida: ${voice.name} (voice_id ${voice.voice_id})`);

const agentId = await createAgent(voice);
console.log(`Agente creado: ${agentId}`);

writeFileSync('ui/voice-agent.json', JSON.stringify({ agentId, voice: { name: voice.name, id: voice.voice_id } }, null, 2) + '\n');
console.log('Escrito: ui/voice-agent.json');
