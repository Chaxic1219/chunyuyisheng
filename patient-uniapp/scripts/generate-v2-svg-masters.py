"""Generate monoline SVG masters for icon v2 (style B). Does NOT export PNG."""
from __future__ import annotations

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "design" / "icons" / "v2-svg"
COLORS = {
    "primary": "#176B52",
    "inverse": "#FFFFFF",
    "muted": "#89948E",
    "danger": "#A33C33",
}

# semantic -> required tones besides primary (matches iconRegistry TONE_FILES)
TONES = {
    "action-close": ["danger"],
    "action-confirm": ["inverse"],
    "action-create": ["inverse"],
    "action-refresh": ["inverse"],
    "action-send": ["inverse"],
    "action-update": ["inverse"],
    "nav-chevron-right": ["muted"],
    "nav-consult": ["inverse"],
    "nav-home": ["muted"],
    "nav-profile": ["muted"],
    "upload-record": ["inverse"],
    "consult-doctor": ["inverse"],
    "profile-edit": ["inverse"],
    "record-bind": ["inverse"],
    "service-activate": ["inverse"],
    "wechat": ["inverse"],
    "phone-bind": ["inverse"],
    "data-delete": ["danger"],
    "account-logout": ["danger"],
    "wechat-unbind": ["danger"],
    "status-loading": ["inverse"],
    "status-error": ["danger"],
    "status-warning": ["inverse"],
    "status-empty": ["muted"],
}

# Minimal geometric paths (24x24). stroke-only.
PATHS: dict[str, str] = {
    "action-add": '<path d="M12 5v14M5 12h14"/>',
    "action-clear": '<path d="M7 7l10 10M17 7L7 17"/><circle cx="12" cy="12" r="8"/>',
    "action-close": '<path d="M7 7l10 10M17 7L7 17"/>',
    "action-confirm": '<path d="M5.5 12.5l4 4 9-9"/>',
    "action-create": '<path d="M12 5v14M5 12h14"/><rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    "action-more": '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
    "action-refresh": '<path d="M18.5 8.5A7 7 0 1 0 19 12"/><path d="M18.5 5.5v4h-4"/>',
    "action-send": '<path d="M5 12h12M13 7l5 5-5 5"/>',
    "action-unknown": '<circle cx="12" cy="12" r="8"/><path d="M12 8v.01M12 11v5"/>',
    "action-update": '<path d="M7 7h7v7"/><path d="M17 17H10V10"/><path d="M14 7l3 3-3 3"/>',
    "nav-back": '<path d="M14.5 6.5L8 12l6.5 5.5"/><path d="M8.5 12H19"/>',
    "nav-chevron-right": '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
    "nav-consult": '<path d="M6 7.5h12v8.5H10l-3.5 3v-3H6z"/>',
    "nav-home": '<path d="M4.5 11.5L12 5l7.5 6.5"/><path d="M7 10.5V19h10v-8.5"/>',
    "nav-profile": '<circle cx="12" cy="9" r="3.2"/><path d="M5.5 19c1.5-3.2 3.8-4.8 6.5-4.8S16.5 15.8 18.5 19"/>',
    "upload-record": '<path d="M12 16V7M8.5 10L12 6.5 15.5 10"/><path d="M6 18h12"/>',
    "medication": '<rect x="8" y="4.5" width="8" height="15" rx="2"/><path d="M8 10h8M12 10v6"/>',
    "metric-record": '<path d="M5 17V7M10 17V10M15 17V8M19.5 17V5.5"/>',
    "follow-up": '<rect x="5" y="6" width="14" height="13" rx="2"/><path d="M8 4.5v3M16 4.5v3M5 10.5h14"/>',
    "service-package": '<path d="M12 4.5l7 3.5v8l-7 3.5-7-3.5v-8z"/><path d="M12 4.5v15M5 8l7 3.5L19 8"/>',
    "consult-doctor": '<path d="M6 8h12v8H9l-3 2.5V16H6z"/><path d="M9.5 12h5"/>',
    "profile-edit": '<circle cx="10" cy="9" r="3"/><path d="M4.5 19c1.2-2.8 3-4.2 5.5-4.2"/><path d="M13.5 14.5l5 5M16.2 13.2l2.5 2.5-5.5 2-1-1.2z"/>',
    "reminder": '<circle cx="12" cy="13" r="6.5"/><path d="M12 9.5v4l2.5 1.5M10 4.5h4"/>',
    "doctor-group": '<circle cx="9" cy="9" r="2.5"/><circle cx="16" cy="9.5" r="2.2"/><path d="M4.5 18c1-2.5 2.6-3.8 4.5-3.8S12.5 15.5 13.5 18M13 18c.7-1.8 1.8-2.7 3.2-2.7 1.3 0 2.4.8 3.3 2.7"/>',
    "invite-patient": '<circle cx="10" cy="9" r="3"/><path d="M4.5 19c1.2-2.8 3-4.2 5.5-4.2S14.3 16.2 15.5 19"/><path d="M17 8v6M14 11h6"/>',
    "group-service": '<path d="M7 8h10v9H7z"/><path d="M9.5 8V6.5h5V8M12 11v3.5M10.2 13h3.6"/>',
    "quick-question": '<circle cx="12" cy="12" r="8"/><path d="M9.8 9.5a2.4 2.4 0 1 1 3.4 2.2c-.8.5-1.2 1-1.2 2"/><circle cx="12" cy="16.5" r=".8"/>',
    "record-bind": '<rect x="5" y="5" width="9" height="12" rx="1.5"/><path d="M10 10h8.5v9H10"/><path d="M12.5 14.5h3.5"/>',
    "plan-create": '<rect x="5.5" y="4.5" width="13" height="15" rx="2"/><path d="M9 9h6M9 12.5h6M9 16h3.5M15.5 15v3.5M13.8 16.8H17"/>',
    "record-edit": '<path d="M6 18.5h12"/><path d="M8 15.5l8.5-8.5 2.5 2.5L10.5 18H8z"/>',
    "health-record": '<rect x="6" y="4.5" width="12" height="15" rx="1.5"/><path d="M9 9h6M9 12.5h6M9 16h4"/>',
    "health-log": '<path d="M12 18.5c-4 0-6.5-2.8-6.5-6.2 0-3.6 2.6-5.6 5-7.3 1-.7 1.5-1.2 1.5-1.2s.5.5 1.5 1.2c2.4 1.7 5 3.7 5 7.3 0 3.4-2.5 6.2-6.5 6.2z"/>',
    "task-next": '<path d="M5 12h11M12.5 7.5L17 12l-4.5 4.5"/><path d="M5 7.5v9"/>',
    "health-plan": '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M8 9.5h8M8 12.5h8M8 15.5h5"/>',
    "plan-consult": '<rect x="5" y="5.5" width="9" height="11" rx="1.5"/><path d="M16 10.5h3.5v7.5H14l-1.5 1.5v-1.5h-1"/>',
    "service-detail": '<circle cx="12" cy="12" r="8"/><path d="M12 10.5V17M12 7.5v.01"/>',
    "service-activate": '<path d="M8 12l3 3 6-7"/><circle cx="12" cy="12" r="8"/>',
    "rehab-guide": '<path d="M7 18V9l5-3.5L17 9v9"/><path d="M10 18v-5h4v5"/>',
    "postop-assessment": '<path d="M8 6.5h8v3H8z"/><path d="M9.5 9.5v9.5h5V9.5M10.5 14h3"/>',
    "goods-order": '<path d="M6.5 8.5h11l-1 9.5H7.5z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    "service-rights": '<path d="M12 4.5l6.5 2.5v5.2c0 3.8-2.7 6.5-6.5 7.8-3.8-1.3-6.5-4-6.5-7.8V7z"/><path d="M9.5 12.2l2 2 3.5-4"/>',
    "member-add": '<circle cx="10" cy="9" r="3"/><path d="M4.5 19c1.2-2.8 3-4.2 5.5-4.2"/><path d="M16.5 10v6M13.5 13h6"/>',
    "member-record": '<circle cx="9" cy="9" r="2.6"/><circle cx="16" cy="9.5" r="2.2"/><path d="M4.5 18.5c1-2.4 2.5-3.6 4.5-3.6s3.5 1.2 4.5 3.6M13.2 18.5c.6-1.7 1.6-2.5 2.9-2.5 1.2 0 2.2.7 3.1 2.5"/>',
    "permission-scope": '<rect x="6" y="10.5" width="12" height="8" rx="1.5"/><path d="M9 10.5V8.5a3 3 0 0 1 6 0v2"/>',
    "wechat": '<path d="M8.5 9.5c0-2.8 2.6-4.8 5.8-4.8S20 6.7 20 9.5s-2.5 4.6-5.2 4.6c-.4 0-1.1 0-1.5.2L11.5 16v-2.2C9.5 13.3 8.5 11.5 8.5 9.5z"/><path d="M4 14c0-2.2 2-3.8 4.5-3.8"/><circle cx="12.8" cy="9.2" r=".7"/><circle cx="16.2" cy="9.2" r=".7"/>',
    "phone-bind": '<rect x="8" y="3.5" width="8" height="17" rx="2"/><path d="M10.5 18.5h3"/>',
    "verification-code": '<rect x="4.5" y="8" width="15" height="9" rx="1.5"/><path d="M8 11.5h2M12 11.5h2M16 11.5h.01M8 14.5h8"/>',
    "order": '<rect x="5.5" y="5" width="13" height="14" rx="1.5"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
    "service-center": '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>',
    "privacy": '<rect x="7" y="10.5" width="10" height="8" rx="1.5"/><path d="M9.5 10.5V8.2a2.5 2.5 0 0 1 5 0v2.3"/><circle cx="12" cy="14.5" r="1"/>',
    "account-security": '<path d="M12 4.5l6.5 2.5v5c0 3.8-2.7 6.5-6.5 7.8-3.8-1.3-6.5-4-6.5-7.8v-5z"/>',
    "data-export": '<path d="M12 5v10M8.5 11.5L12 15l3.5-3.5"/><path d="M6 18.5h12"/>',
    "data-delete": '<path d="M6 8h12M9.5 8V6.5h5V8M8.5 8l.8 11h5.4l.8-11"/><path d="M10.5 11.5v5M13.5 11.5v5"/>',
    "account-logout": '<path d="M10 5.5H7.5A2 2 0 0 0 5.5 7.5v9a2 2 0 0 0 2 2H10"/><path d="M12 12h7M16 8.5L19.5 12 16 15.5"/>',
    "wechat-unbind": '<path d="M8.5 9.5c0-2.5 2.3-4.3 5.2-4.3"/><path d="M6 7l12 12"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M12 4.5v2.2M12 17.3V19.5M4.5 12h2.2M17.3 12H19.5M6.6 6.6l1.6 1.6M15.8 15.8l1.6 1.6M17.4 6.6l-1.6 1.6M8.2 15.8l-1.6 1.6"/>',
    "elder-mode": '<circle cx="12" cy="8" r="2.8"/><path d="M8 20c0-3.2 1.8-5 4-5s4 1.8 4 5"/><path d="M7 12.5h10"/>',
    "camera": '<rect x="4.5" y="8" width="15" height="10.5" rx="2"/><circle cx="12" cy="13.2" r="3"/><path d="M9 8l1.2-2.2h3.6L15 8"/>',
    "search": '<circle cx="11" cy="11" r="5.5"/><path d="M15.5 15.5L19 19"/>',
    "attachment": '<path d="M15.5 11.5l-5.2 5.2a3 3 0 0 1-4.2-4.2l6.5-6.5a2.2 2.2 0 0 1 3.1 3.1L9.5 15.3"/>',
    "help-center": '<circle cx="12" cy="12" r="8"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.7.4-1.1.9-1.1 1.8"/><circle cx="12" cy="16.4" r=".8"/>',
    "doctor-profile": '<path d="M8 19V9.5l4-3 4 3V19"/><path d="M10.5 19v-5h3v5"/><circle cx="12" cy="11" r="1.4"/>',
    "health-assistant": '<circle cx="12" cy="9" r="3"/><path d="M6 19c1.3-3 3.3-4.5 6-4.5s4.7 1.5 6 4.5"/><path d="M17.5 6.5v3M16 8h3"/>',
    "inpatient-service": '<path d="M5.5 18.5h13"/><path d="M7 18.5V9.5h10v9"/><path d="M10 12.5h4M12 10.5v4"/>',
    "nutrition": '<path d="M12 4.5c2.5 0 4.5 3.5 4.5 7.5S14 19.5 12 19.5 7.5 15.5 7.5 12 9.5 4.5 12 4.5z"/><path d="M12 4.5V19.5"/>',
    "reply-record": '<path d="M6 7.5h12v8H10l-3.5 3V15.5H6z"/><path d="M9 11h6"/>',
    "status-loading": '<path d="M12 4.5a7.5 7.5 0 1 1-7.2 5.4"/>',
    "status-success": '<circle cx="12" cy="12" r="8"/><path d="M7.5 12.2l3 3 6-6.5"/>',
    "status-error": '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "status-warning": '<path d="M12 4.5L20 18.5H4z"/><path d="M12 10v4M12 16.5v.01"/>',
    "status-empty": '<rect x="5.5" y="7" width="13" height="11" rx="2"/><path d="M9 11.5h6M9 14.5h4"/>',
}


def svg_doc(inner: str, color: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">\n'
        f'  <g fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">\n'
        f"    {inner}\n"
        "  </g>\n"
        "</svg>\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # wipe previous generated svgs in this folder only
    for old in OUT.glob("*.svg"):
        old.unlink()

    written = []
    for name, inner in PATHS.items():
        primary = OUT / f"{name}.svg"
        primary.write_text(svg_doc(inner, COLORS["primary"]), encoding="utf-8")
        written.append(primary.name)
        for tone in TONES.get(name, []):
            p = OUT / f"{name}-{tone}.svg"
            p.write_text(svg_doc(inner, COLORS[tone]), encoding="utf-8")
            written.append(p.name)

    missing = sorted(set(PATHS) - set(PATHS.keys()))
    print(f"svg_dir={OUT}")
    print(f"files={len(written)}")
    print(f"semantics={len(PATHS)}")
    # coverage check vs registry names file count expectation
    expected_extra = sum(len(v) for v in TONES.values())
    print(f"expected_total={len(PATHS) + expected_extra}")
    if missing:
        print("missing", missing)


if __name__ == "__main__":
    main()
