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
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOME = os.path.expanduser("~")
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


def run(cmd, timeout=10):
    """Komutu çalıştır, (kod, stdout, stderr) döndür. cmd liste olmalı."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
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
    m = re.search(r"/(\d+)x\d+/", path)
    size = int(m.group(1)) if m else 32
    return 900 - abs(128 - size) if size >= 32 else size


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


def find_icon(name):
    global _icon_index
    if name.startswith("/"):
        p = os.path.realpath(name)
        ok_dirs = ("/usr/share/", "/opt/", os.path.join(HOME, ".local/share/"))
        if p.startswith(ok_dirs) and p.endswith((".png", ".svg", ".xpm", ".jpg")) and os.path.isfile(p):
            return p
        return None
    with _icon_lock:
        if _icon_index is None:
            _icon_index = build_icon_index()
    return _icon_index.get(name) or _icon_index.get(name.lower())


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
    places = [{"name": "Ev", "path": HOME, "icon": "home"}]
    for key, label in labels.items():
        p = found.get(key) or os.path.join(HOME, {"DOWNLOAD": "Downloads"}.get(key, key.capitalize()))
        if os.path.isdir(p) and p != HOME:
            places.append({"name": label, "path": p, "icon": "folder"})
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
def r_procs(q, body):
    code, out, _ = run(["ps", "-eo", "pid,user,%cpu,%mem,rss,comm", "--sort=-%cpu", "--no-headers"])
    procs = []
    for line in out.splitlines()[:80]:
        parts = line.split(None, 5)
        if len(parts) == 6:
            procs.append({"pid": int(parts[0]), "user": parts[1], "cpu": float(parts[2]),
                          "mem": float(parts[3]), "rss": int(parts[4]) * 1024, "name": parts[5]})
    return procs


def r_kill(q, body):
    try:
        os.kill(int(body.get("pid")), signal.SIGTERM)
    except PermissionError:
        raise ApiError("Bu süreci durdurma iznin yok", 403)
    except ProcessLookupError:
        raise ApiError("Süreç artık çalışmıyor", 404)
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


def r_wifi(q, body):
    if not have("nmcli"):
        return {"available": False, "networks": []}
    run(["nmcli", "dev", "wifi", "rescan"], timeout=5) if "rescan" in q else None
    code, out, _ = run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list"], timeout=15)
    nets, seen = [], set()
    for line in out.splitlines():
        parts = re.split(r"(?<!\\):", line)
        if len(parts) < 4 or not parts[1] or parts[1] in seen:
            continue
        seen.add(parts[1])
        nets.append({"active": parts[0] == "*", "ssid": parts[1].replace("\\:", ":"),
                     "signal": int(parts[2] or 0), "secure": bool(parts[3] and parts[3] != "--")})
    code2, conn, _ = run(["nmcli", "-t", "-f", "TYPE,STATE,CONNECTION", "dev"])
    wired = any(l.startswith("ethernet:connected") for l in conn.splitlines())
    return {"available": True, "wired": wired, "networks": nets}


def r_wifi_connect(q, body):
    argv = ["nmcli", "dev", "wifi", "connect", body.get("ssid", "")]
    if body.get("password"):
        argv += ["password", body["password"]]
    code, out, err = run(argv, timeout=40)
    if code != 0:
        raise ApiError((err or out).strip() or "Bağlanılamadı")
    return {"ok": True}


def r_power(q, body):
    act = body.get("action")
    cmds = {"shutdown": ["systemctl", "poweroff"], "reboot": ["systemctl", "reboot"],
            "suspend": ["systemctl", "suspend"], "logout": ["openbox", "--exit"]}
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
        global _icon_index
        _icon_index = None

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


def r_ping(q, body):
    return {"ok": True, "name": "TyrOS", "version": "1.0", "term": have("ttyd")}


ROUTES = {
    ("GET", "/api/ping"): r_ping,
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
            p = find_icon(q.get("name", ""))
            if not p:
                return self.send(404, b"", "text/plain")
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
    srv = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    srv.daemon_threads = True
    print(f"TyrOS API http://{ARGS.host}:{ARGS.port} adresinde çalışıyor", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
