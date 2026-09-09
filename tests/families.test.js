// @ts-check
/**
 * Uji families.js: E1 (struktur) & E3 (adx.di) wajib membedakan "tak bisa
 * diukur" dari "diukur dan hasilnya nol" (§CD-6). Sebelum diperbaiki, kedua
 * kriteria ini selalu memakai raw=0 sebagai fallback bila data kurang — nilai
 * itu lolos sebagai 'terukur', mencemari rata-rata keluarga & menaikkan
 * availableCount secara palsu.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceFamilies } from '../src/scoring/families.js';

function findCriterion(fams, family, id) {
  return fams[family].find((c) => c.id === id);
}

test('E1 struktur.bias: candle terlalu sedikit → tidak_tersedia, bukan raw 0', () => {
  const n = 10; // jauh di bawah kebutuhan 2 swing terkonfirmasi & warmup E3/E4
  const close = Array.from({ length: n }, (_, i) => 100 + i * 0.1);
  const high = close.map((c) => c + 0.2);
  const low = close.map((c) => c - 0.2);
  const volume = new Array(n).fill(1000);
  const fams = buildPriceFamilies({ open: close, high, low, close, volume, openTime: close.map((_, i) => i) });
  const c1 = findCriterion(fams, 'E1', 'struktur.bias');
  assert.equal(c1.provenance, 'tidak_tersedia', 'swing belum terkonfirmasi → tak bisa diukur');
  assert.equal(c1.raw, null);
});

test('E1 struktur.bias: data cukup panjang & bias netral asli → terukur, raw 0', () => {
  const closeBase = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2) * 5);
  const high = closeBase.map((c) => c + 0.5);
  const low = closeBase.map((c) => c - 0.5);
  const volume = new Array(60).fill(1000);
  const fams = buildPriceFamilies({ open: closeBase, high, low, close: closeBase, volume, openTime: closeBase.map((_, i) => i) });
  const c1 = findCriterion(fams, 'E1', 'struktur.bias');
  // Data cukup untuk 2 swing → tidak boleh tidak_tersedia lagi, apa pun bias-nya.
  assert.notEqual(c1.provenance, 'tidak_tersedia', 'swing cukup terkonfirmasi → seharusnya terukur');
});

test('E3 adx.di: ADX belum terdefinisi (bar < 2×period) → tidak_tersedia, bukan raw 0', () => {
  const n = 20; // < 2*14 dibutuhkan adx()
  const close = Array.from({ length: n }, (_, i) => 100 + i * 0.1);
  const high = close.map((c) => c + 0.2);
  const low = close.map((c) => c - 0.2);
  const volume = new Array(n).fill(1000);
  const fams = buildPriceFamilies({ open: close, high, low, close, volume, openTime: close.map((_, i) => i) });
  const adxDi = findCriterion(fams, 'E3', 'adx.di');
  assert.equal(adxDi.provenance, 'tidak_tersedia', 'ADX belum terdefinisi → tak bisa diukur');
  assert.equal(adxDi.raw, null);
});

test('E3 adx.di: ADX terdefinisi tapi lemah/dataran → terukur, raw 0 (bukan tidak_tersedia)', () => {
  // Harga flat murni → ADX/DI terdefinisi (bar cukup) tapi tak ada arah dominan.
  const n = 60;
  const close = new Array(n).fill(100);
  const high = new Array(n).fill(100.1);
  const low = new Array(n).fill(99.9);
  const volume = new Array(n).fill(1000);
  const fams = buildPriceFamilies({ open: close, high, low, close, volume, openTime: close.map((_, i) => i) });
  const adxDi = findCriterion(fams, 'E3', 'adx.di');
  assert.equal(adxDi.provenance, 'terukur', 'ADX terdefinisi walau lemah → tetap hasil terukur, bukan data hilang');
});
