#!/bin/bash
# TyrOS ISO derleyici — Debian 13 (trixie) üzerinde root olarak çalıştır:
#   sudo ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then echo "Root olarak çalıştır: sudo ./build.sh"; exit 1; fi
if ! grep -q 'ID=debian' /etc/os-release && ! grep -q 'ID_LIKE=.*debian' /etc/os-release; then
  echo "Uyarı: Bu betik Debian için yazıldı. Debian 13 dışında derleme hata verebilir."
fi

echo "==> Gerekli araçlar kuruluyor"
apt-get update
apt-get install -y live-build debootstrap squashfs-tools xorriso isolinux syslinux-common \
  grub-pc-bin grub-efi-amd64-bin mtools dosfstools python3-pil fonts-dejavu-core

echo "==> Logo ve açılış görselleri hazırlanıyor"
python3 tools/make-assets.py

chmod +x auto/* config/hooks/normal/*.hook.chroot \
  config/includes.chroot/usr/local/bin/* config/includes.chroot/opt/tyros/api/*.py

echo "==> Eski derleme temizleniyor"
lb clean --purge || true

echo "==> Yapılandırılıyor"
lb config

echo "==> ISO derleniyor (internet hızına göre 20-90 dakika sürer)"
lb build

ISO=$(ls -1 tyros-*.iso 2>/dev/null | head -n1 || true)
if [ -n "$ISO" ]; then
  echo
  echo "✔ Hazır: $(pwd)/$ISO ($(du -h "$ISO" | cut -f1))"
  echo "  USB'ye yazmak için: sudo dd if=$ISO of=/dev/sdX bs=4M status=progress oflag=sync"
else
  echo "✘ ISO oluşmadı. Ayrıntılar için build.log dosyasına bak."
  exit 1
fi
