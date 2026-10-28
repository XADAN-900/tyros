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
    const b = h('button', { class: 'dicon installer' }, appIcon(INSTALLER), h('span', {}, INSTALLER.name));
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
      cmd: 'setsid -f /usr/local/bin/tyros-logout >/dev/null 2>&1' },
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

/* ------------------------------------------------------------ duvar kağıtları
   Derleme sırasında üretilen yüksek çözünürlüklü resimler (tools/wallpapers.py). */
for (const k of Object.keys(WALLPAPERS)) delete WALLPAPERS[k];
[['tyros', 'TyrOS'], ['akis', 'Akış'], ['kuzey', 'Kuzey ışıkları'], ['kum', 'Kum tepeleri'], ['okyanus', 'Okyanus']]
  .forEach(([id, name]) => { WALLPAPERS[id] = { name, img: `img/wall/${id}.jpg` }; });
function wallpaperSVG(id) {
  const w = WALLPAPERS[id] || WALLPAPERS.tyros;
  // SVG içindeki resim Chromium'da kalitesiz küçültülüyordu; CSS arka planı yüksek kaliteli ölçeklenir
  return `<div class="wp-img" style="background-image:url('${w.img}')"></div>`;
}

/* ------------------------------------------------------------ çöp kutusu */
ICONS.trashfull = ICONS.trash + '<path d="M9.5 4.5l1-1.5h3l1 1.5" stroke-opacity=".6"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>';
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;          // kabuk için güvenli tırnak
const TRASH = '~/.local/share/Trash';
const sh = async (cmd, timeout = 120) => {
  const r = await API.post('/api/exec', { cmd, timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'İşlem başarısız').trim());
  return r.stdout;
};
const Trash = {
  count: 0,
  listeners: new Set(),
  changed() { this.refreshCount(); refreshFileWindows(); this.listeners.forEach(fn => fn()); },
  async refreshCount() {
    try { this.count = parseInt(await sh(`ls -A ${TRASH}/files 2>/dev/null | wc -l`), 10) || 0; } catch { this.count = 0; }
    $$('.dicon.trash').forEach(el => { el.querySelector('.ico').replaceWith(appIcon(trashApp())); });
  },
  /** Dosyaları çöpe taşır (orijinal konumu kaydedilir, geri yüklenebilir) */
  async put(paths, silent = false) {
    if (!paths.length) return;
    const hasGio = (await sh('command -v gio >/dev/null && echo var || true')).trim() === 'var';
    if (hasGio) await sh(`gio trash -- ${paths.map(q).join(' ')}`);
    else for (const p of paths) await API.call('/api/fileop', { op: 'trash', path: p }, 'POST');
    if (!silent) notify('Çöpe taşındı', paths.length === 1 ? paths[0].split('/').pop() : `${paths.length} öğe`);
    this.changed();
  },
  async list() {
    const py = `import os, json, urllib.parse
b = os.path.expanduser('~/.local/share/Trash'); out = []
for n in sorted(os.listdir(b + '/files')) if os.path.isdir(b + '/files') else []:
    p = b + '/files/' + n; orig = date = ''
    try:
        for line in open(b + '/info/' + n + '.trashinfo', encoding='utf-8', errors='replace'):
            if line.startswith('Path='): orig = urllib.parse.unquote(line[5:].strip())
            elif line.startswith('DeletionDate='): date = line[13:].strip()
    except OSError: pass
    st = os.lstat(p); out.append(dict(name=n, dir=os.path.isdir(p), size=st.st_size, orig=orig, date=date))
print(json.dumps(out))`;
    return JSON.parse(await sh(`python3 - <<'PY'\n${py}\nPY`));
  },
  async restore(item) {
    if (!item.orig) throw new Error('Bu öğenin eski konumu bilinmiyor. Dosyalar > Çöp klasöründen elle taşıyabilirsin.');
    await sh(`dest=${q(item.orig)}; if [ -e "$dest" ]; then echo "Bu konumda aynı adlı bir öğe zaten var" >&2; exit 1; fi
mkdir -p "$(dirname "$dest")" && mv -- ${TRASH}/files/${q(item.name)} "$dest" && rm -f -- ${TRASH}/info/${q(item.name + '.trashinfo')}`);
    notify('Geri yüklendi', item.orig); this.changed();
  },
  async remove(item) {
    if (item.name.includes('/')) return;
    await sh(`rm -rf -- ${TRASH}/files/${q(item.name)} ${TRASH}/info/${q(item.name + '.trashinfo')}`, 600);
    notify('Kalıcı olarak silindi', item.name); this.changed();
  },
  async empty() {
    await sh(`mkdir -p ${TRASH}/files ${TRASH}/info; find ${TRASH}/files ${TRASH}/info -mindepth 1 -delete`, 600);
    notify('Çöp boşaltıldı'); this.changed();
  },
};
function refreshFileWindows() {
  $$('.win .fm button[title="Yenile"]').forEach(b => b.click());
}
const trashApp = () => ({ id: 'trash', name: 'Çöp', glyph: Trash.count ? 'trashfull' : 'trash', tile: '#3a4250', builtin: true });

/** Sürüklenen öğeyi bir yere bırakılabilir yapar (çöp simgesi, çöp penceresi) */
function makeTrashDrop(el) {
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/tyros-path')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-hover'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drop-hover');
    const paths = (e.dataTransfer.getData('text/tyros-path') || '').split('\n').filter(Boolean);
    if (!paths.length) return;
    e.stopPropagation();
    Trash.put(paths).catch(fail);
  });
}

BUILTIN.trash = {
  id: 'trash', name: 'Çöp', glyph: 'trash', tile: '#3a4250', cats: ['System'], comment: 'Silinen dosyalar', builtin: true,
  launch() {
    const list = h('div', { class: 'tr-list' });
    const info = h('span', { class: 'muted', style: { fontSize: '12.5px', marginLeft: 'auto' } });
    const emptyBtn = h('button', { class: 'btn danger', html: svgIcon('trash') + 'Çöpü boşalt', onclick: async () => {
      if (await tyrosConfirm('Çöpteki her şey kalıcı olarak silinecek. Bu işlem geri alınamaz.', { title: 'Çöp boşaltılsın mı?', ok: 'Boşalt', danger: true })) Trash.empty().catch(fail);
    } });
    const root = h('div', { class: 'tr' }, h('div', { class: 'toolbar' }, emptyBtn, info), list);
    const win = WM.open({ app: BUILTIN.trash, width: 720, height: 480, content: root, single: true });
    makeTrashDrop(root);
    const render = async () => {
      let items = [];
      try { items = await Trash.list(); } catch (e) { list.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
      emptyBtn.disabled = !items.length;
      info.textContent = items.length ? `${items.length} öğe` : '';
      if (!items.length) {
        list.replaceChildren(h('div', { class: 'empty tr-empty' }, h('span', { class: 'ico', html: svgIcon('trash') }), h('div', {}, 'Çöp boş'),
          h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Dosyaları buraya ya da masaüstündeki çöp simgesine sürükleyerek silebilirsin.')));
        return;
      }
      list.replaceChildren(...items.map(it => {
        const when = it.date ? new Date(it.date).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        const row = h('div', { class: 'tr-row' },
          appIcon({ glyph: it.dir ? 'folder' : 'file', tile: it.dir ? '#34586c' : '#3a424d' }),
          h('div', { class: 'tr-info' }, h('div', { class: 'tr-name' }, it.name),
            h('div', { class: 'muted tr-sub' }, [it.orig ? it.orig.replace(/\/[^/]*$/, '') || '/' : 'Konum bilinmiyor', when, it.dir ? '' : fmtBytes(it.size)].filter(Boolean).join(' · '))),
          h('button', { class: 'btn', disabled: !it.orig, title: it.orig ? `${it.orig} konumuna geri taşı` : 'Eski konum bilinmiyor', onclick: () => Trash.restore(it).catch(fail) }, 'Geri yükle'),
          h('button', { class: 'btn danger', onclick: async () => {
            if (await tyrosConfirm(`"${it.name}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`, { title: 'Kalıcı olarak silinsin mi?', ok: 'Sil', danger: true })) Trash.remove(it).catch(fail);
          } }, 'Kalıcı sil'));
        row.addEventListener('contextmenu', e => {
          e.preventDefault();
          Shell.contextMenu(e.clientX, e.clientY, [
            it.orig && ['Geri yükle', () => Trash.restore(it).catch(fail)],
            ['Kalıcı olarak sil', async () => { if (await tyrosConfirm(`"${it.name}" kalıcı olarak silinecek.`, { title: 'Kalıcı olarak silinsin mi?', ok: 'Sil', danger: true })) Trash.remove(it).catch(fail); }],
          ]);
        });
        return row;
      }));
    };
    Trash.listeners.add(render);
    win.onClose = () => { Trash.listeners.delete(render); return true; };
    render();
  },
};

/* Dosyalar penceresindeki öğeler sürüklenebilsin (çöpe atmak için) */
new MutationObserver(() => {
  $$('.fm-item:not([draggable])').forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', e => {
      const dir = el.closest('.fm')?.querySelector('.fm-path')?.value;
      if (!dir) return e.preventDefault();
      e.dataTransfer.setData('text/tyros-path', (dir === '/' ? '' : dir) + '/' + el.title);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
}).observe(document.documentElement, { childList: true, subtree: true });

/* Dosyalar uygulamasındaki "Çöpe taşı" da geri yüklenebilir çöpü kullansın */
const _apiPost = API.post.bind(API);
API.post = function (path, body) {
  if (path === '/api/fileop' && body?.op === 'trash') return Trash.put([body.path], true).then(() => ({ ok: true }));
  return _apiPost(path, body);
};

/* ------------------------------------------------------------ masaüstü: çöp + Masaüstü klasörü */
let DESKTOP_DIR = null, desktopSig = '';
async function desktopFiles() {
  try {
    if (!DESKTOP_DIR) DESKTOP_DIR = ((await API.get('/api/places')).find(p => p.name === 'Masaüstü') || {}).path || null;
    if (!DESKTOP_DIR) return [];
    return (await API.get('/api/files?path=' + encodeURIComponent(DESKTOP_DIR))).items.filter(i => !i.name.startsWith('.') && !i.name.endsWith('.desktop'));
  } catch { return []; }
}

window.addEventListener('DOMContentLoaded', () => {
  const renderDesktop = Shell.renderDesktop.bind(Shell);
  let renderGen = 0;
  Shell.renderDesktop = async function () {
    const gen = ++renderGen;
    renderDesktop();
    const box = $('#desktopIcons');
    const select = b => { $$('.dicon.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
    // Çöp
    const t = h('button', { class: 'dicon trash', title: 'Çöp — dosyaları buraya sürükle' }, appIcon(trashApp()), h('span', {}, 'Çöp'));
    t.addEventListener('click', () => select(t));
    t.addEventListener('dblclick', () => BUILTIN.trash.launch());
    t.addEventListener('keydown', e => e.key === 'Enter' && BUILTIN.trash.launch());
    t.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      this.contextMenu(e.clientX, e.clientY, [['Çöpü aç', () => BUILTIN.trash.launch()], '-',
        ['Çöpü boşalt', async () => { if (await tyrosConfirm('Çöpteki her şey kalıcı olarak silinecek.', { title: 'Çöp boşaltılsın mı?', ok: 'Boşalt', danger: true })) Trash.empty().catch(fail); }]]);
    });
    makeTrashDrop(t);
    // Çöp, "Diske Kur" simgesinin üstünde dursun
    const inst = box.querySelector('.dicon.installer');
    if (inst) box.insertBefore(t, inst); else box.append(t);
    Trash.refreshCount();
    // Masaüstü klasöründeki dosyalar
    const files = await desktopFiles();
    if (gen !== renderGen) return;   // bu arada yeniden çizildiyse çift simge oluşmasın
    desktopSig = JSON.stringify(files.map(f => f.name + f.mtime));
    for (const it of files) {
      const full = DESKTOP_DIR + '/' + it.name;
      const glyph = it.dir ? 'folder' : /\.(png|jpe?g|gif|webp|svg)$/i.test(it.name) ? 'image' : 'file';
      const b = h('button', { class: 'dicon dfile', title: it.name, draggable: 'true' }, appIcon({ glyph, tile: it.dir ? '#34586c' : '#3a424d' }), h('span', {}, it.name));
      const open = () => it.dir ? BUILTIN.files.launch(full) : API.post('/api/open', { path: full }).catch(fail);
      b.addEventListener('click', () => select(b));
      b.addEventListener('dblclick', open);
      b.addEventListener('keydown', e => { if (e.key === 'Enter') open(); if (e.key === 'Delete') Trash.put([full]).catch(fail); });
      b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/tyros-path', full); e.dataTransfer.effectAllowed = 'move'; });
      b.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation(); select(b);
        this.contextMenu(e.clientX, e.clientY, [['Aç', open], '-', ['Çöpe taşı', () => Trash.put([full]).catch(fail)]]);
      });
      box.append(b);
    }
  };
  // Masaüstü klasörü değişirse simgeleri yenile; çöp değişince de
  Trash.listeners.add(() => Shell.renderDesktop());
  setInterval(async () => {
    if (!API.online) return;
    const sig = JSON.stringify((await desktopFiles()).map(f => f.name + f.mtime));
    if (sig !== desktopSig) Shell.renderDesktop();
  }, 4000);
});

/* ------------------------------------------------------------ fareyle çerçeve çizerek seçme
   Masaüstünde ve Dosyalar penceresinde boş bir yerden sürükleyince seçim kutusu çıkar;
   kutunun değdiği simgeler seçilir. Ctrl/Shift ile mevcut seçime eklenir, Ctrl+tık tek tek seçer. */
function startMarquee(e, area, itemSel) {
  const additive = e.ctrlKey || e.shiftKey || e.metaKey;
  const items = $$(itemSel, area === document.body ? document : area.closest('.fm') || document);
  const before = new Set(additive ? items.filter(i => i.classList.contains('sel')) : []);
  const sx = e.clientX, sy = e.clientY;
  const bounds = area.getBoundingClientRect();
  let box = null;
  const move = ev => {
    const x = Math.max(bounds.left, Math.min(bounds.right, ev.clientX)), y = Math.max(bounds.top, Math.min(bounds.bottom, ev.clientY));
    if (!box) {
      if (Math.abs(x - sx) < 4 && Math.abs(y - sy) < 4) return;
      box = h('div', { class: 'ty-marquee' }); document.body.append(box);
    }
    const r = { left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y) };
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.right - r.left + 'px', height: r.bottom - r.top + 'px' });
    for (const it of items) {
      const b = it.getBoundingClientRect();
      const hit = b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      it.classList.toggle('sel', before.has(it) || hit);
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (box) { box.remove(); window.__marqueeJustEnded = true; setTimeout(() => { window.__marqueeJustEnded = false; }, 0); }
    else if (!additive) items.forEach(i => i.classList.remove('sel'));
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  e.preventDefault();
}
document.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const list = e.target.closest('.fm-list');
  if (list) { if (!e.target.closest('.fm-item')) startMarquee(e, list, '.fm-item'); return; }
  if (e.target.closest('#desktop') && !e.target.closest('.dicon, .win')) startMarquee(e, $('#desktop'), '#desktopIcons .dicon');
}, true);

// Ctrl + tık: seçime ekle / çıkar
document.addEventListener('click', e => {
  const icon = e.target.closest?.('.dicon, .fm-item');
  if (!icon || !(e.ctrlKey || e.metaKey)) return;
  icon.classList.toggle('sel'); e.stopPropagation(); e.preventDefault();
}, true);

/** Seçili dosya yolları: Dosyalar penceresi odaktaysa oradakiler, değilse masaüstündekiler */
function selectedPaths(from) {
  const fm = from?.closest?.('.fm');
  if (fm) {
    const dir = fm.querySelector('.fm-path')?.value;
    return dir ? $$('.fm-item.sel', fm).map(i => (dir === '/' ? '' : dir) + '/' + i.title) : [];
  }
  return DESKTOP_DIR ? $$('#desktopIcons .dicon.dfile.sel').map(d => DESKTOP_DIR + '/' + d.title) : [];
}

// Birden çok seçili öğeyi birlikte sürükle
document.addEventListener('dragstart', e => {
  const icon = e.target.closest?.('.dicon.dfile, .fm-item');
  if (!icon || !icon.classList.contains('sel')) return;
  const paths = selectedPaths(icon);
  if (paths.length > 1) e.dataTransfer.setData('text/tyros-path', paths.join('\n'));
});

// Delete: seçili öğelerin hepsini çöpe at
document.addEventListener('keydown', e => {
  if (e.key !== 'Delete' || e.target.closest?.('input, textarea, [contenteditable="true"], .ty-dialog')) return;
  const inFm = document.activeElement?.closest?.('.fm');
  const paths = selectedPaths(inFm || null);
  if (!paths.length) return;
  e.stopPropagation(); e.preventDefault();
  Trash.put(paths).catch(fail);
}, true);
