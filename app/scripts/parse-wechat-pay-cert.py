# -*- coding: utf-8 -*-
"""从微信支付证书压缩包提取序列号并生成 wechat-pay.local.json 模板。"""
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_secrets" / "wechat-pay.local.json"


def openssl_serial(cert_pem: Path) -> str:
    data = cert_pem.read_bytes()
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend

        cert = x509.load_pem_x509_certificate(data, default_backend())
        return format(cert.serial_number, "X")
    except ImportError:
        pass
    r = subprocess.run(
        ["openssl", "x509", "-in", str(cert_pem), "-noout", "-serial"],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return ""
    m = re.search(r"serial=([0-9A-Fa-f]+)", r.stdout.strip())
    if not m:
        return ""
    return m.group(1).upper()


def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/parse-wechat-pay-cert.py <证书zip路径> [商户号] [APIv3密钥]")
        return 1
    zpath = Path(sys.argv[1])
    if not zpath.is_file():
        print("文件不存在:", zpath)
        return 1
    tmp = ROOT / "_secrets" / "_cert_unpack"
    if tmp.exists():
        for p in tmp.rglob("*"):
            if p.is_file():
                p.unlink()
    tmp.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath) as zf:
        zf.extractall(tmp)
    key = next(tmp.rglob("apiclient_key.pem"), None)
    cert = next(tmp.rglob("apiclient_cert.pem"), None)
    if not key:
        print("压缩包内未找到 apiclient_key.pem")
        return 2
    serial = openssl_serial(cert) if cert else ""
    payload = {
        "WX_MCH_ID": sys.argv[2] if len(sys.argv) > 2 else "",
        "WX_API_V3_KEY": sys.argv[3] if len(sys.argv) > 3 else "",
        "WX_MCH_SERIAL_NO": serial,
        "apiclient_key_pem_path": str(key.resolve()),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("已写入", OUT)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not serial:
        print("未解析到证书序列号，请在商户平台 API 安全页手动复制 WX_MCH_SERIAL_NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
