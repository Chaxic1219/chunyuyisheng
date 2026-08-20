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
MP_VISUAL_SRC = (ROOT.parent / "app" / "public" / "uploads" / "mp-visual").resolve()


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
        if rel.as_posix().startswith("visual/") or rel.as_posix().startswith("service-ui/") or rel.as_posix().startswith("consult-ui/"):
            continue
        if rel.as_posix().startswith("visual/home-poster-"):
            continue
        dest = DIST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dest)
        copied += 1

    # ponytail: 线上 mp-visual 可能出现缺文件 404；在 mp-weixin 端从本地 app/public/uploads/mp-visual
    # 复制进小程序自身 static 包，避免“图标全空”的大面积故障。
    mp_copied = 0
    if MP_VISUAL_SRC.is_dir():
        for src_file in MP_VISUAL_SRC.rglob("*"):
            if not src_file.is_file():
                continue
            rel = src_file.relative_to(MP_VISUAL_SRC).as_posix()
            dest = DIST / "mp-visual" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dest)
            mp_copied += 1
        print(f"synced mp-visual {mp_copied} files -> {DIST / 'mp-visual'}")
    else:
        print(f"mp-visual src missing: {MP_VISUAL_SRC}", file=sys.stderr)

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
