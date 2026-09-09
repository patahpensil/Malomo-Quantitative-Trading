// @ts-check
/**
 * Pembungkus worker komputasi dengan fallback otomatis (§CD-8).
 *
 * Perilaku:
 *   - Coba buat module worker sekali. Bila konstruksi ATAU pesan pertama gagal
 *     (umum di beberapa WebView iOS lama), langsung dan permanen jatuh ke jalur
 *     main-thread yang memanggil analyzeSymbol yang sama. Tidak ada perbedaan
 *     hasil antara kedua jalur — hanya di mana ia dieksekusi.
 *   - Pemanggil tidak perlu tahu jalur mana yang dipakai; API sama.
 *
 * Ini "uji perangkat nyata" yang diminta CD-8 dilakukan secara defensif saat
 * runtime, bukan diasumsikan. Bila worker sehat, UI tak terblokir saat scan
 * Tier B; bila tidak, aplikasi tetap berfungsi persis seperti Patah Pensill
 * (semua di main thread).
 */

import { analyzeSymbol } from '../scoring/pipeline.js';

/** @typedef {import('../scoring/pipeline.js').SymbolInput} SymbolInput */

/** @type {Worker|null} */
let worker = null;
/** @type {'unknown'|'worker'|'fallback'} */
let mode = 'unknown';
let seq = 0;
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void}>} */
const pending = new Map();

function initWorker() {
  if (mode !== 'unknown') return;
  // Tanpa dukungan Worker sama sekali → fallback.
  if (typeof Worker === 'undefined') { mode = 'fallback'; return; }
  try {
    worker = new Worker(new URL('./compute.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error || 'worker error'));
    };
    worker.onerror = () => { degradeToFallback(); };
    mode = 'worker';
  } catch {
    mode = 'fallback';
    worker = null;
  }
}

function degradeToFallback() {
  mode = 'fallback';
  try { worker && worker.terminate(); } catch { /* noop */ }
  worker = null;
  // Tolak semua yang tertunda supaya pemanggil bisa mengulang lewat fallback.
  for (const [, p] of pending) p.reject(new Error('worker degraded'));
  pending.clear();
}

/**
 * Analisa satu simbol — via worker bila sehat, selain itu main thread.
 * Hasil identik untuk masukan identik (§CD-5).
 * @param {SymbolInput} input
 * @returns {Promise<ReturnType<typeof analyzeSymbol>>}
 */
export async function analyze(input) {
  initWorker();
  if (mode === 'fallback' || !worker) return analyzeSymbol(input);

  const id = ++seq;
  try {
    return await new Promise((resolve, reject) => {
      // Batas waktu: bila worker membisu (rawan iOS), jatuh ke fallback.
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('worker timeout')); }
      }, 8000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      /** @type {Worker} */(worker).postMessage({ id, input });
    });
  } catch {
    // Sekali gagal → degradasi permanen + kerjakan di main thread agar tak ada
    // simbol yang hilang dari hasil scan.
    degradeToFallback();
    return analyzeSymbol(input);
  }
}

/** Untuk diagnostik/tampilan: jalur mana yang sedang dipakai. */
export function computeMode() { return mode; }

/** Bersihkan worker (mis. saat halaman disembunyikan). */
export function disposeCompute() {
  try { worker && worker.terminate(); } catch { /* noop */ }
  worker = null;
  mode = 'unknown';
  pending.clear();
}
