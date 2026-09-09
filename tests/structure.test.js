// @ts-check
/**
 * Uji structureBias: pembeda "belum bisa diukur" vs "diukur dan netral" (§CD-6).
 * Tanpa ini, families.js tak bisa membedakan bar-kurang dari struktur netral asli.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureBias } from '../src/indicators/structure.js';

test('structureBias: data terlalu sedikit untuk 2 swing → measured=false', () => {
  const highs = [10, 11, 10.5];
  const lows = [9, 9.5, 9.2];
  const closes = [9.5, 10.5, 9.8];
  const s = structureBias(highs, lows, closes);
  assert.equal(s.measured, false, 'belum ada 2 swing terkonfirmasi → tak bisa diukur');
  assert.equal(s.bias, 'neutral');
});

test('structureBias: cukup swing (deret berosilasi panjang) → measured=true', () => {
  // Gelombang sinus banyak siklus → banyak swing high/low terkonfirmasi,
  // terlepas dari bias akhirnya bullish/bearish/netral.
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2) * 5);
  const highs = closes.map((c) => c + 0.5);
  const lows = closes.map((c) => c - 0.5);
  const s = structureBias(highs, lows, closes);
  assert.equal(s.measured, true, 'swing cukup → sudah bisa diukur, terlepas dari hasilnya');
});
