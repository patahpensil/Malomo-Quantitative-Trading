// @ts-check
/**
 * Tab Bukti (§20). Tempat pertanyaan "apakah sistem ini berguna" dijawab.
 *  BK-1 sebelum 30 sinyal: tampilkan jumlah, JANGAN persentase.
 *  BK-2 ekspektasi + baseline berdampingan.
 *  BK-7 gate menyala → spanduk merah tak bisa ditutup permanen.
 *  BK-8 tak pernah tampilkan angka membanggakan tanpa jumlah sampel.
 */

import { el } from './render.js';
import { allBarriers } from '../store/db.js';
import { expectancy, sharpe } from '../store/barrier.js';
import { sanityGate } from '../scoring/calibration.js';
import { THRESHOLDS } from '../core/config.js';

/**
 * @param {HTMLElement} root
 * @param {{version:string, prior:boolean, measuredFamilies:number, oosPeriod:string|null}} cal
 */
export async function renderEvidence(root, cal) {
  root.innerHTML = '';
  root.append(el('div', { class: 'view-head' }, [
    el('h2', { text: 'Bukti' }),
    el('span', { class: 'meta', text: `model ${cal.version}` }),
  ]));

  const barriers = await allBarriers();
  const resolved = barriers.filter((b) => b.outcome && b.outcome !== 'pending');

  // §BK-1: di bawah ambang → jumlah saja, tanpa persentase/grafik
  if (resolved.length < THRESHOLDS.minSignalsForStats) {
    root.append(el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: `${resolved.length} dari ${THRESHOLDS.minSignalsForStats} sinyal terevaluasi` }),
      el('div', { class: 'sm', text: 'Statistik ditampilkan setelah cukup sampel terkumpul. Menampilkan angka lebih awal hanya akan menyesatkan.' }),
    ]));
    renderCalibrationStatus(root, cal);
    return;
  }

  const real = expectancy(resolved.map((b) => ({ outcome: b.outcome, netR: b.netR })));
  const realSharpe = sharpe(resolved.map((b) => b.netR));

  // Baseline acak berdampingan (§BK-3) — dibaca dari field baseline tersimpan
  const baseResults = resolved.filter((b) => typeof b.baselineNetR === 'number').map((b) => ({ outcome: b.baselineNetR > 0 ? 'win' : 'loss', netR: b.baselineNetR }));
  const base = expectancy(baseResults);

  // §BK-7 gate
  const gate = sanityGate({ winRate: real.winRate, sharpe: realSharpe, n: real.n });
  if (gate.triggered) {
    root.append(el('div', { class: 'banner-gate' }, [
      el('div', { class: 't', text: 'Gate kewajaran menyala' }),
      ...gate.reasons.map((r) => el('div', { text: r })),
    ]));
  }

  // Kartu statistik dengan sampel selalu terlihat (§BK-8)
  const grid = el('div', { class: 'stat-grid' }, [
    statCard('Ekspektasi / trade', `${real.expectancyR >= 0 ? '+' : ''}${real.expectancyR.toFixed(2)}R`, `n=${real.n} · acak ${base.n ? base.expectancyR.toFixed(2) + 'R' : '—'}`),
    statCard('Win rate', `${(real.winRate * 100).toFixed(0)}%`, `acak ${base.n ? (base.winRate * 100).toFixed(0) + '%' : '—'}`),
    statCard('Profit factor', real.profitFactor === Infinity ? '∞' : real.profitFactor.toFixed(2), `n=${real.n}`),
    statCard('Sharpe (per-trade)', realSharpe.toFixed(2), 'diukur setelah biaya'),
  ]);
  root.append(grid);

  root.append(el('div', { class: 'note info', text: `Interval kepercayaan 95% ekspektasi: ${real.ci95[0].toFixed(2)}R … ${real.ci95[1].toFixed(2)}R` }));

  renderCalibrationStatus(root, cal);
}

/**
 * @param {HTMLElement} root
 * @param {{version:string, prior:boolean, measuredFamilies:number, oosPeriod:string|null}} cal
 */
function renderCalibrationStatus(root, cal) {
  root.append(el('div', { class: 'fam-title', text: 'Status kalibrasi', style: 'margin-top:16px' }));
  root.append(el('div', { class: 'note info' }, [
    el('div', { text: `Versi model: ${cal.version} (${cal.prior ? 'prior — belum tervalidasi' : 'terukur'})` }),
    el('div', { text: `Keluarga terukur: ${cal.measuredFamilies} dari 8` }),
    el('div', { text: cal.oosPeriod ? `Periode OOS: ${cal.oosPeriod}` : 'Belum ada periode OOS — bobot masih prior.' }),
  ]));
}

/** @param {string} lbl @param {string} v @param {string} base */
function statCard(lbl, v, base) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'lbl', text: lbl }),
    el('div', { class: 'v', text: v }),
    el('div', { class: 'base', text: base }),
  ]);
}
