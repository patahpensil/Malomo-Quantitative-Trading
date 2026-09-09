// @ts-check
/**
 * Pemuat kalibrasi & gate kewajaran.
 *  A-1 Bidang Live TIDAK menghitung bobot sendiri — baca calibration.json.
 *  A-2 tetap jalan bila artefak belum ada → prior berlabel.
 *  A-4 artefak membawa model_version, periode OOS, hasil gate.
 *  O-R9 hit rate>75% atau Sharpe>3 → peringatan wajib, blokir promosi.
 */

import { PRIOR_WEIGHTS, PRIOR_VERSION } from '../core/config.js';

/**
 * @typedef {Object} Calibration
 * @property {string} model_version
 * @property {string} status        'prior' | 'terukur'
 * @property {string|null} oosPeriod
 * @property {Record<string,number>} weights
 * @property {number} measuredFamilies  berapa keluarga sudah terukur
 * @property {Object|null} gate
 */

/** @returns {Calibration} kalibrasi prior bawaan (§A-2). */
export function priorCalibration() {
  return {
    model_version: PRIOR_VERSION,
    status: 'prior',
    oosPeriod: null,
    weights: { ...PRIOR_WEIGHTS },
    measuredFamilies: 0,
    gate: null,
  };
}

/**
 * Muat calibration.json dari repo; jatuh ke prior bila gagal (§A-2, §G-R6).
 * @param {string} url
 * @returns {Promise<Calibration>}
 */
export async function loadCalibration(url = './data/calibration.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // validasi minimal
    if (!data.model_version || !data.weights) throw new Error('artefak tidak valid');
    return {
      model_version: data.model_version,
      status: data.status || 'terukur',
      oosPeriod: data.oosPeriod || null,
      weights: { ...PRIOR_WEIGHTS, ...data.weights },
      measuredFamilies: data.measuredFamilies || 0,
      gate: data.gate || null,
    };
  } catch {
    return priorCalibration();
  }
}

/**
 * Gate kewajaran (§O-R9). Mengembalikan peringatan bila terpicu.
 * @param {{winRate:number, sharpe:number, n:number}} stats
 * @returns {{triggered:boolean, reasons:string[]}}
 */
export function sanityGate({ winRate, sharpe, n }) {
  const reasons = [];
  if (n >= 30 && winRate > 0.75) {
    reasons.push(`Hit rate ${(winRate * 100).toFixed(0)}% di atas 75% — periksa lookahead, survivorship, atau biaya yang belum dimodelkan.`);
  }
  if (n >= 30 && sharpe > 3) {
    reasons.push(`Sharpe ${sharpe.toFixed(1)} di atas 3 — hampir selalu tanda overfitting pada data retail.`);
  }
  return { triggered: reasons.length > 0, reasons };
}
