// @ts-check
/**
 * Uji triple barrier & statistik ekspektasi (§6, §20). Menggantikan metrik
 * akurasi 24-jam Patah Pensill yang rusak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, evaluateBarrier, seededRandom, expectancy, sharpe } from '../src/store/barrier.js';

test('buildPlan: SL & TP simetris terhadap risiko dengan R:R benar', () => {
  const plan = buildPlan({ side: 'long', entry: 100, atr: 2, rr: 2 });
  // risk = 1.5*2 = 3 → SL 97, TP 100+2*3=106
  assert.equal(plan.sl, 97);
  assert.equal(plan.tp, 106);
  assert.equal(plan.rr, 2);
});

test('buildPlan short: arah SL/TP terbalik', () => {
  const plan = buildPlan({ side: 'short', entry: 100, atr: 2, rr: 2 });
  assert.equal(plan.sl, 103);
  assert.equal(plan.tp, 94);
});

test('evaluateBarrier: bila SL & TP tersentuh di bar sama → ambil SL (konservatif §O-R2)', () => {
  const plan = { entry: 100, sl: 97, tp: 106 };
  const path = [{ high: 107, low: 96, openTime: 1000 }]; // keduanya kena
  const r = evaluateBarrier({ side: 'long', plan, path, deadlineMs: 10_000 });
  assert.equal(r.outcome, 'loss', 'ambigu → dihitung loss, bukan win');
  assert.ok(r.netR <= -1, 'termasuk biaya');
});

test('evaluateBarrier: TP murni → win dengan R sesuai', () => {
  const plan = { entry: 100, sl: 97, tp: 106 };
  const path = [{ high: 106, low: 99, openTime: 1000 }];
  const r = evaluateBarrier({ side: 'long', plan, path, deadlineMs: 10_000 });
  assert.equal(r.outcome, 'win');
  assert.ok(r.rMultiple > 1.9 && r.rMultiple < 2.1);
  assert.ok(r.netR < r.rMultiple, 'net < gross karena biaya (§O-R3)');
});

test('evaluateBarrier: tak tersentuh sampai deadline → timeout dengan hanya biaya', () => {
  const plan = { entry: 100, sl: 97, tp: 106 };
  const path = [{ high: 101, low: 99, openTime: 1000 }, { high: 102, low: 98, openTime: 2000 }];
  const r = evaluateBarrier({ side: 'long', plan, path, deadlineMs: 10_000 });
  assert.equal(r.outcome, 'timeout');
  assert.ok(r.netR <= 0);
});

test('evaluateBarrier: bar setelah deadline diabaikan (§O-R4)', () => {
  const plan = { entry: 100, sl: 97, tp: 106 };
  const path = [{ high: 106, low: 99, openTime: 20_000 }]; // TP kena TAPI setelah deadline
  const r = evaluateBarrier({ side: 'long', plan, path, deadlineMs: 10_000 });
  assert.equal(r.outcome, 'timeout', 'sentuhan setelah deadline tak dihitung');
});

test('seededRandom: reproducible untuk seed sama (§BK-3)', () => {
  const a = seededRandom(42); const b = seededRandom(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  // seed beda → urutan beda
  const c = seededRandom(43);
  assert.notEqual(seqA[0], c());
});

test('expectancy: win rate & profit factor benar', () => {
  const results = [
    { outcome: 'win', netR: 2 }, { outcome: 'win', netR: 2 },
    { outcome: 'loss', netR: -1 }, { outcome: 'loss', netR: -1 },
  ];
  const e = expectancy(results);
  assert.equal(e.n, 4);
  assert.equal(e.winRate, 0.5);
  // grossWin=4, grossLoss=2 → PF=2
  assert.ok(Math.abs(e.profitFactor - 2) < 1e-9);
  // expectancy = (2+2-1-1)/4 = 0.5
  assert.ok(Math.abs(e.expectancyR - 0.5) < 1e-9);
});

test('expectancy: kosong → nol aman, tanpa NaN', () => {
  const e = expectancy([]);
  assert.equal(e.n, 0);
  assert.equal(e.expectancyR, 0);
  assert.ok(!Number.isNaN(e.profitFactor));
});

test('sharpe: konstanta positif tanpa variansi → 0 (tak bagi nol)', () => {
  assert.equal(sharpe([1, 1, 1, 1]), 0);
});
