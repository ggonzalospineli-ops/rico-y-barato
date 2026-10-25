// Interfaz de Rico y Barato. Toda la lógica de negocio vive en engine/; acá solo se dibuja.
import { createEngine } from '../engine/engine.js';
import { demoSource } from '../sources/demo.js';
import { jsonSource } from '../sources/json.js';

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
  const top = (r.options.length ? r.options : r.overBudget.slice(0, 3)).slice(0, 3);
  return {
    hambre: hungerLb,
    plata: ui.money ? `${Math.round(ui.money).toLocaleString('es-AR')} pesos` : 'sin límite',
    categoria: ui.category === 'all' ? 'todo lo que come' : (CATS[ui.category]?.label || ui.category),
    personas: ui.people === 1 ? '1 (pide para sí)' : `${ui.people}`,
    modo: balanceHint(),
    top3: top.length ? top.map((p, i) => `${i + 1}) ${planTxt(p)}`).join(' || ') : 'No hay recomendaciones todavía con este filtro: sugerí qué cambiar (más plata, menos hambre, otra categoría) para que aparezcan.',
  };
}
async function mountAssistantWidget() {
  if (!voiceAgent?.agentId || $('#assistant-dock elevenlabs-convai')) return;
  const el = document.createElement('elevenlabs-convai');
  el.setAttribute('agent-id', voiceAgent.agentId);
  el.setAttribute('dynamic-variables', JSON.stringify(assistantState()));
  el.setAttribute('dismissible', 'true');
  el.setAttribute('action-text', '¿Qué comemos hoy?');
  el.setAttribute('start-call-text', 'Hablar');
  el.setAttribute('end-call-text', 'Cortar');
  el.setAttribute('expand-text', 'Asistente IA');
  el.setAttribute('avatar-orb-color-1', '#E4002B');
  el.setAttribute('avatar-orb-color-2', '#FFC72C');
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
  s.type = 'text/javascript';
  s.async = true;
  document.head.appendChild(s);
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
const saveUi = () => store.set('ui', { hunger: ui.hunger, category: ui.category, money: ui.money, ricoWeight: ui.ricoWeight, topTab: ui.topTab, people: ui.people, results: ui.results, assistant: ui.assistant });

const LOOK = {
  nuggets:     { e: '🍗', bg: 'linear-gradient(135deg,#FFE08A,#FF9F1C)' },
  sushi:       { e: '🍣', bg: 'linear-gradient(135deg,#FFC2B4,#FF5E5B)' },
  hamburguesa: { e: '🍔', bg: 'linear-gradient(135deg,#FFD45C,#FF7A00)' },
  empanadas:   { e: '🥟', bg: 'linear-gradient(135deg,#FBE3B0,#E39B3B)' },
  pizza:       { e: '🍕', bg: 'linear-gradient(135deg,#FFB27A,#E4002B)' },
  milanesa:    { e: '🥩', bg: 'linear-gradient(135deg,#F9CF8E,#C8642E)' },
  pollo:       { e: '🐔', bg: 'linear-gradient(135deg,#FFE6A6,#F29C1F)' },
  pasta:       { e: '🍝', bg: 'linear-gradient(135deg,#FFEFB8,#F4B400)' },
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
};
const EXCLUDABLE = { cerdo: '🐷 Cerdo', lacteos: '🧀 Lácteos', pescado: '🐟 Pescado', frito: '🍟 Frito', picante: '🌶️ Picante' };

// ---------- Utilidades ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars = n => (Number.isFinite(n) ? fmt.format(n) : 'sin tope');
const look = cat => LOOK[cat] || LOOK.otro;
const catOfItem = it => Object.keys(it.yields || {})[0] || 'otro';
// El score de la página del local viene con cantidad de reseñas; el del listado, no.
const stars = r => (r.rappiScore ?? r.rappiRating ?? r.googleRating ?? '—');
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
const thumb = (cat, imageUrl, cls = '') => `<div class="thumb ${cls}" ${coverStyle(cat)}><span>${look(cat).e}</span>${photo(imageUrl)}</div>`;
const logoThumb = (rest, cat) => `<div class="thumb logo" ${coverStyle(cat)}><span>${look(cat).e}</span>${photo(rest.logoUrl, 120)}</div>`;
const deliveryText = r => [r.deliveryFee != null ? (r.deliveryFee ? `🛵 ${ars(r.deliveryFee)}` : '🛵 Gratis') : null, r.etaMin ? `${r.etaMin} min` : null].filter(Boolean).join(' · ');

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
function currentResult() {
  lastResult = engine.recommend({
    hunger: ui.hunger,
    money: ui.money ?? Infinity,
    categories: ui.category === 'all' ? undefined : [ui.category],
    ricoWeight: ui.ricoWeight,
    people: ui.people,
    limit: 20,
    map: true,
  });
  return lastResult;
}
const findPlan = id => lastResult?.options.find(p => p.id === id) || lastResult?.all?.find(p => p.id === id) || lastResult?.overBudget.find(p => p.id === id)
  || engine.getState().cart.find(p => p.id === id);

// ---------- Vistas ----------
function render() {
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
    </section>

    </aside><div class="home-results">
    <section class="section results-head">
      <div class="results-bar">
        <div><h2>Para vos ahora</h2><span id="result-count"></span></div>
        <div class="results-actions">
          <div class="seg mini-seg">
            <button class="${ui.results === 'cards' ? 'on' : ''}" data-results="cards">▦ Tarjetas</button>
            <button class="${ui.results === 'map' ? 'on' : ''}" data-results="map">⚡ Mapa</button>
          </div>
          <button class="btn red decide-btn" data-decide>🎰 Decidí por mí</button>
        </div>
      </div>
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
  $('#result-count').textContent = r.options.length ? `${r.options.length} opciones${r.people > 1 ? ` · para ${r.people}` : ''}` : '';
  $('#map-wrap').innerHTML = ui.results === 'map' && r.all.length ? mapHtml(r) : '';
  box.classList.toggle('below-map', ui.results === 'map');
  box.innerHTML = r.options.length ? r.options.map(planCard).join('') : `
    <div class="empty-state"><div class="e">🥲</div><h3>Con esa plata no llego</h3>
    <p>Probá con menos hambre, otra comida o subí el monto.${r.overBudget.length ? ' Abajo te muestro lo que se pasa por poco.' : ''}</p></div>`;
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
      <span class="qty">${look(p.category).e} ${p.quantity} ${unitLabel(p.quantity, p.unit)}${p.variant === 'un-poco-menos' ? ' · un poco menos' : ''}</span>
      <button class="fav ${fav ? 'on' : ''}" data-fav-plan="${esc(p.id)}" aria-label="Favorito">${icon('heart', fav ? 'fill' : '')}</button>
      <div class="badges">${p.badges.filter(b => b !== 'favorito').slice(0, 2).map(b => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join('')}</div>
    </div>
    <div class="card-body">
      <div class="card-row">
        <h3 class="card-title">${esc(p.restaurant.name)}</h3>
        <span class="rating">${icon('star', 'fill')} ${stars(p.restaurant)} ${reviewsTxt(p.restaurant)}</span>
      </div>
      <p class="card-lines">${p.lines.map(l => `${l.qty}× ${esc(l.name)}`).join(' + ')}</p>
      ${plateHtml(p)}
      <div class="meter">
        <div><small><span>Rico</span><span>${Math.round(p.scores.rico * 100)}</span></small><i><b style="width:${p.scores.rico * 100}%;background:var(--red)"></b></i></div>
        <div><small><span>Barato</span><span>${Math.round(p.scores.barato * 100)}</span></small><i><b style="width:${p.scores.barato * 100}%;background:var(--yellow-deep)"></b></i></div>
      </div>
      <div class="card-foot">
        <div>
          <div class="price">${ars(p.total)}${orig > p.total ? `<s>${ars(orig)}</s>` : ''}</div>
          <div class="per">${ars(p.unitCost)} c/u · ${p.restaurant.deliveryFee == null ? '+ envío' : deliveryText(p.restaurant)}</div>
        </div>
        <button class="add ${added ? 'done' : ''}" data-add="${esc(p.id)}" aria-label="Agregar al pedido">${icon(added ? 'check' : 'plus')}</button>
      </div>
    </div>
  </article>`;
}

function viewTop() {
  const r = engine.rankings({ limit: 2000 });
  const tabs = [['sellers', '🔥 Más pedidos'], ['rated', '⭐ Mejor puntuados'], ['gems', '💎 Joyas']];
  // Solo lo que el usuario come (y en la categoría elegida en Inicio, si hay una).
  const enabled = engine.getState().profile.enabledCategories;
  const wanted = it => Object.keys(it.yields).some(c => enabled.includes(c) && (ui.category === 'all' || c === ui.category));
  let body;
  if (ui.topTab === 'sellers') {
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
  const orders = [...st.orders].reverse().slice(0, 15);
  return `
    <div class="page-title"><h1>Pedidos</h1></div>
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

    ${orders.length ? `<section class="section"><div class="section-head"><h2>Historial</h2><span>${st.orders.length} pedidos</span></div>
      <div class="list">${orders.map(o => `
        <div class="row"><div class="row-main"><h4>${esc(o.title)}</h4>
        <p>${new Date(o.at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p></div>
        <span class="score">${ars(o.total)}</span></div>`).join('')}</div></section>` : ''}`;
}

function viewSettings() {
  const st = engine.getState();
  const hidden = st.hiddenItems.map(id => engine.item(id)).filter(Boolean);
  return `
    <div class="page-title"><h1>Ajustes</h1></div>

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
    <p class="note">${real ? `Datos: Rappi, relevado el ${new Date(real.meta.scrapedAt).toLocaleDateString('es-AR')} · ${real.restaurants.length} locales.` : 'Datos de ejemplo.'}</p>`;
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
    <div class="cover" ${coverStyle(p.category)}>${coverHtml({ category: p.category, imageUrl: planImage(p), multi: true })}</div>
    <div class="sheet-top">
      <button class="icon-btn" data-close aria-label="Cerrar">${icon('back')}</button>
      <span class="pill">${look(p.category).e} ${p.quantity} ${unitLabel(p.quantity, p.unit)}</span>
      <button class="icon-btn" data-rest="${esc(p.restaurant.id)}" aria-label="Ver menú">${icon('search')}</button>
    </div>
    <div class="sheet-body">
      <div class="kicker">${CATS[p.category].label}${p.restaurant.chain ? ' · Cadena' : ' · Local'}</div>
      <h2>${esc(p.restaurant.name)}</h2>
      <div class="badges" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${p.badges.map(b => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join('')}</div>
      <div class="stats">
        <div><small>Rating Rappi</small><b>${icon('star', 'fill')} ${stars(p.restaurant)}</b></div>
        <div><small>Por ${unitLabel(1, p.unit)}</small><b>${ars(p.unitCost)}</b></div>
        <div><small>Pediste</small><b>${p.target} → ${p.quantity}</b></div>
      </div>
      ${deliveryText(p.restaurant) || p.restaurant.rappiReviews ? `<p class="blurb">${[deliveryText(p.restaurant), p.restaurant.rappiReviews ? `${p.restaurant.rappiReviews} reseñas en Rappi` : ''].filter(Boolean).join(' · ')}${p.restaurant.deliveryFee != null ? ' · envío aproximado' : ''}</p>` : ''}
      ${p.restaurant.address ? `<p class="blurb">📍 ${esc(p.restaurant.address)}</p>` : ''}
      ${p.variant === 'un-poco-menos' ? `<p class="blurb">Comés un poco menos de lo que querías (${p.quantity} de ${p.target}) pero te ahorrás bastante.</p>` : ''}
      ${plateHtml(p, true)}
      <div class="section-head" style="margin-top:22px"><h2>Qué pedís</h2><span>${p.lines.length} producto${p.lines.length > 1 ? 's' : ''}</span></div>
      <div class="list">${p.lines.map(l => `
        <div class="line-item">
          <span class="q">${l.qty}×</span>
          <div class="row-main"><h4>${esc(l.name)}</h4><p>${ars(l.price)} c/u${l.discount ? ` · ${esc(l.discount)}` : ''}</p></div>
          <button class="heart ${favs.includes(l.itemId) ? 'on' : ''}" data-fav="${esc(l.itemId)}" aria-label="Favorito">${icon('heart', favs.includes(l.itemId) ? 'fill' : '')}</button>
          <button class="flag" data-hide="${esc(l.itemId)}" title="La cantidad o la comida está mal detectada">Está mal</button>
        </div>`).join('')}</div>
      <a class="btn ghost block" style="margin-top:14px" data-rest="${esc(p.restaurant.id)}">Ver todo el menú del local</a>
    </div>
    <div class="sheet-bar">
      <div class="tot"><small>Total${p.restaurant.deliveryFee == null ? ' + envío' : ' con envío'}</small><b>${ars(p.total)}</b>${orig > p.total ? `<s>${ars(orig)}</s>` : ''}</div>
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
    <div class="cover" ${coverStyle(mainCat)}>${coverHtml({ category: mainCat, imageUrl: rest.coverUrl })}</div>
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
      <p class="blurb">Tocá el ❤️ en lo que te gusta de acá: con eso aprendo tu gusto y te lo priorizo.</p>
      ${Object.entries(bySection).map(([sec, list]) => `
        <div class="menu-section">${esc(sec)}</div>
        <div class="list" style="margin-top:10px">${list.map(it => `
          <div class="line-item">
            ${thumb(catOfItem(it), it.imageUrl, 'sm')}
            <div class="row-main"><h4>${esc(it.name)}</h4><p>${ars(it.price)}${it.discount ? ` · ${esc(it.discount)}` : ''}${Object.keys(it.yields).length ? ` · rinde ${Object.entries(it.yields).map(([c, n]) => `${n} ${unitLabel(n, CATS[c].unit)}`).join(' + ')}` : ''}</p></div>
            <button class="heart ${it.favorite ? 'on' : ''}" data-fav="${esc(it.id)}" aria-label="Favorito">${icon('heart', it.favorite ? 'fill' : '')}</button>
          </div>`).join('')}</div>`).join('')}
    </div>
    ${rest.url ? `<div class="sheet-bar"><a class="btn red" href="${esc(rest.url)}" target="_blank" rel="noopener">Abrir en Rappi ${icon('out')}</a></div>` : ''}`);
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
  const t = e.target.closest('[data-palette],[data-people],[data-results],[data-decide],[data-swipe],[data-cmd],[data-spin],[data-tab],[data-hunger],[data-cat],[data-money],[data-add],[data-fav],[data-fav-plan],[data-plan],[data-rest],[data-close],[data-hide],[data-unhide],[data-confirm],[data-remove],[data-toptab],[data-step],[data-enable],[data-exclude],[data-suggest],[data-assist-toggle],[data-assist-enable],#sheet-wrap');
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
  if (d.tab) { closeSheet(); ui.tab = d.tab; render(); $('#view').scrollTop = 0; return; }
  if (d.hunger) { ui.hunger = d.hunger; saveUi(); render(); return; }
  if (d.cat) { ui.category = d.cat; saveUi(); render(); return; }
  if ('money' in d) { ui.money = d.money ? +d.money : null; saveUi(); render(); return; }
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
    <button data-rest="${esc(r.id)}"><span class="rating">${icon('star', 'fill')} ${r.rappiRating ?? '—'}</span>
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
let deck = [], deckIndex = 0;
function openDecide() {
  deck = (lastResult?.options || []).slice(0, 12);
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
  box.innerHTML = deck.slice(deckIndex, deckIndex + 3).map((p, k) => deckCard(p, deckIndex + k)).reverse().join('');
  bindDrag(box.querySelector(`.dcard[data-i="${deckIndex}"]`));
}

function bindDrag(card) {
  if (!card) return;
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
  const weights = pool.map(p => Math.pow(p.scores.total + 0.05, 3));
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
