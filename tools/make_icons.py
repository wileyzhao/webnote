#!/usr/bin/env python3
"""生成 WebNote 的图标：亮黄圆角底 + 一支简笔。

风格目标：明亮、简单、16px 下仍能认出是一支笔。
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw

SS = 8  # 超采样倍数
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "assets", "icons")

PLATE_TOP = (255, 226, 122)
PLATE_BOTTOM = (255, 179, 0)
INK = (31, 35, 40, 255)


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    t = np.linspace(0.0, 1.0, size).reshape(size, 1, 1)
    top_arr = np.array(top, dtype=np.float32).reshape(1, 1, 3)
    bottom_arr = np.array(bottom, dtype=np.float32).reshape(1, 1, 3)
    rgb = np.broadcast_to(top_arr + (bottom_arr - top_arr) * t, (size, size, 3)).astype(np.uint8)
    alpha = np.full((size, size, 1), 255, dtype=np.uint8)
    return Image.fromarray(np.concatenate([rgb, alpha], axis=2), "RGBA")


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_icon(size: int) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    plate = vertical_gradient(s, PLATE_TOP, PLATE_BOTTOM)
    img.paste(plate, (0, 0), rounded_mask(s, int(s * 0.225)))

    draw = ImageDraw.Draw(img, "RGBA")

    # 笔的方向：指向左下（135°）
    ang = math.radians(135)
    dx, dy = math.cos(ang), math.sin(ang)          # 沿笔身方向
    px, py = -dy, dx                               # 垂直于笔身

    length = s * 0.52
    width = s * 0.175
    tip = s * 0.155

    # 让整支笔（含笔尖）在视觉上居中
    cx = s / 2 - dx * tip / 2
    cy = s / 2 - dy * tip / 2

    tail = (cx - dx * length / 2, cy - dy * length / 2)   # 笔尾（右上）
    head = (cx + dx * length / 2, cy + dy * length / 2)   # 笔尖根部（左下）
    point = (head[0] + dx * tip, head[1] + dy * tip)      # 笔尖

    hw = width / 2
    p1 = (tail[0] + px * hw, tail[1] + py * hw)
    p2 = (head[0] + px * hw, head[1] + py * hw)
    p3 = (head[0] - px * hw, head[1] - py * hw)
    p4 = (tail[0] - px * hw, tail[1] - py * hw)

    draw.polygon([p1, p2, p3, p4], fill=INK)
    # 笔尾圆角
    draw.ellipse([tail[0] - hw, tail[1] - hw, tail[0] + hw, tail[1] + hw], fill=INK)
    # 笔尖三角形
    draw.polygon([p2, point, p3], fill=INK)

    # 笔杆与笔尖的接缝：一道细亮线，让小尺寸也能读出“笔尖”
    gap = s * 0.012
    g1 = (head[0] + px * hw * 0.55 + dx * gap, head[1] + py * hw * 0.55 + dy * gap)
    g2 = (head[0] - px * hw * 0.55 + dx * gap, head[1] - py * hw * 0.55 + dy * gap)
    draw.line([g1, g2], fill=(255, 206, 72, 235), width=max(2, int(s * 0.018)))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        draw_icon(size).save(path, format="PNG", optimize=True)
        print("wrote", path)

    # 预览：浅色与深色工具栏背景下的实际观感
    pad = 36
    cell = 128
    w = cell * 4 + pad * 5
    canvas = Image.new("RGBA", (w, cell * 2 + pad * 3), (243, 244, 246, 255))
    canvas.paste(Image.new("RGBA", (w, cell + pad), (32, 33, 36, 255)), (0, 0))

    for row, top in ((0, 0), (1, cell + pad * 2)):
        for i, size in enumerate((16, 32, 48, 128)):
            icon = draw_icon(size)
            x = pad + i * (cell + pad) + (cell - size) // 2
            y = top + pad + (cell - size) // 2
            canvas.paste(icon, (x, y), icon)

    preview = os.path.join(HERE, "_preview.png")
    canvas.save(preview)
    print("wrote", preview)


if __name__ == "__main__":
    main()
