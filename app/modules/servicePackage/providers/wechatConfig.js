"use strict";

const fs = require("fs");

function readEnv(name) {
  const v = process.env[name];
  if (v == null) return "";
  return String(v).trim();
}

function getWechatPayConfig() {
  const appId = readEnv("WX_MP_APPID") || readEnv("WECHAT_MP_APP_ID");
  const mchId = readEnv("WX_MCH_ID");
  const apiV3Key = readEnv("WX_API_V3_KEY");
  const mchSerialNo = readEnv("WX_MCH_SERIAL_NO");
  const privateKeyPath = readEnv("WX_MCH_PRIVATE_KEY_PATH");
  const notifyUrl = readEnv("WX_PAY_NOTIFY_URL");
  const platformCertPath = readEnv("WX_PLATFORM_CERT_PATH");
  const platformPubKeyPath = readEnv("WX_PLATFORM_PUB_KEY_PATH");

  if (!appId || !mchId || !apiV3Key || !mchSerialNo || !privateKeyPath || !notifyUrl) {
    return null;
  }

  let privateKeyPem = "";
  try {
    if (fs.existsSync(privateKeyPath)) {
      privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
    }
  } catch (e) {
    return null;
  }
  if (!privateKeyPem) {
    return null;
  }

  const config = {
    appId,
    mchId,
    apiV3Key,
    mchSerialNo,
    privateKeyPath,
    privateKeyPem,
    notifyUrl,
  };

  if (platformCertPath) {
    config.platformCertPath = platformCertPath;
    try {
      if (fs.existsSync(platformCertPath)) {
        config.platformCertPem = fs.readFileSync(platformCertPath, "utf8");
      }
    } catch (e) {
      /* optional cert — omit pem if unreadable */
    }
  }
  if (platformPubKeyPath) {
    config.platformPubKeyPath = platformPubKeyPath;
    try {
      if (fs.existsSync(platformPubKeyPath)) {
        config.platformPubKeyPem = fs.readFileSync(platformPubKeyPath, "utf8");
      }
    } catch (e) {
      /* optional pub key */
    }
  }

  return config;
}

function isWechatPayConfigured() {
  return !!getWechatPayConfig();
}

module.exports = { getWechatPayConfig, isWechatPayConfigured };
