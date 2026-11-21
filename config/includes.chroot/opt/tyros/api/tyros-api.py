#!/usr/bin/env python3
"""
TyrOS API — HTML/CSS/JS arayüzü ile Linux sistemi arasındaki köprü.

Sadece Python standart kütüphanesi kullanır. Kullanıcının X oturumu içinde,
kullanıcı yetkisiyle çalışır; böylece açtığı uygulamalar ekranda görünür.
Apache httpd (127.0.0.1:80) /api/ isteklerini buraya yönlendirir.

Geliştirme modu (ISO derlemeden herhangi bir Linux'ta denemek için):
    python3 tyros-api.py --ui ../ui --port 8080
    Tarayıcıda: http://127.0.0.1:8080
"""
import argparse
import configparser
import json
import mimetypes
import os
import pwd
import re
import shlex
import shutil
import signal
import socket
import struct
import subprocess
import tarfile
import threading
import zlib
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOME = os.path.expanduser("~")
# Giriş ekranının (LightDM) verdiği PATH'te /usr/games yok: oyunlar menüde görünmüyor ve açılmıyordu.
# Uygulamaların bulunabileceği tüm klasörleri ekle.
_path = [d for d in os.environ.get("PATH", "").split(":") if d]
for _d in ("/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin",
           "/usr/local/games", "/usr/games", os.path.join(HOME, ".local/bin"), "/var/lib/flatpak/exports/bin"):
    if _d not in _path:
        _path.append(_d)
os.environ["PATH"] = ":".join(_path)
# Ağ aracı (nmcli) Türkçe ortamda "yes/connected" yerine "evet/bağlandı" yazıyor; okunacak çıktılar hep İngilizce alınsın
C_ENV = dict(os.environ, LC_ALL="C.UTF-8", LANG="C.UTF-8", LANGUAGE="")
CONFIG_DIR = os.path.join(HOME, ".config", "tyros")
SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")
PKG_RE = re.compile(r"^[a-z0-9][a-z0-9+.\-]{0,100}$")
ARGS = None


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


# ---------------------------------------------------------------- yardımcılar
def read(path, default=""):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def run(cmd, timeout=10, env=None):
    """Komutu çalıştır, (kod, stdout, stderr) döndür. cmd liste olmalı."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", f"{cmd[0]}: bulunamadı"
    except subprocess.TimeoutExpired:
        return 124, "", "zaman aşımı"


def have(prog):
    return shutil.which(prog) is not None


def spawn(argv, cwd=None):
    """Arka planda, API'den bağımsız bir süreç başlat."""
    subprocess.Popen(
        argv, cwd=cwd or HOME, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def safe_path(p):
    if not p:
        return HOME
    p = os.path.expanduser(p)
    return os.path.realpath(p if os.path.isabs(p) else os.path.join(HOME, p))


# ---------------------------------------------------------------- sistem bilgisi
_cpu_prev = {"total": 0, "idle": 0}
_cpu_lock = threading.Lock()


def cpu_percent():
    line = read("/proc/stat").splitlines()[0:1]
    if not line:
        return 0.0
    nums = [int(x) for x in line[0].split()[1:]]
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    total = sum(nums)
    with _cpu_lock:
        dt = total - _cpu_prev["total"]
        di = idle - _cpu_prev["idle"]
        _cpu_prev.update(total=total, idle=idle)
    if dt <= 0:
        return 0.0
    return round(100.0 * (dt - di) / dt, 1)


def meminfo():
    info = {}
    for line in read("/proc/meminfo").splitlines():
        k, _, v = line.partition(":")
        info[k] = int(v.split()[0]) * 1024 if v.split() else 0
    total = info.get("MemTotal", 0)
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    return {"total": total, "used": total - avail}


def os_name():
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip('"')
    return "Linux"


def battery():
    for bat in sorted(os.listdir("/sys/class/power_supply")) if os.path.isdir("/sys/class/power_supply") else []:
        base = f"/sys/class/power_supply/{bat}"
        if read(f"{base}/type").strip() == "Battery":
            cap = read(f"{base}/capacity").strip()
            if cap.isdigit():
                return {"percent": int(cap), "status": read(f"{base}/status").strip()}
    return None


def r_sysinfo(q, body):
    cpu_model = ""
    for line in read("/proc/cpuinfo").splitlines():
        if line.startswith("model name"):
            cpu_model = line.split(":", 1)[1].strip()
            break
    st = os.statvfs("/")
    code, ips, _ = run(["hostname", "-I"])
    return {
        "hostname": socket.gethostname(),
        "user": os.environ.get("USER") or pwd.getpwuid(os.getuid()).pw_name,
        "fullname": (pwd.getpwuid(os.getuid()).pw_gecos or "").split(",")[0].strip(),
        "os": os_name(),
        "kernel": os.uname().release,
        "arch": os.uname().machine,
        "uptime": float(read("/proc/uptime", "0 0").split()[0]),
        "cpu": {"model": cpu_model, "cores": os.cpu_count(), "percent": cpu_percent(),
                "load": os.getloadavg()},
        "mem": meminfo(),
        "disk": {"total": st.f_blocks * st.f_frsize,
                 "used": (st.f_blocks - st.f_bfree) * st.f_frsize},
        "battery": battery(),
        "ip": ips.split()[0] if code == 0 and ips.split() else None,
    }


# ---------------------------------------------------------------- uygulamalar (.desktop)
APP_DIRS = ["/usr/share/applications", "/usr/local/share/applications",
            os.path.join(HOME, ".local/share/applications"),
            "/var/lib/flatpak/exports/share/applications"]
_apps_cache = {"t": 0, "apps": []}
FIELD_CODES = re.compile(r"%[fFuUdDnNickvm]")


def localized(sec, key):
    lang = (os.environ.get("LANG") or "tr_TR").split(".")[0]
    for k in (f"{key}[{lang}]", f"{key}[{lang.split('_')[0]}]", key):
        if k in sec:
            return sec[k]
    return ""


def parse_desktop(path):
    cp = configparser.ConfigParser(interpolation=None, strict=False)
    cp.optionxform = str
    try:
        cp.read(path, encoding="utf-8")
    except (configparser.Error, UnicodeDecodeError):
        return None
    if "Desktop Entry" not in cp:
        return None
    s = cp["Desktop Entry"]
    if s.get("Type") != "Application" or not s.get("Exec"):
        return None
    if s.get("NoDisplay", "").lower() == "true" or s.get("Hidden", "").lower() == "true":
        return None
    if s.get("OnlyShowIn") and "TyrOS" not in s.get("OnlyShowIn"):
        return None
    # Yalnızca canlı (USB/ISO) oturumda görünenler, ör. "TyrOS'u Diske Kur"
    if s.get("X-TyrOS-LiveOnly", "").lower() == "true" and not os.path.isdir("/run/live/medium"):
        return None
    te = s.get("TryExec", "")
    if te and not (os.access(te, os.X_OK) if te.startswith("/") else shutil.which(te)):
        return None
    return {
        "id": os.path.basename(path),
        "name": localized(s, "Name"),
        "comment": localized(s, "Comment") or localized(s, "GenericName"),
        "icon": s.get("Icon", ""),
        "exec": s.get("Exec"),
        "terminal": s.get("Terminal", "").lower() == "true",
        "categories": [c for c in s.get("Categories", "").split(";") if c],
        "path": path,
    }


def all_apps(force=False):
    if not force and time.time() - _apps_cache["t"] < 15:
        return _apps_cache["apps"]
    seen = {}
    for d in APP_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            for f in files:
                if f.endswith(".desktop") and f not in seen:
                    a = parse_desktop(os.path.join(root, f))
                    if a:
                        seen[f] = a
    apps = sorted(seen.values(), key=lambda a: a["name"].lower())
    _apps_cache.update(t=time.time(), apps=apps)
    return apps


def r_apps(q, body):
    return [{k: v for k, v in a.items() if k not in ("exec", "path")} for a in all_apps("force" in q)]


def r_launch(q, body):
    app_id = body.get("id", "")
    app = next((a for a in all_apps() if a["id"] == app_id), None)
    if not app:
        raise ApiError("Uygulama bulunamadı", 404)
    argv = [x for x in shlex.split(FIELD_CODES.sub("", app["exec"]).replace("%%", "%")) if x]
    if app["terminal"]:
        argv = ["x-terminal-emulator", "-e"] + argv
    spawn(argv)
    return {"ok": True, "name": app["name"]}


def r_open(q, body):
    """Dosyayı/bağlantıyı sistemin varsayılan uygulamasıyla aç (xdg-open)."""
    target = body.get("path", "")
    if not target.startswith(("http://", "https://")):
        target = safe_path(target)
        if not os.path.exists(target):
            raise ApiError("Dosya bulunamadı", 404)
    spawn(["xdg-open", target])
    return {"ok": True}


# ---------------------------------------------------------------- simgeler
_icon_index = None
_icon_lock = threading.Lock()
ICON_ROOTS = [os.path.join(HOME, ".local/share/icons"), "/usr/share/icons/hicolor",
              "/usr/share/icons/Papirus", "/usr/share/icons/Adwaita", "/usr/share/icons"]


def icon_score(path):
    if path.endswith(".svg"):
        return 1000
    if path.endswith(".xpm"):
        return -1000                                 # eski biçim: yalnızca başka seçenek yoksa
    m = re.search(r"/(\d+)x\d+/", path)
    size = int(m.group(1)) if m else 32
    return 900 - abs(128 - size) if size >= 32 else size


# ---- XPM: tarayıcı bu eski resim biçimini gösteremez; PNG'ye çevrilir (yalnızca standart kütüphane)
_XPM_NAMES = {"black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0), "green": (0, 128, 0),
              "blue": (0, 0, 255), "yellow": (255, 255, 0), "gray": (190, 190, 190), "grey": (190, 190, 190),
              "orange": (255, 165, 0), "brown": (165, 42, 42), "cyan": (0, 255, 255), "magenta": (255, 0, 255)}


def _xpm_color(spec):
    spec = spec.strip()
    if spec.lower() == "none":
        return (0, 0, 0, 0)
    if spec.startswith("#"):
        h = spec[1:]
        n = len(h) // 3
        if n == 0:
            return (0, 0, 0, 255)
        r, g, b = (int(h[i * n:(i + 1) * n], 16) for i in range(3))
        if n > 2:                                    # #RRRRGGGGBBBB
            r, g, b = r >> (4 * (n - 2)), g >> (4 * (n - 2)), b >> (4 * (n - 2))
        elif n == 1:
            r, g, b = r * 17, g * 17, b * 17
        return (r, g, b, 255)
    low = spec.lower().replace(" ", "")
    m = re.match(r"gr[ae]y(\d+)$", low)
    if m:
        v = round(int(m.group(1)) * 2.55)
        return (v, v, v, 255)
    return _XPM_NAMES.get(low, (128, 128, 128)) + (255,)


def xpm_to_png(path):
    """XPM dosyasını PNG baytlarına çevir; anlaşılamazsa None."""
    try:
        txt = read(path)
        rows = re.findall(r'"((?:[^"\\]|\\.)*)"', txt)
        w, h, nc, cpp = (int(x) for x in rows[0].split()[:4])
        colors = {}
        for line in rows[1:1 + nc]:
            key, rest = line[:cpp], line[cpp:]
            m = re.search(r"(?:^|\s)c\s+(.+?)(?:\s+(?:m|g4|g|s)\s|$)", rest)
            colors[key] = _xpm_color(m.group(1) if m else "None")
        raw = bytearray()
        for y in range(h):
            line = rows[1 + nc + y]
            raw.append(0)
            for x in range(w):
                raw.extend(colors.get(line[x * cpp:(x + 1) * cpp], (0, 0, 0, 0)))
        def chunk(tag, data):
            c = struct.pack(">I", len(data)) + tag + data
            return c + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))
    except Exception:
        return None


# ---- Mağazadaki henüz kurulmamış uygulamaların logoları: Debian'ın uygulama simgesi arşivinden
#      ("Listeyi güncelle" ile inen *_dep11_icons-64x64.tar.gz). Kurulu olmayan programın simgesi sistemde yoktur.
_dep11 = {"sig": None, "idx": {}}
_dep11_lock = threading.Lock()


def dep11_index():
    import glob
    files = sorted(glob.glob("/var/lib/apt/lists/*_dep11_icons-64x64.tar*"))
    sig = tuple((f, os.path.getmtime(f)) for f in files if os.path.exists(f))
    with _dep11_lock:
        if sig != _dep11["sig"]:
            idx = {}
            for f in files:
                try:
                    with tarfile.open(f) as t:
                        for m in t:
                            if m.isfile() and m.name.endswith(".png"):
                                idx.setdefault(os.path.basename(m.name).split("_", 1)[0], (f, m.name))
                except Exception:
                    pass
            _dep11.update(sig=sig, idx=idx)
        return _dep11["idx"]


def dep11_icon(pkg):
    if not PKG_RE.match(pkg or ""):
        return None
    out = os.path.join(HOME, ".cache/tyros/appicons", pkg + ".png")
    if os.path.isfile(out):
        return out
    hit = dep11_index().get(pkg)
    if not hit:
        return None
    try:
        with tarfile.open(hit[0]) as t:
            data = t.extractfile(hit[1]).read()
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out + ".tmp", "wb") as f:
            f.write(data)
        os.replace(out + ".tmp", out)
        return out
    except Exception:
        return None


def build_icon_index():
    idx = {}
    for root in ICON_ROOTS + ["/usr/share/pixmaps"]:
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            if "/symbolic" in dirpath or "/cursors" in dirpath:
                continue
            for f in files:
                name, ext = os.path.splitext(f)
                if ext not in (".png", ".svg", ".xpm"):
                    continue
                p = os.path.join(dirpath, f)
                if name not in idx or icon_score(p) > icon_score(idx[name]):
                    idx[name] = p
    return idx


_icon_suffix = None
_icon_built = 0.0


def find_icon(name, retry=True):
    global _icon_index
    if name.startswith("/"):
        p = os.path.realpath(name)
        ok_dirs = ("/usr/share/", "/opt/", os.path.join(HOME, ".local/share/"))
        if p.startswith(ok_dirs) and p.endswith((".png", ".svg", ".xpm", ".jpg")) and os.path.isfile(p):
            return p
        return None
    global _icon_built, _icon_suffix
    with _icon_lock:
        if _icon_index is None:
            _icon_index = build_icon_index()
            _icon_suffix = None
            _icon_built = time.time()
    hit = _icon_index.get(name) or _icon_index.get(name.lower())
    if hit or not name:
        return hit
    # Paket adı ile simge adı farklıysa (ör. "celluloid" → "io.github.celluloid_player.Celluloid")
    if _icon_suffix is None:
        suf = {}
        for k in _icon_index:
            last = k.rsplit(".", 1)[-1].lower()
            if "." in k and last not in suf:
                suf[last] = k
        _icon_suffix = suf
    n = name.lower()
    cands = [n, re.sub(r"^(gnome|kde|xfce4|mate|lxqt|xfce)-", "", n), re.sub(r"-(gtk|qt|gtk3|qt5|qt6|gui|client|desktop)$", "", n)]
    for c in cands:
        if c in _icon_index:
            return _icon_index[c]
        if c in _icon_suffix:
            return _icon_index[_icon_suffix[c]]
    # Mağazadan yeni kurulan uygulamaların simgeleri: dizin eskiyse bir kez yeniden tara
    if retry and time.time() - _icon_built > 60:
        with _icon_lock:
            _icon_index = None
        return find_icon(name, retry=False)
    return None


# ---------------------------------------------------------------- dosyalar
def r_files(q, body):
    path = safe_path(q.get("path", ""))
    if not os.path.isdir(path):
        raise ApiError("Klasör bulunamadı", 404)
    items = []
    try:
        names = os.listdir(path)
    except PermissionError:
        raise ApiError("Bu klasörü açma iznin yok", 403)
    for n in names:
        fp = os.path.join(path, n)
        try:
            st = os.stat(fp)
            is_dir = os.path.isdir(fp)
        except OSError:
            continue
        items.append({"name": n, "dir": is_dir, "size": st.st_size, "mtime": st.st_mtime,
                      "mime": None if is_dir else mimetypes.guess_type(n)[0]})
    items.sort(key=lambda i: (not i["dir"], i["name"].lower()))
    return {"path": path, "parent": os.path.dirname(path) if path != "/" else None, "items": items}


def r_places(q, body):
    """XDG kullanıcı klasörleri (dil ayarına göre: Masaüstü, Belgeler, İndirilenler…)."""
    labels = {"DESKTOP": "Masaüstü", "DOCUMENTS": "Belgeler", "DOWNLOAD": "İndirilenler",
              "PICTURES": "Resimler", "MUSIC": "Müzik", "VIDEOS": "Videolar"}
    found = {}
    for line in read(os.path.join(HOME, ".config/user-dirs.dirs")).splitlines():
        m = re.match(r'XDG_(\w+)_DIR="(.*)"', line.strip())
        if m and m.group(1) in labels:
            found[m.group(1)] = m.group(2).replace("$HOME", HOME)
    places = [{"name": "Ev", "path": HOME, "icon": "home", "key": "HOME"}]
    for key, label in labels.items():
        p = found.get(key) or os.path.join(HOME, {"DOWNLOAD": "Downloads"}.get(key, key.capitalize()))
        if os.path.isdir(p) and p != HOME:
            places.append({"name": label, "path": p, "icon": "folder", "key": key})
    places += [{"name": "Çöp", "path": os.path.join(HOME, ".local/share/Trash/files"), "icon": "trash"},
               {"name": "Sistem kökü", "path": "/", "icon": "folder"}]
    return places


def r_file_read(q, body):
    path = safe_path(q.get("path", ""))
    if not os.path.isfile(path):
        raise ApiError("Dosya bulunamadı", 404)
    if os.path.getsize(path) > 4 * 1024 * 1024:
        raise ApiError("Dosya düzenleyicide açmak için çok büyük (4 MB üstü)")
    with open(path, "rb") as f:
        raw = f.read()
    if b"\x00" in raw[:8192]:
        raise ApiError("Bu bir metin dosyası değil", 415)
    return {"path": path, "content": raw.decode("utf-8", errors="replace")}


def r_file_write(q, body):
    path = safe_path(body.get("path", ""))
    with open(path, "w", encoding="utf-8") as f:
        f.write(body.get("content", ""))
    return {"ok": True, "path": path}


def r_file_op(q, body):
    op = body.get("op")
    path = safe_path(body.get("path", ""))
    if op == "mkdir":
        os.makedirs(path, exist_ok=False)
    elif op == "touch":
        open(path, "a").close()
    elif op == "rename":
        new = os.path.join(os.path.dirname(path), os.path.basename(body.get("name", "")))
        if not body.get("name") or os.path.exists(new):
            raise ApiError("Bu ad geçersiz ya da zaten var")
        os.rename(path, new)
    elif op == "trash":
        if path in ("/", HOME):
            raise ApiError("Bu klasör silinemez", 403)
        trash = os.path.join(HOME, ".local/share/Trash/files")
        os.makedirs(trash, exist_ok=True)
        dest = os.path.join(trash, os.path.basename(path))
        if os.path.exists(dest):
            dest += f".{int(time.time())}"
        shutil.move(path, dest)
    else:
        raise ApiError("Bilinmeyen işlem")
    return {"ok": True}


# ---------------------------------------------------------------- komut çalıştırma
def r_exec(q, body):
    cmd = body.get("cmd", "")
    cwd = safe_path(body.get("cwd", ""))
    if not os.path.isdir(cwd):
        cwd = HOME
    try:
        p = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True,
                           timeout=int(body.get("timeout", 30)), cwd=cwd)
        return {"code": p.returncode, "stdout": p.stdout[-200000:], "stderr": p.stderr[-50000:]}
    except subprocess.TimeoutExpired:
        return {"code": 124, "stdout": "", "stderr": "Komut 30 saniyede bitmedi. Uzun süren komutlar için Terminal uygulamasını kullan."}


# ---------------------------------------------------------------- süreçler
# Sistemi ve TyrOS arayüzünü ayakta tutan süreçler: Sistem İzleyici'den durdurulamaz
SYSTEM_PROCS = {"Xorg", "X", "openbox", "lightdm", "systemd", "dbus-daemon", "dbus-broker", "pipewire",
                "pipewire-pulse", "wireplumber", "ttyd", "apache2", "NetworkManager", "earlyoom",
                "tyros-session", "polkitd", "udisksd", "bluetoothd", "wpa_supplicant", "Xwayland"}
SESSION_PROCS = {"chromium", "chrome", "python3", "bash", "sh", "sleep", "xdotool", "curl", "tyros-session", "ttyd"}
ME = pwd.getpwuid(os.getuid()).pw_name


def is_protected(pid, user, sid, name):
    if pid in (1, os.getpid()) or user != ME or name in SYSTEM_PROCS or name.startswith("systemd"):
        return True
    try:
        my_sid = os.getsid(0)
    except OSError:
        my_sid = -1
    # TyrOS oturumunun kendi parçaları (arayüz penceresi, köprü, terminal)
    return sid == my_sid and name in SESSION_PROCS


def r_procs(q, body):
    code, out, _ = run(["ps", "-eo", "pid,sid,user:32,%cpu,%mem,rss,comm", "--sort=-%cpu", "--no-headers"])
    procs = []
    for line in out.splitlines()[:80]:
        parts = line.split(None, 6)
        if len(parts) == 7:
            pid, sid = int(parts[0]), int(parts[1])
            procs.append({"pid": pid, "user": parts[2], "cpu": float(parts[3]),
                          "mem": float(parts[4]), "rss": int(parts[5]) * 1024, "name": parts[6],
                          "protected": is_protected(pid, parts[2], sid, parts[6])})
    return procs


def r_kill(q, body):
    pid = int(body.get("pid"))
    for p in r_procs(q, None):
        if p["pid"] == pid and p["protected"]:
            raise ApiError("Bu bir sistem parçası; TyrOS'un çalışması için gerekli olduğu için durdurulamaz.", 403)
    try:
        os.getsid(pid)
    except ProcessLookupError:
        raise ApiError("Bu program zaten kapanmış.", 404)
    if is_protected(pid, ME, os.getsid(pid), read(f"/proc/{pid}/comm").strip()):
        raise ApiError("Bu bir sistem parçası; TyrOS'un çalışması için gerekli olduğu için durdurulamaz.", 403)
    try:
        os.kill(pid, signal.SIGTERM)
    except PermissionError:
        raise ApiError("Bu programı durdurma iznin yok.", 403)
    except ProcessLookupError:
        raise ApiError("Bu program zaten kapanmış.", 404)
    return {"ok": True}


# ---------------------------------------------------------------- yerel pencereler (wmctrl)
SHELL_CLASS = "tyrosshell"


def r_windows(q, body):
    if not have("wmctrl"):
        return []
    code, out, _ = run(["wmctrl", "-lx"])
    wins = []
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        wid, desk, wclass = parts[0], parts[1], parts[2]
        if desk == "-1" or SHELL_CLASS in wclass.lower():
            continue
        title = parts[4] if len(parts) > 4 else wclass
        wins.append({"id": wid, "class": wclass.split(".")[-1], "title": title})
    return wins


def r_window_act(q, body):
    wid = body.get("id", "")
    if not re.fullmatch(r"0x[0-9a-fA-F]+", wid):
        raise ApiError("Geçersiz pencere")
    act = body.get("action")
    if act == "activate":
        run(["wmctrl", "-ia", wid])
    elif act == "close":
        run(["wmctrl", "-ic", wid])
    elif act == "minimize":
        run(["xdotool", "windowminimize", str(int(wid, 16))])
    return {"ok": True}


# ---------------------------------------------------------------- ses, ağ, güç
def r_volume(q, body):
    if body:
        if "level" in body:
            lvl = max(0.0, min(1.5, float(body["level"])))
            run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{lvl:.2f}"])
        if body.get("toggleMute"):
            run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"])
    code, out, _ = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    if code != 0:
        return {"available": False}
    m = re.search(r"([\d.]+)", out)
    return {"available": True, "level": float(m.group(1)) if m else 0, "muted": "MUTED" in out}


def nm(args, timeout=10):
    """nmcli'yi dilden bağımsız (İngilizce) çıktıyla çalıştır."""
    return run(["nmcli"] + args, timeout=timeout, env=C_ENV)


def nm_split(line):
    """nmcli -t satırını böl: '\\:' kaçışlı iki nokta alanın parçasıdır."""
    out, cur, i = [], "", 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            cur += line[i + 1]; i += 2; continue
        if c == ":":
            out.append(cur); cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


# Ağ değişikliklerini anında yakala: "nmcli monitor" her olayda bir satır yazar
_net_gen = [0]


def _net_watch():
    while have("nmcli"):
        try:
            p = subprocess.Popen(["nmcli", "monitor"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 stdin=subprocess.DEVNULL, text=True, env=C_ENV)
            for _ in p.stdout:
                _net_gen[0] += 1
            p.wait()
        except Exception:
            pass
        time.sleep(3)


# Pencere açılıp kapanınca ya da öne gelince haber al (sürekli wmctrl çalıştırmak yerine)
_win_gen = [0]


def _win_watch():
    if not have("xprop") or not os.environ.get("DISPLAY"):
        return
    cmd = ["xprop", "-spy", "-root", "_NET_CLIENT_LIST", "_NET_ACTIVE_WINDOW"]
    if have("stdbuf"):
        cmd = ["stdbuf", "-oL"] + cmd                 # her olay hemen gelsin (tamponlanmasın)
    fails = 0
    while True:
        t0 = time.time()
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 stdin=subprocess.DEVNULL, text=True)
            for _ in p.stdout:
                _win_gen[0] += 1
            p.wait()
        except Exception:
            pass
        fails = fails + 1 if time.time() - t0 < 5 else 0
        time.sleep(60 if fails > 3 else 3)


_desk = {"t": 0.0, "path": None}


def desktop_dir():
    if time.time() - _desk["t"] > 30:
        path = None
        for line in read(os.path.join(HOME, ".config/user-dirs.dirs")).splitlines():
            m = re.match(r'XDG_DESKTOP_DIR="(.*)"', line.strip())
            if m:
                path = m.group(1).replace("$HOME", HOME)
        _desk.update(t=time.time(), path=path or os.path.join(HOME, "Desktop"))
    return _desk["path"]


def desk_sig():
    """Masaüstü klasörü değişikliği imzası (alt süreç yok)."""
    try:
        with os.scandir(desktop_dir()) as it:
            return str(hash(tuple(sorted((e.name, e.stat().st_mtime_ns) for e in it if not e.name.startswith(".")))))
    except OSError:
        return "-"


def net_sig():
    """Ağ / Wi-Fi / Bluetooth / uçak modu değişikliği imzası (alt süreç başlatmadan)."""
    parts = [str(_net_gen[0])]
    try:
        for n in sorted(os.listdir("/sys/class/net")):
            parts.append(n + read(f"/sys/class/net/{n}/operstate").strip())
    except OSError:
        pass
    try:
        for n in sorted(os.listdir("/sys/class/rfkill")):
            parts.append(n + read(f"/sys/class/rfkill/{n}/soft").strip() + read(f"/sys/class/rfkill/{n}/hard").strip())
    except OSError:
        pass
    try:
        parts += sorted(os.listdir("/sys/class/bluetooth"))
    except OSError:
        pass
    parts.append(read("/proc/net/route"))
    return str(hash("|".join(parts)))


def apps_sig():
    """Uygulama kurulunca/kaldırılınca menü kendiliğinden yenilensin."""
    sig = []
    for d in APP_DIRS:
        try:
            sig.append(str(os.stat(d).st_mtime_ns))
        except OSError:
            sig.append("-")
    return "|".join(sig)


def wifi_profiles():
    """Kayıtlı Wi-Fi bağlantılarının adları."""
    code, out, _ = nm(["-t", "-f", "NAME,TYPE", "connection", "show"], 8)
    return {p[0] for p in map(nm_split, out.splitlines()) if len(p) >= 2 and p[1] == "802-11-wireless"}


def net_state():
    st = {"available": have("nmcli"), "wifidev": "", "wifiOn": False, "wifi": "none", "ssid": "",
          "wired": False, "ip": ""}
    code, ips, _ = run(["hostname", "-I"], 5)
    st["ip"] = ips.split()[0] if code == 0 and ips.split() else ""
    if not st["available"]:
        return st
    code, out, _ = nm(["radio", "wifi"], 5)
    st["wifiOn"] = out.strip() == "enabled"
    conn = ""
    code, out, _ = nm(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"], 5)
    for p in map(nm_split, out.splitlines()):
        if len(p) < 4:
            continue
        dev, typ, state, con = p[:4]
        if typ == "wifi" and not st["wifidev"]:
            st["wifidev"] = dev
            st["wifi"] = ("connected" if state.startswith("connected") else
                          "connecting" if state.startswith(("connecting", "deactivating")) else
                          "off" if state in ("unavailable", "unmanaged") else "disconnected")
            conn = "" if con == "--" else con
        elif typ == "ethernet" and state.startswith("connected"):
            st["wired"] = True
    if st["wifi"] in ("connected", "connecting") and st["wifidev"]:
        code, out, _ = nm(["-t", "-f", "IN-USE,SSID", "device", "wifi", "list", "ifname", st["wifidev"],
                           "--rescan", "no"], 5)
        for p in map(nm_split, out.splitlines()):
            if len(p) >= 2 and p[0] == "*" and p[1]:
                st["ssid"] = p[1]
                break
        st["ssid"] = st["ssid"] or conn
    return st


def r_netstate(q, body):
    return net_state()


def r_wifi(q, body):
    if not have("nmcli"):
        return {"available": False, "networks": []}
    if "rescan" in q:
        nm(["device", "wifi", "rescan"], 6)
    st = net_state()
    code, out, _ = nm(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "no"], 15)
    saved = wifi_profiles()
    nets = {}
    for p in map(nm_split, out.splitlines()):
        if len(p) < 4 or not p[1]:
            continue
        ssid = p[1]
        n = nets.setdefault(ssid, {"ssid": ssid, "active": False, "signal": 0, "secure": False, "saved": ssid in saved})
        # Aynı ağın birden çok vericisi olabilir (2.4/5 GHz, mesh): biri bağlıysa ağ bağlıdır
        n["active"] = n["active"] or p[0] == "*"
        n["signal"] = max(n["signal"], int(p[2]) if p[2].isdigit() else 0)
        n["secure"] = n["secure"] or bool(p[3] and p[3] != "--")
    cur = st["ssid"] if st["wifi"] in ("connected", "connecting") else ""
    if cur:
        n = nets.setdefault(cur, {"ssid": cur, "active": False, "signal": 0, "secure": True, "saved": True})
        n["active"] = st["wifi"] == "connected"
        n["connecting"] = st["wifi"] == "connecting"
    lst = sorted(nets.values(), key=lambda n: (not n["active"], not n.get("connecting"), -n["signal"]))
    return {"available": True, "wired": st["wired"], "wifiOn": st["wifiOn"], "wifidev": st["wifidev"],
            "ip": st["ip"], "networks": lst}


def r_wifi_connect(q, body):
    if not have("nmcli"):
        raise ApiError("NetworkManager bulunamadı")
    if body.get("action") == "disconnect":
        dev = net_state()["wifidev"]
        if dev:
            nm(["device", "disconnect", dev], 20)
        return {"ok": True}
    ssid = body.get("ssid", "")
    if not ssid:
        raise ApiError("Ağ adı boş")
    pw = body.get("password") or ""
    saved = ssid in wifi_profiles()
    if not pw and saved:
        # Daha önce bağlanılmış ağ: kayıtlı şifreyle bağlan
        code, out, err = nm(["connection", "up", "id", ssid], 45)
        if code == 0:
            return {"ok": True}
        if body.get("secure"):
            return {"ok": False, "needPassword": True}
        raise ApiError((err or out).strip() or "Wi-Fi ağına katılınamadı")
    if pw and saved:
        # Yeni şifre girildi: eski (hatalı olabilecek) kaydı sil, yoksa nmcli eski kaydı kullanmaya çalışır
        nm(["connection", "delete", "id", ssid], 15)
    argv = ["device", "wifi", "connect", ssid]
    if pw:
        argv += ["password", pw]
    code, out, err = nm(argv, 45)
    if code != 0:
        # Yarım kalan kaydı temizle ki bir sonraki denemede doğru şifre çalışsın
        if ssid in wifi_profiles():
            nm(["connection", "delete", "id", ssid], 15)
        raise ApiError((err or out).strip() or "Wi-Fi ağına katılınamadı")
    return {"ok": True}


def r_power(q, body):
    act = body.get("action")
    cmds = {"shutdown": ["systemctl", "poweroff"], "reboot": ["systemctl", "reboot"],
            "suspend": ["systemctl", "suspend"], "logout": ["setsid", "-f", "/usr/local/bin/tyros-logout"]}
    if act not in cmds:
        raise ApiError("Bilinmeyen güç işlemi")
    spawn(cmds[act])
    return {"ok": True}


# ---------------------------------------------------------------- paket yönetimi (apt)
JOBS = {}


def start_job(argv, title):
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "title": title, "log": [], "done": False, "code": None}
    JOBS[jid] = job

    def worker():
        try:
            p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"})
            for line in p.stdout:
                job["log"].append(line.rstrip())
                del job["log"][:-500]
            job["code"] = p.wait()
        except Exception as e:  # noqa: BLE001
            job["log"].append(str(e))
            job["code"] = 1
        job["done"] = True
        _apps_cache["t"] = 0
        global _icon_index, _icon_suffix
        _icon_index = _icon_suffix = None

    threading.Thread(target=worker, daemon=True).start()
    return job


def r_pkg_search(q, body):
    term = q.get("q", "").strip()
    if len(term) < 2:
        raise ApiError("En az 2 harf yaz")
    code, out, _ = run(["apt-cache", "search", "--", term], timeout=20)
    results = []
    for line in out.splitlines()[:150]:
        name, _, desc = line.partition(" - ")
        results.append({"name": name.strip(), "desc": desc.strip()})
    # İsmi aramayla başlayanlar önce
    results.sort(key=lambda r: (not r["name"].startswith(term.lower()), len(r["name"])))
    results = results[:60]
    if results:
        code, inst, _ = run(["dpkg-query", "-W", "-f=${Package} ${db:Status-Status}\n"] + [r["name"] for r in results])
        installed = {l.split()[0] for l in inst.splitlines() if l.endswith(" installed")}
        for r in results:
            r["installed"] = r["name"] in installed
    return results


def r_pkg_action(q, body):
    act = body.get("action")
    if act == "update":
        return start_job(["sudo", "-n", "apt-get", "update"], "Paket listesi güncelleniyor")
    name = body.get("name", "")
    if not PKG_RE.match(name):
        raise ApiError("Geçersiz paket adı")
    if act == "install":
        argv = ["sudo", "-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", name]
        return start_job(argv, f"{name} kuruluyor")
    if act == "remove":
        argv = ["sudo", "-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "remove", "-y", name]
        return start_job(argv, f"{name} kaldırılıyor")
    raise ApiError("Bilinmeyen işlem")


def r_job(q, body):
    job = JOBS.get(q.get("id", ""))
    if not job:
        raise ApiError("İş bulunamadı", 404)
    return job


# ---------------------------------------------------------------- ayarlar
def r_settings(q, body):
    if body:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        cur = json.loads(read(SETTINGS_FILE, "{}") or "{}")
        cur.update(body)
        with open(SETTINGS_FILE, "w") as f:
            json.dump(cur, f, indent=2)
        return cur
    return json.loads(read(SETTINGS_FILE, "{}") or "{}")


def r_blockgen(q, body):
    """Disk/USB değişikliği imzası — alt süreç başlatmadan, çok ucuz.
    Arayüz bunu sık sorar; sadece imza değişince ayrıntılı tarama yapar."""
    devs = []
    # Diskler + USB aygıtları (telefon gibi disk olmayan aygıtlar da takılınca fark edilsin)
    for d in ("/sys/class/block", "/sys/bus/usb/devices"):
        try:
            devs += sorted(os.listdir(d))
        except OSError:
            pass
    mounts = "".join(l.split(" ", 2)[0] + l.split(" ", 2)[1] for l in read("/proc/mounts").splitlines()
                     if l.startswith("/dev/"))
    return {"sig": str(hash(("|".join(devs), mounts))), "net": net_sig(), "apps": apps_sig()}


def r_events(q, body):
    """Kısayol tuşu olayları (ses, parlaklık, ekran görüntüsü): tyros-key yazar, arayüz okur."""
    p = os.path.join(HOME, ".cache/tyros/events")
    tmp = p + ".okunuyor"
    try:
        os.replace(p, tmp)
    except FileNotFoundError:
        return []
    lines = read(tmp).splitlines()
    try:
        os.remove(tmp)
    except OSError:
        pass
    return [l.split("|", 1) for l in lines if "|" in l][-20:]


def system_lang():
    """Sistem dili (ör. tr_TR.UTF-8). Oturum ortamından; yoksa /etc/default/locale."""
    for k in ("LC_ALL", "LC_MESSAGES", "LANG"):
        v = os.environ.get(k, "")
        if v and v not in ("C", "POSIX", "C.UTF-8"):
            return v
    m = re.search(r'^LANG="?([^"\n]+)', read("/etc/default/locale"), re.M)
    return m.group(1) if m else "en_US.UTF-8"


def r_lang(q, body):
    """Arayüz dili: Ayarlar'da seçilen, yoksa sistem dili. Çevirisi olmayan diller İngilizce gösterilir."""
    pref = (json.loads(read(SETTINGS_FILE, "{}") or "{}").get("uiLang") or "auto")
    sysl = system_lang()
    code = sysl.split(".")[0].split("_")[0].lower()
    ui = pref if pref in ("tr", "en") else ("tr" if code == "tr" else "en")
    return {"ui": ui, "pref": pref, "system": sysl, "code": code}


def r_tick(q, body):
    """Arayüzün tek yoklaması: diskler, ağ, uygulamalar, kısayol tuşları, pencereler, masaüstü.
    Eskiden ayrı ayrı 4 ayrı zamanlayıcıyla soruluyordu; tek istek işlemciyi ve gücü daha az yorar."""
    r = r_blockgen(q, body)
    r["events"] = r_events(q, body)
    r["win"] = _win_gen[0]
    r["desk"] = desk_sig()
    return r


def r_ping(q, body):
    return {"ok": True, "name": "TyrOS", "version": "1.0", "term": have("ttyd")}


ROUTES = {
    ("GET", "/api/ping"): r_ping,
    ("GET", "/api/lang"): r_lang,
    ("GET", "/api/blockgen"): r_blockgen,
    ("GET", "/api/tick"): r_tick,
    ("GET", "/api/events"): r_events,
    ("GET", "/api/sysinfo"): r_sysinfo,
    ("GET", "/api/apps"): r_apps,
    ("POST", "/api/launch"): r_launch,
    ("POST", "/api/open"): r_open,
    ("GET", "/api/files"): r_files,
    ("GET", "/api/places"): r_places,
    ("GET", "/api/file"): r_file_read,
    ("POST", "/api/file"): r_file_write,
    ("POST", "/api/fileop"): r_file_op,
    ("POST", "/api/exec"): r_exec,
    ("GET", "/api/procs"): r_procs,
    ("POST", "/api/kill"): r_kill,
    ("GET", "/api/windows"): r_windows,
    ("POST", "/api/window"): r_window_act,
    ("GET", "/api/volume"): r_volume,
    ("POST", "/api/volume"): r_volume,
    ("GET", "/api/wifi"): r_wifi,
    ("GET", "/api/netstate"): r_netstate,
    ("POST", "/api/wifi"): r_wifi_connect,
    ("POST", "/api/power"): r_power,
    ("GET", "/api/pkg/search"): r_pkg_search,
    ("POST", "/api/pkg"): r_pkg_action,
    ("GET", "/api/job"): r_job,
    ("GET", "/api/settings"): r_settings,
    ("POST", "/api/settings"): r_settings,
}


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "TyrOS-API/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        if ARGS.verbose:
            super().log_message(fmt, *a)

    def host_ok(self):
        # DNS rebinding saldırılarına karşı: sadece yerel adlar kabul edilir.
        host = (self.headers.get("Host") or "").strip()
        if host.startswith("["):
            host = host[1:].split("]")[0]
        else:
            host = host.rsplit(":", 1)[0]
        return host in ("127.0.0.1", "localhost", "::1")

    def send(self, code, data, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode()
        elif isinstance(data, str):
            data = data.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def handle_any(self, method):
        if not self.host_ok():
            return self.send(403, {"error": "Geçersiz Host"})
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}

        if url.path == "/api/icon":
            name = q.get("name", "")
            p = find_icon(name) or dep11_icon(name)
            if not p:
                return self.send(404, b"", "text/plain")
            if p.endswith(".xpm"):
                png = xpm_to_png(p)
                if not png:
                    return self.send(404, b"", "text/plain")
                return self.send(200, png, "image/png", {"Cache-Control": "max-age=86400"})
            with open(p, "rb") as f:
                ctype = "image/svg+xml" if p.endswith(".svg") else (mimetypes.guess_type(p)[0] or "image/png")
                return self.send(200, f.read(), ctype, {"Cache-Control": "max-age=86400"})

        if url.path.startswith("/api/"):
            # Özel başlık: başka sitelerin tarayıcı üzerinden API'yi kullanmasını (CSRF) engeller.
            if self.headers.get("X-TyrOS") != "1":
                return self.send(403, {"error": "X-TyrOS başlığı gerekli"})
            fn = ROUTES.get((method, url.path))
            if not fn:
                return self.send(404, {"error": "Böyle bir uç nokta yok"})
            body = {}
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                try:
                    body = json.loads(self.rfile.read(min(length, 10 * 1024 * 1024)) or b"{}")
                except json.JSONDecodeError:
                    return self.send(400, {"error": "Geçersiz JSON"})
            try:
                return self.send(200, fn(q, body))
            except ApiError as e:
                return self.send(e.code, {"error": str(e)})
            except PermissionError:
                return self.send(403, {"error": "Bu işlem için iznin yok"})
            except FileExistsError:
                return self.send(409, {"error": "Bu ad zaten kullanılıyor"})
            except FileNotFoundError:
                return self.send(404, {"error": "Bulunamadı"})
            except Exception as e:  # noqa: BLE001
                return self.send(500, {"error": f"{type(e).__name__}: {e}"})

        # Geliştirme modu: arayüz dosyalarını da sun
        if ARGS.ui:
            rel = url.path.lstrip("/") or "index.html"
            root = os.path.realpath(ARGS.ui)
            fp = os.path.realpath(os.path.join(root, rel))
            if fp.startswith(root) and os.path.isfile(fp):
                with open(fp, "rb") as f:
                    return self.send(200, f.read(), mimetypes.guess_type(fp)[0] or "application/octet-stream")
        return self.send(404, {"error": "Bulunamadı"})

    def do_GET(self):
        self.handle_any("GET")

    def do_HEAD(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")


def main():
    global ARGS
    ap = argparse.ArgumentParser(description="TyrOS API köprüsü")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--ui", help="Arayüz klasörü (geliştirme modu)")
    ap.add_argument("-v", "--verbose", action="store_true")
    ARGS = ap.parse_args()
    cpu_percent()
    threading.Thread(target=find_icon, args=("x",), daemon=True).start()  # simge dizinini önceden hazırla
    threading.Thread(target=_net_watch, daemon=True).start()              # ağ değişikliklerini anında yakala
    threading.Thread(target=_win_watch, daemon=True).start()              # pencere değişikliklerini anında yakala
    srv = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    srv.daemon_threads = True
    print(f"TyrOS API http://{ARGS.host}:{ARGS.port} adresinde çalışıyor", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
