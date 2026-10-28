[ -f ~/.profile ] && . ~/.profile
# tty1'de giriş yapılınca TyrOS grafik oturumunu başlat
if [ -z "$DISPLAY" ] && [ "$(tty)" = /dev/tty1 ]; then
  exec startx >"$HOME/.cache/xsession.log" 2>&1
fi
