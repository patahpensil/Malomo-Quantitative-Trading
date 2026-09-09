// @ts-check
/**
 * Modul berita (§16). Berita TIDAK menyentuh skor (§16.1) — hanya konteks.
 *  N-R1 jalur utama: news.json dari GitHub Actions. Aplikasi tetap jalan bila mati.
 *  N-R2 dilarang proxy CORS publik.
 *  N-UI1 tampilkan judul apa adanya + sumber + waktu; TIDAK meringkas.
 *  N-UI2 tidak pernah menampilkan skor/arah/bullish-bearish.
 */

import { el } from './render.js';

/**
 * Muat berita dari news.json (di-commit oleh Actions). Fallback: array kosong.
 * @returns {Promise<{title:string, source:string, link:string, pubDate:number}[]>}
 */
export async function loadNews() {
  try {
    const res = await fetch('./data/news.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.articles || []).map((a) => ({
      title: a.title,
      source: a.source || 'sumber',
      link: a.link || '#',
      pubDate: typeof a.pubDate === 'number' ? a.pubDate : Date.parse(a.pubDate) || Date.now(),
    }));
  } catch { return []; }
}

/**
 * Muat kalender ekonomi statis (§N-R4).
 * @returns {Promise<{when:number, title:string, importance:string}[]>}
 */
export async function loadCalendar() {
  try {
    const res = await fetch('./data/calendar.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.events || []).map((e) => ({ when: Date.parse(e.date), title: e.title, importance: e.importance || 'med' }))
      .filter((e) => !Number.isNaN(e.when));
  } catch { return []; }
}

/** @param {number} ts */
function ago(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

/** @param {number} ts */
function untilStr(ts) {
  const d = ts - Date.now();
  if (d < 0) return 'berlangsung';
  const h = Math.floor(d / 3600000);
  if (h < 1) return `${Math.floor(d / 60000)} menit lagi`;
  if (h < 24) return `${h} jam lagi`;
  return `${Math.floor(h / 24)} hari lagi`;
}

/**
 * Render tab berita.
 * @param {HTMLElement} root
 */
export async function renderNews(root) {
  root.innerHTML = '';
  root.append(el('div', { class: 'view-head' }, [el('h2', { text: 'Berita' })]));

  const [news, cal] = await Promise.all([loadNews(), loadCalendar()]);

  // Kalender dulu — informasi paling berguna (§N-UI5)
  const upcoming = cal.filter((e) => e.when > Date.now() - 3600000).sort((a, b) => a.when - b.when).slice(0, 6);
  if (upcoming.length) {
    root.append(el('div', { class: 'fam-title', text: 'Kalender ekonomi' }));
    for (const e of upcoming) {
      root.append(el('div', { class: 'cal-item' }, [
        el('span', { class: 'when', text: untilStr(e.when) }),
        el('span', { class: 'what', text: e.title }),
      ]));
    }
  }

  root.append(el('div', { class: 'fam-title', text: 'Aliran berita', style: 'margin-top:16px' }));
  if (!news.length) {
    root.append(el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: 'Belum ada berita' }),
      el('div', { class: 'sm', text: 'Sumber berita tidak termuat. Coba lagi nanti, atau periksa koneksi.' }),
    ]));
    return;
  }
  news.sort((a, b) => b.pubDate - a.pubDate);
  for (const a of news.slice(0, 40)) {
    root.append(el('a', { class: 'news-item', href: a.link, target: '_blank', rel: 'noopener', style: 'display:block' }, [
      el('div', { class: 't', text: a.title }), // apa adanya, tidak diringkas (§N-UI1)
      el('div', { class: 'm', text: `${a.source} · ${ago(a.pubDate)}` }),
    ]));
  }
}
