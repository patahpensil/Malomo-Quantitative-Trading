// @ts-check
import { clamp01 } from '../core/types.js';

/**
 * Bangun Criterion dari nilai berarah dengan deadband & titik jenuh (§17.1).
 *
 * magnitude = clamp01((|raw| - edge) / (sat - edge))
 * dan magnitude WAJIB 0 bila side==='neutral'.
 *
 * Ini titik yang memperbaiki kelemahan inti Patah Pensill: melewati deadband
 * tidak langsung memberi magnitude penuh — besarannya proporsional.
 *
 * @param {Object} p
 * @param {string} p.id
 * @param {import('../core/types.js').Family} p.family
 * @param {number|null} p.raw     nilai mentah bertanda (mis. hist MACD, slope)
 * @param {number} p.edge         tepi deadband (dalam satuan |raw|)
 * @param {number} p.sat          titik jenuh
 * @param {import('../core/types.js').Provenance} [p.provenance]
 * @param {string} [p.unit]
 * @param {(v:number)=>import('../core/types.js').Side} [p.decideSide]
 * @returns {import('../core/types.js').Criterion}
 */
export function makeCriterion({ id, family, raw, edge, sat, provenance = 'terukur', unit = '', decideSide }) {
  if (raw == null || Number.isNaN(raw)) {
    return { id, family, side: 'neutral', magnitude: 0, provenance: 'tidak_tersedia', deadband: { lo: -edge, hi: edge, unit }, raw: null };
  }
  const abs = Math.abs(raw);
  /** @type {import('../core/types.js').Side} */
  let side;
  if (decideSide) side = decideSide(raw);
  else side = abs <= edge ? 'neutral' : raw > 0 ? 'long' : 'short';

  const magnitude = side === 'neutral' ? 0 : clamp01((abs - edge) / (sat - edge));
  return { id, family, side, magnitude, provenance, deadband: { lo: -edge, hi: edge, unit }, raw };
}

/**
 * Kriteria untuk nilai yang berpusat di titik referensi (mis. RSI di 50).
 * @param {Object} p
 * @param {string} p.id
 * @param {import('../core/types.js').Family} p.family
 * @param {number|null} p.value
 * @param {number} p.center
 * @param {number} p.edge   jarak dari center tempat magnitude mulai naik
 * @param {number} p.sat    jarak dari center tempat magnitude = 1
 * @param {string} [p.unit]
 * @returns {import('../core/types.js').Criterion}
 */
export function makeCenteredCriterion({ id, family, value, center, edge, sat, unit = '' }) {
  if (value == null || Number.isNaN(value)) {
    return { id, family, side: 'neutral', magnitude: 0, provenance: 'tidak_tersedia', deadband: { lo: center - edge, hi: center + edge, unit }, raw: null };
  }
  const dev = value - center;
  return makeCriterion({
    id, family, raw: dev, edge, sat, unit,
    decideSide: (v) => (Math.abs(v) <= edge ? 'neutral' : v > 0 ? 'long' : 'short'),
  });
}
