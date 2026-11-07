/* TyrOS — Windows tarzı hızlı ayarlar paneli, sürücüler (USB/disk) ve gece ışığı.
   tyros-apps.js'ten sonra, shell.js'ten önce yüklenir. */
(() => {
'use strict';

const sh = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ex = async (cmd, timeout = 30) => {
  try { return await API.post('/api/exec', { cmd, timeout }); } catch (e) { return { code: 1, stdout: '', stderr: e.message }; }
};
const out = async (cmd, timeout) => (await ex(cmd, timeout)).stdout || '';

/* ---------------------------------------------------------------- simgeler */
Object.assign(ICONS, {
  bt: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  plane: '<path d="M10.5 3.5c0-1 .7-1.5 1.5-1.5s1.5.5 1.5 1.5V9l7 4v2l-7-2v4.5l2 1.5v1.5l-3.5-1-3.5 1V19l2-1.5V13l-7 2v-2l7-4z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/><path d="M4 4l16 16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  eject: '<path d="M12 5l7 8H5z"/><path d="M5 18h14"/>',
  usb: '<path d="M12 21V5"/><path d="M9 7l3-4 3 4"/><path d="M12 15l-5-3V9"/><path d="M12 13l5-3V8"/><rect x="5.5" y="7.5" width="3" height="2"/><circle cx="17" cy="7" r="1.3"/><circle cx="12" cy="20" r="1.6"/>',
  disk: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="16.5" cy="12" r="1.2"/><path d="M6.5 12h5"/>',
  hotspot: '<circle cx="12" cy="12" r="1.8"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
});

/* ---------------------------------------------------------------- ekran: parlaklık + gece ışığı */
const NIGHT_GAMMA = '1:0.82:0.62';
const Display = {
  async outputs() { return (await out("xrandr --query 2>/dev/null | awk '/ connected/{print $1}'")).split('\n').filter(Boolean); },
  async apply() {
    const d = Settings.data;
    const gamma = d.nightLight ? NIGHT_GAMMA : '1:1:1';
    for (const o of await this.outputs()) {
      const b = d.output === o && d.brightness ? Number(d.brightness) : 1;
      await ex(`xrandr --output ${sh(o)} --gamma ${gamma} --brightness ${b}`);
    }
  },
  // Gerçek arka ışık (dizüstü) varsa brightnessctl, yoksa yazılımla (xrandr)
  async getBrightness() {
    const m = (await out('brightnessctl -m 2>/dev/null')).split(',');
    if (m.length >= 4 && m[1] === 'backlight') return { hw: true, value: parseInt(m[3], 10) || 100 };
    return { hw: false, value: Math.round((Number(Settings.data.brightness) || 1) * 100) };
  },
  async setBrightness(v, hw) {
    if (hw) { await ex(`brightnessctl -q set ${Math.max(5, v)}%`); return; }
    const o = Settings.data.output || (await this.outputs())[0];
    if (!o) return;
    const b = Math.max(0.4, v / 100);
    await ex(`xrandr --output ${sh(o)} --gamma ${Settings.data.nightLight ? NIGHT_GAMMA : '1:1:1'} --brightness ${b}`);
    Settings.set({ output: o, brightness: b });
  },
};

/* ---------------------------------------------------------------- sürücüler (USB / diskler) */
const HIDE_FS = new Set(['', 'swap', 'squashfs', 'LVM2_member', 'crypto_LUKS', 'linux_raid_member']);
const HIDE_PARTTYPE = /EFI System|BIOS boot|Microsoft reserved|Windows recovery|Linux swap/i;
const Drives = {
  list: [],
  async scan() {
    let j;
    try {
      j = JSON.parse(await out('lsblk -J -l -b -o NAME,PATH,PKNAME,SIZE,TYPE,RM,HOTPLUG,TRAN,MOUNTPOINT,LABEL,FSTYPE,MODEL,PARTTYPENAME,VENDOR 2>/dev/null', 10) || '{}');
    } catch { return this.list; }
    const devs = j.blockdevices || [];
    const byName = Object.fromEntries(devs.map(d => [d.name, d]));
    const res = [];
    for (const d of devs) {
      if (!['part', 'disk'].includes(d.type)) continue;
      if (d.type === 'disk' && devs.some(x => x.pkname === d.name)) continue;    // bölümleri olan disk
      const fs = d.fstype || '';
      if (HIDE_FS.has(fs) || HIDE_PARTTYPE.test(d.parttypename || '')) continue;
      const mp = d.mountpoint || '';
      if (mp === '/' || mp === '[SWAP]' || mp.startsWith('/boot') || mp.startsWith('/run/live') || mp.startsWith('/lib/live')) continue;
      if (/^(loop|zram|sr|ram)/.test(d.name)) continue;
      const parent = byName[d.pkname] || d;
      // canlı USB'nin kendisi (ISO bölümü ve yanındaki küçük EFI imajı)
      if (devs.some(x => (x.pkname === parent.name || x.name === parent.name) && (x.mountpoint || '').startsWith('/run/live'))) continue;
      const removable = !!(parent.rm || parent.hotplug || parent.tran === 'usb' || d.rm || d.hotplug);
      const model = [parent.vendor, parent.model].filter(Boolean).join(' ').trim();
      res.push({
        path: d.path, parent: parent.path, size: Number(d.size) || 0, fs, mount: mp, removable,
        name: d.label || model || (removable ? 'USB sürücü' : 'Yerel disk'),
      });
    }
    this.list = res;
    return res;
  },
  async open(dr) { BUILTIN.files.launch(await this.mount(dr)); },
  async mount(dr) {
    let mp = dr.mount;
    if (!mp) {
      const r = await ex(`udisksctl mount -b ${sh(dr.path)} --no-user-interaction 2>&1`, 40);
      const m = /at (\/.+?)\.?\s*$/m.exec(r.stdout || '');
      if (!m) throw new Error((r.stdout || r.stderr || 'Sürücü bağlanamadı').trim().split('\n').pop());
      mp = m[1]; dr.mount = mp;
    }
    return mp;
  },
  async eject(dr) {
    if (dr.mount) {
      const r = await ex(`udisksctl unmount -b ${sh(dr.path)} --no-user-interaction 2>&1`, 40);
      if (r.code !== 0) throw new Error(/busy|meşgul/i.test(r.stdout || '') ? 'Sürücü kullanımda. Açık dosyaları kapatıp tekrar dene.' : (r.stdout || 'Çıkarılamadı').trim().split('\n').pop());
    }
    if (dr.removable) await ex(`udisksctl power-off -b ${sh(dr.parent)} --no-user-interaction 2>&1`, 30);
    notify('Güvenle çıkarılabilir', `${dr.name} artık çıkarılabilir.`);
    Drives.changed();
  },
  label(dr) { return `${dr.name} · ${fmtBytes(dr.size)}`; },
  listeners: new Set(),
  changed() { this.scan().then(l => this.listeners.forEach(fn => fn(l))); },
};
window.TyDrives = Drives;
window.TyDisplay = Display;

// Takılan USB'leri yakala: yeni sürücü gelince bağla ve haber ver
async function watchDrives() {
  let known = null, sig = null, pending = 1;
  const tick = async () => {
    // Ucuz imza kontrolü: bir şey takılıp çıkarılmadıkça ayrıntılı tarama yapma.
    // Değişince birkaç tur daha tara (yeni takılan USB'nin dosya sistemi birkaç saniyede tanınır).
    try {
      const g = (await API.get('/api/blockgen')).sig;
      if (g !== sig) { sig = g; pending = 3; }
    } catch { pending = Math.max(pending, 1); }
    if (pending <= 0) return;
    pending--;
    const l = await Drives.scan();
    const keys = new Set(l.map(d => d.path));
    if (known) {
      const added = l.filter(d => !known.has(d.path) && d.removable);
      for (const d of added) {
        if (!d.mount) await ex(`udisksctl mount -b ${sh(d.path)} --no-user-interaction 2>&1`, 40).then(r => {
          const m = /at (\/.+?)\.?\s*$/m.exec(r.stdout || ''); if (m) d.mount = m[1];
        });
        notify('USB sürücü takıldı', `${Drives.label(d)} — açmak için tıkla`);
        const t = $('#toasts')?.lastElementChild;
        if (t) { t.style.cursor = 'pointer'; t.addEventListener('click', () => { t.remove(); Drives.open(d).catch(fail); }); }
      }
      Drives.listeners.forEach(fn => fn(l));
    }
    known = keys;
  };
  let busy = false;
  const safeTick = async () => { if (busy) return; busy = true; try { await tick(); } catch { /* sonraki tur */ } busy = false; };
  await safeTick();
  setInterval(safeTick, 2000);
}

/* ---------------------------------------------------------------- hızlı panel */
const QP = {
  st: {},
  async state() {
    const t = await out(`
      echo "wifi=$(timeout 3 nmcli radio wifi 2>/dev/null)"
      echo "wifidev=$(timeout 3 nmcli -t -f DEVICE,TYPE dev 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}')"
      echo "ssid=$(timeout 3 nmcli -t -f ACTIVE,SSID dev wifi list --rescan no 2>/dev/null | awk -F: '$1=="yes"{print $2; exit}')"
      echo "wired=$(timeout 3 nmcli -t -f TYPE,STATE dev 2>/dev/null | grep -c '^ethernet:connected')"
      echo "bt=$(timeout 2 bluetoothctl show 2>/dev/null | awk '/Powered:/{print $2; exit}')"
      echo "rf=$(rfkill -n -o SOFT 2>/dev/null | sort -u | tr '\\n' ' ')"
      echo "hot=$(timeout 3 nmcli -t -f NAME con show --active 2>/dev/null | grep -cx TyrOS-Hotspot)"
    `, 15);
    const s = {};
    for (const line of t.split('\n')) { const i = line.indexOf('='); if (i > 0) s[line.slice(0, i)] = line.slice(i + 1).trim(); }
    s.wifiOn = s.wifi === 'enabled';
    s.btFound = s.bt === 'yes' || s.bt === 'no';
    s.btOn = s.bt === 'yes';
    s.plane = s.rf ? s.rf.trim() === 'blocked' : !!Settings.data.airplane;
    s.wiredOn = Number(s.wired) > 0;
    s.hotOn = Number(s.hot) > 0;
    return (this.st = s);
  },

  build() {
    const qp = $('#quickPanel');
    qp.innerHTML = '';
    qp.classList.add('qp2');
    this.tiles = h('div', { class: 'qp-tiles' });
    this.bright = h('input', { type: 'range', id: 'qpBright', min: 5, max: 100, value: 100 });
    const vol = h('input', { type: 'range', id: 'qpVolume', min: 0, max: 100, value: 50 });
    const mute = h('button', { id: 'qpMute', class: 'qp-mini', title: 'Sesi kapat/aç' });
    this.drives = h('div', { class: 'qp-drives' });
    this.batt = h('span', { class: 'qp-batt' });
    this.user = h('span', { class: 'qp-user' });
    const powerMenu = h('div', { class: 'qp-powermenu', hidden: true },
      h('button', { onclick: () => Shell.power('logout') }, 'Oturumu kapat'),
      h('button', { onclick: () => Shell.power('reboot') }, 'Yeniden başlat'),
      h('button', { class: 'danger', onclick: () => Shell.power('shutdown') }, 'Bilgisayarı kapat'));
    qp.append(
      this.tiles,
      h('div', { class: 'qp-row' }, h('span', { class: 'qp-ico', title: 'Parlaklık', html: svgIcon('sun') }), this.bright),
      h('div', { class: 'qp-row' }, mute, vol),
      this.drives,
      h('div', { class: 'qp-foot' },
        h('div', { class: 'qp-foot-l' }, this.user, this.batt),
        h('div', { class: 'qp-foot-r' },
          h('button', { class: 'qp-round', title: 'Tüm ayarlar', 'aria-label': 'Tüm ayarlar', html: svgIcon('gear'),
            onclick: () => { Shell.closePopups(); BUILTIN.settings.launch(); } }),
          h('button', { class: 'qp-round', title: 'Güç', 'aria-label': 'Güç seçenekleri', html: svgIcon('power'),
            onclick: e => { e.stopPropagation(); powerMenu.hidden = !powerMenu.hidden; } }),
          powerMenu)));
    this.bright.addEventListener('change', () => Display.setBrightness(Number(this.bright.value), this.hwBright).catch(fail));
    Drives.listeners.add(() => { if (!qp.hidden) this.renderDrives(); });
  },

  tile({ icon, label, sub, on, disabled, onToggle, onMore }) {
    const t = h('div', { class: 'qp-tile' + (on ? ' on' : '') + (disabled ? ' dis' : '') },
      h('button', { class: 'qp-tmain', disabled: !!disabled, title: label, onclick: onToggle },
        h('span', { class: 'qp-ti', html: svgIcon(icon) }),
        h('span', { class: 'qp-tt' }, h('b', {}, label), h('small', {}, sub || ''))),
      onMore ? h('button', { class: 'qp-tmore', title: `${label} ayarları`, html: svgIcon('chev'), onclick: () => { Shell.closePopups(); onMore(); } }) : null);
    return t;
  },

  renderTiles() {
    const s = this.st, d = Settings.data;
    const settings = k => BUILTIN.settings.launch(k);
    const busy = async (fn) => { try { await fn(); } catch (e) { fail(e); } await this.state(); this.renderTiles(); Shell.refreshTray?.(); };
    const tiles = [];
    if (s.wifidev) {
      tiles.push(this.tile({ icon: 'wifi', label: 'Wi-Fi', on: s.wifiOn && !s.plane,
        sub: !s.wifiOn ? 'Kapalı' : s.ssid || (s.wiredOn ? 'Kablolu bağlı' : 'Bağlı değil'),
        onToggle: () => busy(() => ex(`nmcli radio wifi ${s.wifiOn ? 'off' : 'on'}`)), onMore: () => settings('net') }));
    } else {
      tiles.push(this.tile({ icon: s.wiredOn ? 'wired' : 'nonet', label: s.wiredOn ? 'Ethernet' : 'Ağ', on: s.wiredOn,
        sub: s.wiredOn ? 'Bağlı' : 'Bağlı değil', onToggle: () => { Shell.closePopups(); settings('net'); }, onMore: () => settings('net') }));
    }
    tiles.push(this.tile({ icon: 'bt', label: 'Bluetooth', on: s.btOn, disabled: !s.btFound && !s.plane,
      sub: !s.btFound ? (s.plane ? 'Kapalı' : 'Aygıt yok') : s.btOn ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (!s.btOn) await ex('rfkill unblock bluetooth 2>/dev/null; sleep 1');
        await ex(`timeout 5 bluetoothctl power ${s.btOn ? 'off' : 'on'}`);
      }), onMore: () => settings('bluetooth') }));
    tiles.push(this.tile({ icon: 'plane', label: 'Uçak modu', on: s.plane, sub: s.plane ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (s.plane) { await ex('rfkill unblock all 2>/dev/null; nmcli radio all on 2>/dev/null'); Settings.set({ airplane: false }); }
        else { await ex('nmcli radio all off 2>/dev/null; rfkill block all 2>/dev/null'); Settings.set({ airplane: true }); }
      }) }));
    tiles.push(this.tile({ icon: 'moon', label: 'Gece ışığı', on: !!d.nightLight, sub: d.nightLight ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => { await Settings.set({ nightLight: !d.nightLight }); await Display.apply(); }) }));
    tiles.push(this.tile({ icon: 'bell', label: 'Rahatsız etme', on: !!d.quietNotify, sub: d.quietNotify ? 'Açık' : 'Kapalı',
      onToggle: () => busy(() => Settings.set({ quietNotify: !d.quietNotify })), onMore: () => settings('notify') }));
    tiles.push(this.tile({ icon: 'hotspot', label: 'Etkin nokta', on: s.hotOn, disabled: !s.wifidev,
      sub: !s.wifidev ? 'Wi-Fi yok' : s.hotOn ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (s.hotOn) { await ex('nmcli connection down TyrOS-Hotspot'); return; }
        const pass = 'tyros' + Math.random().toString().slice(2, 8);
        const r = await ex(`nmcli device wifi hotspot ifname ${sh(s.wifidev)} con-name TyrOS-Hotspot ssid TyrOS password ${pass} 2>&1`, 30);
        if (r.code !== 0) throw new Error('Wi-Fi kartın etkin noktayı desteklemiyor olabilir.');
        notify('Etkin nokta açık', `Ağ adı: TyrOS · Şifre: ${pass}`, false, 15000);
      }) }));
    this.tiles.replaceChildren(...tiles);
  },

  renderDrives() {
    const l = Drives.list.filter(d => d.removable);
    this.drives.replaceChildren();
    if (!l.length) return;
    this.drives.append(h('div', { class: 'qp-dtitle' }, 'Takılı sürücüler'));
    for (const d of l) {
      this.drives.append(h('div', { class: 'qp-drive' },
        h('span', { class: 'qp-ti', html: svgIcon('usb') }),
        h('button', { class: 'qp-dname', title: 'Dosyalar\'da aç', onclick: () => { Shell.closePopups(); Drives.open(d).catch(fail); } },
          h('b', {}, d.name), h('small', {}, `${fmtBytes(d.size)}${d.fs ? ' · ' + d.fs.toUpperCase() : ''}`)),
        h('button', { class: 'qp-mini', title: 'Güvenle çıkar', html: svgIcon('eject'), onclick: () => Drives.eject(d).catch(fail) })));
    }
  },

  async open() {
    $('.qp-powermenu', $('#quickPanel')).hidden = true;
    this.user.textContent = $('#smUser')?.textContent || '';
    this.renderTiles();
    this.renderDrives();
    const b = await Display.getBrightness();
    this.hwBright = b.hw; this.bright.value = b.value;
    await this.state();
    this.renderTiles();
    try {
      const s = await API.get('/api/sysinfo');
      this.batt.innerHTML = s.battery ? `${svgIcon('power')}%${s.battery.percent}${s.battery.status === 'Charging' ? ' · şarj oluyor' : ''}` : '';
    } catch { /* yok */ }
  },
};

window.addEventListener('DOMContentLoaded', () => {
  QP.build();
  Shell.toggleQuick = function () {
    const qp = $('#quickPanel');
    const open = qp.hidden;
    this.closePopups();
    qp.hidden = !open;
    $('#tray').classList.toggle('on', open);
    if (!open) return;
    const v = this.vol || {};
    $('#qpVolume').disabled = !v.available;
    $('#qpVolume').value = Math.round((v.level || 0) * 100);
    $('#qpMute').innerHTML = svgIcon(v.muted ? 'mute' : 'vol');
    QP.open().catch(() => {});
  };
  // Paneldeki güç menüsünü dışarı tıklayınca kapat
  document.addEventListener('pointerdown', e => {
    const m = $('.qp-powermenu'); if (m && !m.hidden && !e.target.closest('.qp-powermenu, .qp-round')) m.hidden = true;
  });
  setTimeout(() => {
    if (Settings.data.nightLight) Display.apply();
    watchDrives();
  }, 2500);
});
})();
