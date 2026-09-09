// @ts-check
/**
 * Gerbang jaringan terpusat (§NET-4): SEMUA request REST ke Binance lewat sini.
 * Dilarang memanggil fetch ke Binance langsung dari modul fitur.
 *
 * Menegakkan:
 *  §NET-1 baca header X-MBX-USED-WEIGHT-1M → state kuota global.
 *  §NET-2 >70% → jeda; >90% → hanya Tier A.
 *  §NET-3 HTTP 429/418 → berhenti, exponential backoff, hormati Retry-After.
 *  §NET-5 deduplikasi request in-flight.
 */

import { NET } from '../core/config.js';

/** @typedef {'ok'|'paused'|'tierA-only'|'blocked'} QuotaState */

const state = {
  usedWeight: 0,
  weightLimit: 2400, // default fapi; diperbarui bila header memberi tahu
  /** @type {QuotaState} */
  quota: 'ok',
  blockedUntil: 0,
  /** @type {Map<string, Promise<any>>} */
  inflight: new Map(),
  /** @type {((s:{quota:QuotaState, usedPct:number, blockedUntil:number})=>void)[]} */
  listeners: [],
};

/** @param {(s:{quota:QuotaState, usedPct:number, blockedUntil:number})=>void} fn */
export function onQuotaChange(fn) { state.listeners.push(fn); }

function emit() {
  const usedPct = state.usedWeight / state.weightLimit;
  for (const fn of state.listeners) fn({ quota: state.quota, usedPct, blockedUntil: state.blockedUntil });
}

/** @returns {QuotaState} */
export function quotaState() { return state.quota; }
export function usedWeightPct() { return state.usedWeight / state.weightLimit; }

function recomputeQuota() {
  const pct = state.usedWeight / state.weightLimit;
  if (Date.now() < state.blockedUntil) state.quota = 'blocked';
  else if (pct >= NET.weightTierAOnlyPct) state.quota = 'tierA-only';
  else if (pct >= NET.weightPausePct) state.quota = 'paused';
  else state.quota = 'ok';
  emit();
}

/**
 * GET JSON lewat gerbang. Dedup in-flight untuk URL identik.
 * @param {string} url
 * @param {{tierA?:boolean, signal?:AbortSignal}} [opts]
 * @returns {Promise<any>}
 */
export async function getJSON(url, opts = {}) {
  // Hormati blokir & kuota (§NET-2/3)
  if (Date.now() < state.blockedUntil) {
    throw new NetError('blocked', `IP diblokir sementara sampai ${new Date(state.blockedUntil).toLocaleTimeString('id-ID')}`);
  }
  if (state.quota === 'tierA-only' && !opts.tierA) {
    throw new NetError('quota', 'Kuota hampir penuh — hanya pair prioritas yang dilayani sekarang.');
  }
  if (state.quota === 'paused' && !opts.tierA) {
    throw new NetError('quota', 'Scan dijeda otomatis karena kuota permintaan tinggi.');
  }

  const existing = state.inflight.get(url);
  if (existing) return existing;

  const p = (async () => {
    const res = await fetch(url, { signal: opts.signal });
    // §NET-1 baca header bobot
    const w = res.headers.get('X-MBX-USED-WEIGHT-1M');
    if (w) { state.usedWeight = parseInt(w, 10) || state.usedWeight; recomputeQuota(); }

    if (res.status === 429 || res.status === 418) {
      const retry = parseInt(res.headers.get('Retry-After') || '', 10);
      const waitMs = Number.isFinite(retry) ? retry * 1000 : 60_000;
      state.blockedUntil = Date.now() + waitMs;
      recomputeQuota();
      throw new NetError('rate-limit', `Kena batas Binance (${res.status}). Berhenti ${Math.round(waitMs / 1000)} detik.`);
    }
    if (!res.ok) throw new NetError('http', `HTTP ${res.status} untuk ${shortUrl(url)}`);
    return res.json();
  })();

  state.inflight.set(url, p);
  try { return await p; }
  finally { state.inflight.delete(url); }
}

/**
 * Jalankan tugas dengan concurrency terbatas (§NET, pola Patah Pensill).
 * @template T
 * @param {(() => Promise<T>)[]} tasks
 * @param {number} [limit]
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<PromiseSettledResult<T>[]>}
 */
export async function pool(tasks, limit = NET.maxConcurrent, onProgress) {
  const results = new Array(tasks.length);
  let idx = 0, done = 0;
  async function worker() {
    while (idx < tasks.length) {
      const cur = idx++;
      try { results[cur] = { status: 'fulfilled', value: await tasks[cur]() }; }
      catch (e) { results[cur] = { status: 'rejected', reason: e }; }
      done++;
      if (onProgress) onProgress(done, tasks.length);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export class NetError extends Error {
  /** @param {string} kind @param {string} msg */
  constructor(kind, msg) { super(msg); this.kind = kind; this.name = 'NetError'; }
}

/** @param {string} url */
function shortUrl(url) { try { return new URL(url).pathname; } catch { return url; } }
