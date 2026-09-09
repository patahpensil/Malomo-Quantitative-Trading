// @ts-check
/**
 * Uji label keluarga tidak tersedia (§UI-4). E6 (order flow) wajib berlabel
 * "belum aktif" — bukan "tidak tersedia" generik yang terbaca seolah data
 * cuma tertunda sesaat — karena CVDTracker/orderBookImbalance memang belum
 * pernah disambungkan (tidak ada WSManager yang berjalan).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unavailableTag } from '../src/ui/render.js';

test('unavailableTag: E6 berlabel "belum aktif", bukan "tidak tersedia" generik', () => {
  assert.match(unavailableTag('E6'), /belum aktif/i);
});

test('unavailableTag: keluarga lain tetap pakai label generik "tidak tersedia"', () => {
  for (const fam of ['E1', 'E2', 'E3', 'E4', 'E5', 'E7', 'E8']) {
    assert.match(unavailableTag(/** @type {any} */(fam)), /tidak tersedia/i);
  }
});
