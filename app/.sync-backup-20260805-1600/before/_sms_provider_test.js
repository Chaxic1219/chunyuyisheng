"use strict";
const assert = require("assert");
const sms = require("./sms_provider.js");

assert.strictEqual(sms.aliyunPercentEncode("a b"), "a%20b");
assert.strictEqual(sms.aliyunPercentEncode("a~b"), "a~b");
assert.ok(sms.aliyunSign({ Action: "SendSms", PhoneNumbers: "13800138000" }, "testsecret"));

const prev = { ...process.env };
process.env.SMS_PROVIDER = "off";
delete process.env.ALIYUN_ACCESS_KEY_ID;
assert.strictEqual(sms.resolveProviderName(), "off");
assert.strictEqual(sms.isConfigured(), false);

process.env.SMS_PROVIDER = "aliyun";
process.env.ALIYUN_ACCESS_KEY_ID = "id";
process.env.ALIYUN_ACCESS_KEY_SECRET = "secret";
process.env.ALIYUN_SMS_SIGN_NAME = "签名";
process.env.ALIYUN_SMS_TEMPLATE_CODE = "SMS_1";
assert.strictEqual(sms.resolveProviderName(), "aliyun");
assert.strictEqual(sms.isConfigured(), true);

process.env.SMS_PROVIDER = "log";
sms.sendVerificationCode("13800138000", "123456").then((r) => {
  assert.strictEqual(r.provider, "log");
  Object.assign(process.env, prev);
  console.log("ok - sms_provider tests passed");
}).catch((e) => {
  Object.assign(process.env, prev);
  console.error(e);
  process.exit(1);
});
