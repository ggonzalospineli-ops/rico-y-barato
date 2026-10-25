// Asistente por voz: botón rojo flotante abajo a la derecha. Se habla (o escribe), la app ajusta los
// filtros, calcula opciones reales con el motor y la IA contesta en voz alta sobre ESAS opciones.
// Manos libres: cuando termina de hablar vuelve a escuchar, hasta que se toque el micrófono o se cierre.
// Sin IA corriendo, contesta igual con un resumen armado localmente.
//
// La app le pasa lo que necesita en mountAssistant(ctx) para no depender de su estado interno.

import { hasAI, aiLabel, activeProvider, chatReply, interpretWithAI } from './ai.js';
import { isArgentineVoice, isFemaleVoice, voiceScore } from '../engine/voice.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_KEY = 'ryb:assistant-voice';
const ELEVEN_VOICE_KEY = 'ryb:elevenlabs-voice';
const ASSISTANT_NAME = 'Mila';

const voiceStore = {
  get: () => { try { return localStorage.getItem(VOICE_KEY) || ''; } catch { return ''; } },
  set: value => { try { value ? localStorage.setItem(VOICE_KEY, value) : localStorage.removeItem(VOICE_KEY); } catch {} },
};
const elevenStore = {
  get: () => { try { return localStorage.getItem(ELEVEN_VOICE_KEY) || ''; } catch { return ''; } },
  set: value => { try { value ? localStorage.setItem(ELEVEN_VOICE_KEY, value) : localStorage.removeItem(ELEVEN_VOICE_KEY); } catch {} },
};

const elevenLabel = v => {
  const labels = v.labels || {};
  const accent = labels.accent || labels.locale || labels.language || '';
  return `${v.name}${accent ? ` · ${accent}` : ''}`;
};

function spanishVoices() {
  if (!('speechSynthesis' in window)) return [];
  const spanish = speechSynthesis.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('es'));
  const female = spanish.filter(isFemaleVoice);
  return (female.length ? female : spanish.filter(v => !/raul|jorge|diego|pablo|andres|andrés|male|hombre/i.test(v.name)))
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

const voiceLabel = v => `${v.name.replace(/Microsoft |Google /g, '')} · ${v.lang}`
  + ((v.lang || '').toLowerCase() === 'es-ar' ? ' · argentina' : ' · respaldo latino');

function selectedVoice(name = voiceStore.get()) {
  const voices = spanishVoices();
  return voices.find(v => v.name === name) || voices[0] || null;
}

export function mountAssistant(ctx) {
  const { engine, parseIntent, setFilters, getResult, describeFilters, openPlan, ars, esc, look, unitLabel, toast } = ctx;

  const state = {
    open: false,
    mode: 'idle',            // idle | listening | thinking | speaking
    handsFree: true,
    muted: false,
    voiceName: voiceStore.get(),
    elevenVoiceId: elevenStore.get(),
    eleven: { checked: false, configured: false, voices: [], preferredVoiceId: '' },
    interim: '',
    msgs: [],                // { role, text, plans?: Plan[] }
  };
  let rec = null;
  let audio = null;
  let audioUrl = '';

  // ---------- DOM ----------
  const host = document.querySelector('.app') || document.body;
  const fab = document.createElement('button');
  fab.className = 'va-fab';
  fab.setAttribute('aria-label', `Hablar con ${ASSISTANT_NAME}`);
  fab.innerHTML = micSvg();
  host.appendChild(fab);

  const panel = document.createElement('section');
  panel.className = 'va-panel';
  panel.setAttribute('aria-label', `Asistente ${ASSISTANT_NAME}`);
  host.appendChild(panel);

  detectEleven();

  fab.addEventListener('click', () => {
    if (!state.open) { openPanel(); return; }
    if (state.mode === 'listening') stopListening();
    else if (state.mode === 'speaking') { stopSpeaking(); setMode('idle'); }
    else listen();
  });

  function openPanel() {
    state.open = true;
    if (!state.msgs.length) {
      state.msgs.push({ role: 'assistant', text: hasAI()
        ? `¡Buenas! Soy Mila. Decime cuántos son, qué hambre manejan y cuánto quieren gastar. Yo hago el scouting y les salvo la cena.`
        : '¡Buenas! Soy Mila. Hoy estoy en modo simple, pero igual les salvo la cena: decime cuántos son, qué quieren comer y cuánto quieren gastar.' });
    }
    draw();
    if (SR) listen();
  }

  function closePanel() {
    state.open = false;
    stopListening();
    stopSpeaking();
    setMode('idle');
    draw();
  }

  function setMode(m) { state.mode = m; fab.dataset.mode = m; draw(); }

  function draw() {
    fab.classList.toggle('open', state.open);
    fab.dataset.mode = state.mode;
    panel.classList.toggle('open', state.open);
    if (!state.open) return;
    const status = { idle: SR ? 'Tocá el micrófono para hablar' : 'Escribí abajo (este navegador no tiene dictado)',
      listening: 'Te escucho…', thinking: 'Estoy cazando la mejor opción…', speaking: 'Te cuento… (tocá para cortar)' }[state.mode];
    const voices = spanishVoices();
    const voice = selectedVoice(state.voiceName);
    if (voice && state.voiceName !== voice.name) state.voiceName = voice.name;
    const elevenVoices = state.eleven.voices;
    const usingEleven = state.eleven.configured && elevenVoices.length > 0;
    panel.innerHTML = `
      <header class="va-head">
        <div class="va-avatar">🍟</div>
        <div><b>${ASSISTANT_NAME}</b><small>${esc(hasAI() ? `${aiLabel()} · tu cómplice foodie` : 'modo simple · igual te salvo la cena')}${usingEleven ? ' · voz ElevenLabs' : ''}</small></div>
        <button class="va-icon" data-va="mute" title="${state.muted ? 'Activar voz' : 'Silenciar voz'}">${state.muted ? '🔇' : '🔊'}</button>
        <button class="va-icon" data-va="hands" title="Manos libres" aria-pressed="${state.handsFree}">${state.handsFree ? '🔁' : '⏸️'}</button>
        <button class="va-icon" data-va="close" aria-label="Cerrar">✕</button>
      </header>
      <div class="va-log" id="va-log">
        ${state.msgs.map(m => `
          <div class="va-msg ${m.role}">
            <p>${esc(m.text)}</p>
            ${m.plans?.length ? `<div class="va-plans">${m.plans.map(p => `
              <button class="va-plan ${p.picked ? 'picked' : ''}" data-va-plan="${esc(p.id)}">
                <span class="va-e">${look(p.category).e}</span>
                <span class="va-t"><b>${esc(p.restaurant.name)}</b><small>${p.quantity} ${esc(unitLabel(p.quantity, p.unit))} · ${ars(p.total)}</small></span>
              </button>`).join('')}</div>` : ''}
          </div>`).join('')}
        ${state.interim ? `<div class="va-msg user interim"><p>${esc(state.interim)}</p></div>` : ''}
        ${state.mode === 'thinking' ? '<div class="va-msg assistant"><p class="va-dots"><i></i><i></i><i></i></p></div>' : ''}
      </div>
      <footer class="va-foot">
        ${usingEleven ? `<label class="va-voice eleven"><span>${isArgentineVoice(elevenVoices.find(v => v.id === state.elevenVoiceId)) ? 'Voz femenina argentina' : 'Voz femenina en español'}</span><select data-eleven-voice aria-label="Voz de ElevenLabs para ${ASSISTANT_NAME}">
          ${elevenVoices.map(v => `<option value="${esc(v.id)}" ${v.id === state.elevenVoiceId ? 'selected' : ''}>${esc(elevenLabel(v))}</option>`).join('')}
        </select><button type="button" data-va="preview" title="Escuchar esta voz">▶</button></label>`
        : voices.length ? `<label class="va-voice"><span>Voz femenina</span><select data-va-voice aria-label="Voz femenina de ${ASSISTANT_NAME}">
          ${voices.map(v => `<option value="${esc(v.name)}" ${v.name === state.voiceName ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('')}
        </select><button type="button" data-va="preview" title="Escuchar esta voz">▶</button></label>` : ''}
        ${state.eleven.checked && !state.eleven.configured ? '<div class="va-voice-note">Voz del navegador · activá ElevenLabs para el acento argentino real.</div>' : ''}
        <div class="va-status ${state.mode}">${status}</div>
        <form class="va-form" data-va-form>
          <input id="va-input" placeholder="O escribí acá…" autocomplete="off">
          <button class="btn red sm" type="submit">Enviar</button>
        </form>
      </footer>`;
    const log = panel.querySelector('#va-log');
    log.scrollTop = log.scrollHeight;
  }

  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-va],[data-va-plan]');
    if (!b) return;
    if (b.dataset.vaPlan) { openPlan(b.dataset.vaPlan); return; }
    const a = b.dataset.va;
    if (a === 'close') closePanel();
    if (a === 'mute') { state.muted = !state.muted; if (state.muted) stopSpeaking(); draw(); }
    if (a === 'hands') { state.handsFree = !state.handsFree; draw(); }
    if (a === 'preview') previewVoice();
  });
  panel.addEventListener('submit', e => {
    e.preventDefault();
    const input = panel.querySelector('#va-input');
    const text = input.value.trim();
    if (text) { input.value = ''; handle(text); }
  });
  panel.addEventListener('change', e => {
    if (e.target.matches('[data-eleven-voice]')) {
      state.elevenVoiceId = e.target.value;
      elevenStore.set(state.elevenVoiceId);
      previewVoice();
    } else if (e.target.matches('[data-va-voice]')) {
      state.voiceName = e.target.value;
      voiceStore.set(state.voiceName);
      previewVoice();
    }
  });

  // ---------- Voz ----------
  async function detectEleven() {
    try {
      const status = await fetch('/api/voice/status').then(r => r.ok ? r.json() : Promise.reject());
      state.eleven = { ...state.eleven, ...status, checked: true };
      if (status.configured) {
        const data = await fetch('/api/voice/voices').then(r => r.ok ? r.json() : Promise.reject());
        const voices = (data.voices || []).sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
        state.eleven.voices = voices;
        const wanted = state.elevenVoiceId || data.preferredVoiceId;
        state.elevenVoiceId = voices.find(v => v.id === wanted)?.id || voices[0]?.id || '';
        if (state.elevenVoiceId) elevenStore.set(state.elevenVoiceId);
      }
    } catch { state.eleven.checked = true; }
    if (state.open) draw();
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  }

  function listen() {
    if (!SR) { panel.querySelector('#va-input')?.focus(); return; }
    stopSpeaking();
    stopListening();
    rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      state.interim = finalText || interim;
      draw();
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed') toast('Sin permiso para el micrófono');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('No te escuché bien, probá de nuevo');
    };
    rec.onend = () => {
      rec = null;
      state.interim = '';
      if (finalText.trim()) handle(finalText.trim());
      else if (state.mode === 'listening') setMode('idle');
    };
    try { rec.start(); setMode('listening'); } catch { setMode('idle'); }
  }

  function stopListening() {
    if (rec) { try { rec.abort(); } catch {} rec = null; }
    state.interim = '';
    if (state.mode === 'listening') setMode('idle');
  }

  function speakSystem(text, then) {
    if (!('speechSynthesis' in window)) { setMode('idle'); then?.(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''));
    u.voice = selectedVoice(state.voiceName);
    u.lang = 'es-AR';
    u.rate = .98;
    u.pitch = 1.04;
    u.onend = () => { setMode('idle'); then?.(); };
    u.onerror = () => { setMode('idle'); then?.(); };
    setMode('speaking');
    speechSynthesis.speak(u);
  }

  async function speak(text, then) {
    if (state.muted) { then?.(); return; }
    stopSpeaking();
    if (state.eleven.configured && state.elevenVoiceId) {
      setMode('speaking');
      try {
        const res = await fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId: state.elevenVoiceId }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo generar la voz');
        audioUrl = URL.createObjectURL(await res.blob());
        audio = new Audio(audioUrl);
        audio.onended = () => { stopSpeaking(); setMode('idle'); then?.(); };
        audio.onerror = () => { stopSpeaking(); speakSystem(text, then); };
        await audio.play();
        return;
      } catch (err) {
        stopSpeaking();
        toast(`ElevenLabs no respondió; uso la voz del navegador`);
      }
    }
    speakSystem(text, then);
  }

  function previewVoice() {
    speak('Soy Mila. Tranqui, que de esta cena me encargo yo.');
  }

  // ---------- Conversación ----------
  async function handle(text) {
    state.msgs.push({ role: 'user', text });
    setMode('thinking');

    // 1) Filtros: intérprete local; si quedó algo sin entender y hay IA, que complete.
    const mine = parseIntent(text);
    let intent = mine;
    if (mine.unknown.length && hasAI()) {
      try {
        const ai = await interpretWithAI(text);
        const pick = k => mine[k] ?? ai[k] ?? null;
        intent = { ...mine, people: pick('people'), money: pick('money'), hunger: pick('hunger'), category: pick('category'),
          ricoWeight: pick('ricoWeight'), exclude: [...new Set([...(mine.exclude || []), ...(ai.exclude || [])])] };
      } catch {}
    }
    const changed = ['people', 'money', 'hunger', 'category', 'ricoWeight'].some(k => intent[k] != null) || intent.exclude?.length;
    if (changed) setFilters(intent);

    // 2) Opciones reales del motor con los filtros actuales.
    const plans = getResult().options.slice(0, 5);
    const ids = plans.map((p, i) => [`o${i + 1}`, p]);
    const context = {
      filters: describeFilters(),
      options: ids.map(([id, p]) => ({ id, text: `${p.restaurant.name}: ${p.lines.map(l => `${l.qty}x ${l.name}`).join(' + ')}; `
        + `${p.quantity} ${p.unit} por ${p.total} pesos (${p.unitCost} c/u); rico ${Math.round(p.scores.rico * 100)}/100, `
        + `barato ${Math.round(p.scores.barato * 100)}/100${p.restaurant.open?.label ? `; ${p.restaurant.open.label}` : ''}`
        + `${p.badges.length ? `; ${p.badges.join(', ')}` : ''}` })),
    };

    // 3) Respuesta: IA sobre esas opciones, o un resumen local.
    let reply, pickId = null, add = false;
    if (hasAI()) {
      try {
        const r = await chatReply({ history: state.msgs.slice(0, -1), message: text, context });
        reply = r.reply; pickId = r.pick; add = r.addToCart;
      } catch (err) { reply = `${localReply(plans)} (La IA no respondió: ${err.message})`; }
    } else {
      reply = localReply(plans);
      pickId = plans.length ? 'o1' : null;
      add = /\b(agregal[oa]|pedil[oa]|dale esa|esa misma)\b/i.test(text) && plans.length > 0;
    }
    const picked = ids.find(([id]) => id === pickId)?.[1] || null;
    if (add && picked) {
      if (!engine.getState().cart.some(c => c.id === picked.id)) engine.addToCart(picked);
      toast(`Agregado: ${picked.restaurant.name} · ${ars(picked.total)}`);
    }
    const shown = picked ? [picked, ...plans.filter(p => p !== picked)].slice(0, 3) : plans.slice(0, 3);
    state.msgs.push({ role: 'assistant', text: reply, plans: shown.map(p => ({ ...p, picked: p === picked })) });
    draw();
    speak(reply, () => { if (state.open && state.handsFree && SR) listen(); });
  }

  function localReply(plans) {
    if (!plans.length) return 'Con eso no encontré nada abierto que entre en la plata. Probá con más plata, menos hambre u otra comida.';
    const p = plans[0];
    return `Tengo candidata: ${p.restaurant.name}. ${p.lines.map(l => `${l.qty} ${l.name}`).join(' más ')}, `
      + `${p.quantity} ${unitLabel(p.quantity, p.unit)} por ${Math.round(p.total / 100) * 100} pesos. Banco.`
      + (plans.length > 1 ? ` Igual te dejé ${plans.length - 1} alternativas por si querés chusmear.` : '');
  }

  // Las voces del sistema cargan tarde en Chrome.
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (state.open) draw(); };
  return { open: openPanel, close: closePanel, provider: activeProvider };
}

function micSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"/></svg>`;
}
