// @ts-check
/**
 * Perakit keluarga bukti E1-E8 dari deret candle. Menghasilkan peta
 * family→Criterion[] yang dikonsumsi engine.computeScore.
 *
 * §CD-5: murni; hanya mengimpor indikator & config.
 * §P-5: seluruh turunan momentum masuk SATU keluarga (E3), bukan banyak suara.
 */

import * as ind from '../indicators/indicators.js';
import * as st from '../indicators/structure.js';
import { makeCriterion, makeCenteredCriterion } from './criterion.js';
import { biasToSide, sideSign } from '../core/types.js';
import { CRITERIA } from '../core/config.js';

/**
 * @typedef {Object} Candles
 * @property {number[]} open @property {number[]} high @property {number[]} low
 * @property {number[]} close @property {number[]} volume
 * @property {number[]} openTime
 */

/**
 * Rakit keluarga berbasis-harga (E1,E2,E3,E4,E8) dari satu timeframe.
 * @param {Candles} c
 * @param {{mtfAlignment?:number}} [extra] data non-candle opsional
 * @returns {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>}
 */
export function buildPriceFamilies(c, extra = {}) {
  const { high, low, close, volume } = c;
  /** @type {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} */
  const out = {};

  // ---- E1 Struktur harga ----
  const s = st.structureBias(high, low, close);
  const structSide = biasToSide(s.bias); // konversi sah
  out.E1 = [
    makeCriterion({
      id: 'struktur.bias', family: 'E1',
      raw: structSide === 'neutral' ? 0 : sideSign(structSide) * (s.event === 'BOS' ? 1 : s.event === 'CHoCH' ? 0.6 : 0.4),
      edge: 0.2, sat: 1, unit: 'struct',
      decideSide: () => structSide,
    }),
  ];

  // ---- E2 Level (AVWAP) ----
  const anchor = st.autoAnchor(high, low, 100);
  const av = st.anchoredVWAP(high, low, close, volume, anchor, 0.5);
  if (av) {
    const price = close[close.length - 1];
    const dist = (price - av.vwap) / av.vwap; // relatif
    out.E2 = [
      makeCriterion({ id: 'avwap.dist', family: 'E2', raw: dist, edge: 0.001, sat: 0.02, unit: 'rel' }),
    ];
  } else {
    out.E2 = [makeCriterion({ id: 'avwap.dist', family: 'E2', raw: null, edge: 0.001, sat: 0.02 })];
  }

  // ---- E3 Momentum (SATU keluarga: EMA slope, RSI, MACD hist, ADX/DI) ----
  const emaFast = ind.ema(close, 21);
  const emaSlopeRaw = slopeRel(emaFast, close[close.length - 1]);
  const rsiSeries = ind.rsi(close, 14);
  const rsiVal = ind.last(rsiSeries);
  const m = ind.macd(close);
  const histVal = ind.last(m.hist);
  const histRel = histVal != null ? histVal / close[close.length - 1] : null;
  const a = ind.adx(high, low, close, 14);
  const adxVal = ind.last(a.adx);
  const pdi = ind.last(a.plusDI);
  const mdi = ind.last(a.minusDI);
  const diGap = pdi != null && mdi != null ? pdi - mdi : null;

  out.E3 = [
    makeCriterion({ id: 'ema21.slope', family: 'E3', raw: emaSlopeRaw, edge: CRITERIA.emaSlope.edge, sat: CRITERIA.emaSlope.sat, unit: 'rel/bar' }),
    makeCenteredCriterion({ id: 'rsi14', family: 'E3', value: rsiVal, center: 50, edge: CRITERIA.rsi.edge, sat: CRITERIA.rsi.sat, unit: 'rsi' }),
    makeCriterion({ id: 'macd.hist', family: 'E3', raw: histRel, edge: CRITERIA.macdHist.edge, sat: CRITERIA.macdHist.sat, unit: 'rel' }),
    // ADX hanya memberi arah bila kuat & gap DI cukup — deadband ganda (§17.1)
    makeCriterion({
      id: 'adx.di', family: 'E3',
      raw: adxVal != null && adxVal >= CRITERIA.adx.edge && diGap != null && Math.abs(diGap) >= CRITERIA.adx.diGapMin ? diGap : 0,
      edge: CRITERIA.adx.diGapMin, sat: 40, unit: 'di',
    }),
  ];

  // ---- E4 Volume & partisipasi ----
  const rv = ind.rvol(volume, 20);
  const rvVal = ind.last(rv);
  // volume tinggi menguatkan arah struktur, bukan arah sendiri → searah E1
  out.E4 = [
    makeCriterion({
      id: 'rvol', family: 'E4',
      raw: rvVal != null && structSide !== 'neutral' ? sideSign(structSide) * (rvVal - 1) : null,
      edge: CRITERIA.volume.edge - 1, sat: CRITERIA.volume.sat - 1, unit: 'x',
    }),
  ];

  // ---- E8 Multi-timeframe (diisi oleh pemanggil via extra.mtfAlignment) ----
  if (typeof extra.mtfAlignment === 'number') {
    out.E8 = [
      makeCriterion({ id: 'mtf.align', family: 'E8', raw: extra.mtfAlignment, edge: 0.2, sat: 1, unit: 'align' }),
    ];
  }

  return out;
}

/**
 * Rakit keluarga derivatif & sentimen (E5,E7) dari data non-candle.
 * @param {Object} p
 * @param {number|null} p.fundingRate
 * @param {number|null} p.oiChange       perubahan OI relatif
 * @param {number|null} p.longShortRatio rasio akun long/short (proxy sentimen)
 * @returns {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>}
 */
export function buildDerivFamilies({ fundingRate, oiChange, longShortRatio }) {
  /** @type {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} */
  const out = {};

  // E5 Derivatif: funding positif ekstrem = crowded long = bearish (kontra)
  out.E5 = [
    makeCriterion({
      id: 'funding', family: 'E5',
      raw: fundingRate != null ? -fundingRate : null, // kontra: funding tinggi → tekanan turun
      edge: CRITERIA.funding.edge, sat: CRITERIA.funding.sat, unit: 'ratio',
    }),
    makeCriterion({
      id: 'oi.change', family: 'E5',
      raw: oiChange, edge: CRITERIA.oi.edge, sat: CRITERIA.oi.sat, unit: 'ratio',
    }),
  ];

  // E7 Sentimen posisi: rasio L/S ekstrem = kontra (proxy, ditandai)
  out.E7 = [
    makeCriterion({
      id: 'longshort', family: 'E7',
      raw: longShortRatio != null ? -(longShortRatio - 1) : null, // >1 = crowded long → kontra
      edge: CRITERIA.longShort.edge, sat: CRITERIA.longShort.sat, unit: 'ratio',
      provenance: 'proxy',
    }),
  ];

  return out;
}

/**
 * Rakit keluarga order flow E6 dari metrik order flow.
 * @param {Object} p
 * @param {number|null} p.cvdZ         z-score CVD
 * @param {number|null} p.obImbalance  imbalance order book (-1..1)
 * @returns {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>}
 */
export function buildOrderFlowFamily({ cvdZ, obImbalance }) {
  return {
    E6: [
      makeCriterion({ id: 'cvd.z', family: 'E6', raw: cvdZ, edge: CRITERIA.cvd.edge, sat: CRITERIA.cvd.sat, unit: 'z' }),
      makeCriterion({ id: 'ob.imbalance', family: 'E6', raw: obImbalance, edge: CRITERIA.obImbalance.edge, sat: CRITERIA.obImbalance.sat, unit: 'ratio' }),
    ],
  };
}

/**
 * Kemiringan relatif deret terhadap harga (per bar), dari 5 nilai terakhir.
 * @param {(number|null)[]} series @param {number} price
 * @returns {number|null}
 */
function slopeRel(series, price) {
  const vals = [];
  for (let i = series.length - 1; i >= 0 && vals.length < 5; i--) {
    if (series[i] != null) vals.unshift(/** @type {number} */(series[i]));
  }
  if (vals.length < 2 || price === 0) return null;
  const slope = (vals[vals.length - 1] - vals[0]) / (vals.length - 1);
  return slope / price;
}

/**
 * Gabung beberapa peta keluarga menjadi satu.
 * @param {...Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} maps
 */
export function mergeFamilies(...maps) {
  /** @type {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} */
  const out = {};
  for (const m of maps) {
    for (const k of Object.keys(m)) {
      const fam = /** @type {import('../core/types.js').Family} */ (k);
      out[fam] = (out[fam] || []).concat(m[fam] || []);
    }
  }
  return out;
}
