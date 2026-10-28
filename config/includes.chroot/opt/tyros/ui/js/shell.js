/* TyrOS masaüstü kabuğu */
'use strict';

const CATEGORIES = [
  ['all', 'Tümü'], ['tyros', 'TyrOS'], ['Network', 'İnternet'], ['Office', 'Ofis'], ['Graphics', 'Grafik'],
  ['AudioVideo', 'Ses ve video'], ['Development', 'Geliştirme'], ['Game', 'Oyunlar'], ['Education', 'Eğitim'],
  ['Utility', 'Araçlar'], ['System', 'Sistem'], ['Settings', 'Ayarlar'],
];

const Shell = {
  native: [],          // /usr/share/applications altındaki Linux uygulamaları
  nativeWins: [],      // wmctrl ile görülen yerel pencereler
  cat: 'all',

  allApps() { return [...Object.values(BUILTIN), ...this.native]; },
  findApp(id) { return BUILTIN[id] || this.native.find(a => a.id === id); },

  launch(app, arg) {
    this.closePopups();
    if (app.builtin) return app.launch(arg);
    notify('Açılıyor', app.name, false, 2200);
    API.post('/api/launch', { id: app.id }).catch(fail);
  },

  async loadApps(force) {
    try {
      this.native = await API.get('/api/apps' + (force ? '?force=1' : ''));
    } catch (e) { this.native = []; }
    this.renderMenu();
  },

  /* ------------------------------------------------ başlat menüsü */
  renderMenu() {
    const cats = $('#smCats');
    cats.innerHTML = '';
    const present = new Set(this.native.flatMap(a => a.categories));
    for (const [key, label] of CATEGORIES) {
      if (!['all', 'tyros'].includes(key) && !present.has(key)) continue;
      cats.append(h('button', { class: this.cat === key ? 'on' : '', onclick: () => { this.cat = key; this.renderMenu(); } }, label));
    }
    const q = $('#smSearch').value.trim().toLocaleLowerCase('tr');
    let apps = this.allApps();
    if (q) apps = apps.filter(a => (a.name + ' ' + (a.comment || '') + ' ' + a.id).toLocaleLowerCase('tr').includes(q));
    else if (this.cat === 'tyros') apps = Object.values(BUILTIN);
    else if (this.cat !== 'all') apps = apps.filter(a => (a.categories || a.cats || []).includes(this.cat));
    const grid = $('#smGrid');
    grid.innerHTML = '';
    if (!apps.length) grid.append(h('div', { class: 'sm-empty' }, q ? `"${q}" ile eşleşen uygulama yok. Uygulama Mağazası'nda aramak için Enter'a bas.` : 'Bu kategoride uygulama yok.'));
    for (const app of apps) {
      const b = h('button', { class: 'sm-app', role: 'listitem', title: app.comment || app.name, onclick: () => this.launch(app) },
        appIcon(app), h('span', {}, app.name));
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        const pinned = Settings.data.pinned.includes(app.id);
        this.contextMenu(e.clientX, e.clientY, [
          ['Aç', () => this.launch(app)],
          [pinned ? 'Görev çubuğundan kaldır' : 'Görev çubuğuna sabitle', () => this.togglePin(app.id)],
        ]);
      });
      grid.append(b);
    }
  },

  toggleStart(force) {
    const sm = $('#startMenu');
    const open = force ?? sm.hidden;
    this.closePopups();
    sm.hidden = !open;
    $('#startBtn').classList.toggle('on', open);
    if (open) { $('#smSearch').value = ''; this.renderMenu(); setTimeout(() => $('#smSearch').focus(), 20); }
  },

  closePopups() {
    $('#startMenu').hidden = true; $('#startBtn').classList.remove('on');
    $('#quickPanel').hidden = true; $('#tray').classList.remove('on');
    $('#ctxMenu').hidden = true;
  },

  /* ------------------------------------------------ görev çubuğu */
  togglePin(id) {
    const p = Settings.data.pinned;
    Settings.set({ pinned: p.includes(id) ? p.filter(x => x !== id) : [...p, id] });
    this.renderTaskbar();
  },

  renderTaskbar() {
    const pinned = $('#pinned');
    pinned.innerHTML = '';
    const openIds = new Set([...WM.wins.values()].map(w => w.app.id));
    for (const id of Settings.data.pinned) {
      const app = this.findApp(id);
      if (!app) continue;
      const b = h('button', { class: 'tb-btn' + (openIds.has(id) ? ' open' : ''), title: app.name, 'aria-label': app.name, onclick: () => this.launch(app) }, appIcon(app));
      b.addEventListener('contextmenu', e => { e.preventDefault(); this.contextMenu(e.clientX, e.clientY, [['Yeni pencere', () => this.launch(app)], ['Sabitlemeyi kaldır', () => this.togglePin(id)]]); });
      pinned.append(b);
    }

    const tasks = $('#tasks');
    tasks.innerHTML = '';
    for (const w of WM.wins.values()) {
      const b = h('button', { class: 'tb-btn' + (WM.activeId === w.id && w.state !== 'min' ? ' active' : ' open'), title: w.titleEl.textContent, onclick: () => WM.taskClick(w.id) },
        appIcon(w.app), h('span', { class: 'lbl' }, w.titleEl.textContent));
      b.addEventListener('contextmenu', e => { e.preventDefault(); this.contextMenu(e.clientX, e.clientY, [['Ekranı kapla', () => WM.toggleMax(w.id)], ['Küçült', () => WM.minimize(w.id)], '-', ['Kapat', () => WM.close(w.id)]]); });
      tasks.append(b);
    }
    // Yerel Linux pencereleri (GIMP, Firefox, LibreOffice…)
    for (const nw of this.nativeWins) {
      const app = this.native.find(a => a.icon && a.icon.toLowerCase() === nw.class.toLowerCase()) || { name: nw.title, icon: nw.class.toLowerCase() };
      const b = h('button', { class: 'tb-btn native open', title: nw.title, onclick: () => API.post('/api/window', { id: nw.id, action: 'activate' }).catch(fail) },
        appIcon(app), h('span', { class: 'lbl' }, nw.title));
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.contextMenu(e.clientX, e.clientY, [
          ['Öne getir', () => API.post('/api/window', { id: nw.id, action: 'activate' })],
          ['Küçült', () => API.post('/api/window', { id: nw.id, action: 'minimize' })],
          '-',
          ['Kapat', () => API.post('/api/window', { id: nw.id, action: 'close' })],
        ]);
      });
      tasks.append(b);
    }
  },

  async pollNativeWindows() {
    try {
      const wins = await API.get('/api/windows');
      if (JSON.stringify(wins) !== JSON.stringify(this.nativeWins)) { this.nativeWins = wins; this.renderTaskbar(); }
    } catch { /* geliştirme modunda wmctrl olmayabilir */ }
  },

  /* ------------------------------------------------ masaüstü */
  renderDesktop() {
    const box = $('#desktopIcons');
    box.innerHTML = '';
    for (const id of ['files', 'terminal', 'store', 'settings']) {
      const app = BUILTIN[id];
      const b = h('button', { class: 'dicon' }, appIcon(app), h('span', {}, app.name));
      b.addEventListener('click', () => { $$('.dicon.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
      b.addEventListener('dblclick', () => this.launch(app));
      b.addEventListener('keydown', e => e.key === 'Enter' && this.launch(app));
      box.append(b);
    }
  },

  contextMenu(x, y, items) {
    const m = $('#ctxMenu');
    m.innerHTML = '';
    for (const it of items.filter(Boolean)) {
      if (it === '-') { m.append(h('hr')); continue; }
      m.append(h('button', { onclick: () => { m.hidden = true; it[1](); } }, it[0]));
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  },

  /* ------------------------------------------------ tepsi & saat */
  tickClock() {
    const d = new Date();
    $('#clockTime').textContent = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    $('#clockDate').textContent = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    $('#clock').title = d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  },

  async refreshTray() {
    try {
      const [s, v] = await Promise.all([API.get('/api/sysinfo'), API.get('/api/volume').catch(() => ({}))]);
      $('#trayNet').innerHTML = svgIcon(s.ip ? 'wifi' : 'nonet');
      $('#trayNet').title = s.ip ? `Bağlı: ${s.ip}` : 'Ağ bağlantısı yok';
      $('#trayVol').innerHTML = v.available ? svgIcon(v.muted ? 'mute' : 'vol') : '';
      if (s.battery) {
        const p = s.battery.percent;
        $('#trayBat').innerHTML = `<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3"/><rect x="4.5" y="9" width="${(13 * p / 100).toFixed(1)}" height="6" rx="1" fill="currentColor" stroke="none"/></svg><span>%${p}</span>`;
      }
      this.netText = s.ip ? `Bağlı · IP ${s.ip}` : 'Ağ bağlantısı yok. Ayarlar > Ağ bölümünden bağlan.';
      this.vol = v;
    } catch { $('#trayNet').innerHTML = svgIcon('nonet'); }
  },

  toggleQuick() {
    const qp = $('#quickPanel');
    const open = qp.hidden;
    this.closePopups();
    qp.hidden = !open;
    $('#tray').classList.toggle('on', open);
    if (!open) return;
    $('#qpNet').textContent = this.netText || 'Ağ durumu alınıyor…';
    const v = this.vol || {};
    $('#qpVolume').disabled = !v.available;
    $('#qpVolume').value = Math.round((v.level || 0) * 100);
    $('#qpMute').innerHTML = svgIcon(v.muted ? 'mute' : 'vol');
  },

  async power(action) {
    const labels = { shutdown: 'Bilgisayar kapatılsın mı?', reboot: 'Bilgisayar yeniden başlatılsın mı?', logout: 'Oturum kapatılsın mı?' };
    if (!confirm(labels[action])) return;
    try { await API.post('/api/power', { action }); } catch (e) { fail(e); }
  },

  /* ------------------------------------------------ açılış */
  async boot() {
    const status = t => { $('#bootStatus').textContent = t; };
    status('Sistem köprüsüne bağlanılıyor');
    for (let i = 0; i < 40; i++) {
      try { await API.get('/api/ping'); API.online = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!API.online) status('Sistem köprüsü yanıt vermiyor; arayüz sınırlı modda açılıyor');
    status('Ayarlar yükleniyor');
    await Settings.load();
    status('Uygulamalar listeleniyor');
    await this.loadApps();
    try {
      const s = await API.get('/api/sysinfo');
      $('#smUser').textContent = s.user; $('#smHost').textContent = s.hostname;
      $('#smAvatar').textContent = (s.user || 'T')[0].toUpperCase();
    } catch { /* sınırlı mod */ }

    this.renderDesktop();
    this.renderTaskbar();
    WM.onChange(() => this.renderTaskbar());
    this.tickClock(); setInterval(() => this.tickClock(), 1000 * 10);
    this.refreshTray(); setInterval(() => this.refreshTray(), 15000);
    setInterval(() => this.pollNativeWindows(), 2000);
    setInterval(() => this.loadApps(), 60000);   // yeni kurulan uygulamaları menüye ekle
    this.bind();
    setTimeout(() => $('#boot').classList.add('gone'), 300);
    setTimeout(() => $('#boot').remove(), 1000);
  },

  bind() {
    $('#startBtn').addEventListener('click', e => { e.stopPropagation(); this.toggleStart(); });
    $('#tray').addEventListener('click', e => { e.stopPropagation(); this.toggleQuick(); });
    $('#clock').addEventListener('click', () => BUILTIN.settings.launch('system'));
    $('#smSearch').addEventListener('input', () => this.renderMenu());
    $('#smSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = $('#smGrid .sm-app');
        if (first) first.click();
        else if (e.target.value.trim()) { const term = e.target.value.trim(); this.launch(BUILTIN.store); setTimeout(() => { const f = $('.win:last-child input[type=search]'); if (f) { f.value = term; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } }, 80); }
      }
      if (e.key === 'Escape') this.closePopups();
    });
    $$('[data-power]').forEach(b => b.addEventListener('click', () => { this.closePopups(); this.power(b.dataset.power); }));
    $$('[data-open]').forEach(b => b.addEventListener('click', () => this.launch(BUILTIN[b.dataset.open])));
    $('#qpVolume').addEventListener('input', e => API.post('/api/volume', { level: e.target.value / 100 }).catch(() => {}));
    $('#qpMute').addEventListener('click', async () => {
      try { const v = await API.post('/api/volume', { toggleMute: true }); this.vol = v; $('#qpMute').innerHTML = svgIcon(v.muted ? 'mute' : 'vol'); $('#trayVol').innerHTML = svgIcon(v.muted ? 'mute' : 'vol'); } catch (e) { fail(e); }
    });

    // Açık menüleri dışarı tıklayınca kapat
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('#startMenu, #startBtn, #quickPanel, #tray, #ctxMenu')) this.closePopups();
      if (!e.target.closest('.dicon')) $$('.dicon.sel').forEach(x => x.classList.remove('sel'));
    });

    $('#desktop').addEventListener('contextmenu', e => {
      if (e.target.closest('.win')) return;
      e.preventDefault();
      this.contextMenu(e.clientX, e.clientY, [
        ['Terminal aç', () => this.launch(BUILTIN.terminal)],
        ['Dosyalar', () => this.launch(BUILTIN.files)],
        '-',
        ['Duvar kağıdını değiştir', () => BUILTIN.settings.launch('look')],
        ['Uygulama listesini yenile', () => this.loadApps(true).then(() => notify('Uygulama listesi yenilendi', `${this.native.length} Linux uygulaması bulundu`))],
      ]);
    });

    // Klavye kısayolları
    let superAlone = false;
    document.addEventListener('keydown', e => {
      superAlone = e.key === 'Meta' || e.key === 'OS';
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); this.launch(BUILTIN.terminal); }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); this.launch(BUILTIN.files); }
      if (e.altKey && e.key === 'F4' && WM.activeId) { e.preventDefault(); WM.close(WM.activeId); }
      if (e.key === 'Escape') this.closePopups();
    });
    document.addEventListener('keyup', e => { if ((e.key === 'Meta' || e.key === 'OS') && superAlone) this.toggleStart(); });
  },
};

window.addEventListener('DOMContentLoaded', () => Shell.boot());
