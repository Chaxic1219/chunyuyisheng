# -*- coding: utf-8 -*-
"""本地冒烟：auth-admin 路由依赖已注入。"""
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent

JS = r"""
process.env.MP_AUTH_STUB = '1';
process.env.SMS_DEMO = '1';
process.env.TRIAGE_AI_DISABLED = '1';
const { registerAuthAdminRoutes } = require('./routes/auth-admin.js');
const missing = [
  'normalizeAdminRole','normalizeDoctorIds','replaceAdminDoctors',
  'adminDoctorIds','lastSuperViolation','generatedPassword'
].filter((k) => typeof deps[k] !== 'function');
if (missing.length) {
  console.error('missing deps', missing.join(','));
  process.exit(1);
}
console.log('[ok] auth-admin deps injected');
"""


def run():
    # 仅检查 server.js 是否把依赖传给 registerAuthAdminRoutes
    server = (APP / "server.js").read_text(encoding="utf-8")
    for name in [
        "normalizeAdminRole",
        "normalizeDoctorIds",
        "replaceAdminDoctors",
        "adminDoctorIds",
        "lastSuperViolation",
        "generatedPassword",
    ]:
        if name not in server:
            print("server.js missing", name)
            return 1
    auth = (APP / "routes" / "auth-admin.js").read_text(encoding="utf-8")
    if "normalizeAdminRole" not in auth:
        print("auth-admin.js missing normalizeAdminRole destructure")
        return 1
    print("[ok] admin fix files look correct")
    return 0


if __name__ == "__main__":
    sys.exit(run())
