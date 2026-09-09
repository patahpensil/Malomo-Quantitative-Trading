// @ts-check
/**
 * Triple barrier & statistik ekspektasi (§6, §20). Pengganti metrik akurasi
 * 24-jam Patah Pensill yang rusak (§4 pembedahan).
 *
 *  O-R1 tiga batas dari rencana entry saat sinyal terbit, bukan belakangan.
 *  O-R2 hasil = batas mana tersentuh DULU, pada data intrabar.
 *  O-R3 fee + slippage diperhitungkan; kotor tak pernah sendirian.
 *  O-R4 batas waktu mengikuti timeframe sinyal.
 *  BK-3 baseline acak berseed & reproducible pada pair+waktu+barrier identik.
 */

import { COSTS } from '../core/config.js';

/**
 * Rencana entry dari harga + ATR (§O-R1).
 * @param {Object} p
 * @param {import('../core/types.js').Side} p.side
 * @param {number} p.entry
 * @param {number} p.atr
 * @param {number} [p.rr]  target R:R
 * @param {(price:number)=>number} [p.roundTick]
 * @returns {{entry:number, sl:number, tp:number, rr:number}}
 */
export function buildPlan({ side, entry, atr, rr = 2, roundTick = (x) => x }) {
  const risk = 1.5 * atr;
  const sl = side === 'long' ? entry - risk : entry + risk;
  const tp = side === 'long' ? entry + rr * risk : entry - rr * risk;
  return {
    entry: roundTick(entry),
    sl: roundTick(sl),
    tp: roundTick(tp),
    rr,
  };
}

/**
 * Evaluasi barrier terhadap jalur harga intrabar (§O-R2).
 * Path adalah array {high,low,close,openTime} SETELAH sinyal, urut waktu.
 * @param {Object} p
 * @param {import('../core/types.js').Side} p.side
 * @param {{entry:number, sl:number, tp:number}} p.plan
 * @param {{high:number,low:number,openTime:number}[]} p.path
 * @param {number} p.deadlineMs  waktu batas absolut (§O-R4)
 * @param {number} [p.volatility] untuk slippage
 * @returns {{outcome:'win'|'loss'|'timeout', rMultiple:number, netR:number, resolvedAt:number}}
 */
export function evaluateBarrier({ side, plan, path, deadlineMs, volatility = 0 }) {
  const riskDist = Math.abs(plan.entry - plan.sl);
  const slip = COSTS.slippageK * volatility * plan.entry;
  const feeCost = COSTS.takerFee * 2 * plan.entry; // masuk+keluar
  const costR = riskDist > 0 ? (feeCost + slip) / riskDist : 0;

  for (const bar of path) {
    if (bar.openTime > deadlineMs) break;
    const hitSL = side === 'long' ? bar.low <= plan.sl : bar.high >= plan.sl;
    const hitTP = side === 'long' ? bar.high >= plan.tp : bar.low <= plan.tp;
    // §O-R2: bila keduanya tersentuh dalam satu bar, ambil yang KONSERVATIF (SL dulu)
    if (hitSL && hitTP) {
      return { outcome: 'loss', rMultiple: -1, netR: -1 - costR, resolvedAt: bar.openTime };
    }
    if (hitSL) return { outcome: 'loss', rMultiple: -1, netR: -1 - costR, resolvedAt: bar.openTime };
    if (hitTP) {
      const rr = Math.abs(plan.tp - plan.entry) / riskDist;
      return { outcome: 'win', rMultiple: rr, netR: rr - costR, resolvedAt: bar.openTime };
    }
  }
  // timeout: nilai pada harga terakhir dalam jendela
  const lastBar = path.length ? path[path.length - 1] : null;
  return { outcome: 'timeout', rMultiple: 0, netR: -costR, resolvedAt: lastBar ? lastBar.openTime : deadlineMs };
}

/**
 * PRNG deterministik (mulberry32) — untuk baseline acak reproducible (§BK-3).
 * @param {number} seed
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Statistik ekspektasi dari kumpulan hasil barrier (§O-R5, §BK-2).
 * @param {{outcome:string, netR:number}[]} results
 * @returns {{n:number, winRate:number, expectancyR:number, profitFactor:number, ci95:[number,number]}}
 */
export function expectancy(results) {
  const n = results.length;
  if (n === 0) return { n: 0, winRate: 0, expectancyR: 0, profitFactor: 0, ci95: [0, 0] };
  const wins = results.filter((r) => r.outcome === 'win');
  const grossWin = wins.reduce((a, r) => a + Math.max(0, r.netR), 0);
  const grossLoss = results.reduce((a, r) => a + Math.max(0, -r.netR), 0);
  const mean = results.reduce((a, r) => a + r.netR, 0) / n;
  const variance = results.reduce((a, r) => a + (r.netR - mean) ** 2, 0) / n;
  const se = Math.sqrt(variance / n);
  return {
    n,
    winRate: wins.length / n,
    expectancyR: mean,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    ci95: [mean - 1.96 * se, mean + 1.96 * se],
  };
}

/**
 * Deflated Sharpe sederhana untuk sekumpulan netR (§O-R10). Skala per-trade.
 * @param {number[]} netRs
 */
export function sharpe(netRs) {
  const n = netRs.length;
  if (n < 2) return 0;
  const mean = netRs.reduce((a, b) => a + b, 0) / n;
  const variance = netRs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  return sd === 0 ? 0 : (mean / sd) * Math.sqrt(n);
}
