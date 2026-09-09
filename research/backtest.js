// @ts-check
/**
 * BIDANG RISET — harness backtest walk-forward.
 *
 * Inti janji arsitektur (§2, §CD-5): berkas ini mengimpor scoring/ dan
 * indicators/ YANG SAMA PERSIS dengan aplikasi live. Bukan salinan. Bila logika
 * skor di sini berbeda dari yang dijalankan di HP, itu mustahil — keduanya
 * berkas yang sama. Inilah yang menutup celah live-vs-backtest yang membuat
 * kebanyakan sistem trading membohongi pemiliknya.
 *
 * Ruang lingkup v1 (jujur): backtest berbasis-HARGA saja (E1,E2,E3,E4). Data
 * funding/OI/order-flow historis point-in-time sulit direkonstruksi andal, jadi
 * keluarga E5-E7 sengaja TIDAK diikutkan di harness ini. E8 (MTF) diikutkan bila
 * timeframe konteks tersedia. Dengan empat keluarga harga, ambang minFamilies=4
 * tepat terpenuhi — backtest menguji tulang punggung harga, bukan seluruh sinyal.
 *
 * Yang dihasilkan: laporan ekspektasi + baseline acak + gate kewajaran (§6, §O-R9).
 * Penyetelan bobot per-keluarga (IC) adalah langkah riset berikutnya; harness ini
 * memakai bobot prior dan MEMBUKTIKAN apakah edукасi harga punya ekspektasi
 * positif setelah biaya — pertanyaan yang harus dijawab sebelum bicara bobot.
 *
 * Jalankan (butuh internet, di PC):
 *   node research/backtest.js BTCUSDT 15m 1h 60
 *   (simbol, timeframe, timeframe-konteks, jumlah-hari)
 */

import { analyzeSymbol } from '../src/scoring/pipeline.js';
import { predictRegime, regimeModulators } from '../src/scoring/markov.js';
import { rsi, atr, last } from '../src/indicators/indicators.js';
import { structureBias } from '../src/indicators/structure.js';
import { biasToSide, sideSign, TF_MS } from '../src/core/types.js';
import { THRESHOLDS, COSTS } from '../src/core/config.js';
import { buildPlan, evaluateBarrier, seededRandom, expectancy, sharpe } from '../src/store/barrier.js';
import { sanityGate } from '../src/scoring/calibration.js';

const FAPI = 'https://fapi.binance.com';
const WARMUP = 210; // cukup untuk ADX/EMA/Bollinger di TF aktif

/**
 * Ambil klines historis dengan paginasi (semua bar tertutup).
 * @param {string} symbol @param {string} interval @param {number} startTime @param {number} endTime
 */
async function fetchKlinesPaged(symbol, interval, startTime, endTime) {
  /** @type {any[]} */
  const rows = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} klines ${symbol} ${interval}`);
    /** @type {any[]} */
    const batch = await res.json();
    if (!batch.length) break;
    rows.push(...batch);
    const lastOpen = batch[batch.length - 1][0];
    if (batch.length < 1500) break;
    cursor = lastOpen + 1;
    await sleep(250); // sopan terhadap rate limit
  }
  // buang bar terakhir bila belum tutup
  const now = Date.now();
  const tfms = intervalMs(interval);
  while (rows.length && rows[rows.length - 1][0] + tfms > now) rows.pop();
  return toCandles(rows);
}

/** @param {any[]} rows */
function toCandles(rows) {
  return {
    openTime: rows.map((k) => k[0]),
    open: rows.map((k) => parseFloat(k[1])),
    high: rows.map((k) => parseFloat(k[2])),
    low: rows.map((k) => parseFloat(k[3])),
    close: rows.map((k) => parseFloat(k[4])),
    volume: rows.map((k) => parseFloat(k[5])),
  };
}

/** @param {import('../src/scoring/families.js').Candles} c @param {number} i (inklusif) */
function sliceCandles(c, i) {
  return {
    openTime: c.openTime.slice(0, i + 1), open: c.open.slice(0, i + 1),
    high: c.high.slice(0, i + 1), low: c.low.slice(0, i + 1),
    close: c.close.slice(0, i + 1), volume: c.volume.slice(0, i + 1),
  };
}

/** Cari indeks konteks (TF lebih besar) yang sudah tertutup pada waktu t. */
function ctxIndexAt(ctx, t) {
  let idx = -1;
  for (let j = 0; j < ctx.openTime.length; j++) { if (ctx.openTime[j] <= t) idx = j; else break; }
  return idx;
}

/** MTF alignment point-in-time: bias struktur TF aktif vs konteks. */
function mtfAt(active, ctxSlice) {
  const a = biasToSide(structureBias(active.high, active.low, active.close).bias);
  const c = biasToSide(structureBias(ctxSlice.high, ctxSlice.low, ctxSlice.close).bias);
  if (a === 'neutral' || c === 'neutral') return 0;
  return a === c ? sideSign(a) : 0;
}

async function main() {
  const [symbol = 'BTCUSDT', tf = '15m', ctxTf = '1h', daysStr = '60'] = process.argv.slice(2);
  const days = parseInt(daysStr, 10);
  const endTime = Date.now();
  const startTime = endTime - days * 86_400_000;

  console.log(`Backtest ${symbol} ${tf} (konteks ${ctxTf}) — ${days} hari`);
  console.log('Mengambil data historis…');
  const candles = await fetchKlinesPaged(symbol, tf, startTime, endTime);
  const ctx = await fetchKlinesPaged(symbol, ctxTf, startTime - 5 * intervalMs(ctxTf), endTime);
  const c4h = await fetchKlinesPaged(symbol, '4h', startTime - 40 * intervalMs('4h'), endTime);
  console.log(`  ${candles.close.length} bar ${tf}, ${ctx.close.length} bar ${ctxTf}`);

  const atrArr = atr(candles.high, candles.low, candles.close, 14);
  const rnd = seededRandom(0xC0FFEE);
  const tfms = TF_MS[/** @type {any} */(tf)] || intervalMs(tf);

  /** @type {{outcome:string, netR:number, baselineNetR:number}[]} */
  const trades = [];

  for (let i = WARMUP; i < candles.close.length - 1; i++) {
    const t = candles.openTime[i];
    const active = sliceCandles(candles, i);

    // konteks & regime point-in-time
    const ci = ctxIndexAt(ctx, t);
    const ctxSlice = ci >= 5 ? sliceCandles(ctx, ci) : null;
    const mtf = ctxSlice ? mtfAt(active, ctxSlice) : undefined;

    const ri = ctxIndexAt(c4h, t);
    let regimeMod = {};
    if (ri >= 30) {
      const closes4h = c4h.close.slice(0, ri + 1);
      const reg = predictRegime(closes4h, (x) => rsi(x, 14));
      regimeMod = regimeModulators(reg);
    }

    const a = analyzeSymbol({
      symbol, timeframe: /** @type {any} */(tf), candles: active,
      mtfAlignment: mtf, regimeMod,
    });

    const sc = a.fullScore;
    if (sc.direction === 'neutral' || sc.strength < THRESHOLDS.confirmedStrength) continue;
    const atrVal = atrArr[i];
    if (atrVal == null) continue;

    const entry = candles.close[i];
    const plan = buildPlan({ side: sc.direction, entry, atr: atrVal, rr: 2 });

    // jalur intrabar setelah sinyal (pakai TF aktif sebagai proksi intrabar)
    const path = [];
    const deadline = t + 24 * tfms;
    for (let j = i + 1; j < candles.close.length && candles.openTime[j] <= deadline; j++) {
      path.push({ high: candles.high[j], low: candles.low[j], openTime: candles.openTime[j] });
    }
    const vol = atrVal / entry;
    const real = evaluateBarrier({ side: sc.direction, plan, path, deadlineMs: deadline, volatility: vol });

    // baseline: arah acak, rencana & jalur sama (§BK-3)
    const baseSide = rnd() < 0.5 ? 'long' : 'short';
    const basePlan = buildPlan({ side: baseSide, entry, atr: atrVal, rr: 2 });
    const baseRes = evaluateBarrier({ side: baseSide, plan: basePlan, path, deadlineMs: deadline, volatility: vol });

    trades.push({ outcome: real.outcome, netR: real.netR, baselineNetR: baseRes.netR });

    // lewati bar sampai trade selesai kira-kira (hindari sinyal bertumpuk) 
    i += 3;
  }

  report(symbol, tf, trades);
}

/** @param {string} symbol @param {string} tf @param {{outcome:string,netR:number,baselineNetR:number}[]} trades */
function report(symbol, tf, trades) {
  console.log(`\n=== Hasil ${symbol} ${tf} ===`);
  console.log(`Jumlah trade: ${trades.length}`);
  if (trades.length < THRESHOLDS.minSignalsForStats) {
    console.log(`Di bawah ${THRESHOLDS.minSignalsForStats} trade — terlalu sedikit untuk statistik andal (§BK-1).`);
    console.log('Perpanjang periode atau pilih pair lebih aktif.');
    return;
  }
  const real = expectancy(trades.map((t) => ({ outcome: t.outcome, netR: t.netR })));
  const base = expectancy(trades.map((t) => ({ outcome: t.baselineNetR > 0 ? 'win' : 'loss', netR: t.baselineNetR })));
  const sh = sharpe(trades.map((t) => t.netR));

  const fmt = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(3)}R`;
  console.log(`\n            SISTEM        BASELINE ACAK`);
  console.log(`Ekspektasi  ${fmt(real.expectancyR).padEnd(12)}  ${fmt(base.expectancyR)}`);
  console.log(`Win rate    ${(real.winRate * 100).toFixed(1).padEnd(12)}% ${(base.winRate * 100).toFixed(1)}%`);
  console.log(`Profit fac. ${(real.profitFactor === Infinity ? '∞' : real.profitFactor.toFixed(2)).padEnd(12)}  ${base.profitFactor === Infinity ? '∞' : base.profitFactor.toFixed(2)}`);
  console.log(`Sharpe/trd  ${sh.toFixed(2)}`);
  console.log(`IK 95% eksp ${real.ci95[0].toFixed(3)}R … ${real.ci95[1].toFixed(3)}R`);

  const edge = real.expectancyR - base.expectancyR;
  console.log(`\nEdge vs acak: ${fmt(edge)} per trade.`);
  if (real.ci95[0] > 0) console.log('IK bawah > 0 — ekspektasi positif signifikan (setelah biaya).');
  else console.log('IK bawah <= 0 — belum bisa dibedakan dari nol secara statistik. Jangan overклaim.');

  const gate = sanityGate({ winRate: real.winRate, sharpe: sh, n: real.n });
  if (gate.triggered) {
    console.log('\n⚠ GATE KEWAJARAN MENYALA:');
    for (const r of gate.reasons) console.log('  - ' + r);
    console.log('  Angka terlalu bagus. Curigai lookahead/biaya-hilang SEBELUM merayakannya (§O-R9).');
  }
  console.log(`\nBiaya dimodelkan: taker ${(COSTS.takerFee * 100).toFixed(3)}% ×2 + slippage k=${COSTS.slippageK}.`);
}

/** @param {string} iv */
function intervalMs(iv) {
  const n = parseInt(iv, 10);
  if (iv.endsWith('m')) return n * 60_000;
  if (iv.endsWith('h')) return n * 3_600_000;
  if (iv.endsWith('d')) return n * 86_400_000;
  return 60_000;
}
/** @param {number} ms */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exit(1); });
