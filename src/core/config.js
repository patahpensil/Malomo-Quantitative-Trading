// @ts-check
/**
 * Konfigurasi prior. SEMUA angka ambang tinggal di sini — tidak ada angka ajaib
 * inline di kode perhitungan (§17.1). Nilai-nilai ini berlabel `prior` dan
 * dimaksudkan untuk digantikan oleh calibration.json (§A-1, §17.4).
 *
 * Aturan: kode boleh membaca dari sini; kode TIDAK menulis ke sini.
 */

export const PRIOR_VERSION = 'prior-v0';

/** Ambang keputusan skor (§17.3, §17.4). */
export const THRESHOLDS = {
  /** δ — di bawah |S| ini, arah dianggap none. */
  directionDelta: 0.08,
  /** Keluarga terukur minimum agar sinyal dikeluarkan (§17.4, §S-R7). */
  minFamilies: 4,
  /** strength >= ini → status building (§L-R5). */
  buildingStrength: 40,
  /** strength >= ini + bar tertutup → confirmed & dicatat (§17.4). */
  confirmedStrength: 55,
  /** Sinyal terevaluasi minimum sebelum tab Bukti tampilkan statistik (§BK-1). */
  minSignalsForStats: 30,
};

/** Batas modulator rezim (§17.5). Rezim tak boleh membalik arah. */
export const REGIME_MODULATOR = { min: 0.7, max: 1.3 };

/** Ambang keandalan Markov (§4.4, warisan Patah Pensill). */
export const MARKOV = {
  minSample: 20,
  states: /** @type {const} */ (['bearish', 'neutral', 'bullish', 'overheated']),
  window: 130,
  laplaceAlpha: 1,
};

/**
 * Deadband & titik jenuh per kriteria (§17.1).
 * magnitude = clamp01((|raw| - edge) / (sat - edge))
 * `edge` = tepi deadband tempat magnitude mulai naik dari 0.
 * `sat`  = titik jenuh tempat magnitude mencapai 1.
 */
export const CRITERIA = {
  rsi: { neutralLo: 45, neutralHi: 55, edge: 5, sat: 25 }, // jarak dari 50
  adx: { edge: 25, sat: 50, diGapMin: 3 },
  funding: { edge: 0.0005, sat: 0.01, unit: 'ratio' }, // 0.05% .. 1%
  volume: { edge: 1.2, sat: 3.0, unit: 'x' }, // RVOL
  macdHist: { edge: 0, sat: 0.004, unit: 'rel' }, // relatif terhadap harga
  emaSlope: { edge: 0, sat: 0.003, unit: 'rel/bar' },
  oi: { edge: 0.01, sat: 0.08, unit: 'ratio' }, // perubahan OI
  cvd: { edge: 0, sat: 1, unit: 'z' }, // z-score delta
  obImbalance: { edge: 0.1, sat: 0.6, unit: 'ratio' },
  longShort: { edge: 0.05, sat: 0.5, unit: 'ratio' }, // dev dari 1.0
};

/** Bobot prior keluarga (§P-4). Semua sama sampai IC mengukur (§S-R3). */
export const PRIOR_WEIGHTS = /** @type {Record<import('./types.js').Family,number>} */ ({
  E1: 1, E2: 1, E3: 1, E4: 1, E5: 1, E6: 1, E7: 1, E8: 1,
});

/** Pembagian keluarga ke rank vs entry (§4.3). */
export const RANK_FAMILIES = /** @type {const} */ (['E1', 'E4', 'E5', 'E7', 'E8']);
export const ENTRY_FAMILIES = /** @type {const} */ (['E2', 'E3', 'E6']);

/** Batas jaringan (§18). */
export const NET = {
  fapiBase: 'https://fapi.binance.com',
  wsBase: 'wss://fstream.binance.com',
  weightPausePct: 0.7, // >70% kuota → jeda scan (§NET-2)
  weightTierAOnlyPct: 0.9, // >90% → hanya Tier A
  maxConcurrent: 4, // pola Patah Pensill (§NET, terbukti aman)
  streamsPerSocket: 100, // batas aman per koneksi WS (§WS-1)
  wsReconnectBaseMs: 1000,
  wsReconnectMaxMs: 30_000,
  wsRefreshBeforeMs: 23 * 60 * 60_000, // reconnect sebelum batas 24 jam (§WS-4)
};

/** Universe berjenjang (§NF-1). */
export const UNIVERSE = {
  tierASize: 30, // keputusan terbuka #4 → prior 30
  tierBScanLimit: 400,
};

/** Biaya transaksi untuk barrier & backtest (§O-R3). */
export const COSTS = {
  takerFee: 0.0004, // 0.04%
  makerFee: 0.0002,
  slippageK: 0.5, // koefisien slippage ~ k * volatilitas
};

/** Retensi penyimpanan (§DB-5). */
export const STORAGE = {
  candleCacheMax: 500,
  exportReminderDays: 7,
  dbName: 'malomo-qt',
  dbVersion: 1,
};
