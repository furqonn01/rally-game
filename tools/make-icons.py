"""
Pembuat ikon PWA untuk game BAIC BJ40 Offroad.

Menghasilkan PNG di public/icons/:
  icon-192.png            -> ikon "any" 192x192
  icon-512.png            -> ikon "any" 512x512
  icon-maskable-512.png   -> ikon maskable (konten di dalam safe zone ~80%)
  apple-touch-icon.png    -> 180x180 untuk iOS (tanpa transparansi)

Jalankan:  python tools/make-icons.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
SS = 4  # supersampling agar tepi mulus

BG_TOP = (0x18, 0x22, 0x31)
BG_BOTTOM = (0x06, 0x09, 0x0E)
AMBER = (0xFF, 0xB3, 0x47)
AMBER_DEEP = (0xFF, 0x7A, 0x18)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def make_background(size):
    """Gradien vertikal gelap + glow amber (matahari terbenam) di belakang bukit."""
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(BG_TOP, BG_BOTTOM, y / max(1, size - 1)))

    glow = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(glow)
    r = size * 0.42
    cx, cy = size * 0.5, size * 0.58
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.09))

    glow_layer = Image.new("RGB", (size, size), AMBER)
    return Image.composite(glow_layer, img, glow)


def draw_mountains(img):
    size = img.size[0]
    d = ImageDraw.Draw(img)

    far = (0x30, 0x40, 0x55)
    near = (0x1A, 0x25, 0x33)

    d.polygon(
        [
            (size * 0.00, size * 0.80),
            (size * 0.22, size * 0.48),
            (size * 0.40, size * 0.64),
            (size * 0.58, size * 0.42),
            (size * 0.84, size * 0.80),
            (size * 1.00, size * 0.72),
            (size * 1.00, size * 1.00),
            (size * 0.00, size * 1.00),
        ],
        fill=far,
    )
    d.polygon(
        [
            (size * 0.00, size * 0.88),
            (size * 0.18, size * 0.66),
            (size * 0.36, size * 0.84),
            (size * 0.60, size * 0.62),
            (size * 0.80, size * 0.84),
            (size * 1.00, size * 0.72),
            (size * 1.00, size * 1.00),
            (size * 0.00, size * 1.00),
        ],
        fill=near,
    )
    return img


def draw_wheel(img, scale=1.0):
    """Emblem roda offroad: ban bergerigi, pelek, 5 palang, hub."""
    size = img.size[0]
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy = size * 0.5, size * 0.56
    R = size * 0.26 * scale

    # ban luar
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=AMBER, width=int(size * 0.05))

    # gerigi tapak ban
    tread_r = R * 0.985
    for i in range(20):
        a = math.radians(i * 18)
        r0 = tread_r * 0.94
        d.line(
            [
                (cx + math.cos(a) * r0, cy + math.sin(a) * r0),
                (cx + math.cos(a) * tread_r, cy + math.sin(a) * tread_r),
            ],
            fill=AMBER_DEEP,
            width=int(size * 0.014),
        )

    # pelek dalam
    Ri = R * 0.58
    d.ellipse([cx - Ri, cy - Ri, cx + Ri, cy + Ri], outline=AMBER, width=int(size * 0.026))

    # 5 palang
    for i in range(5):
        a = math.radians(i * 72 - 90)
        r1 = Ri * 0.26
        r2 = Ri * 0.98
        d.line(
            [
                (cx + math.cos(a) * r1, cy + math.sin(a) * r1),
                (cx + math.cos(a) * r2, cy + math.sin(a) * r2),
            ],
            fill=AMBER,
            width=int(size * 0.034),
        )

    # hub
    rh = R * 0.15
    d.ellipse([cx - rh, cy - rh, cx + rh, cy + rh], fill=AMBER)
    return img


def build(size, scale=1.0):
    big = size * SS
    img = make_background(big)
    img = draw_mountains(img)
    img = draw_wheel(img, scale=scale)
    img = img.resize((size, size), Image.LANCZOS)
    return img.convert("RGB")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-maskable-512.png", 512, 0.74),
        ("apple-touch-icon.png", 180, 1.0),
    ]
    for name, size, scale in jobs:
        img = build(size, scale=scale)
        path = os.path.normpath(os.path.join(OUT_DIR, name))
        img.save(path, "PNG", optimize=True)
        print("dibuat:", path, img.size)


if __name__ == "__main__":
    main()
