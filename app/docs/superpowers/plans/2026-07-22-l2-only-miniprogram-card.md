# L2-Only Mini-Program Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only L2（需医生）natural-language turns may attach 春雨小程序贴片; L3/L4 give advice without diversion; L5 code fast-path and L6 chitchat unchanged; L1 stays safety-only without cards.

**Architecture:** Add `canAttachMiniProgram(level, opts)` as a single gate in `triage.js`. `handleIncoming` and Dialogue Agent (`planner` / `tools` / `compose`) consult `classifyLevel` + this gate before any `attachCardResponses` / `open_chunyu_card`. L3/L4 copy switches to advice templates that never require「101」or mini-program.

**Tech Stack:** Node.js (`triage.js`, `agent/*`), existing `_unittest.js` / `_agent_test.js` assert helpers, PM2 deploy via `_deploy_test_server.py`.

**Spec:** `docs/superpowers/specs/2026-07-22-l2-only-miniprogram-card-design.md`

**Note:** This workspace may have no git remote; skip commit steps if `git` is unavailable. Do not invent commits.

---

## File map

| File | Responsibility |
|------|----------------|
| `app/triage.js` | `canAttachMiniProgram`, advice templates, `handleIncoming` attach/copy |
| `app/agent/planner.js` | Stop scheduling `open_chunyu_card` unless L2 |
| `app/agent/tools.js` | Fail-closed: refuse card tool if gate false |
| `app/agent/compose.js` | Advice tones without「附上小程序」 |
| `app/agent/runtime.js` | Pass level/gate into plan/tools/compose |
| `app/_unittest.js` or `app/_l2_card_gate_test.js` | Gate + classify + attach behavior tests |
| `app/_agent_test.js` | Agent path: no card on medical L4 |

---

### Task 1: `canAttachMiniProgram` + unit tests

**Files:**
- Create: `app/_l2_card_gate_test.js`
- Modify: `app/triage.js` (export gate near `classifyLevel`)

- [ ] **Step 1: Write failing tests**

```js
// app/_l2_card_gate_test.js
const assert = require("assert");
const triage = require("./triage.js");

function ok(cond, msg){ assert.ok(cond, msg); console.log("  OK", msg); }

console.log("== L2 card gate ==");
ok(typeof triage.canAttachMiniProgram === "function", "exports canAttachMiniProgram");
ok(triage.canAttachMiniProgram(2) === true, "L2 allows card");
ok(triage.canAttachMiniProgram(1) === false, "L1 denies card");
ok(triage.canAttachMiniProgram(3) === false, "L3 denies card");
ok(triage.canAttachMiniProgram(4) === false, "L4 denies card");
ok(triage.canAttachMiniProgram(6) === false, "L6 denies card");
ok(triage.canAttachMiniProgram(5) === true, "L5 level allows");
ok(triage.canAttachMiniProgram(4, { isKeywordRule:true }) === true, "keyword/code path allows even if level 4");
ok(triage.canAttachMiniProgram(4, { codeFastPath:true }) === true, "codeFastPath allows");

const l2 = triage.classifyLevel("这个药还能继续吃吗", 1, { riskLevel:"medium", needsDoctor:true });
ok(l2.level === 2, "needsDoctor medium → L2");
ok(triage.canAttachMiniProgram(l2.level) === true, "L2 classify allows");

const l4 = triage.classifyLevel("有点肚子疼怎么办", 1, { riskLevel:"low" });
ok(l4.level === 4, "low → L4");
ok(triage.canAttachMiniProgram(l4.level) === false, "L4 classify denies");

console.log("ALL PASS");
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd app && node _l2_card_gate_test.js
```

Expected: `TypeError` / assert fail — `canAttachMiniProgram` missing.

- [ ] **Step 3: Implement gate**

In `app/triage.js` before `classifyLevel`:

```js
function canAttachMiniProgram(level, opts){
  opts = opts || {};
  if(opts.isKeywordRule || opts.codeFastPath) return true;
  return Number(level) === 2 || Number(level) === 5;
}
```

Export on `module.exports` alongside `classifyLevel` / `attachCardResponses`.

- [ ] **Step 4: Re-run — expect PASS**

```bash
cd app && node _l2_card_gate_test.js
```

- [ ] **Step 5: Commit** (skip if no git) `feat: add canAttachMiniProgram gate for L2-only cards`

---

### Task 2: Advice templates + `handleIncoming` stop L3/L4 attach

**Files:**
- Modify: `app/triage.js` (`diseaseConsultPriorityReply`, `mediumGuidedFallbackReply`, low/medium apply blocks ~1542–1616)
- Modify: `app/_l2_card_gate_test.js` (integration asserts with mocked env if needed)

- [ ] **Step 1: Add advice templates (no 101 diversion)**

```js
function adviceOnlyReply(ctx, kind){
  const name = ((ctx && ctx.doctor) || {}).name || "医生";
  if(kind === "medium"){
    return [
      "收到，这类情况需要结合您的具体情况判断，群里不方便展开个人病情。",
      "建议您先记录不适开始时间、部位与变化；若明显加重、高热、呕血/黑便或无法进食，请优先线下急诊或拨打 120。",
      "我已转人工关注，医助会尽快跟进；群内不做诊断或用药指导。"
    ].join("");
  }
  // low / disease ask
  return [
    "我先帮您记下这个情况。群里不做诊断或用药建议。",
    "您可以先观察休息，并留意是否加重、持续高热、剧烈疼痛或出血等；出现这些请及时线下就医或拨打 120。",
    `若之后需要${name}团队一对一细聊，可再说明，医助会协助安排。`
  ].join("");
}
```

Keep old `diseaseConsultPriorityReply` / `mediumGuidedFallbackReply` only for **L2** paths (or rename and branch).

- [ ] **Step 2: In lowGen low branch**

After building `decision.patientReply`:

1. Compute `levelInfo = classifyLevel(patientText, doctorId, { riskLevel: decision.riskLevel, needsHuman: decision.needsHuman, emergency: !!risk.emergency, sentinel: !!risk.sentinel, riskTriggers: risk.triggers })`.
2. If `!canAttachMiniProgram(levelInfo.level)`:
   - Do **not** force disease-101 / attachList.
   - If `isDiseaseConsultAskText(patientText)` → `decision.patientReply = adviceOnlyReply(ctx, "low")`.
   - Clear `extraResponses` / `entryCode` (or never set).
3. If gate allows (L2 only — low never is L2): attach as today (unreachable for pure low).

- [ ] **Step 3: In medium LLM branch**

```js
const levelInfo = classifyLevel(patientText, doctorId, {
  riskLevel:"medium",
  needsHuman:true,
  riskTriggers: risk.triggers,
  needsDoctor: /* same regex as classifyLevel L2 */
});
const allowCard = canAttachMiniProgram(levelInfo.level);
if(allowCard){
  // existing: mediumGuidedFallback + attach 101
}else{
  decision.patientReply = adviceOnlyReply(ctx, "medium");
  decision.extraResponses = [];
  decision.entryCode = "";
  // still canAutoSend / needsHuman per existing medium-open policy
}
```

Extract shared `needsDoctorFromTriggers(triggers)` used by both `classifyLevel` and this branch to avoid drift.

- [ ] **Step 4: Extend `_l2_card_gate_test.js`**

Assert `adviceOnlyReply` text has no `101` and no `小程序` when possible; assert `canAttachMiniProgram(3)===false` already covered.

Optional smoke with `LOW_RISK_LLM_REPLY=0`: call `handleIncoming` with belly-pain text → `extraResponses` empty (may need doctorId=1 seeded DB).

- [ ] **Step 5: Run** `node _l2_card_gate_test.js` and relevant slices of `_unittest.js` if attach tests break — update expectations that required low+101 attach.

- [ ] **Step 6: Commit** `fix: L3/L4 advice-only, cards only when L2`

---

### Task 3: Dialogue Agent — plan / tools / compose / runtime

**Files:**
- Modify: `app/agent/planner.js`
- Modify: `app/agent/tools.js`
- Modify: `app/agent/compose.js`
- Modify: `app/agent/runtime.js`
- Modify: `app/_agent_test.js`

- [ ] **Step 1: Change `plan(understood, clinicalRisk, emergency, opts)`**

`opts.level` from runtime. When `!canAttachMiniProgram(opts.level)`:

- Replace any `open_chunyu_card` tool with nothing.
- For medical / attachment / service-with-code intents: `intendedAction` → `handoff` or `ask_clarify` / advice via `reply_text` with `tone:"advice"` (new).
- Keep `preferredCode:null`.

When `canAttachMiniProgram` true (L2): keep today’s card tools.

- [ ] **Step 2: `runtime.js`**

After `evaluateRisk` / before `plan`:

```js
const levelInfo = triage.classifyLevel(text, doctorId, {
  riskLevel: clinical.clinicalRisk,
  needsHuman: clinical.needsHuman,
  emergency: clinical.emergency,
  riskTriggers: clinical.floorTriggers
});
let planned = plan(understood, clinical.clinicalRisk, clinical.emergency, { level: levelInfo.level });
const toolOut = runTools(doctorId, planned.toolCalls, {
  patientName,
  level: levelInfo.level,
  allowCard: triage.canAttachMiniProgram(levelInfo.level)
});
```

Compose with `tone:"advice"` when no card and medical.

- [ ] **Step 3: `tools.js` fail-closed**

```js
if(name === "open_chunyu_card"){
  if(ctx.allowCard === false || (ctx.level != null && !triage.canAttachMiniProgram(ctx.level, ctx))){
    continue; // skip card
  }
  // existing
}
```

- [ ] **Step 4: `compose.js`**

Add `tone === "advice"` / `goal === "advice"` soft templates: observation + red-flag when to seek care + handoff; **no**「附上入口/小程序/发101」.

Update LLM system prompt when `!input.cardCode`: do not tell model to announce mini-program attachment.

- [ ] **Step 5: Agent tests**

In `_agent_test.js`, assert medical low-risk path responses have no `type:"mp"` / link cards when level would be 4; pure `101` code path still returns cards.

- [ ] **Step 6: Commit** `fix: agent respects L2-only mini-program gate`

---

### Task 4: Regression + deploy

**Files:** none new

- [ ] **Step 1: Run**

```bash
cd app
node _l2_card_gate_test.js
node _agent_test.js
node _unittest.js
```

Fix any failed asserts that encoded old「low always attach 101」behavior (update those tests to expect advice-only).

- [ ] **Step 2: Deploy** via existing `python _deploy_test_server.py` (or project SOP), restart PM2 `chunyu-doctor`.

- [ ] **Step 3: Smoke on server** (curl or script): belly pain → no weapp; medication medium → may card; `101` → card.

---

## Spec coverage check

| Spec § | Task |
|--------|------|
| 3.2 gate | Task 1 |
| 4.1 handleIncoming | Task 2 |
| 4.2 agent | Task 3 |
| 4.3 disease-consult supersede L3/L4 | Task 2 |
| §6 acceptance | Tasks 2–4 |
| L5/L6 unchanged | Task 1 opts + code_fast_path untouched |

## Placeholder scan

No TBD. Commit steps optional without git.
