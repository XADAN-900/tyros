/* TyrOS çekirdek: sistem köprüsü, simgeler, duvar kağıtları, ayarlar */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

function fmtDuration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return [d && `${d} gün`, h && `${h} sa`, `${m} dk`].filter(Boolean).join(' ');
}

/* ------------------------------------------------------------ sistem köprüsü */
const API = {
  online: false,
  async call(path, body, method) {
    const opts = { method: method || (body ? 'POST' : 'GET'), headers: { 'X-TyrOS': '1' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(path, opts); }
    catch { throw new Error('Sistem köprüsüne ulaşılamıyor (tyros-api çalışıyor mu?)'); }
    let data = {};
    try { data = await r.json(); } catch { /* boş yanıt */ }
    if (!r.ok) throw new Error(data.error || `Sistem hatası (${r.status})`);
    return data;
  },
  get(path) { return this.call(path); },
  post(path, body) { return this.call(path, body || {}, 'POST'); },
};

/* ------------------------------------------------------------ bildirimler */
function notify(title, text = '', isErr = false, ms = 4200) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: isErr ? 'alert' : 'status' },
    h('b', {}, title), text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
const fail = e => notify('İşlem tamamlanamadı', e.message || String(e), true);

/* ------------------------------------------------------------ simgeler */
const ICONS = {
  terminal: '<polyline points="5 16 10 11 5 6"/><line x1="12" y1="18" x2="19" y2="18"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  filetext: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16l-5-5-8.5 8.5"/>',
  store: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  monitor: '<polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/>',
  editor: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/>',
  package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 15.9a4.8 4.8 0 0 1 6.6 0"/><circle cx="12" cy="19.2" r=".9" fill="currentColor"/>',
  wired: '<path d="M12 3v5M7 8h10v6H7zM12 14v7M10 8v-2M14 8v-2"/>',
  nonet: '<path d="M2.5 9a14 14 0 0 1 19 0M8.7 15.9a4.8 4.8 0 0 1 6.6 0M3 3l18 18"/>',
  vol: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.3 6.3a8 8 0 0 1 0 11.4"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderplus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 10.5v6M9 13.5h6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M5 4h11l4 4v12H4V4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.6a8 8 0 1 0 11.4 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
};
const svgIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.file}</svg>`;

const RUNE_PATH = 'M24 40 L50 12 L76 40 M50 12 V88';

function hashHue(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }

/** Uygulama simgesi: dahili uygulamalar için çizim, Linux uygulamaları için sistem tema simgesi */
function appIcon(app) {
  const wrap = h('span', { class: 'ico' });
  if (app.glyph) {
    wrap.innerHTML = `<span class="app-tile" style="--tile:${app.tile}">${svgIcon(app.glyph)}</span>`;
    return wrap;
  }
  const letterTile = () => {
    wrap.innerHTML = '';
    const hue = hashHue(app.name || app.id || '?');
    wrap.append(h('span', { class: 'app-tile', style: { '--tile': `hsl(${hue} 22% 30%)` } },
      h('span', { class: 'app-letter' }, (app.name || '?').trim().charAt(0).toUpperCase())));
  };
  if (!app.icon) { letterTile(); return wrap; }
  const img = h('img', { src: `/api/icon?name=${encodeURIComponent(app.icon)}`, alt: '', loading: 'lazy', draggable: 'false' });
  img.onerror = letterTile;
  wrap.append(img);
  return wrap;
}

/* ------------------------------------------------------------ duvar kağıtları */
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

function stars(n, seed, maxY) {
  const r = seeded(seed); let s = '';
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${(r() * 1600).toFixed(0)}" cy="${(r() * maxY).toFixed(0)}" r="${(r() * 1.3 + .3).toFixed(2)}" opacity="${(r() * .6 + .2).toFixed(2)}"/>`;
  }
  return `<g fill="#e9f1f7">${s}</g>`;
}

/** Oyulmuş run: gölge + boya + üst kenar ışığı */
function carvedRune(accent, opacity = .9, scale = 1) {
  const t = `translate(${800 - 260 * scale} ${150}) scale(${5.2 * scale})`;
  return `<g transform="${t}" fill="none" stroke-linecap="butt" stroke-linejoin="miter">
    <path d="${RUNE_PATH}" stroke="#000" stroke-opacity=".45" stroke-width="5.4" transform="translate(.7 .7)"/>
    <path d="${RUNE_PATH}" stroke="${accent}" stroke-opacity="${opacity}" stroke-width="4.4"/>
    <path d="${RUNE_PATH}" stroke="#fff" stroke-opacity=".10" stroke-width=".8" transform="translate(-1.1 -1.1)"/>
  </g>`;
}

const WALLPAPERS = {
  fjord: {
    name: 'Fiyort',
    svg: a => `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0a141d"/><stop offset=".55" stop-color="#18303f"/><stop offset="1" stop-color="#3a5b67"/>
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#20394a"/><stop offset="1" stop-color="#0a141c"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#sky)"/>
      ${stars(170, 7, 520)}
      ${carvedRune(a, .28, .78)}
      <path d="M0 640 L180 560 L300 600 L470 470 L620 590 L760 520 L900 610 L1060 480 L1220 580 L1380 500 L1600 610 V760 H0Z" fill="#2a4350"/>
      <path d="M0 690 L140 620 L330 700 L520 590 L700 690 L880 640 L1040 700 L1250 610 L1450 690 L1600 650 V760 H0Z" fill="#1b2f3a"/>
      <rect y="756" width="1600" height="244" fill="url(#sea)"/>
      <path d="M0 756 H1600" stroke="#5e8290" stroke-opacity=".35"/>
      <g stroke="#7fa3b0" stroke-opacity=".12">${Array.from({ length: 9 }, (_, i) => `<path d="M${200 + i * 150} ${790 + i * 20} h${120 - i * 6}"/>`).join('')}</g>`,
  },
  runestone: {
    name: 'Run taşı',
    svg: a => `
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="4"/>
          <feColorMatrix values="0 0 0 0 .5  0 0 0 0 .52  0 0 0 0 .55  0 0 0 .35 0"/>
          <feComposite in2="SourceGraphic" operator="in"/>
        </filter>
        <radialGradient id="lit" cx=".45" cy=".35" r=".85">
          <stop offset="0" stop-color="#4a525c"/><stop offset="1" stop-color="#1d2228"/>
        </radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#lit)"/>
      <rect width="1600" height="1000" fill="#fff" filter="url(#grain)"/>
      <g fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2">
        <path d="M140 0 C 260 300, 120 620, 300 1000"/><path d="M1460 0 C 1340 380, 1500 640, 1320 1000"/>
      </g>
      ${carvedRune(a, .92, 1)}`,
  },
  aurora: {
    name: 'Kuzey ışığı',
    svg: a => `
      <defs>
        <linearGradient id="nsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#050b12"/><stop offset="1" stop-color="#0e2028"/>
        </linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="38"/></filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#nsky)"/>
      ${stars(220, 21, 900)}
      <g filter="url(#blur)" fill="none" stroke-linecap="round">
        <path d="M-100 380 C 300 160, 700 520, 1000 300 S 1500 180, 1750 340" stroke="#3fd6a0" stroke-width="70" opacity=".45"/>
        <path d="M-100 470 C 400 300, 800 600, 1150 420 S 1600 330, 1750 450" stroke="#2fa9c9" stroke-width="50" opacity=".35"/>
        <path d="M200 280 C 600 120, 900 360, 1400 200" stroke="#9b7fe0" stroke-width="40" opacity=".22"/>
      </g>
      ${carvedRune(a, .24, .7)}
      <path d="M0 860 L220 800 L420 850 L640 780 L860 840 L1100 790 L1350 850 L1600 800 V1000 H0Z" fill="#060c11"/>`,
  },
  ember: {
    name: 'Kor',
    svg: a => `
      <defs>
        <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1a1424"/><stop offset=".55" stop-color="#4a2a36"/><stop offset=".8" stop-color="#a8553c"/><stop offset="1" stop-color="#d98a4e"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#dusk)"/>
      ${stars(80, 3, 380)}
      ${carvedRune(a, .3, .8)}
      <path d="M0 720 L200 640 L380 700 L560 600 L760 690 L960 620 L1160 700 L1380 610 L1600 690 V1000 H0Z" fill="#2b1820"/>
      <path d="M0 820 L260 760 L520 820 L800 750 L1080 830 L1340 770 L1600 820 V1000 H0Z" fill="#160c11"/>`,
  },
};

function wallpaperSVG(id, accent) {
  const w = WALLPAPERS[id] || WALLPAPERS.fjord;
  return `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${w.svg(accent)}</svg>`;
}

const ACCENTS = [
  { name: 'Pirinç', value: '#d6b25e' },
  { name: 'Buz', value: '#8fd0ee' },
  { name: 'Aşı boyası', value: '#d0694f' },
  { name: 'Yosun', value: '#93bf7a' },
  { name: 'Ametist', value: '#b49ae6' },
];

/* ------------------------------------------------------------ ayarlar */
const Settings = {
  data: { wallpaper: 'fjord', accent: '#d6b25e', pinned: ['files', 'terminal', 'store', 'monitor', 'settings'] },
  async load() {
    try { Object.assign(this.data, await API.get('/api/settings')); } catch { /* varsayılanlar */ }
    this.apply();
  },
  async set(patch) {
    Object.assign(this.data, patch);
    this.apply();
    try { await API.post('/api/settings', patch); } catch (e) { fail(e); }
  },
  apply() {
    const a = this.data.accent;
    document.documentElement.style.setProperty('--accent', a);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    document.documentElement.style.setProperty('--accent-ink', lum > .55 ? '#161208' : '#fff');
    const wp = $('#wallpaper');
    if (wp) wp.innerHTML = wallpaperSVG(this.data.wallpaper, a);
  },
};
