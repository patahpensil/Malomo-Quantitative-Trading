// @ts-check
/**
 * Helper render — DOM murni, tanpa framework. Menegakkan aturan tampilan §15.4:
 *  - tiga angka terpisah (arah/kekuatan/kekompakan)
 *  - keluarga yang melawan arah tampil dengan batang berlawanan (§UI-3)
 *  - keluarga tidak_tersedia tampil redup + alasan (§UI-4)
 *  - status & versi bobot selalu terlihat (§UI-6, §UI-7)
 */

import { FAMILY_LABEL } from '../core/types.js';

/** @param {string} tag @param {Object} [attrs] @param {(Node|string)[]} [kids] */
export function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = /** @type {string} */(v);
    else if (k === 'text') n.textContent = /** @type {string} */(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), /** @type {any} */(v));
    else n.setAttribute(k, /** @type {string} */(v));
  }
  for (const kid of kids) n.append(kid);
  return n;
}

/** @param {import('../core/types.js').Side} dir */
export function dirLabel(dir) {
  return dir === 'long' ? 'Long' : dir === 'short' ? 'Short' : 'Netral';
}

/**
 * Baris pair untuk daftar Pantau/Scan.
 * @param {Object} row
 * @param {string} row.symbol
 * @param {import('../scoring/pipeline.js').analyzeSymbol extends (a:any)=>infer R ? R : any} [row.a]
 * @param {import('../core/types.js').SignalStatus|'stale'} row.status
 * @param {string} row.desc
 * @param {number|null} row.value
 * @param {import('../core/types.js').Side} row.direction
 * @param {boolean} [row.stale]
 * @param {(sym:string)=>void} onTap
 */
export function pairRow(row, onTap) {
  const numVal = row.stale || row.value == null
    ? el('div', { class: 'v muted', text: '—' })
    : el('div', { class: 'v', text: String(row.value) });

  return el('div', { class: `pair-row${row.stale ? ' stale' : ''}`, onclick: () => onTap(row.symbol) }, [
    el('div', { class: 'body' }, [
      el('div', { class: 'sym' }, [
        el('span', { text: row.symbol.replace('USDT', '') }),
        el('span', { class: `dir ${row.direction}`, text: dirLabel(row.direction) }),
      ]),
      el('div', { class: 'desc', text: row.desc }),
    ]),
    el('div', { class: 'num' }, [
      numVal,
      el('span', { class: `pill ${row.status}`, text: statusLabel(row.status) }),
    ]),
  ]);
}

/** @param {string} s */
function statusLabel(s) {
  return { provisional: 'provisional', confirmed: 'confirmed', watching: 'watching', building: 'building', stale: 'basi' }[s] || s;
}

/**
 * Kartu detail skor lengkap (§15.4). Ini penerapan langsung mockup.
 * @param {Object} p
 * @param {string} p.symbol
 * @param {string} p.timeframe
 * @param {number} p.lastPrice
 * @param {import('../core/types.js').ScoreResult} p.score
 * @param {import('../core/types.js').SignalStatus} p.status
 * @param {number|null} p.msToClose  waktu sampai bar tutup
 * @param {{version:string, prior:boolean, oosPeriod:string|null}} p.calibration
 * @param {()=>void} [p.onTrace]
 */
export function scoreCard(p) {
  const s = p.score;
  const statusPill = el('span', { class: `pill ${p.status}`, text: statusLabel(p.status) });
  const closeInfo = p.msToClose != null
    ? el('div', { class: 'sub', text: `bar tutup ${fmtDuration(p.msToClose)}` })
    : el('div', { class: 'sub', text: '' });

  const triple = el('div', { class: 'triple' }, [
    cell('Arah', dirLabel(s.direction), s.direction),
    cell('Kekuatan', String(s.strength)),
    cell('Kekompakan', s.agreement == null ? '—' : String(s.agreement)),
  ]);

  const noteClass = /kompak tapi lemah|kuat tapi terisolasi/i.test(s.note) ? 'warn' : 'info';
  const note = el('div', { class: `note ${noteClass}`, text: s.note });

  const famRows = s.families.map(familyRow);

  const calText = p.calibration.prior
    ? `bobot ${p.calibration.version} · prior, belum tervalidasi`
    : `bobot ${p.calibration.version} · terukur${p.calibration.oosPeriod ? ` · OOS ${p.calibration.oosPeriod}` : ''}`;

  const foot = el('div', { class: 'foot' }, [
    el('span', { class: `cal${p.calibration.prior ? ' prior' : ''}`, text: calText }),
    el('button', { class: 'trace', text: 'Decision trace', onclick: () => p.onTrace && p.onTrace() }),
  ]);

  return el('div', { class: 'card' }, [
    el('div', { class: 'head' }, [
      el('div', {}, [
        el('div', { class: 'sym', text: p.symbol.replace('USDT', '/USDT') }),
        el('div', { class: 'sub', text: `Perp · ${p.timeframe} · ${p.lastPrice}` }),
      ]),
      el('div', { style: 'text-align:right' }, [statusPill, closeInfo]),
    ]),
    triple,
    note,
    el('div', { class: 'fam-title', text: 'Keluarga bukti' }),
    ...famRows,
    foot,
  ]);
}

/** @param {string} lbl @param {string} val @param {import('../core/types.js').Side} [dir] */
function cell(lbl, val, dir) {
  const valEl = el('div', { class: 'val', text: val });
  if (dir) valEl.classList.add(dir); // pewarnaan arah
  if (dir === 'long') valEl.style.color = 'var(--long)';
  if (dir === 'short') valEl.style.color = 'var(--short)';
  return el('div', { class: 'cell' }, [el('div', { class: 'lbl', text: lbl }), valEl]);
}

/**
 * Satu baris keluarga bukti. Batang berlawanan bila melawan arah (§UI-3);
 * baris redup + alasan bila tidak tersedia (§UI-4).
 * @param {import('../core/types.js').FamilyResult} f
 */
function familyRow(f) {
  const label = FAMILY_LABEL[f.family];
  if (f.provenance === 'tidak_tersedia') {
    return el('div', { class: 'fam-row' }, [
      el('span', { class: 'name muted', text: label }),
      el('span', { class: 'tag', text: 'tidak tersedia · bobot dinormalisasi' }),
      el('span', { class: 'val muted', text: '—' }),
    ]);
  }
  const pct = Math.round(Math.abs(f.value) * 100);
  const isLong = f.value > 0;
  const bar = el('span', { class: 'bar' }, [
    el('span', { class: `fill ${isLong ? 'long' : 'short'}`, style: `width:${pct / 2}%` }),
  ]);
  const sign = f.value > 0 ? '+' : f.value < 0 ? '−' : '';
  const tag = f.provenance === 'proxy' ? el('span', { class: 'tag', style: 'flex:0', text: ' proxy' }) : null;
  const kids = [el('span', { class: 'name', text: label }), bar, el('span', { class: 'val', text: `${sign}${pct}` })];
  if (tag) kids.splice(2, 0, tag);
  return el('div', { class: 'fam-row' }, kids);
}

/**
 * Rencana entry (§O-R1).
 * @param {{entry:number, sl:number, tp:number, rr:number}} plan
 */
export function planCard(plan) {
  return el('div', { class: 'plan' }, [
    planCell('Entry', plan.entry),
    planCell('Stop', plan.sl),
    planCell('Target', plan.tp),
    planCell('R:R', plan.rr),
  ]);
}
/** @param {string} l @param {number} v */
function planCell(l, v) {
  return el('div', { class: 'cell' }, [el('div', { class: 'lbl', text: l }), el('div', { class: 'v', text: String(v) })]);
}

/** @param {number} ms */
export function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}j ${m % 60}m`; }
  return m > 0 ? `${m}m ${s}d` : `${s}d`;
}

/** @param {string} big @param {string} [sm] */
export function emptyState(big, sm = '') {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'big', text: big }),
    sm ? el('div', { class: 'sm', text: sm }) : el('span', {}),
  ]);
}

export function skeletonList(n = 6) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) frag.append(el('div', { class: 'skeleton' }));
  return frag;
}
