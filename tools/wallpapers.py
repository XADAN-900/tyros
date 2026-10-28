"""TyrOS duvar kağıtları — sadece Pillow ile, derleme sırasında üretilir (tools/make-assets.py çağırır)."""
import math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

K = 3                     # çizim doğrudan 4K (3840x2160) çözünürlükte yapılır
W, H = 1280 * K, 720 * K
OUT_W, OUT_H = W, H

def hexc(s): s = s.lstrip('#'); return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def vgrad(top, bottom, w=W, h=H):
    g = Image.linear_gradient('L').resize((w, h))
    return Image.composite(Image.new('RGB', (w, h), hexc(bottom)), Image.new('RGB', (w, h), hexc(top)), g)

def glow(base, cx, cy, rx, ry, color, alpha, blur):
    layer = Image.new('RGB', base.size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=tuple(int(c * alpha) for c in hexc(color)))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return ImageChops.add(base, layer)

def stars(img, n, seed, ymax=1.0, bright=200):
    r = random.Random(seed); d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = r.random() * img.width, r.random() * img.height * ymax
        b = int(r.random() ** 3 * bright) + 40
        s = r.choice([0, 0, 0, 1]) * K + (K - 1) * .5
        d.ellipse([x - s, y - s, x + s, y + s], fill=(b, b, min(255, b + 15)))
    return img

def finish(img, grain=2, seed=1):
    if not grain:
        return img if img.size == (OUT_W, OUT_H) else img.resize((OUT_W, OUT_H), Image.LANCZOS)
    big = img if img.size == (OUT_W, OUT_H) else img.resize((OUT_W, OUT_H), Image.LANCZOS)
    noise = Image.effect_noise((OUT_W, OUT_H), 64).convert('RGB')
    noise = Image.eval(noise, lambda v: 128 + (v - 128) * grain // 64)
    big = ImageChops.add(ImageChops.subtract(big, Image.new('RGB', big.size, (grain,) * 3)), ImageChops.subtract(noise, Image.new('RGB', big.size, (128 - grain,) * 3)))
    return big

def ribbon(size, pts_fn, width, c1, c2, steps=400):
    """Kalın, renk geçişli eğri şerit."""
    layer = Image.new('RGB', size, (0, 0, 0)); d = ImageDraw.Draw(layer)
    a, b = hexc(c1), hexc(c2)
    prev = None
    for i in range(steps + 1):
        t = i / steps
        x, y = pts_fn(t)
        col = tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))
        w = width * (0.35 + 0.65 * math.sin(math.pi * t))
        d.ellipse([x - w, y - w, x + w, y + w], fill=col)
    return layer

def logo_layer(logo, size, cx, cy, canvas, opacity=1.0, glow_color=None):
    lg = logo.resize((size, size), Image.LANCZOS)
    if opacity < 1:
        lg.putalpha(lg.getchannel('A').point(lambda v: int(v * opacity)))
    out = canvas.convert('RGBA')
    if glow_color:
        g = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        sh = Image.new('RGBA', lg.size, hexc(glow_color) + (0,)); sh.putalpha(lg.getchannel('A').point(lambda v: v // 2))
        g.alpha_composite(sh, (int(cx - size / 2), int(cy - size / 2)))
        g = g.filter(ImageFilter.GaussianBlur(size // 6))
        out.alpha_composite(g)
    out.alpha_composite(lg, (int(cx - size / 2), int(cy - size / 2)))
    return out.convert('RGB')

# ------------------------------------------------------------ 1) TyrOS (gece)
def w_tyros(logo):
    img = vgrad('#060a15', '#0b1222')
    img = glow(img, W * .28, H * .32, 380 * K, 260 * K, '#1e6fb8', .38, 190 * K)
    img = glow(img, W * .74, H * .66, 420 * K, 290 * K, '#6a3fb8', .42, 200 * K)
    img = glow(img, W * .82, H * .18, 200 * K, 140 * K, '#b0479a', .18, 140 * K)
    img = glow(img, W * .15, H * .85, 260 * K, 180 * K, '#1aa3a3', .18, 140 * K)
    img = stars(img, 140, 3, bright=150)
    img = logo_layer(logo, 230 * K, W / 2, H * .42, img, 1.0, '#7d6bf0')
    return img

# ------------------------------------------------------------ 2) Akış (şeritler)
def w_flow(logo):
    img = vgrad('#05070f', '#0a0f1e')
    img = glow(img, W * .5, H * .5, 600 * K, 340 * K, '#13254a', .8, 200 * K)
    specs = [
        (lambda t: (-80 * K + t * (W + 160 * K), H * .62 + math.sin(t * math.pi * 1.6 + .4) * 170 * K), 120 * K, '#2f86c9', '#7a4fc4'),
        (lambda t: (-80 * K + t * (W + 160 * K), H * .70 + math.sin(t * math.pi * 1.3 + 1.6) * 140 * K), 80 * K, '#5b4fd6', '#d05fa8'),
        (lambda t: (-80 * K + t * (W + 160 * K), H * .52 + math.sin(t * math.pi * 1.9 + 2.4) * 110 * K), 46 * K, '#22b5c9', '#4f7ff0'),
    ]
    for fn, wdt, c1, c2 in specs:
        soft = ribbon(img.size, fn, wdt, c1, c2, steps=400 * K).filter(ImageFilter.GaussianBlur(38 * K))
        sharp = ribbon(img.size, fn, wdt * .55, c1, c2, steps=400 * K).filter(ImageFilter.GaussianBlur(6 * K))
        img = ImageChops.add(img, Image.eval(soft, lambda v: int(v * .55)))
        img = ImageChops.screen(img, Image.eval(sharp, lambda v: int(v * .55)))
    img = stars(img, 60, 9, ymax=.45, bright=120)
    return img

# ------------------------------------------------------------ 3) Kuzey ışıkları
def w_aurora(logo):
    img = vgrad('#020610', '#0a1d2b')
    img = stars(img, 260, 21, ymax=.8, bright=220)
    cur = Image.new('RGB', img.size, (0, 0, 0)); d = ImageDraw.Draw(cur)
    for band, (base_y, amp, c1, c2, ph) in enumerate([(H * .30, 70 * K, '#3ee0a6', '#2fa9c9', 0), (H * .40, 55 * K, '#57d6a0', '#8a6ff0', 2.1)]):
        a, b = hexc(c1), hexc(c2)
        for x in range(0, W, 2):
            t = x / W
            y = base_y + math.sin(t * 5.2 + ph) * amp + math.sin(t * 13 + ph * 2) * 18 * K
            hgt = (170 + 120 * (0.5 + 0.5 * math.sin(t * 7 + ph))) * K
            col = tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))
            for k in range(int(hgt)):
                f = (1 - k / hgt) ** 2
                d.point((x, y - k), fill=tuple(int(c * f * .95) for c in col))
    cur = cur.filter(ImageFilter.GaussianBlur(10 * K))
    img = ImageChops.add(img, cur)
    img = ImageChops.add(img, Image.eval(cur.filter(ImageFilter.GaussianBlur(50 * K)), lambda v: int(v * 1.0)))
    d = ImageDraw.Draw(img)
    for i, (yb, amp, col, seed) in enumerate([(H * .78, 70 * K, '#0a1620', 5), (H * .86, 50 * K, '#060d14', 8)]):
        r = random.Random(seed); pts = [(0, H)]
        x = 0
        while x <= W:
            pts.append((x, yb - abs(math.sin(x / (140 * K) + seed)) * amp - r.random() * 18 * K)); x += 20 * K
        pts += [(W, H)]
        d.polygon(pts, fill=hexc(col))
    return img

# ------------------------------------------------------------ 4) Kum tepeleri (sıcak)
def w_dunes(logo):
    img = vgrad('#1b1430', '#e0866a')
    img = glow(img, W * .68, H * .55, 140 * K, 140 * K, '#ffd6a0', .9, 60 * K)
    img = glow(img, W * .68, H * .55, 420 * K, 260 * K, '#ff9a6a', .35, 160 * K)
    layers = [('#9c4f63', '#c96f6a', H * .62, 60 * K, 1.2, 0), ('#6d3557', '#8e4561', H * .72, 70 * K, .9, 1.7),
              ('#3d2042', '#55294f', H * .82, 60 * K, 1.5, 3.1), ('#1d1128', '#2a1838', H * .92, 40 * K, 1.1, 4.4)]
    for c1, c2, yb, amp, fq, ph in layers:
        mask = Image.new('L', img.size, 0); d = ImageDraw.Draw(mask)
        pts = [(0, H)] + [(x, yb - math.sin(x / W * math.pi * fq + ph) * amp - math.sin(x / W * 9 + ph) * 8 * K) for x in range(0, W + 8, 4)] + [(W, H)]
        d.polygon(pts, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(1.5 * K))
        img = Image.composite(vgrad(c1, c2), img, mask)
    return img

# ------------------------------------------------------------ 5) Okyanus (dalgalar)
def w_ocean(logo):
    img = vgrad('#04121c', '#062a3a')
    img = glow(img, W * .5, H * .15, 600 * K, 220 * K, '#2a6f9a', .45, 180 * K)
    for i in range(9):
        t = i / 8
        yb = H * (.38 + t * .62)
        c = tuple(int(a + (b - a) * t) for a, b in zip(hexc('#1f6f95'), hexc('#041621')))
        mask = Image.new('L', img.size, 0); d = ImageDraw.Draw(mask)
        pts = [(0, H)] + [(x, yb - math.sin(x / W * math.pi * (2 + i * .3) + i * 1.3) * (26 + i * 6) * K) for x in range(0, W + 8, 4)] + [(W, H)]
        d.polygon(pts, fill=255)
        hl = Image.new('L', img.size, 0); dh = ImageDraw.Draw(hl); dh.line(pts[1:-1], fill=90, width=2 * K)
        img = Image.composite(Image.new('RGB', img.size, c), img, mask.filter(ImageFilter.GaussianBlur(2 * K)))
        img = ImageChops.add(img, Image.merge('RGB', [hl.point(lambda v: v // 3), hl.point(lambda v: v // 2), hl.point(lambda v: v // 2)]).filter(ImageFilter.GaussianBlur(1.2 * K)))
    return img

WALLS = [('tyros', 'TyrOS', w_tyros), ('akis', 'Akış', w_flow), ('kuzey', 'Kuzey ışıkları', w_aurora),
         ('kum', 'Kum tepeleri', w_dunes), ('okyanus', 'Okyanus', w_ocean)]

def build(logo, outdir):
    import os
    os.makedirs(outdir, exist_ok=True)
    for key, _name, fn in WALLS:
        img = finish(fn(logo))
        img.save(os.path.join(outdir, f'{key}.jpg'), quality=95, subsampling=0, optimize=True, progressive=True)
        img.resize((480, 270), Image.LANCZOS).save(os.path.join(outdir, f'{key}-k.jpg'), quality=88)
