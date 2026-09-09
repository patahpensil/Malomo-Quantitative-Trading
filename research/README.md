# Bidang Riset (Research Plane)

Bidang ini berjalan **di PC**, bukan di HP. Ia menghasilkan artefak (kelak
`data/calibration.json`) yang dibaca oleh Bidang Live secara satu arah. Live
tidak pernah menghitung bobotnya sendiri (§A-1).

## Janji arsitektur yang membuat ini berarti

`backtest.js` mengimpor `../src/scoring/**` dan `../src/indicators/**` — **berkas
yang sama persis** dengan yang dijalankan aplikasi di HP. Bukan port, bukan
salinan. Jadi mustahil ada celah "logika backtest berbeda dari logika live" yang
diam-diam membohongi pemilik sistem. Kalau skor di sini berbeda dari skor di HP,
itu karena datanya berbeda — bukan kodenya.

Penjaga `scripts/check.js` menegakkan bahwa `scoring/` & `indicators/` tidak
mengimpor apa pun dari UI atau jaringan (§CD-5), sehingga keduanya aman diimpor
di Node tanpa DOM.

## Menjalankan backtest

```bash
node research/backtest.js BTCUSDT 15m 1h 60
#                         simbol  tf  ctx hari
```

Butuh internet (mengambil klines historis dari Binance Futures). Keluaran:
ekspektasi per-trade, win rate, profit factor, Sharpe per-trade, interval
kepercayaan 95%, **baseline arah-acak berdampingan**, dan **gate kewajaran**.

## Cara membaca hasilnya (penting)

- **Baseline acak** ada supaya kamu tak tertipu oleh angka yang kelihatan bagus.
  Kalau sistem tak mengalahkan lemparan koin setelah biaya, ia tak punya edge.
- **IK 95% bawah > 0** baru berarti ekspektasi positifnya signifikan secara
  statistik. Kalau bawahnya masih ≤ 0, jangan overклaim — belum bisa dibedakan
  dari nol.
- **Gate kewajaran menyala** (win rate > 75% atau Sharpe > 3) adalah **alarm**,
  bukan piala (§O-R9). Pada data retail, angka setinggi itu hampir selalu berarti
  lookahead, survivorship, atau biaya yang belum dimodelkan. Curigai kodemu dulu.

## Ruang lingkup v1 (jujur)

Harness ini menguji **tulang punggung harga**: keluarga E1 (struktur), E2 (level),
E3 (momentum), E4 (volume), plus E8 (multi-timeframe) bila konteks tersedia.

Keluarga E5–E7 (funding, OI, order flow, sentimen posisi) **tidak** diikutkan di
backtest karena data historis point-in-time-nya sulit direkonstruksi dengan andal
— memaksakannya justru mengundang lookahead. Empat keluarga harga tepat memenuhi
ambang `minFamilies = 4`, jadi hasil di sini adalah pernyataan tentang inti harga,
bukan seluruh sinyal live.

## Langkah riset berikutnya (belum dikerjakan)

1. **Penyetelan bobot per-keluarga (IC).** Ukur information coefficient tiap
   keluarga terhadap hasil forward, lalu tulis `data/calibration.json` dengan
   `status: "terukur"`, `oosPeriod`, dan `measuredFamilies`. Sampai itu terjadi,
   aplikasi memakai bobot prior (semua 1) dan menandainya jujur di UI.
2. **Walk-forward out-of-sample** berjenjang (latih di jendela lama, uji di jendela
   baru yang tak pernah dilihat) sebelum bobot apa pun dipromosikan.
3. **Deflated Sharpe** lintas banyak simbol untuk menghukum pencarian berlebih.

Jangan menyunting `data/calibration.json` dengan tangan untuk "memperbaiki" hasil.
Itu persis jenis penipuan-diri yang seluruh arsitektur ini dibangun untuk mencegah.
