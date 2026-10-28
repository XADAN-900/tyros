# TyrOS 1.0

Arayüzü tamamen HTML, CSS ve JavaScript ile yazılmış, Debian 13 (trixie) tabanlı bir Linux dağıtımı.

## Nasıl çalışır

```
 Açılış ─► Linux çekirdeği ─► systemd ─► Apache httpd (127.0.0.1:80)
                                   │
                                   └─► otomatik giriş ─► X + Openbox ─► tyros-session
                                                                          │
              ┌───────────────────────────────────────────────────────────┤
              ▼                         ▼                                 ▼
     tyros-api.py (köprü)        ttyd (gerçek terminal)       Chromium uygulama modu
     127.0.0.1:8090              /run/tyros/ttyd.sock         http://127.0.0.1/  ← arayüz
              ▲                         ▲                                 │
              └──── Apache /api/ ───────┴──── Apache /term/ ◄─────────────┘
```

Arayüz (`/opt/tyros/ui`) Apache httpd tarafından sunulur. Arayüz sistemle `/api/` üzerinden konuşur; bu istekleri kullanıcının oturumunda çalışan `tyros-api.py` karşılar. Böylece arayüzden dosyaları yönetebilir, komut çalıştırabilir, Wi-Fi'ye bağlanabilir, ses düzeyini değiştirebilir, paket kurabilir ve bilgisayarı kapatabilirsin.

**Debian uygulamalarının hepsi:** `/usr/share/applications` içindeki her uygulama başlat menüsünde kendi simgesiyle otomatik görünür. Firefox, LibreOffice, GIMP, VLC gibi programlar ISO'da hazır gelir; geri kalan on binlerce Debian paketi **Uygulama Mağazası**'ndan (apt) tek tıkla kurulur. Açılan Linux uygulamaları da TyrOS görev çubuğunda görünür.

## ISO'yu derleme

Üç yol var; Debian bilgisayarın yoksa ilk ikisinden birini seç.

### Yol 1: GitHub'da otomatik derleme (bilgisayar gerekmez)

1. github.com'da ücretsiz hesap aç, **New repository** ile `tyros` adında **public** bir depo oluştur.
2. Depo sayfasında **uploading an existing file** bağlantısına tıkla ve bu klasörün içindeki her şeyi (gizli `.github` klasörü dahil) sürükleyip bırak, **Commit changes** de.
   `.github` klasörü görünmüyorsa: Windows'ta Gezgin > Görünüm > Gizli öğeler; Mac'te Finder'da Cmd+Shift+.
3. **Actions** sekmesi > soldan **TyrOS ISO derle** > **Run workflow** > yeşil **Run workflow** düğmesi.
4. 40–90 dakika sonra deponun sağ tarafındaki **Releases** bölümünde ISO indirilmeye hazır olur.

Varsayılan olarak hafif sürüm derlenir (LibreOffice ve GIMP hariç; bunları sonra Mağaza'dan kurabilirsin). Tam sürüm için Run workflow penceresindeki kutunun işaretini kaldır. ISO 2 GB'tan büyük çıkarsa parçalara bölünür ve nasıl birleştirileceği `BIRLESTIR.txt` dosyasında yazar.

### Yol 2: Docker ile (Windows, macOS veya Linux)

Docker Desktop kurulu olmalı. Windows'ta WSL terminalinde, Mac/Linux'ta normal terminalde:

```bash
./build-docker.sh
```

Not: Apple Silicon (M1/M2/M3) Mac'lerde amd64 ISO derlemek çok yavaştır; Yol 1'i kullan.

### Yol 3: Debian 13 üzerinde doğrudan

Gereken: **Debian 13** yüklü bir bilgisayar ya da sanal makine, internet bağlantısı, en az 20 GB boş alan.

```bash
sudo ./build.sh
```

Bitince klasörde `tyros-amd64.hybrid.iso` oluşur (yaklaşık 2.5–3 GB, süre 20–90 dakika).

USB belleğe yazmak için (sdX yerine kendi USB'ni yaz, yanlış disk seçersen verileri silersin):

```bash
sudo dd if=tyros-amd64.hybrid.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

Windows'ta Rufus ya da balenaEtcher kullanabilirsin. Sanal makinede denemek için ISO'yu VirtualBox veya virt-manager'da açman yeterli (en az 4 GB RAM ver).

## ISO derlemeden hemen dene

Herhangi bir Linux'ta (Python 3 yeterli):

```bash
./dev-run.sh
```

Tarayıcıda `http://127.0.0.1:8080` adresini aç. Arayüz senin sistemine bağlanır, uygulamalarını listeler ve açar.

## Giriş bilgileri

Canlı oturum otomatik açılır. Giriş ekranı çıkarsa kullanıcı adı `tyr`, şifre `live`. Açılış menüsündeki **Install** seçeneği TyrOS'u diske kurar; kurulumdan sonra tty1'de giriş yapınca arayüz otomatik başlar.

## Kısayollar

| Tuş | İşlev |
|---|---|
| Super | Başlat menüsü |
| Ctrl + Alt + T | Terminal |
| Ctrl + Alt + E | Dosyalar |
| Alt + F4 | Pencereyi kapat |

## Özelleştirme

- **Paket eklemek/çıkarmak:** `config/package-lists/tyros.list.chroot` dosyasına paket adı yaz ya da sil, sonra yeniden derle.
- **Arayüzü değiştirmek:** `config/includes.chroot/opt/tyros/ui/` içindeki HTML/CSS/JS dosyaları. Önce `./dev-run.sh` ile dene.
- **Yeni sistem özelliği:** `tyros-api.py` içinde bir fonksiyon yazıp `ROUTES` tablosuna ekle, arayüzden `API.get('/api/...')` ile çağır.
- **Dil ve klavye:** `auto/config` içindeki `locales=` ve `keyboard-layouts=` değerleri.

## Güvenlik

Apache sadece `127.0.0.1` adresini dinler; dışarıdan erişilemez. Bilinmeyen alan adlarıyla gelen istekler reddedilir (DNS rebinding koruması), API ayrıca `Host` başlığını ve özel `X-TyrOS` başlığını denetler; böylece internetteki bir site tarayıcın üzerinden sistemine komut gönderemez.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Derleme "paket bulunamadı" ile durdu | `build.log` dosyasında adı geçen paketi listeden sil, yeniden derle |
| Siyah ekran | Ctrl+Alt+F2 ile konsola geç, `~/.cache/tyros/*.log` ve `~/.cache/xsession.log` dosyalarına bak |
| Arayüz "sınırlı mod" diyor | Köprü çalışmıyor: `~/.cache/tyros/api.log` |
| Terminal basit modda açılıyor | `ttyd` kurulu değil ya da `/run/tyros` yok: `sudo systemd-tmpfiles --create` |
