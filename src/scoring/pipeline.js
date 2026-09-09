// @ts-check
/**
 * Pipeline analisa satu simbol — menyatukan data → keluarga → skor.
 * Memisahkan rank_score dan entry_score sesuai §4.3.
 *
 * §CD-5 tetap dijaga: modul ini boleh mengimpor scoring & indikator (murni),
 * TAPI menerima data lewat argumen — tidak memanggil jaringan sendiri, sehingga
 * bisa dipakai identik di Bidang Riset.
 */

import { computeScore } from './engine.js';
import { buildPriceFamilies, buildDerivFamilies, buildOrderFlowFamily, mergeFamilies } from './families.js';
import { RANK_FAMILIES, ENTRY_FAMILIES } from '../core/config.js';
import * as ind from '../indicators/indicators.js';

/**
 * @typedef {Object} SymbolInput
 * @property {string} symbol
 * @property {import('../core/types.js').Timeframe} timeframe
 * @property {import('./families.js').Candles} candles        timeframe aktif (tertutup)
 * @property {import('./families.js').Candles} [contextCandles] timeframe konteks
 * @property {number|null} [fundingRate]
 * @property {number|null} [oiChange]
 * @property {number|null} [longShortRatio]
 * @property {number|null} [cvdZ]
 * @property {number|null} [obImbalance]
 * @property {number} [mtfAlignment]  -1..1
 * @property {Partial<Record<import('../core/types.js').Family,number>>} [regimeMod]
 * @property {Partial<Record<import('../core/types.js').Family,number>>} [weights]
 */

/**
 * Analisa penuh → dua skor + rencana bahan.
 * @param {SymbolInput} inp
 */
export function analyzeSymbol(inp) {
  const price = buildPriceFamilies(inp.candles, { mtfAlignment: inp.mtfAlignment });
  const deriv = buildDerivFamilies({
    fundingRate: inp.fundingRate ?? null,
    oiChange: inp.oiChange ?? null,
    longShortRatio: inp.longShortRatio ?? null,
  });
  const of = buildOrderFlowFamily({
    cvdZ: inp.cvdZ ?? null,
    obImbalance: inp.obImbalance ?? null,
  });
  const all = mergeFamilies(price, deriv, of);

  // Pisahkan keluarga untuk dua skor (§4.3)
  const rankFams = pick(all, RANK_FAMILIES);
  const entryFams = pick(all, ENTRY_FAMILIES);

  const opts = { weights: inp.weights, regimeMod: inp.regimeMod };
  const rank = computeScore(rankFams, opts);
  const entry = computeScore(entryFams, opts);
  const full = computeScore(all, opts);

  // Bahan rencana entry
  const atrArr = ind.atr(inp.candles.high, inp.candles.low, inp.candles.close, 14);
  const atr = ind.last(atrArr);
  const lastPrice = inp.candles.close[inp.candles.close.length - 1];

  return {
    symbol: inp.symbol,
    timeframe: inp.timeframe,
    rankScore: rank,
    entryScore: entry,
    fullScore: full,
    lastPrice,
    atr,
    families: full.families,
  };
}

/**
 * @param {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} all
 * @param {readonly import('../core/types.js').Family[]} keys
 */
function pick(all, keys) {
  /** @type {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} */
  const out = {};
  for (const k of keys) if (all[k]) out[k] = all[k];
  return out;
}
