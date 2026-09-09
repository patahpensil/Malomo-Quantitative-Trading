// @ts-check
/**
 * Klien Binance USDT-M Futures. Semua lewat gerbang (§NET-4).
 *
 * §L-R1b: untuk data REST, bar terakhir SELALU dianggap belum tutup dan dibuang
 *   saat barBasis 'closed'. Ini menutup sumber repainting Patah Pensill
 *   (fetchKlines memakai respons apa adanya tanpa slice(0,-1)).
 * §PR-1: tickSize/stepSize/pricePrecision dari exchangeInfo, di-cache.
 */

import { getJSON } from './gateway.js';
import { NET } from '../core/config.js';

const F = NET.fapiBase;

/** @type {Map<string,{tickSize:number,stepSize:number,pricePrecision:number,status:string}>|null} */
let symbolMeta = null;

/**
 * Muat & cache exchangeInfo. Wajib dipanggil saat start (§PR-1, §SY-1).
 * @returns {Promise<Map<string,{tickSize:number,stepSize:number,pricePrecision:number,status:string}>>}
 */
export async function loadExchangeInfo() {
  const data = await getJSON(`${F}/fapi/v1/exchangeInfo`, { tierA: true });
  const map = new Map();
  for (const s of data.symbols) {
    if (s.quoteAsset !== 'USDT' || s.contractType !== 'PERPETUAL') continue;
    let tickSize = 0, stepSize = 0;
    for (const f of s.filters) {
      if (f.filterType === 'PRICE_FILTER') tickSize = parseFloat(f.tickSize);
      if (f.filterType === 'LOT_SIZE') stepSize = parseFloat(f.stepSize);
    }
    map.set(s.symbol, { tickSize, stepSize, pricePrecision: s.pricePrecision, status: s.status });
  }
  symbolMeta = map;
  return map;
}

/** @returns {Map<string,{tickSize:number,stepSize:number,pricePrecision:number,status:string}>} */
export function getSymbolMeta() {
  if (!symbolMeta) throw new Error('exchangeInfo belum dimuat — panggil loadExchangeInfo() dulu');
  return symbolMeta;
}

/**
 * Daftar simbol TRADING, diurut kasar berdasarkan quoteVolume 24h.
 * @param {number} [limit]
 * @returns {Promise<{symbol:string, quoteVolume:number, priceChangePercent:number, lastPrice:number}[]>}
 */
export async function topSymbols(limit = 400) {
  const [tickers, meta] = await Promise.all([
    getJSON(`${F}/fapi/v1/ticker/24hr`, { tierA: true }),
    symbolMeta ? Promise.resolve(symbolMeta) : loadExchangeInfo(),
  ]);
  const rows = tickers
    .filter((t) => meta.has(t.symbol) && /** @type {any} */(meta.get(t.symbol)).status === 'TRADING')
    .map((t) => ({
      symbol: t.symbol,
      quoteVolume: parseFloat(t.quoteVolume),
      priceChangePercent: parseFloat(t.priceChangePercent),
      lastPrice: parseFloat(t.lastPrice),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  return rows.slice(0, limit);
}

/**
 * Ambil klines. Membuang bar berjalan bila barBasis 'closed' (§L-R1b).
 * Dengan startTime, Binance mengembalikan bar MAJU dari waktu itu — dipakai
 * resolver barrier agar tetap akurat untuk sinyal lama (§20).
 * @param {string} symbol @param {string} interval @param {number} limit
 * @param {import('../core/types.js').BarBasis} barBasis
 * @param {{tierA?:boolean, signal?:AbortSignal, startTime?:number, endTime?:number}} [opts]
 * @returns {Promise<import('../scoring/families.js').Candles>}
 */
export async function klines(symbol, interval, limit, barBasis, opts = {}) {
  let url = `${F}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (opts.startTime != null) url += `&startTime=${opts.startTime}`;
  if (opts.endTime != null) url += `&endTime=${opts.endTime}`;
  const raw = await getJSON(url, opts);
  // Binance mengembalikan bar terakhir sebagai bar BERJALAN.
  const rows = barBasis === 'closed' ? raw.slice(0, -1) : raw;
  return {
    openTime: rows.map((k) => k[0]),
    open: rows.map((k) => parseFloat(k[1])),
    high: rows.map((k) => parseFloat(k[2])),
    low: rows.map((k) => parseFloat(k[3])),
    close: rows.map((k) => parseFloat(k[4])),
    volume: rows.map((k) => parseFloat(k[5])),
  };
}

/**
 * Funding rate terkini.
 * @param {string} symbol
 * @returns {Promise<number|null>}
 */
export async function fundingRate(symbol) {
  try {
    const d = await getJSON(`${F}/fapi/v1/premiumIndex?symbol=${symbol}`);
    return parseFloat(d.lastFundingRate);
  } catch { return null; }
}

/**
 * Perubahan open interest relatif (2 titik terakhir).
 * @param {string} symbol @param {string} period
 * @returns {Promise<number|null>}
 */
export async function oiChange(symbol, period = '5m') {
  try {
    const d = await getJSON(`${F}/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=2`);
    if (!Array.isArray(d) || d.length < 2) return null;
    const a = parseFloat(d[0].sumOpenInterest), b = parseFloat(d[1].sumOpenInterest);
    return a === 0 ? null : (b - a) / a;
  } catch { return null; }
}

/**
 * Rasio akun long/short (proxy sentimen).
 * @param {string} symbol @param {string} period
 * @returns {Promise<number|null>}
 */
export async function longShortRatio(symbol, period = '5m') {
  try {
    const d = await getJSON(`${F}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`);
    if (!Array.isArray(d) || !d.length) return null;
    return parseFloat(d[0].longShortRatio);
  } catch { return null; }
}

/**
 * Bulatkan harga ke tickSize (§PR-2). Membulatkan SEBELUM dipakai hitung RR.
 * @param {string} symbol @param {number} price
 */
export function roundToTick(symbol, price) {
  const meta = getSymbolMeta().get(symbol);
  if (!meta || !meta.tickSize) return price;
  const ticks = Math.round(price / meta.tickSize);
  const rounded = ticks * meta.tickSize;
  // hindari galat float: bulatkan ke presisi harga
  return parseFloat(rounded.toFixed(meta.pricePrecision));
}
