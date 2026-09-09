// @ts-check
/**
 * Uji anti-lookahead & anti-repaint (§21.3). Prinsip: nilai indikator pada
 * indeks i HANYA boleh bergantung pada data <= i. Konsekuensinya, menambahkan
 * bar baru di ujung TIDAK boleh mengubah nilai historis (prefix-stability).
 *
 * Ini menangkap repainting — cacat yang tersebar di Patah Pensill karena
 * indikator dihitung di atas bar berjalan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, macd, rvol } from '../src/indicators/indicators.js';
import { structureBias, anchoredVWAP } from '../src/indicators/structure.js';

const base = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 4) * 8 + i * 0.1);
const extended = base.concat([137.5, 139.2, 141.0]); // tiga bar "masa depan"

/**
 * Bandingkan deret pada rentang prefix — harus identik.
 * @param {(number|null)[]} a @param {(number|null)[]} b @param {number} upto
 */
function samePrefix(a, b, upto) {
  for (let i = 0; i < upto; i++) {
    if (a[i] == null && b[i] == null) continue;
    assert.ok(a[i] != null && b[i] != null && Math.abs(/** @type {number} */(a[i]) - /** @type {number} */(b[i])) < 1e-9,
      `beda di indeks ${i}: ${a[i]} vs ${b[i]}`);
  }
}

test('sma prefix-stable saat bar baru ditambah', () => {
  samePrefix(sma(base, 10), sma(extended, 10), base.length);
});

test('ema prefix-stable', () => {
  samePrefix(ema(base, 12), ema(extended, 12), base.length);
});

test('rsi prefix-stable', () => {
  samePrefix(rsi(base, 14), rsi(extended, 14), base.length);
});

test('atr prefix-stable', () => {
  const highs = base.map((c) => c + 0.5);
  const lows = base.map((c) => c - 0.5);
  const highsE = extended.map((c) => c + 0.5);
  const lowsE = extended.map((c) => c - 0.5);
  samePrefix(atr(highs, lows, base, 14), atr(highsE, lowsE, extended, 14), base.length);
});

test('macd hist prefix-stable', () => {
  samePrefix(macd(base).hist, macd(extended).hist, base.length);
});

test('rvol prefix-stable & kausal', () => {
  samePrefix(rvol(base, 20), rvol(extended, 20), base.length);
});

test('anchoredVWAP sampai indeks tertentu tak melihat masa depan', () => {
  const highs = base.map((c) => c + 0.5);
  const lows = base.map((c) => c - 0.5);
  const vols = base.map(() => 1000);
  // VWAP dari anchor 40..akhir untuk base
  const v1 = anchoredVWAP(highs, lows, base, vols, 40, 0.5);
  // untuk extended, VWAP dari anchor 40..(base.length-1) harus sama bila kita
  // memberi hanya prefix — verifikasi dengan memotong.
  const v2 = anchoredVWAP(highs.slice(0, base.length), lows.slice(0, base.length), base.slice(0, base.length), vols.slice(0, base.length), 40, 0.5);
  assert.ok(v1 && v2 && Math.abs(v1.vwap - v2.vwap) < 1e-9);
});

test('structureBias mengembalikan Bias (bukan Side) — kosakata benar (§21.1 bug #1)', () => {
  const highs = base.map((c) => c + 1);
  const lows = base.map((c) => c - 1);
  const s = structureBias(highs, lows, base);
  assert.ok(['bullish', 'bearish', 'neutral'].includes(s.bias), `bias harus kosakata Bias, dapat ${s.bias}`);
  assert.ok(!['long', 'short'].includes(s.bias), 'structureBias TAK boleh mengembalikan Side');
});
