// @ts-check
/**
 * Controller data pasar. Menjembatani jaringan → pipeline → UI.
 * Menegakkan universe berjenjang (§NF-1) dan basi 2×interval (§WS-5).
 *
 * Pemisahan penting (§CD-5/§NF-2): pengambilan data (jaringan, main thread,
 * memakai state kuota gerbang) DIPISAH dari analisa (murni). Analisa scan
 * dialihkan ke worker lewat computeClient agar UI tak terblokir; bila worker
 * tak sehat, computeClient jatuh ke main thread tanpa mengubah hasil.
 */

import * as bn from '../net/binance.js';
import { pool } from '../net/gateway.js';
import { analyzeSymbol } from '../scoring/pipeline.js';
import * as compute from '../workers/computeClient.js';
import { predictRegime, regimeModulators } from '../scoring/markov.js';
import { rsi } from '../indicators/indicators.js';
import { biasToSide, sideSign, TF_MS } from '../core/types.js';
import { structureBias } from '../indicators/structure.js';
import { evaluateBarrier, buildPlan, seededRandom } from '../store/barrier.js';
import { UNIVERSE } from '../core/config.js';

/**
 * Hitung keselarasan multi-timeframe: kesepakatan bias struktur di 3 TF.
 * @param {import('../scoring/families.js').Candles} tfActive
 * @param {import('../scoring/families.js').Candles} tfContext
 * @returns {number} -1..1
 */
function mtfAlignment(tfActive, tfContext) {
  const a = biasToSide(structureBias(tfActive.high, tfActive.low, tfActive.close).bias);
  const c = biasToSide(structureBias(tfContext.high, tfContext.low, tfContext.close).bias);
  if (a === 'neutral' || c === 'neutral') return 0;
  return a === c ? sideSign(a) : 0;
}

/**
 * Ambil semua data yang perlu untuk satu simbol & rakit SymbolInput (§CD-5).
 * Semua panggilan jaringan terjadi DI SINI (main thread, lewat gerbang).
 * @param {string} symbol
 * @param {import('../core/types.js').Timeframe} timeframe
 * @param {import('../core/types.js').Timeframe} contextTf
 * @param {import('../core/types.js').BarBasis} barBasis
 * @param {Object} [opts]
 * @param {boolean} [opts.tierA]
 * @param {Partial<Record<string,number>>} [opts.weights]
 * @param {number|null} [opts.cvdZ]
 * @param {number|null} [opts.obImbalance]
 * @returns {Promise<{input: import('../scoring/pipeline.js').SymbolInput, regime:any, stale:boolean, lastOpenTime:number}>}
 */
export async function fetchInput(symbol, timeframe, contextTf, barBasis, opts = {}) {
  const [candles, contextCandles, funding, oi, ls, regime] = await Promise.all([
    bn.klines(symbol, timeframe, 200, barBasis, { tierA: opts.tierA }),
    bn.klines(symbol, contextTf, 200, barBasis, { tierA: opts.tierA }),
    bn.fundingRate(symbol),
    bn.oiChange(symbol),
    bn.longShortRatio(symbol),
    bn.klines(symbol, '4h', 200, 'closed', { tierA: opts.tierA })
      .then((c) => predictRegime(c.close, (x) => rsi(x, 14)))
      .catch(() => null),
  ]);

  const mtf = mtfAlignment(candles, contextCandles);
  const regimeMod = regime ? regimeModulators(regime) : {};

  /** @type {import('../scoring/pipeline.js').SymbolInput} */
  const input = {
    symbol, timeframe, candles,
    fundingRate: funding, oiChange: oi, longShortRatio: ls,
    cvdZ: opts.cvdZ ?? null, obImbalance: opts.obImbalance ?? null,
    mtfAlignment: mtf, regimeMod, weights: /** @type {any} */(opts.weights),
  };

  const lastOpen = candles.openTime[candles.openTime.length - 1] || 0;
  const ageMs = Date.now() - (lastOpen + TF_MS[timeframe]);
  const stale = ageMs > 2 * TF_MS[timeframe];

  return { input, regime, stale, lastOpenTime: lastOpen };
}

/**
 * Gabungkan hasil analisa murni dengan metadata non-skor.
 * @param {ReturnType<typeof analyzeSymbol>} a
 * @param {{regime:any, stale:boolean, lastOpenTime:number}} meta
 */
function assemble(a, meta) {
  return { ...a, regime: meta.regime, stale: meta.stale, lastOpenTime: meta.lastOpenTime };
}

/**
 * Analisa satu simbol penuh (dipakai detail & Tier A). Jalur main-thread —
 * dipakai untuk satu simbol di mana responsivitas tak jadi soal.
 * Kontrak keluaran identik dengan versi sebelum refactor.
 * @param {string} symbol
 * @param {import('../core/types.js').Timeframe} timeframe
 * @param {import('../core/types.js').Timeframe} contextTf
 * @param {import('../core/types.js').BarBasis} barBasis
 * @param {Object} [opts]
 */
export async function analyzeOne(symbol, timeframe, contextTf, barBasis, opts = {}) {
  const f = await fetchInput(symbol, timeframe, contextTf, barBasis, opts);
  return assemble(analyzeSymbol(f.input), f);
}

/**
 * Muat daftar Tier B (universe scan).
 * @returns {Promise<{symbol:string, quoteVolume:number, priceChangePercent:number, lastPrice:number}[]>}
 */
export async function loadUniverse() {
  await bn.loadExchangeInfo();
  return bn.topSymbols(UNIVERSE.tierBScanLimit);
}

/**
 * Scan sekumpulan simbol dengan concurrency terbatas & progres. Pengambilan
 * data lewat gerbang (main thread); analisa lewat worker bila sehat (§NF-2).
 * @param {string[]} symbols
 * @param {import('../core/types.js').Timeframe} timeframe
 * @param {import('../core/types.js').Timeframe} contextTf
 * @param {(done:number,total:number)=>void} onProgress
 * @param {Object} [opts]
 */
export async function scanSymbols(symbols, timeframe, contextTf, onProgress, opts = {}) {
  const tasks = symbols.map((sym) => async () => {
    const f = await fetchInput(sym, timeframe, contextTf, 'live', opts);
    const a = await compute.analyze(f.input); // worker-atau-fallback, hasil identik
    return assemble(a, f);
  });
  const settled = await pool(tasks, undefined, onProgress);
  /** @type {any[]} */
  const ok = [];
  for (const r of settled) if (r.status === 'fulfilled') ok.push(r.value);
  return ok;
}

/**
 * Hash string deterministik (FNV-1a) → seed baseline reproducible (§BK-3).
 * @param {string} s
 */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Evaluasi satu barrier pending terhadap harga yang sudah terjadi (§O-R2, §20).
 * Mengambil klines tertutup sejak bar sinyal, membangun jalur, lalu:
 *  - bila SL/TP tersentuh ATAU deadline lewat → kembalikan rekaman terselesaikan
 *    (dengan baseline arah-acak berseed di jalur yang sama, §BK-3);
 *  - bila masih berjalan & belum kena batas → null (biarkan pending).
 *
 * Ini bagian yang membuat tab Bukti hidup: tanpa resolver, semua barrier abadi
 * 'pending' dan statistik tak pernah muncul.
 * @param {any} barrier rekaman { signalId,symbol,timeframe,side,plan,barOpenTime,deadlineMs }
 * @returns {Promise<any|null>}
 */
export async function resolveBarrier(barrier) {
  const tf = /** @type {import('../core/types.js').Timeframe} */ (barrier.timeframe);
  const tfms = TF_MS[tf];
  if (!tfms || !barrier.plan) return null;
  const now = Date.now();
  const since = barrier.barOpenTime || barrier.createdAt || 0;
  const until = Math.min(now, barrier.deadlineMs);
  const barsNeeded = Math.ceil((until - since) / tfms) + 2;
  if (barsNeeded < 1) return null;

  // startTime memastikan kita mengambil bar TEPAT setelah sinyal, bukan bar
  // terbaru — penting bila sinyal sudah lama tak terselesaikan.
  const c = await bn.klines(barrier.symbol, tf, Math.min(1000, Math.max(2, barsNeeded)), 'closed', {
    startTime: since, endTime: Math.min(now, barrier.deadlineMs) + tfms,
  });
  /** @type {{high:number,low:number,openTime:number}[]} */
  const path = [];
  for (let i = 0; i < c.openTime.length; i++) {
    if (c.openTime[i] > since && c.openTime[i] <= barrier.deadlineMs) {
      path.push({ high: c.high[i], low: c.low[i], openTime: c.openTime[i] });
    }
  }
  const deadlinePassed = now > barrier.deadlineMs;
  if (!path.length && !deadlinePassed) return null;

  const risk = Math.abs(barrier.plan.entry - barrier.plan.sl);
  const vol = barrier.plan.entry ? risk / (1.5 * barrier.plan.entry) : 0;
  const res = evaluateBarrier({ side: barrier.side, plan: barrier.plan, path, deadlineMs: barrier.deadlineMs, volatility: vol });

  // masih berjalan (belum kena batas & belum lewat deadline) → jangan tutup
  if (res.outcome === 'timeout' && !deadlinePassed) return null;

  // baseline arah-acak berseed pada jalur yang sama
  const rnd = seededRandom(hashStr(barrier.signalId || `${barrier.symbol}:${since}`));
  const baseSide = rnd() < 0.5 ? 'long' : 'short';
  const basePlan = buildPlan({ side: baseSide, entry: barrier.plan.entry, atr: risk / 1.5, rr: barrier.plan.rr || 2 });
  const baseRes = evaluateBarrier({ side: baseSide, plan: basePlan, path, deadlineMs: barrier.deadlineMs, volatility: vol });

  return {
    ...barrier,
    outcome: res.outcome,
    rMultiple: res.rMultiple,
    netR: res.netR,
    baselineNetR: baseRes.netR,
    resolvedAt: res.resolvedAt,
  };
}
