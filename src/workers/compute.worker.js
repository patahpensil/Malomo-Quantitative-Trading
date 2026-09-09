// @ts-check
/**
 * Worker komputasi — menjalankan bagian MURNI pipeline di luar main thread
 * supaya UI tetap responsif saat scan ratusan simbol (§NF-2).
 *
 * §CD-5 dijaga utuh: worker mengimpor pipeline.js YANG SAMA dengan Bidang Live
 *   dan Bidang Riset. Tidak ada logika skor yang diduplikasi di sini — hanya
 *   pembungkus pesan. Bila berkas ini menyimpang dari pipeline, itu bug.
 * §CD-8: module worker adalah titik paling rawan di iOS. computeClient.js
 *   membungkus pembuatan worker dengan deteksi + fallback; berkas ini sendiri
 *   berasumsi lingkungannya sudah lolos deteksi itu.
 *
 * Protokol pesan:
 *   masuk : { id:number, input:SymbolInput }
 *   keluar: { id:number, ok:true, result } | { id:number, ok:false, error:string }
 */

import { analyzeSymbol } from '../scoring/pipeline.js';

self.onmessage = (ev) => {
  const { id, input } = ev.data || {};
  try {
    const result = analyzeSymbol(input);
    // result berisi angka/string/array → cloneable oleh structured clone
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
