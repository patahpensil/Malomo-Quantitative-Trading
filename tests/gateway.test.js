// @ts-check
/**
 * Uji gerbang jaringan (§NET-2, §NET-4) & regresi untuk bn.fundingRate /
 * bn.oiChange / bn.longShortRatio: sebelum diperbaiki, ketiganya dipanggil di
 * market.js TANPA opts.tierA, sehingga begitu kuota lewat 70%/90% ketiganya
 * gagal SERENTAK di seluruh universe — termasuk Tier A yang seharusnya
 * dilindungi. Mock fetch dipakai karena ini murni soal logika gerbang, bukan
 * jawaban Binance yang sebenarnya.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJSON, quotaState } from '../src/net/gateway.js';
import * as bn from '../src/net/binance.js';

/** @param {any} json @param {number} usedWeight */
function mockRes(json, usedWeight) {
  return {
    ok: true,
    status: 200,
    headers: { get: (/** @type {string} */ h) => (h === 'X-MBX-USED-WEIGHT-1M' ? String(usedWeight) : null) },
    json: async () => json,
  };
}

test('gateway: kuota >90% menolak permintaan non-tierA, meloloskan tierA:true', async () => {
  globalThis.fetch = /** @type {any} */(async () => mockRes({ ok: 1 }, 2200)); // 2200/2400 ≈ 91.7%
  await getJSON('https://fapi.binance.com/warmup');
  assert.equal(quotaState(), 'tierA-only');

  await assert.rejects(() => getJSON('https://fapi.binance.com/x1'), /kuota/i);
  const ok = await getJSON('https://fapi.binance.com/x2', { tierA: true });
  assert.deepEqual(ok, { ok: 1 });
});

test('regresi §NET-2: fundingRate/oiChange/longShortRatio ikut lolos hanya bila tierA:true diteruskan', async () => {
  globalThis.fetch = /** @type {any} */(async (/** @type {any} */ url) => {
    const u = String(url);
    if (u.includes('premiumIndex')) return mockRes({ lastFundingRate: '0.0001' }, 2200);
    if (u.includes('openInterestHist')) return mockRes([{ sumOpenInterest: '100' }, { sumOpenInterest: '110' }], 2200);
    if (u.includes('globalLongShortAccountRatio')) return mockRes([{ longShortRatio: '1.2' }], 2200);
    return mockRes({}, 2200);
  });
  assert.equal(quotaState(), 'tierA-only', 'lanjutan state kuota tinggi dari tes sebelumnya');

  // Tanpa tierA (perilaku LAMA yang diperbaiki): gerbang menolak, ditangkap
  // try/catch internal binance.js → diam-diam null.
  assert.equal(await bn.fundingRate('BTCUSDT'), null);
  assert.equal(await bn.oiChange('BTCUSDT'), null);
  assert.equal(await bn.longShortRatio('BTCUSDT'), null);

  // Dengan tierA: WAJIB tetap dapat data — inilah perbaikannya.
  assert.equal(await bn.fundingRate('BTCUSDT', { tierA: true }), 0.0001);
  assert.equal(await bn.oiChange('BTCUSDT', undefined, { tierA: true }), (110 - 100) / 100);
  assert.equal(await bn.longShortRatio('BTCUSDT', undefined, { tierA: true }), 1.2);
});
