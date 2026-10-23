#!/usr/bin/env python3
"""生成「便捷工具」内置壁纸（resources/wallpapers/*.jpg + manifest.json）。

设计目标：抽象、暗色、有层次，适合作为半透明黑玻璃面板的背景。
全部使用 numpy + Pillow 以随机种子的柔和渐变 / 模糊光斑 / 噪点合成，
不包含任何文字。

用法（Windows）：
    python scripts/gen-wallpapers.py

输出固定为 1920x1080 JPEG（quality 88 起，自动降质直到单张 <= 400KB），
并重写同目录下的 manifest.json。
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# ---------------------------------------------------------------- 基本参数

W, H = 1920, 1080
MAX_BYTES = 400 * 1024
QUALITY_STEPS = (88, 85, 82, 79, 76, 73, 70, 66)
OUT_DIR = Path(__file__).resolve().parent.parent / "resources" / "wallpapers"

# 内置壁纸清单（顺序决定 manifest / UI 展示顺序）
WALLPAPERS = [
    {
        "id": "midnight",
        "name": "午夜",
        "file": "midnight.jpg",
        "description": "深蓝黑底色上的微弱冷光与星尘，安静到几乎不打扰内容。",
        "accent": "#1e4fa8",
        "build": "midnight",
        "seed": 20240117,
    },
    {
        "id": "ocean",
        "name": "深海",
        "file": "ocean.jpg",
        "description": "深海青蓝的流动光带，像光从水面折射进暗处。",
        "accent": "#0a7d8c",
        "build": "ocean",
        "seed": 20240203,
    },
    {
        "id": "aurora",
        "name": "极光",
        "file": "aurora.jpg",
        "description": "紫蓝极光在极夜的深空里缓慢铺开。",
        "accent": "#7b5cff",
        "build": "aurora",
        "seed": 20240311,
    },
    {
        "id": "graphite",
        "name": "石墨",
        "file": "graphite.jpg",
        "description": "中性石墨灰的柔和雾面，接近无彩色，克制而耐看。",
        "accent": "#5a626c",
        "build": "graphite",
        "seed": 20240408,
    },
    {
        "id": "dusk",
        "name": "暮色",
        "file": "dusk.jpg",
        "description": "橙紫暮光沉入深色地平线，暖调只留在画面下沿。",
        "accent": "#c96a4a",
        "build": "dusk",
        "seed": 20240519,
    },
    {
        "id": "ember",
        "name": "余烬",
        "file": "ember.jpg",
        "description": "暗红余烬在近乎全黑的底上明灭，零星暖色光点。",
        "accent": "#b0431c",
        "build": "ember",
        "seed": 20240624,
    },
]

# ---------------------------------------------------------------- 颜色 / 坐标


def rgb(hex_str: str) -> np.ndarray:
    """'#rrggbb' -> float32 数组 [r, g, b] (0..255)。"""
    value = hex_str.lstrip("#")
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def coords() -> tuple[np.ndarray, np.ndarray]:
    x = np.linspace(0.0, 1.0, W, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]
    return x, y


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def clamp01(t: np.ndarray) -> np.ndarray:
    return np.clip(t, 0.0, 1.0)


def screen(img: np.ndarray, layer: np.ndarray) -> np.ndarray:
    """滤色混合：让光斑/光带自然叠加到暗底上。"""
    return 255.0 - (255.0 - img) * (255.0 - np.clip(layer, 0.0, 255.0)) / 255.0


def gradient_stops(stops: list[tuple[float, str]], angle_deg: float = 105.0) -> np.ndarray:
    """多段线性渐变（带平滑），stops 为 [(0..1, '#rrggbb'), ...]。"""
    xs, ys = coords()
    a = math.radians(angle_deg)
    t = xs * math.cos(a) + ys * math.sin(a)
    t = (t - float(t.min())) / max(float(t.max() - t.min()), 1e-6)
    out = np.zeros((H, W, 3), dtype=np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        color0, color1 = rgb(c0), rgb(c1)
        local = smoothstep((t - p0) / max(p1 - p0, 1e-6))
        seg = color0[None, None, :] * (1.0 - local[..., None]) + color1[None, None, :] * local[..., None]
        mask = (t >= p0) & (t <= p1)
        out[mask] = seg[mask]
    return out


def add_glow(
    img: np.ndarray,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    color: str,
    strength: float,
    angle_deg: float = 0.0,
) -> np.ndarray:
    """柔和高斯光斑。cx/cy 为归一化中心，rx/ry 为像素半径。"""
    x = np.arange(W, dtype=np.float32)[None, :]
    y = np.arange(H, dtype=np.float32)[:, None]
    dx = x - cx * W
    dy = y - cy * H
    if angle_deg:
        a = math.radians(angle_deg)
        ca, sa = math.cos(a), math.sin(a)
        dx, dy = dx * ca + dy * sa, -dx * sa + dy * ca
    d2 = (dx / max(rx, 1.0)) ** 2 + (dy / max(ry, 1.0)) ** 2
    intensity = np.exp(-0.5 * d2) * strength
    layer = rgb(color)[None, None, :] * intensity[..., None]
    return screen(img, layer)


def add_ribbon(
    img: np.ndarray,
    color: str,
    axis: str = "h",
    base: float = 0.5,
    amp: float = 0.05,
    freq: float = 1.3,
    phase: float = 0.0,
    width: float = 0.03,
    opacity: float = 0.25,
    tilt: float = 0.0,
    fade: float = 0.3,
) -> np.ndarray:
    """柔和光带（极光 / 水波 / 云层）。axis='h' 横向流动，'v' 纵向垂下。"""
    xs, ys = coords()
    along = xs if axis == "h" else ys
    across = ys if axis == "h" else xs
    center = (
        base
        + tilt * (along - 0.5)
        + amp * np.sin(2.0 * math.pi * (freq * along + phase))
        + amp * 0.45 * np.sin(2.0 * math.pi * (freq * 1.9 * along + phase * 1.7))
    )
    d = (across - center) / max(width, 1e-4)
    intensity = np.exp(-0.5 * d * d) * opacity
    if fade > 0:
        env = smoothstep(along / fade) * smoothstep((1.0 - along) / fade)
        intensity = intensity * env
    return screen(img, rgb(color)[None, None, :] * intensity[..., None])


def soft_field(rng: np.random.Generator, cells: int) -> np.ndarray:
    """低分辨率随机场放大成柔和云雾，返回 0..1 的 (H, W) 数组。"""
    gw = max(2, cells)
    gh = max(2, int(round(cells * H / W)))
    low = rng.random((gh, gw), dtype=np.float32)
    im = Image.fromarray((low * 255.0).astype(np.uint8), mode="L").resize((W, H), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def vignette(img: np.ndarray, strength: float = 0.6, power: float = 1.6) -> np.ndarray:
    xs, ys = coords()
    r = np.sqrt(((xs - 0.5) * 1.18) ** 2 + ((ys - 0.5) * 1.02) ** 2)
    fall = 1.0 - strength * smoothstep(clamp01((r - 0.26) / 0.74)) ** power
    return img * fall[..., None]


def add_points(
    img: np.ndarray,
    rng: np.random.Generator,
    count: int,
    colors: list[str],
    max_brightness: float,
    blur: float = 0.8,
    power: float = 2.0,
) -> np.ndarray:
    """随机亮点 / 星尘 / 余烬火星。"""
    if count <= 0:
        return img
    x = rng.integers(0, W, count)
    y = rng.integers(0, H, count)
    b = (rng.random(count, dtype=np.float32) ** power) * max_brightness
    palette = np.array([rgb(c) for c in colors], dtype=np.float32)
    idx = rng.integers(0, len(palette), count)
    layer = np.zeros((H, W, 3), dtype=np.float32)
    np.add.at(layer, (y, x), b[:, None] * palette[idx])
    blurred = Image.fromarray(np.clip(layer, 0, 255).astype(np.uint8), mode="RGB").filter(
        ImageFilter.GaussianBlur(blur)
    )
    return screen(img, np.asarray(blurred, dtype=np.float32))


# ---------------------------------------------------------------- 六张壁纸


def build_midnight(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops([(0.0, "#020309"), (0.52, "#050a15"), (1.0, "#03040b")], angle_deg=118)
    img = add_glow(img, 0.74, 0.26, 620, 420, "#17408d", 0.38, angle_deg=-18)
    img = add_glow(img, 0.18, 0.74, 680, 460, "#0a3057", 0.26, angle_deg=24)
    img = add_glow(img, 0.50, 0.02, 1000, 300, "#1a3d68", 0.11)
    haze = soft_field(rng, 6) - 0.5
    img = img + haze[..., None] * np.array([7.0, 10.0, 17.0], dtype=np.float32)
    img = add_points(img, rng, 560, ["#9fc2ff", "#dce8ff", "#6f9be0"], 58.0, blur=0.7, power=2.6)
    img = add_points(img, rng, 26, ["#aecdff", "#ffffff"], 120.0, blur=1.6, power=1.6)
    return vignette(img, 0.62)


def build_ocean(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops(
        [(0.0, "#02070d"), (0.42, "#042230"), (0.76, "#06333f"), (1.0, "#031017")], angle_deg=100
    )
    img = add_glow(img, 0.66, 0.40, 760, 340, "#0a7d8c", 0.38, angle_deg=-8)
    img = add_glow(img, 0.14, 0.82, 660, 320, "#0b4f66", 0.30, angle_deg=12)
    img = add_glow(img, 0.90, 0.10, 420, 260, "#0e5f78", 0.18)
    ribbons = [
        (("#2fd6d6",), 0.40, 0.045, 1.10, 0.12, 0.020, 0.30, 0.10),
        (("#1fa7bd",), 0.52, 0.055, 0.86, 0.55, 0.026, 0.26, -0.06),
        (("#2fb3a8",), 0.63, 0.040, 1.45, 0.30, 0.018, 0.22, 0.04),
        (("#1b7fa3",), 0.72, 0.060, 0.72, 0.82, 0.032, 0.20, -0.08),
        (("#3fd0c6",), 0.30, 0.030, 1.70, 0.66, 0.014, 0.16, 0.12),
    ]
    for colors, base, amp, freq, phase, width, opacity, tilt in ribbons:
        img = add_ribbon(
            img, colors[0], "h", base=base, amp=amp, freq=freq, phase=phase,
            width=width, opacity=opacity, tilt=tilt, fade=0.26,
        )
    ripples = soft_field(rng, 26) - 0.5
    img = img + ripples[..., None] * np.array([2.5, 6.0, 7.0], dtype=np.float32)
    img = add_points(img, rng, 180, ["#7fe8e0", "#bfefff"], 34.0, blur=1.3, power=2.4)
    return vignette(img, 0.56)


def build_aurora(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops(
        [(0.0, "#050310"), (0.46, "#090a24"), (0.80, "#060616"), (1.0, "#03030a")], angle_deg=95
    )
    img = add_glow(img, 0.52, 0.06, 900, 300, "#3b2f9e", 0.30)
    img = add_glow(img, 0.24, 0.30, 520, 360, "#5c46d8", 0.26, angle_deg=-20)
    img = add_glow(img, 0.80, 0.42, 560, 380, "#2f7fd8", 0.22, angle_deg=16)
    curtains = [
        ("#7b5cff", 0.30, 0.10, 1.05, 0.10, 0.020, 0.34, 0.22),
        ("#38c6ff", 0.44, 0.12, 0.72, 0.48, 0.016, 0.30, 0.28),
        ("#a04cff", 0.58, 0.09, 1.35, 0.72, 0.024, 0.30, 0.18),
        ("#3fa8ff", 0.70, 0.11, 0.90, 0.24, 0.014, 0.24, 0.26),
        ("#6a4df0", 0.82, 0.08, 1.60, 0.60, 0.022, 0.18, 0.14),
    ]
    for color, base, amp, freq, phase, width, opacity, tilt in curtains:
        img = add_ribbon(
            img, color, "v", base=base, amp=amp, freq=freq, phase=phase,
            width=width, opacity=opacity, tilt=tilt, fade=0.22,
        )
    img = add_ribbon(img, "#8c7bff", "h", base=0.13, amp=0.05, freq=0.8, phase=0.3,
                     width=0.05, opacity=0.16, tilt=0.05, fade=0.3)
    veil = soft_field(rng, 10) - 0.5
    img = img + veil[..., None] * np.array([6.0, 4.0, 14.0], dtype=np.float32)
    img = add_points(img, rng, 430, ["#b9c8ff", "#8fa4ff", "#e6ecff"], 48.0, blur=0.8, power=2.5)
    return vignette(img, 0.50)


def build_graphite(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops(
        [(0.0, "#0a0b0d"), (0.44, "#15171b"), (0.78, "#0e1013"), (1.0, "#070809")], angle_deg=112
    )
    img = add_glow(img, 0.28, 0.18, 860, 520, "#454c55", 0.20, angle_deg=-14)
    img = add_glow(img, 0.82, 0.72, 760, 520, "#2b3037", 0.26, angle_deg=18)
    img = add_glow(img, 0.52, 0.52, 500, 320, "#363c45", 0.10)
    # 拉长的柔和横向纹理，像经过拉丝的石墨面
    for i, (base, opacity) in enumerate(((0.30, 0.10), (0.50, 0.08), (0.68, 0.09))):
        img = add_ribbon(img, "#8c949e", "h", base=base, amp=0.018, freq=0.55 + i * 0.2,
                         phase=0.2 * i, width=0.055, opacity=opacity, tilt=0.02, fade=0.45)
    grain = soft_field(rng, 40) - 0.5
    img = img + grain[..., None] * np.array([6.0, 6.5, 7.0], dtype=np.float32)
    img = add_points(img, rng, 120, ["#aeb6c0"], 20.0, blur=1.0, power=2.2)
    return vignette(img, 0.46)


def build_dusk(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops(
        [(0.0, "#05040c"), (0.34, "#0f0817"), (0.62, "#1c0c22"), (0.82, "#2a1220"), (1.0, "#0c060b")],
        angle_deg=96,
    )
    img = add_glow(img, 0.74, 0.80, 900, 420, "#d96a2c", 0.26, angle_deg=-6)
    img = add_glow(img, 0.42, 0.86, 720, 300, "#a83c2f", 0.20, angle_deg=6)
    img = add_glow(img, 0.82, 0.24, 620, 420, "#573286", 0.15, angle_deg=-22)
    img = add_glow(img, 0.10, 0.30, 520, 380, "#2f2058", 0.11, angle_deg=18)
    clouds = [
        ("#c2603f", 0.70, 0.035, 0.48, 0.20, 0.05, 0.13, 0.03),
        ("#84405e", 0.55, 0.045, 0.35, 0.60, 0.07, 0.11, -0.02),
        ("#5e2f74", 0.38, 0.040, 0.30, 0.10, 0.06, 0.09, 0.02),
        ("#d98b4e", 0.84, 0.022, 0.60, 0.80, 0.03, 0.12, -0.02),
    ]
    for color, base, amp, freq, phase, width, opacity, tilt in clouds:
        img = add_ribbon(img, color, "h", base=base, amp=amp, freq=freq, phase=phase,
                         width=width, opacity=opacity, tilt=tilt, fade=0.24)
    haze = soft_field(rng, 8) - 0.5
    img = img + haze[..., None] * np.array([8.0, 4.0, 5.0], dtype=np.float32)
    img = add_points(img, rng, 90, ["#e8b283", "#d99a66"], 22.0, blur=1.2, power=2.0)
    return vignette(img, 0.64)


def build_ember(rng: np.random.Generator) -> np.ndarray:
    img = gradient_stops(
        [(0.0, "#040202"), (0.42, "#0a0302"), (0.70, "#120504"), (1.0, "#060201")], angle_deg=110
    )
    img = add_glow(img, 0.36, 0.62, 560, 360, "#581407", 0.20, angle_deg=-12)
    img = add_glow(img, 0.72, 0.44, 400, 280, "#8a280e", 0.18, angle_deg=20)
    img = add_glow(img, 0.58, 0.78, 680, 300, "#5e180b", 0.15, angle_deg=-6)
    img = add_glow(img, 0.16, 0.20, 380, 260, "#2c0b06", 0.10)
    img = add_ribbon(img, "#a83a14", "h", base=0.60, amp=0.035, freq=0.6, phase=0.35,
                     width=0.022, opacity=0.13, tilt=0.05, fade=0.3)
    img = add_ribbon(img, "#70200d", "h", base=0.72, amp=0.045, freq=0.42, phase=0.10,
                     width=0.05, opacity=0.10, tilt=-0.03, fade=0.34)
    smoke = soft_field(rng, 12) - 0.5
    img = img + smoke[..., None] * np.array([7.0, 2.0, 1.5], dtype=np.float32)
    img = add_points(img, rng, 340, ["#ff7a2f", "#ffb15c", "#d1401a", "#ffd9a0"], 92.0, blur=0.9, power=2.8)
    img = add_points(img, rng, 40, ["#ffcf9a", "#ffffff"], 150.0, blur=1.8, power=1.4)
    return vignette(img, 0.68)


BUILDERS = {
    "midnight": build_midnight,
    "ocean": build_ocean,
    "aurora": build_aurora,
    "graphite": build_graphite,
    "dusk": build_dusk,
    "ember": build_ember,
}

# ---------------------------------------------------------------- 输出


def render(item: dict) -> Image.Image:
    rng = np.random.default_rng(int(item["seed"]))
    img = BUILDERS[item["build"]](rng)
    img = np.clip(img, 0.0, 255.0)
    # 极轻的最终模糊，抹掉大面积渐变可能出现的色阶，再补上一层胶片颗粒
    smooth = Image.fromarray(img.astype(np.uint8), mode="RGB").filter(ImageFilter.GaussianBlur(0.45))
    arr = np.asarray(smooth, dtype=np.float32)
    arr += rng.normal(0.0, 1.5, (H, W, 1)).astype(np.float32)
    return Image.fromarray(np.clip(arr, 0.0, 255.0).astype(np.uint8), mode="RGB")


def save_jpeg(image: Image.Image, target: Path) -> tuple[int, int]:
    quality = QUALITY_STEPS[-1]
    size = 0
    for quality in QUALITY_STEPS:
        image.save(target, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=1)
        size = target.stat().st_size
        if size <= MAX_BYTES:
            break
    return quality, size


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    failures: list[str] = []

    print(f"输出目录: {OUT_DIR}")
    print(f"目标尺寸: {W}x{H}  JPEG  单张 <= {MAX_BYTES // 1024} KB\n")
    for item in WALLPAPERS:
        target = OUT_DIR / item["file"]
        image = render(item)
        quality, size = save_jpeg(image, target)
        kb = size / 1024.0
        with Image.open(target) as check:
            check.verify()
            width, height = check.size
        ok = size <= MAX_BYTES and (width, height) == (W, H)
        if not ok:
            failures.append(item["id"])
        print(f"  {item['id']:<9} {item['name']:<4}  {quality:>3}  {kb:7.1f} KB  {'OK' if ok else 'TOO LARGE'}")
        manifest.append(
            {
                "id": item["id"],
                "name": item["name"],
                "file": item["file"],
                "description": item["description"],
            }
        )

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n已写入 manifest: {manifest_path} ({len(manifest)} 项)")
    if failures:
        print(f"失败（超过体积上限）: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
