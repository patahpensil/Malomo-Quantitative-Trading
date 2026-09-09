// @ts-check
/**
 * Controller aplikasi (Bidang Live). Merangkai enam tab (§15.3) & siklus hidup.
 * Tanpa framework — DOM langsung, sesuai semangat push-langsung-live Patah Pensill.
 */

import { el, pairRow, scoreCard, planCard, emptyState, skeletonList, fmtDuration, dirLabel } from './render.js';
import * as market from './market.js';
import { renderNews } from './news.js';
import { renderEvidence } from './evidence.js';
import { loadCalibration } from '../scoring/calibration.js';
import { openDB, requestPersist, putSignal, putBarrier, allSignals, allBarriers, needsExportReminder, exportAll, importAll } from '../store/db.js';
import { buildPlan } from '../store/barrier.js';
import { onQuotaChange } from '../net/gateway.js';
import { roundToTick } from '../net/binance.js';
import { UNIVERSE, THRESHOLDS } from '../core/config.js';
import { TF_MS as TFMS } from '../core/types.js';

const state = {
  tab: 'pantau',
  timeframe: /** @type {import('../core/types.js').Timeframe} */ ('15m'),
  contextTf: /** @type {import('../core/types.js').Timeframe} */ ('1h'),
  /** @type {any[]} */ tierA: [],
  /** @type {any[]} */ scanResults: [],
  /** @type {any} */ calibration: null,
  /** @type {any} */ selected: null,
  universeLoaded: false,
  /** @type {string[]|undefined} */ tierAList: undefined,
};

/** @type {Record<string, HTMLElement>} */
const views = {};
/** @type {HTMLElement} */
let netbar;

export async function boot() {
  // DOM refs
  netbar = document.getElementById('netbar');
  for (const t of ['pantau', 'scan', 'analisa', 'berita', 'jurnal', 'bukti']) {
    views[t] = document.getElementById(`view-${t}`);
  }
  wireTabs();
  wireQuota();

  // Penyimpanan (§19)
  try {
    await openDB();
    await requestPersist();
    maybeExportReminder();
  } catch (e) {
    showNet('err', 'Penyimpanan lokal tidak tersedia. Data tidak akan tersimpan.');
  }

  // Kalibrasi (§A-2 fallback prior)
  state.calibration = await loadCalibration();

  // Pandu pemasangan iOS (§DB-1)
  maybePromptInstall();

  // Muat Tier A
  await initTierA();
  render();

  // Selesaikan barrier lama yang tertunda (mengisi tab Bukti)
  resolvePendingBarriers();

  // Refresh berkala Tier A
  setInterval(() => { if (state.tab === 'pantau') refreshTierA(); }, 60_000);
  // Evaluasi barrier pending berkala (lebih jarang — hemat kuota)
  setInterval(() => { resolvePendingBarriers(); }, 3 * 60_000);
}

function wireTabs() {
  document.querySelectorAll('.tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = /** @type {HTMLElement} */(btn).dataset.tab || 'pantau';
      render();
    });
  });
}

function wireQuota() {
  onQuotaChange(({ quota, usedPct }) => {
    if (quota === 'ok') { hideNet(); return; }
    if (quota === 'blocked') showNet('err', 'Terkena batas Binance. Menunggu sebelum melanjutkan.');
    else if (quota === 'tierA-only') showNet('warn', `Kuota ${Math.round(usedPct * 100)}% — hanya pair prioritas dilayani.`);
    else if (quota === 'paused') showNet('warn', `Kuota ${Math.round(usedPct * 100)}% — scan dijeda otomatis.`);
  });
}

async function initTierA() {
  try {
    const uni = await market.loadUniverse();
    state.universeLoaded = true;
    state.tierAList = uni.slice(0, UNIVERSE.tierASize).map((u) => u.symbol);
    await refreshTierA();
  } catch (e) {
    showNet('err', netErrMsg(e));
  }
}

async function refreshTierA() {
  if (!state.tierAList) return;
  try {
    const results = await market.scanSymbols(
      state.tierAList, state.timeframe, state.contextTf, () => {}, { tierA: true, weights: state.calibration?.weights }
    );
    // urut rank_score kekuatan
    results.sort((a, b) => b.rankScore.strength - a.rankScore.strength);
    state.tierA = results;
    await recordConfirmed(results);
    if (state.tab === 'pantau') render();
  } catch (e) { showNet('err', netErrMsg(e)); }
}

/**
 * Catat sinyal confirmed otomatis (§O-R6) + buat barrier pending.
 * @param {any[]} results
 */
async function recordConfirmed(results) {
  for (const r of results) {
    if (r.stale) continue;
    const sc = r.entryScore;
    if (sc.direction === 'neutral') continue;
    if (sc.strength < THRESHOLDS.confirmedStrength) continue;
    if (!r.atr) continue;
    const id = `${r.symbol}:${r.timeframe}:${r.lastOpenTime}`;
    const plan = buildPlan({ side: sc.direction, entry: r.lastPrice, atr: r.atr, rr: 2, roundTick: (x) => roundToTick(r.symbol, x) });
    /** @type {any} */
    const signal = {
      id, symbol: r.symbol, timeframe: r.timeframe, createdAt: Date.now(),
      barOpenTime: r.lastOpenTime, status: 'confirmed', direction: sc.direction,
      strength: sc.strength, agreement: sc.agreement, plan,
      model_version: state.calibration?.model_version || 'prior-v0',
    };
    try {
      const existing = await allSignals();
      if (!existing.find((s) => s.id === id)) {
        await putSignal(signal);
        await putBarrier({
          signalId: id, symbol: r.symbol, timeframe: r.timeframe, side: sc.direction,
          plan, entry: r.lastPrice, barOpenTime: r.lastOpenTime,
          outcome: 'pending', createdAt: Date.now(),
          deadlineMs: r.lastOpenTime + 24 * TFMS[r.timeframe],
        });
      }
    } catch { /* penyimpanan penuh ditangani di db.js */ }
  }
}

/**
 * Selesaikan barrier yang masih pending terhadap harga yang sudah terjadi (§20).
 * Inilah yang mengisi tab Bukti — tanpa ini statistik tak pernah muncul.
 * Hanya menyentuh barrier pending (biasanya sedikit), jadi ringan untuk kuota.
 */
async function resolvePendingBarriers() {
  let barriers = [];
  try { barriers = await allBarriers(); } catch { return; }
  const pending = barriers.filter((b) => b.outcome === 'pending');
  for (const b of pending) {
    try {
      const resolved = await market.resolveBarrier(b);
      if (resolved) await putBarrier(resolved);
    } catch { /* jaringan/kuota — coba lagi siklus berikutnya */ }
  }
}

// ---------- Render ----------
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', /** @type {HTMLElement} */(b).dataset.tab === state.tab);
  });
  for (const t of Object.keys(views)) views[t].classList.toggle('active', t === state.tab);

  if (state.tab === 'pantau') renderPantau();
  else if (state.tab === 'scan') renderScan();
  else if (state.tab === 'analisa') renderAnalisa();
  else if (state.tab === 'berita') renderNews(views.berita);
  else if (state.tab === 'jurnal') renderJurnal();
  else if (state.tab === 'bukti') renderEvidence(views.bukti, {
    version: state.calibration?.model_version || 'prior-v0',
    prior: state.calibration?.status === 'prior',
    measuredFamilies: state.calibration?.measuredFamilies || 0,
    oosPeriod: state.calibration?.oosPeriod || null,
  });
}

function renderPantau() {
  const v = views.pantau;
  v.innerHTML = '';
  v.append(el('div', { class: 'view-head' }, [
    el('h2', { text: 'Pantau' }),
    el('span', { class: 'meta', text: state.universeLoaded ? `live · ${state.tierA.length} pair · ${state.timeframe}` : 'memuat…' }),
  ]));
  if (!state.tierA.length) {
    if (!state.universeLoaded) { v.append(skeletonList()); return; }
    v.append(emptyState('Belum ada pair', 'Data pasar belum termuat. Periksa koneksi — domain Binance kadang diblokir ISP, coba VPN.'));
    return;
  }
  for (const r of state.tierA) v.append(rowFrom(r));
}

/** @param {any} r */
function rowFrom(r) {
  const sc = r.rankScore;
  const status = r.stale ? 'stale' : statusFor(r.entryScore);
  const of = r.families?.find((f) => f.family === 'E6');
  const desc = r.stale
    ? `data ${fmtDuration(Date.now() - r.lastOpenTime)} lalu · basi`
    : `kompak ${sc.agreement == null ? '—' : sc.agreement} · ${describeOF(of, sc.direction)}`;
  return pairRow({
    symbol: r.symbol, status, desc,
    value: r.stale ? null : sc.strength, direction: sc.direction, stale: r.stale,
  }, (sym) => { state.selected = r; state.tab = 'analisa'; render(); });
}

/** @param {any} entryScore */
function statusFor(entryScore) {
  if (entryScore.direction === 'neutral') return 'watching';
  if (entryScore.strength >= THRESHOLDS.confirmedStrength) return 'confirmed';
  if (entryScore.strength >= THRESHOLDS.buildingStrength) return 'building';
  return 'watching';
}

/** @param {any} of @param {import('../core/types.js').Side} dir */
function describeOF(of, dir) {
  if (!of || of.provenance === 'tidak_tersedia') return 'order flow —';
  const sign = Math.sign(of.value);
  const dirSign = dir === 'long' ? 1 : dir === 'short' ? -1 : 0;
  if (sign === 0) return 'order flow netral';
  return sign === dirSign ? 'order flow searah' : 'order flow lawan';
}

function renderScan() {
  const v = views.scan;
  v.innerHTML = '';
  v.append(el('div', { class: 'view-head' }, [el('h2', { text: 'Scan' }), el('span', { class: 'meta', text: `${state.timeframe}` })]));
  const btn = el('button', { class: 'btn block', text: 'Scan universe (Tier B)' });
  const prog = el('div', { class: 'progress', style: 'display:none' }, [el('div', { class: 'bar', style: 'width:0%' })]);
  const list = el('div', {});
  btn.addEventListener('click', async () => {
    btn.setAttribute('disabled', 'true');
    prog.style.display = 'block';
    const barEl = /** @type {HTMLElement} */(prog.firstChild);
    try {
      if (!state.universeLoaded) await market.loadUniverse();
      const uni = await market.loadUniverse();
      const syms = uni.slice(0, UNIVERSE.tierBScanLimit).map((u) => u.symbol);
      list.innerHTML = '';
      const results = await market.scanSymbols(syms, state.timeframe, state.contextTf, (d, t) => { barEl.style.width = `${(d / t) * 100}%`; }, { weights: state.calibration?.weights });
      results.sort((a, b) => b.rankScore.strength - a.rankScore.strength);
      state.scanResults = results;
      await recordConfirmed(results);
      list.innerHTML = '';
      for (const r of results.slice(0, 50)) list.append(rowFrom(r));
    } catch (e) { showNet('err', netErrMsg(e)); }
    finally { btn.removeAttribute('disabled'); prog.style.display = 'none'; }
  });
  v.append(btn, prog, list);
  if (state.scanResults.length) for (const r of state.scanResults.slice(0, 50)) list.append(rowFrom(r));
}

function renderAnalisa() {
  const v = views.analisa;
  v.innerHTML = '';
  v.append(el('div', { class: 'view-head' }, [el('h2', { text: 'Analisa' })]));
  const r = state.selected;
  if (!r) { v.append(emptyState('Pilih pair', 'Ketuk salah satu pair di Pantau atau Scan untuk melihat rinciannya.')); return; }

  const msToClose = TFMS[r.timeframe] - ((Date.now() - r.lastOpenTime) % TFMS[r.timeframe]);
  const card = scoreCard({
    symbol: r.symbol, timeframe: r.timeframe, lastPrice: r.lastPrice,
    score: r.fullScore, status: r.stale ? 'watching' : statusFor(r.entryScore),
    msToClose: r.stale ? null : msToClose,
    calibration: { version: state.calibration?.model_version || 'prior-v0', prior: state.calibration?.status === 'prior', oosPeriod: state.calibration?.oosPeriod || null },
    onTrace: () => showTrace(r),
  });
  v.append(card);

  // Rencana entry (§O-R1)
  if (r.atr && r.fullScore.direction !== 'neutral') {
    const plan = buildPlan({ side: r.fullScore.direction, entry: r.lastPrice, atr: r.atr, rr: 2, roundTick: (x) => roundToTick(r.symbol, x) });
    v.append(el('div', { class: 'fam-title', text: 'Rencana entry' }));
    v.append(planCard(plan));
  }

  // Dua skor terpisah terlihat (§4.3)
  v.append(el('div', { class: 'note info', text: `Rank ${r.rankScore.strength} (${dirLabel(r.rankScore.direction)}) · Entry ${r.entryScore.strength} (${dirLabel(r.entryScore.direction)}) — ranking tidak dipengaruhi entry.` }));
}

async function renderJurnal() {
  const v = views.jurnal;
  v.innerHTML = '';
  v.append(el('div', { class: 'view-head' }, [el('h2', { text: 'Jurnal' }), el('span', { class: 'meta', text: '' })]));

  // Ekspor/impor (§ST-R3)
  const bar = el('div', { style: 'display:flex; gap:8px; margin-bottom:14px' }, [
    el('button', { class: 'btn ghost', text: 'Ekspor data', onclick: doExport }),
    el('button', { class: 'btn ghost', text: 'Impor', onclick: doImport }),
  ]);
  v.append(bar);

  let signals = [];
  try { signals = await allSignals(); } catch { /* noop */ }
  const visible = signals.filter((s) => !s.hidden).sort((a, b) => b.createdAt - a.createdAt);
  const hiddenCount = signals.length - visible.length;

  if (!visible.length) {
    v.append(emptyState('Belum ada sinyal tercatat', 'Sinyal confirmed dicatat otomatis di sini — tidak perlu tombol simpan.'));
    return;
  }
  for (const s of visible.slice(0, 100)) {
    v.append(el('div', { class: 'pair-row' }, [
      el('div', { class: 'body' }, [
        el('div', { class: 'sym' }, [el('span', { text: s.symbol.replace('USDT', '') }), el('span', { class: `dir ${s.direction}`, text: dirLabel(s.direction) })]),
        el('div', { class: 'desc', text: `${s.timeframe} · kekuatan ${s.strength} · ${new Date(s.createdAt).toLocaleString('id-ID')}` }),
      ]),
      el('div', { class: 'num' }, [el('div', { class: 'v', text: `${s.plan?.rr ?? ''}R` })]),
    ]));
  }
  if (hiddenCount) v.append(el('div', { class: 'note info', text: `${hiddenCount} sinyal disembunyikan — tetap dihitung di statistik (§O-R7).` }));
}

// ---------- Aksi ----------
async function doExport() {
  try {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `malomo-qt-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Data diekspor.');
  } catch { toast('Ekspor gagal.'); }
}
function doImport() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try { await importAll(JSON.parse(await file.text())); toast('Data diimpor.'); render(); }
    catch { toast('Impor gagal — file tidak valid.'); }
  };
  input.click();
}

/** @param {any} r */
function showTrace(r) {
  const lines = [];
  for (const f of r.fullScore.families) {
    for (const c of f.criteria) {
      lines.push(`${f.family} ${c.id}: ${c.side} mag=${c.magnitude.toFixed(2)} [${c.provenance}] raw=${c.raw == null ? '—' : Number(c.raw).toFixed(5)}`);
    }
  }
  toast(`Trace ${r.symbol}: ${r.fullScore.availableCount} keluarga tersedia`);
  // tampilkan detail sederhana di analisa
  const box = el('div', { class: 'note info', style: 'white-space:pre-wrap; font-size:11px; margin-top:12px' }, [document.createTextNode(lines.join('\n'))]);
  views.analisa.append(box);
}

// ---------- Util UI ----------
/** @param {'warn'|'err'|'info'} kind @param {string} msg */
function showNet(kind, msg) { netbar.className = `netbar show ${kind}`; netbar.textContent = msg; }
function hideNet() { netbar.className = 'netbar'; }
/** @param {any} e */
function netErrMsg(e) {
  if (e && e.kind === 'rate-limit') return e.message;
  if (e && e.name === 'NetError') return e.message;
  return 'Gagal memuat data. Domain Binance kadang diblokir ISP di Indonesia — coba VPN.';
}
/** @param {string} msg */
function toast(msg) {
  const t = el('div', { class: 'toast', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

async function maybeExportReminder() {
  try { if (await needsExportReminder()) toast('Sudah lebih dari 7 hari sejak ekspor terakhir. Ekspor data agar tidak hilang.'); } catch { /* noop */ }
}

function maybePromptInstall() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = /** @type {any} */(navigator).standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone) {
    setTimeout(() => toast('Pasang ke Layar Utama agar data tidak dihapus otomatis oleh Safari.'), 3000);
  }
}
