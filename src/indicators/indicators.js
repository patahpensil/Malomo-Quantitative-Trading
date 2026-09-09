// @ts-check
/**
 * Indikator teknikal — MURNI, KAUSAL, dan dapat diuji.
 *
 * Kontrak PRD:
 *  - §CD-5: modul ini TIDAK mengimpor apa pun dari UI/jaringan. Node & browser
 *    mengeksekusi berkas yang sama. Tidak ada `import` selain util murni.
 *  - §21.1 bug #3: data kurang → mengembalikan null, BUKAN angka yang terlihat
 *    valid. Ini kesalahan bollinger() Patah Pensill (bagi dengan period, bukan
 *    jumlah data nyata).
 *  - §Anti-lookahead (§21.3): fungsi hanya membaca elemen pada indeks <= i.
 *    Deret keluaran selaras indeks dengan masukan; posisi tanpa cukup data = null.
 *
 * Konvensi: input `closes`/`highs`/`lows`/`volumes` adalah array number sudah
 * bersih (bar tertutup bila pemanggil meminta closed). Fungsi ini TIDAK
 * memutuskan closed vs live — itu tugas pemanggil (§L-R1).
 */

/**
 * SMA sederhana, keluaran selaras indeks (null bila belum cukup).
 * @param {number[]} xs @param {number} period
 * @returns {(number|null)[]}
 */
export function sma(xs, period) {
  const out = new Array(xs.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= period) sum -= xs[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * EMA. Seed dengan SMA pertama agar deterministik & sesuai vektor rujukan.
 * @param {number[]} xs @param {number} period
 * @returns {(number|null)[]}
 */
export function ema(xs, period) {
  const out = new Array(xs.length).fill(null);
  if (period <= 0 || xs.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += xs[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < xs.length; i++) {
    prev = xs[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * RSI Wilder. Vektor emas diuji terhadap nilai referensi (§21.3).
 * @param {number[]} closes @param {number} period
 * @returns {(number|null)[]}
 */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD. Mengembalikan {macd,signal,hist} tiga deret selaras indeks.
 * @param {number[]} closes
 * @param {number} fast @param {number} slow @param {number} sig
 */
export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? /** @type {number} */(emaFast[i]) - /** @type {number} */(emaSlow[i]) : null
  );
  // signal = EMA dari macdLine pada bagian yang sudah terdefinisi
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const seq = /** @type {number[]} */ (macdLine.slice(firstIdx).filter((v) => v != null));
    const sigSeq = ema(seq, sig);
    for (let j = 0; j < sigSeq.length; j++) {
      const idx = firstIdx + j;
      signal[idx] = sigSeq[j];
      if (sigSeq[j] != null && macdLine[idx] != null) {
        hist[idx] = /** @type {number} */(macdLine[idx]) - /** @type {number} */(sigSeq[j]);
      }
    }
  }
  return { macd: macdLine, signal, hist };
}

/**
 * True Range & ATR (Wilder).
 * @param {number[]} highs @param {number[]} lows @param {number[]} closes @param {number} period
 * @returns {(number|null)[]}
 */
export function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = new Array(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * ADX + DI. Mengembalikan {adx,plusDI,minusDI}.
 * @param {number[]} highs @param {number[]} lows @param {number[]} closes @param {number} period
 */
export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const adxArr = new Array(n).fill(null);
  const pDI = new Array(n).fill(null);
  const mDI = new Array(n).fill(null);
  if (n <= 2 * period) return { adx: adxArr, plusDI: pDI, minusDI: mDI };

  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  // Wilder smoothing
  let trS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= period; i++) { trS += tr[i]; pS += plusDM[i]; mS += minusDM[i]; }
  const dx = new Array(n).fill(null);
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    const pdi = trS === 0 ? 0 : (100 * pS) / trS;
    const mdi = trS === 0 ? 0 : (100 * mS) / trS;
    pDI[i] = pdi; mDI[i] = mdi;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
  }
  // ADX = Wilder MA dari DX, dimulai 2*period
  const firstDx = period + 1;
  let sumDx = 0, cnt = 0, started = false, prevAdx = 0;
  for (let i = firstDx; i < n; i++) {
    if (dx[i] == null) continue;
    if (!started) {
      sumDx += /** @type {number} */(dx[i]); cnt++;
      if (cnt === period) { prevAdx = sumDx / period; adxArr[i] = prevAdx; started = true; }
    } else {
      prevAdx = (prevAdx * (period - 1) + /** @type {number} */(dx[i])) / period;
      adxArr[i] = prevAdx;
    }
  }
  return { adx: adxArr, plusDI: pDI, minusDI: mDI };
}

/**
 * StochRSI. Mengembalikan {k,d}.
 * @param {number[]} closes @param {number} rsiP @param {number} stochP @param {number} kP @param {number} dP
 */
export function stochRsi(closes, rsiP = 14, stochP = 14, kP = 3, dP = 3) {
  const r = rsi(closes, rsiP);
  const n = closes.length;
  const raw = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < rsiP + stochP) continue;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - stochP + 1; j <= i; j++) {
      const v = r[j];
      if (v == null) { ok = false; break; }
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (!ok) continue;
    raw[i] = hi === lo ? 0 : ((/** @type {number} */(r[i]) - lo) / (hi - lo)) * 100;
  }
  const rawClean = /** @type {number[]} */ (raw.map((v) => (v == null ? 0 : v)));
  const k = sma(rawClean, kP);
  const kClean = /** @type {number[]} */ (k.map((v) => (v == null ? 0 : v)));
  const d = sma(kClean, dP);
  // maskai posisi yang aslinya null
  for (let i = 0; i < n; i++) if (raw[i] == null) { k[i] = null; d[i] = null; }
  return { k, d };
}

/**
 * Bollinger Bands. PERBAIKAN kelemahan Patah Pensill: membagi dengan jumlah
 * data NYATA, dan mengembalikan null bila kurang dari `period` (§21.1 bug #3).
 * @param {number[]} closes @param {number} period @param {number} mult
 */
export function bollinger(closes, period = 20, mult = 2) {
  const n = closes.length;
  const mid = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const m = sma(closes, period);
  for (let i = period - 1; i < n; i++) {
    if (m[i] == null) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - /** @type {number} */(m[i]);
      sq += diff * diff;
    }
    const sd = Math.sqrt(sq / period); // period penuh, dijamin oleh guard di atas
    mid[i] = m[i];
    upper[i] = /** @type {number} */(m[i]) + mult * sd;
    lower[i] = /** @type {number} */(m[i]) - mult * sd;
  }
  return { mid, upper, lower };
}

/**
 * RVOL — volume relatif terhadap rata-rata `period` bar SEBELUMNYA (tidak
 * termasuk bar kini → kausal, tanpa lookahead).
 * @param {number[]} volumes @param {number} period
 * @returns {(number|null)[]}
 */
export function rvol(volumes, period = 20) {
  const n = volumes.length;
  const out = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let s = 0;
    for (let j = i - period; j < i; j++) s += volumes[j];
    const avg = s / period;
    out[i] = avg === 0 ? null : volumes[i] / avg;
  }
  return out;
}

/**
 * Ambil nilai terakhir non-null dari deret indikator.
 * @param {(number|null)[]} series
 * @returns {number|null}
 */
export function last(series) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}
