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
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
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
// Bazı araçlar yoldaki boşluk ve Türkçe harfleri \x20 / \040 gibi kaçışlarla yazar: gerçek yola çevir
function unesc(p) {
  if (!p || !/\\(x[0-9a-fA-F]{2}|[0-7]{3})/.test(p)) return p;
  const bytes = [];
  for (let i = 0; i < p.length; i++) {
    const m = /^\\(?:x([0-9a-fA-F]{2})|([0-7]{3}))/.exec(p.slice(i));
    if (m) { bytes.push(m[1] ? parseInt(m[1], 16) : parseInt(m[2], 8)); i += m[0].length - 1; }
    else for (const b of new TextEncoder().encode(p[i])) bytes.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
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
      const mp = unesc(d.mountpoint) || '';
      if (mp === '/' || mp === '[SWAP]' || mp.startsWith('/boot') || mp.startsWith('/run/live') || mp.startsWith('/lib/live')) continue;
      if (/^(loop|zram|sr|ram)/.test(d.name)) continue;
      const parent = byName[d.pkname] || d;
      // canlı USB'nin kendisi (ISO bölümü ve yanındaki küçük EFI imajı)
      if (devs.some(x => (x.pkname === parent.name || x.name === parent.name) && (x.mountpoint || '').startsWith('/run/live'))) continue;
      const removable = !!(parent.rm || parent.hotplug || parent.tran === 'usb' || d.rm || d.hotplug);
      const model = [parent.vendor, parent.model].filter(Boolean).join(' ').trim();
      const full = d.label || model || (removable ? 'USB bellek' : 'Yerel disk');
      res.push({
        path: d.path, parent: parent.path, size: Number(d.size) || 0, fs, mount: mp, removable, full,
        name: full.length > 26 ? full.slice(0, 25).trim() + '…' : full,   // çok uzun adlar taşmasın
      });
    }
    // Android telefon / tablet (MTP): disk gibi görünmez, ayrıca bakılır
    for (const ph of await this.phones()) res.push(ph);
    this.list = res;
    return res;
  },
  async phones() {
    const o = await out(`command -v jmtpfs >/dev/null || exit 0
      echo "M=$(awk '$3 ~ /jmtpfs|fuse.jmtpfs/ {print $2; exit}' /proc/mounts)"
      timeout 6 jmtpfs -l 2>/dev/null | grep -E '^[0-9]+, *[0-9]+,' | sed 's/^/D=/'`, 12);
    const mnt = (/^M=(.*)$/m.exec(o) || [])[1] || '';
    const list = o.split('\n').filter(l => l.startsWith('D=')).map(l => {
      // jmtpfs -l: "busLocation, devNum, productId, vendorId, product, vendor"
      const f = l.slice(2).split(',').map(x => x.trim());
      const id = `${f[0]}:${f[1]}`, product = f[4] || '', vendor = f.slice(5).join(',');
      const full = (product || '').trim() || (vendor || '').split(/[ ,]/)[0] || 'Telefon';
      return { path: 'mtp:' + full, mtp: true, removable: true, fs: 'mtp', size: 0, mount: unesc(mnt), full, id,
        name: full.length > 26 ? full.slice(0, 25).trim() + '…' : full };
    });
    // Telefon açıkken jmtpfs onu meşgul gördüğü için listede çıkmayabilir: son bilineni göster
    if (!list.length && mnt) return (this._phones || [{ path: 'mtp:Telefon', mtp: true, removable: true, fs: 'mtp', size: 0, full: 'Telefon', name: 'Telefon' }]).map(p => ({ ...p, mount: unesc(mnt) }));
    this._phones = list;
    return list;
  },
  async open(dr) { BUILTIN.files.launch(await this.mount(dr)); },
  // "Mounted /dev/sdb1 at /media/tyros/USB" ya da "already mounted at `/media/...'" çıktısından yolu al
  mountPath(t) { const m = /\bat\s+[`']?(\/[^`'\n]+?)[`']?\.?\s*$/m.exec(t || ''); return m ? m[1] : null; },
  // Sürücünün gerçek bağlama yolunu lsblk'ten oku (JSON: boşluklu/Türkçe adlar bozulmaz)
  async mountedAt(dev) {
    try {
      const j = JSON.parse(await out(`lsblk -J -o MOUNTPOINT ${sh(dev)} 2>/dev/null`, 10) || '{}');
      const mp = unesc((j.blockdevices || [])[0]?.mountpoint);
      return mp && mp.startsWith('/') && mp !== '[SWAP]' ? mp : null;
    } catch { return null; }
  },
  async mount(dr) {
    if (dr.mtp) {
      if (dr.mount) return dr.mount;
      const r = await ex('mkdir -p "$HOME/Telefon" && jmtpfs "$HOME/Telefon" 2>&1 && echo "OK=$HOME/Telefon"', 40);
      const m = /OK=(.*)/.exec(r.stdout || '');
      if (!m || !(await out(`ls -A ${sh(m[1])} 2>/dev/null | head -n1`))) {
        await ex('fusermount -u "$HOME/Telefon" 2>/dev/null || fusermount3 -u "$HOME/Telefon" 2>/dev/null');
        throw new Error('Telefonun kilidini aç ve bildirimlerden USB modunu "Dosya aktarımı" yap, sonra tekrar dene.');
      }
      dr.mount = m[1];
      return dr.mount;
    }
    // Önceden bilinen yol hâlâ geçerli mi?
    let mp = await this.mountedAt(dr.path);
    if (!mp) {
      const r = await ex(`LC_ALL=C udisksctl mount -b ${sh(dr.path)} --no-user-interaction 2>&1`, 40);
      mp = await this.mountedAt(dr.path);
      if (!mp) {
        // udisks izin vermedi ya da açamadı: TyrOS'un kendi yardımcısıyla dene
        const r2 = await ex(`sudo -n /usr/local/sbin/tyros-mount mount ${sh(dr.path)} 2>&1`, 60);
        mp = await this.mountedAt(dr.path);
        if (!mp) throw new Error((r2.stdout || r.stdout || 'Sürücü açılamadı').trim());
      }
    }
    dr.mount = mp;
    return mp;
  },
  async eject(dr) {
    if (dr.mtp) {
      await ex('fusermount -u "$HOME/Telefon" 2>/dev/null || fusermount3 -u "$HOME/Telefon" 2>/dev/null; rmdir "$HOME/Telefon" 2>/dev/null');
      dr.mount = '';
      notify('Telefon çıkarılabilir', `${dr.name} bağlantısı güvenle kesildi.`);
      Drives.changed();
      return;
    }
    if (dr.mount) {
      const r = await ex(`LC_ALL=C udisksctl unmount -b ${sh(dr.path)} --no-user-interaction 2>&1`, 40);
      if (r.code !== 0) {
        if (/busy|meşgul/i.test(r.stdout || '')) throw new Error('target is busy');
        const r2 = await ex(`sudo -n /usr/local/sbin/tyros-mount unmount ${sh(dr.path)} 2>&1`, 40);
        if (r2.code !== 0) throw new Error((r2.stdout || r.stdout || 'Çıkarılamadı').trim());
      }
      dr.mount = '';
    }
    if (dr.removable) await ex(`LC_ALL=C udisksctl power-off -b ${sh(dr.parent)} --no-user-interaction 2>&1`, 30);
    notify('Güvenle çıkarılabilir', `${dr.name} artık çıkarılabilir.`);
    Drives.changed();
  },
  label(dr) { return `${dr.name} · ${fmtBytes(dr.size)}`; },
  // Herkesin anlayacağı kısa açıklama: "7,5 GB · USB bellek · FAT32"
  describe(dr) {
    const FS = { vfat: 'FAT32', exfat: 'exFAT', ntfs: 'NTFS (Windows)', ntfs3: 'NTFS (Windows)', ext4: 'Linux', ext3: 'Linux', ext2: 'Linux', btrfs: 'Linux', xfs: 'Linux', iso9660: 'CD/DVD kalıbı', hfsplus: 'Mac' };
    if (dr.mtp) return ['Telefon / tablet', dr.mount ? 'Açık' : 'Açmak için tıkla'].join(' · ');
    return [fmtBytes(dr.size), dr.removable ? 'USB bellek' : 'Bilgisayardaki disk', FS[dr.fs] || (dr.fs || '').toUpperCase(), dr.mount ? 'Açık' : '']
      .filter(Boolean).join(' · ');
  },
  listeners: new Set(),
  changed() { this.scan().then(l => this.listeners.forEach(fn => fn(l))); },
};
window.TyDrives = Drives;
window.TyDisplay = Display;

// Takılan USB'leri yakala: yeni sürücü gelince bağla ve haber ver
/* Sistem değişiklikleri (ağ, Wi-Fi, Bluetooth, uçak modu, yeni kurulan uygulama) anında arayüze yansısın.
   API her değişiklikte imzayı değiştirir; arayüz saniyede bir bu ucuz imzaya bakar. */
const TyLive = {
  t: null,
  net() {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      Shell.refreshTray?.();
      if (!$('#quickPanel').hidden) QP.state().then(() => QP.renderTiles()).catch(() => {});
      window.dispatchEvent(new Event('tyros-net'));
    }, 250);
  },
};
window.TyLive = TyLive;

/* Ekran klavyesi: yazı alanına dokununca kendiliğinden açılır, alandan çıkınca kapanır.
   Ayarlar > Klavye ve dil: "Dokununca" (varsayılan; fareyle tıklayınca açılmaz), "Her zaman", "Kapalı". */
const TyOSK = {
  ptr: '', ptrT: 0, auto: false, ht: null,
  note(type) { this.ptr = type; this.ptrT = Date.now(); },
  isText(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return !el.readOnly;
    if (el.tagName === 'INPUT') return !el.readOnly && !el.disabled && !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(el.type);
    return el.tagName === 'IFRAME' && /\/term\//.test(el.getAttribute('src') || '');
  },
  dbus(m) { return `dbus-send --session --print-reply --reply-timeout=2000 --type=method_call --dest=org.onboard.Onboard /org/onboard/Onboard/Keyboard org.onboard.Onboard.Keyboard.${m} >/dev/null 2>&1`; },
  // Açıksa göster, kapalıysa başlat (gizlenmiş klavye hemen geri gelir)
  showCmd() { return `command -v onboard >/dev/null || exit 0; if pgrep -u "$(id -u)" -x onboard >/dev/null; then ${this.dbus('Show')} || { pkill -u "$(id -u)" -x onboard; sleep 0.3; (setsid -f onboard >/dev/null 2>&1 &); }; else (setsid -f onboard >/dev/null 2>&1 &); fi; sleep 0.8`; },
  hideCmd() { return `${this.dbus('Hide')} || pkill -u "$(id -u)" -x onboard; true`; },
  refreshTile() { if (!$('#quickPanel').hidden) setTimeout(() => QP.state().then(() => QP.renderTiles()).catch(() => {}), 1200); },
  show() {
    this.auto = true;
    API.post('/api/exec', { cmd: this.showCmd(), timeout: 10 }).catch(() => {}).finally(() => this.refreshTile());
  },
  hide() {
    if (!this.auto) return;                 // elle açılan klavyeye dokunma
    this.auto = false;
    API.post('/api/exec', { cmd: this.hideCmd(), timeout: 10 }).catch(() => {}).finally(() => this.refreshTile());
  },
};
window.TyOSK = TyOSK;
document.addEventListener('pointerdown', e => TyOSK.note(e.pointerType), true);
document.addEventListener('focusin', e => {
  const mode = Settings.data.oskAuto || 'touch';
  if (mode === 'off' || !TyOSK.isText(e.target)) return;
  if (mode === 'touch' && !(TyOSK.ptr === 'touch' && Date.now() - TyOSK.ptrT < 1500)) return;
  clearTimeout(TyOSK.ht);
  TyOSK.show();
});
document.addEventListener('focusout', e => {
  if (!TyOSK.isText(e.target)) return;
  clearTimeout(TyOSK.ht);
  TyOSK.ht = setTimeout(() => { if (!TyOSK.isText(document.activeElement)) TyOSK.hide(); }, 500);
});
async function watchDrives() {
  let known = null, sig = null, pending = 1, netSig = null, appSig = null, winSig = null, deskSig = null;
  const tick = async () => {
    // Ucuz imza kontrolü: bir şey takılıp çıkarılmadıkça ayrıntılı tarama yapma.
    // Değişince birkaç tur daha tara (yeni takılan USB'nin dosya sistemi birkaç saniyede tanınır).
    try {
      // Tek yoklama: kısayol tuşları, pencereler, masaüstü, ağ ve diskler (saniyede bir, alt süreç başlatmadan)
      const r = await API.get('/api/tick');
      if (r.events && r.events.length) handleEvents(r.events);
      if (r.win !== undefined && r.win !== winSig) { if (winSig !== null) Shell.pollNativeWindows?.(); winSig = r.win; }
      if (r.desk !== undefined && r.desk !== deskSig) { if (deskSig !== null) window.dispatchEvent(new Event('tyros-desk')); deskSig = r.desk; }
      if (r.sig !== sig) { sig = r.sig; pending = 3; }
      if (r.net !== undefined && r.net !== netSig) { if (netSig !== null) TyLive.net(); netSig = r.net; }
      if (r.apps !== undefined && r.apps !== appSig) { if (appSig !== null) Shell.loadApps(true); appSig = r.apps; }
    } catch { pending = Math.max(pending, 1); }
    if (pending <= 0) return;
    pending--;
    const l = await Drives.scan();
    const keys = new Set(l.map(d => d.path));
    if (known) {
      const added = l.filter(d => !known.has(d.path) && d.removable);
      for (const d of added) {
        if (!d.mtp) await Drives.mount(d).catch(() => {});   // açılamazsa tıklanınca tekrar denenir ve sebebi gösterilir
        window.TySound?.play('plug', true);
        if (d.mtp) notify('Telefon bağlandı', `${d.name} — dosyalarını açmak için tıkla (telefonda "Dosya aktarımı" seçili olmalı)`);
        else notify('USB sürücü takıldı', `${Drives.label(d)} — açmak için tıkla`);
        const t = $('#toasts')?.lastElementChild;
        if (t) { t.style.cursor = 'pointer'; t.addEventListener('click', () => { t.remove(); Drives.open(d).catch(fail); }); }
      }
      if ([...known].some(p => !keys.has(p) && /^(\/dev\/sd|mtp:)/.test(p))) window.TySound?.play('unplug');
      Drives.listeners.forEach(fn => fn(l));
    }
    known = keys;
  };
  let busy = false;
  const safeTick = async () => { if (busy) return; busy = true; try { await tick(); } catch { /* sonraki tur */ } busy = false; };
  await safeTick();
  setInterval(safeTick, 1000);
}

/* ---------------------------------------------------------------- kısayol tuşu olayları + ekran göstergesi */
function osd(icon, text, percent) {
  let el = $('#tyOsd');
  if (!el) { el = h('div', { id: 'tyOsd' }); document.body.append(el); }
  el.innerHTML = `${svgIcon(icon)}<span>${esc(text)}</span>` + (percent == null ? '' : `<i><b style="width:${Math.max(0, Math.min(100, percent))}%"></b></i>`);
  el.classList.add('on');
  clearTimeout(osd.t); osd.t = setTimeout(() => el.classList.remove('on'), 1400);
}
async function pollEvents() {
  let evs = [];
  try { evs = await API.get('/api/events'); } catch { return; }
  handleEvents(evs);
}
function handleEvents(evs) {
  for (const [type, val] of evs || []) {
    if (type === 'vol') {
      const m = /([\d.]+)/.exec(val || ''); const p = m ? Math.round(parseFloat(m[1]) * 100) : 0;
      const muted = /MUTED/.test(val || '');
      osd(muted ? 'mute' : 'vol', muted ? 'Ses kapalı' : `Ses %${p}`, muted ? 0 : p);
      Shell.refreshTray?.();
    } else if (type === 'bright') {
      const p = parseInt(val, 10) || 0; osd('sun', `Parlaklık %${p}`, p);
    } else if (type === 'shot') {
      window.TySound?.play('shot', true);
      notify('Ekran görüntüsü kaydedildi', `${(val || '').split('/').pop()} — açmak için tıkla`);
      const t = $('#toasts')?.lastElementChild;
      if (t) { t.style.cursor = 'pointer'; t.addEventListener('click', () => { t.remove(); API.post('/api/open', { path: val }).catch(fail); }); }
    }
  }
}
// Pil azalınca uyar (yalnızca pilde çalışırken)
let batWarned = 100;
async function checkBattery() {
  try {
    const b = (await API.get('/api/sysinfo')).battery;
    if (!b) return;
    if (b.status === 'Charging' || b.status === 'Full') { batWarned = 100; return; }
    if (b.percent <= 5 && batWarned > 5) { batWarned = 5; notify('Pil çok az', `%${b.percent} kaldı. Bilgisayar birazdan kapanabilir — hemen şarja tak.`, true, 15000); }
    else if (b.percent <= 15 && batWarned > 15) { batWarned = 15; notify('Pil azaldı', `%${b.percent} kaldı. Şarja takman önerilir.`, true, 10000); }
  } catch { /* sonraki tur */ }
}

/* ---------------------------------------------------------------- hızlı panel */
const QP = {
  st: {},
  async state() {
    // Ağ durumu API'den (dil ayarından bağımsız); diğerleri tek kabuk komutuyla, İngilizce çıktıyla
    const [t, n] = await Promise.all([out(`
      export LC_ALL=C.UTF-8
      echo "bt=$(timeout 2 bluetoothctl show 2>/dev/null | awk '/Powered:/{print $2; exit}')"
      echo "rf=$(rfkill -n -o SOFT 2>/dev/null | sort -u | tr '\\n' ' ')"
      echo "hot=$(timeout 3 nmcli -t -f NAME con show --active 2>/dev/null | grep -cx TyrOS-Hotspot)"
      echo "osk=$(pgrep -u "$(id -u)" -x onboard >/dev/null && { xdotool search --onlyvisible --class '[Oo]nboard' || xdotool search --onlyvisible --name '^Onboard'; } >/dev/null 2>&1 && echo 1)"
      echo "oskok=$(command -v onboard >/dev/null && echo 1)"
    `, 15), API.get('/api/netstate').catch(() => ({}))]);
    const s = {};
    for (const line of t.split('\n')) { const i = line.indexOf('='); if (i > 0) s[line.slice(0, i)] = line.slice(i + 1).trim(); }
    s.wifidev = n.wifidev || '';
    s.wifiOn = !!n.wifiOn;
    s.wifiBusy = n.wifi === 'connecting';
    s.ssid = n.wifi === 'connected' ? (n.ssid || 'Bağlı') : '';
    s.btFound = s.bt === 'yes' || s.bt === 'no';
    s.btOn = s.bt === 'yes';
    s.plane = s.rf ? s.rf.trim() === 'blocked' : !!Settings.data.airplane;
    s.wiredOn = !!n.wired;
    s.hotOn = Number(s.hot) > 0;
    s.osk = s.osk === '1'; s.oskOk = s.oskok === '1';
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
      h('button', { onclick: () => Shell.power('lock') }, 'Kilitle'),
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

  renderTiles(view) {
    const s = view || this.st, d = Settings.data;
    const settings = k => BUILTIN.settings.launch(k);
    // Düğmeye basınca görünüm HEMEN değişir; ardından gerçek durum sistemden okunup doğrulanır
    const busy = async (fn, flip) => {
      // Gerçek durum (this.st) komut bitene kadar değişmez; sadece görünüm için kopyası çevrilir
      if (flip) { const v = { ...this.st }; flip(v); this.renderTiles(v); }
      try { await fn(); } catch (e) { fail(e); }
      await this.state(); this.renderTiles(); Shell.refreshTray?.();
      setTimeout(async () => { if (!$('#quickPanel').hidden) { await this.state(); this.renderTiles(); } }, 1800);
    };
    const tiles = [];
    if (s.wifidev) {
      tiles.push(this.tile({ icon: 'wifi', label: 'Wi-Fi', on: s.wifiOn && !s.plane,
        sub: !s.wifiOn ? 'Kapalı' : s.wifiBusy ? 'Bağlanıyor…' : s.ssid || (s.wiredOn ? 'Kablolu bağlı' : 'Bağlı değil'),
        onToggle: () => busy(() => ex(`nmcli radio wifi ${s.wifiOn ? 'off' : 'on'}`), t => { t.wifiOn = !t.wifiOn; t.ssid = ''; }), onMore: () => settings('net') }));
    } else {
      tiles.push(this.tile({ icon: s.wiredOn ? 'wired' : 'nonet', label: s.wiredOn ? 'Ethernet' : 'Ağ', on: s.wiredOn,
        sub: s.wiredOn ? 'Bağlı' : 'Bağlı değil', onToggle: () => { Shell.closePopups(); settings('net'); }, onMore: () => settings('net') }));
    }
    tiles.push(this.tile({ icon: 'bt', label: 'Bluetooth', on: s.btOn, disabled: !s.btFound && !s.plane,
      sub: !s.btFound ? (s.plane ? 'Kapalı' : 'Aygıt yok') : s.btOn ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (!s.btOn) await ex('rfkill unblock bluetooth 2>/dev/null; sleep 1');
        await ex(`timeout 5 bluetoothctl power ${s.btOn ? 'off' : 'on'}`);
      }, t => { t.btOn = !t.btOn; }), onMore: () => settings('bluetooth') }));
    tiles.push(this.tile({ icon: 'plane', label: 'Uçak modu', on: s.plane, sub: s.plane ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (s.plane) { await ex('rfkill unblock all 2>/dev/null; nmcli radio all on 2>/dev/null'); Settings.set({ airplane: false }); }
        else { await ex('nmcli radio all off 2>/dev/null; rfkill block all 2>/dev/null'); Settings.set({ airplane: true }); }
      }, t => { t.plane = !t.plane; }) }));
    tiles.push(this.tile({ icon: 'moon', label: 'Gece ışığı', on: !!d.nightLight, sub: d.nightLight ? 'Açık' : 'Kapalı',
      onToggle: () => { const v = !d.nightLight; busy(async () => { await Settings.set({ nightLight: v }); await Display.apply(); }, () => { d.nightLight = v; }); } }));
    tiles.push(this.tile({ icon: 'bell', label: 'Rahatsız etme', on: !!d.quietNotify, sub: d.quietNotify ? 'Açık' : 'Kapalı',
      onToggle: () => { const v = !d.quietNotify; busy(() => Settings.set({ quietNotify: v }), () => { d.quietNotify = v; }); }, onMore: () => settings('notify') }));
    tiles.push(this.tile({ icon: 'keyboard', label: 'Ekran klavyesi', on: s.osk, disabled: !s.oskOk, sub: !s.oskOk ? 'Yüklü değil' : s.osk ? 'Açık' : 'Kapalı',
      onToggle: () => { TyOSK.auto = false; busy(() => ex(s.osk ? TyOSK.hideCmd() : TyOSK.showCmd()), t => { t.osk = !t.osk; }); } }));
    tiles.push(this.tile({ icon: 'hotspot', label: 'Etkin nokta', on: s.hotOn, disabled: !s.wifidev,
      sub: !s.wifidev ? 'Wi-Fi yok' : s.hotOn ? 'Açık' : 'Kapalı',
      onToggle: () => busy(async () => {
        if (s.hotOn) { await ex('nmcli connection down TyrOS-Hotspot'); return; }
        this.renderTiles({ ...this.st, hotOn: true });
        const pass = 'tyros' + Math.random().toString().slice(2, 8);
        const r = await ex(`LC_ALL=C.UTF-8 nmcli device wifi hotspot ifname ${sh(s.wifidev)} con-name TyrOS-Hotspot ssid TyrOS password ${pass} 2>&1`, 30);
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
        h('button', { class: 'qp-dname', title: `${d.full || d.name} — Dosyalar'da aç`, onclick: () => { Shell.closePopups(); Drives.open(d).catch(fail); } },
          h('b', {}, d.name), h('small', {}, Drives.describe(d))),
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
    watchDrives();                       // kısayol tuşu olayları da bu tek yoklamayla gelir
    checkBattery(); setInterval(checkBattery, 60000);
  }, 2500);
});
})();
