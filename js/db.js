// Persistenza locale: IndexedDB (un unico documento JSON) con fallback su localStorage.
const DB = 'allenamenti', STORE = 'kv', KEY = 'state';
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function load() {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    if (v) return v;
  } catch (e) { console.warn('IndexedDB non disponibile', e); }
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
let timer;
export function save(state) {
  clearTimeout(timer);
  timer = setTimeout(() => saveNow(state), 150);
}
export async function saveNow(state) {
  const copy = JSON.parse(JSON.stringify(state));
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(copy, KEY);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e2) { alert('Impossibile salvare i dati: ' + e2.message); }
  }
}
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
