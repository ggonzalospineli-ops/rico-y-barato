// Guardado más firme para los ajustes y el estado de la app.
// - localStorage es lo principal (síncrono: el motor lo lee al arrancar).
// - Cada escritura se copia, con un poco de demora, a IndexedDB. Si al abrir localStorage aparece vacío
//   (el navegador lo borró, o se abrió desde otro lugar) pero hay copia, se restaura.
// - Se pide almacenamiento persistente para que el navegador no lo borre por falta de espacio.
// - storageHealth() dice si el navegador realmente está guardando (modo incógnito, bloqueado, etc.).

const DB = 'ryb', STORE = 'kv', PREFIX = 'ryb:';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Al arrancar: si falta alguna clave en localStorage y hay copia, se vuelve a poner. Devuelve las restauradas.
export async function restoreBackup(keys = ['state', 'ui', 'me']) {
  const restored = [];
  try {
    for (const k of keys) {
      if (localStorage.getItem(PREFIX + k) != null) continue;
      const v = await idb('readonly', s => s.get(PREFIX + k));
      if (typeof v === 'string') { localStorage.setItem(PREFIX + k, v); restored.push(k); }
    }
  } catch {}
  try { await navigator.storage?.persist?.(); } catch {}
  return restored;
}

const pending = new Map();
let timer = 0;
export function backup(key, raw) {
  pending.set(PREFIX + key, raw);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const batch = [...pending];
    pending.clear();
    try { await idb('readwrite', s => { for (const [k, v] of batch) s.put(v, k); }); } catch {}
  }, 400);
}

// ¿El navegador guarda? 'ok', 'temporal' (se borra al cerrar: incógnito o configuración) o 'bloqueado'.
export async function storageHealth() {
  try {
    localStorage.setItem(PREFIX + '__test', '1');
    const ok = localStorage.getItem(PREFIX + '__test') === '1';
    localStorage.removeItem(PREFIX + '__test');
    if (!ok) return 'bloqueado';
  } catch { return 'bloqueado'; }
  try {
    const { quota } = await navigator.storage.estimate();
    // En incógnito Chrome da una cuota chica (~100 MB o menos) y no persiste.
    const persisted = await navigator.storage.persisted?.();
    if (!persisted && quota && quota < 120 * 1024 * 1024) return 'temporal';
  } catch {}
  return 'ok';
}
