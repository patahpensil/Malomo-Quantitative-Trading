// @ts-check
/**
 * Markov chain rezim pasar — bagian paling matang warisan Patah Pensill,
 * dipertahankan dengan tiga perbaikan (§4.4):
 *   M-R1 estimasi bergulir (rolling), bukan sekali atas seluruh sejarah.
 *   M-R3 state dari bar TERTUTUP; provisional ditandai terpisah oleh pemanggil.
 *
 * Yang dipertahankan benar dari aslinya:
 *   - fitur point-in-time (hanya data <= i)  → tanpa lookahead (§21.3)
 *   - Laplace smoothing pada transition matrix
 *   - Wilson lower bound untuk confidence
 *   - ambang keandalan n>=20 yang DITAMPILKAN, bukan disembunyikan
 */

import { MARKOV } from '../core/config.js';

/**
 * Klasifikasi state dari return & RSI point-in-time.
 * @param {number} ret   return periode
 * @param {number} rsi   RSI point-in-time
 * @returns {import('../core/types.js').Bias|'overheated'}
 */
export function classifyState(ret, rsi) {
  if (rsi >= 80) return 'overheated';
  if (ret > 0.02 || rsi >= 60) return 'bullish';
  if (ret < -0.02 || rsi <= 40) return 'bearish';
  return 'neutral';
}

/**
 * Bangun deret state dari candle 4H secara kausal.
 * @param {number[]} closes
 * @param {(closes:number[])=>(number|null)[]} rsiFn  fungsi RSI (disuntik utk uji)
 * @returns {(import('../core/types.js').Bias|'overheated')[]}
 */
export function buildStateSeries(closes, rsiFn) {
  const rsiArr = rsiFn(closes);
  /** @type {(import('../core/types.js').Bias|'overheated')[]} */
  const states = [];
  for (let i = 1; i < closes.length; i++) {
    const ret = (closes[i] - closes[i - 1]) / closes[i - 1];
    const r = rsiArr[i];
    if (r == null) { states.push('neutral'); continue; }
    states.push(classifyState(ret, r));
  }
  return states;
}

/**
 * Matriks transisi dengan Laplace smoothing.
 * @param {(import('../core/types.js').Bias|'overheated')[]} states
 * @param {number} [alpha]
 */
export function transitionMatrix(states, alpha = MARKOV.laplaceAlpha) {
  const S = MARKOV.states;
  const idx = /** @type {Record<string,number>} */ ({});
  S.forEach((s, i) => (idx[s] = i));
  const counts = S.map(() => S.map(() => 0));
  const rowTotal = S.map(() => 0);
  for (let i = 1; i < states.length; i++) {
    const a = idx[states[i - 1]], b = idx[states[i]];
    counts[a][b]++;
    rowTotal[a]++;
  }
  const n = S.length;
  const prob = counts.map((row, a) =>
    row.map((c) => (c + alpha) / (rowTotal[a] + alpha * n))
  );
  return { states: S, prob, counts, rowTotal };
}

/**
 * Wilson lower bound untuk proporsi (confidence bawah).
 * @param {number} k sukses @param {number} n total @param {number} z
 */
export function wilsonLower(k, n, z = 1.96) {
  if (n === 0) return 0;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

/**
 * Prediksi transisi dari state terakhir + keandalan.
 * @param {number[]} closes4h  candle 4H (tertutup)
 * @param {(closes:number[])=>(number|null)[]} rsiFn
 * @returns {{current:string, next:string, prob:number, confidence:number, reliable:boolean, sample:number}}
 */
export function predictRegime(closes4h, rsiFn) {
  const states = buildStateSeries(closes4h, rsiFn);
  if (states.length < 2) {
    return { current: 'neutral', next: 'neutral', prob: 0, confidence: 0, reliable: false, sample: 0 };
  }
  const { states: S, prob, rowTotal } = transitionMatrix(states);
  const current = states[states.length - 1];
  const row = S.indexOf(current);
  let best = 0;
  for (let j = 1; j < S.length; j++) if (prob[row][j] > prob[row][best]) best = j;
  const sample = rowTotal[row];
  const k = Math.round(prob[row][best] * sample);
  const confidence = wilsonLower(k, sample);
  return {
    current,
    next: S[best],
    prob: prob[row][best],
    confidence,
    reliable: sample >= MARKOV.minSample,
    sample,
  };
}

/**
 * Terjemahkan prediksi rezim menjadi modulator bobot per keluarga (§17.5).
 * Bila tidak reliable → semua 1.0 (netral). Rezim trending menaikkan bobot
 * momentum & struktur; rezim overheated menaikkan bobot derivatif/sentimen.
 * @param {ReturnType<typeof predictRegime>} r
 * @returns {Partial<Record<import('../core/types.js').Family, number>>}
 */
export function regimeModulators(r) {
  if (!r.reliable) return {};
  if (r.next === 'bullish' || r.next === 'bearish') {
    return { E1: 1.2, E3: 1.2, E5: 0.9, E7: 0.9 };
  }
  if (r.next === 'overheated') {
    return { E5: 1.3, E7: 1.3, E3: 0.8 };
  }
  return {}; // neutral → tanpa modulasi
}
