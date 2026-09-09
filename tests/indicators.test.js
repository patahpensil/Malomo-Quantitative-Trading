// @ts-check
/**
 * Uji indikator: vektor emas + keamanan-null. Menutup bug #3 Patah Pensill
 * (bollinger membagi dengan period, bukan jumlah data nyata) dan memastikan
 * indikator mengembalikan null saat data kurang, bukan angka yang terlihat sah.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, bollinger, rvol, last, macd } from '../src/indicators/indicators.js';

/** @param {number} a @param {number} b @param {number} [eps] */
function close(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

test('sma: nilai & penjajaran indeks', () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null);
  assert.equal(s[1], null);
  assert.ok(close(/** @type {number} */(s[2]), 2));
  assert.ok(close(/** @type {number} */(s[3]), 3));
  assert.ok(close(/** @type {number} */(s[4]), 4));
});

test('ema: seed = SMA pertama, deterministik', () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  // seed di indeks 2 = mean(1,2,3)=2
  assert.ok(close(/** @type {number} */(e[2]), 2));
  // k = 2/4 = 0.5 → e[3] = 4*0.5 + 2*0.5 = 3
  assert.ok(close(/** @type {number} */(e[3]), 3));
  // e[4] = 5*0.5 + 3*0.5 = 4
  assert.ok(close(/** @type {number} */(e[4]), 4));
});

test('rsi: naik monoton → 100; cukup data', () => {
  const up = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const r = rsi(up, 14);
  assert.equal(r[13], null, 'belum ada nilai sebelum period+1');
  assert.ok(/** @type {number} */(r[14]) === 100, 'kenaikan murni → RSI 100');
});

test('rsi: data kurang → semua null (bukan angka palsu)', () => {
  const r = rsi([1, 2, 3], 14);
  assert.ok(r.every((v) => v === null));
});

test('bollinger: BUG #3 — null bila kurang dari period, tidak mengarang', () => {
  const b = bollinger([1, 2, 3], 20, 2);
  assert.ok(b.mid.every((v) => v === null), 'mid null saat data < period');
  assert.ok(b.upper.every((v) => v === null));
  assert.ok(b.lower.every((v) => v === null));
});

test('bollinger: deviasi standar memakai period penuh, band simetris', () => {
  const data = Array.from({ length: 25 }, (_, i) => 10 + Math.sin(i));
  const b = bollinger(data, 20, 2);
  const i = 24;
  assert.ok(b.mid[i] != null);
  const mid = /** @type {number} */(b.mid[i]);
  const up = /** @type {number} */(b.upper[i]);
  const lo = /** @type {number} */(b.lower[i]);
  assert.ok(close(up - mid, mid - lo, 1e-9), 'band simetris terhadap mid');
});

test('atr: null sebelum cukup data, positif setelahnya', () => {
  const highs = Array.from({ length: 20 }, (_, i) => 10 + i * 0.1 + 0.05);
  const lows = Array.from({ length: 20 }, (_, i) => 10 + i * 0.1 - 0.05);
  const closes = Array.from({ length: 20 }, (_, i) => 10 + i * 0.1);
  const a = atr(highs, lows, closes, 14);
  assert.equal(a[13], null);
  assert.ok(/** @type {number} */(a[14]) > 0);
});

test('rvol: kausal — hanya bar SEBELUM bar kini (tanpa lookahead)', () => {
  const vols = [10, 10, 10, 10, 100]; // lonjakan di bar terakhir
  const rv = rvol(vols, 4);
  // di indeks 4: rata-rata bar 0..3 = 10 → rvol = 100/10 = 10
  assert.ok(close(/** @type {number} */(rv[4]), 10), `dapat ${rv[4]}`);
});

test('macd: hist terdefinisi setelah cukup data', () => {
  const data = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  const m = macd(data);
  assert.ok(last(m.hist) != null, 'hist punya nilai di ujung');
});

test('last: ambil nilai non-null terakhir', () => {
  assert.equal(last([1, 2, null]), 2);
  assert.equal(last([null, null]), null);
});
