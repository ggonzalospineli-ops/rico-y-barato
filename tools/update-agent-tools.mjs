// Le da al agente de voz de ElevenLabs acceso en vivo a la lista de la app:
// crea (una sola vez) la herramienta de cliente "buscar_opciones", se la asigna al agente y actualiza
// sus instrucciones para que la use siempre antes de recomendar.
// La herramienta la responde la propia página (ui/app.js → clientTools), con el motor y los datos reales.
//
// Uso: node tools/update-agent-tools.mjs     (lee ELEVEN_API_KEY de .env; la clave nunca se imprime)

import { readFileSync, existsSync } from 'node:fs';

const BASE = 'https://api.elevenlabs.io';
const AGENT_ID = JSON.parse(readFileSync(new URL('../ui/voice-agent.json', import.meta.url), 'utf8')).agentId;

function loadKey() {
  if (process.env.ELEVEN_API_KEY) return process.env.ELEVEN_API_KEY.trim();
  const env = new URL('../.env', import.meta.url);
  if (existsSync(env)) {
    const line = readFileSync(env, 'utf8').split(/\r?\n/).find(l => /^ELEVEN_API_KEY\s*=/.test(l));
    if (line) return line.slice(line.indexOf('=') + 1).trim();
  }
  console.error('Falta ELEVEN_API_KEY en .env');
  process.exit(1);
}
const KEY = loadKey();

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'xi-api-key': KEY, 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${opts.method || 'GET'} ${path} :: ${(json?.detail ? JSON.stringify(json.detail) : text).slice(0, 500)}`), { status: res.status });
  return json;
}

const TOOL = {
  type: 'client',
  name: 'buscar_opciones',
  description: 'Devuelve las opciones REALES de la app Rico y Barato (locales de Rappi abiertos, qué pedir, cantidades y precio total) '
    + 'para lo que quiere la persona. Usala SIEMPRE antes de recomendar algo y cada vez que la persona cambie la comida, la plata, '
    + 'el hambre, cuántos son o si prefiere rico o barato. También actualiza la pantalla de la app con esos filtros.',
  expects_response: true,
  response_timeout_secs: 20,
  parameters: {
    type: 'object',
    properties: {
      categoria: { type: 'string', description: 'Comida: nuggets, sushi, hamburguesa, empanadas, pizza, milanesa, pollo, pasta, o "todo" si no dijo.' },
      plata: { type: 'number', description: 'Plata total disponible en pesos argentinos. 0 si no dijo o no le importa.' },
      hambre: { type: 'string', description: 'poco, normal, mucho o bestia. Vacío si no dijo.' },
      personas: { type: 'number', description: 'Cuántas personas comen. 0 si no dijo.' },
      preferencia: { type: 'string', description: 'rico, barato o mitad. Vacío si no dijo.' },
    },
    required: [],
  },
};

const PROMPT = `Sos la asistente de voz de "Rico y Barato", una app argentina de delivery que ordena los menús de Rappi y ayuda a decidir qué pedir según el hambre, la plata y si la persona busca algo rico o barato.

Personaje: porteña canchera, cálida y con onda, como la amiga del barrio que te resuelve la comida. Voseo ("vos tenés", "dale"), muletillas rioplatenses ("che", "bárbaro", "posta", "milanga") y un humor siempre afectuoso.

Cómo hablás:
- Frases CORTAS: una o dos oraciones por turno.
- Plata en pesos hablados: "veinte mil pesos", nunca "$20,000".

CÓMO SABÉS QUÉ HAY: tenés la herramienta buscar_opciones, que te devuelve las opciones reales de la app (locales abiertos de Rappi, qué pedir, cantidad y precio).
- Antes de recomendar CUALQUIER cosa, llamá a buscar_opciones con lo que te dijo la persona (comida, plata, hambre, personas, rico/barato).
- Cada vez que la persona cambie algo ("algo más barato", "somos tres", "mejor sushi"), volvé a llamarla.
- Recomendá SOLO de lo que te devuelve: máximo 2 opciones por turno, con el local, qué trae y el precio total, y en una frase por qué le pega. Variá: si ya recomendaste un local, ofrecé otro cuando te pidan otra cosa.
- Si no devuelve nada, no inventes: decile qué cambiar (más plata, menos hambre, otra comida).
- Nunca inventes locales, precios, promos ni horarios.

Al empezar ya tenés el estado de la app: hambre {{hambre}}, plata {{plata}}, comida {{categoria}}, somos {{personas}}, busca {{modo}}. Primeras opciones en pantalla: {{top3}}.

La app tiene: Inicio ("Para vos ahora", mapa, "Decidí por mí"), Top, Mi gusto, Pedidos y Ajustes. Los pedidos se cierran en Rappi: vos no cobrás. Si preguntan algo que no es comida o delivery, volvé al tema con humor.`;

// 1) Herramienta: reusar si el agente ya la tiene, si no crearla.
const agent = await api(`/v1/convai/agents/${AGENT_ID}`);
const currentIds = agent.conversation_config?.agent?.prompt?.tool_ids || [];
let toolId = null;
for (const id of currentIds) {
  try {
    const t = await api(`/v1/convai/tools/${id}`);
    if (t.tool_config?.name === TOOL.name) { toolId = id; break; }
  } catch {}
}
if (toolId) {
  await api(`/v1/convai/tools/${toolId}`, { method: 'PATCH', body: JSON.stringify({ tool_config: TOOL }) });
  console.log(`Herramienta actualizada: ${TOOL.name} (${toolId})`);
} else {
  const created = await api('/v1/convai/tools', { method: 'POST', body: JSON.stringify({ tool_config: TOOL }) });
  toolId = created.id;
  console.log(`Herramienta creada: ${TOOL.name} (${toolId})`);
}

// 2) Agente: asignar la herramienta y actualizar las instrucciones.
await api(`/v1/convai/agents/${AGENT_ID}`, {
  method: 'PATCH',
  body: JSON.stringify({ conversation_config: { agent: { prompt: { prompt: PROMPT, tool_ids: [...new Set([...currentIds, toolId])] } } } }),
});
const after = await api(`/v1/convai/agents/${AGENT_ID}`);
const ids = after.conversation_config?.agent?.prompt?.tool_ids || [];
console.log(`Agente ${AGENT_ID}: herramientas ${ids.includes(toolId) ? 'OK' : 'FALTA'} · instrucciones ${after.conversation_config?.agent?.prompt?.prompt?.includes('buscar_opciones') ? 'OK' : 'NO ACTUALIZADAS'}`);
