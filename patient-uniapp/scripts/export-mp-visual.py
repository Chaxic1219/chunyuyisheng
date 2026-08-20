#!/usr/bin/env python3
"""Copy large MP illustrations to app/public/uploads/mp-visual and drop them from src/static."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_STATIC = ROOT / "patient-uniapp" / "src" / "static"
DEST = ROOT / "app" / "public" / "uploads" / "mp-visual"
IMAGE_EXT = {".png", ".webp", ".jpg", ".jpeg", ".gif"}


def copy_tree(src: Path, dest_root: Path, prefix: str = "") -> int:
    n = 0
    if not src.is_dir():
        return 0
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXT:
            continue
        rel = path.relative_to(src).as_posix()
        if "/zip/" in f"/{rel}/":
            continue
        out = dest_root / prefix / rel if prefix else dest_root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, out)
        n += 1
    return n


def rm_tree(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    n = 0
    n += copy_tree(SRC_STATIC / "visual", DEST)
    n += copy_tree(SRC_STATIC / "service-ui", DEST, "service-ui")
    n += copy_tree(SRC_STATIC / "consult-ui", DEST, "consult-ui")
    rm_tree(SRC_STATIC / "visual")
    rm_tree(SRC_STATIC / "service-ui")
    rm_tree(SRC_STATIC / "consult-ui")
    print(f"exported {n} images -> {DEST}")
    print("removed src/static visual, service-ui, consult-ui")


if __name__ == "__main__":
    main()
