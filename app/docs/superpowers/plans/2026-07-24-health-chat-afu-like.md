# 群内阿福式轻会话（health_chat）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Dialogue Agent 上增加 `health_chat` 路径，使群内问病具备阿福式追问、有据回答、人味语气与多轮记忆，并可用开关回滚。

**Architecture:** 在急危/编号/纯服务之后分流到新核 `agent/health_chat.js`：合并槽位 → `retrieveKnowledge` → 相位 `intake|educate|escalate` → 专用 Compose；`intake/educate` 不附卡；`HEALTH_CHAT_ENABLED≠1` 时走旧 medical handoff。

**Tech Stack:** Node.js、`app/agent/*`、`triage.retrieveKnowledge`、SQLite `agent_sessions` / `knowledge_items` / `faq`、本地 `node _health_chat_test.js`。

**Spec:** `app/docs/superpowers/specs/2026-07-24-health-chat-afu-like-design.md`

**Note:** 仅在主人明确要求时 git commit；否则跳过各 Task 的 Commit 步。  
**Progress:** Tasks 1–7 已落地（工程）；云测需显式 `HEALTH_CHAT_ENABLED=1` + `DIALOGUE_AGENT_ENABLED=1`。

---

## File map

| File | Responsibility |
|------|----------------|
| `app/agent/flags.js` | `healthChatEnabled()` |
| `app/agent/planner.js` | `goal/intendedAction=health_chat` 分支（开关开时） |
| `app/agent/session.js` | `chatPhase`、assistant turns、槽位合并辅助 |
| `app/agent/compose_health_chat.js` | 阿福式 LLM + 槽位感知软模板 + 证据块 |
| `app/agent/health_chat.js` | 相位决策、检索、FAQ 合并、编排 compose、返回 plan 补丁 |
| `app/agent/runtime.js` | 识别 health_chat plan → 调用核；写 session；meta.path |
| `app/agent/risk.js` | 确认 `health_chat`/`reply_advice` 教育路径 sendPolicy（必要时微调） |
| `app/_health_chat_test.js` | 分流、相位、none、禁附卡、开关回滚、多轮 |
| `app/_agent_test.js` | 回归：开关关时旧行为；开时肚子疼不首轮甩卡 |
| `app/_agent_demo.js` | 增加 health_chat 样例打印 |
| Spec 文档 | 状态改为「已批准 / 实施中」 |

---

### Task 1: 开关 + Planner 分流（TDD）

**Files:**
- Modify: `app/agent/flags.js`
- Modify: `app/agent/planner.js`
- Create: `app/_health_chat_test.js`

- [ ] **Step 1: Write failing tests**

```js
// app/_health_chat_test.js（开头样板）
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_health_chat_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
delete process.env.HEALTH_CHAT_ENABLED;

const { db } = require("./db.js");
const { healthChatEnabled } = require("./agent/flags.js");
const { understand } = require("./agent/understand.js");
const { plan } = require("./agent/planner.js");

let fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async () => {
  const doctorId = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get().id;

  console.log("== flags ==");
  ok(healthChatEnabled() === false, "默认 HEALTH_CHAT 关");
  process.env.HEALTH_CHAT_ENABLED = "1";
  ok(healthChatEnabled() === true, "HEALTH_CHAT_ENABLED=1 → 开");

  console.log("== planner health_chat ==");
  const u = understand({ doctorId, text: "我肚子有点疼" });
  ok(u.medicalIntent === true, "肚子疼 → medicalIntent");
  const pOff = plan(u, "medium", false, { level: 3, allowCard: false, healthChat: false });
  ok(pOff.goal !== "health_chat", "healthChat 关 → 非 health_chat goal");
  const pOn = plan(u, "medium", false, { level: 3, allowCard: false, healthChat: true });
  ok(pOn.goal === "health_chat" && pOn.intendedAction === "health_chat", "healthChat 开 → health_chat");
  ok(pOn.preferredCode == null, "intake 默认不带 preferredCode");
  ok(!(pOn.toolCalls || []).some(t => t.name === "open_chunyu_card"), "health_chat plan 初始不附卡");

  const svc = understand({ doctorId, text: "怎么挂号" });
  const pSvc = plan(svc, "low", false, { level: 4, allowCard: true, healthChat: true });
  ok(pSvc.goal === "schedule" || pSvc.intendedAction === "open_chunyu_card", "纯服务仍走服务路径");

  if (fails.length) { console.error("FAIL", fails); process.exit(1); }
  console.log("ALL PASS");
})();
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd app
node _health_chat_test.js
```

Expected: `healthChatEnabled` 未导出或 plan 无 `health_chat`。

- [ ] **Step 3: Implement flags**

```js
// app/agent/flags.js — 追加
function healthChatEnabled(){
  return process.env.HEALTH_CHAT_ENABLED === "1";
}
module.exports = { agentEnabled, agentDryRun, healthChatEnabled };
```

- [ ] **Step 4: Implement planner branch**

在 `plan()` 中，**急危 return 之后、附件分支之前**（或附件之后、medication 之前——以规格为准：问病优先走 health_chat；附件仍走附件逻辑）：

对「无附件、非纯服务菜单、且 `opts.healthChat === true`，且（medicalIntent 或 healthcarePersona 或 slots.hasMedicalCue）」：

```js
if(opts.healthChat && !slots.hasAttachment && !(understood.attachmentHints || []).length){
  const persona = understood && understood.healthcarePersona;
  const medical = !!(understood && understood.medicalIntent) || !!persona
    || !!(slots.hasMedicalCue || slots.asksMedication);
  const pureService = !!(service && service.preferredCode && !medical
    && service.goal !== "menu");
  if(medical && !pureService){
    // 开药诉求仍标 escalate 由 health_chat 核处理；plan 先给 health_chat
    if(slots.asksMedication){
      return {
        intendedAction:"health_chat",
        goal:"health_chat",
        toolCalls:[{ name:"reply_text", args:{ tone:"health_chat" } }],
        preferredCode:null,
        hasMedicalAdviceText:false,
        handoff:true,
        note:"health_chat_med_escalate",
        chatPhaseHint:"escalate"
      };
    }
    return {
      intendedAction:"health_chat",
      goal:"health_chat",
      toolCalls:[{ name:"reply_text", args:{ tone:"health_chat" } }],
      preferredCode:null,
      hasMedicalAdviceText:false,
      handoff:false,
      note:"health_chat",
      chatPhaseHint:"intake"
    };
  }
}
```

注意：纯服务（怎么挂号）在 medical 为 false 时不进此分支，保持原 service 逻辑。

- [ ] **Step 5: Run — expect PASS**

```bash
cd app
node _health_chat_test.js
```

- [ ] **Step 6: Commit（仅主人要求时）**

```bash
git add app/agent/flags.js app/agent/planner.js app/_health_chat_test.js
git commit -m "feat(agent): HEALTH_CHAT flag and planner branch"
```

---

### Task 2: Session 相位与完整 turns

**Files:**
- Modify: `app/agent/session.js`
- Modify: `app/_health_chat_test.js`

- [ ] **Step 1: Extend failing tests**

```js
const sessionStore = require("./agent/session.js");
sessionStore._clearAllForTests();
const s = sessionStore.getSession(doctorId, "hc:turns");
sessionStore.updateSession(s, {
  chatPhase: "intake",
  slots: { bodyPart: "上腹" },
  turn: { role: "user", text: "肚子疼", at: Date.now() }
});
sessionStore.updateSession(s, {
  turn: { role: "assistant", text: "哪里疼？", at: Date.now() }
});
const s2 = sessionStore.getSession(doctorId, "hc:turns");
ok(s2.chatPhase === "intake", "chatPhase 持久");
ok((s2.turns || []).some(t => t.role === "assistant"), "turns 含 assistant");
ok(s2.slots && s2.slots.bodyPart === "上腹", "slots 合并");
```

- [ ] **Step 2: Run — expect FAIL**（chatPhase 未写入）

- [ ] **Step 3: Implement**

在 `updateSession` 中支持：

```js
if(patch.chatPhase != null) session.chatPhase = String(patch.chatPhase).slice(0, 40);
// turns: 已有 turn 追加；确保 role 可为 user|assistant，slice(-12)
// persist: 若表无 chat_phase 列，把 chatPhase 塞进 slots_json 旁路：
// 推荐：slots_json 外另存 —— 一期把 chatPhase 写入 summary 前缀不安全；
// 规格允许 JSON 语义扩展：将 { chatPhase, ...slots } 存 slots，或
// 在 turns_json 同级用现有字段：把 meta 放进 slots_json 的 __meta.chatPhase
```

**推荐实现（不改表）：**

```js
// getSession 读出后：
session.chatPhase = (session.slots && session.slots.__chatPhase) || null;
// updateSession:
if(patch.chatPhase != null){
  session.slots = Object.assign({}, session.slots, { __chatPhase: patch.chatPhase });
  session.chatPhase = patch.chatPhase;
}
// 对外 mergeSlots 时忽略 __ 前缀键
```

`turn.role === "assistant"` 必须原样写入 `turns_json`。

- [ ] **Step 4: Run PASS**

- [ ] **Step 5: Commit（仅主人要求时）**

---

### Task 3: 相位决策 + 检索（无 LLM）

**Files:**
- Create: `app/agent/health_chat.js`
- Modify: `app/_health_chat_test.js`

- [ ] **Step 1: Failing tests for phase + evidence**

```js
const hc = require("./agent/health_chat.js");

// 造一条 ready 知识
const kid = db.prepare(`INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).run(
  doctorId, "医生个人", "半预制", "胆囊切除术后饮食",
  "胆囊切除术后饮食宜清淡，可逐步恢复鸡蛋等优质蛋白，避免油腻辛辣。仅供参考，请咨询医生。",
  "test", "ops", "ready", new Date().toISOString()
).lastInsertRowid;

const r1 = await hc.resolveTurn({
  doctorId, text: "我肚子有点疼", session: sessionStore.getSession(doctorId, "hc:p1"),
  understood: understand({ doctorId, text: "我肚子有点疼" }),
  allowCard: false, emergency: false, clinicalRisk: "medium"
});
ok(r1.phase === "intake", "信息不足 → intake");
ok(!r1.attachCode, "intake 不附卡");

const r2 = await hc.resolveTurn({
  doctorId, text: "胆囊切除后能吃鸡蛋吗",
  session: sessionStore.getSession(doctorId, "hc:p2"),
  understood: understand({ doctorId, text: "胆囊切除后能吃鸡蛋吗" }),
  allowCard: false, emergency: false, clinicalRisk: "low"
});
ok(r2.phase === "educate" || r2.evidence.sufficiency !== "none", "饮食问+知识 → educate 或有证据");
ok(!r2.attachCode, "educate 不附卡");

const r3 = await hc.resolveTurn({
  doctorId, text: "给我开点止痛药",
  session: sessionStore.getSession(doctorId, "hc:p3"),
  understood: understand({ doctorId, text: "给我开点止痛药" }),
  allowCard: true, emergency: false, clinicalRisk: "medium", level: 2
});
ok(r3.phase === "escalate", "开药 → escalate");
```

- [ ] **Step 2: Run FAIL**

- [ ] **Step 3: Implement `health_chat.js` 核心 API**

```js
"use strict";
const triage = require("../triage.js");
const { db } = require("../db.js");

function mergeSlots(prev, understood){
  const slots = Object.assign({}, prev || {}, (understood && understood.slots) || {});
  const t = String((understood && understood.text) || "");
  // 规则补槽：上腹/下腹/胃、N天、加重
  if(/上腹|胃[部口]?|肚脐上/.test(t)) slots.bodyPart = slots.bodyPart || "上腹";
  if(/下腹|小腹/.test(t)) slots.bodyPart = slots.bodyPart || "下腹";
  if(/肚子|腹痛|胃痛/.test(t) && !slots.bodyPart) slots.bodyPart = slots.bodyPart || "腹部";
  // duration/worsening 已由 understand.extractSlots
  delete slots.__chatPhase;
  return slots;
}

function buildQuery(text, slots){
  return [text, slots.bodyPart, slots.duration, slots.worsening ? "加重" : ""]
    .filter(Boolean).join(" ").slice(0, 500);
}

function decidePhase({ understood, slots, evidence, emergency, clinicalRisk, chatPhaseHint }){
  if(emergency || clinicalRisk === "high") return "escalate";
  if(slots.asksMedication || chatPhaseHint === "escalate") return "escalate";
  if(/确诊|是不是癌|开药|吃什么药|剂量/.test(String(understood.text || ""))) return "escalate";
  const enoughSlots = !!(slots.bodyPart && slots.duration) || !!(slots.symptoms && slots.symptoms.length >= 1 && slots.duration);
  const specificQ = /能吃|可以吃|术后|饮食|注意|忌口|复查|怎么看/.test(String(understood.text || ""));
  if(evidence && evidence.sufficiency === "enough" && (specificQ || enoughSlots)) return "educate";
  if(evidence && evidence.sufficiency === "partial" && specificQ) return "educate";
  return "intake";
}

async function retrieveEvidence(doctorId, text, slots){
  const ctx = triage.doctorContext ? triage.doctorContext(doctorId) : { doctor: { id: doctorId }, knowledge: [] };
  // doctorContext 若未导出：本地查 ready 知识填 ctx
  if(!ctx.doctor) ctx.doctor = { id: doctorId };
  if(!ctx.knowledge){
    ctx.knowledge = db.prepare(
      "SELECT id,layer,mode,title,body,source,status FROM knowledge_items WHERE doctor_id=? AND status='ready' ORDER BY id LIMIT 50"
    ).all(doctorId);
  }
  let kb;
  try{
    kb = await triage.retrieveKnowledge(ctx, buildQuery(text, slots), 3);
  }catch(e){
    kb = { sufficiency: "none", items: [], top: 0, source: "fallback" };
  }
  const faqItems = matchFaq(doctorId, text, 2);
  if(faqItems.length && (!kb.items || !kb.items.length)){
    kb = {
      sufficiency: "partial",
      items: faqItems,
      top: 1,
      source: "faq"
    };
  }else if(faqItems.length){
    kb.items = (kb.items || []).concat(faqItems).slice(0, 4);
    if(kb.sufficiency === "none") kb.sufficiency = "partial";
  }
  return kb;
}

/** FAQ：query 与 q/a 的 2-gram 重叠；命中 ≥2 则纳入 */
function matchFaq(doctorId, text, limit){
  const q = String(text || "").trim();
  if(!q) return [];
  const qGrams = new Set();
  for(let i = 0; i < q.length - 1; i++) qGrams.add(q.slice(i, i + 2));
  const rows = db.prepare("SELECT q,a FROM faq WHERE doctor_id=? ORDER BY sort,id LIMIT 80").all(Number(doctorId));
  const scored = [];
  for(const f of rows){
    const blob = String(f.q || "") + String(f.a || "");
    let hit = 0;
    for(let i = 0; i < blob.length - 1; i++){
      if(qGrams.has(blob.slice(i, i + 2))) hit++;
    }
    if(hit >= 2) scored.push({ hit, title: f.q, body: f.a });
  }
  return scored.sort((a, b) => b.hit - a.hit).slice(0, limit || 2).map((x, i) => ({
    id: "faq" + i,
    layer: "FAQ",
    mode: "faq",
    title: x.title,
    body: x.body,
    source: "faq"
  }));
}

async function resolveTurn(input){
  const doctorId = Number(input.doctorId);
  const text = String(input.text || "").trim();
  const session = input.session || {};
  const understood = input.understood;
  const slots = mergeSlots(session.slots, understood);
  const evidence = await retrieveEvidence(doctorId, text, slots);
  const phase = decidePhase({
    understood, slots, evidence,
    emergency: !!input.emergency,
    clinicalRisk: input.clinicalRisk || "low",
    chatPhaseHint: (input.planned && input.planned.chatPhaseHint) || session.chatPhase
  });
  let attachCode = null;
  if(phase === "escalate" && input.allowCard) attachCode = "101";
  return { phase, slots, evidence, attachCode, handoff: phase === "escalate" };
}

module.exports = { resolveTurn, mergeSlots, decidePhase, buildQuery, retrieveEvidence, matchFaq };
```

若 `doctorContext` 未导出，在 `retrieveEvidence` 内自建 ctx（如上），勿改 triage 导出除非必要。

- [ ] **Step 4: Run PASS**

- [ ] **Step 5: Commit（仅主人要求时）**

---

### Task 4: Compose health_chat（模板优先可测 + LLM 可选）

**Files:**
- Create: `app/agent/compose_health_chat.js`
- Modify: `app/_health_chat_test.js`

- [ ] **Step 1: Tests with TRIAGE_AI_DISABLED=1**

```js
const { composeHealthChat } = require("./agent/compose_health_chat.js");
const out = await composeHealthChat({
  doctorId, text: "我肚子有点疼", phase: "intake",
  slots: {}, evidence: { sufficiency: "none", items: [] },
  recentTurns: [], summary: ""
});
ok(out.text && /哪|多久|加重|部位/.test(out.text), "intake 软模板含追问");
ok(!/请发\s*101|发送\s*101/.test(out.text), "禁止教发 101");

const edu = await composeHealthChat({
  doctorId, text: "胆囊切除后能吃鸡蛋吗", phase: "educate",
  slots: {}, evidence: {
    sufficiency: "enough",
    items: [{ title: "术后饮食", body: "可逐步恢复鸡蛋等优质蛋白，避免油腻。仅供参考，请咨询医生。" }]
  },
  recentTurns: [], summary: ""
});
ok(/鸡蛋|蛋白|清淡|油腻/.test(edu.text), "educate 引用证据要点");
```

- [ ] **Step 2: Implement `compose_health_chat.js`**

- `softTemplateHealth(phase, ctx)`：intake / educate / escalate 三套人味短句；educate 必须嵌入 `evidence.items[0].body` 截断改写（字符串摘录，非空话）。  
- `composeViaFetch`：system 按规格 §6（接住、证据块、最多 1～2 追问、禁客服腔）；复用 `triage.modelConfig`、`lightClean`/`scrubForbidden`（可从 `compose.js` require 已导出清洗函数）。  
- `TRIAGE_AI_DISABLED=1` 或失败 → softTemplate。  
- 调用 `configuredPrompt(doctorId, "personaHealthChat")`（无则空）。

- [ ] **Step 3: Run PASS**

---

### Task 5: Runtime 接线

**Files:**
- Modify: `app/agent/runtime.js`
- Modify: `app/agent/index.js`（若需导出）
- Modify: `app/_health_chat_test.js`、`app/_agent_test.js`

- [ ] **Step 1: E2E failing test**

```js
process.env.HEALTH_CHAT_ENABLED = "1";
process.env.TRIAGE_AI_DISABLED = "1";
const agent = require("./agent/index.js");
sessionStore._clearAllForTests();

const r = await agent.runTurn({
  doctorId, text: "我肚子有点疼", patientKey: "hc:e2e1", isGroup: true
});
ok(r.source === "dialogue_agent", "仍为 dialogue_agent");
ok(r.agentMeta && r.agentMeta.path === "health_chat", "path=health_chat");
ok(!(r.responses || []).some(x => x && x.type === "mp"), "首轮不附小程序卡");
const plain = (r.responses || []).filter(x => x.type === "text").map(x => x.text).join("\n");
ok(/哪|多久|加重|部位|哪里/.test(plain), "有追问");

// 多轮
await agent.runTurn({ doctorId, text: "上腹，两天了，没加重", patientKey: "hc:e2e1", isGroup: true });
const s = sessionStore.getSession(doctorId, "hc:e2e1");
ok((s.turns || []).filter(t => t.role === "assistant").length >= 1, "已存 assistant 轮");

// 开关回滚
delete process.env.HEALTH_CHAT_ENABLED;
sessionStore._clearAllForTests();
const rOld = await agent.runTurn({
  doctorId, text: "我肚子有点疼", patientKey: "hc:old", isGroup: true
});
ok(rOld.agentMeta && rOld.agentMeta.path !== "health_chat", "关开关不走 health_chat");
```

- [ ] **Step 2: Wire `runAgentPath`**

在 `plan(...)` 调用处传入 `healthChat: healthChatEnabled()`：

```js
const { healthChatEnabled } = require("./flags.js");
let planned = plan(understood, planRisk, clinical.emergency || ..., {
  level: levelInfo.level,
  allowCard,
  healthChat: healthChatEnabled()
});
```

当 `planned.intendedAction === "health_chat"`（且非急危早退）：

```js
const hc = require("./health_chat.js");
const { composeHealthChat } = require("./compose_health_chat.js");
const resolved = await hc.resolveTurn({
  doctorId, text, session, understood, planned,
  allowCard, emergency: risk.emergency, clinicalRisk: planRisk, level: levelInfo.level
});
const recentTurns = (session.turns || []).slice(-10);
const composed = await composeHealthChat({
  doctorId, text, phase: resolved.phase, slots: resolved.slots,
  evidence: resolved.evidence, recentTurns, summary: session.summary || "",
  personaPrompt: triage.configuredPrompt(doctorId, "personaHealthChat")
});
// 组装 responses：文本气泡；若 resolved.attachCode → runTools open_chunyu_card
// evaluateRisk：intendedAction = resolved.phase === "escalate" ? "handoff" : "health_chat"
// sendPolicy：health_chat → 与 reply_advice 类似 auto（见 Task 6）
sessionStore.updateSession(session, {
  chatPhase: resolved.phase,
  slots: resolved.slots,
  goal: "health_chat",
  summary: ...,
  turn: { role: "user", text, goal: "health_chat", at: Date.now() }
});
sessionStore.updateSession(session, {
  turn: { role: "assistant", text: composed.text, goal: "health_chat", at: Date.now() }
});
// return source dialogue_agent, agentMeta.path: "health_chat", compose: composed.meta
```

急危分支保持在 health_chat 之前（现有 `emergency_safe`）。

- [ ] **Step 3: Run `_health_chat_test.js` + `_agent_test.js` PASS**

---

### Task 6: risk.js SendPolicy

**Files:**
- Modify: `app/agent/risk.js`
- Modify: `app/_health_chat_test.js`

- [ ] **Step 1: Test**

```js
const { sendPolicyFor } = require("./agent/risk.js");
const p = sendPolicyFor({ clinicalRisk: "medium", intendedAction: "health_chat" });
ok(p.sendPolicy === "auto" && p.canAutoSend === true, "medium+health_chat 教育可 auto");
const p2 = sendPolicyFor({ clinicalRisk: "medium", intendedAction: "handoff" });
ok(p2.sendPolicy === "auto" && p2.canAutoSend === true, "handoff 允许 auto 发");
```

- [ ] **Step 2: Implement**

在 `sendPolicyFor` 的 medium/low 分支中：

```js
if(action === "health_chat"){
  return { sendPolicy:"auto", canAutoSend:true, needsHuman:true, reason:"health_chat_auto" };
}
```

放在 `reply_medical_advice` 检查之后、`handoff` 之前。

- [ ] **Step 3: Run PASS**

---

### Task 7: Demo + Spec 状态 + 回归清单

**Files:**
- Modify: `app/_agent_demo.js`
- Modify: `app/docs/superpowers/specs/2026-07-24-health-chat-afu-like-design.md`（状态 → 实施中/已落地）

- [x] **Step 1: Demo 增加**

```js
// 打印：HEALTH_CHAT_ENABLED=1 下
// 1) 我肚子有点疼
// 2) 上腹两天没加重
// 3) 胆囊切除后能吃鸡蛋吗
// 4) 给我开点止痛药
```

- [x] **Step 2: 全量本地回归**

```bash
cd app
node _health_chat_test.js
node _agent_test.js
node _persona_router_test.js
```

Expected: ALL PASS。

- [x] **Step 3: 对照规格 §1.3 七条人工勾选**（有 key 时可再开 LLM 手测语气）。

- [ ] **Step 4: Commit（仅主人要求时）**

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| HEALTH_CHAT 开关回滚 | T1, T5 |
| Planner health_chat / 纯服务不变 | T1 |
| intake/educate/escalate | T3 |
| 不附卡 / escalate+L2 附卡 | T3, T5 |
| retrieveKnowledge + FAQ | T3 |
| none 不编造 | T3, T4 |
| Compose 人设与禁 101 | T4 |
| 多轮 user+assistant | T2, T5 |
| SendPolicy auto for health_chat | T6 |
| 验收表 / demo | T7 |
| 小程序二期 | 不在本期 |

## Placeholder scan

无 TBD/「适当处理」；FAQ 匹配在 Task 3 要求写成明确函数。

---

## Execution handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-07-24-health-chat-afu-like.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每 Task 新开子代理，Task 间复查  
2. **Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

主人选哪一种？
