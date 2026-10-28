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

/* ------------------------------------------------------------ diske kurulum */
ICONS.install = '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>';
const INSTALLER = {
  id: 'tyros-install.desktop', name: "TyrOS'u Diske Kur", glyph: 'install',
  tile: 'linear-gradient(135deg, #2f86c9, #7a4fc4)', comment: "TyrOS'u bilgisayarına kalıcı olarak kur",
};
let TYROS_LIVE = null;   // null: henüz bilinmiyor
async function checkLive() {
  if (TYROS_LIVE !== null) return TYROS_LIVE;
  try {
    const r = await API.post('/api/exec', { cmd: 'test -d /run/live/medium && echo canli' });
    TYROS_LIVE = r.stdout.trim() === 'canli';
  } catch { TYROS_LIVE = false; }
  return TYROS_LIVE;
}

/* ------------------------------------------------------------ yedek terminal
   ttyd çalışmıyorsa kullanılır. Uzun komutlar (ör. sudo apt update) için 10 dakika
   bekler ve komut sürerken bunu ekranda gösterir. */
function simpleTerminal(box, win, startCwd) {
  let cwd = startCwd || '~';
  const hist = []; let hi = 0;
  const out = h('div');
  const prompt = h('span', { class: 'prompt' });
  const input = h('input', { spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Komut' });
  const busy = h('pre', { class: 'muted', hidden: true }, 'Komut çalışıyor…');
  const term = h('div', { class: 'term', onclick: () => input.focus() },
    out, busy, h('div', { class: 'term-line' }, prompt, input));
  box.append(term);
  const setPrompt = () => { prompt.textContent = `${cwd.replace(/^\/home\/[^/]+/, '~')} $`; };
  setPrompt();
  setTimeout(() => input.focus(), 50);
  input.addEventListener('keydown', async e => {
    if (e.key === 'ArrowUp') { if (hi > 0) input.value = hist[--hi]; e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { input.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, ''); e.preventDefault(); return; }
    if (e.key === 'l' && e.ctrlKey) { out.innerHTML = ''; e.preventDefault(); return; }
    if (e.key !== 'Enter' || input.disabled) return;
    const cmd = input.value; input.value = '';
    out.append(h('pre', {}, h('span', { class: 'prompt' }, prompt.textContent + ' '), cmd));
    if (!cmd.trim()) return;
    hist.push(cmd); hi = hist.length;
    if (cmd.trim() === 'clear') { out.innerHTML = ''; return; }
    input.disabled = true; busy.hidden = false; term.scrollTop = term.scrollHeight;
    try {
      const marker = '__TYROS_CWD__';
      const r = await API.post('/api/exec', { cwd, timeout: 600, cmd: `${cmd}\n__rc=$?; printf '\\n${marker}%s' "$PWD"; exit $__rc` });
      let stdout = r.stdout;
      const i = stdout.lastIndexOf(marker);
      if (i >= 0) { cwd = stdout.slice(i + marker.length).trim(); stdout = stdout.slice(0, i).replace(/\n$/, ''); }
      if (stdout) out.append(h('pre', {}, stdout));
      if (r.stderr) out.append(h('pre', { class: 'err' }, r.stderr.replace(/\n$/, '')));
    } catch (err) { out.append(h('pre', { class: 'err' }, err.message)); }
    busy.hidden = true; input.disabled = false; setPrompt(); input.focus();
    term.scrollTop = term.scrollHeight;
  });
}

/* ------------------------------------------------------------ kabuk ayarları
   shell.js'den sonra, açılıştan hemen önce uygulanır. */
window.addEventListener('DOMContentLoaded', () => {
  // Uygulama açılırken "Açılıyor" bildirimi gösterme; sadece hata olursa bildir
  Shell.launch = function (app, arg) {
    this.closePopups();
    if (app.builtin) return app.launch(arg);
    if (app.id === INSTALLER.id) notify('Kurulum sihirbazı açılıyor', 'Birkaç saniye sürebilir.', false, 3000);
    API.post('/api/launch', { id: app.id }).catch(fail);
  };

  // Kurulum aracı sadece canlı (USB) oturumda görünsün
  const loadApps = Shell.loadApps.bind(Shell);
  Shell.loadApps = async function (force) {
    await loadApps(force);
    if (!(await checkLive())) {
      this.native = this.native.filter(a => a.id !== INSTALLER.id);
      this.renderMenu();
    }
  };

  // Canlı oturumda masaüstüne "TyrOS'u Diske Kur" simgesi
  const renderDesktop = Shell.renderDesktop.bind(Shell);
  Shell.renderDesktop = function () {
    renderDesktop();
    if (!TYROS_LIVE) return;
    const b = h('button', { class: 'dicon' }, appIcon(INSTALLER), h('span', {}, INSTALLER.name));
    b.addEventListener('click', () => { $$('.dicon.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
    b.addEventListener('dblclick', () => this.launch(INSTALLER));
    b.addEventListener('keydown', e => e.key === 'Enter' && this.launch(INSTALLER));
    $('#desktopIcons').append(b);
  };
});

/* ------------------------------------------------------------ TyrOS onay kutusu
   Tarayıcının beyaz "127.0.0.1 says" kutusu yerine TyrOS temalı pencere. */
function tyrosConfirm(message, { title = 'Emin misin?', ok = 'Tamam', cancel = 'Vazgeç', danger = false } = {}) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const done = v => { overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 140); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
    const okBtn = h('button', { class: 'btn ' + (danger ? 'danger-solid' : 'primary'), onclick: () => done(true) }, ok);
    const box = h('div', { class: 'ty-dialog', role: 'alertdialog', 'aria-modal': 'true' },
      h('img', { src: LOGO_URL, alt: '' }),
      h('div', { class: 'ty-dialog-title' }, title),
      h('div', { class: 'ty-dialog-msg' }, message),
      h('div', { class: 'ty-dialog-btns' }, h('button', { class: 'btn', onclick: () => done(false) }, cancel), okBtn));
    const overlay = h('div', { class: 'ty-overlay', onclick: e => { if (e.target === overlay) done(false); } }, box);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } if (e.key === 'Enter') { e.stopPropagation(); done(true); } };
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    setTimeout(() => okBtn.focus(), 30);
  });
}

/* Kapatma / yeniden başlatma sırasında logolu tam ekran */
function powerScreen(text) {
  document.body.append(h('div', { class: 'ty-power' }, h('img', { src: LOGO_URL, alt: '' }), h('div', {}, text)));
}

let __confirmRetry = null;
window.confirm = message => {
  const retry = __confirmRetry;
  tyrosConfirm(message, { title: 'Kaydedilmemiş değişiklikler', ok: 'Kaydetmeden kapat', danger: true })
    .then(yes => { if (yes && retry) retry(); });
  return false;
};

window.addEventListener('DOMContentLoaded', () => {
  // Pencere kapatırken sorulan sorular da TyrOS kutusuyla
  const close = WM.close.bind(WM);
  WM.close = function (id) {
    const w = this.wins.get(id);
    __confirmRetry = () => { if (w) w.onClose = null; close(id); };
    try { return close(id); } finally { __confirmRetry = null; }
  };

  // Kapat / yeniden başlat / oturumu kapat
  const POWER = {
    shutdown: { title: 'Bilgisayar kapatılsın mı?', msg: 'Açık uygulamalar kapanacak.', ok: 'Kapat', screen: 'Kapatılıyor…',
      cmd: 'systemctl poweroff -i || sudo -n systemctl poweroff' },
    reboot: { title: 'Yeniden başlatılsın mı?', msg: 'Açık uygulamalar kapanacak.', ok: 'Yeniden başlat', screen: 'Yeniden başlatılıyor…',
      cmd: 'systemctl reboot -i || sudo -n systemctl reboot' },
    logout: { title: 'Oturum kapatılsın mı?', msg: 'Açık uygulamalar kapanacak.', ok: 'Oturumu kapat', screen: 'Oturum kapatılıyor…',
      cmd: 'openbox --exit' },
  };
  Shell.power = async function (action) {
    const p = POWER[action];
    if (!p) return;
    this.closePopups();
    if (!(await tyrosConfirm(p.msg, { title: p.title, ok: p.ok, danger: action !== 'logout' }))) return;
    powerScreen(p.screen);
    try {
      const r = await API.post('/api/exec', { cmd: `(sleep 1; ${p.cmd}) >/tmp/tyros-power.log 2>&1 &` });
      if (r.code !== 0) throw new Error(r.stderr || 'İşlem başlatılamadı');
    } catch (e) { $('.ty-power')?.remove(); fail(e); }
  };
});

/* ------------------------------------------------------------ sağ tık
   Chromium'un kendi (Google) sağ tık menüsü hiçbir yerde çıkmasın.
   Yazı alanlarında ve seçili metinde TyrOS'un kendi menüsü açılır. */
window.addEventListener('contextmenu', e => {
  if (e.defaultPrevented) return;          // uygulama kendi menüsünü açtı
  e.preventDefault();
  const field = e.target.closest?.('input:not([type=range]):not([type=checkbox]), textarea, [contenteditable="true"]');
  const selected = String(window.getSelection?.() || '');
  if (!field && !selected) return;
  const focusBack = () => field?.focus();
  const items = [];
  if (field) items.push(['Kes', () => { focusBack(); document.execCommand('cut'); }]);
  items.push(['Kopyala', () => { focusBack(); document.execCommand('copy'); }]);
  if (field) {
    items.push(['Yapıştır', async () => {
      focusBack();
      try { document.execCommand('insertText', false, await navigator.clipboard.readText()); } catch { /* pano boş */ }
    }]);
    items.push('-', ['Tümünü seç', () => { focusBack(); field.select ? field.select() : document.execCommand('selectAll'); }]);
  }
  Shell.contextMenu(e.clientX, e.clientY, items);
});

// Terminal gibi pencere içi sayfalarda da tarayıcı menüsünü kapat
document.addEventListener('load', e => {
  if (e.target.tagName !== 'IFRAME') return;
  try { e.target.contentWindow.addEventListener('contextmenu', ev => ev.preventDefault()); } catch { /* başka kaynak */ }
}, true);
