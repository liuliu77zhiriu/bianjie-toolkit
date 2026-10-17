"""生成应用图标 / 托盘图标（Pillow）。运行：
python scripts/gen-icons.py
"""
from PIL import Image, ImageDraw
import math
import os

S = 1024
C = S / 2
ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "resources", "icons")
os.makedirs(ICON_DIR, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def make_icon(size=S, with_bg=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = size / S
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(228 * scale)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)

    if with_bg:
        bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bg)
        top = (18, 32, 62)
        bottom = (7, 12, 26)
        for y in range(size):
            t = y / max(1, size - 1)
            color = lerp(top, bottom, t)
            bd.line([(0, y), (size, y)], fill=color + (255,))
        # 右上角蓝色光晕
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for r in range(int(size * 0.62), 0, -3):
            a = int(70 * (1 - r / (size * 0.62)) ** 2)
            gd.ellipse(
                [size * 0.62 - r, -size * 0.18 - r, size * 0.62 + r, -size * 0.18 + r],
                fill=(76, 141, 255, a),
            )
        bg = Image.alpha_composite(bg, glow)
        img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # 2x2 工具块
    cell = int(220 * scale)
    gap = int(56 * scale)
    start_x = int(C - cell - gap / 2)
    start_y = int(C - cell - gap / 2)
    blocks = [
        (0, 0, (233, 241, 255, 245)),
        (1, 0, (150, 190, 255, 190)),
        (0, 1, (150, 190, 255, 150)),
        (1, 1, (76, 141, 255, 255)),
    ]
    for cx, cy, color in blocks:
        x = start_x + cx * (cell + gap)
        y = start_y + cy * (cell + gap)
        d.rounded_rectangle([x, y, x + cell, y + cell], radius=int(52 * scale), fill=color)
    # 悬浮球高光
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse(
        [int(size * 0.08), int(size * 0.04), int(size * 0.56), int(size * 0.4)],
        fill=(255, 255, 255, 26),
    )
    img = Image.alpha_composite(img, hl)
    return img


icon = make_icon(S)
icon.save(os.path.join(ICON_DIR, "app.png"))
sizes = [16, 24, 32, 48, 64, 128, 256]
icon.save(os.path.join(ICON_DIR, "app.ico"), sizes=[(s, s) for s in sizes])

# 托盘：透明背景 + 简洁图形（16/32 可读）
tray = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
td = ImageDraw.Draw(tray)
td.rounded_rectangle([3, 3, 61, 61], radius=16, fill=(12, 22, 42, 235), outline=(96, 150, 255, 210), width=2)
for i, (x, y) in enumerate([(18, 18), (36, 18), (18, 36)]):
    td.rounded_rectangle([x, y, x + 10, y + 10], radius=3, fill=(214, 230, 255, 235))
td.rounded_rectangle([36, 36, 46, 46], radius=3, fill=(76, 141, 255, 255))
tray.save(os.path.join(ICON_DIR, "tray.png"))
tray.resize((32, 32), Image.LANCZOS).save(os.path.join(ICON_DIR, "tray@2x.png"))
print("icons written to", os.path.abspath(ICON_DIR))
