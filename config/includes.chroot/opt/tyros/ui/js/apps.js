/* TyrOS dahili uygulamaları */
'use strict';

const BUILTIN = {
  files:    { id: 'files',    name: 'Dosyalar',          glyph: 'folder',   tile: '#34586c', cats: ['System'],  comment: 'Klasörlerine ve dosyalarına göz at' },
  terminal: { id: 'terminal', name: 'Terminal',          glyph: 'terminal', tile: '#2a3139', cats: ['System'],  comment: 'Linux komut satırı' },
  store:    { id: 'store',    name: 'Uygulama Mağazası', glyph: 'store',    tile: '#6e5b2c', cats: ['System'],  comment: 'Debian deposundan uygulama kur' },
  monitor:  { id: 'monitor',  name: 'Sistem İzleyici',   glyph: 'monitor',  tile: '#3b5b45', cats: ['System'],  comment: 'İşlemci, bellek ve çalışan programlar' },
  editor:   { id: 'editor',   name: 'Metin Düzenleyici', glyph: 'editor',   tile: '#57405e', cats: ['Utility'], comment: 'Metin ve kod dosyalarını düzenle' },
  settings: { id: 'settings', name: 'Ayarlar',           glyph: 'settings', tile: '#46505c', cats: ['Settings'], comment: 'Görünüm, ağ, ses ve sistem' },
  about:    { id: 'about',    name: 'TyrOS Hakkında',    glyph: 'info',     tile: '#2e3d50', cats: ['System'],  comment: 'Sürüm ve sistem bilgisi' },
};
Object.values(BUILTIN).forEach(a => { a.builtin = true; });

/** Pencere içinde küçük metin sorusu (prompt yerine) */
function askText(win, label, value = '', okLabel = 'Tamam') {
  return new Promise(resolve => {
    const input = h('input', { class: 'field', value, style: { width: '100%' } });
    const done = v => { overlay.remove(); resolve(v); };
    const overlay = h('div', { style: { position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(10,14,18,.55)', display: 'grid', placeItems: 'center' } },
      h('div', { style: { background: 'var(--stone-2)', border: '1px solid var(--iron)', borderRadius: '8px', padding: '16px', width: 'min(360px,90%)', display: 'grid', gap: '12px' } },
        h('div', {}, label), input,
        h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: () => done(null) }, 'Vazgeç'),
          h('button', { class: 'btn primary', onclick: () => done(input.value.trim()) }, okLabel))));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value.trim()); if (e.key === 'Escape') done(null); });
    win.body.append(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ================================================================ TERMİNAL */
BUILTIN.terminal.launch = async (cwd) => {
  const box = h('div', { style: { height: '100%', background: '#0d1116' } });
  const win = WM.open({ app: BUILTIN.terminal, width: 800, height: 480, content: box });
  let realTerm = false;
  try { realTerm = (await fetch('/term/', { method: 'HEAD' })).ok; } catch { /* ttyd yok */ }
  if (realTerm && !cwd) {
    const fr = h('iframe', { src: '/term/', title: 'Terminal' });
    fr.addEventListener('load', () => fr.contentWindow?.focus());
    box.append(fr);
  } else {
    simpleTerminal(box, win, cwd);
  }
};

/** ttyd yoksa: komut başına çalışan basit terminal */
function simpleTerminal(box, win, startCwd) {
  let cwd = startCwd || '~';
  const hist = []; let hi = 0;
  const out = h('div');
  const prompt = h('span', { class: 'prompt' });
  const input = h('input', { spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Komut' });
  const term = h('div', { class: 'term', onclick: () => input.focus() },
    h('pre', { class: 'muted' }, 'TyrOS basit terminal. Etkileşimli programlar (nano, htop) için ttyd paketini kur.\n'),
    out, h('div', { class: 'term-line' }, prompt, input));
  box.append(term);
  const setPrompt = () => { prompt.textContent = `${cwd.replace(/^\/home\/[^/]+/, '~')} $`; };
  setPrompt();
  setTimeout(() => input.focus(), 50);

  input.addEventListener('keydown', async e => {
    if (e.key === 'ArrowUp') { if (hi > 0) input.value = hist[--hi]; e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { input.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, ''); e.preventDefault(); return; }
    if (e.key === 'l' && e.ctrlKey) { out.innerHTML = ''; e.preventDefault(); return; }
    if (e.key !== 'Enter') return;
    const cmd = input.value; input.value = '';
    out.append(h('pre', {}, h('span', { class: 'prompt' }, prompt.textContent + ' '), cmd));
    if (!cmd.trim()) return;
    hist.push(cmd); hi = hist.length;
    if (cmd.trim() === 'clear') { out.innerHTML = ''; return; }
    input.disabled = true;
    try {
      const marker = '__TYROS_CWD__';
      const r = await API.post('/api/exec', { cwd, cmd: `${cmd}\n__rc=$?; printf '\\n${marker}%s' "$PWD"; exit $__rc` });
      let stdout = r.stdout;
      const i = stdout.lastIndexOf(marker);
      if (i >= 0) { cwd = stdout.slice(i + marker.length).trim(); stdout = stdout.slice(0, i).replace(/\n$/, ''); }
      if (stdout) out.append(h('pre', {}, stdout));
      if (r.stderr) out.append(h('pre', { class: 'err' }, r.stderr.replace(/\n$/, '')));
    } catch (err) { out.append(h('pre', { class: 'err' }, err.message)); }
    input.disabled = false; setPrompt(); input.focus();
    term.scrollTop = term.scrollHeight;
  });
}

/* ================================================================ DOSYALAR */
const TEXT_EXT = /\.(txt|md|json|js|ts|py|sh|c|h|cpp|rs|go|java|html|css|xml|ya?ml|toml|ini|conf|cfg|log|csv|desktop|service|list)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

BUILTIN.files.launch = async (startPath) => {
  const st = { path: startPath || '', back: [], hidden: false, sel: null, items: [] };
  const side = h('nav', { class: 'fm-side' });
  const pathInput = h('input', { class: 'field fm-path', spellcheck: 'false', 'aria-label': 'Konum' });
  const list = h('div', { class: 'fm-list', tabindex: '0' });
  const status = h('div', { class: 'fm-status' });
  const tb = (icon, title, fn) => h('button', { class: 'btn icon', title, 'aria-label': title, html: svgIcon(icon), onclick: fn });
  const hiddenBtn = tb('eye', 'Gizli dosyaları göster', () => { st.hidden = !st.hidden; hiddenBtn.classList.toggle('primary', st.hidden); render(); });

  const root = h('div', { class: 'fm' }, side,
    h('div', { class: 'fm-main' },
      h('div', { class: 'toolbar' },
        tb('back', 'Geri', () => st.back.length && go(st.back.pop(), false)),
        tb('up', 'Üst klasör', () => st.parent && go(st.parent)),
        tb('refresh', 'Yenile', () => go(st.path, false)),
        pathInput,
        tb('folderplus', 'Yeni klasör', () => create('mkdir')),
        tb('plus', 'Yeni dosya', () => create('touch')),
        hiddenBtn),
      list, status));
  const win = WM.open({ app: BUILTIN.files, width: 860, height: 540, content: root });

  try {
    const places = await API.get('/api/places');
    places.forEach(p => side.append(h('button', { 'data-path': p.path, onclick: () => go(p.path) }, p.name)));
  } catch (e) { fail(e); }

  pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(pathInput.value); });

  async function go(path, pushHistory = true) {
    try {
      const r = await API.get('/api/files?path=' + encodeURIComponent(path));
      if (pushHistory && st.path && st.path !== r.path) st.back.push(st.path);
      Object.assign(st, { path: r.path, parent: r.parent, items: r.items, sel: null });
      pathInput.value = r.path;
      win.setTitle(`${r.path.split('/').pop() || '/'} — Dosyalar`);
      $$('button', side).forEach(b => b.classList.toggle('on', b.dataset.path === r.path));
      render();
    } catch (e) { fail(e); }
  }

  function render() {
    list.innerHTML = '';
    const items = st.items.filter(i => st.hidden || !i.name.startsWith('.'));
    if (!items.length) list.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'Bu klasör boş. Sağ tıklayarak yeni dosya ya da klasör oluşturabilirsin.'));
    for (const it of items) {
      const glyph = it.dir ? 'folder' : IMG_EXT.test(it.name) ? 'image' : (TEXT_EXT.test(it.name) || (it.mime || '').startsWith('text/')) ? 'filetext' : 'file';
      const tile = it.dir ? '#34586c' : glyph === 'image' ? '#4f5a3a' : '#3a424d';
      const el = h('button', { class: 'fm-item', title: it.name },
        appIcon({ glyph, tile }), h('span', {}, it.name));
      el.addEventListener('click', () => select(it, el));
      el.addEventListener('dblclick', () => openItem(it));
      el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); select(it, el); itemMenu(e, it); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') openItem(it); if (e.key === 'Delete') trash(it); if (e.key === 'F2') rename(it); });
      list.append(el);
    }
    const dirs = items.filter(i => i.dir).length;
    status.textContent = `${dirs} klasör, ${items.length - dirs} dosya`;
  }

  function select(it, el) {
    $$('.fm-item.sel', list).forEach(x => x.classList.remove('sel'));
    el.classList.add('sel'); st.sel = it;
    status.textContent = it.dir ? it.name : `${it.name} · ${fmtBytes(it.size)} · ${new Date(it.mtime * 1000).toLocaleString('tr-TR')}`;
  }

  const full = it => (st.path === '/' ? '' : st.path) + '/' + it.name;

  function openItem(it) {
    if (it.dir) return go(full(it));
    if (TEXT_EXT.test(it.name) || ((it.mime || '').startsWith('text/') && it.size < 4e6) || (!it.mime && it.size < 256e3 && !/\./.test(it.name))) {
      return BUILTIN.editor.launch(full(it));
    }
    API.post('/api/open', { path: full(it) }).catch(fail);
  }

  async function create(op) {
    const name = await askText(win, op === 'mkdir' ? 'Yeni klasörün adı' : 'Yeni dosyanın adı', op === 'mkdir' ? 'Yeni klasör' : 'yeni.txt', 'Oluştur');
    if (!name) return;
    try { await API.post('/api/fileop', { op, path: st.path + '/' + name }); go(st.path, false); } catch (e) { fail(e); }
  }
  async function rename(it) {
    const name = await askText(win, 'Yeni ad', it.name, 'Yeniden adlandır');
    if (!name || name === it.name) return;
    try { await API.post('/api/fileop', { op: 'rename', path: full(it), name }); go(st.path, false); } catch (e) { fail(e); }
  }
  async function trash(it) {
    try { await API.post('/api/fileop', { op: 'trash', path: full(it) }); notify('Çöpe taşındı', it.name); go(st.path, false); } catch (e) { fail(e); }
  }

  function itemMenu(e, it) {
    Shell.contextMenu(e.clientX, e.clientY, [
      ['Aç', () => openItem(it)],
      !it.dir && ['Sistem uygulamasıyla aç', () => API.post('/api/open', { path: full(it) }).catch(fail)],
      !it.dir && ['Metin düzenleyicide aç', () => BUILTIN.editor.launch(full(it))],
      it.dir && ['Burada terminal aç', () => BUILTIN.terminal.launch(full(it))],
      '-',
      ['Yeniden adlandır', () => rename(it)],
      ['Çöpe taşı', () => trash(it)],
    ]);
  }
  list.addEventListener('contextmenu', e => {
    e.preventDefault();
    Shell.contextMenu(e.clientX, e.clientY, [
      ['Yeni klasör', () => create('mkdir')],
      ['Yeni dosya', () => create('touch')],
      '-',
      ['Burada terminal aç', () => BUILTIN.terminal.launch(st.path)],
      ['Yenile', () => go(st.path, false)],
    ]);
  });

  go(st.path);
};

/* ================================================================ METİN DÜZENLEYİCİ */
BUILTIN.editor.launch = async (path) => {
  let file = path || null, dirty = false;
  const ta = h('textarea', { spellcheck: 'false', 'aria-label': 'Metin' });
  const name = () => (file ? file.split('/').pop() : 'Adsız');
  const saveBtn = h('button', { class: 'btn primary', html: svgIcon('save') + 'Kaydet', onclick: () => save() });
  const info = h('span', { class: 'muted', style: { fontSize: '12.5px', marginLeft: 'auto' } });
  const root = h('div', { class: 'ed' }, h('div', { class: 'toolbar' }, saveBtn,
    h('button', { class: 'btn', onclick: () => save(true) }, 'Farklı kaydet'), info), ta);
  const win = WM.open({ app: BUILTIN.editor, width: 760, height: 520, content: root });
  const refresh = () => { win.setTitle(`${dirty ? '• ' : ''}${name()} — Metin Düzenleyici`); info.textContent = file || 'Kaydedilmemiş belge'; };

  if (file) {
    try { ta.value = (await API.get('/api/file?path=' + encodeURIComponent(file))).content; }
    catch (e) { fail(e); WM.close(win.id); return; }
  }
  refresh();
  ta.focus();
  ta.addEventListener('input', () => { if (!dirty) { dirty = true; refresh(); } });
  ta.addEventListener('keydown', e => {
    if (e.key === 's' && e.ctrlKey) { e.preventDefault(); save(); }
    if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); }
  });
  win.onClose = () => !dirty || confirm(`"${name()}" kaydedilmedi. Yine de kapatılsın mı?`);

  async function save(asNew) {
    if (!file || asNew) {
      const p = await askText(win, 'Dosyanın kaydedileceği yol', file || '~/Belgeler/' + name() + (file ? '' : '.txt'), 'Kaydet');
      if (!p) return;
      file = p;
    }
    try {
      const r = await API.post('/api/file', { path: file, content: ta.value });
      file = r.path; dirty = false; refresh();
      notify('Kaydedildi', file);
    } catch (e) { fail(e); }
  }
};

/* ================================================================ SİSTEM İZLEYİCİ */
BUILTIN.monitor.launch = () => {
  const card = (label) => {
    const v = h('div', { class: 'v' }, '—');
    const sub = h('div', { class: 'muted', style: { fontSize: '12px' } });
    const bar = h('div', { class: 'bar' }, h('i', { style: { width: '0%' } }));
    const el = h('div', { class: 'mon-card' }, h('div', { class: 'muted', style: { fontSize: '12.5px' } }, label), v, bar, sub);
    return { el, v, sub, bar: bar.firstChild };
  };
  const cpu = card('İşlemci'), mem = card('Bellek'), disk = card('Disk (/)'), up = card('Açık kalma süresi');
  const canvas = h('canvas', { width: 300, height: 36 });
  cpu.el.insertBefore(canvas, cpu.bar.parentNode);
  cpu.bar.parentNode.remove();
  up.bar.parentNode.remove();
  const tbody = h('tbody');
  const root = h('div', { class: 'mon' },
    h('div', { class: 'mon-cards' }, cpu.el, mem.el, disk.el, up.el),
    h('div', { class: 'mon-table' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ...['Program', 'PID', 'Kullanıcı', 'İşlemci %', 'Bellek', ''].map(t => h('th', {}, t)))), tbody)));
  const win = WM.open({ app: BUILTIN.monitor, width: 820, height: 560, content: root, single: true });
  const history = [];
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  function draw() {
    const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    if (history.length < 2) return;
    c.beginPath();
    history.forEach((p, i) => { const x = i / 59 * W, y = H - p / 100 * (H - 2) - 1; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = accent(); c.lineWidth = 1.6; c.stroke();
    c.lineTo((history.length - 1) / 59 * W, H); c.lineTo(0, H); c.closePath();
    c.globalAlpha = .15; c.fillStyle = accent(); c.fill(); c.globalAlpha = 1;
  }

  async function tick() {
    try {
      const s = await API.get('/api/sysinfo');
      history.push(s.cpu.percent); if (history.length > 60) history.shift();
      cpu.v.textContent = `%${s.cpu.percent.toFixed(0)}`;
      cpu.sub.textContent = `${s.cpu.cores} çekirdek · yük ${s.cpu.load.map(x => x.toFixed(2)).join(' ')}`;
      draw();
      const mp = s.mem.used / s.mem.total * 100;
      mem.v.textContent = `%${mp.toFixed(0)}`; mem.bar.style.width = mp + '%';
      mem.sub.textContent = `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`;
      const dp = s.disk.used / s.disk.total * 100;
      disk.v.textContent = `%${dp.toFixed(0)}`; disk.bar.style.width = dp + '%';
      disk.sub.textContent = `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`;
      up.v.textContent = fmtDuration(s.uptime);
      up.sub.textContent = s.kernel;

      const procs = await API.get('/api/procs');
      tbody.replaceChildren(...procs.slice(0, 40).map(p => h('tr', {},
        h('td', {}, p.name), h('td', {}, p.pid), h('td', {}, p.user), h('td', {}, p.cpu.toFixed(1)), h('td', {}, fmtBytes(p.rss)),
        h('td', {}, h('button', { class: 'btn danger', style: { height: '24px', fontSize: '12px' }, onclick: () => API.post('/api/kill', { pid: p.pid }).then(() => notify('Durduruldu', p.name)).catch(fail) }, 'Durdur')))));
    } catch (e) { /* bir sonraki turda yeniden dener */ }
  }
  tick();
  const timer = setInterval(tick, 2000);
  win.onClose = () => { clearInterval(timer); return true; };
};

/* ================================================================ UYGULAMA MAĞAZASI */
const STORE_PICKS = [
  ['Ofis', 'libreoffice'], ['Web tarayıcı', 'firefox-esr'], ['E-posta', 'thunderbird'], ['Grafik', 'gimp'],
  ['Vektör çizim', 'inkscape'], ['Video oynatıcı', 'vlc'], ['Müzik', 'rhythmbox'], ['Kod editörü', 'geany'],
  ['Oyun', 'supertuxkart'], ['Ekran görüntüsü', 'flameshot'], ['Arşiv', 'file-roller'], ['Torrent', 'transmission-gtk'],
];

BUILTIN.store.launch = () => {
  const q = h('input', { class: 'field', type: 'search', placeholder: 'Paket ara (ör. gimp, oyun, python)…', style: { flex: 1 } });
  const results = h('div', { style: { overflow: 'auto', flex: 1 } });
  const log = h('div', { class: 'joblog', hidden: true });
  const chips = h('div', { class: 'store-chips' }, STORE_PICKS.map(([label, pkg]) =>
    h('button', { class: 'chip', title: pkg, onclick: () => { q.value = pkg; search(); } }, label)));
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { class: 'toolbar' }, q,
      h('button', { class: 'btn primary', html: svgIcon('search') + 'Ara', onclick: () => search() }),
      h('button', { class: 'btn', title: 'Debian paket listesini indir', onclick: () => job({ action: 'update' }) }, 'Listeyi güncelle')),
    chips, results, log);
  WM.open({ app: BUILTIN.store, width: 760, height: 580, content: root, single: true });
  results.append(h('div', { class: 'empty' },
    h('p', {}, 'Debian deposundaki on binlerce uygulamadan istediğini ara ve tek tıkla kur.'),
    h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Canlı (USB) oturumda kurulanlar yeniden başlatınca silinir. Kalıcı olması için TyrOS\'u diske kur.')));
  q.addEventListener('keydown', e => e.key === 'Enter' && search());
  setTimeout(() => q.focus(), 50);

  async function search() {
    const term = q.value.trim();
    if (term.length < 2) return;
    results.innerHTML = '<div class="empty">Aranıyor…</div>';
    try {
      const list = await API.get('/api/pkg/search?q=' + encodeURIComponent(term));
      results.innerHTML = '';
      if (!list.length) results.append(h('div', { class: 'empty' }, `"${term}" için paket bulunamadı. Paket listesi boşsa önce "Listeyi güncelle"ye bas.`));
      for (const p of list) {
        const btn = p.installed
          ? h('button', { class: 'btn danger', onclick: () => job({ action: 'remove', name: p.name }) }, 'Kaldır')
          : h('button', { class: 'btn primary', onclick: () => job({ action: 'install', name: p.name }) }, 'Kur');
        results.append(h('div', { class: 'pkg' },
          appIcon({ name: p.name, icon: p.name }),
          h('div', { class: 'pkg-info' }, h('div', { class: 'pkg-name' }, p.name), h('div', { class: 'pkg-desc', title: p.desc }, p.desc)),
          btn));
      }
    } catch (e) { results.innerHTML = ''; results.append(h('div', { class: 'empty' }, e.message)); }
  }

  async function job(body) {
    try {
      const j = await API.post('/api/pkg', body);
      log.hidden = false; log.textContent = j.title + '…\n';
      notify('Başladı', j.title);
      const poll = setInterval(async () => {
        try {
          const s = await API.get('/api/job?id=' + j.id);
          log.textContent = s.log.join('\n'); log.scrollTop = log.scrollHeight;
          if (s.done) {
            clearInterval(poll);
            if (s.code === 0) { notify('Tamamlandı', j.title.replace('kuruluyor', 'kuruldu').replace('kaldırılıyor', 'kaldırıldı').replace('güncelleniyor', 'güncellendi')); Shell.loadApps(true); if (q.value) search(); }
            else notify('İşlem başarısız', 'Ayrıntılar mağazanın alt kısmındaki kayıtta.', true);
          }
        } catch { clearInterval(poll); }
      }, 900);
    } catch (e) { fail(e); }
  }
};

/* ================================================================ AYARLAR */
BUILTIN.settings.launch = (section = 'look') => {
  const side = h('nav', { class: 'fm-side' });
  const body = h('div', { class: 'set-body' });
  const root = h('div', { class: 'set' }, side, body);
  const win = WM.open({ app: BUILTIN.settings, width: 820, height: 560, content: root, single: true });
  const sections = { look: ['Görünüm', look], net: ['Ağ', net], sound: ['Ses', sound], system: ['Sistem', system] };
  for (const [key, [label]] of Object.entries(sections)) side.append(h('button', { 'data-k': key, onclick: () => show(key) }, label));
  let timer = null;
  win.onClose = () => { clearInterval(timer); return true; };
  show(section);

  function show(key) {
    clearInterval(timer);
    $$('button', side).forEach(b => b.classList.toggle('on', b.dataset.k === key));
    body.innerHTML = '';
    body.append(h('h2', {}, sections[key][0]));
    sections[key][1]();
  }

  function look() {
    const walls = h('div', { class: 'walls' });
    for (const [id, w] of Object.entries(WALLPAPERS)) {
      walls.append(h('button', { class: 'wall' + (Settings.data.wallpaper === id ? ' on' : ''), 'aria-label': w.name, html: wallpaperSVG(id, Settings.data.accent) + `<span>${esc(w.name)}</span>`,
        onclick: () => { Settings.set({ wallpaper: id }); show('look'); } }));
    }
    const sw = h('div', { class: 'swatches' }, ACCENTS.map(a =>
      h('button', { class: 'swatch' + (Settings.data.accent === a.value ? ' on' : ''), title: a.name, 'aria-label': a.name, style: { background: a.value },
        onclick: () => { Settings.set({ accent: a.value }); show('look'); } })));
    body.append(
      h('div', { class: 'set-group' }, h('div', { class: 'muted' }, 'Duvar kağıdı'), walls),
      h('div', { class: 'set-group' }, h('div', { class: 'muted' }, 'Vurgu rengi'), sw));
  }

  async function net(rescan) {
    const box = h('div', {}, h('div', { class: 'muted' }, 'Ağlar taranıyor…'));
    body.append(h('div', { class: 'set-group' }, h('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px' } },
      h('button', { class: 'btn', html: svgIcon('refresh') + 'Yeniden tara', onclick: () => { show('net'); } })), box));
    try {
      const r = await API.get('/api/wifi' + (rescan !== false ? '?rescan=1' : ''));
      box.innerHTML = '';
      if (!r.available) { box.append(h('div', { class: 'muted' }, 'NetworkManager bulunamadı.')); return; }
      if (r.wired) box.append(h('div', { class: 'net' }, h('span', { class: 'ico', style: { width: '20px', height: '20px' }, html: svgIcon('wired') }), h('b', { style: { flex: 1 } }, 'Kablolu bağlantı'), h('span', { style: { color: 'var(--ok)' } }, 'Bağlı')));
      if (!r.networks.length) box.append(h('div', { class: 'muted' }, 'Kablosuz ağ bulunamadı.'));
      for (const n of r.networks) {
        box.append(h('div', { class: 'net' },
          h('span', { class: 'ico', style: { width: '20px', height: '20px' }, html: svgIcon('wifi') }),
          h('div', { style: { flex: 1 } }, h('b', {}, n.ssid), h('div', { class: 'muted', style: { fontSize: '12px' } }, n.secure ? 'Şifreli' : 'Açık ağ')),
          h('div', { class: 'bar sig' }, h('i', { style: { width: n.signal + '%' } })),
          n.active ? h('span', { style: { color: 'var(--ok)', width: '70px', textAlign: 'right' } }, 'Bağlı')
            : h('button', { class: 'btn', onclick: async () => {
              const password = n.secure ? await askText(win, `"${n.ssid}" ağının şifresi`, '', 'Bağlan') : '';
              if (n.secure && !password) return;
              notify('Bağlanılıyor', n.ssid);
              try { await API.post('/api/wifi', { ssid: n.ssid, password }); notify('Bağlandı', n.ssid); show('net'); } catch (e) { fail(e); }
            } }, 'Bağlan')));
      }
    } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'muted' }, e.message)); }
  }

  async function sound() {
    try {
      const v = await API.get('/api/volume');
      if (!v.available) { body.append(h('div', { class: 'muted' }, 'Ses sistemi (PipeWire) bulunamadı.')); return; }
      const range = h('input', { type: 'range', min: 0, max: 150, value: Math.round(v.level * 100), style: { width: '100%', accentColor: 'var(--accent)' } });
      const lbl = h('b', {}, `%${Math.round(v.level * 100)}`);
      range.addEventListener('input', () => { lbl.textContent = `%${range.value}`; API.post('/api/volume', { level: range.value / 100 }).catch(() => {}); });
      body.append(h('div', { class: 'set-group' }, h('div', { class: 'muted' }, 'Çıkış ses düzeyi'), h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, range, lbl)),
        h('button', { class: 'btn', onclick: () => API.post('/api/volume', { toggleMute: true }).then(r => notify(r.muted ? 'Ses kapatıldı' : 'Ses açıldı')).catch(fail) }, v.muted ? 'Sesi aç' : 'Sesi kapat'));
    } catch (e) { fail(e); }
  }

  async function system() {
    const dl = h('dl', { class: 'kv' });
    body.append(h('div', { class: 'set-group' }, dl),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn', onclick: () => Shell.power('reboot') }, 'Yeniden başlat'),
        h('button', { class: 'btn danger', onclick: () => Shell.power('shutdown') }, 'Bilgisayarı kapat')));
    const fill = async () => {
      try {
        const s = await API.get('/api/sysinfo');
        const rows = [['İşletim sistemi', s.os], ['Bilgisayar adı', s.hostname], ['Kullanıcı', s.user], ['Çekirdek', `${s.kernel} (${s.arch})`],
          ['İşlemci', `${s.cpu.model} · ${s.cpu.cores} çekirdek`], ['Bellek', `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`],
          ['Disk', `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`], ['IP adresi', s.ip || 'Bağlı değil'], ['Açık kalma', fmtDuration(s.uptime)]];
        if (s.battery) rows.push(['Pil', `%${s.battery.percent} (${s.battery.status})`]);
        dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      } catch (e) { dl.replaceChildren(h('dd', {}, e.message)); }
    };
    fill();
    timer = setInterval(fill, 5000);
  }
};

/* ================================================================ HAKKINDA */
BUILTIN.about.launch = async () => {
  const sub = h('div', { class: 'muted' }, '…');
  const root = h('div', { class: 'about' },
    h('div', { html: `<svg viewBox="0 0 100 100"><path d="${RUNE_PATH}"/></svg>` }),
    h('h1', {}, 'TyrOS 1.0'),
    h('div', {}, 'HTML, CSS ve JavaScript ile çizilen, Debian GNU/Linux üzerinde çalışan masaüstü.'),
    sub);
  WM.open({ app: BUILTIN.about, width: 480, height: 360, content: root, single: true });
  try { const s = await API.get('/api/sysinfo'); sub.textContent = `${s.os} · Linux ${s.kernel}`; } catch { sub.textContent = ''; }
};
