// Interfaz de Rico y Barato. Toda la lógica de negocio vive en engine/; acá solo se dibuja.
import { createEngine } from '../engine/engine.js';
import { demoSource } from '../sources/demo.js';
import { jsonSource } from '../sources/json.js';
import { splitBill, splitMessage } from '../engine/split.js';
import { parseIntent } from '../engine/intent.js';
import { decideDeck } from '../engine/shuffle.js';
import { dailyKcal } from '../engine/nutrition.js';
import { emptyGroup, encodeGroup, decodeGroup, setPersonLines, groupTotals, mergedLines, cleanName } from '../engine/group.js';
import { mountAssistant } from './assistant.js';
import { hasKey, setKey, hasAI, aiLabel, activeProvider, detectLocal, warmLocal, localStatus, getProvider, setProvider, testAI, interpretWithAI, readTicket } from './ai.js';

// ---------- Datos y motor ----------
const real = await fetch('../data/rappi-catalog.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
const source = real ? jsonSource(async () => real) : demoSource();
const address = real?.meta?.address?.split(',')[0] || 'Tu dirección';

const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('ryb:' + k)) ?? undefined; } catch { return undefined; } },
  set: (k, v) => { try { localStorage.setItem('ryb:' + k, JSON.stringify(v)); } catch {} },
};
const engine = createEngine({ source, storage: store });
await engine.load();
const CATS = engine.categories();

// ---------- Asistente IA (ElevenLabs Conversational AI, voz es-AR) ----------
const voiceAgent = await fetch('voice-agent.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
let assistantOn = () => ui.assistant !== false && !!voiceAgent?.agentId;
const assistantEl = () => document.querySelector('#assistant-dock elevenlabs-convai, elevenlabs-convai[agent-id]');
// Estado en vivo de la app para el agente (interpolado en su prompt como {{variables}}).
function assistantState() {
  const hungerLb = { poco: 'picoteo', normal: 'hambre', mucho: 'mucha hambre', bestia: 'modo bestia' }[ui.hunger] || ui.hunger;
  const r = currentResult();
  const planTxt = p => `${p.restaurant.name}: ${p.lines.map(l => `${l.qty}× ${l.name}`).join(' + ')} · total ${ars(p.total)}${p.restaurant.deliveryFee == null ? '' : ` (envío ${deliveryText(p.restaurant)})`} · rico ${Math.round(p.scores.rico * 100)}/barato ${Math.round(p.scores.barato * 100)}`;
  // Hasta 8, un plan por local: con solo las 3 primeras el agente recomendaba siempre el mismo.
  const top = onePerPlace(r.options.length ? r.options : r.overBudget).slice(0, 8);
  return {
    hambre: hungerLb,
    plata: ui.money ? `${Math.round(ui.money).toLocaleString('es-AR')} pesos` : 'sin límite',
    categoria: ui.category === 'all' ? 'todo lo que come' : (CATS[ui.category]?.label || ui.category),
    personas: ui.people === 1 ? '1 (pide para sí)' : `${ui.people}`,
    modo: balanceHint(),
    top3: top.length ? top.map((p, i) => `${i + 1}) ${planTxt(p)}`).join(' || ') : 'No hay recomendaciones todavía con este filtro: sugerí qué cambiar (más plata, menos hambre, otra categoría) para que aparezcan.',
  };
}
function onePerPlace(plans) {
  const seen = new Set();
  const first = plans.filter(p => (seen.has(p.restaurant.id) ? false : seen.add(p.restaurant.id)));
  return [...first, ...plans.filter(p => !first.includes(p))];
}

// Herramienta de cliente "buscar_opciones" (configurada en el agente con tools/update-agent-tools.mjs):
// el agente la llama con lo que pidió la persona; se aplican los filtros en pantalla y se devuelven
// las opciones reales del motor, así nunca recomienda algo que la app no muestra.
function buscarOpciones(params = {}) {
  const cat = String(params.categoria || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const catKey = Object.keys(CATS).find(k => cat && (k.startsWith(cat.slice(0, 5)) || cat.startsWith(k.slice(0, 5))));
  if (cat && /todo|cualquier/.test(cat)) ui.category = 'all';
  else if (catKey && engine.getState().profile.enabledCategories.includes(catKey)) ui.category = catKey;
  if (+params.plata > 0) ui.money = Math.round(+params.plata);
  if (['poco', 'normal', 'mucho', 'bestia'].includes(params.hambre)) ui.hunger = params.hambre;
  if (+params.personas > 0) ui.people = Math.max(1, Math.min(12, Math.round(+params.personas)));
  const pref = { rico: 0.85, barato: 0.15, mitad: 0.5 }[String(params.preferencia || '').toLowerCase()];
  if (pref != null) ui.ricoWeight = pref;
  saveUi();
  if (ui.tab !== 'home') ui.tab = 'home';
  render();
  const r = lastResult || currentResult();
  const list = onePerPlace(r.options).slice(0, 6);
  if (!list.length) {
    const over = r.overBudget.slice(0, 2).map(p => `${p.restaurant.name} por ${p.total} pesos (se pasa por ${p.overBudgetBy})`).join('; ');
    return `No hay opciones abiertas que entren con esos filtros (${r.closed || 0} locales cerrados ahora).${over ? ` Se pasan por poco: ${over}.` : ''}`;
  }
  return `Opciones reales de la app, de mejor a peor para lo que pidió (${ui.people} persona/s, `
    + `${ui.money ? `${ui.money} pesos` : 'sin límite de plata'}, hambre ${ui.hunger}):\n`
    + list.map((p, i) => `${i + 1}) ${p.restaurant.name}: ${p.lines.map(l => `${l.qty} ${l.name}`).join(' + ')}; `
      + `${p.quantity} ${p.unit}; total ${p.total} pesos${p.restaurant.deliveryFee != null ? ' con envío' : ''}; `
      + `${p.restaurant.open?.label || ''}; rico ${Math.round(p.scores.rico * 100)}/100, barato ${Math.round(p.scores.barato * 100)}/100`
      + `${p.badges.includes('punto-dulce') ? '; punto dulce' : ''}${p.badges.includes('joya-oculta') ? '; joya oculta' : ''}`).join('\n');
}

async function mountAssistantWidget() {
  if (!voiceAgent?.agentId) return;
  // Se arma de nuevo en cada apertura: las variables se leen al empezar la charla y antes quedaban
  // congeladas en la primera apertura.
  $('#assistant-dock elevenlabs-convai')?.remove();
  const el = document.createElement('elevenlabs-convai');
  el.setAttribute('agent-id', voiceAgent.agentId);
  el.setAttribute('dynamic-variables', JSON.stringify(assistantState()));
  el.addEventListener('elevenlabs-convai:call', event => {
    event.detail.config.clientTools = { buscar_opciones: params => buscarOpciones(params) };
  });
  el.setAttribute('dismissible', 'true');
  el.setAttribute('action-text', '¿Qué comemos hoy?');
  el.setAttribute('start-call-text', 'Hablar');
  el.setAttribute('end-call-text', 'Cortar');
  el.setAttribute('expand-text', 'Asistente IA');
  el.setAttribute('avatar-orb-color-1', '#E4002B');
  el.setAttribute('avatar-orb-color-2', '#FFC72C');
  if (!document.querySelector('script[data-convai]')) {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
    s.type = 'text/javascript';
    s.async = true;
    s.dataset.convai = '';
    document.head.appendChild(s);
  }
  $('#assistant-dock').appendChild(el);
}
function mountAssistantShell() {
  if (!voiceAgent?.agentId || !document.querySelector('.app')) return;
  const fab = document.createElement('button');
  fab.id = 'assistant-fab';
  fab.className = 'assistant-fab';
  fab.innerHTML = '🤖<small>Asistente</small>';
  fab.setAttribute('data-assist-toggle', '');
  fab.setAttribute('aria-label', 'Abrir asistente IA');
  document.querySelector('.app').appendChild(fab);
  const dock = document.createElement('div');
  dock.id = 'assistant-dock';
  dock.className = 'assistant-dock';
  document.querySelector('.app').appendChild(dock);
  if (!assistantOn()) fab.classList.add('off');
}

// ---------- Estado de la interfaz (preferencias del visor, no del motor) ----------
const ui = Object.assign({
  tab: 'home', hunger: 'mucho', category: 'all', money: 20000, ricoWeight: 0.5, topTab: 'sellers', people: 1, results: 'cards',
}, store.get('ui') || {});
const saveUi = () => store.set('ui', { hunger: ui.hunger, category: ui.category, money: ui.money, ricoWeight: ui.ricoWeight, topTab: ui.topTab, people: ui.people, results: ui.results, assistant: ui.assistant, maxEta: ui.maxEta ?? null, maxKm: ui.maxKm ?? null, fitness: !!ui.fitness, maxKcal: ui.maxKcal ?? null, bodyWeight: ui.bodyWeight ?? null, goal: ui.goal || 'mantener' });

const LOOK = {
  nuggets:     { e: '🍗', bg: 'linear-gradient(135deg,#FFE08A,#FF9F1C)' },
  sushi:       { e: '🍣', bg: 'linear-gradient(135deg,#FFC2B4,#FF5E5B)' },
  hamburguesa: { e: '🍔', bg: 'linear-gradient(135deg,#FFD45C,#FF7A00)' },
  empanadas:   { e: '🥟', bg: 'linear-gradient(135deg,#FBE3B0,#E39B3B)' },
  pizza:       { e: '🍕', bg: 'linear-gradient(135deg,#FFB27A,#E4002B)' },
  milanesa:    { e: '🥩', bg: 'linear-gradient(135deg,#F9CF8E,#C8642E)' },
  pollo:       { e: '🐔', bg: 'linear-gradient(135deg,#FFE6A6,#F29C1F)' },
  pasta:       { e: '🍝', bg: 'linear-gradient(135deg,#FFEFB8,#F4B400)' },
  tacos:       { e: '🌮', bg: 'linear-gradient(135deg,#FFE078,#F28C28)' },
  wraps:       { e: '🌯', bg: 'linear-gradient(135deg,#F5D7A1,#C97B32)' },
  carnes:      { e: '🥩', bg: 'linear-gradient(135deg,#E8A078,#9E2A2B)' },
  ensaladas:   { e: '🥗', bg: 'linear-gradient(135deg,#CDEB8B,#54A96B)' },
  sandwiches:  { e: '🥪', bg: 'linear-gradient(135deg,#FFE2A8,#D98A3A)' },
  tartas:      { e: '🥧', bg: 'linear-gradient(135deg,#F6D7A7,#BE7A42)' },
  wok:         { e: '🍜', bg: 'linear-gradient(135deg,#FFD29B,#E76F51)' },
  otro:        { e: '🍽️', bg: 'linear-gradient(135deg,#F1ECE4,#CFC6BA)' },
};
const HUNGER_EMOJI = { poco: '🤏', normal: '🙂', mucho: '😋', bestia: '🦖' };
const BADGES = {
  'punto-dulce':       ['⚡ Punto dulce', 'sweet'],
  'joya-oculta':       ['💎 Joya oculta', 'dark'],
  'franquicia-barata': ['🏷️ Franquicia barata', ''],
  'mas-vendido':       ['🔥 De lo más pedido', 'red'],
  'descuento':         ['% Descuento', 'green'],
  'favorito':          ['❤️ Favorito', 'dark'],
  'aprobado-morfy':    ['✅ Aprobado en Morfy', 'green'],
  'popular-google':    ['🔎 Popular en Google', ''],
  'opiniones-divididas': ['⚠️ Opiniones divididas', 'warn'],
  'bajo-precio':       ['📉 Bajó de precio', 'green'],
  'tachado-inflado':   ['⚠️ Tachado inflado', 'warn'],
  'mas-barato-en-otra': ['💸 Más barato en otra app', 'warn'],
  'no-te-gusto':       ['👎 No te gustó', 'warn'],
  'cierra-pronto':     ['🕐 Cierra pronto', 'warn'],
};
const EXCLUDABLE = { cerdo: '🐷 Cerdo', lacteos: '🧀 Lácteos', pescado: '🐟 Pescado', frito: '🍟 Frito', picante: '🌶️ Picante' };

// ---------- Utilidades ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars = n => (Number.isFinite(n) ? fmt.format(n) : 'sin tope');
const itemPrice = item => item.price > 0 ? ars(item.price) : 'Consultar precio';
const look = cat => LOOK[cat] || LOOK.otro;
const catOfItem = it => Object.keys(it.yields || {})[0] || 'otro';
// El score de la página del local viene con cantidad de reseñas; el del listado, no.
// Un local sin reseñas en Rappi trae score 0: eso es "sin datos", no "cero estrellas".
const stars = r => {
  const v = (r.rappiReviews ? r.rappiScore : null) ?? r.googleRating ?? (r.rappiReviews == null ? r.rappiRating : null);
  return v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-AR'); // Rappi a veces manda 4.48165
};
const reviewsTxt = r => (r.rappiReviews ? `<small>(${r.rappiReviews})</small>` : '');

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7 4.5c2.1 0 3.5 1.2 5 3 1.5-1.8 2.9-3 5-3 3.4 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  bag: '<path d="M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM9 8V6a3 3 0 0 1 6 0v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.querySelector('.app').appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// La foto va encima de la ilustración: si falla o llega chica (ver listener de 'load'), se saca
// y queda la ilustración. Nunca se muestra una foto que no sea la del producto.
const MIN_PHOTO_WIDTH = 400;
const photo = (url, min = MIN_PHOTO_WIDTH) => (url ? `<img class="photo" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-min="${min}">` : '');
function coverHtml({ category, imageUrl }) {
  return `<span class="art">${look(category).e}</span>${photo(imageUrl)}`;
}
const coverStyle = cat => `style="background:${look(cat).bg}"`;
// Portada grande de las hojas: la foto en más resolución y entera, sobre la misma foto desenfocada
// (así una foto apaisada no se recorta ni se estira en la columna alta del modal de escritorio).
const bigImage = url => url && url.replace(/d=\d+x\d+/, 'd=1400x1400');
function sheetCoverHtml(category, url) {
  if (!url) return `<span class="art">${look(category).e}</span>`;
  // Mínimo 320 px: la portada muestra la foto entera sobre la misma foto desenfocada, así que una de ~500
  // se ve bien. Con 500 se descartaban fotos de 491 px que en las tarjetas sí aparecían.
  return `<span class="art">${look(category).e}</span><span class="backdrop" style="background-image:url('${esc(bigImage(url))}')"></span>${photo(bigImage(url), 320)}`;
}
const thumb = (cat, imageUrl, cls = '') => `<div class="thumb ${cls}" ${coverStyle(cat)}><span>${look(cat).e}</span>${photo(imageUrl)}</div>`;
const logoThumb = (rest, cat) => `<div class="thumb logo" ${coverStyle(cat)}><span>${look(cat).e}</span>${photo(rest.logoUrl, 120)}</div>`;
const deliveryText = r => [r.deliveryFee != null ? (r.deliveryFee ? `🛵 ${ars(r.deliveryFee)}` : '🛵 Gratis') : null, r.etaMin ? `${r.etaMin} min` : null].filter(Boolean).join(' · ');
const sourceHtml = item => {
  if (!item.source) return '';
  const label = item.officialSource ? '✓ Menú oficial' : item.source;
  const title = [item.sourceValidity, item.sourceScope].filter(Boolean).join(' · ');
  const sourceUrl = /^https?:\/\//i.test(item.sourceUrl || '') ? item.sourceUrl : null;
  return sourceUrl
    ? `<a class="source-chip ${item.officialSource ? 'official' : ''}" href="${esc(sourceUrl)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(label)} ${icon('out')}</a>`
    : `<span class="source-chip ${item.officialSource ? 'official' : ''}" title="${esc(title)}">${esc(label)}</span>`;
};

document.addEventListener('load', e => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.classList.contains('photo')) {
    if (img.naturalWidth < +img.dataset.min) img.remove(); else img.classList.add('ok');
  }
}, true);
document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.classList.contains('photo')) e.target.remove(); }, true);

const planImage = p => p.lines.find(l => l.imageUrl)?.imageUrl || null;
const planOriginal = p => p.lines.reduce((s, l) => s + (l.originalPrice || l.price) * l.qty, 0) + (p.deliveryFee || 0);
const planIsFav = p => p.lines.some(l => engine.getState().favorites.includes(l.itemId));
const inCart = id => engine.getState().cart.some(c => c.id === id);
const unitLabel = (n, unit) => (n === 1 ? unit.replace(/es$|s$/, '') : unit);

// ---------- Recomendaciones (cacheadas por render) ----------
let lastResult = null;
// Se muestran de a 20; "Ver más" suma otras 20. Si cambia cualquier filtro, vuelve a 20.
const PAGE = 20;
let shown = { key: '', n: PAGE };
function shownLimit() {
  const key = JSON.stringify([ui.hunger, ui.money, ui.category, ui.ricoWeight, ui.people, ui.tempExclude, ui.showClosed, ui.when, ui.maxEta, ui.maxKm, ui.fitness, ui.maxKcal]);
  if (key !== shown.key) shown = { key, n: PAGE };
  return shown.n;
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-more]')) return;
  shown.n += PAGE;
  renderResults();
});
function currentResult() {
  lastResult = engine.recommend({
    hunger: ui.hunger,
    money: ui.money ?? Infinity,
    categories: ui.category === 'all' ? undefined : [ui.category],
    ricoWeight: ui.ricoWeight,
    people: ui.people,
    exclude: ui.tempExclude || [],
    openOnly: !ui.showClosed,
    at: whenAt(),
    maxEta: ui.maxEta ?? null,
    maxKm: ui.maxKm ?? null,
    fitness: !!ui.fitness,
    maxKcal: ui.fitness ? ui.maxKcal ?? null : null,
    limit: shownLimit(),
    map: true,
  });
  return lastResult;
}

// "Pedir para más tarde": ui.when es una hora (0-23) o null = ahora. Si esa hora ya pasó hoy, es mañana.
function whenAt() {
  if (ui.when == null) return null;
  const d = new Date();
  d.setHours(ui.when, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function whenLabel() {
  const at = whenAt();
  if (at == null) return 'ahora';
  const tomorrow = new Date(at).getDate() !== new Date().getDate();
  return `${tomorrow ? 'mañana ' : 'hoy '}a las ${String(ui.when).padStart(2, '0')}:00`;
}
function whenControlsHtml() {
  const presets = [[null, 'Ahora'], [13, '🍽️ Almuerzo 13 hs'], [17, '☕ Merienda 17 hs'], [21, '🌙 Cena 21 hs']];
  const isPreset = presets.some(([h]) => h === (ui.when ?? null));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return `
      <div class="divider"></div>
      <div class="filter-row"><span class="filter-label">¿Cuándo?</span>
        <div class="quick">${presets.map(([h, lb]) => `<button class="${(ui.when ?? null) === h ? 'on' : ''}" data-when="${h ?? ''}">${lb}</button>`).join('')}
          <select id="when-other" class="when-other ${isPreset ? '' : 'on'}" aria-label="Otra hora">
            <option value="">Otra hora…</option>
            ${hours.map(h => `<option value="${h}" ${!isPreset && ui.when === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="filter-row"><span class="filter-label">Que llegue en</span>
        <div class="quick">${[[null, 'Cualquiera'], [30, 'hasta 30 min'], [45, 'hasta 45 min']].map(([m, lb]) => `<button class="${(ui.maxEta ?? null) === m ? 'on' : ''}" data-eta="${m ?? ''}">${lb}</button>`).join('')}</div>
      </div>
      <div class="filter-row"><span class="filter-label">Distancia</span>
        <div class="quick">${[[null, 'Cualquiera'], [1, 'hasta 1 km'], [2, 'hasta 2 km'], [3, 'hasta 3 km']].map(([k, lb]) => `<button class="${(ui.maxKm ?? null) === k ? 'on' : ''}" data-km="${k ?? ''}">${lb}</button>`).join('')}</div>
      </div>`;
}
const findPlan = id => lastResult?.options.find(p => p.id === id) || lastResult?.all?.find(p => p.id === id) || favPlans.find(p => p.id === id) || lastResult?.overBudget.find(p => p.id === id)
  || engine.getState().cart.find(p => p.id === id) || itemPlans.get(id);
const itemPlans = new Map(); // planes de un producto elegido desde el menú completo

// ---------- Vistas ----------
function render() {
  if (ui.tab !== 'home') askExample.tab = ui.tab; // así al volver a Inicio cambia la frase de ejemplo
  const views = { home: viewHome, top: viewTop, taste: viewTaste, cart: viewCart, settings: viewSettings };
  $('#view').innerHTML = views[ui.tab]();
  $('#view').classList.remove('view'); void $('#view').offsetWidth; $('#view').classList.add('view');
  renderTabbar();
  if (ui.tab === 'home') renderResults();
}

function renderTabbar() {
  const cartCount = engine.getState().cart.length;
  const tabs = [['home', 'home', 'Inicio'], ['top', 'trophy', 'Top'], ['taste', 'heart', 'Mi gusto'], ['cart', 'bag', 'Pedidos'], ['settings', 'gear', 'Ajustes']];
  const s = engine.budgetSummary();
  // Marca y resumen de gasto: solo se ven en desktop, donde la tabbar pasa a ser una barra lateral.
  $('#tabbar').innerHTML = `
    <div class="side-brand"><span class="logo-mark">🍔</span><div><b>Rico</b><b class="y">y Barato</b></div></div>
    <div class="side-nav">${tabs.map(([id, ic, label]) => `
      <button class="tab ${ui.tab === id ? 'on' : ''}" data-tab="${id}">
        ${icon(ic)}<span>${label}</span>${id === 'cart' && cartCount ? `<span class="dot">${cartCount}</span>` : ''}
      </button>`).join('')}</div>
    <button class="kbd-hint" data-palette><kbd>Ctrl</kbd><kbd>K</kbd> Comandos y atajos</button>
    <div class="side-budget">
      <small>Este mes</small>
      <b>${ars(s.spent)}</b>
      <span>${s.monthly ? `de ${ars(s.monthly)} · te quedan ${ars(s.remaining)}` : 'gastados · sin tope'}</span>
      ${s.planned ? `<span class="planned">${ars(s.planned)} por gastar</span>` : ''}
      ${s.monthly ? `<i><em style="width:${Math.min(100, (s.spent / s.monthly) * 100)}%"></em></i>` : ''}
    </div>
    <p class="side-foot">📍 ${esc(address)}</p>`;
}

function heroHtml() {
  const s = engine.budgetSummary();
  if (!s.monthly) {
    return `<section class="hero">
      <span class="hero-tag">${icon('coin')} Este mes</span>
      <div class="hero-amount">${ars(s.spent)} <small>gastados</small></div>
      <div class="hero-sub">${s.planned ? `${ars(s.planned)} en el carrito por gastar` : 'Poné un tope y te aviso cuánto te queda.'}</div>
      ${forecast(s).text ? `<div class="hero-forecast">📈 ${forecast(s).text}</div>` : ''}
      <button class="hero-cta" data-tab="settings">Poner tope mensual →</button>
      <div class="hero-emoji">💸</div>
    </section>`;
  }
  const spentPct = Math.min(100, (s.spent / s.monthly) * 100);
  const planPct = Math.min(100 - spentPct, (s.planned / s.monthly) * 100);
  const f = forecast(s);
  return `<section class="hero">
    <span class="hero-tag">${icon('coin')} Te quedan este mes</span>
    <div class="hero-amount">${ars(s.remaining)}</div>
    <div class="hero-sub">Gastaste ${ars(s.spent)} de ${ars(s.monthly)}${s.planned ? ` · ${ars(s.planned)} por gastar` : ''}</div>
    <div class="hero-bar"><span style="width:${spentPct}%"></span><span class="planned" style="left:${spentPct}%;width:${planPct}%"></span>
      <span class="pace" style="left:${f.todayPct}%" title="Hoy"></span></div>
    ${f.text ? `<div class="hero-forecast ${f.over ? 'warn' : ''}">📈 ${f.text}</div>` : ''}
    <div class="hero-emoji">${spentPct > 85 ? '😬' : '🍔'}</div>
  </section>`;
}

function viewHome() {
  const cats = Object.entries(CATS).filter(([k]) => engine.getState().profile.enabledCategories.includes(k));
  const hungerSub = h => { if (ui.category === 'all') return ''; const n = engine.targetFor(ui.category, h) * ui.people; return `${n} ${unitLabel(n, CATS[ui.category].unit)}`; };
  const quick = [10000, 15000, 20000, 30000, null];
  return `
    <div class="home-head">
    <header class="topbar">
      <h1 class="desk-title"><small>Entregar en ${esc(address)}</small>¿Qué comemos hoy?</h1>
      <div class="loc">
        <div class="loc-pin">${icon('pin')}</div>
        <div><small>Entregar en</small><strong>${esc(address)}</strong></div>
      </div>
      <button class="icon-btn" data-tab="cart" aria-label="Pedidos">${icon('bag')}${engine.getState().cart.length ? `<span class="dot">${engine.getState().cart.length}</span>` : ''}</button>
    </header>

    <div class="search">
      ${icon('search')}
      <input id="search" type="search" placeholder="Buscá un local de tu zona…" autocomplete="off">
      <button class="go" data-tab="settings" aria-label="Ajustes">${icon('sliders')}</button>
      <div id="search-results"></div>
    </div>
    </div>

    ${askBarHtml()}
    <div id="rate-wrap"></div>
    <div class="home-grid"><aside class="home-controls">
    ${heroHtml()}

    <section class="section">
      <div class="section-head"><h2>¿Cuánta hambre hay?</h2><span>${ui.category === 'all' ? 'según tu apetito' : CATS[ui.category].label}</span></div>
      <div class="hunger">
        ${Object.entries(engine.hungerLevels()).map(([k, label]) => `
          <button class="${ui.hunger === k ? 'on' : ''}" data-hunger="${k}">
            <span class="e">${HUNGER_EMOJI[k]}</span><b>${label}</b><small>${hungerSub(k)}</small>
          </button>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>¿Qué pinta?</h2><button data-tab="settings">Editar</button></div>
      <div class="chips">
        <button class="chip ${ui.category === 'all' ? 'on' : ''}" data-cat="all">🍽️ Todo</button>
        ${cats.map(([k, c]) => `<button class="chip ${ui.category === k ? 'on' : ''}" data-cat="${k}">${look(k).e} ${c.label}</button>`).join('')}
      </div>
    </section>

    <section class="section panel">
      <div class="money">
        <label for="money">Tengo</label>
        <div class="money-input"><span>$</span><input id="money" inputmode="numeric" value="${ui.money ? ui.money.toLocaleString('es-AR') : ''}" placeholder="sin límite"></div>
      </div>
      <div class="quick">
        ${quick.map(q => `<button class="${ui.money === q ? 'on' : ''}" data-money="${q ?? ''}">${q ? ars(q) : 'Sin límite'}</button>`).join('')}
      </div>
      <div class="divider"></div>
      <div class="people">
        <div class="people-txt"><b>Somos ${ui.people}</b><small>${ui.people === 1 ? 'pido para mí' : `cada uno con tu apetito${ui.money ? ` · ${ars(Math.round(ui.money / ui.people))} c/u` : ''}`}</small></div>
        <div class="people-faces">${'🧑'.repeat(Math.min(ui.people, 5))}${ui.people > 5 ? `<em>+${ui.people - 5}</em>` : ''}</div>
        <div class="stepper"><div><button data-people="-1" aria-label="Menos gente">−</button><span>${ui.people}</span><button data-people="1" aria-label="Más gente">+</button></div></div>
      </div>
      <div class="divider"></div>
      <div class="balance-labels"><span>💸 Barato</span><span>Rico 😋</span></div>
      <input id="balance" class="balance" type="range" min="0" max="1" step="0.05" value="${ui.ricoWeight}" aria-label="Barato o rico">
      <div class="balance-hint" id="balance-hint">${balanceHint()}</div>
      ${whenControlsHtml()}
    </section>

    </aside><div class="home-results">
    <section class="section" id="fav-wrap"></section>
    <section class="section" id="drops-wrap"></section>
    <section class="section results-head">
      <div class="results-bar">
        <div><h2 id="results-title">Para vos ${whenLabel()}</h2><span id="result-count"></span></div>
        <div class="results-actions">
          <div class="seg mini-seg">
            <button class="${ui.results === 'cards' ? 'on' : ''}" data-results="cards">▦ Tarjetas</button>
            <button class="${ui.results === 'map' ? 'on' : ''}" data-results="map">⚡ Mapa</button>
          </div>
          <button class="btn ghost fit-btn ${ui.fitness ? 'on' : ''}" data-fitness aria-pressed="${!!ui.fitness}">💪 Fitness</button>
          <button class="btn red decide-btn" data-decide>🎰 Decidí por mí</button>
        </div>
      </div>
      ${ui.fitness ? fitnessBarHtml() : ''}
      <div id="closed-note"></div>
      <div id="map-wrap"></div>
      <div class="cards" id="results"></div>
    </section>

    <section class="section" id="over-wrap"></section>
    </div></div>
  `;
}

function balanceHint() {
  const w = ui.ricoWeight;
  return w <= 0.15 ? 'Lo más barato posible, punto.' : w < 0.45 ? 'Barato, pero que esté bueno.'
    : w <= 0.55 ? 'Mitad y mitad.' : w < 0.85 ? 'Rico, sin regalar la plata.' : 'Lo más rico, cueste lo que cueste.';
}

function renderResults() {
  const r = currentResult();
  const box = $('#results');
  if (!box) return;
  $('#result-count').textContent = r.options.length
    ? `${r.total > r.options.length ? `${r.options.length} de ${r.total}` : r.total} opciones${r.people > 1 ? ` · para ${r.people}` : ''}` : '';
  $('#map-wrap').innerHTML = ui.results === 'map' && r.all.length ? mapHtml(r) : '';
  box.classList.toggle('below-map', ui.results === 'map');
  const more = r.total - r.options.length;
  box.innerHTML = r.options.length ? r.options.map(planCard).join('')
    + (more > 0 ? `<button class="btn ghost block more-results" data-more>Ver ${Math.min(more, PAGE)} más (quedan ${more})</button>` : '') : `
    <div class="empty-state"><div class="e">🥲</div><h3>Con esa plata no llego</h3>
    <p>Probá con menos hambre, otra comida o subí el monto.${r.overBudget.length ? ' Abajo te muestro lo que se pasa por poco.' : ''}</p></div>`;
  renderFavRail(r);
  renderExtras(r);
  const over = r.overBudget.slice(0, 5);
  $('#over-wrap').innerHTML = over.length ? `
    <div class="section-head"><h2>Con un poco más…</h2><span>se pasan por poco</span></div>
    <div class="rail">${over.map(p => `
      <div class="mini" data-plan="${esc(p.id)}">
        <div class="cover" ${coverStyle(p.category)}>${coverHtml({ category: p.category, imageUrl: planImage(p) })}</div>
        <h4>${esc(p.restaurant.name)}</h4>
        <p>${p.quantity} ${unitLabel(p.quantity, p.unit)} · ${ars(p.total)}</p>
        <p class="over">+${ars(p.overBudgetBy)}</p>
      </div>`).join('')}</div>` : '';
}

function planCard(p) {
  const orig = planOriginal(p);
  const added = inCart(p.id);
  const fav = planIsFav(p);
  return `
  <article class="card ${p.badges.includes('punto-dulce') ? 'is-sweet' : ''}" data-plan="${esc(p.id)}">
    <div class="cover" ${coverStyle(p.category)}>
      ${coverHtml({ category: p.category, imageUrl: planImage(p), multi: p.lines.reduce((s, l) => s + l.qty, 0) > 2 })}
      <span class="qty">${look(p.category).e} ${p.quantity} ${unitLabel(p.quantity, p.unit)}${variantLabel(p.variant)}</span>
      <button class="fav ${fav ? 'on' : ''}" data-fav-plan="${esc(p.id)}" aria-label="Favorito">${icon('heart', fav ? 'fill' : '')}</button>
      <div class="badges">${p.badges.filter(b => b !== 'favorito').slice(0, 2).map(b => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join('')}</div>
    </div>
    <div class="card-body">
      <div class="card-row">
        <h3 class="card-title">${esc(p.restaurant.name)}</h3>
        <span class="rating">${icon('star', 'fill')} ${stars(p.restaurant)} ${reviewsTxt(p.restaurant)}</span>
      </div>
      <p class="card-lines">${p.lines.map(l => `${l.qty}× ${esc(l.name)}`).join(' + ')}</p>
      ${ui.fitness ? cardNutritionHtml(p) : ''}
      ${plateHtml(p)}
      <div class="meter">
        <div><small><span>Rico</span><span>${Math.round(p.scores.rico * 100)}</span></small><i><b style="width:${p.scores.rico * 100}%;background:var(--red)"></b></i></div>
        <div><small><span>Barato</span><span>${Math.round(p.scores.barato * 100)}</span></small><i><b style="width:${p.scores.barato * 100}%;background:var(--yellow-deep)"></b></i></div>
      </div>
      <div class="card-foot">
        <div>
          <div class="price">${ars(p.total)}${orig > p.total ? `<s>${ars(orig)}</s>` : ''}</div>
          <div class="per">${ars(p.unitCost)} c/u · ${p.restaurant.deliveryFee == null ? '+ envío' : deliveryText(p.restaurant)}${p.restaurant.distanceKm != null ? ` · 📍 ${km(p.restaurant.distanceKm)}` : ''}</div>
        </div>
        <button class="add ${added ? 'done' : ''}" data-add="${esc(p.id)}" aria-label="Agregar al pedido">${icon(added ? 'check' : 'plus')}</button>
      </div>
    </div>
  </article>`;
}

function viewTop() {
  const r = engine.rankings({ limit: 2000 });
  const tabs = [['sellers', '🔥 Más pedidos'], ['rated', '⭐ Puntuados'], ['gems', '💎 Joyas'], ['drops', '📉 Bajas']];
  // Solo lo que el usuario come (y en la categoría elegida en Inicio, si hay una).
  const enabled = engine.getState().profile.enabledCategories;
  const wanted = it => Object.keys(it.yields).some(c => enabled.includes(c) && (ui.category === 'all' || c === ui.category));
  let body;
  if (ui.topTab === 'drops') {
    body = dropsListHtml();
  } else if (ui.topTab === 'sellers') {
    body = r.bestSellers.filter(wanted).slice(0, 30).map((it, i) => itemRow(it, i + 1)).join('');
  } else {
    const list = (ui.topTab === 'rated' ? r.topRated : r.hiddenGems).slice(0, 30);
    body = list.length ? list.map((rest, i) => `
      <div class="row click" data-rest="${esc(rest.id)}">
        <span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
        ${logoThumb(rest, 'otro')}
        <div class="row-main">
          <h4>${esc(rest.name)}</h4>
          <p>${rest.chain ? 'Cadena' : 'Local'}${rest.rappiReviews ? ` · ${rest.rappiReviews} reseñas` : ''}${deliveryText(rest) ? ` · ${deliveryText(rest)}` : ''}</p>
        </div>
        <span class="score">⭐ ${stars(rest)}</span>
      </div>`).join('') : `<div class="empty-state"><div class="e">💎</div><h3>Todavía no hay joyas</h3>
        <p>Una joya oculta es un local de barrio (no cadena), muy bien puntuado en Rappi y todavía con pocas reseñas. Todavía no encontré ninguna en tu zona.</p></div>`;
  }
  return `
    <div class="page-title"><h1>Lo mejor de tu zona</h1></div>
    <div class="seg">${tabs.map(([k, l]) => `<button class="${ui.topTab === k ? 'on' : ''}" data-toptab="${k}">${l}</button>`).join('')}</div>
    <div class="list">${body}</div>
    ${ui.topTab === 'gems' ? offRappiHtml() : ''}
    ${ui.topTab === 'sellers' ? `<p class="note">"Más pedidos" sale de la sección Populares de cada local en Rappi: lo más pedido de cada local${ui.category === 'all' ? ' entre lo que comés' : ` en ${CATS[ui.category].label}`}, ordenado por el puntaje del local.</p>` : ''}`;
}

function itemRow(it, rank) {
  const fav = it.favorite;
  return `
    <div class="row">
      ${rank ? `<span class="rank ${rank <= 3 ? 'top' : ''}">${rank}</span>` : ''}
      ${thumb(catOfItem(it), it.imageUrl)}
      <div class="row-main click" data-rest="${esc(it.restaurant.id)}">
        <h4>${esc(it.name)}</h4>
        <p>${esc(it.restaurant.name)} · ⭐ ${stars(it.restaurant)}</p>
        <div class="price">${ars(it.price)}${it.originalPrice ? `<s>${ars(it.originalPrice)}</s>` : ''}</div>
      </div>
      <button class="heart ${fav ? 'on' : ''}" data-fav="${esc(it.id)}" aria-label="Favorito">${icon('heart', fav ? 'fill' : '')}</button>
    </div>`;
}

function viewTaste() {
  const t = engine.tasteProfile();
  const favs = engine.getState().favorites.map(id => engine.item(id)).filter(Boolean);
  return `
    <div class="page-title"><h1>Mi gusto</h1></div>
    <section class="taste">
      <span class="tag">${icon('sparkle')} Análisis de tus favoritos</span>
      <h3>${esc(t.headline)}</h3>
      ${t.insights.length ? `<ul>${t.insights.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${t.suggestedRicoWeight != null && Math.abs(t.suggestedRicoWeight - ui.ricoWeight) > 0.05
        ? `<button class="btn primary sm" data-suggest="${t.suggestedRicoWeight}">Ajustar Rico/Barato a mi gusto</button>` : ''}
    </section>
    <section class="section">
      <div class="section-head"><h2>Favoritos</h2><span>${favs.length}</span></div>
      <div class="list">${favs.length ? favs.map(it => itemRow(it)).join('') : `
        <div class="empty-state"><div class="e">❤️</div><h3>Marcá lo que te gusta</h3>
        <p>Tocá el corazón en cualquier plato, o buscá un local y elegí lo que te gusta de su menú. Con eso aprendo qué te gusta.</p></div>`}</div>
    </section>`;
}

function viewCart() {
  const st = engine.getState();
  const s = engine.budgetSummary();
  return `
    <div class="page-title"><h1>Pedidos</h1></div>
    ${cartToolsHtml()}
    ${st.cart.length ? `<div class="list">${st.cart.map(p => `
      <div class="cart-item">
        ${thumb(p.category, planImage(p))}
        <div class="row-main">
          <h4>${esc(p.restaurant.name)}</h4>
          <p>${p.quantity} ${unitLabel(p.quantity, p.unit)} · ${p.lines.map(l => `${l.qty}× ${esc(l.name)}`).join(' + ')}</p>
          <div class="price">${ars(p.total)}</div>
          <div class="cart-actions">
            <a class="btn red sm" href="${esc(p.orderUrl)}" target="_blank" rel="noopener">Pedir en Rappi ${icon('out')}</a>
            <button class="btn primary sm" data-confirm="${esc(p.id)}">${icon('check')} Ya lo pedí</button>
            <button class="btn ghost sm" data-split="${esc(p.id)}" aria-label="Dividir la cuenta">➗</button>
            <button class="btn ghost sm" data-remove="${esc(p.id)}" aria-label="Quitar">${icon('x')}</button>
          </div>
        </div>
      </div>`).join('')}</div>` : `
      <div class="empty-state"><div class="e">🛍️</div><h3>Nada por gastar</h3>
      <p>Tocá el <b>+</b> en una opción para guardarla acá. Cuando lo pidas en Rappi, marcá "Ya lo pedí" y pasa a gastado.</p>
      <button class="btn primary" data-tab="home" style="margin-top:16px">Ver qué como</button></div>`}

    <div class="summary">
      <div class="line"><span>Gastado este mes</span><b>${ars(s.spent)}</b></div>
      <div class="line"><span>Por gastar (en la lista)</span><b>${ars(s.planned)}</b></div>
      <div class="line"><span>Tope mensual</span><b>${s.monthly ? ars(s.monthly) : 'sin tope'}</b></div>
      <div class="line total"><span>${s.monthly ? 'Te queda' : 'Total histórico'}</span><span>${s.monthly ? ars(s.remainingAfterCart) : ars(s.totalSpentAllTime)}</span></div>
    </div>
    <p class="note">Los totales incluyen el envío cuando Rappi lo publica (es aproximado: depende de tu dirección). No incluyen la tarifa de servicio.</p>

    ${spendingHtml()}
    ${historyHtml(st.orders)}`;
}

function viewSettings() {
  const st = engine.getState();
  const catalog = engine.catalogSummary();
  const hidden = st.hiddenItems.map(id => engine.item(id)).filter(Boolean);
  return `
    <div class="page-title"><h1>Ajustes</h1></div>
    ${extraSettingsHtml()}

    <div class="settings-grid">
    <div class="setting">
      <h3>💰 Tope mensual</h3>
      <p>Cuánto querés gastar en delivery por mes. 0 = sin tope.</p>
      <div class="field"><span>$</span><input id="monthly" inputmode="numeric" value="${st.budget.monthly ? st.budget.monthly.toLocaleString('es-AR') : ''}" placeholder="0"></div>
    </div>

    <div class="setting wide">
      <h3>🍽️ Qué como y cuánto</h3>
      <p><b>Normal</b> es lo que comés con hambre; <b>Máx</b>, en modo bestia. Apagá lo que no comés.</p>
      <div class="appetite">${Object.entries(CATS).map(([k, c]) => {
        const a = st.profile.appetite[k];
        const on = st.profile.enabledCategories.includes(k);
        return `<div class="appetite-row ${on ? '' : 'off'}">
          <span class="e">${look(k).e}</span>
          <div class="lbl"><b>${c.label}</b><small>${c.unit}</small></div>
          ${stepper(k, 'normal', a.normal)}${stepper(k, 'max', a.max)}
          <button class="toggle ${on ? 'on' : ''}" data-enable="${k}" aria-label="Como ${c.label}"></button>
        </div>`;
      }).join('')}</div>
    </div>

    <div class="setting">
      <h3>🚫 No como</h3>
      <p>Saco de las opciones todo lo que tenga esto.</p>
      <div class="tagset">${Object.entries(EXCLUDABLE).map(([k, l]) => `<button class="${st.profile.excludedTags.includes(k) ? 'on' : ''}" data-exclude="${k}">${l}</button>`).join('')}</div>
    </div>

    <div class="setting">
      <h3>🙈 Ocultos</h3>
      <p>Productos que marcaste como mal medidos. Rappi no dice cuánto rinde cada cosa y a veces lo adivino mal.</p>
      <div class="list" style="margin-top:12px">${hidden.length ? hidden.map(it => `
        <div class="row">${thumb(catOfItem(it), it.imageUrl, 'sm')}<div class="row-main"><h4>${esc(it.name)}</h4><p>${esc(it.restaurant.name)}</p></div>
        <button class="btn ghost sm" data-unhide="${esc(it.id)}">Restaurar</button></div>`).join('') : '<p class="note">No ocultaste nada.</p>'}</div>
    </div>

    <div class="setting">
      <h3>🤖 Asistente IA</h3>
      <p>Asistente de voz con acento argentino: le contás qué te pinta y te ayuda a decidir qué pedir.</p>
      ${voiceAgent?.agentId ? `<button class="toggle ${assistantOn() ? 'on' : ''}" data-assist-enable aria-label="Asistente IA"></button>` : '<p class="note">No hay agente configurado (falta ui/voice-agent.json).</p>'}
    </div>

    </div>
    <p class="note">${real ? `Catálogo unificado: ${catalog.rows.toLocaleString('es-AR')} productos · ${catalog.restaurants.toLocaleString('es-AR')} locales · ${catalog.officialMenuRows.toLocaleString('es-AR')} filas de menús oficiales${catalog.consolidatedAt ? ` · actualizado el ${new Date(catalog.consolidatedAt).toLocaleDateString('es-AR')}` : ''}.` : 'Datos de ejemplo.'}</p>`;
}

const stepper = (cat, field, val) => `
  <div class="stepper"><small>${field === 'normal' ? 'Normal' : 'Máx'}</small>
    <div><button data-step="${cat}:${field}:-1" aria-label="Menos">−</button><span>${val}</span><button data-step="${cat}:${field}:1" aria-label="Más">+</button></div>
  </div>`;

// ---------- Hojas (detalle de plan y menú de un local) ----------
function openSheet(html) {
  $('#overlay').innerHTML = `<div class="sheet-wrap" id="sheet-wrap"><div class="sheet">${html}</div></div>`;

}
function closeSheet() { $('#overlay').innerHTML = ''; }

function openPlan(id) {
  const p = findPlan(id);
  if (!p) return;
  const orig = planOriginal(p);
  const favs = engine.getState().favorites;
  openSheet(`
    <div class="cover sheet-cover" ${coverStyle(p.category)}>${sheetCoverHtml(p.category, planImage(p))}</div>
    <div class="sheet-top">
      <button class="icon-btn" data-close aria-label="Cerrar">${icon('back')}</button>
      <span class="pill">${look(p.category).e} ${p.quantity} ${unitLabel(p.quantity, p.unit)}</span>
      <button class="icon-btn" data-rest="${esc(p.restaurant.id)}" aria-label="Ver menú">${icon('search')}</button>
    </div>
    <div class="sheet-body">
      <div class="kicker">${CATS[p.category]?.label || 'Producto'}${p.restaurant.chain ? ' · Cadena' : ' · Local'}</div>
      <h2>${esc(p.restaurant.name)}</h2>
      <div class="badges" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${p.badges.map(b => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join('')}</div>
      <div class="stats">
        <div><small>Rating Rappi</small><b>${icon('star', 'fill')} ${stars(p.restaurant)}</b></div>
        <div><small>Por ${unitLabel(1, p.unit)}</small><b>${ars(p.unitCost)}</b></div>
        <div><small>Pediste</small><b>${p.target} → ${p.quantity}</b></div>
      </div>
      ${placeHtml(p.restaurant)}
      ${deliveryText(p.restaurant) || p.restaurant.rappiReviews ? `<p class="blurb">${[deliveryText(p.restaurant), p.restaurant.rappiReviews ? `${p.restaurant.rappiReviews} reseñas en Rappi` : ''].filter(Boolean).join(' · ')}${p.restaurant.deliveryFee != null ? ' · envío aproximado' : ''}</p>` : ''}
      ${p.restaurant.address ? `<p class="blurb">📍 ${esc(p.restaurant.address)}</p>` : ''}
      ${reputationHtml(p.restaurant)}
      ${p.variant === 'un-poco-menos' ? `<p class="blurb">Comés un poco menos de lo que querías (${p.quantity} de ${p.target}) pero te ahorrás bastante.</p>` : ''}
      ${plateHtml(p, true)}
      ${nutritionBoxHtml({ kcal: p.nutrition.kcal, perPerson: p.nutrition.kcalPerPerson, people: lastResult?.people || 1, health: p.nutrition.health, label: p.nutrition.label })}
      <div class="section-head" style="margin-top:22px"><h2>Qué pedís</h2><span>${p.lines.length} producto${p.lines.length > 1 ? 's' : ''}</span></div>
      <div class="list">${p.lines.map(l => `
        <div class="line-item">
          <span class="q">${l.qty}×</span>
          <div class="row-main"><h4>${esc(l.name)}</h4><p>${ars(l.price)} c/u${l.discount ? ` · ${esc(l.discount)}` : ''}</p>${signalsHtml(l.signals)}${priceChangeHtml(l)}${otherAppsHtml(l.otherApps, l.price)}</div>
          <button class="heart ${favs.includes(l.itemId) ? 'on' : ''}" data-fav="${esc(l.itemId)}" aria-label="Favorito">${icon('heart', favs.includes(l.itemId) ? 'fill' : '')}</button>
          <button class="flag" data-hide="${esc(l.itemId)}" title="La cantidad o la comida está mal detectada">Está mal</button>
        </div>`).join('')}</div>
      <a class="btn ghost block" style="margin-top:14px" data-rest="${esc(p.restaurant.id)}">Ver todo el menú del local</a>
    </div>
    <div class="sheet-bar">
      <div class="tot"><small>Total${p.restaurant.deliveryFee == null ? ' + envío' : ' con envío'}</small><b>${ars(p.total)}</b>${orig > p.total ? `<s>${ars(orig)}</s>` : ''}</div>
      <button class="btn ghost split-btn" data-split="${esc(p.id)}" title="Dividir la cuenta">➗</button>
      ${inCart(p.id)
        ? `<a class="btn red" href="${esc(p.orderUrl)}" target="_blank" rel="noopener">Pedir en Rappi ${icon('out')}</a>`
        : `<button class="btn primary" data-add="${esc(p.id)}">${icon('bag')} Agregar al pedido</button>`}
    </div>`);
}

function openMenu(restaurantId) {
  const rest = engine.restaurants().find(r => r.id === restaurantId);
  const items = engine.menu(restaurantId);
  if (!rest) return;
  const bySection = {};
  for (const it of items) (bySection[it.section || 'Menú'] ||= []).push(it);
  const mainCat = Object.entries(items.reduce((acc, it) => { const c = catOfItem(it); if (c !== 'otro') acc[c] = (acc[c] || 0) + 1; return acc; }, {}))
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'otro';
  openSheet(`
    <div class="cover sheet-cover" ${coverStyle(mainCat)}>${sheetCoverHtml(mainCat, rest.coverUrl)}</div>
    <div class="sheet-top">
      <button class="icon-btn" data-close aria-label="Cerrar">${icon('back')}</button>
      <span class="pill">Menú · ${items.length} productos</span>
      ${rest.url ? `<a class="icon-btn" href="${esc(rest.url)}" target="_blank" rel="noopener" aria-label="Abrir en Rappi">${icon('out')}</a>` : '<span></span>'}
    </div>
    <div class="sheet-body">
      <div class="kicker">${rest.chain ? 'Cadena' : 'Local'}${rest.address ? ` · ${esc(rest.address)}` : ''}</div>
      <h2>${esc(rest.name)}</h2>
      <div class="stats">
        <div><small>Rappi${rest.rappiReviews ? ` · ${rest.rappiReviews}` : ''}</small><b>${icon('star', 'fill')} ${stars(rest)}</b></div>
        <div><small>Envío</small><b>${rest.deliveryFee != null ? (rest.deliveryFee ? ars(rest.deliveryFee) : 'Gratis') : '—'}</b></div>
        <div><small>Demora</small><b>${rest.etaMin ? `${rest.etaMin} min` : '—'}</b></div>
      </div>
      ${placeHtml(rest)}
      ${reputationHtml(rest)}
      <p class="blurb">Tocá el ❤️ en lo que te gusta de acá: con eso aprendo tu gusto y te lo priorizo.</p>
      ${Object.entries(bySection).map(([sec, list]) => `
        <div class="menu-section">${esc(sec)}</div>
        <div class="list" style="margin-top:10px">${list.map(it => `
          <div class="line-item click" data-item="${esc(it.id)}" role="button" tabindex="0" aria-label="Ver ${esc(it.name)}">
            ${thumb(catOfItem(it), it.imageUrl, 'sm')}
            <div class="row-main"><h4>${esc(it.name)}</h4><p>${itemPrice(it)}${it.discount ? ` · ${esc(it.discount)}` : ''}${Object.keys(it.yields).length ? ` · rinde ${Object.entries(it.yields).map(([c, n]) => `${n} ${unitLabel(n, CATS[c].unit)}`).join(' + ')}` : ''}</p>${sourceHtml(it)}${signalsHtml(it.signals)}${priceChangeHtml(it)}${otherAppsHtml(it.otherApps, it.price)}</div>
            <button class="heart ${it.favorite ? 'on' : ''}" data-fav="${esc(it.id)}" aria-label="Favorito">${icon('heart', it.favorite ? 'fill' : '')}</button>
            <span class="chev" aria-hidden="true">›</span>
          </div>`).join('')}</div>`).join('')}
    </div>
    <div class="sheet-bar">
      <button class="btn ghost" data-group-start="${esc(rest.id)}">👥 Pedido grupal</button>
      ${rest.url ? `<a class="btn red" href="${esc(rest.url)}" target="_blank" rel="noopener">Abrir en Rappi ${icon('out')}</a>` : ''}
    </div>`);
}

// Detalle de un producto del menú completo: foto, descripción, cuánto rinde, historial de precio,
// cantidad y agregar al pedido. "Atrás" vuelve al menú del local.
function openItem(itemId, qty = 1) {
  const restId = itemId.slice(0, itemId.lastIndexOf(':'));
  const rest = engine.restaurants().find(r => r.id === restId);
  const it = engine.menu(restId).find(x => x.id === itemId);
  if (!rest || !it) return;
  const plan = engine.planForItem(itemId, qty);
  if (plan) itemPlans.set(plan.id, plan);
  const cat = catOfItem(it);
  const yields = Object.entries(it.yields || {});
  const fav = engine.getState().favorites.includes(it.id);
  openSheet(`
    <div class="cover sheet-cover" ${coverStyle(cat)}>${sheetCoverHtml(cat, it.imageUrl)}</div>
    <div class="sheet-top">
      <button class="icon-btn" data-rest="${esc(restId)}" aria-label="Volver al menú">${icon('back')}</button>
      <span class="pill">${look(cat).e} ${esc(it.section || 'Menú')}</span>
      ${rest.url ? `<a class="icon-btn" href="${esc(rest.url)}" target="_blank" rel="noopener" aria-label="Abrir en Rappi">${icon('out')}</a>` : '<span></span>'}
    </div>
    <div class="sheet-body">
      <div class="kicker">${esc(rest.name)}</div>
      <h2>${esc(it.name)}</h2>
      ${it.description ? `<p class="blurb item-desc">${esc(it.description)}</p>` : ''}
      <div class="stats">
        <div><small>Precio</small><b>${ars(it.price)}</b>${it.originalPrice ? `<s>${ars(it.originalPrice)}</s>` : ''}</div>
        <div><small>Rinde</small><b>${yields.length ? yields.map(([c, n]) => `${n} ${unitLabel(n, CATS[c].unit)}`).join(' + ') : '—'}</b></div>
        <div><small>${yields.length ? `Por ${unitLabel(1, CATS[yields[0][0]].unit)}` : 'Rating'}</small><b>${yields.length ? ars(Math.round(it.price / yields[0][1])) : `${icon('star', 'fill')} ${stars(rest)}`}</b></div>
      </div>
      ${placeHtml(rest)}
      ${sourceHtml(it)}${signalsHtml(it.signals)}${priceChangeHtml(it)}${otherAppsHtml(it.otherApps, it.price)}
      ${it.nutrition ? nutritionBoxHtml({ kcal: it.nutrition.kcal * qty, perUnit: it.nutrition.perUnit, health: it.nutrition.health, label: it.nutrition.label, reasons: it.nutrition.reasons, range: it.nutrition.range.map(k => k * qty), qty }) : ''}
      <div class="item-qty">
        <span>Cantidad</span>
        <div class="stepper"><div><button data-iqty="-1" aria-label="Menos">−</button><span>${qty}</span><button data-iqty="1" aria-label="Más">+</button></div></div>
      </div>
      <div class="item-actions">
        <button class="btn ghost" data-fav="${esc(it.id)}">${icon('heart', fav ? 'fill' : '')} ${fav ? 'En favoritos' : 'Me gusta'}</button>
        ${yields.length ? `<button class="btn ghost" data-hide="${esc(it.id)}" title="La cantidad o la comida está mal detectada">Está mal medido</button>` : ''}
      </div>
    </div>
    <div class="sheet-bar">
      <div class="tot"><small>${qty > 1 ? `${qty} × ${ars(it.price)}` : 'Total'}${rest.deliveryFee == null ? ' + envío' : ' con envío'}</small><b>${ars(plan ? plan.total : it.price * qty)}</b></div>
      ${plan && inCart(plan.id)
        ? `<a class="btn red" href="${esc(plan.orderUrl)}" target="_blank" rel="noopener">Pedir en Rappi ${icon('out')}</a>`
        : plan ? `<button class="btn primary" data-add="${esc(plan.id)}">${icon('bag')} Agregar al pedido</button>` : ''}
    </div>`);
  openItem.current = { itemId, qty };
}

// ---------- Eventos ----------
let reopen = null; // para refrescar la hoja abierta después de un cambio en el motor

engine.on(({ type }) => {
  if (type === 'catalog') return;
  if (ui.tab === 'home') {
    renderResults();
    renderTabbar();
    const heroEl = document.querySelector('.hero');
    if (heroEl) heroEl.outerHTML = heroHtml();
  } else {
    render();
  }
  if (reopen && $('#sheet-wrap')) reopen();
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-palette],[data-people],[data-results],[data-decide],[data-swipe],[data-cmd],[data-spin],[data-tab],[data-hunger],[data-cat],[data-money],[data-add],[data-fav],[data-fav-plan],[data-plan],[data-rest],[data-close],[data-hide],[data-unhide],[data-confirm],[data-remove],[data-toptab],[data-step],[data-enable],[data-exclude],[data-suggest],[data-assist-toggle],[data-assist-enable],[data-item],[data-iqty],[data-when],[data-eta],[data-km],[data-fitness],[data-kcal],[data-goal],[data-group-start],[data-gq],[data-group-share],[data-group-cart],[data-group-back],#sheet-wrap');
  if (!t) return;
  const d = t.dataset;

  if (t.id === 'sheet-wrap') { if (e.target === t) { closeSheet(); reopen = null; } return; }
  if ('close' in d) { closeSheet(); reopen = null; return; }
  if ('palette' in d) { openPalette(); return; }
  if (d.people) { ui.people = Math.max(1, Math.min(12, ui.people + +d.people)); saveUi(); render(); return; }
  if (d.results) { ui.results = d.results; saveUi(); render(); return; }
  if ('decide' in d) { openDecide(); return; }
  if (d.swipe) { swipe(d.swipe); return; }
  if ('spin' in d) { spin(); return; }
  if (d.cmd) { runCommand(+d.cmd); return; }
  if (d.tab) { closeSheet(); ui.tab = d.tab; if (d.toptab) ui.topTab = d.toptab; render(); $('#view').scrollTop = 0; return; }
  if (d.hunger) { ui.hunger = d.hunger; saveUi(); render(); return; }
  if (d.cat) { ui.category = d.cat; saveUi(); render(); return; }
  if ('money' in d) { ui.money = d.money ? +d.money : null; saveUi(); render(); return; }
  if (d.groupStart) { startGroup(d.groupStart); return; }
  if (d.gq) { changeGroupQty(d.gq, +d.delta); return; }
  if ('groupShare' in d) { shareGroup(); return; }
  if ('groupCart' in d) { groupToCart(); return; }
  if (d.groupBack) { closeGroup(); reopen = () => openMenu(d.groupBack); openMenu(d.groupBack); return; }
  if ('fitness' in d) { ui.fitness = !ui.fitness; saveUi(); render(); return; }
  if ('kcal' in d) { ui.maxKcal = d.kcal === '' ? null : +d.kcal; saveUi(); render(); return; }
  if (d.goal) { ui.goal = d.goal; saveUi(); render(); return; }
  if ('when' in d) { ui.when = d.when === '' ? null : +d.when; render(); return; }
  if ('eta' in d) { ui.maxEta = d.eta === '' ? null : +d.eta; saveUi(); render(); return; }
  if ('km' in d) { ui.maxKm = d.km === '' ? null : +d.km; saveUi(); render(); return; }
  if (d.toptab) { ui.topTab = d.toptab; saveUi(); render(); return; }

  if (d.add) {
    e.stopPropagation();
    const p = findPlan(d.add);
    if (!p) return;
    if (inCart(p.id)) { ui.tab = 'cart'; closeSheet(); render(); return; }
    engine.addToCart(p);
    toast(`Agregado: ${p.restaurant.name} · ${ars(p.total)}`);
    return;
  }
  if (d.favPlan) {
    e.stopPropagation();
    const p = findPlan(d.favPlan);
    if (!p) return;
    const favs = engine.getState().favorites;
    const onIds = p.lines.filter(l => favs.includes(l.itemId)).map(l => l.itemId);
    if (onIds.length) onIds.forEach(id => engine.toggleFavorite(id)); else engine.toggleFavorite(p.lines[0].itemId);
    toast(onIds.length ? 'Sacado de favoritos' : '❤️ Guardado en favoritos');
    return;
  }
  if (d.fav) { e.stopPropagation(); const was = engine.getState().favorites.includes(d.fav); engine.toggleFavorite(d.fav); toast(was ? 'Sacado de favoritos' : '❤️ Guardado en favoritos'); return; }
  if (d.hide) {
    engine.hideItem(d.hide);
    closeSheet(); reopen = null;
    toast('Oculto. Lo podés restaurar en Ajustes.');
    return;
  }
  if (d.unhide) { engine.unhideItem(d.unhide); return; }
if (d.assistEnable) {
  ui.assistant = assistantOn() ? false : true;
  saveUi();
  document.querySelector('.assistant-fab')?.classList.toggle('off', !assistantOn());
  toast(assistantOn() ? '🤖 Asistente activado' : 'Asistente IA apagado');
  const card = document.querySelector('[data-assist-enable]');
  if (card) card.classList.toggle('on', assistantOn());
  return;
}
if ('assistToggle' in d) {
  const fab = document.querySelector('.assistant-fab');
  const dock = $('#assistant-dock');
  if (!fab || !dock) return;
  const open = !dock.classList.contains('on');
  dock.classList.toggle('on', open);
  fab.classList.toggle('open', open);
  if (open) mountAssistantWidget();
  return;
}
  if (d.confirm) { engine.confirmOrder(d.confirm); toast('✅ Pasó a gastado'); return; }
  if (d.remove) { engine.removeFromCart(d.remove); return; }
  if (d.rest) {
    e.preventDefault();
    const id = d.rest;
    reopen = () => openMenu(id);
    openMenu(id);
    return;
  }
  if (d.plan) {
    const id = d.plan;
    reopen = () => openPlan(id);
    openPlan(id);
    return;
  }
  if (d.item) {
    const id = d.item;
    reopen = () => openItem(id, openItem.current?.itemId === id ? openItem.current.qty : 1);
    openItem(id);
    return;
  }
  if (d.iqty) {
    const cur = openItem.current;
    if (!cur) return;
    const qty = Math.max(1, Math.min(20, cur.qty + +d.iqty));
    reopen = () => openItem(cur.itemId, qty);
    openItem(cur.itemId, qty);
    return;
  }
  if (d.step) {
    const [cat, field, delta] = d.step.split(':');
    const a = { ...engine.getState().profile.appetite[cat] };
    a[field] = Math.max(1, a[field] + +delta);
    if (field === 'normal' && a.max < a.normal) a.max = a.normal;
    if (field === 'max' && a.max < a.normal) a.normal = a.max;
    engine.setAppetite(cat, a);
    return;
  }
  if (d.enable) {
    const list = engine.getState().profile.enabledCategories;
    const next = list.includes(d.enable) ? list.filter(c => c !== d.enable) : [...list, d.enable];
    if (!next.length) { toast('Dejá al menos una comida'); return; }
    if (!next.includes(ui.category)) ui.category = 'all';
    engine.setEnabledCategories(next);
    return;
  }
  if (d.exclude) {
    const list = engine.getState().profile.excludedTags;
    engine.setExcludedTags(list.includes(d.exclude) ? list.filter(x => x !== d.exclude) : [...list, d.exclude]);
    return;
  }
  if (d.suggest) { ui.ricoWeight = +d.suggest; saveUi(); toast('Listo, ajusté Rico/Barato'); render(); }
});

// Controles continuos: solo actualizan resultados, para no romper el arrastre ni el tipeo.
let raf = 0;
const schedule = fn => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };
const parseMoney = v => { const n = +String(v).replace(/\D/g, ''); return n > 0 ? n : null; };

document.addEventListener('input', e => {
  if (e.target.id === 'balance') {
    ui.ricoWeight = +e.target.value; saveUi();
    $('#balance-hint').textContent = balanceHint();
    schedule(renderResults);
  }
  if (e.target.id === 'money') {
    ui.money = parseMoney(e.target.value); saveUi();
    document.querySelectorAll('[data-money]').forEach(b => b.classList.toggle('on', (b.dataset.money ? +b.dataset.money : null) === ui.money));
    schedule(renderResults);
  }
  if (e.target.id === 'search') renderSearch(e.target.value);
});
document.addEventListener('change', e => {
  if (e.target.id === 'monthly') { engine.setMonthlyBudget(parseMoney(e.target.value) || 0); toast('Tope guardado'); }
  if (e.target.id === 'money' && ui.money) e.target.value = ui.money.toLocaleString('es-AR');
});
document.addEventListener('keydown', onKey);

const RESTAURANTS = engine.restaurants();
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function renderSearch(q) {
  const box = $('#search-results');
  if (!q.trim()) { box.className = ''; box.innerHTML = ''; return; }
  const nq = norm(q.trim());
  const hits = RESTAURANTS.filter(r => norm(r.name).includes(nq)).slice(0, 12);
  box.className = 'search-results';
  box.innerHTML = hits.length ? hits.map(r => `
    <button data-rest="${esc(r.id)}"><span class="rating">${icon('star', 'fill')} ${stars(r)}</span>
    <span class="row-main"><h4>${esc(r.name)}</h4><p>${r.chain ? 'Cadena' : 'Local'}</p></span></button>`).join('')
    : '<div class="empty">No encontré locales con ese nombre.</div>';
}
document.addEventListener('focusout', e => {
  if (e.target.id === 'search')  setTimeout(() => { const b = $('#search-results'); if (b && !b.matches(':hover')) { b.className = ''; b.innerHTML = ''; } }, 150);
});
render();
mountAssistantShell();

// =====================================================================
// Proyección del mes: a este ritmo, ¿con cuánto llegás?
// =====================================================================
function forecast(s) {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate() + now.getHours() / 24;
  const todayPct = Math.min(100, (day / days) * 100);
  if (!s.spent || day < 2) return { todayPct, text: '' };
  const projected = Math.round((s.spent / day) * days);
  if (!s.monthly) return { todayPct, text: `A este ritmo cerrás el mes en ${ars(projected)}` };
  const over = projected > s.monthly;
  const perDay = Math.max(0, Math.floor(s.remaining / Math.max(1, days - day)));
  return {
    todayPct, over,
    text: over
      ? `A este ritmo te pasás ${ars(projected - s.monthly)}. Para llegar: ${ars(perDay)} por día.`
      : `A este ritmo te sobran ${ars(s.monthly - projected)} a fin de mes.`,
  };
}

// =====================================================================
// Plato visual: cada punto es una pieza. Lleno = lo que pediste, dorado = de yapa,
// hueco = lo que te falta (variante "un poco menos").
// =====================================================================
function plateHtml(p, big = false) {
  const max = big ? 60 : 36;
  const step = Math.max(1, Math.ceil(Math.max(p.quantity, p.target) / max)); // un punto = `step` piezas
  const want = Math.ceil(p.target / step), got = Math.ceil(p.quantity / step);
  const dots = [];
  for (let i = 0; i < Math.max(want, got); i++) dots.push(i < Math.min(want, got) ? 'f' : i < got ? 'y' : 'm');
  const extra = p.quantity - p.target;
  const pct = Math.round((p.quantity / p.target) * 100);
  const label = extra > 0 ? `+${extra} de yapa` : extra < 0 ? `${-extra} menos de lo que pediste` : 'justo lo que pediste';
  return `
    <div class="plate ${big ? 'big' : ''}" title="${p.quantity} de ${p.target} ${esc(p.unit)}">
      <div class="plate-dots">${dots.map(d => `<i class="${d}"></i>`).join('')}</div>
      <div class="plate-txt"><b class="${pct > 100 ? 'up' : pct < 100 ? 'down' : ''}">${pct}%</b> de tu hambre · ${label}${step > 1 ? ` · cada punto = ${step}` : ''}</div>
    </div>`;
}

// =====================================================================
// Mapa Rico × Barato: todas las opciones que entran en tu plata, en un plano.
// x = precio por unidad (escala log, más barato a la izquierda), y = puntaje "rico".
// Los rojos son el "punto dulce" (frontera de Pareto) y la estrella es lo que elige tu slider.
// =====================================================================
function mapHtml(r) {
  const W = 760, H = 330, M = { l: 46, r: 18, t: 18, b: 40 };
  const isSweet = p => p.badges.includes('punto-dulce');
  const pts = [...r.all].sort((a, b) => isSweet(a) - isSweet(b)).slice(-400);
  const xs = pts.map(p => Math.log(p.unitCost));
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1e-6;
  const X = v => M.l + ((Math.log(v) - x0) / (x1 - x0)) * (W - M.l - M.r);
  const Y = v => H - M.b - v * (H - M.t - M.b);
  const pick = r.options[0];
  const sweet = pts.filter(isSweet).sort((a, b) => a.unitCost - b.unitCost);
  // Frontera escalonada: de barato y menos rico a caro y más rico.
  const frontier = sweet.map((p, i) => `${i ? `L${X(p.unitCost).toFixed(1)},${Y(sweet[i - 1].scores.rico).toFixed(1)} ` : 'M'}${X(p.unitCost).toFixed(1)},${Y(p.scores.rico).toFixed(1)}`).join(' ');
  const ticks = niceTicks(Math.exp(x0), Math.exp(x1));
  const labelled = new Set([sweet[0], sweet[sweet.length - 1], pick].filter(Boolean).map(p => p.id));
  const unit = unitLabel(1, pts[0]?.unit || 'unidades');
  return `
    <div class="map-card">
      <div class="map-legend">
        <span><i class="lg sweet"></i>Punto dulce: nadie es más rico y más barato a la vez</span>
        <span><i class="lg rest"></i>Otras opciones</span>
        <span><i class="lg star">★</i>Tu elección según el slider</span>
      </div>
      <div class="map-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa de opciones: precio por unidad contra qué tan rico">
          ${[0, .25, .5, .75, 1].map(v => `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v * 100)}</text>`).join('')}
          ${ticks.map(t => `<text class="tick" x="${X(t)}" y="${H - M.b + 18}" text-anchor="middle">${ars(t)}</text>`).join('')}
          <text class="axis" x="${M.l}" y="${H - 4}">← más barato por ${esc(unit)}</text>
          <text class="axis" x="${W - M.r}" y="${H - 4}" text-anchor="end">más caro →</text>
          <text class="axis" x="12" y="${M.t}" transform="rotate(-90 12 ${M.t})" text-anchor="end">más rico →</text>
          <path class="frontier" d="${frontier}"/>
          ${pts.map(p => `<g class="pt ${isSweet(p) ? 'sweet' : ''}" data-plan="${esc(p.id)}" data-tip="${esc(`${p.restaurant.name}|${p.quantity} ${p.unit} · ${ars(p.total)}|${ars(p.unitCost)} c/u · rico ${Math.round(p.scores.rico * 100)}`)}">
              <circle class="hit" cx="${X(p.unitCost)}" cy="${Y(p.scores.rico)}" r="11"/>
              <circle class="dot" cx="${X(p.unitCost)}" cy="${Y(p.scores.rico)}" r="${isSweet(p) ? 6.5 : 4.5}"/>
            </g>`).join('')}
          ${pick ? `<text class="pick" x="${X(pick.unitCost)}" y="${Y(pick.scores.rico) + 7}" text-anchor="middle" data-plan="${esc(pick.id)}">★</text>` : ''}
          ${pts.filter(p => labelled.has(p.id)).map(p => {
            const x = X(p.unitCost), right = x > W * 0.7;
            return `<text class="lbl" x="${right ? x - 12 : x + 12}" y="${Y(p.scores.rico) - 10}" text-anchor="${right ? 'end' : 'start'}">${esc(p.restaurant.name.split(' - ')[0])}</text>`;
          }).join('')}
        </svg>
        <div class="map-tip" id="map-tip"></div>
      </div>
      <p class="note">${pts.length} opciones que entran en tu plata. Tocá un punto para ver el detalle; abajo están las mejores en tarjetas.</p>
    </div>`;
}

function niceTicks(lo, hi) {
  const out = [300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000].filter(b => b > lo * 1.05 && b < hi * 0.95);
  out.unshift(Math.round(lo)); out.push(Math.round(hi));
  return out.length >= 2 ? out : [Math.round(lo), Math.round(hi)];
}

document.addEventListener('pointerover', e => {
  const tip = $('#map-tip');
  if (!tip) return;
  const g = e.target.closest?.('.pt');
  if (!g) { tip.classList.remove('on'); return; }
  const [name, a, b] = g.dataset.tip.split('|');
  tip.innerHTML = `<b>${esc(name)}</b><span>${esc(a)}</span><span>${esc(b)}</span>`;
  const box = g.closest('.map-plot').getBoundingClientRect(), dot = g.querySelector('.dot').getBoundingClientRect();
  tip.style.left = `${Math.min(box.width - 200, Math.max(0, dot.left - box.left - 90))}px`;
  tip.style.top = `${Math.max(0, dot.top - box.top - 78)}px`;
  tip.classList.add('on');
});

// =====================================================================
// Decidí por mí: mazo de cartas. Derecha = lo quiero (va al pedido), izquierda = otra.
// La ruleta gira entre las 8 mejores y frena en una, pesada por puntaje.
// =====================================================================
let deck = [], deckIndex = 0, lastDeckFirst = null;
function openDecide() {
  // Mezclado con preferencia por el puntaje y un plan por local; antes era el ranking en orden y
  // la primera carta salía siempre igual.
  deck = decideDeck(lastResult?.options || [], { lastFirstId: lastDeckFirst });
  lastDeckFirst = deck[0]?.id ?? null;
  deckIndex = 0;
  if (!deck.length) { toast('No hay opciones con esos filtros'); return; }
  reopen = null;
  $('#overlay').innerHTML = `<div class="sheet-wrap decide-wrap" id="sheet-wrap"><div class="decide">
    <div class="decide-head">
      <button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
      <div><b>Decidí por mí</b><small>Deslizá → lo quiero · ← otra</small></div>
      <button class="icon-btn spin-btn" data-spin aria-label="Ruleta">🎰</button>
    </div>
    <div class="deck" id="deck"></div>
    <div class="deck-actions">
      <button class="round no" data-swipe="left" aria-label="Otra">${icon('x')}</button>
      <button class="round fav" data-swipe="fav" aria-label="Favorito">${icon('heart', 'fill')}</button>
      <button class="round yes" data-swipe="right" aria-label="Lo quiero">${icon('check')}</button>
    </div>
  </div></div>`;
  renderDeck();
}

function deckCard(p, i) {
  return `<div class="dcard" data-i="${i}" style="--i:${i - deckIndex}">
    <div class="cover" ${coverStyle(p.category)}>${coverHtml({ category: p.category, imageUrl: planImage(p) })}
      <span class="qty">${look(p.category).e} ${p.quantity} ${unitLabel(p.quantity, p.unit)}</span>
      <div class="badges">${p.badges.filter(b => BADGES[b]).slice(0, 2).map(b => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join('')}</div>
      <span class="stamp yes">LO QUIERO</span><span class="stamp no">OTRA</span>
    </div>
    <div class="dbody">
      <div class="card-row"><h3 class="card-title">${esc(p.restaurant.name)}</h3><span class="rating">${icon('star', 'fill')} ${stars(p.restaurant)}</span></div>
      <p class="card-lines">${p.lines.map(l => `${l.qty}× ${esc(l.name)}`).join(' + ')}</p>
      ${plateHtml(p)}
      <div class="card-foot"><div><div class="price">${ars(p.total)}</div><div class="per">${ars(p.unitCost)} c/u · ${deliveryText(p.restaurant) || '+ envío'}</div></div></div>
    </div>
  </div>`;
}

function renderDeck() {
  const box = $('#deck');
  if (!box) return;
  if (deckIndex >= deck.length) {
    box.innerHTML = `<div class="deck-end"><div class="e">🤷</div><h3>No te convenció ninguna</h3><p>Cambiá el hambre, la comida o la plata y volvé a probar.</p><button class="btn primary" data-close>Volver</button></div>`;
    return;
  }
  // Se reusan las cartas que ya están (solo cambia su lugar, con transición) y se agrega atrás la que falta.
  // Redibujar todo hacía saltar la carta siguiente en vez de acomodarse.
  [...box.children].forEach(el => {
    const i = +el.dataset.i;
    if (!el.classList.contains('dcard') || i < deckIndex || i >= deckIndex + 3) el.remove();
  });
  for (let i = deckIndex; i < Math.min(deck.length, deckIndex + 3); i++) {
    const el = box.querySelector(`.dcard[data-i="${i}"]`);
    if (el) el.style.setProperty('--i', i - deckIndex);
    else box.insertAdjacentHTML('afterbegin', deckCard(deck[i], i)); // las nuevas van al fondo
  }
  bindDrag(box.querySelector(`.dcard[data-i="${deckIndex}"]`));
}

function bindDrag(card) {
  if (!card || card.dataset.bound) return;
  card.dataset.bound = '1';
  let x0 = 0, dx = 0, dragging = false;
  card.addEventListener('pointerdown', e => { dragging = true; x0 = e.clientX; card.setPointerCapture(e.pointerId); card.classList.add('drag'); });
  card.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - x0;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    card.classList.toggle('to-yes', dx > 60);
    card.classList.toggle('to-no', dx < -60);
  });
  card.addEventListener('pointerup', () => {
    dragging = false; card.classList.remove('drag');
    if (dx > 100) swipe('right'); else if (dx < -100) swipe('left');
    else { card.style.transform = ''; card.classList.remove('to-yes', 'to-no'); }
    dx = 0;
  });
}

function swipe(dir) {
  const p = deck[deckIndex];
  const card = document.querySelector(`.dcard[data-i="${deckIndex}"]`);
  if (!p || !card) return;
  if (dir === 'fav') {
    if (!planIsFav(p)) engine.toggleFavorite(p.lines[0].itemId);
    toast('❤️ Guardado en favoritos');
    dir = 'left';
  }
  card.style.transform = '';
  card.classList.add(dir === 'right' ? 'out-right' : 'out-left');
  setTimeout(() => {
    if (dir === 'right') { if (!inCart(p.id)) engine.addToCart(p); showMatch(p); return; }
    deckIndex++; renderDeck();
  }, 280);
}

function showMatch(p) {
  const box = $('#deck');
  if (!box) return;
  box.innerHTML = `<div class="match">
    <div class="match-burst">${look(p.category).e}</div>
    <h3>¡Match!</h3>
    <p><b>${p.quantity} ${esc(unitLabel(p.quantity, p.unit))}</b> en <b>${esc(p.restaurant.name)}</b> por <b>${ars(p.total)}</b>. Ya está en tu pedido.</p>
    <a class="btn red block" href="${esc(p.orderUrl)}" target="_blank" rel="noopener">Pedir en Rappi ${icon('out')}</a>
    <button class="btn ghost block" data-tab="cart" style="margin-top:8px">Ver mi pedido</button>
  </div>`;
  document.querySelector('.decide')?.classList.add('matched');
  confetti();
}

function spin() {
  const pool = deck.slice(deckIndex, deckIndex + 8);
  if (!pool.length) return;
  const weights = pool.map(p => p.scores.total + 0.15); // antes al cubo: casi siempre frenaba en la #1
  let r = Math.random() * weights.reduce((a, b) => a + b, 0), win = 0;
  while (win < pool.length - 1 && (r -= weights[win]) > 0) win++;
  let k = 0;
  const total = pool.length * 2 + win + 1;
  const tick = () => {
    const i = deckIndex + (k % pool.length);
    $('#deck').innerHTML = deckCard(deck[i], i);
    $('#deck .dcard').classList.add('spinning');
    if (++k < total) { setTimeout(tick, 45 + k * k * 1.6); return; }
    const landed = deckIndex + win;
    [deck[deckIndex], deck[landed]] = [deck[landed], deck[deckIndex]];
    $('#deck').innerHTML = ''; // el orden cambió: se arma de cero
    renderDeck();
    document.querySelector(`.dcard[data-i="${deckIndex}"]`)?.classList.add('landed');
  };
  tick();
}

function confetti() {
  const host = document.querySelector('.match');
  if (!host) return;
  const colors = ['#E4002B', '#FFC72C', '#FF7A00', '#1D1A17'];
  for (let i = 0; i < 42; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.cssText = `background:${colors[i % 4]};--dx:${(Math.random() - .5) * 360}px;--dy:${-140 - Math.random() * 220}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * .12}s`;
    host.appendChild(c);
  }
}

// =====================================================================
// Paleta de comandos (Ctrl/⌘ K) y atajos de teclado
// =====================================================================
let commands = [], cmdSel = 0;
function buildCommands(q) {
  const nq = norm(q.trim());
  const go = (patch, after) => () => { Object.assign(ui, patch); if (after) setTimeout(after, 60); };
  const base = [
    ...Object.entries(engine.hungerLevels()).map(([k, l], i) => ({ g: 'Hambre', t: `${HUNGER_EMOJI[k]} ${l}`, k: `${i + 1}`, run: go({ hunger: k, tab: 'home' }) })),
    { g: 'Comida', t: '🍽️ Todo', run: go({ category: 'all', tab: 'home' }) },
    ...Object.entries(CATS).map(([k, c]) => ({ g: 'Comida', t: `${look(k).e} ${c.label}`, run: go({ category: k, tab: 'home' }) })),
    ...[10000, 15000, 20000, 30000].map(m => ({ g: 'Plata', t: `💵 Tengo ${ars(m)}`, run: go({ money: m, tab: 'home' }) })),
    { g: 'Acciones', t: '🎰 Decidí por mí', k: 'D', run: go({ tab: 'home' }, openDecide) },
    { g: 'Acciones', t: '⚡ Mapa Rico × Barato', k: 'M', run: go({ results: 'map', tab: 'home' }) },
    { g: 'Acciones', t: '💸 Lo más barato', run: go({ ricoWeight: 0, tab: 'home' }) },
    { g: 'Acciones', t: '😋 Lo más rico', run: go({ ricoWeight: 1, tab: 'home' }) },
    { g: 'Acciones', t: '👥 Somos 2', run: go({ people: 2, tab: 'home' }) },
    ...[['home', 'Inicio'], ['top', 'Top'], ['taste', 'Mi gusto'], ['cart', 'Pedidos'], ['settings', 'Ajustes']].map(([id, l]) => ({ g: 'Ir a', t: `→ ${l}`, run: go({ tab: id }) })),
  ];
  const locales = nq.length >= 2 ? RESTAURANTS.filter(r => norm(r.name).includes(nq)).slice(0, 6)
    .map(r => ({ g: 'Locales', t: `🏪 ${r.name}`, run: go({}, () => { reopen = () => openMenu(r.id); openMenu(r.id); }) })) : [];
  return [...base.filter(c => !nq || norm(c.t).includes(nq) || norm(c.g).includes(nq)), ...locales].slice(0, 16);
}

function openPalette() {
  reopen = null;
  cmdSel = 0;
  $('#overlay').innerHTML = `<div class="sheet-wrap palette-wrap" id="sheet-wrap"><div class="palette">
    <div class="palette-in">${icon('search')}<input id="cmd" placeholder="Qué querés hacer… (hambre, sushi, $20.000, un local)" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="palette-list" id="cmd-list"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> elegir</span><span><kbd>1</kbd>–<kbd>4</kbd> hambre · <kbd>D</kbd> decidir · <kbd>M</kbd> mapa · <kbd>←</kbd><kbd>→</kbd> rico/barato</span></div>
  </div></div>`;
  renderPalette('');
  $('#cmd').focus();
}

function renderPalette(q) {
  commands = buildCommands(q);
  cmdSel = Math.min(cmdSel, Math.max(0, commands.length - 1));
  let g = '';
  $('#cmd-list').innerHTML = commands.map((c, i) => `${c.g !== g ? `<div class="pg">${esc((g = c.g))}</div>` : ''}
    <button class="pc ${i === cmdSel ? 'on' : ''}" data-cmd="${i}"><span>${esc(c.t)}</span>${c.k ? `<kbd>${c.k}</kbd>` : ''}</button>`).join('')
    || '<div class="empty">Nada con eso.</div>';
  $('#cmd-list .pc.on')?.scrollIntoView({ block: 'nearest' });
}

function runCommand(i) {
  const c = commands[i];
  if (!c) return;
  closeSheet();
  c.run(); saveUi(); render();
}

document.addEventListener('input', e => { if (e.target.id === 'cmd') { cmdSel = 0; renderPalette(e.target.value); } });

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { closeSheet(); reopen = null; document.querySelector('.assistant-fab')?.classList.remove('open'); $('#assistant-dock')?.classList.remove('on'); return; }
  if (e.target.id === 'cmd') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) % Math.max(1, commands.length);
      renderPalette(e.target.value);
    }
    if (e.key === 'Enter') runCommand(cmdSel);
    return;
  }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('.decide')) {
    if (e.key === 'ArrowRight') swipe('right');
    if (e.key === 'ArrowLeft') swipe('left');
    return;
  }
  if ($('#sheet-wrap')) return;
  const key = e.key.toLowerCase();
  const levels = Object.keys(engine.hungerLevels());
  if (/^[1-4]$/.test(key)) { ui.hunger = levels[+key - 1]; ui.tab = 'home'; saveUi(); render(); }
  else if (key === 'd') { if (ui.tab !== 'home') { ui.tab = 'home'; render(); } openDecide(); }
  else if (key === 'm') { ui.results = ui.results === 'map' ? 'cards' : 'map'; ui.tab = 'home'; saveUi(); render(); }
  else if (key === '/') { e.preventDefault(); if (ui.tab === 'home') $('#search')?.focus(); else openPalette(); }
  else if ((key === 'arrowleft' || key === 'arrowright') && ui.tab === 'home') {
    ui.ricoWeight = Math.max(0, Math.min(1, +(ui.ricoWeight + (key === 'arrowright' ? 0.1 : -0.1)).toFixed(2)));
    saveUi();
    const bal = $('#balance');
    if (bal) bal.value = ui.ricoWeight;
    $('#balance-hint').textContent = balanceHint();
    schedule(renderResults);
  }
}

// =====================================================================
// Señales de Google y Morfy (data/signals.json)
// =====================================================================
function variantLabel(v) {
  return { 'un-poco-menos': ' · un poco menos', 'tu-favorito': ' · ❤️ tu favorito', 'recomendado': ' · ✅ el recomendado' }[v] || '';
}

function signalsHtml(signals) {
  if (!signals?.length) return '';
  return `<div class="signals">${signals.map(s => `
    <span class="signal ${s.source}">${s.source === 'morfy' ? `<b>${s.approval}%</b>` : '🔎'} ${esc(s.text)}</span>`).join('')}</div>`;
}

// Reputación en Google: barra de reseñas positivas / neutras / negativas + lo que más se menciona.
function reputationHtml(r) {
  if (r.googlePositive == null && !r.mentions?.length) return '';
  const pos = r.googlePositive ?? 0, neg = r.googleNegative ?? 0, mid = Math.max(0, 100 - pos - neg);
  return `<div class="reputation ${neg >= 15 ? 'split' : ''}">
    <div class="rep-head"><b>Google ${r.googleRating ?? ''}</b><span>${r.googleReviews ? `${r.googleReviews.toLocaleString('es-AR')} opiniones` : ''}</span>
      ${neg >= 15 ? '<span class="rep-warn">⚠️ Opiniones divididas</span>' : ''}</div>
    ${r.googlePositive != null ? `<div class="rep-bar" role="img" aria-label="${pos}% positivas, ${neg}% negativas">
      <i class="pos" style="width:${pos}%"></i><i class="mid" style="width:${mid}%"></i><i class="neg" style="width:${neg}%"></i></div>
    <div class="rep-legend"><span>👍 ${pos}% de 4-5★</span><span>👎 ${neg}% de 1-2★</span></div>` : ''}
    ${r.mentions?.length ? `<ul class="rep-mentions">${r.mentions.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// Planes armados con tus favoritos, aunque no ganen el ranking general ni entren justo en la plata:
// si se pasan, se muestra por cuánto.
var favPlans = []; // var: se usa en el primer render, antes de esta línea
function renderFavRail() {
  const host = $('#fav-wrap');
  if (!host) return;
  const favs = engine.getState().favorites;
  if (!favs.length) { host.innerHTML = ''; return; }
  const free = engine.recommend({
    hunger: ui.hunger, categories: ui.category === 'all' ? undefined : [ui.category],
    ricoWeight: ui.ricoWeight, people: ui.people, map: true,
  });
  const money = ui.money ?? Infinity;
  favPlans = free.all.filter(p => p.lines.some(l => favs.includes(l.itemId)))
    .sort((a, b) => (a.total > money) - (b.total > money) || b.scores.total - a.scores.total).slice(0, 6);
  const plans = favPlans;
  host.innerHTML = plans.length ? `
    <div class="section-head"><h2>❤️ Lo que ya sabés que te gusta</h2><span>armado con tus favoritos</span></div>
    <div class="rail">${plans.map(p => `
      <div class="mini fav-mini" data-plan="${esc(p.id)}">
        <div class="cover" ${coverStyle(p.category)}>${coverHtml({ category: p.category, imageUrl: planImage(p) })}</div>
        <h4>${esc(p.lines.map(l => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.name}`).join(' + '))}</h4>
        <p>${esc(p.restaurant.name)}</p>
        <p class="price-mini">${ars(p.total)} · ${p.quantity} ${unitLabel(p.quantity, p.unit)}</p>
        ${p.total > (ui.money ?? Infinity) ? `<p class="over">+${ars(p.total - ui.money)} sobre tu plata</p>` : ''}
      </div>`).join('')}</div>` : '';
}

// Locales que otras fuentes recomiendan pero Rappi no tiene (no se pueden pedir desde acá).
function offRappiHtml() {
  const list = engine.notOnRappi();
  if (!list.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>Fuera de Rappi</h2><span>recomendados en Morfy</span></div>
    <div class="list">${list.map(x => `
      <div class="setting off-rappi">
        <div class="card-row"><h3>${esc(x.name)}</h3>${x.morfy ? `<span class="score">⭐ ${x.morfy.rating}</span>` : ''}</div>
        <p>${esc(x.address || '')}${x.morfy ? ` · ${x.morfy.reviews.toLocaleString('es-AR')} opiniones · +${x.morfy.chosenBy.toLocaleString('es-AR')} lo eligieron en Morfy` : ''}</p>
        ${x.topSellers?.length ? `<div class="list" style="margin-top:10px">${x.topSellers.map((t, i) => `
          <div class="line-item"><span class="q">#${i + 1}</span>
            <div class="row-main"><h4>${esc(t.name)}</h4><p>${ars(t.price)} · ${t.approval}% de aprobación (${t.votes} votos)</p></div></div>`).join('')}</div>` : ''}
        ${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}
      </div>`).join('')}</div>
  </section>`;
}

// =====================================================================
// Abierto ahora, distancia y envío
// =====================================================================
function km(d) { return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace('.', ',')} km`; }

function placeHtml(r) {
  const o = r.open || {};
  const bits = [];
  if (o.known) bits.push(`<span class="chip-open ${o.open ? (o.closingSoon ? 'soon' : 'yes') : 'no'}">${o.open ? '🟢' : '🔴'} ${esc(o.label)}</span>`);
  if (r.distanceKm != null) bits.push(`<span>📍 a ${km(r.distanceKm)} de tu casa</span>`);
  return bits.length ? `<div class="place">${bits.join('')}</div>` : '';
}

// =====================================================================
// Historial de precios y otras apps
// =====================================================================
function sparkline(points) {
  if (!points || points.length < 3) return '';
  const W = 90, H = 24, ys = points.map(p => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1) * W).toFixed(1)},${(H - 2 - (p[1] - lo) / span * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-label="Precio en los últimos ${points.length} relevamientos"><path d="${d}"/></svg>`;
}

function priceChangeHtml(x) {
  const out = [];
  const c = x.priceChange;
  if (c) {
    const when = new Date(`${c.since}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    out.push(`<span class="pchange ${c.pct < 0 ? 'down' : 'up'}">${c.pct < 0 ? '📉 Bajó' : '📈 Subió'} de ${ars(c.from)} a ${ars(c.to)} (${c.pct > 0 ? '+' : ''}${c.pct}%) desde el ${when}</span>`);
  }
  if (x.inflatedOriginal) out.push('<span class="pchange warn">⚠️ El precio tachado es más alto que cualquiera al que lo vimos vender</span>');
  const sp = sparkline(x.priceHistory);
  return out.length || sp ? `<div class="prices">${out.join('')}${sp}</div>` : '';
}

const APP_NAMES = { morfy: 'Morfy', pedidosya: 'PedidosYa', rappi: 'Rappi' };
function otherAppsHtml(list, price) {
  if (!list?.length) return '';
  return `<div class="other-apps">${list.map(o => {
    const cheaper = o.same && o.price < price;
    return `<span class="oapp ${cheaper ? 'cheaper' : ''}">${cheaper ? `💸 ${ars(price - o.price)} más barato en ${APP_NAMES[o.app] || esc(o.app)}` : `En ${APP_NAMES[o.app] || esc(o.app)}: ${ars(o.price)}`}${o.note ? ` · ${esc(o.note)}` : ''}</span>`;
  }).join('')}</div>`;
}

function dropsListHtml() {
  const days = engine.priceTracking().days;
  const drops = engine.priceDrops({ limit: 40 });
  const since = days[0] ? new Date(`${days[0]}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : null;
  if (!drops.length) {
    return `<div class="empty-state"><div class="e">📉</div><h3>Todavía no hay bajas</h3>
      <p>${days.length < 2
        ? `Empecé a seguir los precios${since ? ` el ${since}` : ''}. Las bajas aparecen cuando haya otro relevamiento para comparar (corré <code>tools/actualizar.ps1</code>).`
        : 'Entre los últimos dos relevamientos ningún plato que comés bajó 5% o más.'}</p></div>`;
  }
  return drops.map((it, i) => `
    <div class="row">
      <span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
      ${thumb(catOfItem(it), it.imageUrl)}
      <div class="row-main click" data-rest="${esc(it.restaurant.id)}">
        <h4>${esc(it.name)}</h4>
        <p>${esc(it.restaurant.name)}</p>
        <div class="price">${ars(it.price)}<s>${ars(it.priceChange.from)}</s></div>
      </div>
      <span class="score down">${it.priceChange.pct}%</span>
    </div>`).join('');
}

// =====================================================================
// Inicio: pedir hablando, "¿estuvo rico?", bajas en favoritos, cerrados
// =====================================================================
function askBarHtml() {
  const temp = ui.tempExclude || [];
  return `
    <section class="ask">
      <div class="ask-in">
        <span class="ask-ico">💬</span>
        <input id="ask" placeholder="Contame: ${esc(askExample())}" autocomplete="off" value="${esc(ui.askText || '')}">
        ${'webkitSpeechRecognition' in window || 'SpeechRecognition' in window ? `<button class="ask-mic" data-mic aria-label="Dictar">🎤</button>` : ''}
        <button class="btn red ask-go" data-ask>Armar</button>
      </div>
      ${ui.askUnderstood?.length || temp.length ? `<div class="ask-chips">
        ${(ui.askUnderstood || []).map(u => `<span class="achip">✓ ${esc(u)}</span>`).join('')}
        ${temp.length ? `<button class="achip x" data-clear-temp>Solo para este pedido: sin ${esc(temp.join(', '))} ✕</button>` : ''}
        ${ui.askClaude ? `<span class="achip ai">✨ ${esc(ui.askClaude)}</span>` : ''}
      </div>` : ''}
      ${ui.askUnknown?.length ? `<div class="ask-unknown">No entendí: “${esc(ui.askUnknown.join(', '))}”.
        ${hasAI() ? `<button class="linkish" data-claude>Preguntarle a la ${esc(aiLabel())} ✨</button>` : '<button class="linkish" data-tab="settings">Conectá una IA en Ajustes</button> para frases más libres.'}</div>` : ''}
    </section>`;
}

function applyIntent(intent, { fromClaude = false } = {}) {
  if (intent.people) ui.people = Math.max(1, Math.min(12, intent.people));
  if (intent.money != null) ui.money = Number.isFinite(intent.money) ? intent.money : null;
  if (intent.hunger) ui.hunger = intent.hunger;
  if (intent.category && engine.getState().profile.enabledCategories.includes(intent.category)) ui.category = intent.category;
  if (intent.ricoWeight != null) ui.ricoWeight = Math.max(0, Math.min(1, intent.ricoWeight));
  ui.tempExclude = intent.exclude || [];
  ui.askUnderstood = intent.understood || [];
  ui.askUnknown = fromClaude ? [] : intent.unknown || [];
  ui.askClaude = fromClaude ? intent.summary : null;
  saveUi(); render();
}

async function askClaude() {
  const text = ui.askText || $('#ask')?.value || '';
  if (!text.trim()) return;
  toast(`✨ Preguntándole a la ${aiLabel()}…`);
  try {
    const ai = await interpretWithAI(text);
    // Lo que el intérprete local entendió con seguridad manda; la IA completa lo que faltó.
    // Las exclusiones se suman: perder un "vegano" es peor que sacar algo de más.
    const mine = parseIntent(text);
    const pick = k => mine[k] ?? ai[k] ?? null;
    applyIntent({
      people: pick('people'), money: pick('money'), hunger: pick('hunger'), category: pick('category'), ricoWeight: pick('ricoWeight'),
      exclude: [...new Set([...(mine.exclude || []), ...(ai.exclude || [])])],
      summary: ai.summary, understood: [],
    }, { fromClaude: true });
  } catch (err) { toast(err.message); }
}

// Frase escrita o dictada: primero el intérprete local (instantáneo). Si quedó algo sin entender y hay
// IA local (gratis), se le pregunta sola; con Claude (se cobra) queda el botón para que decida el usuario.
function understand(text) {
  ui.askText = text;
  const r = parseIntent(text);
  applyIntent(r);
  if (r.unknown.length && activeProvider() === 'local') askClaude();
}

function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const rec = new SR();
  rec.lang = 'es-AR'; rec.interimResults = false; rec.maxAlternatives = 1;
  const btn = $('[data-mic]');
  btn?.classList.add('rec');
  rec.onresult = e => understand(e.results[0][0].transcript);
  rec.onerror = e => toast(e.error === 'not-allowed' ? 'Sin permiso para el micrófono' : 'No te escuché, probá de nuevo');
  rec.onend = () => btn?.classList.remove('rec');
  rec.start();
}

function renderExtras(r) {
  // Locales cerrados
  const note = $('#closed-note');
  const far = r.far ? ` Otros ${r.far} abiertos quedan afuera por demora o distancia.` : '';
  if (note) note.innerHTML = r.closed && !ui.showClosed
    ? `<div class="closed-note">🌙 ${r.closed} locales ${r.at ? `van a estar cerrados ${whenLabel()}` : 'están cerrados ahora'} y no los muestro.${far} <button class="linkish" data-showclosed>Ver igual</button></div>`
    : ui.showClosed ? `<div class="closed-note">Mostrando también locales cerrados.${far} <button class="linkish" data-showclosed>Ocultarlos</button></div>`
    : far ? `<div class="closed-note">📍${far}</div>` : '';
  // ¿Estuvo rico?
  const rate = $('#rate-wrap');
  const pending = engine.pendingRatings()[0];
  if (rate) rate.innerHTML = pending ? `
    <section class="rate">
      <div><small>Hace un rato pediste</small><b>${esc(pending.title)}</b><span>¿Estuvo rico? Con esto aprendo qué te gusta.</span></div>
      <div class="rate-btns">
        <button class="btn primary" data-rate="${esc(pending.id)}:up">👍 Rico</button>
        <button class="btn ghost" data-rate="${esc(pending.id)}:down">👎 Meh</button>
        <button class="linkish" data-skip="${esc(pending.id)}">Después</button>
      </div>
    </section>` : '';
  // Bajas en lo que te gusta
  const drops = $('#drops-wrap');
  const alerts = engine.priceAlerts();
  if (drops) drops.innerHTML = alerts.length ? `
    <div class="section-head"><h2>📉 Bajó lo que te gusta</h2><button data-tab="top" data-toptab="drops">Ver todas</button></div>
    <div class="rail">${alerts.slice(0, 8).map(it => `
      <div class="mini" data-rest="${esc(it.restaurant.id)}">
        <div class="cover" ${coverStyle(catOfItem(it))}>${coverHtml({ category: catOfItem(it), imageUrl: it.imageUrl })}</div>
        <h4>${esc(it.name)}</h4><p>${esc(it.restaurant.name)}</p>
        <p class="price-mini">${ars(it.price)} <s>${ars(it.priceChange.from)}</s> <b class="down">${it.priceChange.pct}%</b></p>
      </div>`).join('')}</div>` : '';
}

// =====================================================================
// Pedidos: historial con calificación, carga de ticket o a mano
// =====================================================================
function historyHtml(orders) {
  if (!orders.length) return '';
  const list = [...orders].reverse().slice(0, 20);
  return `<section class="section"><div class="section-head"><h2>Historial</h2><span>${orders.length} pedidos</span></div>
    <div class="list">${list.map(o => `
      <div class="row order-row">
        <div class="row-main"><h4>${esc(o.title)}</h4>
          <p>${new Date(o.at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          ${o.source === 'ticket' ? ' · 📸 ticket' : o.source === 'manual' ? ' · ✍️ a mano' : ''}${o.tip ? ` · propina ${ars(o.tip)}` : ''}</p>
          <div class="order-rate">${o.rating === 'up' ? '<span class="rated up">👍 Estuvo rico</span>' : o.rating === 'down' ? '<span class="rated down">👎 No te gustó</span>'
            : (o.lines || []).some(l => l.itemId) ? `<button class="btn ghost sm" data-rate="${esc(o.id)}:up">👍</button><button class="btn ghost sm" data-rate="${esc(o.id)}:down">👎</button>` : ''}</div>
        </div>
        <span class="score">${ars(o.total)}</span>
      </div>`).join('')}</div></section>`;
}

function cartToolsHtml() {
  return `<div class="cart-tools">
    <button class="btn ghost" data-ticket>📸 Cargar ticket</button>
    <button class="btn ghost" data-manual>✍️ Cargar a mano</button>
  </div>`;
}

function openTicket({ withPhoto }) {
  reopen = null;
  const names = [...new Set(RESTAURANTS.map(r => r.name))];
  openSheet(`
    <div class="sheet-body form-sheet">
      <div class="sheet-title-row"><h2>${withPhoto ? '📸 Cargar ticket' : '✍️ Cargar un pedido'}</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></div>
      <p class="note">Para registrar algo que pediste por fuera de la app: suma al gasto del mes y después te pregunto si estuvo rico.</p>
      ${withPhoto ? `<label class="drop">
          <input id="ticket-file" type="file" accept="image/*" capture="environment" hidden>
          <span>📷 Sacar o elegir la foto del ticket</span>
          <small>${hasAI() ? `La ${esc(aiLabel())} lo lee y completa el formulario.` : 'Sin IA conectada la foto no se lee sola: completá los datos abajo.'}</small>
        </label><div id="ticket-status"></div>` : ''}
      <label class="fld"><span>Local</span><input id="t-rest" list="t-rest-list" placeholder="Ej: Dean & Dennys - Palermo"></label>
      <datalist id="t-rest-list">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="fld-row">
        <label class="fld"><span>Total pagado</span><input id="t-total" inputmode="numeric" placeholder="$"></label>
        <label class="fld"><span>Envío</span><input id="t-fee" inputmode="numeric" placeholder="$"></label>
        <label class="fld"><span>Propina</span><input id="t-tip" inputmode="numeric" placeholder="$"></label>
      </div>
      <label class="fld"><span>Fecha</span><input id="t-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="fld"><span>Qué pediste (opcional, uno por línea)</span><textarea id="t-items" rows="3" placeholder="2 Doble Dean Burger"></textarea></label>
      <button class="btn primary block" data-save-order>Guardar pedido</button>
    </div>`);
}

async function onTicketFile(file) {
  const status = $('#ticket-status');
  if (!hasAI()) { status.innerHTML = '<p class="note">Foto cargada. Completá los datos a mano.</p>'; return; }
  status.innerHTML = `<p class="note">✨ La ${esc(aiLabel())} está leyendo el ticket…</p>`;
  try {
    const t = await readTicket(file);
    const set = (id, v) => { if (v != null && $(id)) $(id).value = v; };
    const match = t.restaurant && RESTAURANTS.find(r => norm(r.name).includes(norm(t.restaurant)) || norm(t.restaurant).includes(norm(r.name.split(' - ')[0])));
    set('#t-rest', match ? match.name : t.restaurant);
    set('#t-total', t.total); set('#t-fee', t.deliveryFee); set('#t-tip', t.tip); set('#t-date', t.date);
    set('#t-items', (t.items || []).map(i => `${i.qty > 1 ? `${i.qty} ` : ''}${i.name}`).join('\n'));
    status.innerHTML = `<p class="note">${t.confidence === 'alta' ? '✅ Listo, revisá y guardá.' : '⚠️ Algunos datos no se leían bien: revisalos antes de guardar.'}</p>`;
  } catch (err) { status.innerHTML = `<p class="note">${esc(err.message)} Completá los datos a mano.</p>`; }
}

function saveExternalOrder() {
  const money = id => +String($(id)?.value || '').replace(/\D/g, '') || null;
  const total = money('#t-total');
  if (!total) { toast('Falta el total'); return; }
  const name = $('#t-rest').value.trim();
  const rest = RESTAURANTS.find(r => norm(r.name) === norm(name));
  const menu = rest ? engine.menu(rest.id) : [];
  const lines = $('#t-items').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(\d+)\s*x?\s+(.*)$/i);
    const qty = m ? +m[1] : 1, label = m ? m[2] : s;
    const item = menu.find(i => norm(i.name) === norm(label)) || menu.find(i => norm(i.name).includes(norm(label)));
    return { qty, name: item ? item.name : label, itemId: item?.id || null, price: item?.price ?? null };
  });
  const date = $('#t-date').value;
  engine.addExternalOrder({
    restaurantId: rest?.id || null, restaurantName: name || 'Pedido', total,
    deliveryFee: money('#t-fee'), tip: money('#t-tip'), lines,
    // Hoy = ahora; otro día = a la noche, que es cuando más se pide.
    at: !date || date === new Date().toLocaleDateString('sv') ? Date.now() : new Date(`${date}T21:00:00`).getTime(),
    source: $('#ticket-file') ? 'ticket' : 'manual',
  });
  closeSheet();
  toast('✅ Pedido guardado');
}

// =====================================================================
// Dividir la cuenta
// =====================================================================
var splitState = null; // var: se usa desde el primer render
function openSplit(plan) {
  const n = Math.max(2, ui.people || 2);
  const each = Math.floor(plan.quantity / n), extra = plan.quantity - each * n;
  splitState = { plan, tipPct: 10, people: Array.from({ length: n }, (_, i) => ({ name: i ? '' : 'Yo', units: each + (i < extra ? 1 : 0) })) };
  renderSplit();
}

function renderSplit() {
  const { plan, people, tipPct } = splitState;
  const res = splitBill({ subtotal: plan.subtotal, deliveryFee: plan.deliveryFee || 0, tipPct,
    people: people.map((p, i) => ({ name: p.name || `Persona ${i + 1}`, units: p.units })) });
  const assigned = people.reduce((s, p) => s + p.units, 0);
  reopen = null;
  openSheet(`
    <div class="sheet-body form-sheet">
      <div class="sheet-title-row"><h2>➗ Dividir la cuenta</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></div>
      <p class="note">${esc(plan.restaurant.name)} · ${plan.quantity} ${unitLabel(plan.quantity, plan.unit)} · ${ars(plan.subtotal)} + envío ${ars(plan.deliveryFee || 0)}.
        Cada uno paga lo que come; envío y propina, parejo.</p>
      <div class="split-people">${people.map((p, i) => `
        <div class="split-row">
          <input class="split-name" data-split-name="${i}" value="${esc(p.name)}" placeholder="Persona ${i + 1}">
          <div class="stepper"><div><button data-split-units="${i}:-1">−</button><span>${p.units}</span><button data-split-units="${i}:1">+</button></div></div>
          <b>${ars(res.shares[i].amount)}</b>
        </div>`).join('')}</div>
      <div class="split-actions">
        <button class="btn ghost sm" data-split-people="1">+ persona</button>
        ${people.length > 2 ? '<button class="btn ghost sm" data-split-people="-1">− persona</button>' : ''}
        <span class="${assigned === plan.quantity ? 'ok' : 'warn'}">${assigned} de ${plan.quantity} ${esc(plan.unit)} repartidas</span>
      </div>
      <div class="tagset">${[0, 10, 15].map(t => `<button class="${tipPct === t ? 'on' : ''}" data-split-tip="${t}">${t ? `Propina ${t}%` : 'Sin propina'}</button>`).join('')}</div>
      <div class="summary"><div class="line total"><span>Total${res.tip ? ` (propina ${ars(res.tip)})` : ''}</span><span>${ars(res.total)}</span></div></div>
      <div class="split-share">
        <button class="btn ghost" data-split-copy>📋 Copiar</button>
        <a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(splitMessage({ restaurant: plan.restaurant.name, lines: plan.lines, split: res, fmt: ars }))}">Mandar por WhatsApp</a>
      </div>
    </div>`);
  splitState.result = res;
}

// =====================================================================
// Ajustes: Claude, app instalable, avisos
// =====================================================================
var installPrompt = null;
function extraSettingsHtml() {
  const days = engine.priceTracking().days;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
    ${aiSettingsHtml()}
    <div class="setting">
      <h3>📲 App y avisos</h3>
      <p>Instalala en el celular o la compu: abre sola, sin barra del navegador, y funciona sin internet con el último catálogo.</p>
      <div class="cart-actions">
        <button class="btn primary sm" data-install ${installPrompt ? '' : 'disabled'}>${installPrompt ? 'Instalar Rico y Barato' : matchMedia('(display-mode: standalone)').matches ? 'Ya está instalada' : 'Instalar (desde el menú del navegador)'}</button>
        <button class="btn ghost sm" data-notify ${perm === 'granted' || perm === 'unsupported' ? 'disabled' : ''}>${perm === 'granted' ? '🔔 Avisos activados' : perm === 'denied' ? '🔕 Avisos bloqueados en el navegador' : perm === 'unsupported' ? 'Este navegador no tiene avisos' : '🔔 Avisarme bajas de precio'}</button>
      </div>
      <p class="note">Los avisos saltan al abrir la app cuando bajó de precio algo que tenés en favoritos. Precios seguidos: ${days.length ? days.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })).join(', ') : 'todavía ninguno'}.</p>
    </div>`;
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (ui.tab === 'settings') render(); });

async function notifyPriceDrops() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const seenKey = 'ryb:notified';
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey)) || []; } catch {}
  const fresh = engine.priceAlerts().filter(it => !seen.includes(`${it.id}@${it.price}`));
  if (!fresh.length) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const body = fresh.slice(0, 3).map(it => `${it.name}: ${ars(it.priceChange.from)} → ${ars(it.price)}`).join('\n');
  const title = fresh.length === 1 ? '📉 Bajó algo que te gusta' : `📉 Bajaron ${fresh.length} cosas que te gustan`;
  if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'bajas' });
  else new Notification(title, { body });
  try { localStorage.setItem(seenKey, JSON.stringify([...seen, ...fresh.map(it => `${it.id}@${it.price}`)].slice(-200))); } catch {}
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => { reg.update(); notifyPriceDrops(); }).catch(() => {});
  // Cuando se activa una versión nueva, recargar una vez para usarla ya (si no, la tablet seguía con la vieja).
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    location.reload();
  });
}

// =====================================================================
// Clics y teclas de las funciones de esta sección
// =====================================================================
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-ask],[data-mic],[data-claude],[data-clear-temp],[data-showclosed],[data-rate],[data-skip],[data-split],[data-split-units],[data-split-people],[data-split-tip],[data-split-copy],[data-ticket],[data-manual],[data-save-order],[data-key-save],[data-key-test],[data-key-clear],[data-install],[data-notify],[data-ai-provider],[data-ai-detect]');
  if (!t) return;
  const d = t.dataset;
  if ('ask' in d) { understand($('#ask').value); return; }
  if ('mic' in d) { listen(); return; }
  if ('claude' in d) { askClaude(); return; }
  if ('clearTemp' in d) { ui.tempExclude = []; ui.askUnderstood = []; saveUi(); render(); return; }
  if ('showclosed' in d) { ui.showClosed = !ui.showClosed; render(); return; }
  if (d.rate) { const [id, v] = d.rate.split(':'); engine.rateOrder(id, v); toast(v === 'up' ? '👍 Anotado: lo sumo a tus favoritos' : '👎 Anotado: no te lo voy a recomendar'); return; }
  if (d.skip) { engine.skipRating(d.skip); return; }
  if (d.split) { e.stopPropagation(); const p = findPlan(d.split); if (p) openSplit(p); return; }
  if (d.splitUnits) { const [i, delta] = d.splitUnits.split(':').map(Number); splitState.people[i].units = Math.max(0, splitState.people[i].units + delta); renderSplit(); return; }
  if (d.splitPeople) {
    if (+d.splitPeople > 0) splitState.people.push({ name: '', units: 0 }); else if (splitState.people.length > 2) splitState.people.pop();
    renderSplit(); return;
  }
  if (d.splitTip) { splitState.tipPct = +d.splitTip; renderSplit(); return; }
  if ('splitCopy' in d) {
    const text = splitMessage({ restaurant: splitState.plan.restaurant.name, lines: splitState.plan.lines, split: splitState.result, fmt: ars });
    try { await navigator.clipboard.writeText(text); toast('📋 Copiado'); } catch { toast('No se pudo copiar'); }
    return;
  }
  if ('ticket' in d) { openTicket({ withPhoto: true }); return; }
  if ('manual' in d) { openTicket({ withPhoto: false }); return; }
  if ('saveOrder' in d) { saveExternalOrder(); return; }
  if ('keySave' in d) { const k = $('#ai-key').value.trim(); if (!k) { toast('Pegá la clave primero'); return; } setKey(k); toast('🔑 Clave guardada en este navegador'); render(); return; }
  if ('keyTest' in d) { toast('Probando…'); const t0 = performance.now(); try { await testAI(); toast(`✅ ${aiLabel()} responde (${((performance.now() - t0) / 1000).toFixed(1)} s)`); } catch (err) { toast(err.message); } return; }
  if (d.aiProvider) { setProvider(d.aiProvider); render(); return; }
  if ('aiDetect' in d) { toast('Buscando la IA local…'); await detectLocal(); toast(localStatus().up ? '🟢 IA local encontrada' : '🔴 No está corriendo'); render(); return; }
  if ('keyClear' in d) { setKey(''); toast('Clave borrada'); render(); return; }
  if ('install' in d && installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); return; }
  if ('notify' in d) { const p = await Notification.requestPermission(); toast(p === 'granted' ? '🔔 Listo, te aviso las bajas' : 'Sin permiso para avisos'); render(); notifyPriceDrops(); return; }
});

document.addEventListener('input', e => {
  if (e.target.id === 'ask') ui.askText = e.target.value;
  if (e.target.dataset?.splitName != null && splitState) splitState.people[+e.target.dataset.splitName].name = e.target.value;
});
document.addEventListener('change', e => {
  if (e.target.id === 'ticket-file' && e.target.files[0]) onTicketFile(e.target.files[0]);
  if (e.target.dataset?.splitName != null && splitState) renderSplit();
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'ask' && e.key === 'Enter') understand(e.target.value);
});

// =====================================================================
// Ajustes de IA: local (Ollama en esta compu) o Claude (clave propia)
// =====================================================================
function aiSettingsHtml() {
  const st = localStatus();
  const prov = getProvider();
  const active = activeProvider();
  const localLine = !st.checked ? 'Buscando…'
    : !st.up ? '🔴 No está corriendo. Arrancala con <code>tools\\ia-local.ps1</code>.'
    : st.hasModel ? `🟢 Corriendo con <b>${esc(st.model)}</b> en tu compu. Sin costo y sin mandar nada afuera.`
    : `🟡 Corriendo, pero falta el modelo <b>${esc(st.model)}</b>. Lo baja <code>tools\\ia-local.ps1</code>.`;
  return `
    <div class="setting">
      <h3>✨ IA ${active ? `<span class="ai-on">· usando ${esc(aiLabel())}</span>` : '<span class="ai-off">· apagada</span>'}</h3>
      <p>"Pedir hablando" entiende frases libres y la foto del ticket se lee sola.</p>
      <div class="tagset">${[['auto', 'Automático'], ['local', 'Local'], ['claude', 'Claude'], ['off', 'Apagada']]
        .map(([k, l]) => `<button class="${prov === k ? 'on' : ''}" data-ai-provider="${k}">${l}</button>`).join('')}</div>
      <div class="ai-box">
        <b>💻 Local</b>
        <p>${localLine}</p>
        <div class="cart-actions"><button class="btn ghost sm" data-ai-detect>Volver a buscar</button></div>
      </div>
      <div class="ai-box">
        <b>☁️ Claude</b>
        <p>Con tu clave de API de Anthropic. Queda solo en este navegador y cada consulta se cobra en tu cuenta.
          Es la opción para cuando la app la usen otros: ahí conviene un servidor propio que guarde la clave.</p>
        <div class="field"><span>🔑</span><input id="ai-key" type="password" autocomplete="off" placeholder="${hasKey() ? '•••••••• (guardada)' : 'sk-ant-…'}"></div>
        <div class="cart-actions">
          <button class="btn ghost sm" data-key-save>Guardar clave</button>
          ${hasKey() ? '<button class="btn ghost sm" data-key-clear>Borrar</button>' : ''}
        </div>
      </div>
      <div class="cart-actions"><button class="btn primary sm" data-key-test ${active ? '' : 'disabled'}>Probar la IA</button></div>
    </div>`;
}

// Al arrancar se busca la IA local; si aparece, se redibuja lo que depende de ella.
detectLocal().then(() => { warmLocal(); if (ui.tab === 'settings' || ui.askUnknown?.length) render(); });

// =====================================================================
// Asistente por voz (botón rojo abajo a la derecha) — ver ui/assistant.js
// =====================================================================
mountAssistant({
  engine, parseIntent, ars, esc, look, unitLabel, toast,
  openPlan: id => { reopen = () => openPlan(id); openPlan(id); },
  // Un plan por local primero: con el ranking crudo Mila veía cinco variantes del mismo lugar.
  getResult: () => { const r = currentResult(); return { ...r, options: onePerPlace(r.options) }; },
  setFilters: i => {
    if (i.people) ui.people = Math.max(1, Math.min(12, i.people));
    if (i.money != null) ui.money = Number.isFinite(i.money) ? i.money : null;
    if (i.hunger) ui.hunger = i.hunger;
    if (i.category && engine.getState().profile.enabledCategories.includes(i.category)) ui.category = i.category;
    if (i.ricoWeight != null) ui.ricoWeight = i.ricoWeight;
    if (i.exclude?.length) ui.tempExclude = [...new Set([...(ui.tempExclude || []), ...i.exclude])];
    saveUi(); if (ui.tab !== 'home') ui.tab = 'home'; render();
  },
  describeFilters: () => `${ui.people} persona(s), hambre ${ui.hunger}, ${ui.category === 'all' ? 'cualquier comida' : ui.category}, `
    + `${ui.money ? `${ui.money} pesos` : 'sin límite de plata'}, ${ui.ricoWeight < 0.4 ? 'prioriza barato' : ui.ricoWeight > 0.6 ? 'prioriza rico' : 'mitad rico mitad barato'}`
    + `${ui.tempExclude?.length ? `, sin ${ui.tempExclude.join(', ')}` : ''}`,
});

// =====================================================================
// Un solo asistente: el botón rojo (.va-fab).
// - Con IA local corriendo (esta compu) → Mila, que usa Ollama.
// - Sin IA local y con agente de ElevenLabs configurado (p. ej. la tablet por GitHub Pages) → ese agente
//   en la nube (ui/voice-agent.json), que se cobra por minuto en la cuenta de ElevenLabs.
// - Sin ninguno de los dos → Mila en modo simple.
// El botón 🤖 del widget se saca para que nunca haya dos asistentes en pantalla.
// =====================================================================
document.querySelector('.assistant-fab')?.remove();
const useCloudAgent = () => activeProvider() !== 'local' && !!voiceAgent?.agentId && assistantOn();
document.addEventListener('click', e => {
  const fab = e.target.closest('.va-fab');
  if (!fab || !useCloudAgent()) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const dock = $('#assistant-dock');
  if (!dock) return;
  const open = !dock.classList.contains('on');
  dock.classList.toggle('on', open);
  fab.classList.toggle('open', open);
  if (open) mountAssistantWidget();
}, true);

// =====================================================================
// Frase de ejemplo de "Contame": cambia al azar en cada entrada a Inicio
// =====================================================================
function askExample() {
  const examples = [
    'somos 3, uno no come carne, 25 lucas y mucha hambre',
    'algo rico de sushi para dos, la plata no importa',
    'me muero de hambre y tengo 15 mil',
    'empanadas para picar, gasto poco',
    'somos 5 viendo el partido, 50 lucas, pizza',
    'algo liviano que no sea frito',
    'una milanga bien barata para mí',
    'con mi novia, algo rico y que no pase de 30 mil',
    'hamburguesas para cuatro, modo bestia',
    'sin TACC y sin lácteos, 20 lucas',
    'pasta casera para tres, mitad rico mitad barato',
    'nuggets para el pibe, que sea barato',
  ];
  // Una por entrada: se elige al pasar a Inicio y queda fija mientras se usa la pantalla.
  if (askExample.tab !== 'home' || !askExample.current) askExample.current = examples[Math.floor(Math.random() * examples.length)];
  askExample.tab = ui.tab;
  return askExample.current;
}

// Las filas del menú son botones: Enter o espacio las abren.
document.addEventListener('keydown', e => {
  const row = e.target.closest?.('[data-item]');
  if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
});

document.addEventListener('change', e => {
  if (e.target.id !== 'when-other') return;
  ui.when = e.target.value === '' ? null : +e.target.value;
  render();
});

// =====================================================================
// Resumen de gastos: por semana (barras), por comida y cuánto te ahorraste
// =====================================================================
function spendingHtml() {
  const s = engine.spendingSummary({ weeks: 8 });
  if (!s.orders) return '';
  const max = Math.max(...s.weeks.map(w => w.total), 1);
  const day = t => new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  const last = s.weeks.length - 1;
  const catMax = Math.max(...s.categories.map(c => c.total), 1);
  return `
    <section class="spending">
      <div class="section-head"><h2>Tus gastos</h2><span>${s.orders} pedido${s.orders === 1 ? '' : 's'} · promedio ${ars(s.average)}</span></div>
      ${s.comparable ? `<div class="saved ${s.saved >= 0 ? '' : 'neg'}">
        <small>${s.saved >= 0 ? 'Te ahorraste' : 'Gastaste de más'}</small><b>${ars(Math.abs(s.saved))}</b>
        <span>contra lo que cuesta lo mismo en un local típico de tu zona (${s.comparable} pedido${s.comparable === 1 ? '' : 's'} comparable${s.comparable === 1 ? '' : 's'}, sin envío)</span>
      </div>` : ''}
      <h3 class="spend-title">Por semana</h3>
      <div class="weeks" role="img" aria-label="Gasto de las últimas 8 semanas">
        ${s.weeks.map((w, i) => `
          <div class="wk" title="Semana del ${day(w.start)}: ${ars(w.total)} · ${w.orders} pedido${w.orders === 1 ? '' : 's'}">
            <span class="wk-val">${i === last || w.total === max ? (w.total ? ars(w.total) : '') : ''}</span>
            <i style="height:${w.total ? Math.max(3, Math.round((w.total / max) * 100)) : 0}%"></i>
            <small>${i === last ? 'Esta' : day(w.start)}</small>
          </div>`).join('')}
      </div>
      <h3 class="spend-title">Por comida</h3>
      <div class="cats-spend">
        ${s.categories.map(c => `
          <div class="cs-row">
            <span class="cs-name">${look(c.category).e} ${esc(CATS[c.category]?.label || 'Otros')}</span>
            <span class="cs-bar"><i style="width:${Math.max(2, Math.round((c.total / catMax) * 100))}%"></i></span>
            <b>${ars(c.total)}</b>
          </div>`).join('')}
      </div>
    </section>`;
}


// =====================================================================
// Modo fitness: calorías ESTIMADAS y qué tan sano (engine/nutrition.js)
// =====================================================================
// Función (no const): la pantalla se dibuja antes de llegar a esta parte del archivo.
function healthClass(h) { return h >= 70 ? 'good' : h >= 50 ? 'ok' : h >= 30 ? 'heavy' : 'bad'; }
function dailyNeed() { return dailyKcal(ui.bodyWeight, ui.goal || 'mantener'); }

function fitnessBarHtml() {
  const need = dailyNeed();
  return `<div class="fit-bar">
    <div class="filter-row"><span class="filter-label">Máximo por persona</span>
      <div class="quick">${[[null, 'Sin límite'], [600, '600 kcal'], [800, '800 kcal'], [1000, '1000 kcal']].map(([k, lb]) => `<button class="${(ui.maxKcal ?? null) === k ? 'on' : ''}" data-kcal="${k ?? ''}">${lb}</button>`).join('')}</div>
    </div>
    <div class="filter-row fit-me"><span class="filter-label">Vos</span>
      <label class="fit-weight"><input id="body-weight" inputmode="numeric" value="${ui.bodyWeight || ''}" placeholder="peso"> kg</label>
      <div class="quick">${[['bajar', 'Bajar'], ['mantener', 'Mantener'], ['subir', 'Subir']].map(([g, lb]) => `<button class="${(ui.goal || 'mantener') === g ? 'on' : ''}" data-goal="${g}">${lb}</button>`).join('')}</div>
      <small>${need ? `Necesitás unas ${need.toLocaleString('es-AR')} kcal por día.` : 'Poné tu peso y te digo qué parte del día es cada pedido.'}</small>
    </div>
    <p class="fit-note">Las calorías son estimadas a partir del nombre, la descripción y el peso que publica el local: Rappi no da información nutricional.</p>
  </div>`;
}

function cardNutritionHtml(p) {
  const n = p.nutrition;
  const need = dailyNeed();
  return `<div class="nut-line">
    <span>🔥 ${n.kcalPerPerson.toLocaleString('es-AR')} kcal${(lastResult?.people || 1) > 1 ? ' c/u' : ''}${need ? ` · ${Math.round((n.kcalPerPerson / need) * 100)}% del día` : ''}</span>
    <span class="health ${healthClass(n.health)}">${n.label} · ${n.health}</span>
  </div>`;
}

function nutritionBoxHtml({ kcal, perPerson, people = 1, perUnit, health, label, reasons = [], range, qty = 1 }) {
  const need = dailyNeed();
  const mine = perPerson ?? kcal;
  return `<div class="nut-box">
    <div class="nut-head">
      <div><small>Calorías (estimado)</small><b>${kcal.toLocaleString('es-AR')} kcal</b>
        <span>${[range ? `entre ${range[0].toLocaleString('es-AR')} y ${range[1].toLocaleString('es-AR')}` : '', perUnit ? `≈${perUnit} kcal c/u` : '', people > 1 ? `${mine.toLocaleString('es-AR')} por persona` : '', need ? `${Math.round((mine / need) * 100)}% de tu día` : ''].filter(Boolean).join(' · ')}</span></div>
      <div class="health-score ${healthClass(health)}"><b>${health}</b><small>${label}</small></div>
    </div>
    <i class="health-bar"><b class="${healthClass(health)}" style="width:${health}%"></b></i>
    ${reasons.length ? `<div class="nut-reasons">${reasons.map(r => `<span class="${r.startsWith('✓') ? 'pos' : r.startsWith('✗') ? 'neg' : ''}">${esc(r)}</span>`).join('')}</div>` : ''}
    ${qty > 1 ? `<p class="fit-note">Para ${qty} unidades.</p>` : ''}
  </div>`;
}

document.addEventListener('change', e => {
  if (e.target.id !== 'body-weight') return;
  const kg = Math.round(+String(e.target.value).replace(/[^\d.]/g, ''));
  ui.bodyWeight = kg >= 30 && kg <= 250 ? kg : null;
  saveUi();
  render();
});

// =====================================================================
// Pedido grupal por link (engine/group.js): el pedido viaja en la URL (#grupo=...)
// =====================================================================
let groupState = null; // { group, me, filter }
function myName() { try { return localStorage.getItem('ryb:me') || ''; } catch { return ''; } }
function saveMyName(n) { try { localStorage.setItem('ryb:me', n); } catch {} }
function itemById(id) { return engine.menu(id.slice(0, id.lastIndexOf(':'))).find(x => x.id === id); }
function groupLink() { return `${location.origin}${location.pathname}#grupo=${encodeGroup(groupState.group)}`; }

function startGroup(restaurantId) {
  groupState = { group: emptyGroup(restaurantId), me: myName() };
  openGroup();
}
function closeGroup() {
  groupState = null;
  if (location.hash.startsWith('#grupo=')) history.replaceState(null, '', location.pathname + location.search);
}
function mine() {
  const me = groupState.me.toLowerCase();
  return groupState.group.people.find(p => p.name.toLowerCase() === me)?.lines || [];
}
function changeGroupQty(itemId, delta) {
  const name = cleanName($('#group-me')?.value || groupState.me);
  if (!name) { toast('Primero poné tu nombre'); $('#group-me')?.focus(); return; }
  groupState.me = name; saveMyName(name);
  const lines = mine().map(l => ({ ...l }));
  const l = lines.find(x => x.itemId === itemId);
  if (l) l.qty = Math.max(0, l.qty + delta); else if (delta > 0) lines.push({ itemId, qty: delta });
  groupState.group = setPersonLines(groupState.group, name, lines);
  history.replaceState(null, '', `#grupo=${encodeGroup(groupState.group)}`);
  const scroll = $('#overlay .sheet-body')?.scrollTop;
  openGroup();
  const body = $('#overlay .sheet-body'); if (body && scroll != null) body.scrollTop = scroll;
}

function openGroup() {
  const { group } = groupState;
  const rest = engine.restaurants().find(r => r.id === group.restaurantId);
  if (!rest) { toast('Ese local ya no está en el catálogo'); closeGroup(); return; }
  reopen = () => groupState && openGroup();
  const items = engine.menu(rest.id);
  const t = groupTotals(group, id => itemById(id)?.price, rest.deliveryFee || 0);
  const myLines = Object.fromEntries(mine().map(l => [l.itemId, l.qty]));
  const q = (groupState.filter || '').toLowerCase();
  const shown = items.filter(it => !q || it.name.toLowerCase().includes(q) || (it.section || '').toLowerCase().includes(q));
  openSheet(`
    <div class="cover sheet-cover" ${coverStyle('otro')}>${sheetCoverHtml('otro', rest.coverUrl)}</div>
    <div class="sheet-top">
      <button class="icon-btn" data-group-back="${esc(rest.id)}" aria-label="Volver al menú">${icon('back')}</button>
      <span class="pill">👥 Pedido grupal</span>
      <span></span>
    </div>
    <div class="sheet-body">
      <div class="kicker">${esc(rest.name)}</div>
      <h2>Pedido grupal</h2>
      <p class="blurb">Cada uno elige lo suyo y comparte el link. El envío se divide en partes iguales.</p>
      <div class="group-people">
        ${t.shares.length ? t.shares.map(sh => {
          const person = group.people.find(p => p.name === sh.name);
          return `<div class="gp ${sh.name.toLowerCase() === groupState.me.toLowerCase() ? 'me' : ''}">
            <div><b>${esc(sh.name)}</b><small>${person.lines.map(l => `${l.qty}× ${esc(itemById(l.itemId)?.name || '')}`).join(' + ')}</small></div>
            <span>${ars(sh.amount)}</span></div>`;
        }).join('') : '<p class="note">Todavía no pidió nadie. Empezá vos.</p>'}
      </div>
      <div class="section-head" style="margin-top:18px"><h2>Lo tuyo</h2><span>${Object.keys(myLines).length ? `${Object.values(myLines).reduce((a, b) => a + b, 0)} producto(s)` : ''}</span></div>
      <label class="group-me"><span>Tu nombre</span><input id="group-me" value="${esc(groupState.me)}" placeholder="¿Cómo te llamás?" maxlength="24" autocomplete="given-name"></label>
      <input id="group-filter" class="group-filter" type="search" placeholder="Buscá en el menú…" value="${esc(groupState.filter || '')}">
      <div class="list group-menu">${shown.slice(0, 80).map(it => `
        <div class="line-item ${myLines[it.id] ? 'picked' : ''}">
          ${thumb(catOfItem(it), it.imageUrl, 'sm')}
          <div class="row-main"><h4>${esc(it.name)}</h4><p>${ars(it.price)}${it.section ? ` · ${esc(it.section)}` : ''}</p></div>
          <div class="stepper"><div><button data-gq="${esc(it.id)}" data-delta="-1" aria-label="Menos" ${myLines[it.id] ? '' : 'disabled'}>−</button><span>${myLines[it.id] || 0}</span><button data-gq="${esc(it.id)}" data-delta="1" aria-label="Más">+</button></div></div>
        </div>`).join('')}
        ${shown.length > 80 ? `<p class="note">Mostrando 80 de ${shown.length}. Buscá para encontrar el resto.</p>` : ''}
      </div>
    </div>
    <div class="sheet-bar">
      <div class="tot"><small>Total del grupo${rest.deliveryFee == null ? ' + envío' : ' con envío'}</small><b>${ars(t.total)}</b></div>
      <button class="btn ghost" data-group-share ${t.shares.length ? '' : 'disabled'}>🔗 Compartir</button>
      <button class="btn primary" data-group-cart ${t.shares.length ? '' : 'disabled'}>${icon('bag')} Al pedido</button>
    </div>`);
}

async function shareGroup() {
  const rest = engine.restaurants().find(r => r.id === groupState.group.restaurantId);
  const t = groupTotals(groupState.group, id => itemById(id)?.price, rest?.deliveryFee || 0);
  const text = `🍔 Pedido grupal en ${rest?.name}\n${t.shares.map(s => `• ${s.name}: ${ars(s.amount)}`).join('\n')}\nTotal ${ars(t.total)}\n\nSumá lo tuyo acá:`;
  const url = groupLink();
  try {
    if (navigator.share) { await navigator.share({ title: 'Pedido grupal', text, url }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('🔗 Link copiado: pegalo en el grupo'); }
  catch { toast('No pude copiar el link: copialo de la barra de direcciones'); }
}

function groupToCart() {
  const plan = engine.planForLines(mergedLines(groupState.group));
  if (!plan) { toast('No pude armar el pedido'); return; }
  itemPlans.set(plan.id, plan);
  if (!inCart(plan.id)) engine.addToCart(plan);
  toast(`Agregado al pedido: ${ars(plan.total)} · dividilo con ➗`);
}

document.addEventListener('input', e => {
  if (e.target.id !== 'group-filter' || !groupState) return;
  groupState.filter = e.target.value;
  const pos = e.target.selectionStart;
  openGroup();
  const f = $('#group-filter'); if (f) { f.focus(); f.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'group-me' || !groupState) return;
  const name = cleanName(e.target.value);
  if (!name) return;
  // Cambiar el nombre mueve lo que ya elegiste al nombre nuevo.
  const lines = mine();
  if (lines.length && name.toLowerCase() !== groupState.me.toLowerCase()) {
    groupState.group = setPersonLines(setPersonLines(groupState.group, groupState.me, []), name, lines);
    history.replaceState(null, '', `#grupo=${encodeGroup(groupState.group)}`);
  }
  groupState.me = name; saveMyName(name);
  openGroup();
});

// Abrir un link de pedido grupal.
function openGroupFromHash() {
  const m = location.hash.match(/^#grupo=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  const group = decodeGroup(m[1], id => !!itemById(id));
  if (!group || !engine.restaurants().some(r => r.id === group.restaurantId)) { toast('Ese link de pedido grupal no es válido'); return; }
  groupState = { group, me: myName() };
  openGroup();
}
window.addEventListener('hashchange', openGroupFromHash);
openGroupFromHash();
