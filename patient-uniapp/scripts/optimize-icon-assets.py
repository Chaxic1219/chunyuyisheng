from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src" / "static" / "icons" / "v2"
MAX_SIDE = 96
MAX_TOTAL = 400 * 1024


def main() -> int:
    for path in sorted(ICON_DIR.glob("*.png")):
        with Image.open(path) as image:
            rgba = image.convert("RGBA")
            rgba.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
            rgba.save(path, format="PNG", optimize=True)
    total = sum(path.stat().st_size for path in ICON_DIR.glob("*.png"))
    print(f"icon total: {total / 1024:.1f} KB")
    if total > MAX_TOTAL:
        raise SystemExit(f"icon budget exceeded: {total / 1024:.1f} KB > 400 KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
