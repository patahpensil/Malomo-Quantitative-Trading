// @ts-check
/**
 * Order flow (§7.2, keluarga E6): CVD & order book imbalance.
 *
 * §PR-3: akumulator CVD di-reset per bar — penjumlahan float ratusan ribu trade
 *   tanpa batas menimbulkan drift presisi. Kita simpan delta per bar, lalu
 *   z-score-kan terhadap jendela bar sebelumnya.
 */

export class CVDTracker {
  /** @param {number} window jumlah bar untuk z-score */
  constructor(window = 50) {
    this.window = window;
    /** @type {number[]} riwayat delta per bar (tertutup) */
    this.barDeltas = [];
    this.currentDelta = 0;
    this.currentBarOpenTime = 0;
  }

  /**
   * Proses satu aggTrade. m=true berarti buyer adalah maker → agresor SELL.
   * @param {{q:string, m:boolean, T:number}} trade
   * @param {number} barMs panjang bar dalam ms
   */
  onAggTrade(trade, barMs) {
    const qty = parseFloat(trade.q);
    const signed = trade.m ? -qty : qty; // agresor: taker
    const barOpen = Math.floor(trade.T / barMs) * barMs;
    if (this.currentBarOpenTime === 0) this.currentBarOpenTime = barOpen;
    if (barOpen > this.currentBarOpenTime) {
      // bar berganti → finalisasi (§PR-3 reset)
      this.barDeltas.push(this.currentDelta);
      if (this.barDeltas.length > this.window) this.barDeltas.shift();
      this.currentDelta = 0;
      this.currentBarOpenTime = barOpen;
    }
    this.currentDelta += signed;
  }

  /**
   * z-score delta bar berjalan terhadap jendela bar tertutup.
   * @returns {number|null}
   */
  zScore() {
    if (this.barDeltas.length < 10) return null;
    const mean = this.barDeltas.reduce((a, b) => a + b, 0) / this.barDeltas.length;
    const variance = this.barDeltas.reduce((a, b) => a + (b - mean) ** 2, 0) / this.barDeltas.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) return null;
    return (this.currentDelta - mean) / sd;
  }
}

/**
 * Imbalance order book dari depth: (bidVol - askVol)/(bidVol + askVol) pada N level.
 * @param {{bids:[string,string][], asks:[string,string][]}} depth
 * @param {number} levels
 * @returns {number|null}  -1..1
 */
export function orderBookImbalance(depth, levels = 20) {
  if (!depth || !depth.bids || !depth.asks) return null;
  let bidVol = 0, askVol = 0;
  for (let i = 0; i < Math.min(levels, depth.bids.length); i++) bidVol += parseFloat(depth.bids[i][1]);
  for (let i = 0; i < Math.min(levels, depth.asks.length); i++) askVol += parseFloat(depth.asks[i][1]);
  const total = bidVol + askVol;
  if (total === 0) return null;
  return (bidVol - askVol) / total;
}
