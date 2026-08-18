"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mp-sms-production-http-"));

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: data ? {
        "Content-Type": "application/json",
        "Content-Length": data.length
      } : {}
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (error) { json = raw; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function poll() {
      request(port, "GET", "/api/ready").then(resolve).catch(() => {
        if (Date.now() >= deadline) reject(new Error("server_timeout"));
        else setTimeout(poll, 100);
      });
    }
    poll();
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

(async () => {
  const port = 19400 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DB_PATH: path.join(tempRoot, "sms-http.db"),
    PRIVATE_UPLOAD_DIR: path.join(tempRoot, "private"),
    WECHAT_MP_APP_ID: "test-app-id",
    WECHAT_MP_APP_SECRET: "test-app-secret",
    ADMIN_PASSWORD: "test-admin-password",
    COMMUNITY_WEBHOOK_TOKEN: "test-community-token",
    QIWE_CALLBACK_SECRET: "test-qiwe-secret",
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    MP_AUTH_STUB: "0",
    SMS_DEMO: "0",
    SMS_PROVIDER: "",
    ALIYUN_ACCESS_KEY_ID: "",
    ALIYUN_ACCESS_KEY_SECRET: "",
    ALIYUN_SMS_SIGN_NAME: "",
    ALIYUN_SMS_TEMPLATE_CODE: "",
    TENCENT_SMS_SECRET_ID: "",
    TENCENT_SMS_SECRET_KEY: "",
    TENCENT_SMS_SDK_APP_ID: "",
    TENCENT_SMS_SIGN_NAME: "",
    TENCENT_SMS_TEMPLATE_ID: "",
    SMS_WEBHOOK_URL: ""
  };
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const ready = await waitReady(port, 15_000);
    assert.equal(ready.status, 200, JSON.stringify(ready.json));

    const bootstrap = await request(port, "GET", "/api/bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.json.capabilities.smsAvailable, false);

    const send = await request(port, "POST", "/api/sms/send", {
      phone: "13800138000"
    });
    assert.equal(send.status, 503);
    assert.deepStrictEqual(send.json, { error: "sms_unavailable" });
    assert.equal(Object.prototype.hasOwnProperty.call(send.json, "code"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(send.json, "demo"), false);
    console.log("ok - production 未配置短信可启动且 HTTP 不泄露 demo/code");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 3_000);
    if (child.exitCode === null) child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
