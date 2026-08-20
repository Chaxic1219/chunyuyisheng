"use strict";

const { buildQiweDmSystemPrompt, buildQiweDmPhaseHint, buildNonMedicalRedirectPrompt } = require("./modules/mpAi/prompt.js");
const { dmResponsesFromText } = require("./modules/qiwe/dm_assistant.js");
const { isMedicalConsultAllowed } = require("./modules/mpAi/gate.js");
const { replyNonMedicalRedirect } = require("./modules/mpAi/index.js");

let fails = [];
const ok = (c, m) => { if (c) console.log("  ✓", m); else { fails.push(m); console.log("  ✗", m); } };

(async () => {
  const sys = buildQiweDmSystemPrompt();
  ok(/AI 健康朋友|AI 诊室/.test(sys), "私聊 prompt 含阿福式诊室定位");
  ok(/您可以回复：/.test(sys), "私聊 prompt 含快捷选项格式");
  ok(/不要回答原问题/.test(buildNonMedicalRedirectPrompt(true)), "非医疗 redirect prompt 含婉拒指令");

  ok(buildQiweDmPhaseHint([]).includes("开场"), "无历史→开场阶段");
  ok(buildQiweDmPhaseHint([{ role: "user", text: "头疼" }, { role: "assistant", text: "多久" }, { role: "user", text: "三天" }]).includes("细化"), "3轮→细化阶段");
  ok(buildQiweDmPhaseHint(Array.from({ length: 5 }, (_, i) => ({ role: "user", text: "x" + i }))).includes("小结"), "5轮→小结阶段");

  const parts = dmResponsesFromText("第一段接住您的情况。\n\n第二段继续追问。\n\n您可以回复：A / B");
  ok(parts.length >= 2, "私聊回复按段拆成多条气泡");

  ok(isMedicalConsultAllowed({ text: "帮我总结一下", history: [], sceneId: "qiwe_dm" }).allowed, "qiwe_dm 总结指令放行");

  const dmHist = [
    { role: "user", text: "我头疼" },
    { role: "assistant", text: "了解了。\n\n您可以回复：A补充头痛 / B补充排尿 / C帮我总结" },
  ];
  ok(isMedicalConsultAllowed({ text: "C", history: dmHist, sceneId: "qiwe_dm" }).allowed, "选项 C 放行");
  ok(isMedicalConsultAllowed({ text: "选项C", history: dmHist, sceneId: "qiwe_dm" }).allowed, "选项C 放行");
  ok(isMedicalConsultAllowed({ text: "你好", history: dmHist, sceneId: "qiwe_dm" }).allowed, "问诊中你好放行");
  ok(isMedicalConsultAllowed({ text: "今天天气怎么样", history: dmHist, sceneId: "qiwe_dm" }).allowed === false, "问诊中天气仍拦截");

  const fallback = await replyNonMedicalRedirect(
    { text: "今天股票怎么样", history: [] },
    { fetchImpl: async () => ({ ok: false, status: 500, text: async () => "err" }) },
    "qiwe_dm"
  );
  ok(fallback.includes("健康"), "LLM 失败时仍用写死兜底");

  if (fails.length) {
    console.error("\n失败:", fails.join("; "));
    process.exit(1);
  }
  console.log("✓ 阿福式私聊对话自测通过");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
