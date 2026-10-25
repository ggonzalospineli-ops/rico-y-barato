import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isArgentineVoice, rankFemaleVoices } from './engine/voice.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = +(process.env.PORT || 4173);
const HOST = '127.0.0.1';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const PREFERRED_VOICE = process.env.ELEVENLABS_VOICE_ID || '';
const API = 'https://api.elevenlabs.io';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000) throw new Error('La solicitud es demasiado grande');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function eleven(path, options = {}) {
  if (!ELEVEN_KEY) throw new Error('Falta ELEVENLABS_API_KEY');
  return fetch(`${API}${path}`, { ...options, headers: { 'xi-api-key': ELEVEN_KEY, ...(options.headers || {}) } });
}

function publicVoice(v) {
  return { id: v.voice_id, name: v.name, labels: v.labels || {}, category: v.category || '' };
}

async function api(req, res, url) {
  if (url.pathname === '/api/voice/status') {
    return json(res, 200, { configured: !!ELEVEN_KEY, preferredVoiceId: PREFERRED_VOICE });
  }
  if (!ELEVEN_KEY) return json(res, 503, { error: 'ElevenLabs no está configurado en el servidor.' });

  if (url.pathname === '/api/voice/voices' && req.method === 'GET') {
    const upstream = await eleven('/v2/voices?page_size=100&gender=female');
    if (!upstream.ok) return json(res, upstream.status, { error: 'No se pudieron consultar las voces de ElevenLabs.' });
    const data = await upstream.json();
    const voices = rankFemaleVoices(data.voices || [], PREFERRED_VOICE).map(publicVoice);
    return json(res, 200, {
      preferredVoiceId: PREFERRED_VOICE,
      argentineAvailable: voices.some(isArgentineVoice),
      voices,
    });
  }

  if (url.pathname === '/api/voice/speak' && req.method === 'POST') {
    const { text, voiceId } = await bodyJson(req);
    const clean = String(text || '').trim().slice(0, 800);
    const voice = String(voiceId || PREFERRED_VOICE).trim();
    if (!clean) return json(res, 400, { error: 'Falta el texto.' });
    if (!voice) return json(res, 400, { error: 'Elegí una voz de ElevenLabs.' });
    const upstream = await eleven(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: .44, similarity_boost: .78, style: .32, use_speaker_boost: true, speed: .98 },
      }),
    });
    if (!upstream.ok) {
      let detail = '';
      try { detail = (await upstream.json()).detail?.message || ''; } catch {}
      return json(res, upstream.status, { error: detail || 'ElevenLabs no pudo generar la voz.' });
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
    return res.end(audio);
  }
  return json(res, 404, { error: 'API no encontrada.' });
}

async function staticFile(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^[/\\]+/, '');
  const file = normalize(join(ROOT, requested));
  if (!file.startsWith(normalize(ROOT))) return json(res, 403, { error: 'Ruta inválida.' });
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { json(res, 404, { error: 'Archivo no encontrado.' }); }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await staticFile(res, url.pathname);
  } catch (err) { json(res, 500, { error: err.message || 'Error interno.' }); }
});

server.listen(PORT, HOST, () => {
  console.log(`Rico y Barato: http://localhost:${PORT}/ui/`);
  console.log(ELEVEN_KEY ? 'ElevenLabs: listo' : 'ElevenLabs: falta ELEVENLABS_API_KEY');
});
