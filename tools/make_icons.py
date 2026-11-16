"""Render Cinnamon Label PNG icons with Pillow (mirrors extension/icons/logo.svg).

Usage: python3 tools/make_icons.py extension/icons   (needs Pillow; also writes icon512.png, not used by the extension)
"""
import math
import sys
from PIL import Image, ImageDraw

SS = 8  # supersampling


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


NAVY1, NAVY2 = hexc("#1E2A44"), hexc("#2D3E66")
BARK1, BARK2 = hexc("#D98A55"), hexc("#A9592E")
INNER, CREAM = hexc("#EFB98F"), hexc("#F6E3D3")


def arc(draw, s, cx, cy, r, a0, a1, width, color_fn):
    """Thick arc with round caps, drawn as many small discs (handles gradients and caps)."""
    steps = int(abs(a1 - a0) * r * s / 6) + 2
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x, y = (cx + r * math.cos(a)) * s, (cy + r * math.sin(a)) * s
        w = width * s / 2
        draw.ellipse([x - w, y - w, x + w, y + w], fill=color_fn(y / (128 * s)))


def render(size, simple):
    s = SS * size / 128
    W = round(128 * s)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    # tile with diagonal gradient
    grad = Image.new("RGBA", (W, W))
    gp = grad.load()
    for y in range(W):
        for x in range(W):
            t = (x + y) / (2 * W)
            gp[x, y] = lerp(NAVY1, NAVY2, t) + (255,)
    mask = Image.new("L", (W, W), 0)
    m = 4 if not simple else 2
    ImageDraw.Draw(mask).rounded_rectangle([m * s, m * s, (128 - m) * s, (128 - m) * s], radius=28 * s, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    bark = lambda t: lerp(BARK1, BARK2, min(1, max(0, (t - 0.2) / 0.6))) + (255,)
    if simple:
        # bigger, bolder curl centred in the tile; no bars
        arc(d, s, 64, 64, 38, -40, -320, 19, bark)
        arc(d, s, 64, 64, 15, 140, 140 + 290, 13, lambda t: INNER + (255,))
    else:
        arc(d, s, 54, 64, 34, -45, -315, 13, bark)
        arc(d, s, 54, 64, 17, 140, 140 + 290, 9, lambda t: INNER + (255,))
        for x, y, h in ((86, 54, 20), (97, 44, 40), (108, 51, 26)):
            d.rounded_rectangle([x * s, y * s, (x + 7) * s, (y + h) * s], radius=3.5 * s, fill=CREAM + (255,))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = sys.argv[1]
    for size in (16, 32, 48, 128, 512):
        render(size, simple=size <= 32).save(f"{out}/icon{size}.png")
    print("ok")
