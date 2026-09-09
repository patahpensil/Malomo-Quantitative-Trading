// @ts-check
/**
 * Pengambil berita untuk GitHub Actions (§16, §N-R1).
 *
 * Berjalan di server Actions — TIDAK ada masalah CORS di sini (itu batasan
 * browser). Mengambil beberapa RSS kripto, memadukan, lalu menulis
 * data/news.json yang di-commit workflow. Browser cukup membaca berkas statis
 * itu; tak pernah menembak RSS langsung (yang akan diblokir CORS).
 *
 * Tanpa dependensi: fetch global Node 20 + parser RSS regex sederhana. Bila
 * satu feed gagal, feed lain tetap jalan. Judul disalin apa adanya (§N-UI1) —
 * TIDAK diringkas, TIDAK diberi skor arah.
 *
 * Jalankan: node scripts/fetch-news.js
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'news.json');

/** Feed RSS kripto yang stabil & bereputasi. */
const FEEDS = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
  { source: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
];

const MAX_ITEMS = 60;
const MAX_PER_FEED = 20;

/** @param {string} tag @param {string} block */
function pick(tag, block) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}

/** @param {string} s */
function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/<[^>]+>/g, '').trim();
}

/** @param {string} xml @param {string} source */
function parseFeed(xml, source) {
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < MAX_PER_FEED) {
    const block = m[0];
    const title = pick('title', block);
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim()
      || (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1]?.trim() || '';
    const pub = pick('pubDate', block) || pick('dc:date', block);
    if (!title) continue;
    const ts = pub ? Date.parse(pub) : Date.now();
    items.push({ title, source, link, pubDate: Number.isNaN(ts) ? Date.now() : ts });
  }
  return items;
}

async function main() {
  /** @type {{title:string,source:string,link:string,pubDate:number}[]} */
  let all = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { 'user-agent': 'malomo-qt-news/0.1' } });
      if (!res.ok) { console.warn(`  ! ${feed.source} HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const items = parseFeed(xml, feed.source);
      console.log(`  ✓ ${feed.source}: ${items.length} item`);
      all = all.concat(items);
    } catch (e) {
      console.warn(`  ! ${feed.source} gagal: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Dedup berdasarkan judul, urut terbaru, batasi.
  const seen = new Set();
  const deduped = all.filter((a) => {
    const key = a.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.pubDate - a.pubDate).slice(0, MAX_ITEMS);

  const payload = {
    _note: 'Dihasilkan otomatis oleh scripts/fetch-news.js via GitHub Actions. Jangan sunting tangan.',
    generatedAt: Date.now(),
    articles: deduped,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\n✓ ${deduped.length} artikel ditulis ke data/news.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
