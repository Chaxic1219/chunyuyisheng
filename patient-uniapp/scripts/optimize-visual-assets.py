#!/usr/bin/env python3
"""Convert large visual PNGs to WebP for WeChat main-package size limits."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
VISUAL_DIR = ROOT / "src" / "static" / "visual"
MAX_WIDTH = 480
QUALITY = 82


def optimize_file(path: Path) -> tuple[int, int]:
    before = path.stat().st_size
    im = Image.open(path)
    rgb = im.convert("RGB")
    w, h = rgb.size
    if w > MAX_WIDTH:
        rgb = rgb.resize((MAX_WIDTH, int(h * MAX_WIDTH / w)), Image.LANCZOS)
    out = path.with_suffix(".webp")
    rgb.save(out, format="WEBP", quality=QUALITY, method=6)
    after = out.stat().st_size
    if path.suffix.lower() == ".png":
        path.unlink()
    return before, after


def main() -> None:
    if not VISUAL_DIR.is_dir():
        raise SystemExit(f"missing {VISUAL_DIR}")
    total_before = 0
    total_after = 0
    for path in sorted(VISUAL_DIR.glob("*.png")):
        if path.name.startswith("home-poster-") or path.name == "mine-leaf-bg.png":
            continue
        before, after = optimize_file(path)
        total_before += before
        total_after += after
        print(f"{path.name:40} {before/1024:6.1f} KB -> {after/1024:6.1f} KB webp")
    print(f"visual total: {total_before/1024:.1f} KB -> {total_after/1024:.1f} KB")


if __name__ == "__main__":
    main()
