// @ts-check
/**
 * Uji mesin skor — properti yang menjadi ALASAN sistem ini dibangun ulang.
 * Bila salah satu gagal, aplikasi mewarisi cacat Patah Pensill.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, aggregateFamily } from '../src/scoring/engine.js';
import { makeCriterion } from '../src/scoring/criterion.js';
import { THRESHOLDS } from '../src/core/config.js';

/**
 * Bantu: bikin kriteria long/short dengan magnitude tertentu.
 * @param {import('../src/core/types.js').Family} fam
 * @param {import('../src/core/types.js').Side} side
 * @param {number} mag
 */
function crit(fam, side, mag) {
  return { id: `${fam}.x`, family: fam, side, magnitude: mag, provenance: /** @type {const} */('terukur'), deadband: { lo: -1, hi: 1, unit: '' }, raw: side === 'short' ? -mag : mag };
}

test('non-sirkularitas: kekuatan independen dari kekompakan (§P-1)', () => {
  // Kasus A: semua keluarga searah TAPI lemah (mag kecil) → kompak, kekuatan rendah
  const kompakLemah = computeScore({
    E1: [crit('E1', 'long', 0.1)], E2: [crit('E2', 'long', 0.1)],
    E3: [crit('E3', 'long', 0.1)], E4: [crit('E4', 'long', 0.1)],
  });
  // Kasus B: satu keluarga sangat kuat, sisanya berlawanan → tidak kompak, kekuatan bisa serupa/кecil
  const kuatTerpecah = computeScore({
    E1: [crit('E1', 'long', 1.0)], E2: [crit('E2', 'short', 0.6)],
    E3: [crit('E3', 'short', 0.6)], E4: [crit('E4', 'short', 0.6)],
  });

  // Kompak-lemah: agreement tinggi, strength rendah — kombinasi yang di Patah
  // Pensill MUSTAHIL karena skornya sirkular.
  assert.equal(kompakLemah.direction, 'long');
  assert.ok(kompakLemah.agreement >= 99, `agreement harus ~100, dapat ${kompakLemah.agreement}`);
  assert.ok(kompakLemah.strength <= 12, `strength harus rendah, dapat ${kompakLemah.strength}`);

  // Bukti bahwa agreement dan strength adalah dua sumbu berbeda:
  assert.notEqual(kompakLemah.agreement, kompakLemah.strength);
  // kuatTerpecah harus punya agreement jauh lebih rendah daripada kompakLemah
  assert.ok(kuatTerpecah.agreement < kompakLemah.agreement);
});

test('normalisasi: keluarga tidak_tersedia keluar tanpa mengubah skala (§S-R6)', () => {
  const full = computeScore({
    E1: [crit('E1', 'long', 0.8)], E2: [crit('E2', 'long', 0.8)],
    E3: [crit('E3', 'long', 0.8)], E4: [crit('E4', 'long', 0.8)],
  });
  // Tambah satu keluarga yang tidak tersedia — TIDAK boleh menurunkan strength
  const withNA = computeScore({
    E1: [crit('E1', 'long', 0.8)], E2: [crit('E2', 'long', 0.8)],
    E3: [crit('E3', 'long', 0.8)], E4: [crit('E4', 'long', 0.8)],
    E5: [makeCriterion({ id: 'E5.na', family: 'E5', raw: null, edge: 0.1, sat: 1 })],
  });
  assert.equal(withNA.availableCount, 4, 'keluarga NA tak dihitung sebagai tersedia');
  assert.equal(full.strength, withNA.strength, 'strength tak berubah oleh keluarga NA');
  assert.equal(full.raw.toFixed(6), withNA.raw.toFixed(6));
});

test('gate keluarga minimum: < minFamilies → netral tanpa menebak (§S-R7)', () => {
  const crits = {};
  for (let i = 0; i < THRESHOLDS.minFamilies - 1; i++) {
    const fam = /** @type {any} */(`E${i + 1}`);
    crits[fam] = [crit(fam, 'long', 0.9)];
  }
  const r = computeScore(crits);
  assert.equal(r.direction, 'neutral');
  assert.equal(r.strength, 0);
  assert.ok(/belum cukup/i.test(r.note));
});

test('agreement dihitung dari TANDA, bukan besaran (§17.3)', () => {
  // Dua keluarga long besar + dua long kecil → semua searah → agreement 100
  const r = computeScore({
    E1: [crit('E1', 'long', 0.9)], E2: [crit('E2', 'long', 0.05)],
    E3: [crit('E3', 'long', 0.9)], E4: [crit('E4', 'long', 0.05)],
  });
  assert.equal(r.agreement, 100, 'tanda sama semua → 100 walau besaran beda jauh');
});

test('modulator rezim tak pernah membalik arah (§S-R5, §17.5)', () => {
  const base = { E1: [crit('E1', 'long', 0.6)], E2: [crit('E2', 'long', 0.6)], E3: [crit('E3', 'long', 0.6)], E4: [crit('E4', 'long', 0.6)] };
  // modulator ekstrem (di luar batas) tak boleh membuat arah jadi short
  const r = computeScore(base, { regimeMod: { E1: 999, E2: 0, E3: 0, E4: 0 } });
  assert.equal(r.direction, 'long', 'rezim hanya menimbang, tak membalik');
});

test('agregasi keluarga = rata-rata, bukan jumlah (§17.2)', () => {
  // Dua kriteria long 0.5 → rata-rata 0.5, bukan 1.0
  const f = aggregateFamily('E3', [crit('E3', 'long', 0.5), crit('E3', 'long', 0.5)]);
  assert.equal(f.value, 0.5);
});

test('agreement null bila saksi non-nol < minFamilies — satu saksi tak pernah 100 (§CD-6)', () => {
  // 4 keluarga tersedia (availableCount memenuhi gate), tapi 3 di antaranya
  // memang terukur netral (magnitude 0) — hanya 1 yang benar-benar berarah.
  // Sebelum diperbaiki, kasus ini terbaca sebagai agreement=100 ("kompak").
  const r = computeScore({
    E1: [crit('E1', 'long', 1.0)],
    E2: [crit('E2', 'neutral', 0)],
    E3: [crit('E3', 'neutral', 0)],
    E4: [crit('E4', 'neutral', 0)],
  });
  assert.equal(r.availableCount, 4);
  assert.equal(r.agreement, null, 'satu saksi berarah tak boleh dilaporkan sebagai 100% kompak');
});

test('agreement tetap terlapor normal begitu saksi non-nol capai minFamilies', () => {
  const r = computeScore({
    E1: [crit('E1', 'long', 0.5)], E2: [crit('E2', 'long', 0.5)],
    E3: [crit('E3', 'long', 0.5)], E4: [crit('E4', 'long', 0.5)],
  });
  assert.equal(r.agreement, 100);
});

test('provenance keluarga jadi proxy bila ada satu kriteria proxy', () => {
  const proxyCrit = { id: 'E7.p', family: /** @type {const} */('E7'), side: /** @type {const} */('long'), magnitude: 0.5, provenance: /** @type {const} */('proxy'), deadband: { lo: -1, hi: 1, unit: '' }, raw: 0.5 };
  const f = aggregateFamily('E7', [crit('E7', 'long', 0.5), proxyCrit]);
  assert.equal(f.provenance, 'proxy');
});
