"use strict";

const fs = require("fs");
const { getWechatPayConfig, isWechatPayConfigured } = require("../modules/servicePackage/providers/wechatConfig.js");
const { getPaymentProvider } = require("../modules/servicePackage/providers/index.js");
const { fetchPlatformCertificatePem } = require("../modules/servicePackage/providers/wechat.js");

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
  const providerName = String(process.env.SERVICE_PAY_PROVIDER || "mock").trim().toLowerCase();
  const report = {
    provider: providerName,
    configured: isWechatPayConfigured(),
    appId: process.env.WX_MP_APPID || process.env.WECHAT_MP_APP_ID || "",
    mchId: process.env.WX_MCH_ID || "",
    notifyUrl: process.env.WX_PAY_NOTIFY_URL || "",
    privateKeyPath: process.env.WX_MCH_PRIVATE_KEY_PATH || "",
    platformCertPath: process.env.WX_PLATFORM_CERT_PATH || "",
    platformPubKeyPath: process.env.WX_PLATFORM_PUB_KEY_PATH || "",
    privateKeyReadable: false,
    platformCertReadable: false,
    platformPubKeyReadable: false,
    providerReady: false,
    platformCertFetch: null,
  };
  if (report.privateKeyPath) {
    try {
      report.privateKeyReadable = fs.existsSync(report.privateKeyPath);
    } catch (_) {}
  }
  if (report.platformCertPath) {
    try {
      report.platformCertReadable = fs.existsSync(report.platformCertPath);
    } catch (_) {}
  }
  if (report.platformPubKeyPath) {
    try {
      report.platformPubKeyReadable = fs.existsSync(report.platformPubKeyPath);
    } catch (_) {}
  }
  try {
    const p = getPaymentProvider();
    report.providerReady = p.name === "wechat" || p.name === "mock";
    report.activeProvider = p.name;
  } catch (e) {
    report.providerError = e.code || e.message;
  }
  if (providerName.startsWith("wechat") && isWechatPayConfigured()) {
    try {
      const { serialNo } = await fetchPlatformCertificatePem();
      report.platformCertFetch = { ok: true, serialNo };
    } catch (e) {
      report.platformCertFetch = { ok: false, error: e.code || e.message };
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (providerName.startsWith("wechat") && !isWechatPayConfigured()) process.exit(2);
  if (report.platformCertFetch && report.platformCertFetch.ok === false) process.exit(3);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
