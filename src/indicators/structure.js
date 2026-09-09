// @ts-check
/**
 * Struktur pasar & level — kausal, murni.
 * Swing pivot, BOS/CHoCH, Anchored VWAP. Tidak ada lookahead: pivot pada indeks
 * i baru dikonfirmasi setelah `right` bar ke kanan, jadi fungsi hanya menandai
 * pivot yang SUDAH terkonfirmasi pada atau sebelum posisi terakhir.
 */

/**
 * Deteksi swing pivot high/low dengan jendela kiri-kanan.
 * @param {number[]} highs @param {number[]} lows
 * @param {number} left @param {number} right
 * @returns {{highs:{idx:number,price:number}[], lows:{idx:number,price:number}[]}}
 */
export function swings(highs, lows, left = 2, right = 2) {
  const sh = [];
  const sl = [];
  for (let i = left; i < highs.length - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) sh.push({ idx: i, price: highs[i] });
    if (isLow) sl.push({ idx: i, price: lows[i] });
  }
  return { highs: sh, lows: sl };
}

/**
 * Tentukan bias struktur dan event terakhir (BOS/CHoCH) dari urutan swing.
 * Mengembalikan Bias (kosakata 'bullish'/'bearish'/'neutral'), BUKAN Side —
 * pemanggil wajib biasToSide() (§21.1 bug #1).
 * @param {number[]} highs @param {number[]} lows @param {number[]} closes
 * @returns {{bias: import('../core/types.js').Bias, event: 'BOS'|'CHoCH'|null, lastSwingHigh:number|null, lastSwingLow:number|null}}
 */
export function structureBias(highs, lows, closes) {
  const { highs: sh, lows: sl } = swings(highs, lows, 2, 2);
  const lastSwingHigh = sh.length ? sh[sh.length - 1].price : null;
  const lastSwingLow = sl.length ? sl[sl.length - 1].price : null;
  if (sh.length < 2 || sl.length < 2) {
    return { bias: 'neutral', event: null, lastSwingHigh, lastSwingLow };
  }
  const hh = sh[sh.length - 1].price > sh[sh.length - 2].price;
  const hl = sl[sl.length - 1].price > sl[sl.length - 2].price;
  const lh = sh[sh.length - 1].price < sh[sh.length - 2].price;
  const ll = sl[sl.length - 1].price < sl[sl.length - 2].price;

  /** @type {import('../core/types.js').Bias} */
  let bias = 'neutral';
  if (hh && hl) bias = 'bullish';
  else if (lh && ll) bias = 'bearish';

  // Event: harga menembus swing terakhir yang berlawanan arah
  const price = closes[closes.length - 1];
  /** @type {'BOS'|'CHoCH'|null} */
  let event = null;
  if (lastSwingHigh != null && price > lastSwingHigh) {
    event = bias === 'bearish' ? 'CHoCH' : 'BOS';
  } else if (lastSwingLow != null && price < lastSwingLow) {
    event = bias === 'bullish' ? 'CHoCH' : 'BOS';
  }
  return { bias, event, lastSwingHigh, lastSwingLow };
}

/**
 * Anchored VWAP dari indeks anchor sampai akhir + band ±k·sigma.
 * @param {number[]} highs @param {number[]} lows @param {number[]} closes @param {number[]} volumes
 * @param {number} anchorIdx @param {number} k
 * @returns {{vwap:number, upper:number, lower:number}|null}
 */
export function anchoredVWAP(highs, lows, closes, volumes, anchorIdx, k = 0.5) {
  if (anchorIdx < 0 || anchorIdx >= closes.length) return null;
  let pv = 0, vol = 0, pv2 = 0;
  for (let i = anchorIdx; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    pv += tp * volumes[i];
    pv2 += tp * tp * volumes[i];
    vol += volumes[i];
  }
  if (vol === 0) return null;
  const vwap = pv / vol;
  const variance = Math.max(0, pv2 / vol - vwap * vwap);
  const sigma = Math.sqrt(variance);
  return { vwap, upper: vwap + k * sigma, lower: vwap - k * sigma };
}

/**
 * Cari indeks anchor otomatis: swing extreme terbaru dalam lookback.
 * @param {number[]} highs @param {number[]} lows
 * @param {number} lookback
 */
export function autoAnchor(highs, lows, lookback = 100) {
  const start = Math.max(0, highs.length - lookback);
  let hiIdx = start, loIdx = start;
  for (let i = start; i < highs.length; i++) {
    if (highs[i] > highs[hiIdx]) hiIdx = i;
    if (lows[i] < lows[loIdx]) loIdx = i;
  }
  // anchor ke ekstrem yang lebih baru
  return Math.max(hiIdx, loIdx);
}
