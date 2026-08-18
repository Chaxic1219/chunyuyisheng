"use strict";

const net = require("net");
const tls = require("tls");

function env(name, fallback) {
  const value = process.env[name];
  return value == null || String(value).trim() === "" ? fallback : String(value).trim();
}

function getMailerConfig() {
  const user = env("SMTP_USER", "");
  const pass = env("SMTP_PASS", "");
  const to = env("PARTNERSHIP_EMAIL_TO", user);
  return {
    enabled: env("PARTNERSHIP_EMAIL_ENABLED", "0") === "1",
    host: env("SMTP_HOST", "smtp.163.com"),
    port: Number(env("SMTP_PORT", "465")) || 465,
    secure: env("SMTP_SECURE", "1") !== "0",
    user,
    pass,
    from: env("PARTNERSHIP_EMAIL_FROM", user),
    to
  };
}

function encodeHeader(value) {
  return "=?UTF-8?B?" + Buffer.from(String(value), "utf8").toString("base64") + "?=";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dotStuff(text) {
  return String(text).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function buildPartnershipEmail(application) {
  const app = application || {};
  const rows = [
    ["申请编号", app.id],
    ["姓名", app.name],
    ["手机号", app.phone],
    ["医院", app.hospital],
    ["科室", app.department],
    ["职称", app.title],
    ["来源", app.source],
    ["提交时间", app.createdAt || app.created_at]
  ];
  const plain = rows.map(([label, value]) => `${label}: ${value || ""}`).join("\n");
  const htmlRows = rows.map(([label, value]) =>
    `<tr><th style="text-align:left;padding:6px 12px;background:#f6f8fa;">${escapeHtml(label)}</th><td style="padding:6px 12px;">${escapeHtml(value || "")}</td></tr>`
  ).join("");
  return {
    subject: `新的合作申请：${app.name || "未填写姓名"} ${app.phone || ""}`.trim(),
    text: `官网收到新的合作申请。\n\n${plain}`,
    html: `<p>官网收到新的合作申请。</p><table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${htmlRows}</table>`
  };
}

function createSmtpClient(config) {
  const cfg = config || getMailerConfig();
  return {
    async send(message) {
      await sendSmtpMail(cfg, message);
    }
  };
}

function createSmtpConnection(config) {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port });
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const cleanup = () => {
      socket.off("error", onError);
      socket.off(config.secure ? "secureConnect" : "connect", onConnect);
    };
    socket.setTimeout(15000, () => socket.destroy(new Error("SMTP connection timed out")));
    socket.once("error", onError);
    socket.once(config.secure ? "secureConnect" : "connect", onConnect);
  });
}

async function sendSmtpMail(config, message) {
  if (!config.user || !config.pass || !config.from || !config.to) {
    throw new Error("SMTP config is incomplete");
  }
  const socket = await createSmtpConnection(config);
  let buffer = "";
  const waitLine = () => new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      const last = lines[lines.length - 2];
      if (!last || !/^\d{3} /.test(last)) return;
      cleanup();
      resolve(buffer);
      buffer = "";
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
  let authStep = "";
  const safeCommandLabel = (line) => {
    const head = String(line).split(" ")[0];
    if (authStep) return authStep;
    return head;
  };
  const command = async (line, expected, label) => {
    socket.write(line + "\r\n");
    const response = await waitLine();
    if (!String(response).startsWith(String(expected))) {
      throw new Error(`SMTP command failed: ${label || safeCommandLabel(line)} -> ${response.trim()}`);
    }
  };

  try {
    let response = await waitLine();
    if (!response.startsWith("220")) throw new Error("SMTP greeting failed: " + response.trim());
    await command("EHLO chunyutianxia.com", 250);
    await command("AUTH LOGIN", 334);
    authStep = "AUTH username";
    await command(Buffer.from(config.user).toString("base64"), 334);
    authStep = "AUTH password";
    await command(Buffer.from(config.pass).toString("base64"), 235);
    authStep = "";
    await command(`MAIL FROM:<${config.from}>`, 250);
    for (const recipient of String(config.to).split(",").map((v) => v.trim()).filter(Boolean)) {
      await command(`RCPT TO:<${recipient}>`, 250);
    }
    await command("DATA", 354);
    const date = new Date().toUTCString();
    const subject = encodeHeader(message.subject || "新的合作申请");
    const body = [
      `From: ${config.from}`,
      `To: ${config.to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      "MIME-Version: 1.0",
      "Content-Type: multipart/alternative; boundary=\"chunyu-partnership\"",
      "",
      "--chunyu-partnership",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text || "",
      "",
      "--chunyu-partnership",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      message.html || escapeHtml(message.text || ""),
      "",
      "--chunyu-partnership--"
    ].join("\r\n");
    socket.write(dotStuff(body) + "\r\n.\r\n");
    response = await waitLine();
    if (!response.startsWith("250")) throw new Error("SMTP DATA failed: " + response.trim());
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

async function notifyPartnershipApplication(application, options) {
  const config = (options && options.config) || getMailerConfig();
  if (!config.enabled) return { ok: false, skipped: "disabled" };
  if (!config.user || !config.pass || !config.to) return { ok: false, skipped: "missing_config" };
  const client = (options && options.client) || createSmtpClient(config);
  await client.send(buildPartnershipEmail(application));
  return { ok: true };
}

module.exports = {
  buildPartnershipEmail,
  createSmtpClient,
  getMailerConfig,
  notifyPartnershipApplication,
  sendSmtpMail
};
