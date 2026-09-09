// @ts-check
/**
 * Self-test wiring (§G-R4, preseden Patah Pensill). Menjalankan pipeline MURNI
 * ujung-ke-ujung di atas candle sintetis — tanpa jaringan, tanpa DOM — untuk
 * menangkap galat integrasi antar-modul (impor salah, bentuk data tak cocok)
 * yang lolos dari uji unit per-fungsi.
 *
 * Jalankan: node scripts/selftest.js
 */

import { analyzeSymbol } from '../src/scoring/pipeline.js';
import { predictRegime, regimeModulators } from '../src/scoring/markov.js';
import { rsi } from '../src/indicators/indicators.js';
import { priorCalibration, sanityGate } from '../src/scoring/calibration.js';

/** Buat candle sintetis dengan tren naik + noise deterministik. */
function synthCandles(n, trend) {
  const open = [], high = [], low = [], close = [], volume = [], openTime = [];
  let price = 100;
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const t0 = Date.now() - n * 900_000;
  for (let i = 0; i < n; i++) {
    const drift = trend * price;
    const noise = (rand() - 0.5) * price * 0.01;
    const o = price;
    price = Math.max(1, price + drift + noise);
    const c = price;
    const hi = Math.max(o, c) + rand() * price * 0.003;
    const lo = Math.min(o, c) - rand() * price * 0.003;
    open.push(o); high.push(hi); low.push(lo); close.push(c);
    volume.push(1000 + rand() * 500);
    openTime.push(t0 + i * 900_000);
  }
  return { open, high, low, close, volume, openTime };
}

let failures = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ ' + msg); failures++; }
}

console.log('Self-test pipeline (candle sintetis):');

// 1. Tren naik kuat → arah long, atau setidaknya tidak short
const up = synthCandles(200, 0.004);
const ctx = synthCandles(200, 0.004);
const regime = predictRegime(up.close, (x) => rsi(x, 14));
const a = analyzeSymbol({
  symbol: 'TESTUSDT', timeframe: '15m', candles: up,
  fundingRate: 0.0003, oiChange: 0.02, longShortRatio: 1.1,
  cvdZ: 0.8, obImbalance: 0.2,
  mtfAlignment: 1, regimeMod: regimeModulators(regime),
});

ok(a && a.fullScore != null, 'analyzeSymbol menghasilkan fullScore');
ok(['long', 'short', 'neutral'].includes(a.fullScore.direction), 'direction valid');
ok(a.fullScore.strength >= 0 && a.fullScore.strength <= 100, 'strength dalam 0..100');
ok(a.fullScore.agreement === null || (a.fullScore.agreement >= 0 && a.fullScore.agreement <= 100), 'agreement null atau dalam 0..100');
ok(a.rankScore != null && a.entryScore != null, 'rank & entry score terpisah ada (§4.3)');
ok(typeof a.lastPrice === 'number' && a.lastPrice > 0, 'lastPrice masuk akal');
ok(a.atr == null || a.atr > 0, 'atr null atau positif');
ok(Array.isArray(a.families) && a.families.length === 8, 'delapan keluarga dilaporkan');
ok(a.fullScore.direction !== 'short', 'tren naik tak menghasilkan short (sanity)');

// 2. Data terlalu sedikit → gate keluarga menahan sinyal
const tiny = synthCandles(30, 0);
const b = analyzeSymbol({ symbol: 'TINYUSDT', timeframe: '15m', candles: tiny });
ok(b.fullScore.availableCount >= 0, 'availableCount terdefinisi pada data minim');

// 3. Kalibrasi prior & gate kewajaran
const cal = priorCalibration();
ok(cal.status === 'prior' && cal.model_version === 'prior-v0', 'kalibrasi prior default benar');
const gate = sanityGate({ winRate: 0.9, sharpe: 5, n: 50 });
ok(gate.triggered && gate.reasons.length >= 2, 'gate kewajaran menyala pada angka mustahil (§O-R9)');
const gate2 = sanityGate({ winRate: 0.55, sharpe: 1.2, n: 50 });
ok(!gate2.triggered, 'gate diam pada angka wajar');

if (failures) {
  console.error(`\n✗ selftest gagal: ${failures} masalah.`);
  process.exit(1);
}
console.log('\n✓ selftest lolos — pipeline terangkai benar ujung-ke-ujung.');
