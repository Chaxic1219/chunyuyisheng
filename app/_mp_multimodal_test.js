#!/usr/bin/env node
"use strict";
/**
 * mpAi 多模态链路专项测试：
 * 1) mp_ai 场景路由到 multimodal=1 模型时，user content 为 [text, image_url] 数组
 * 2) 非多模态模型：有图时降级纯文本、不报错
 * 3) normalizeImages 校验（格式/大小/数量）
 * 运行：node _mp_multimodal_test.js
 */
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const appDir = __dirname;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-mm-test-"));
const dbPath = path.join(tmpDir, "test.db");
process.env.DB_PATH = dbPath;

const db = new DatabaseSync(dbPath);
const llmConfig = require(path.join(appDir, "modules/llm_config.js"));
llmConfig.ensureSchema(db);

let passed = 0, failed = 0;
function ok(name) { passed++; console.log("ok -", name); }
function notOk(name, e) { failed++; console.log("not ok -", name, "->", e && e.message); }

// 造两个模型：多模态（qwen-vl）与纯文本（deepseek-chat）
function insertModel(name, model, base, key, multimodal) {
  return db.prepare(`INSERT INTO llm_models(name,provider,base_url,api_key,model,timeout_ms,multimodal,enabled,test_ok,updated_at,updated_by)
    VALUES(?,?,?,?,?,8000,?,1,1,?,?)`).run(name, "openai_compatible", base, key, model, multimodal ? 1 : 0, new Date().toISOString(), "test").lastInsertRowid;
}
function setRoute(scene, primaryId, fallbackId) {
  db.prepare(`INSERT OR REPLACE INTO llm_scene_routes(scene_id,primary_model_id,fallback_model_id,fallback_action,enabled,updated_at,updated_by)
    VALUES(?,?,?,?,1,?,?)`).run(scene, primaryId, fallbackId || null, "safe_message", new Date().toISOString(), "test");
}

const mmId = insertModel("多模态测试", "qwen-vl-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1", "sk-mm-test", true);
const textId = insertModel("纯文本测试", "deepseek-chat", "https://api.deepseek.com", "sk-text-test", false);

const base64Img = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-bytes").toString("base64");

// ---- 1) 多模态模型：content 为数组 ----
async function runChat() {
  const mpAi = require(path.join(appDir, "modules/mpAi/index.js"));
  // stub fetch 捕获 body
  const calls = [];
  const deps = {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: "这是图片识别结果" } }] }),
      };
    },
  };
  const out = await mpAi.chat({ text: "看看这张报告", images: [base64Img], sessionId: "s1" }, deps);
  assert.equal(out.reply.text, "这是图片识别结果");
  assert.equal(calls.length, 1);
  const userMsg = calls[0].body.messages.find((m) => m.role === "user");
  assert.ok(Array.isArray(userMsg.content), "多模态时 content 应为数组");
  const textPart = userMsg.content.find((p) => p.type === "text");
  const imgPart = userMsg.content.find((p) => p.type === "image_url");
  assert.ok(textPart && /看看这张报告/.test(textPart.text), "含文本段");
  assert.ok(imgPart && imgPart.image_url.url === base64Img, "含 image_url 段");
  assert.equal(out.imageHandled, true);
  ok("多模态模型：user content 为 [text, image_url] 数组");
}

// ---- 2) 非多模态模型：降级纯文本 ----
async function runTextOnly() {
  setRoute("mp_ai", textId, mmId);
  const mpAi = require(path.join(appDir, "modules/mpAi/index.js"));
  const calls = [];
  const deps = {
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    },
  };
  const out = await mpAi.chat({ text: "看看报告", images: [base64Img] }, deps);
  const userMsg = calls[0].messages.find((m) => m.role === "user");
  assert.equal(typeof userMsg.content, "string", "非多模态时 content 应为纯文本");
  assert.ok(!/data:image/.test(userMsg.content), "不泄露 base64");
  assert.ok(/当前模型不支持图片/.test(userMsg.content), "降级提示");
  assert.equal(out.imageHandled, true);
  ok("非多模态模型：降级纯文本提示，不报错");
}

// ---- 3) normalizeImages 校验 ----
function testNormalize() {
  const { normalizeImages } = require(path.join(appDir, "routes/mp-ai.js"));
  const r1 = normalizeImages(undefined);
  assert.equal(r1.ok, true); assert.equal(r1.images.length, 0);
  const r2 = normalizeImages("data:image/png;base64,AAAA");
  assert.equal(r2.ok, true); assert.equal(r2.images.length, 1);
  const r3 = normalizeImages("data:image/gif;base64,AAAA");
  assert.equal(r3.ok, true);
  const r4 = normalizeImages("data:image/bmp;base64,AAAA");
  assert.equal(r4.ok, false); assert.equal(r4.error, "image_format_unsupported");
  const r5 = normalizeImages("data:image/png;base64," + "A".repeat(6 * 1024 * 1024));
  assert.equal(r5.ok, false); assert.equal(r5.error, "image_too_large");
  const r6 = normalizeImages(["data:image/png;base64,AAAA", "data:image/webp;base64,BBBB", "data:image/jpeg;base64,CCCC", "data:image/png;base64,DDDD"]);
  assert.equal(r6.ok, true); assert.equal(r6.images.length, 3, "最多 3 张");
  ok("normalizeImages：格式/大小/数量校验正确");
}

(async () => {
  try {
    setRoute("mp_ai", mmId, textId);
    await runChat();
    await runTextOnly();
    testNormalize();
  } catch (e) {
    notOk("mpAi 多模态链路", e);
  } finally {
    try { db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
