// IndexedDB tárolás: mód könyvtár + kulcs/érték beállítások (mappakezelő is ide kerül)
const DB_NAME = 'fenycsik';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: (key, def) => tx('kv', 'readonly', (s) => req2p(s.get(key))).then((v) => (v === undefined ? def : v)),
  set: (key, val) => tx('kv', 'readwrite', (s) => { s.put(val, key); }),
  del: (key) => tx('kv', 'readwrite', (s) => { s.delete(key); }),
};

export const library = {
  all: () => tx('library', 'readonly', (s) => req2p(s.getAll())),
  put: (item) => tx('library', 'readwrite', (s) => { s.put(item); }),
  del: (id) => tx('library', 'readwrite', (s) => { s.delete(id); }),
};

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
