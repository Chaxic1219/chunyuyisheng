"use strict";

function verifySmsCode({ smsCodes, smsThrottle, phone, code, now }) {
  const key = String(phone || "");
  const rec = smsCodes.get(key);
  if (!rec) return "请先获取短信验证码";

  const currentTime = typeof now === "function"
    ? Number(now())
    : Number(now == null ? Date.now() : now);
  if (rec.expiresAt < currentTime) {
    smsCodes.delete(key);
    return "验证码已过期，请重新获取";
  }

  if (rec.code !== String(code || "").trim()) {
    rec.attempts = (rec.attempts || 0) + 1;
    if (rec.attempts >= 5) {
      smsCodes.delete(key);
      return "验证码错误次数过多，请重新获取";
    }
    return "短信验证码错误";
  }

  smsCodes.delete(key);
  smsThrottle.delete(key);
  return "";
}

module.exports = { verifySmsCode };
