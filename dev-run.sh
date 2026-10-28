#!/bin/bash
# TyrOS arayüzünü ISO derlemeden, mevcut Linux'unda dene.
# Sonra tarayıcıda aç: http://127.0.0.1:8080
cd "$(dirname "$0")"
[ -f config/includes.chroot/opt/tyros/ui/img/logo.png ] || python3 tools/make-assets.py
cd config/includes.chroot/opt/tyros
exec python3 api/tyros-api.py --ui ui --port 8080 "$@"
