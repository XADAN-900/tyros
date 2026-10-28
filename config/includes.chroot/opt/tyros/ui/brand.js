/* TyrOS marka katmanı: logo, varsayılan renkler, duvar kağıtları */
'use strict';

const LOGO_URL = 'img/logo.png';
const BRAND_BG = '#0b1220';

/** Duvar kağıtlarındaki amblem artık TyrOS logosu */
function carvedRune(accent, opacity = .9, scale = 1) {
  const size = 400 * scale;
  return `<image href="${LOGO_URL}" x="${800 - size / 2}" y="${350 - size / 2}" width="${size}" height="${size}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet"/>`;
}

WALLPAPERS.tyros = {
  name: 'TyrOS',
  svg: a => `
    <defs>
      <radialGradient id="tyg" cx=".5" cy=".4" r=".85">
        <stop offset="0" stop-color="#1b2a4d"/><stop offset=".55" stop-color="#111a31"/><stop offset="1" stop-color="${BRAND_BG}"/>
      </radialGradient>
      <filter id="tyglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="60"/></filter>
    </defs>
    <rect width="1600" height="1000" fill="url(#tyg)"/>
    ${stars(150, 13, 1000)}
    <g filter="url(#tyglow)" opacity=".45">
      <circle cx="700" cy="360" r="190" fill="#2f86c9"/>
      <circle cx="900" cy="360" r="190" fill="#7a4fc4"/>
    </g>
    ${carvedRune(a, 1, 1)}`,
};
WALLPAPERS.runestone.name = 'Taş';

ACCENTS.unshift({ name: 'TyrOS moru', value: '#8b7cf0' }, { name: 'TyrOS mavisi', value: '#4aa3e0' });
Settings.data.wallpaper = 'tyros';
Settings.data.accent = '#8b7cf0';

BUILTIN.about.launch = async () => {
  const sub = h('div', { class: 'muted' }, '…');
  const root = h('div', { class: 'about' },
    h('img', { src: LOGO_URL, alt: 'TyrOS' }),
    h('h1', {}, 'TyrOS 1.0'),
    h('div', {}, 'HTML, CSS ve JavaScript ile çizilen, Debian GNU/Linux üzerinde çalışan masaüstü.'),
    sub);
  WM.open({ app: BUILTIN.about, width: 480, height: 380, content: root, single: true });
  try { const s = await API.get('/api/sysinfo'); sub.textContent = `${s.os} · Linux ${s.kernel}`; } catch { sub.textContent = ''; }
};
