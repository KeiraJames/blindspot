/** Tiny promise wrapper over one IndexedDB database with a few key-value stores. */
const DB_NAME = 'pathsense';
const STORES = ['kv', 'tts', 'maps', 'scans'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  get: <T>(store: StoreName, key: string) =>
    run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (store: StoreName, key: string, value: unknown) =>
    run(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (store: StoreName, key: string) => run(store, 'readwrite', (s) => s.delete(key)).then(() => undefined),
  keys: (store: StoreName) =>
    run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String)),
  values: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
};

/** FNV-1a 32-bit, hex. Good enough for cache keys. */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}
