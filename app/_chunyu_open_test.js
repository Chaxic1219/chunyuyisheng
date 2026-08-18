"use strict";
const assert = require("assert");
const open = require("./chunyu_open.js");

function test(name, fn) {
  fn();
  console.log("ok -", name);
}

test("sign 与官方示例一致", () => {
  const sign = open.sign("XKBP1Oqut0r2LiGV", "1467098815", "A800130");
  assert.equal(sign, "5afda19c5d65a7a7");
});

test("chunyuUserId 用 personId", () => {
  assert.equal(open.chunyuUserId(165, "13303936115"), "p165");
});

test("未配置时 cfg.configured=false", () => {
  const c = open.cfg({ CHUNYU_API_HOST: "", CHUNYU_PARTNER: "", CHUNYU_PARTNER_KEY: "" });
  assert.equal(c.configured, false);
});

test("graphLoginUrl 含 sign 且不含密钥", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "cy_yihuantong",
    CHUNYU_PARTNER_KEY: "test-key-not-real"
  };
  const url = open.graphLoginUrl("p1", "free_ask", env);
  assert.match(url, /^https:\/\/biztest\.chunyutianxia\.com\/cooperation\/wap\/login\//);
  assert.match(url, /partner=cy_yihuantong/);
  assert.match(url, /user_id=p1/);
  assert.match(url, /sign=/);
  assert.equal(url.includes("test-key-not-real"), false);
});

test("设 PUBLIC_ORIGIN 时 H5 走自有域名", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "cy_yihuantong",
    CHUNYU_PARTNER_KEY: "test-key-not-real",
    PUBLIC_ORIGIN: "https://yht.chunyutianxia.com"
  };
  const url = open.graphLoginUrl("p1", "free_ask", env);
  assert.match(url, /^https:\/\/yht\.chunyutianxia\.com\/cooperation\/wap\/login\//);
});

test("graphH5Url 含 emergency_graph", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "cy_yihuantong",
    CHUNYU_PARTNER_KEY: "test-key-not-real"
  };
  const url = open.graphH5Url("p1", env);
  assert.match(url, /coop_service_type=emergency_graph/);
});

test("phoneH5Url 含 fast_phone_3a 且不含密钥", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "cy_yihuantong",
    CHUNYU_PARTNER_KEY: "test-key-not-real"
  };
  const url = open.phoneH5Url("p1", env);
  assert.match(url, /coop_service_type=fast_phone_3a/);
  assert.match(url, /sign=/);
  assert.equal(url.includes("test-key-not-real"), false);
});

test("verifyCallbackSign 用 problem_id", () => {
  const env = { CHUNYU_PARTNER_KEY: "XKBP1Oqut0r2LiGV" };
  const atime = "1467098815";
  const problemId = "A800130";
  const s = open.sign("XKBP1Oqut0r2LiGV", atime, problemId);
  assert.equal(open.verifyCallbackSign({ atime, sign: s, problem_id: problemId }, env), true);
  assert.equal(open.verifyCallbackSign({ atime, sign: "deadbeefdeadbeef", problem_id: problemId }, env), false);
});

test("测试环境 publicJump 指定春雨体验版", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "cy_yihuantong",
    CHUNYU_PARTNER_KEY: "test-key-not-real",
    CHUNYU_WXAPP_ENV: "test"
  };
  const j = open.publicJump("video", "p1", { h5Url: "https://example.test", wxPath: "pages/open_login/index?token=a&session_id=b" }, env);
  assert.equal(j.wxEnv, "test");
  assert.equal(j.wxEnvVersion, "trial");
});

test("正式 host 且无测试 env 时跳正式版", () => {
  const env = {
    CHUNYU_API_HOST: "https://www.chunyuyisheng.com",
    CHUNYU_PARTNER: "p",
    CHUNYU_PARTNER_KEY: "k"
  };
  const j = open.publicJump("video", "p1", { wxPath: "pages/x" }, env);
  assert.equal(j.wxEnvVersion, "release");
});

test("biztest host 即使没设 wxEnv 也走体验版", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "p",
    CHUNYU_PARTNER_KEY: "k"
  };
  assert.equal(open.publicJump("video", "p1", { wxPath: "pages/x" }, env).wxEnvVersion, "trial");
});

test("未设测试 env 时跳正式版", () => {
  const env = {
    CHUNYU_API_HOST: "https://example.test",
    CHUNYU_PARTNER: "p",
    CHUNYU_PARTNER_KEY: "k"
  };
  const j = open.publicJump("video", "p1", { wxPath: "pages/x" }, env);
  assert.equal(j.wxEnvVersion, "release");
});

test("图文仅有 h5Url 时不伪造春雨小程序 path", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "p",
    CHUNYU_PARTNER_KEY: "k",
    CHUNYU_WXAPP_ENV: "test"
  };
  const h5 = "https://biztest.chunyutianxia.com/cooperation/wap/login/?user_id=p1";
  const j = open.publicJump("graph", "p1", { h5Url: h5 }, env);
  assert.equal(j.wxAppId, "");
  assert.equal(j.wxPath, "");
  assert.equal(j.h5Url, h5);
});

test("wxPathFromH5 可单独生成春雨承载页", () => {
  const env = { CHUNYU_WXAPP_ENV: "test" };
  const h5 = "https://biztest.chunyutianxia.com/cooperation/wap/login/?user_id=p1";
  assert.equal(
    open.wxPathFromH5(h5, env),
    "pages/index/index?url=" + encodeURIComponent(h5) + "&env=test"
  );
});

test("已有 jump_wxapp path 时不覆盖", () => {
  const env = {
    CHUNYU_API_HOST: "https://biztest.chunyutianxia.com",
    CHUNYU_PARTNER: "p",
    CHUNYU_PARTNER_KEY: "k",
    CHUNYU_WXAPP_ENV: "test"
  };
  const j = open.publicJump("video", "p1", {
    h5Url: "https://example.test/h5",
    wxPath: "pages/open_login/index?token=a&session_id=b"
  }, env);
  assert.equal(j.wxPath, "pages/open_login/index?token=a&session_id=b");
});

console.log("all chunyu_open tests passed");
