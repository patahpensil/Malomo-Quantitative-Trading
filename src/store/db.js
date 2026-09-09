// @ts-check
/**
 * Penyimpanan IndexedDB (§8) dengan ketahanan iOS (§19).
 *  ST-R1 IndexedDB, bukan localStorage, tanpa batas 200.
 *  ST-R4 skema berversi + migrasi; data lama tak dibuang diam-diam.
 *  ST-R5 setiap baris menyimpan model_version.
 *  DB-3 navigator.storage.persist() diminta saat start.
 *  DB-4 QuotaExceededError ditangani eksplisit.
 *  O-R7 sinyal tak bisa dihapus dari statistik — hanya disembunyikan.
 */

import { STORAGE } from '../core/config.js';

const STORES = {
  signals: 'signals', // sinyal confirmed tercatat otomatis (§O-R6)
  barriers: 'barriers', // hasil evaluasi triple barrier
  journal: 'journal', // catatan manual pengguna
  meta: 'meta', // key-value: lastExport, dll
};

/** @type {IDBDatabase|null} */
let db = null;

/** Buka DB + jalankan migrasi. */
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STORAGE.dbName, STORAGE.dbVersion);
    req.onupgradeneeded = (ev) => {
      const d = req.result;
      const oldV = ev.oldVersion;
      // Migrasi maju; tiap versi menambah, tidak menghapus (§DB-6)
      if (oldV < 1) {
        const sig = d.createObjectStore(STORES.signals, { keyPath: 'id' });
        sig.createIndex('symbol', 'symbol');
        sig.createIndex('createdAt', 'createdAt');
        sig.createIndex('status', 'status');
        const bar = d.createObjectStore(STORES.barriers, { keyPath: 'signalId' });
        bar.createIndex('outcome', 'outcome');
        bar.createIndex('resolvedAt', 'resolvedAt');
        d.createObjectStore(STORES.journal, { keyPath: 'id', autoIncrement: true });
        d.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

/** @returns {IDBDatabase} */
function get() { if (!db) throw new Error('DB belum dibuka'); return db; }

/**
 * @param {string} store @param {IDBTransactionMode} mode
 */
function tx(store, mode) { return get().transaction(store, mode).objectStore(store); }

/** Bungkus IDBRequest jadi Promise + tangani QuotaExceededError (§DB-4). */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      const err = req.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new StorageFullError('Penyimpanan penuh. Ekspor data lalu bersihkan cache candle.'));
      } else reject(err);
    };
  });
}

/**
 * Simpan sinyal confirmed (§O-R6). Otomatis, bukan lewat tombol.
 * @param {Object} signal
 */
export async function putSignal(signal) { return wrap(tx(STORES.signals, 'readwrite').put(signal)); }

/** @param {string} id */
export async function getSignal(id) { return wrap(tx(STORES.signals, 'readonly').get(id)); }

/** Semua sinyal (untuk statistik & barrier). */
export async function allSignals() { return wrap(tx(STORES.signals, 'readonly').getAll()); }

/**
 * Sembunyikan dari tampilan — TIDAK menghapus dari statistik (§O-R7).
 * @param {string} id
 */
export async function hideSignal(id) {
  const s = await getSignal(id);
  if (!s) return;
  s.hidden = true;
  return putSignal(s);
}

/** @param {Object} barrier */
export async function putBarrier(barrier) { return wrap(tx(STORES.barriers, 'readwrite').put(barrier)); }
export async function allBarriers() { return wrap(tx(STORES.barriers, 'readonly').getAll()); }

/** @param {Object} entry */
export async function addJournal(entry) { return wrap(tx(STORES.journal, 'readwrite').add(entry)); }
export async function allJournal() { return wrap(tx(STORES.journal, 'readonly').getAll()); }

/** @param {string} key @param {any} value */
export async function setMeta(key, value) { return wrap(tx(STORES.meta, 'readwrite').put({ key, value })); }
/** @param {string} key */
export async function getMeta(key) {
  const r = await wrap(tx(STORES.meta, 'readonly').get(key));
  return r ? r.value : null;
}

/** Minta penyimpanan persisten (§DB-3). */
export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

/** Ekspor seluruh data ke objek JSON (§ST-R3). */
export async function exportAll() {
  const [signals, barriers, journal] = await Promise.all([allSignals(), allBarriers(), allJournal()]);
  await setMeta('lastExport', Date.now());
  return { version: STORAGE.dbVersion, exportedAt: Date.now(), signals, barriers, journal };
}

/**
 * Impor data (gabung, tidak menimpa yang ada by id).
 * @param {{signals?:any[], barriers?:any[], journal?:any[]}} data
 */
export async function importAll(data) {
  for (const s of data.signals || []) await putSignal(s);
  for (const b of data.barriers || []) await putBarrier(b);
  for (const j of data.journal || []) await addJournal(j);
}

/** Cek apakah perlu ingatkan ekspor (§DB-2). */
export async function needsExportReminder() {
  const last = await getMeta('lastExport');
  if (!last) return true;
  return Date.now() - last > STORAGE.exportReminderDays * 86_400_000;
}

export class StorageFullError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'StorageFullError'; }
}
