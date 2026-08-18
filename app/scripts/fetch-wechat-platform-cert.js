"use strict";

const fs = require("fs");
const path = require("path");
const { fetchPlatformCertificatePem } = require("../modules/servicePackage/providers/wechat.js");
const { getWechatPayConfig } = require("../modules/servicePackage/providers/wechatConfig.js");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

async function main() {
  loadEnvFile(process.env.CHUNYU_ENV_FILE || "/etc/chunyu-doctor.env");
  const cfg = getWechatPayConfig();
  if (!cfg) {
    console.error("微信支付未配置完整，无法拉取平台证书");
    process.exit(1);
  }
  const outPath =
    process.env.WX_PLATFORM_CERT_PATH ||
    "/var/lib/chunyu-doctor/private-uploads/wechat-pay/platform.pem";
  const { pem, serialNo } = await fetchPlatformCertificatePem(cfg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outPath, pem, { mode: 0o600 });
  console.log(
    JSON.stringify({ ok: true, serialNo, path: outPath, bytes: Buffer.byteLength(pem) }, null, 2)
  );
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
