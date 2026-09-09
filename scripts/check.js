// @ts-check
/**
 * Pemeriksa statis tanpa dependensi (§G-R4). Menegakkan invarian arsitektur PRD
 * yang tak tertangkap oleh tes unit. Keluar dengan kode !=0 bila ada pelanggaran.
 *
 * Yang diperiksa (semua atas KODE, bukan komentar — komentar dikupas dulu):
 *   1. LAYERING (§CD-5): scoring/ & indicators/ tak boleh mengimpor UI/jaringan.
 *      Diperluas ke aturan lapisan penuh agar Bidang Riset bisa mengimpor
 *      scoring/ apa adanya di Node.
 *   2. GERBANG JARINGAN (§NET-4): hanya net/gateway.js yang memegang fetch ke
 *      Binance; hanya net/wsmanager.js yang membuat WebSocket.
 *   3. TANPA localStorage/sessionStorage (§ST-R1) — IndexedDB saja.
 *   4. BATAS UKURAN BERKAS (§CD-4): ~400 baris.
 *   5. Pola bug Patah Pensill (§21.1 bug #1): perbandingan silang literal
 *      Bias vs Side. (Tripwire murah; jaminan sebenarnya ada pada corong
 *      biasToSide() + uji antilookahead.)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** @type {string[]} */
const errors = [];

/** Layer → set layer yang boleh diimpor. */
const ALLOWED = {
  core: new Set(['core']),
  indicators: new Set(['core', 'indicators']),
  scoring: new Set(['core', 'indicators', 'scoring']),
  store: new Set(['core', 'store']),
  net: new Set(['core', 'net']),
  workers: new Set(['core', 'indicators', 'scoring', 'workers']),
  ui: new Set(['core', 'indicators', 'scoring', 'store', 'net', 'ui', 'workers']),
};

const MAX_LINES = 420;

/**
 * Kupas komentar (baris & blok) & isi string, pertahankan jumlah baris agar
 * nomor baris tetap akurat. String di-blank supaya literal di dalam pesan tak
 * memicu pemeriksa pola.
 * @param {string} s
 */
function stripComments(s) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1] || '';
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; continue; }
      out += c; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += '\n'; } else out += ' '; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; out += '  '; i++; } else out += (c === '\n' ? '\n' : ' '); continue; }
    if (state === 'str') {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === quote) { state = 'code'; out += c; continue; }
      out += (c === '\n' ? '\n' : ' '); continue; // blank isi string, jaga newline
    }
  }
  return out;
}

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

/** @param {string} file */
function layerOf(file) { return relative(SRC, file).split(/[/\\]/)[0]; }

const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const code = stripComments(raw);
  const rawLines = raw.split('\n');
  const codeLines = code.split('\n');
  const layer = layerOf(file);

  if (rawLines.length > MAX_LINES) {
    errors.push(`[ukuran] ${rel}: ${rawLines.length} baris > ${MAX_LINES} (§CD-4). Pecah berkas.`);
  }

  // import layering (atas kode terkupas)
  const importRe = /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(code))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const parts = spec.split('/').filter((s) => s && s !== '.' && s !== '..');
    const targetLayer = parts[0];
    const allowed = ALLOWED[layer];
    if (allowed && targetLayer && ALLOWED[targetLayer] && !allowed.has(targetLayer)) {
      errors.push(`[layer] ${rel} mengimpor '${spec}' (lapisan ${targetLayer}) — dilarang dari lapisan ${layer} (§CD-5).`);
    }
  }

  const isGateway = rel.endsWith('net/gateway.js') || rel.endsWith('net\\gateway.js');
  const isWs = rel.endsWith('net/wsmanager.js') || rel.endsWith('net\\wsmanager.js');
  codeLines.forEach((ln, i) => {
    const n = i + 1;
    if (/\bfetch\s*\(/.test(ln) && /binance/i.test(ln) && !isGateway) {
      errors.push(`[net] ${rel}:${n} fetch langsung ke Binance di luar gateway.js (§NET-4).`);
    }
    if (/new\s+WebSocket\s*\(/.test(ln) && !isWs) {
      errors.push(`[net] ${rel}:${n} new WebSocket di luar wsmanager.js (§WS-1).`);
    }
    if (/\blocalStorage\b/.test(ln)) errors.push(`[storage] ${rel}:${n} memakai localStorage — dilarang, pakai IndexedDB (§ST-R1).`);
    if (/\bsessionStorage\b/.test(ln)) errors.push(`[storage] ${rel}:${n} memakai sessionStorage — dilarang, pakai IndexedDB (§ST-R1).`);
    if (/['"](bullish|bearish)['"]\s*===?\s*['"](long|short)['"]/.test(ln) ||
        /['"](long|short)['"]\s*===?\s*['"](bullish|bearish)['"]/.test(ln)) {
      errors.push(`[tipe] ${rel}:${n} membandingkan Bias dengan Side langsung — bug #1 Patah Pensill (§21.1).`);
    }
  });
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} pelanggaran arsitektur:`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`✓ check.js lolos — ${files.length} berkas src/ diperiksa, tidak ada pelanggaran.`);
