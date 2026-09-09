// @ts-check
/**
 * Tipe bersama & konstanta domain.
 *
 * Kontrak PRD yang ditegakkan di sini:
 *  - §21.1 bug #1: `Bias` ('bullish'/'bearish'/'neutral') dan `Side`
 *    ('long'/'short'/'neutral') adalah dua kosakata BERBEDA. Perbandingan
 *    langsung antar keduanya dilarang. Konversi HANYA lewat biasToSide().
 *    Ini persis kesalahan Patah Pensill: kategori Multi-Timeframe berbobot 15
 *    selalu bernilai 0 karena membandingkan 'bullish' === 'long'.
 *  - §21.1 bug #4: nilai bersatuan dibungkus penanda tipe (Pct/Ratio/Bps)
 *    lewat konvensi JSDoc supaya tidak tercampur.
 */

/** @typedef {'long'|'short'|'neutral'} Side */
/** @typedef {'bullish'|'bearish'|'neutral'} Bias */
/** @typedef {'terukur'|'proxy'|'tidak_tersedia'} Provenance */
/** @typedef {'closed'|'live'} BarBasis */
/** @typedef {'watching'|'building'|'confirmed'} SignalStatus */

/** Nama keluarga bukti berarah. Sengaja awalan E (evidence), bukan F. */
export const FAMILIES = /** @type {const} */ (['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
/** @typedef {(typeof FAMILIES)[number]} Family */

export const FAMILY_LABEL = /** @type {Record<Family,string>} */ ({
  E1: 'Struktur',
  E2: 'Level',
  E3: 'Momentum',
  E4: 'Volume',
  E5: 'Derivatif',
  E6: 'Order flow',
  E7: 'Sentimen posisi',
  E8: 'Multi-timeframe',
});

/**
 * Satu-satunya jembatan sah antara Bias dan Side. Semua konversi lewat sini.
 * @param {Bias} bias
 * @returns {Side}
 */
export function biasToSide(bias) {
  if (bias === 'bullish') return 'long';
  if (bias === 'bearish') return 'short';
  return 'neutral';
}

/**
 * @param {Side} side
 * @returns {1|-1|0} tanda arah untuk perhitungan berarah
 */
export function sideSign(side) {
  if (side === 'long') return 1;
  if (side === 'short') return -1;
  return 0;
}

/**
 * Objek kriteria — kontrak §17.1. Bentuk ini sama untuk semua kriteria.
 * @typedef {Object} Criterion
 * @property {string} id
 * @property {Family} family
 * @property {Side} side
 * @property {number} magnitude   0..1, WAJIB 0 bila side==='neutral'
 * @property {Provenance} provenance
 * @property {{lo:number,hi:number,unit:string}} deadband
 * @property {number|null} raw
 */

/**
 * Hasil satu keluarga setelah agregasi §17.2.
 * @typedef {Object} FamilyResult
 * @property {Family} family
 * @property {number} value        -1..+1
 * @property {Provenance} provenance
 * @property {Criterion[]} criteria
 */

/**
 * Keluaran mesin skor — kontrak §17.3.
 * @typedef {Object} ScoreResult
 * @property {Side} direction
 * @property {number} strength     0..100
 * @property {number} agreement    0..100
 * @property {number} raw          -1..+1 (S sebelum dipetakan)
 * @property {FamilyResult[]} families
 * @property {number} availableCount
 * @property {string} note         kalimat penjelas untuk UI (§UI-2)
 */

/** Timeframe yang dikenal, dari kecil ke besar. */
export const TIMEFRAMES = /** @type {const} */ (['5m', '15m', '30m', '1h', '4h', '1d']);
/** @typedef {(typeof TIMEFRAMES)[number]} Timeframe */

/** Milidetik per timeframe — untuk deteksi basi (§WS-5) & barrier waktu. */
export const TF_MS = /** @type {Record<Timeframe,number>} */ ({
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
});

/**
 * clamp ke [0,1].
 * @param {number} x
 */
export function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * clamp umum.
 * @param {number} x @param {number} lo @param {number} hi
 */
export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}
