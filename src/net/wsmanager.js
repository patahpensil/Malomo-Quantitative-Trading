// @ts-check
/**
 * Manajer WebSocket Binance (§18.2).
 *  WS-1 satu combined stream per koneksi; dipecah bila stream > batas aman.
 *  WS-2 reconnect exponential backoff + jitter.
 *  WS-3 WAJIB resync REST setelah reconnect (bar terlewat tak dikirim ulang).
 *  WS-4 reconnect terjadwal sebelum batas 24 jam.
 *  WS-5 data lebih tua dari 2×interval → basi (ditangani konsumen).
 */

import { NET } from '../core/config.js';

export class WSManager {
  /**
   * @param {string[]} streams  nama stream Binance (mis. 'btcusdt@kline_15m')
   * @param {(msg:any)=>void} onMessage
   * @param {() => void} [onReconnect]  dipanggil agar konsumen resync REST (§WS-3)
   */
  constructor(streams, onMessage, onReconnect) {
    this.streams = streams;
    this.onMessage = onMessage;
    this.onReconnect = onReconnect;
    /** @type {WebSocket[]} */
    this.sockets = [];
    this.attempt = 0;
    this.closedByUs = false;
    /** @type {number|undefined} */
    this.refreshTimer = undefined;
  }

  connect() {
    this.closedByUs = false;
    // Pecah ke beberapa koneksi bila melebihi batas per socket (§WS-1)
    const chunks = chunk(this.streams, NET.streamsPerSocket);
    this.sockets = chunks.map((c) => this._open(c));
    // Reconnect terjadwal sebelum 24 jam (§WS-4)
    clearTimeout(this.refreshTimer);
    this.refreshTimer = /** @type {any} */ (setTimeout(() => this._cycle(), NET.wsRefreshBeforeMs));
  }

  /** @param {string[]} streamChunk */
  _open(streamChunk) {
    const url = `${NET.wsBase}/stream?streams=${streamChunk.join('/')}`;
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); } catch { /* abaikan frame rusak */ }
    };
    ws.onopen = () => { this.attempt = 0; };
    ws.onclose = () => { if (!this.closedByUs) this._scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    return ws;
  }

  _scheduleReconnect() {
    this.attempt++;
    const base = Math.min(NET.wsReconnectBaseMs * 2 ** this.attempt, NET.wsReconnectMaxMs);
    const jitter = Math.random() * base * 0.3; // §WS-2 jitter
    setTimeout(() => {
      if (this.closedByUs) return;
      this._cycle();
    }, base + jitter);
  }

  _cycle() {
    this.close(/* internal */ true);
    this.connect();
    // §WS-3: bar yang terlewat selama putus TIDAK dikirim ulang — konsumen
    // wajib menambal lewat REST.
    if (this.onReconnect) this.onReconnect();
  }

  /** @param {boolean} [internal] */
  close(internal = false) {
    this.closedByUs = !internal;
    if (!internal) clearTimeout(this.refreshTimer);
    for (const ws of this.sockets) { try { ws.close(); } catch { /* noop */ } }
    this.sockets = [];
  }
}

/**
 * @template T @param {T[]} arr @param {number} size @returns {T[][]}
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
