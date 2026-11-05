#!/usr/bin/env python3
"""把 raw/ 下的原始截图转成 Chrome 应用商店要求的格式。

商店要求：
  - 截图      1280x800 或 640x400，JPEG 或 24 位 PNG（无 alpha 透明层）
  - 小型图块  440x280
  - 顶部图块  1400x560
  - 图标      128x128（已有，直接用 assets/icons/icon128.png）
"""
from __future__ import annotations

import os
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "store-assets", "raw")
OUT = os.path.join(ROOT, "store-assets")

# 文件名 -> 期望尺寸
TARGETS = {
    "screenshot-1.png": (1280, 800),
    "screenshot-2.png": (1280, 800),
    "screenshot-3.png": (1280, 800),
    "screenshot-4.png": (1280, 800),
    "promo-440x280.png": (440, 280),
    "promo-1400x560.png": (1400, 560),
}


def main() -> None:
    ok = True
    print("转换并校验：")

    for name, (want_w, want_h) in TARGETS.items():
        src = os.path.join(RAW, name)
        if not os.path.exists(src):
            print(f"  ❌ 缺少 {name}")
            ok = False
            continue

        img = Image.open(src)
        if img.size != (want_w, want_h):
            print(f"  ❌ {name} 尺寸 {img.size}，应为 {(want_w, want_h)}")
            ok = False
            continue

        # 去掉 alpha 通道，确保是 24 位 RGB
        rgb = img.convert("RGB")
        dst = os.path.join(OUT, name)
        rgb.save(dst, format="PNG", optimize=True)

        # 复验
        check = Image.open(dst)
        size_kb = os.path.getsize(dst) / 1024
        good = check.mode == "RGB" and check.size == (want_w, want_h)
        mark = "✅" if good else "❌"
        print(f"  {mark} {name:22s} {want_w}x{want_h}  {check.mode}  {size_kb:6.1f} KB")
        if not good:
            ok = False

    # 图标直接复用
    icon_src = os.path.join(ROOT, "assets", "icons", "icon128.png")
    icon_dst = os.path.join(OUT, "icon-128x128.png")
    Image.open(icon_src).convert("RGB").save(icon_dst, format="PNG", optimize=True)
    print(f"  ✅ {'icon-128x128.png':22s} 128x128  RGB  {os.path.getsize(icon_dst)/1024:6.1f} KB")

    print()
    if ok:
        print("全部素材符合商店要求 ✅")
    else:
        print("有素材不符合要求 ❌")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
