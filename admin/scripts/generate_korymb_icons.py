"""Génère les icônes PWA / favicon Korymb (corymbe stylisé, lisible en petit)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "public"
ROOT.mkdir(parents=True, exist_ok=True)

# Violet marque (aligné theme_color / accent)
BG = (91, 33, 182)  # #5b21b6
FG = (255, 255, 255)


def draw_icon(size: int, *, maskable: bool = False) -> Image.Image:
    # Super-échantillon pour anti-alias propre, puis downscale
    scale = 4 if size <= 64 else (2 if size <= 256 else 1)
    canvas = size * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=int(canvas * 0.22), fill=BG)

    cx = canvas / 2
    # Symbole un peu plus haut et plus grand (lisible en raccourci)
    base_y = canvas * 0.68
    base_x = cx

    r_head = max(3 * scale, int(canvas * 0.095))
    stem_w = max(3 * scale, int(canvas * 0.045))
    reach = canvas * 0.30

    angles = [-52, -26, 0, 26, 52]
    heads: list[tuple[float, float]] = []
    for ang in angles:
        rad = math.radians(ang)
        hx = base_x + math.sin(rad) * reach
        hy = base_y - math.cos(rad) * reach * 1.05
        heads.append((hx, hy))

    for hx, hy in heads:
        d.line([(base_x, base_y), (hx, hy)], fill=FG, width=stem_w)

    node = max(3 * scale, int(canvas * 0.045))
    d.ellipse([base_x - node, base_y - node, base_x + node, base_y + node], fill=FG)

    for hx, hy in heads:
        d.ellipse([hx - r_head, hy - r_head, hx + r_head, hy + r_head], fill=FG)

    if scale > 1:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img


def save_png(img: Image.Image, name: str) -> None:
    path = ROOT / name
    img.save(path, format="PNG", optimize=True)
    print("wrote", path, img.size)


def main() -> None:
    # Standard + maskable (safe zone)
    for size, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png"), (32, "icon-32.png"), (16, "icon-16.png")):
        save_png(draw_icon(size, maskable=False), name)

    save_png(draw_icon(192, maskable=True), "icon-192-maskable.png")
    save_png(draw_icon(512, maskable=True), "icon-512-maskable.png")

    # favicon.ico multi-résolution
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    images = [draw_icon(s[0], maskable=False) for s in ico_sizes]
    ico_path = ROOT / "favicon.ico"
    images[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=images[1:])
    # Aussi dans app/ pour Next App Router
    app_ico = Path(__file__).resolve().parents[1] / "app" / "favicon.ico"
    images[0].save(app_ico, format="ICO", sizes=ico_sizes, append_images=images[1:])
    print("wrote", ico_path)
    print("wrote", app_ico)


if __name__ == "__main__":
    main()
