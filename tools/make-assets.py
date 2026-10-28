#!/usr/bin/env python3
"""TyrOS marka görsellerini branding/logo.webp dosyasından üretir.

Derlemeden önce çalışır (ISO derleme betikleri bunu otomatik yapar):
  - arayüz logosu           -> config/includes.chroot/opt/tyros/ui/img/logo.png
  - açılış animasyonu logosu -> config/includes.chroot/usr/share/plymouth/themes/tyros/logo.png
  - BIOS açılış menüsü       -> config/bootloaders/isolinux/splash.png  (640x480)
  - UEFI açılış menüsü       -> config/bootloaders/grub-pc/splash.png   (800x600)
Gerekli: python3-pil, fonts-dejavu-core
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG_TOP = (14, 22, 40)
BG_BOTTOM = (8, 13, 24)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def path(*p):
    full = os.path.join(ROOT, *p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    return full


def logo(size):
    return LOGO.resize((size, size), Image.LANCZOS)


def splash(w, h, logo_size, logo_top, text_size, text_top):
    img = Image.new("RGBA", (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        px.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)) + (255,))
    img.alpha_composite(logo(logo_size), ((w - logo_size) // 2, logo_top))
    try:
        font = ImageFont.truetype(FONT, text_size)
    except OSError:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(img)
    text = "TyrOS"
    tw = d.textlength(text, font=font)
    d.text(((w - tw) / 2, text_top), text, font=font, fill=(231, 237, 242, 255))
    return img.convert("RGB")


LOGO = Image.open(os.path.join(ROOT, "branding", "logo.webp")).convert("RGBA")

logo(256).save(path("config/includes.chroot/opt/tyros/ui/img/logo.png"))
logo(200).save(path("config/includes.chroot/usr/share/plymouth/themes/tyros/logo.png"))
splash(640, 480, 180, 34, 30, 222).save(path("config/bootloaders/isolinux/splash.png"))
splash(800, 600, 230, 48, 38, 290).save(path("config/bootloaders/grub-pc/splash.png"))
print("TyrOS görselleri hazır")
