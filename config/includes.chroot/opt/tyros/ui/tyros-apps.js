/* TyrOS — genişletilmiş Ayarlar ve Uygulama Mağazası
   brand.js'ten sonra yüklenir; BUILTIN.settings ve BUILTIN.store'u yeniler. */
(() => {
'use strict';

/* ================================================================ yardımcılar */
const run = async (cmd, timeout = 60) => {
  const r = await API.post('/api/exec', { cmd, timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'İşlem başarısız').trim().split('\n').slice(-3).join('\n'));
  return r.stdout;
};
const tryRun = (cmd, timeout) => run(cmd, timeout).catch(() => '');
const row = (label, control, hint) => h('div', { class: 'st-row' },
  h('div', { class: 'st-label' }, h('div', {}, label), hint ? h('div', { class: 'muted st-hint' }, hint) : null), h('div', { class: 'st-ctl' }, control));
const select = (options, value, onchange) => {
  const s = h('select', { class: 'field st-select' }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value; s.addEventListener('change', () => onchange(s.value)); return s;
};
const toggle = (on, onchange) => {
  const t = h('button', { class: 'st-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) });
  t.addEventListener('click', () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v)); onchange(v); });
  return t;
};
const group = (title, ...kids) => h('div', { class: 'st-group' }, title ? h('div', { class: 'st-gtitle' }, title) : null, h('div', { class: 'st-card' }, ...kids));

/* ================================================================ kalıcı tercihleri uygula */
const Prefs = {
  apply() {
    const d = Settings.data;
    document.documentElement.style.zoom = d.uiScale && d.uiScale !== 1 ? d.uiScale : '';
    document.documentElement.classList.toggle('ty-noanim', !!d.reduceMotion);
  },
  async applySystem() {
    const d = Settings.data;
    if (d.kbLayout) tryRun(`setxkbmap ${d.kbLayout.split(':').map(q).join(' -variant ')}`);
    const blank = Number(d.blankMinutes ?? 0) * 60;
    tryRun(blank ? `xset s ${blank} ${blank}; xset +dpms; xset dpms ${blank} ${blank} ${blank}` : 'xset s off; xset -dpms');
    if (d.brightness && d.brightness !== 1 && d.output) tryRun(`xrandr --output ${q(d.output)} --brightness ${Number(d.brightness)}`);
  },
};
const _load = Settings.load.bind(Settings);
Settings.load = async function () { await _load(); Prefs.apply(); Prefs.applySystem(); };
const _apply = Settings.apply.bind(Settings);
Settings.apply = function () { _apply(); Prefs.apply(); };
const _notify = notify;
// eslint-disable-next-line no-global-assign
notify = function (title, text = '', isErr = false, ms) {
  if (!isErr && Settings.data.quietNotify) return;
  return _notify(title, text, isErr, ms);
};

/* ================================================================ AYARLAR */
BUILTIN.settings.launch = (section = 'look') => {
  const SECTIONS = [
    ['look', 'Görünüm', 'image', look], ['display', 'Ekran', 'monitor', display], ['sound', 'Ses', 'vol', sound],
    ['net', 'Ağ ve internet', 'wifi', net], ['keyboard', 'Klavye ve dil', 'editor', keyboard], ['time', 'Tarih ve saat', 'info', time],
    ['power', 'Güç ve ekran koruyucu', 'power', power], ['storage', 'Depolama', 'package', storage],
    ['apps', 'Varsayılan uygulamalar', 'store', defaults], ['notify', 'Bildirimler', 'settings', notifications], ['system', 'Sistem', 'home', system],
  ];
  const side = h('nav', { class: 'st-side' });
  const body = h('div', { class: 'st-body' });
  const root = h('div', { class: 'st' }, side, body);
  const existing = [...WM.wins.values()].find(w => w.app.id === 'settings');
  const win = existing || WM.open({ app: BUILTIN.settings, width: 940, height: 620, content: root, single: true });
  if (existing) { WM.focus(existing.id); return; }
  let timer = null;
  win.onClose = () => { clearInterval(timer); return true; };
  for (const [key, label, icon] of SECTIONS) side.append(h('button', { 'data-k': key, html: svgIcon(icon) + `<span>${esc(label)}</span>`, onclick: () => show(key) }));
  show(section);

  function show(key) {
    clearInterval(timer);
    const s = SECTIONS.find(x => x[0] === key) || SECTIONS[0];
    $$('button', side).forEach(b => b.classList.toggle('on', b.dataset.k === s[0]));
    body.replaceChildren(h('h2', {}, s[1]));
    body.scrollTop = 0;
    s[3]();
  }

  /* ---------------------------------------------------------------- Görünüm */
  function look() {
    const walls = h('div', { class: 'walls' });
    for (const [id, w] of Object.entries(WALLPAPERS)) {
      walls.append(h('button', { class: 'wall' + (Settings.data.wallpaper === id ? ' on' : ''), 'aria-label': w.name, html: wallpaperSVG(id) + `<span>${esc(w.name)}</span>`,
        onclick: () => { Settings.set({ wallpaper: id }); show('look'); } }));
    }
    const sw = h('div', { class: 'swatches' }, ACCENTS.map(a =>
      h('button', { class: 'swatch' + (Settings.data.accent === a.value ? ' on' : ''), title: a.name, 'aria-label': a.name, style: { background: a.value },
        onclick: () => { Settings.set({ accent: a.value }); show('look'); } })));
    body.append(
      group('Duvar kağıdı', walls),
      group('Vurgu rengi', sw),
      group('Arayüz',
        row('Arayüz boyutu', select([['0.9', '%90'], ['1', '%100 (önerilen)'], ['1.1', '%110'], ['1.25', '%125'], ['1.5', '%150']], String(Settings.data.uiScale || 1),
          v => Settings.set({ uiScale: Number(v) })), 'Yazı ve simgeleri büyütür ya da küçültür'),
        row('Animasyonları azalt', toggle(Settings.data.reduceMotion, v => Settings.set({ reduceMotion: v })), 'Pencere açılış/kapanış efektlerini kapatır')));
  }

  /* ---------------------------------------------------------------- Ekran */
  async function display() {
    const box = h('div', {}, h('div', { class: 'muted' }, 'Ekranlar okunuyor…'));
    body.append(box);
    const out = await tryRun('xrandr --query 2>/dev/null');
    box.innerHTML = '';
    const outputs = [];
    let cur = null;
    for (const line of out.split('\n')) {
      const m = line.match(/^(\S+) connected( primary)?\s*(\d+x\d+)?/);
      if (m) { cur = { name: m[1], primary: !!m[2], current: m[3] || '', modes: [] }; outputs.push(cur); continue; }
      const mm = line.match(/^\s+(\d+x\d+)\s+(.*)$/);
      if (mm && cur && !cur.modes.some(x => x.res === mm[1])) cur.modes.push({ res: mm[1], rates: mm[2].replace(/[*+]/g, '').trim().split(/\s+/).filter(Boolean) });
    }
    if (!outputs.length) { box.append(group(null, h('div', { class: 'muted st-pad' }, 'Ekran bilgisi alınamadı.'))); return; }
    for (const o of outputs) {
      const resSel = select(o.modes.map(m => [m.res, m.res.replace('x', ' × ')]), o.current, async v => {
        try { await run(`xrandr --output ${q(o.name)} --mode ${q(v)}`); notify('Çözünürlük değişti', v.replace('x', ' × ')); } catch (e) { fail(e); }
      });
      const bright = h('input', { type: 'range', min: 40, max: 100, value: Math.round((Settings.data.output === o.name ? Settings.data.brightness || 1 : 1) * 100), class: 'st-range' });
      bright.addEventListener('change', () => {
        const v = bright.value / 100;
        run(`xrandr --output ${q(o.name)} --brightness ${v}`).then(() => Settings.set({ output: o.name, brightness: v })).catch(fail);
      });
      box.append(group(o.name + (o.primary ? ' (ana ekran)' : ''),
        row('Çözünürlük', resSel),
        row('Parlaklık', bright, 'Yazılımla ayarlanır; dizüstünde klavye tuşları da çalışır')));
    }
  }

  /* ---------------------------------------------------------------- Ses */
  async function sound() {
    try {
      const v = await API.get('/api/volume');
      if (!v.available) { body.append(group(null, h('div', { class: 'muted st-pad' }, 'Ses sistemi (PipeWire) bulunamadı.'))); return; }
      const lbl = h('b', { class: 'st-val' }, `%${Math.round(v.level * 100)}`);
      const range = h('input', { type: 'range', min: 0, max: 150, value: Math.round(v.level * 100), class: 'st-range' });
      range.addEventListener('input', () => { lbl.textContent = `%${range.value}`; API.post('/api/volume', { level: range.value / 100 }).catch(() => {}); });
      const sinks = await tryRun("wpctl status 2>/dev/null | sed -n '/Sinks:/,/Sources:/p' | grep -E '[0-9]+\\.' ");
      const devs = sinks.split('\n').map(l => l.match(/(\*)?\s*(\d+)\.\s+(.+?)\s*(\[vol:.*)?$/)).filter(Boolean).map(m => ({ id: m[2], name: m[3], def: !!m[1] }));
      body.append(group('Çıkış',
        row('Ses düzeyi', h('div', { class: 'st-inline' }, range, lbl)),
        row('Sessiz', toggle(v.muted, () => API.post('/api/volume', { toggleMute: true }).catch(fail))),
        devs.length ? row('Çıkış aygıtı', select(devs.map(d => [d.id, d.name]), (devs.find(d => d.def) || devs[0]).id,
          id => run(`wpctl set-default ${q(id)}`).then(() => notify('Ses çıkışı değişti')).catch(fail))) : null));
    } catch (e) { fail(e); }
  }

  /* ---------------------------------------------------------------- Ağ */
  async function net() {
    const box = h('div', { class: 'st-card' }, h('div', { class: 'muted st-pad' }, 'Ağlar taranıyor…'));
    body.append(h('div', { class: 'st-group' }, h('div', { class: 'st-gtitle st-gtitle-row' }, 'Kablosuz ağlar',
      h('button', { class: 'btn', html: svgIcon('refresh') + 'Yeniden tara', onclick: () => show('net') })), box));
    try {
      const r = await API.get('/api/wifi?rescan=1');
      box.innerHTML = '';
      if (!r.available) { box.append(h('div', { class: 'muted st-pad' }, 'NetworkManager bulunamadı.')); return; }
      if (r.wired) box.append(row('Kablolu bağlantı', h('span', { style: { color: 'var(--ok)' } }, 'Bağlı')));
      if (!r.networks.length) box.append(h('div', { class: 'muted st-pad' }, 'Kablosuz ağ bulunamadı.'));
      for (const n of r.networks) {
        box.append(h('div', { class: 'st-row' },
          h('div', { class: 'st-label st-net' }, h('span', { class: 'ico', html: svgIcon('wifi') }),
            h('div', {}, h('div', {}, n.ssid), h('div', { class: 'muted st-hint' }, `${n.secure ? 'Şifreli' : 'Açık ağ'} · sinyal %${n.signal}`))),
          h('div', { class: 'st-ctl' }, n.active ? h('span', { style: { color: 'var(--ok)' } }, 'Bağlı')
            : h('button', { class: 'btn', onclick: async () => {
              const password = n.secure ? await askText(win, `"${n.ssid}" ağının şifresi`, '', 'Bağlan') : '';
              if (n.secure && !password) return;
              notify('Bağlanılıyor', n.ssid);
              try { await API.post('/api/wifi', { ssid: n.ssid, password }); notify('Bağlandı', n.ssid); show('net'); } catch (e) { fail(e); }
            } }, 'Bağlan'))));
      }
      const ip = (await API.get('/api/sysinfo')).ip;
      body.append(group('Bağlantı bilgisi', row('IP adresi', h('span', {}, ip || 'Bağlı değil')),
        row('Gelişmiş ağ ayarları', h('button', { class: 'btn', onclick: () => tryRun('nohup nm-connection-editor >/dev/null 2>&1 &') }, 'Aç'), 'VPN, sabit IP, DNS gibi ayarlar')));
    } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'muted st-pad' }, e.message)); }
  }

  /* ---------------------------------------------------------------- Klavye */
  function keyboard() {
    const LAYOUTS = [['tr', 'Türkçe Q'], ['tr:f', 'Türkçe F'], ['us', 'İngilizce (ABD)'], ['gb', 'İngilizce (Birleşik Krallık)'],
      ['de', 'Almanca'], ['fr', 'Fransızca'], ['es', 'İspanyolca'], ['ru', 'Rusça'], ['az', 'Azerbaycanca'], ['ara', 'Arapça']];
    body.append(group('Klavye düzeni',
      row('Düzen', select(LAYOUTS, Settings.data.kbLayout || 'tr', v => {
        run(`setxkbmap ${v.split(':').map(q).join(' -variant ')}`).then(() => { Settings.set({ kbLayout: v }); notify('Klavye düzeni değişti', LAYOUTS.find(l => l[0] === v)[1]); }).catch(fail);
      }), 'Hemen uygulanır ve her açılışta hatırlanır'),
      row('Dene', h('input', { class: 'field', placeholder: 'Buraya yazarak deneyebilirsin…', style: { width: '260px' } }))));
    body.append(group('Dil', row('Sistem dili', h('span', {}, 'Türkçe'), 'Uygulamalar Türkçe açılır')));
  }

  /* ---------------------------------------------------------------- Tarih ve saat */
  async function time() {
    const now = h('b', { class: 'st-clock' });
    const tick = () => { now.textContent = new Date().toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'medium' }); };
    tick(); timer = setInterval(tick, 1000);
    const info = await tryRun('timedatectl show -p Timezone -p NTP --value 2>/dev/null');
    const [tz = 'Europe/Istanbul', ntp = 'yes'] = info.trim().split('\n');
    const zones = (await tryRun('timedatectl list-timezones 2>/dev/null')).trim().split('\n').filter(Boolean);
    const priv = c => `${c} 2>/dev/null || sudo -n ${c}`;
    body.append(group(null, h('div', { class: 'st-pad' }, now)),
      group('Ayarlar',
        row('Saat dilimi', zones.length ? select(zones.map(z => [z, z.replace(/_/g, ' ')]), tz,
          z => run(priv(`timedatectl set-timezone ${q(z)}`)).then(() => notify('Saat dilimi değişti', z)).catch(fail)) : h('span', {}, tz)),
        row('Saati internetten otomatik al', toggle(ntp === 'yes', v => run(priv(`timedatectl set-ntp ${v ? 'true' : 'false'}`)).catch(fail)))));
  }

  /* ---------------------------------------------------------------- Güç */
  async function power() {
    const bat = (await API.get('/api/sysinfo').catch(() => ({}))).battery;
    body.append(...[
      bat ? group('Pil', row('Durum', h('span', {}, `%${bat.percent} · ${bat.status === 'Charging' ? 'Şarj oluyor' : bat.status === 'Full' ? 'Dolu' : 'Pilde'}`))) : null,
      group('Ekran',
        row('Ekranı kapat', select([['0', 'Hiçbir zaman'], ['5', '5 dakika sonra'], ['10', '10 dakika sonra'], ['15', '15 dakika sonra'], ['30', '30 dakika sonra']],
          String(Settings.data.blankMinutes ?? 0), v => { Settings.set({ blankMinutes: Number(v) }); Prefs.applySystem(); }), 'Bilgisayar kullanılmadığında')),
      group('Güç',
        h('div', { class: 'st-row st-btns' },
          h('button', { class: 'btn', onclick: () => tryRun('systemctl suspend -i || sudo -n systemctl suspend') }, 'Uyku'),
          h('button', { class: 'btn', onclick: () => Shell.power('reboot') }, 'Yeniden başlat'),
          h('button', { class: 'btn danger', onclick: () => Shell.power('shutdown') }, 'Bilgisayarı kapat')))].filter(Boolean));
  }

  /* ---------------------------------------------------------------- Depolama */
  async function storage() {
    const out = await tryRun("df -B1 --output=source,target,size,used,fstype -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null | tail -n +2");
    const disks = out.trim().split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)).map(([src, target, size, used, fs]) => ({ src, target, size: +size, used: +used, fs }));
    if (!disks.length) { body.append(group(null, h('div', { class: 'muted st-pad' }, 'Bu oturumda kalıcı disk yok (USB/ISO\'dan canlı çalışıyor).'))); }
    for (const d of disks) {
      const p = d.size ? d.used / d.size * 100 : 0;
      body.append(group(d.target === '/' ? 'Sistem diski' : d.target,
        h('div', { class: 'st-pad' },
          h('div', { class: 'st-inline', style: { justifyContent: 'space-between' } }, h('b', {}, `${fmtBytes(d.used)} kullanılıyor`), h('span', { class: 'muted' }, `${fmtBytes(d.size - d.used)} boş · toplam ${fmtBytes(d.size)}`)),
          h('div', { class: 'bar st-bar' }, h('i', { style: { width: p + '%', background: p > 90 ? 'var(--danger)' : 'var(--accent)' } })),
          h('div', { class: 'muted st-hint' }, `${d.src} · ${d.fs}`))));
    }
    body.append(group('Temizlik',
      row('Çöp kutusu', h('button', { class: 'btn', onclick: () => BUILTIN.trash.launch() }, 'Aç')),
      row('Gereksiz paket dosyaları', h('button', { class: 'btn', onclick: () => run('sudo -n /usr/local/sbin/tyros-pkg clean', 300).then(() => notify('Temizlendi', 'İndirilmiş paket dosyaları silindi')).catch(fail) }, 'Temizle'))));
  }

  /* ---------------------------------------------------------------- Varsayılan uygulamalar */
  async function defaults() {
    const cur = (await tryRun('xdg-settings get default-web-browser 2>/dev/null')).trim();
    const browsers = [['firefox-esr.desktop', 'Firefox'], ['chromium.desktop', 'Chromium']];
    body.append(group('Varsayılan uygulamalar',
      row('Web tarayıcı', select(browsers, browsers.some(b => b[0] === cur) ? cur : 'firefox-esr.desktop',
        v => run(`xdg-settings set default-web-browser ${q(v)}`).then(() => notify('Varsayılan tarayıcı değişti')).catch(fail))),
      row('Dosya yöneticisi', h('span', {}, 'TyrOS Dosyalar')),
      row('Terminal', h('span', {}, 'TyrOS Terminal'))));
  }

  /* ---------------------------------------------------------------- Bildirimler */
  function notifications() {
    body.append(group(null,
      row('Bilgi bildirimlerini göster', toggle(!Settings.data.quietNotify, v => Settings.set({ quietNotify: !v })), 'Kapalıyken sadece hata bildirimleri görünür'),
      row('Dene', h('button', { class: 'btn', onclick: () => _notify('Örnek bildirim', 'Bildirimler böyle görünür.') }, 'Örnek göster'))));
  }

  /* ---------------------------------------------------------------- Sistem */
  async function system() {
    const dl = h('dl', { class: 'kv st-pad' });
    body.append(group('Bu bilgisayar', dl),
      group('İşlemler', h('div', { class: 'st-row st-btns' },
        h('button', { class: 'btn', onclick: () => BUILTIN.monitor.launch() }, 'Sistem izleyici'),
        h('button', { class: 'btn', onclick: () => BUILTIN.about.launch() }, 'TyrOS hakkında'),
        h('button', { class: 'btn', onclick: () => Shell.power('reboot') }, 'Yeniden başlat'),
        h('button', { class: 'btn danger', onclick: () => Shell.power('shutdown') }, 'Bilgisayarı kapat'))));
    const fill = async () => {
      try {
        const s = await API.get('/api/sysinfo');
        const rows = [['İşletim sistemi', s.os], ['Bilgisayar adı', s.hostname], ['Kullanıcı', s.user], ['Çekirdek', `${s.kernel} (${s.arch})`],
          ['İşlemci', `${s.cpu.model} · ${s.cpu.cores} çekirdek`], ['Bellek', `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`],
          ['Disk', `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`], ['IP adresi', s.ip || 'Bağlı değil'], ['Açık kalma', fmtDuration(s.uptime)]];
        if (s.battery) rows.push(['Pil', `%${s.battery.percent}`]);
        dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
      } catch (e) { dl.replaceChildren(h('dd', {}, e.message)); }
    };
    fill(); timer = setInterval(fill, 5000);
  }
};

/* ================================================================ UYGULAMA MAĞAZASI */
const STORE_CATS = [
  ['office', 'Ofis', 'filetext', [
    ['libreoffice-writer', 'LibreOffice Writer', 'Kelime işlemci — Word belgeleri'], ['libreoffice-calc', 'LibreOffice Calc', 'Hesap tablosu — Excel dosyaları'],
    ['libreoffice-impress', 'LibreOffice Impress', 'Sunum — PowerPoint dosyaları'], ['libreoffice-draw', 'LibreOffice Draw', 'Çizim ve PDF düzenleme'],
    ['libreoffice-math', 'LibreOffice Math', 'Formül düzenleyici'], ['libreoffice-base', 'LibreOffice Base', 'Veritabanı'],
    ['gnumeric', 'Gnumeric', 'Hafif hesap tablosu'], ['evince', 'Belge Görüntüleyici', 'PDF okuyucu'], ['okular', 'Okular', 'Gelişmiş PDF ve belge okuyucu'],
    ['xournalpp', 'Xournal++', 'El yazısı not ve PDF üzerine yazma'], ['calibre', 'Calibre', 'E-kitap kütüphanesi'], ['scribus', 'Scribus', 'Masaüstü yayıncılık'],
    ['zim', 'Zim', 'Masaüstü wiki ve not defteri']]],
  ['internet', 'İnternet', 'globe', [
    ['firefox-esr', 'Firefox', 'Web tarayıcı'], ['chromium', 'Chromium', 'Web tarayıcı'], ['thunderbird', 'Thunderbird', 'E-posta'],
    ['telegram-desktop', 'Telegram', 'Mesajlaşma'], ['transmission-gtk', 'Transmission', 'Torrent indirici'], ['qbittorrent', 'qBittorrent', 'Torrent indirici'],
    ['filezilla', 'FileZilla', 'FTP istemcisi'], ['remmina', 'Remmina', 'Uzak masaüstü'], ['hexchat', 'HexChat', 'IRC sohbet']]],
  ['graphics', 'Grafik ve fotoğraf', 'image', [
    ['gimp', 'GIMP', 'Fotoğraf düzenleme'], ['inkscape', 'Inkscape', 'Vektör çizim'], ['krita', 'Krita', 'Dijital resim'],
    ['darktable', 'darktable', 'RAW fotoğraf işleme'], ['blender', 'Blender', '3B modelleme ve animasyon'], ['shotwell', 'Shotwell', 'Fotoğraf arşivi'],
    ['gthumb', 'gThumb', 'Resim görüntüleyici'], ['mypaint', 'MyPaint', 'Serbest çizim'], ['drawing', 'Drawing', 'Basit çizim (Paint benzeri)'], ['flameshot', 'Flameshot', 'Ekran görüntüsü']]],
  ['media', 'Ses ve video', 'vol', [
    ['vlc', 'VLC', 'Video ve müzik oynatıcı'], ['mpv', 'mpv', 'Hafif video oynatıcı'], ['celluloid', 'Celluloid', 'Şık video oynatıcı'],
    ['rhythmbox', 'Rhythmbox', 'Müzik çalar'], ['audacity', 'Audacity', 'Ses düzenleme'], ['kdenlive', 'Kdenlive', 'Video düzenleme'],
    ['shotcut', 'Shotcut', 'Video düzenleme'], ['obs-studio', 'OBS Studio', 'Ekran kaydı ve yayın'], ['handbrake', 'HandBrake', 'Video dönüştürücü'], ['lmms', 'LMMS', 'Müzik yapımı']]],
  ['games', 'Oyunlar', 'monitor', [
    ['supertuxkart', 'SuperTuxKart', 'Araba yarışı'], ['0ad', '0 A.D.', 'Strateji'], ['wesnoth', 'Battle for Wesnoth', 'Sıra tabanlı strateji'],
    ['supertux', 'SuperTux', 'Platform oyunu'], ['extremetuxracer', 'Extreme Tux Racer', 'Kayak yarışı'], ['frozen-bubble', 'Frozen Bubble', 'Balon patlatma'],
    ['gnome-chess', 'Satranç', 'Satranç'], ['gnome-mines', 'Mayın Tarlası', 'Klasik oyun'], ['aisleriot', 'Solitaire', 'Kart oyunları'], ['pingus', 'Pingus', 'Bulmaca'], ['xmoto', 'X-Moto', 'Motosiklet']]],
  ['dev', 'Geliştirme', 'terminal', [
    ['geany', 'Geany', 'Hafif kod editörü'], ['codeblocks', 'Code::Blocks', 'C/C++ geliştirme ortamı'], ['meld', 'Meld', 'Dosya karşılaştırma'],
    ['git', 'Git', 'Sürüm kontrolü'], ['build-essential', 'Derleme araçları', 'gcc, make ve diğerleri'], ['python3-pip', 'Python pip', 'Python paket yöneticisi'],
    ['nodejs', 'Node.js', 'JavaScript çalışma ortamı'], ['default-jdk', 'Java (JDK)', 'Java geliştirme'], ['sqlitebrowser', 'DB Browser for SQLite', 'SQLite veritabanı'], ['ghex', 'GHex', 'Hex editörü']]],
  ['edu', 'Eğitim', 'info', [
    ['gcompris-qt', 'GCompris', 'Çocuklar için eğitim oyunları'], ['stellarium', 'Stellarium', 'Planetaryum'], ['kalzium', 'Kalzium', 'Periyodik tablo'],
    ['marble', 'Marble', 'Dünya atlası'], ['tuxpaint', 'Tux Paint', 'Çocuklar için çizim'], ['kstars', 'KStars', 'Gökyüzü haritası'], ['step', 'Step', 'Fizik simülasyonu']]],
  ['system', 'Sistem araçları', 'settings', [
    ['gparted', 'GParted', 'Disk bölümleme'], ['gnome-disk-utility', 'Diskler', 'Disk yönetimi'], ['baobab', 'Disk Kullanımı', 'Diskte yer kaplayanları bul'],
    ['timeshift', 'Timeshift', 'Sistem yedekleme'], ['bleachbit', 'BleachBit', 'Sistem temizleyici'], ['keepassxc', 'KeePassXC', 'Şifre yöneticisi'],
    ['synaptic', 'Synaptic', 'Gelişmiş paket yöneticisi'], ['htop', 'htop', 'Süreç izleyici'], ['fastfetch', 'fastfetch', 'Sistem bilgisi'], ['flatpak', 'Flatpak', 'Ek uygulama kaynağı']]],
];

/* Her tür için Debian bölümleri (Section) ve arama sözcükleri */
const CAT_META = {
  office:   { re: '(^|/)(text|editors|doc|tex)$', words: ['ofis', 'office', 'belge', 'pdf', 'tablo', 'sunum', 'word', 'excel', 'powerpoint', 'yazı', 'libreoffice', 'not'], en: 'office' },
  internet: { re: '(^|/)(web|mail|net|comm|httpd)$', words: ['internet', 'tarayıcı', 'browser', 'eposta', 'e-posta', 'mail', 'torrent', 'sohbet', 'mesaj', 'chat', 'web'], en: 'browser' },
  graphics: { re: '(^|/)graphics$', words: ['resim', 'fotoğraf', 'foto', 'çizim', 'grafik', 'photo', 'image', 'paint', 'tasarım', '3b', '3d'], en: 'image' },
  media:    { re: '(^|/)(sound|video)$', words: ['video', 'müzik', 'muzik', 'ses', 'film', 'music', 'audio', 'oynatıcı', 'player', 'kayıt'], en: 'player' },
  games:    { re: '(^|/)games$', words: ['oyun', 'oyunlar', 'game', 'games', 'yarış', 'strateji', 'bulmaca'], en: 'game' },
  dev:      { re: '(^|/)(devel|vcs|editors|interpreters|java|python|rust|golang|javascript)$', words: ['kod', 'yazılım', 'programlama', 'geliştirme', 'code', 'ide', 'editör', 'derleyici'], en: 'IDE' },
  edu:      { re: '(^|/)(education|science|math|electronics|hamradio)$', words: ['eğitim', 'egitim', 'okul', 'bilim', 'çocuk', 'cocuk', 'matematik', 'fizik', 'kimya', 'astronomi'], en: 'education' },
  system:   { re: '(^|/)(admin|utils|otherosfs|x11)$', words: ['sistem', 'disk', 'yedek', 'yedekleme', 'araç', 'temizle', 'şifre', 'system', 'backup'], en: 'utility' },
};
/* Debian deposunda bir türdeki TÜM grafik uygulamaları listeler: [paket, ad, açıklama] */
const ALL_CACHE = {};
async function allOfType(key) {
  if (ALL_CACHE[key]) return ALL_CACHE[key];
  const re = CAT_META[key].re;
  const out = await tryRun(`lists() { for f in /var/lib/apt/lists/*_Packages*; do [ -f "$f" ] || continue; case "$f" in *.lz4) lz4cat "$f";; *.gz) zcat "$f";; *.xz) xzcat "$f";; *) cat "$f";; esac; done; }
lists 2>/dev/null | awk -v re=${q(re)} 'BEGIN{RS="";FS="\\n"} { p="";s="";t=""; for(i=1;i<=NF;i++){ if($i~/^Package: /)p=substr($i,10); else if($i~/^Section: /)s=substr($i,10); else if($i~/^Tag: /){t=$i; while(i<NF && $(i+1)~/^ /){i++; t=t $i}} }
  if(p!="" && s~re){ g=(t~/(interface::x11|x11::application|uitoolkit::(gtk|qt|sdl))/)?1:(t==""?2:0); if(g) print g" "p } }' | sort -u > /tmp/tyros-cat-$$
if grep -q '^1 ' /tmp/tyros-cat-$$; then names=$(sed -n 's/^1 //p' /tmp/tyros-cat-$$); else names=$(sed -n 's/^2 //p' /tmp/tyros-cat-$$); fi
rm -f /tmp/tyros-cat-$$
[ -n "$names" ] && echo "$names" | head -n 600 | xargs apt-cache show --no-all-versions 2>/dev/null | awk '/^Package: /{p=$2} /^Description(-[A-Za-z_]+)?: /{sub(/^[^:]*: /,""); print p" - "$0}'`, 120);
  const noise = /^(lib|python3?-|golang-|node-|ruby-|r-cran-|texlive-|fonts?-|.*-(dev|dbg|doc|data|common|dbgsym|l10n-.*|help-.*|tests?)$)/;
  const seen = new Set();
  const res = out.split('\n').filter(Boolean).map(l => { const i = l.indexOf(' - '); return [l.slice(0, i), l.slice(0, i), l.slice(i + 3)]; })
    .filter(p => p[0] && !noise.test(p[0]) && !seen.has(p[0]) && seen.add(p[0]))
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (res.length) ALL_CACHE[key] = res;
  return res;
}

BUILTIN.store.launch = () => {
  const existing = [...WM.wins.values()].find(w => w.app.id === 'store');
  if (existing) { WM.focus(existing.id); return; }
  const side = h('nav', { class: 'st-side' });
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Uygulama ara (ör. gimp, oyun, video)…', style: { flex: 1 } });
  const main = h('div', { class: 'sto-main' });
  const status = h('div', { class: 'sto-status', hidden: true });
  const root = h('div', { class: 'st sto' }, side,
    h('div', { class: 'sto-right' }, h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn', title: 'Debian paket listesini indir', html: svgIcon('refresh') + 'Listeyi güncelle', onclick: () => job('update', '', 'Paket listesi güncelleniyor') })),
    main, status));
  WM.open({ app: BUILTIN.store, width: 960, height: 640, content: root, single: true });
  let installed = new Set(), available = null, view = 'home';

  side.append(h('button', { 'data-k': 'home', html: svgIcon('home') + '<span>Keşfet</span>', onclick: () => show('home') }));
  for (const [key, label, icon] of STORE_CATS) side.append(h('button', { 'data-k': key, html: svgIcon(icon) + `<span>${esc(label)}</span>`, onclick: () => show(key) }));
  side.append(h('button', { 'data-k': 'installed', html: svgIcon('package') + '<span>Yüklü olanlar</span>', onclick: () => show('installed') }));
  search.addEventListener('keydown', e => { if (e.key === 'Enter' && search.value.trim().length >= 2) doSearch(search.value.trim()); });
  setTimeout(() => search.focus(), 50);

  const allPkgs = STORE_CATS.flatMap(c => c[3].map(p => p[0]));
  async function refreshState() {
    const names = allPkgs.map(q).join(' ');
    const [inst, avail, lists] = await Promise.all([
      tryRun(`dpkg-query -W -f='\${Package} \${db:Status-Status}\\n' ${names} 2>/dev/null`),
      tryRun(`apt-cache show --no-all-versions ${names} 2>/dev/null | sed -n 's/^Package: //p'`),
      tryRun('ls /var/lib/apt/lists/ 2>/dev/null | grep -c _Packages'),
    ]);
    installed = new Set(inst.split('\n').filter(l => l.endsWith(' installed')).map(l => l.split(' ')[0]));
    available = new Set(avail.split('\n').filter(Boolean));
    return parseInt(lists, 10) || 0;
  }

  function card(pkg, name, desc) {
    const isIn = installed.has(pkg);
    const btn = isIn
      ? h('button', { class: 'btn danger', onclick: e => { e.stopPropagation(); job('remove', pkg, `${name} kaldırılıyor`); } }, 'Kaldır')
      : h('button', { class: 'btn primary', onclick: e => { e.stopPropagation(); job('install', pkg, `${name} kuruluyor`); } }, 'Kur');
    btn.dataset.pkg = pkg;
    return h('div', { class: 'sto-card' },
      appIcon({ name, icon: pkg }),
      h('div', { class: 'sto-info' }, h('div', { class: 'sto-name' }, name), h('div', { class: 'muted sto-desc', title: desc }, desc)),
      isIn ? h('span', { class: 'sto-badge' }, 'Yüklü') : null, btn);
  }

  async function show(key) {
    view = key;
    $$('button', side).forEach(b => b.classList.toggle('on', b.dataset.k === key));
    main.replaceChildren(h('div', { class: 'empty' }, 'Yükleniyor…'));
    const lists = await refreshState();
    if (view !== key) return;
    const notice = !lists ? h('div', { class: 'sto-notice' }, h('div', {}, h('b', {}, 'Paket listesi henüz indirilmedi.'), h('div', { class: 'muted' }, 'Uygulama kurabilmek için önce listeyi güncelle (internet gerekir).')),
      h('button', { class: 'btn primary', onclick: () => job('update', '', 'Paket listesi güncelleniyor') }, 'Şimdi güncelle')) : null;
    const usable = p => !lists || !available.size || available.has(p[0]) || installed.has(p[0]);
    if (key === 'home') {
      main.replaceChildren(...[notice,
        h('div', { class: 'sto-hero' }, h('img', { src: LOGO_URL, alt: '' }), h('div', {}, h('h2', {}, 'Uygulama Mağazası'),
          h('div', { class: 'muted' }, 'Debian deposundaki on binlerce uygulamadan istediğini kur. Kategorilere göz at ya da yukarıdan ara.'))),
        h('div', { class: 'sto-cats' }, STORE_CATS.map(([k, label, icon, list]) => h('button', { class: 'sto-cat', onclick: () => show(k) },
          h('span', { class: 'ico', html: svgIcon(icon) }), h('b', {}, label), h('span', { class: 'muted' }, `${list.filter(usable).length} uygulama`)))),
        h('h3', {}, 'Öne çıkanlar'),
        h('div', { class: 'sto-grid' }, [['vlc', 'VLC', 'Video ve müzik oynatıcı'], ['gimp', 'GIMP', 'Fotoğraf düzenleme'], ['libreoffice-writer', 'LibreOffice Writer', 'Kelime işlemci'],
          ['thunderbird', 'Thunderbird', 'E-posta'], ['obs-studio', 'OBS Studio', 'Ekran kaydı'], ['supertuxkart', 'SuperTuxKart', 'Araba yarışı']].filter(usable).map(p => card(...p)))].filter(Boolean));
    } else if (key === 'installed') {
      const mine = STORE_CATS.flatMap(c => c[3]).filter(p => installed.has(p[0]));
      main.replaceChildren(h('h3', {}, 'Bu bilgisayarda yüklü'), mine.length ? h('div', { class: 'sto-grid' }, mine.map(p => card(...p)))
        : h('div', { class: 'empty' }, 'Mağaza listesinden henüz bir şey kurulmamış.'));
    } else {
      const cat = STORE_CATS.find(c => c[0] === key);
      const allBox = h('div', {}, h('div', { class: 'empty' }, 'Bu türdeki tüm uygulamalar Debian deposundan okunuyor…'));
      main.replaceChildren(...[notice, h('h3', {}, cat[1]), h('h4', { class: 'muted' }, 'Önerilenler'),
        h('div', { class: 'sto-grid' }, cat[3].filter(usable).map(p => card(...p))), allBox].filter(Boolean));
      const curatedSet = new Set(cat[3].map(p => p[0]));
      const all = (await allOfType(key)).filter(p => !curatedSet.has(p[0]));
      if (view !== key) return;
      if (!all.length) { allBox.replaceChildren(h('div', { class: 'empty' }, lists ? 'Bu türde başka uygulama bulunamadı.' : 'Tüm uygulamaları görmek için önce paket listesini güncelle.')); return; }
      await markInstalled(all);
      if (view !== key) return;
      renderAll(allBox, `${cat[1]} türündeki tüm uygulamalar`, all);
    }
  }

  async function markInstalled(list) {
    for (let i = 0; i < list.length; i += 300) {
      const inst = await tryRun(`dpkg-query -W -f='\${Package} \${db:Status-Status}\\n' ${list.slice(i, i + 300).map(p => q(p[0])).join(' ')} 2>/dev/null`);
      inst.split('\n').filter(l => l.endsWith(' installed')).forEach(l => installed.add(l.split(' ')[0]));
    }
  }
  function renderAll(box, title, list) {
    const PAGE = 60;
    let shown = PAGE, filtered = list;
    const filter = h('input', { class: 'field', type: 'search', placeholder: 'Bu listede süz…', style: { width: '220px' } });
    const count = h('span', { class: 'muted' });
    const grid = h('div', { class: 'sto-grid' });
    const more = h('button', { class: 'btn sto-more', onclick: () => { shown += PAGE; draw(); } }, 'Daha fazla göster');
    const draw = () => {
      grid.replaceChildren(...filtered.slice(0, shown).map(p => card(...p)));
      count.textContent = `${filtered.length} uygulama`;
      more.hidden = shown >= filtered.length;
    };
    filter.addEventListener('input', () => {
      const t = filter.value.trim().toLocaleLowerCase('tr');
      filtered = t ? list.filter(p => (p[0] + ' ' + p[2]).toLocaleLowerCase('tr').includes(t)) : list;
      shown = PAGE; draw();
    });
    box.replaceChildren(h('div', { class: 'sto-allhead' }, h('h4', { class: 'muted' }, title), count, filter), grid, more);
    draw();
  }

  async function doSearch(term) {
    view = 'search';
    $$('button', side).forEach(b => b.classList.remove('on'));
    main.replaceChildren(h('div', { class: 'empty' }, 'Aranıyor…'));
    const t = term.toLowerCase();
    // Önce mağaza listesindeki eşleşmeler, sonra adında arama geçen paketler, en son açıklamada geçenler
    const tl = t.toLocaleLowerCase('tr');
    const catHit = STORE_CATS.find(c => c[1].toLocaleLowerCase('tr').includes(tl) || CAT_META[c[0]].words.some(w => w === tl || (tl.length >= 4 && w.startsWith(tl))));
    const curated = [...new Map([...(catHit ? catHit[3] : []), ...STORE_CATS.flatMap(c => c[3]).filter(p => (p[0] + ' ' + p[1] + ' ' + p[2]).toLocaleLowerCase('tr').includes(tl))].map(p => [p[0], p])).values()];
    const [byName, byDesc] = await Promise.all([
      tryRun(`apt-cache search --names-only -- ${q(term)} 2>/dev/null | head -n 60`),
      tryRun(`apt-cache search -- ${q(term)} 2>/dev/null | head -n 200`),
    ]);
    const parse = s => s.split('\n').filter(Boolean).map(l => { const i = l.indexOf(' - '); return [l.slice(0, i), l.slice(0, i), l.slice(i + 3)]; });
    const seen = new Set(curated.map(p => p[0]));
    // Kütüphane/geliştirme paketlerini gizle; asıl uygulamalar kalsın
    const noise = /^(lib|python3?-|golang-|node-|ruby-|r-cran-|texlive-|fonts?-|.*-(dev|dbg|doc|data|common|dbgsym|l10n-.*|help-.*)$)/;
    const nameHits = parse(byName).filter(p => !seen.has(p[0]) && !noise.test(p[0]));
    nameHits.forEach(p => seen.add(p[0]));
    const descHits = parse(byDesc).filter(p => !seen.has(p[0]) && !noise.test(p[0])).slice(0, 30);
    await refreshState().catch(() => {});
    const extra = [...nameHits, ...descHits];
    const inst = await tryRun(extra.length ? `dpkg-query -W -f='\${Package} \${db:Status-Status}\\n' ${extra.map(p => q(p[0])).join(' ')} 2>/dev/null` : 'true');
    inst.split('\n').filter(l => l.endsWith(' installed')).forEach(l => installed.add(l.split(' ')[0]));
    if (view !== 'search') return;
    const parts = [h('h3', {}, `"${term}" için sonuçlar`)];
    if (curated.length) parts.push(h('div', { class: 'sto-grid' }, curated.map(p => card(...p))));
    if (nameHits.length) parts.push(h('h4', { class: 'muted' }, 'Adında geçenler'), h('div', { class: 'sto-grid' }, nameHits.map(p => card(...p))));
    if (descHits.length) parts.push(h('h4', { class: 'muted' }, 'Açıklamasında geçenler'), h('div', { class: 'sto-grid' }, descHits.map(p => card(...p))));
    if (catHit) {
      const allBox = h('div', {}, h('div', { class: 'empty' }, `${catHit[1]} türündeki tüm uygulamalar okunuyor…`));
      parts.push(allBox);
      main.replaceChildren(...parts);
      const all = (await allOfType(catHit[0])).filter(p => !seen.has(p[0]));
      if (view !== 'search') return;
      await markInstalled(all);
      if (all.length) renderAll(allBox, `${catHit[1]} türündeki tüm uygulamalar`, all); else allBox.remove();
      return;
    }
    if (parts.length === 1) parts.push(h('div', { class: 'empty' }, `"${term}" için uygulama bulunamadı. Paket listesi boşsa önce "Listeyi güncelle"ye bas.`));
    main.replaceChildren(...parts);
  }

  async function job(action, pkg, title) {
    const id = Date.now().toString(36);
    const log = `/tmp/tyros-pkg-${id}.log`, rc = `/tmp/tyros-pkg-${id}.rc`;
    $$(`button[data-pkg="${pkg}"]`, main).forEach(b => { b.disabled = true; b.textContent = action === 'remove' ? 'Kaldırılıyor…' : 'Kuruluyor…'; });
    status.hidden = false; status.replaceChildren(h('div', { class: 'sto-spin' }), h('div', { class: 'sto-st' }, h('b', {}, title + '…'), h('pre', {}, '')));
    try {
      await run(`(sudo -n /usr/local/sbin/tyros-pkg ${action} ${pkg ? q(pkg) : ''} >${log} 2>&1; echo $? >${rc}) >/dev/null 2>&1 &`);
    } catch (e) { status.hidden = true; return fail(e); }
    const poll = setInterval(async () => {
      const out = await tryRun(`tail -n 4 ${log} 2>/dev/null; echo "@@"; cat ${rc} 2>/dev/null`);
      const [txt, code] = out.split('@@');
      $('pre', status).textContent = (txt || '').trim().split('\n').slice(-3).join('\n');
      if (code && code.trim() !== '') {
        clearInterval(poll);
        tryRun(`rm -f ${log} ${rc}`);
        status.hidden = true;
        if (code.trim() === '0') {
          notify('Tamamlandı', title.replace('kuruluyor', 'kuruldu').replace('kaldırılıyor', 'kaldırıldı').replace('güncelleniyor', 'güncellendi'));
          Shell.loadApps(true);
        } else {
          notify('İşlem başarısız', (txt || '').trim().split('\n').slice(-2).join(' ') || 'Ayrıntı yok', true, 8000);
        }
        if (view === 'search' && search.value.trim()) doSearch(search.value.trim()); else show(view);
      }
    }, 1200);
  }

  show('home');
};
})();
