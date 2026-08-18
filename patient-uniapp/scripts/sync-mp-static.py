# -*- coding: utf-8 -*-
"""Ensure src/static is fully mirrored into mp-weixin dist after uni build.

uni-app may omit tabBar / dynamically-resolved icon assets from the package.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "static"
DIST = ROOT / "dist" / "build" / "mp-weixin" / "static"


def main() -> int:
    if not SRC.is_dir():
        print(f"missing source static: {SRC}", file=sys.stderr)
        return 1
    if not DIST.parent.is_dir():
        print(f"missing dist root: {DIST.parent}", file=sys.stderr)
        return 1

    DIST.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src_file in SRC.rglob("*"):
        if not src_file.is_file():
            continue
        # skip accidental backups
        if ".bak" in src_file.name or src_file.suffix.lower() == ".bak":
            continue
        rel = src_file.relative_to(SRC)
        if rel.as_posix().startswith("visual/home-poster-"):
            continue
        dest = DIST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dest)
        copied += 1

    required_tab = [
        "tab/home.png",
        "tab/home-active.png",
        "tab/chat.png",
        "tab/chat-active.png",
        "tab/chat-fab.png",
        "tab/center-pedestal.png",
        "tab/user.png",
        "tab/user-active.png",
        "icons/v2/camera.png",
        "icons/v2/health-record.png",
        "icons/v2/profile-edit.png",
        "visual/mine-leaf-bg.webp",
    ]
    missing = [p for p in required_tab if not (DIST / p).is_file()]
    print(f"synced {copied} static files -> {DIST}")
    if missing:
        print("missing tab icons:", ", ".join(missing), file=sys.stderr)
        return 1
    print("tabBar icons ok:", ", ".join(required_tab))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
