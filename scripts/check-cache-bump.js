// @ts-check
/**
 * Penjaga cache SW (§CD-7). Dua tugas:
 *
 *  A. KELENGKAPAN: setiap berkas src/**.js dan aset shell wajib tercantum di
 *     daftar SHELL sw.js. Modul yang lupa didaftarkan = tak ter-cache = layar
 *     putih saat offline.
 *
 *  B. BUMP: bila ada berkas di src/ berubah relatif commit sebelumnya, maka
 *     CACHE_NAME di sw.js WAJIB ikut berubah. Tanpa git (mis. lokal tanpa
 *     riwayat) langkah B dilewati dengan pesan, langkah A tetap jalan.
 *
 * Alasan: dengan puluhan modul, cache yang tak dinaikkan menyajikan campuran
 * versi lama+baru yang tak pernah diuji.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');

/** @type {string[]} */
const errors = [];

const sw = readFileSync(SW, 'utf8');
const nameMatch = sw.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
if (!nameMatch) {
  console.error('✗ CACHE_NAME tidak ditemukan di sw.js');
  process.exit(1);
}
const cacheName = nameMatch[1];

// ---- A. kelengkapan SHELL ----
/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
const srcFiles = walk(join(ROOT, 'src')).map((p) => './' + relative(ROOT, p).replace(/\\/g, '/'));
for (const f of srcFiles) {
  if (!sw.includes(f)) {
    errors.push(`[shell] ${f} tidak terdaftar di SHELL sw.js — takkan ter-cache offline (§CD-7).`);
  }
}
// styles.css juga wajib
if (!sw.includes('./src/ui/styles.css')) errors.push('[shell] ./src/ui/styles.css tidak terdaftar di SHELL.');

// ---- B. bump vs commit sebelumnya ----
let gitOk = true;
/** @param {string} cmd */
function git(cmd) { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
try { git('rev-parse HEAD~1'); } catch { gitOk = false; }

if (gitOk) {
  let changedSrc = [];
  try {
    changedSrc = git('diff --name-only HEAD~1 HEAD -- src')
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { changedSrc = []; }
  if (changedSrc.length) {
    let prevName = '';
    try {
      const prevSw = git('show HEAD~1:sw.js');
      const pm = prevSw.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
      prevName = pm ? pm[1] : '';
    } catch { prevName = ''; }
    if (prevName && prevName === cacheName) {
      errors.push(`[bump] ${changedSrc.length} berkas src/ berubah tetapi CACHE_NAME tetap '${cacheName}' — WAJIB dinaikkan (§CD-7).`);
    }
  }
} else {
  console.log('  (info) riwayat git tak tersedia — lewati cek bump, jalankan cek kelengkapan saja.');
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} masalah cache SW:`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`✓ check-cache-bump.js lolos — CACHE_NAME='${cacheName}', ${srcFiles.length} modul src/ terdaftar.`);
