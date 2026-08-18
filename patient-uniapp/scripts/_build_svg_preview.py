"""Build a local HTML preview of all v2 SVG masters for owner confirmation."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "design" / "icons" / "v2-svg"
OUT = ROOT / "design" / "icons" / "v2-svg-preview.html"

tones = ("-inverse", "-muted", "-danger")
files = sorted(SVG.glob("*.svg"))
cards = []
for f in files:
    stem = f.stem
    bg = "#0f1a16" if stem.endswith("-inverse") else "#F4F7F3"
    raw = f.read_text(encoding="utf-8")
    # inline svg, scale up
    raw = raw.replace('width="24"', 'width="48"').replace('height="24"', 'height="48"')
    cards.append(
        f'<div class="card" style="background:{bg}"><div class="icon">{raw}</div><div class="name">{stem}</div></div>'
    )

html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>春雨小程序图标 v2 SVG 母版预览（待确认）</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; background: #fff; color: #17201c; }}
    h1 {{ font-size: 20px; }}
    .meta {{ color: #6a756f; margin-bottom: 20px; line-height: 1.5; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }}
    .card {{ border: 1px solid #dce3dd; border-radius: 12px; padding: 16px 10px; text-align: center; }}
    .icon {{ display: flex; justify-content: center; align-items: center; min-height: 56px; }}
    .name {{ margin-top: 8px; font-size: 12px; word-break: break-all; color: #44524b; }}
    .warn {{ background: #fff7e8; border: 1px solid #f0d9a8; padding: 12px 14px; border-radius: 10px; margin-bottom: 16px; }}
  </style>
</head>
<body>
  <h1>图标动效升级 · SVG 母版预览</h1>
  <div class="warn">风格 B：24×24 / 1.8px 圆角描边 / 无填充渐变投影。确认前不得导出 PNG、不得改页面。</div>
  <div class="meta">共 {len(files)} 个文件（71 语义主色 + tone 变体）。色值 primary #176B52 / inverse #FFFFFF / muted #89948E / danger #A33C33。</div>
  <div class="grid">
    {"".join(cards)}
  </div>
</body>
</html>
"""
OUT.write_text(html, encoding="utf-8")
print(OUT)
