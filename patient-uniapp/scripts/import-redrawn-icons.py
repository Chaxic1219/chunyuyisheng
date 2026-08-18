# -*- coding: utf-8 -*-
"""Import redrawn icons into patient-uniapp/src/static/icons with trim + normalize."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "static" / "icons"
DESKTOP = Path(r"c:\Users\11\Desktop")
QUICK_SRC = DESKTOP / "小程序五个功能图标_重绘" / "透明高清512px"
ASSET_SRC = DESKTOP / "小程序资产与设置图标_重绘" / "透明高清512px"
TARGET = 192
PAD_RATIO = 0.08

QUICK_MAP = {
    "01-upload-record.png": "quick-upload.png",
    "02-ask-medication.png": "quick-med.png",
    "03-health-metrics.png": "quick-metric.png",
    "04-follow-up.png": "quick-followup.png",
    "05-health-services.png": "quick-service.png",
}

ASSET_MAP = {
    "01-健康档案.png": "asset-records.png",
    "02-健康计划.png": "asset-plans.png",
    "03-健康记录.png": "asset-health-log.png",
    "04-家庭管理.png": "asset-family.png",
    "05-我的服务.png": "asset-services.png",
    "06-我的订单.png": "asset-orders.png",
    "07-优惠和权益.png": "asset-rights.png",
    "08-设置与授权.png": "asset-settings.png",
    "09-长辈模式.png": "asset-elder.png",
    "10-消息与提醒.png": "asset-reminders.png",
    "11-隐私与数据授权.png": "asset-privacy.png",
    "12-数据导出或删除.png": "asset-data.png",
    "13-账号安全.png": "asset-security.png",
    "14-右箭头.png": "chevron.png",
}


def trim_and_normalize(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    side = max(w, h)
    pad = max(2, int(side * PAD_RATIO))
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(im, ((canvas_side - w) // 2, (canvas_side - h) // 2), im)
    out = canvas.resize((TARGET, TARGET), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, format="PNG", optimize=True)


def import_map(src_dir: Path, mapping: dict[str, str]) -> list[str]:
    done: list[str] = []
    for src_name, dest_name in mapping.items():
        src = src_dir / src_name
        if not src.exists():
            print(f"MISSING {src}")
            continue
        dest = OUT / dest_name
        trim_and_normalize(src, dest)
        done.append(dest_name)
        print(f"OK {src_name} -> {dest_name} ({dest.stat().st_size} bytes)")
    return done


def main() -> int:
    if not QUICK_SRC.is_dir():
        raise SystemExit(f"missing {QUICK_SRC}")
    if not ASSET_SRC.is_dir():
        raise SystemExit(f"missing {ASSET_SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    done = []
    done += import_map(QUICK_SRC, QUICK_MAP)
    done += import_map(ASSET_SRC, ASSET_MAP)
    # muted chevron alias
    chevron = OUT / "chevron.png"
    muted = OUT / "chevron-muted.png"
    if chevron.exists():
        shutil.copy2(chevron, muted)
        print("OK chevron-muted.png alias")
    # also refresh common aliases used elsewhere
    aliases = {
        "asset-settings.png": "lock.png",
        "asset-elder.png": "az.png",
        "asset-records.png": "file.png",
        "asset-family.png": "team.png",
        "asset-services.png": "shield.png",
        "asset-plans.png": "form.png",
        "asset-health-log.png": "heart.png",
        "asset-reminders.png": "clock.png",
    }
    for src_name, alias in aliases.items():
        src = OUT / src_name
        if src.exists():
            shutil.copy2(src, OUT / alias)
            print(f"ALIAS {src_name} -> {alias}")
    print(f"imported {len(done)} icons into {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
