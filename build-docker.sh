#!/bin/bash
# Docker ile derleme: Windows (WSL), macOS (Intel) veya herhangi bir Linux'ta çalışır.
# Gereken: Docker kurulu ve çalışıyor olmalı.  Kullanım: ./build-docker.sh
set -e
cd "$(dirname "$0")"
docker run --rm --privileged -v "$PWD":/build -w /build debian:trixie bash -euxc '
  apt-get update
  apt-get install -y live-build debootstrap squashfs-tools xorriso isolinux syslinux-common \
    grub-pc-bin grub-efi-amd64-bin mtools dosfstools
  chmod +x auto/* config/hooks/normal/*.hook.chroot config/includes.chroot/usr/local/bin/* config/includes.chroot/opt/tyros/api/*.py
  lb clean --purge || true
  lb config
  lb build
'
ls -lh tyros-*.iso
