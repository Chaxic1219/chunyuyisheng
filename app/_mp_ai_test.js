"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `mp-ai-${Date.now()}.db`);
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
delete process.env.MP_AI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;

const { db } = require("./db.js");
const mpAi = require("./modules/mpAi");
const promptSrc = fs.readFileSync(path.join(__dirname, "modules/mpAi/prompt.js"), "utf8");
const clientSrc = fs.readFileSync(path.join(__dirname, "modules/mpAi/client.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(__dirname, "modules/mpAi/index.js"), "utf8");
const allSrc = promptSrc + "\n" + clientSrc + "\n" + indexSrc;

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("ok -", msg);
}

(async () => {
  ok(!/require\(["'].*triage/.test(allSrc), "mpAi 不 require triage");
  ok(!/require\(["'].*health_chat/.test(allSrc), "mpAi 不 require health_chat");
  ok(!/require\(["'].*\/agent/.test(allSrc), "mpAi 不 require agent");

  const doctor = db.prepare("SELECT id, name, hospital, dept, specialty FROM doctors ORDER BY id LIMIT 1").get();
  assert.ok(doctor && doctor.id, "seed 有医生");

  const sys = mpAi.buildSystemPrompt();
  ok(sys.includes("医生团队的医助"), "prompt 黑箱医助人设");
  ok(!sys.includes("春雨健康小程序助手"), "无旧小程序助手称呼");
  ok(!sys.includes("当前角色：健康助手"), "无健康助手角色文案");
  ok(mpAi.buildSystemPrompt("life").includes("预约"), "life prompt 保留就医服务范围");

  ok(!mpAi.isMedicalConsultAllowed({ text: "今天天气不错" }).allowed, "闲聊拒答");
  ok(mpAi.isMedicalConsultAllowed({ text: "术后饮食要注意什么" }).allowed, "医疗问题放行");
  ok(mpAi.isMedicalConsultAllowed({ text: "帮我安排复诊" }).allowed, "就医服务放行");
  ok(
    mpAi.isMedicalConsultAllowed({
      text: "三天了",
      history: [{ role: "user", text: "我肚子有点痛" }],
    }).allowed,
    "医疗续轮放行"
  );

  ok(mpAi.resolveConfig() === null, "无 Key 时 resolveConfig 为 null");

  let threw = false;
  try {
    await mpAi.chat({ doctorId: doctor.id, text: "术后饮食要注意什么" });
  } catch (e) {
    threw = e.code === "not_configured";
  }
  ok(threw, "无 Key 时 chat 抛 not_configured");

  process.env.MP_AI_API_KEY = "test-key";
  process.env.MP_AI_BASE_URL = "https://example.test/v1";
  process.env.MP_AI_MODEL = "test-model";
  delete require.cache[require.resolve("./modules/mpAi/client.js")];
  delete require.cache[require.resolve("./modules/mpAi/index.js")];
  const mpAi2 = require("./modules/mpAi");

  const cfg = mpAi2.resolveConfig();
  ok(cfg && cfg.model === "test-model" && /chat\/completions$/.test(cfg.url), "resolveConfig 读 MP_AI_*");

  const out = await mpAi2.chat(
    {
      doctorId: doctor.id,
      text: "术后饮食要注意什么",
      history: [
        { role: "user", text: "上一轮" },
        { role: "assistant", text: "上一轮回复" },
      ],
      sessionId: "sess-1",
    },
    {
      fetchImpl: async (url, init) => {
        ok(String(url).includes("example.test"), "请求打到配置的 BASE_URL");
        const body = JSON.parse(init.body);
        ok(body.messages[0].role === "system", "首条为 system");
        ok(body.messages.some((m) => m.role === "user" && m.content.includes("术后饮食")), "含本轮 user");
        ok(body.messages.some((m) => m.content === "上一轮"), "含 history");
        return {
          ok: true,
          status: 200,
          async json() {
            return { choices: [{ message: { content: "注意清淡饮食，少量多餐。" } }] };
          },
          async text() {
            return "";
          },
        };
      },
    }
  );
  ok(out.reply && out.reply.role === "assistant" && /清淡饮食/.test(out.reply.text), "mock 上游返回 reply");
  ok(out.sessionId === "sess-1", "回传 sessionId");
  ok(out.model === "test-model", "内部 chat 仍保留 model 供审计");

  const rejected = await mpAi2.chat({ doctorId: doctor.id, text: "今天天气不错，推荐个电影" });
  ok(/健康、用药/.test(rejected.reply.text), "非医疗问题固定拒答");
  ok(!rejected.model, "拒答分支不暴露 model");

  let fetchCalled = false;
  await mpAi2.chat(
    { doctorId: doctor.id, text: "今天股票怎么样" },
    {
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "不应出现" } }] }), text: async () => "" };
      },
    }
  );
  ok(!fetchCalled, "非医疗问题不调 LLM");

  const leaked = await mpAi2.chat(
    { doctorId: doctor.id, text: "我头疼怎么办" },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: "我是 AI 助手，建议你休息。" } }] };
        },
        async text() {
          return "";
        },
      }),
    }
  );
  ok(!/AI/.test(leaked.reply.text), "泄漏回复被黑箱兜底");

  const llmConfig = require("./modules/llm_config.js");
  llmConfig.ensureSchema(db);
  const modelId = Number(db.prepare(`INSERT INTO llm_models
    (name,provider,base_url,api_key,model,timeout_ms,enabled,test_ok)
    VALUES('mp-route','openai','https://route-only.test','route-key','route-model',8000,1,1)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO llm_scene_routes(scene_id,primary_model_id,fallback_action,enabled)
    VALUES('mp_ai',?,'safe_message',1)
    ON CONFLICT(scene_id) DO UPDATE SET primary_model_id=excluded.primary_model_id,fallback_model_id=NULL,enabled=1`).run(modelId);
  delete process.env.MP_AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const routeOnly = await mpAi2.chat({ text:"报告结果怎么看" }, { fetchImpl:async url => {
    ok(String(url).includes("route-only.test"), "仅配置 mp_ai scene 时顶层 chat 仍请求路由模型");
    return { ok:true, status:200, json:async()=>({ choices:[{ message:{ content:"路由回复" } }] }), text:async()=>"" };
  }});
  ok(routeOnly.reply.text === "路由回复", "仅 scene 路由无需旧环境 Key");

  let bad = false;
  try {
    await mpAi2.chat({ text: "  " });
  } catch (e) {
    bad = e.code === "bad_request";
  }
  ok(bad, "空 text → bad_request");

  const { registerMpAiRoutes } = require("./routes/mp-ai.js");
  const routes = [];
  registerMpAiRoutes(
    (method, re, fn) => routes.push({ method, re, fn }),
    {
      parseBody: async () => ({}),
      json: () => {},
      MESSAGE_MAX_BODY: 1e6,
    }
  );
  ok(
    routes.length === 1 &&
      routes[0].method === "POST" &&
      routes[0].re.test("/api/mp/ai-chat"),
    "注册 POST /api/mp/ai-chat"
  );

  console.log("\nall mp_ai tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
