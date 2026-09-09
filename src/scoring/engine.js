// @ts-check
/**
 * MESIN SKOR — inti sistem. Implementasi §17.2-§17.4 secara harfiah.
 *
 * ATURAN BERDIRI (§CD-6): berkas ini tidak diubah tanpa persetujuan eksplisit.
 * §CD-5: tidak mengimpor UI/jaringan. Node & browser mengeksekusi berkas sama.
 *
 * Yang dijamin oleh mesin ini (dan diuji di scoring.test.js):
 *  - strength independen dari agreement (§P-1). Kompak-tapi-lemah ≠ kuat.
 *  - keluarga tidak_tersedia keluar dari perhitungan, bobot dinormalisasi ulang
 *    tanpa mengubah skala (§S-R6).
 *  - < minFamilies keluarga terukur → direction 'none' (§S-R7).
 *  - rezim hanya mengali bobot dalam [min,max], tak pernah membalik arah (§S-R5).
 */

import { FAMILIES, sideSign, clamp } from '../core/types.js';
import { THRESHOLDS, PRIOR_WEIGHTS, REGIME_MODULATOR } from '../core/config.js';

/**
 * Agregasi satu keluarga: rata-rata skor berarah kriteria tersedia (§17.2).
 * Rata-rata, BUKAN jumlah — supaya keluarga dgn lebih banyak kriteria tak
 * otomatis lebih berpengaruh.
 * @param {import('../core/types.js').Family} family
 * @param {import('../core/types.js').Criterion[]} criteria
 * @returns {import('../core/types.js').FamilyResult}
 */
export function aggregateFamily(family, criteria) {
  const usable = criteria.filter((c) => c.provenance !== 'tidak_tersedia');
  if (usable.length === 0) {
    return { family, value: 0, provenance: 'tidak_tersedia', criteria };
  }
  let sum = 0;
  for (const c of usable) sum += c.magnitude * sideSign(c.side);
  const value = sum / usable.length; // -1..+1
  // provenance keluarga: proxy bila ada satu saja proxy, selain itu terukur
  const anyProxy = usable.some((c) => c.provenance === 'proxy');
  return { family, value, provenance: anyProxy ? 'proxy' : 'terukur', criteria };
}

/**
 * Hitung skor akhir dari peta keluarga → daftar kriteria.
 * @param {Partial<Record<import('../core/types.js').Family, import('../core/types.js').Criterion[]>>} byFamily
 * @param {Object} [opts]
 * @param {Partial<Record<import('../core/types.js').Family, number>>} [opts.weights] bobot (default prior)
 * @param {Partial<Record<import('../core/types.js').Family, number>>} [opts.regimeMod] modulator rezim per keluarga
 * @returns {import('../core/types.js').ScoreResult}
 */
export function computeScore(byFamily, opts = {}) {
  const weights = opts.weights || PRIOR_WEIGHTS;
  const regimeMod = opts.regimeMod || {};

  /** @type {import('../core/types.js').FamilyResult[]} */
  const families = [];
  for (const fam of FAMILIES) {
    const crits = byFamily[fam] || [];
    families.push(aggregateFamily(fam, crits));
  }

  const available = families.filter((f) => f.provenance !== 'tidak_tersedia');

  // §S-R7: terlalu sedikit keluarga → jangan menebak
  if (available.length < THRESHOLDS.minFamilies) {
    return {
      // 'none' PRD dipetakan ke 'neutral' pada tipe Side
      direction: 'neutral',
      strength: 0,
      agreement: 0,
      raw: 0,
      families,
      availableCount: available.length,
      note: `Baru ${available.length} dari ${THRESHOLDS.minFamilies} keluarga terukur — belum cukup untuk sinyal.`,
    };
  }

  // Bobot efektif = bobot × modulator rezim (dibatasi §17.5)
  let sumEff = 0;
  /** @type {Map<import('../core/types.js').Family, number>} */
  const eff = new Map();
  for (const f of available) {
    const base = weights[f.family] ?? 1;
    const mod = clamp(regimeMod[f.family] ?? 1, REGIME_MODULATOR.min, REGIME_MODULATOR.max);
    const e = base * mod;
    eff.set(f.family, e);
    sumEff += e;
  }

  // S = Σ (value × bobot ternormalisasi)
  let S = 0;
  for (const f of available) {
    const w = /** @type {number} */(eff.get(f.family)) / sumEff;
    S += f.value * w;
  }

  const direction = S > THRESHOLDS.directionDelta ? 'long' : S < -THRESHOLDS.directionDelta ? 'short' : 'neutral';
  const strength = Math.round(Math.abs(S) * 100);

  // agreement dari TANDA, bukan besaran (§17.3) — inilah yang membuatnya
  // independen dari strength.
  let wSame = 0, wNonZero = 0;
  for (const f of available) {
    const s = Math.sign(f.value);
    if (s === 0) continue;
    const w = /** @type {number} */(eff.get(f.family)) / sumEff;
    wNonZero += w;
    const dirSign = direction === 'long' ? 1 : direction === 'short' ? -1 : 0;
    if (s === dirSign) wSame += w;
  }
  const agreement = wNonZero === 0 ? 0 : Math.round((wSame / wNonZero) * 100);

  return {
    direction,
    strength,
    agreement,
    raw: S,
    families,
    availableCount: available.length,
    note: buildNote(direction, strength, agreement),
  };
}

/**
 * Kalimat penjelas untuk UI (§UI-2) — menyoroti kombinasi yang mudah salah baca.
 * @param {import('../core/types.js').Side} direction
 * @param {number} strength @param {number} agreement
 */
function buildNote(direction, strength, agreement) {
  if (direction === 'neutral') return 'Bukti berpencar — tidak ada arah yang menonjol.';
  if (agreement >= 75 && strength < 35) {
    return 'Kompak tapi lemah — semua keluarga searah, tapi tipis di atas deadband.';
  }
  if (agreement < 45 && strength >= 55) {
    return 'Kuat tapi terisolasi — sedikit keluarga membawa hampir seluruh bobot.';
  }
  if (agreement >= 70 && strength >= 55) {
    return 'Bukti kuat dan kompak.';
  }
  return 'Bukti moderat.';
}
