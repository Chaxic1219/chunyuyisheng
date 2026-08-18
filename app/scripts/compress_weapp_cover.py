#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将小程序贴片封面压成企微友好的 JPEG。

用法：
  python3 compress_weapp_cover.py <in_path> <out_path>
  或 stdin base64 → stdout 写二进制长度前缀协议不方便；仅用文件路径。

约束（对齐真机采集量级）：
  - 最长边 ≤ 800
  - JPEG quality 自适应，目标 ≤ 120KB，硬顶 200KB
"""
from __future__ import print_function
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("usage: compress_weapp_cover.py <in> <out>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not installed", file=sys.stderr)
        return 3

    im = Image.open(src)
    im.load()
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        rgba = im.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")

    max_edge = 800
    w, h = im.size
    scale = min(1.0, float(max_edge) / float(max(w, h)))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    os.makedirs(os.path.dirname(os.path.abspath(dst)) or ".", exist_ok=True)
    last = None
    for q in (85, 80, 75, 70, 65, 60, 55, 50):
        im.save(dst, format="JPEG", quality=q, optimize=True)
        last = os.path.getsize(dst)
        if last <= 120 * 1024:
            print("ok bytes=%d quality=%d size=%dx%d" % (last, q, im.size[0], im.size[1]))
            return 0
    if last and last <= 200 * 1024:
        print("ok bytes=%d quality=50 size=%dx%d (soft)" % (last, im.size[0], im.size[1]))
        return 0
    print("still too large: %s" % last, file=sys.stderr)
    return 4

if __name__ == "__main__":
    sys.exit(main())
