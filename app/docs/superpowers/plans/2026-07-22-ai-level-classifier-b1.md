# AI Level Classifier (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace keyword-heavy tier inference with **local safety floor + AI level classifier**, while keeping L1–L6 labels/meanings and existing reply/card policies (L2/L5 cards only; L3/L4 advice auto-send; L1 safety; L6 silent).

**Architecture:** Add `assessLevelLLM()` (lightweight JSON classifier) behind env `AI_LEVEL_CLASSIFIER=1` (default off). Pipeline: `group_gate` → floor `scanRisk` → optional AI level → `mergeLevelDecision()` (rank never below floor) → existing `classifyLevel` display + agent/triage reply paths. Reuse `modelConfig`, `TRIAGE_AI_DISABLED`, `TRIAGE_AI_TIMEOUT_MS` from `triage.js` (same supplier as risk net / low-risk reply).

**Tech Stack:** Node.js, `triage.js`, `agent/runtime.js`, `message_log.js`, `_ai_level_test.js`, deploy via `_deploy_test_server.py`.

**Spec:** `docs/superpowers/specs/2026-07-22-ai-level-classifier-b1-design.md`

**Prerequisite (done):** Step A gate fix — symptom self-report passes gate (`symptom_sentinel`, body+discomfort in `isDiseaseConsultAsk`).

**Note:** Workspace may have no git — skip commits if unavailable.

---

## File map

| File | Responsibility |
|------|----------------|
| `app/triage.js` | `assessLevelLLM`, `mergeLevelDecision`, `resolveMessageLevel`, wire into `handleIncoming` |
| `app/agent/runtime.js` | Use `resolveMessageLevel` before `plan()` instead of raw `classifyLevel(scan-only)` |
| `app/message_log.js` | Log/store same level opts as outbound (avoid UI showing L6 while sent L3) |
| `app/_ai_level_test.js` | Classifier + merge + acceptance table tests |
| `app/_agent_test.js` | E2E: belly pain / medication / chitchat with classifier mocked or env on |
| `app/docs/superpowers/specs/2026-07-22-ai-level-classifier-b1-design.md` | Update status → approved |

---

### Task 1: Level merge primitives + tests

**Files:**
- Create: `app/_ai_level_test.js`
- Modify: `app/triage.js`

- [ ] **Step 1: Write failing tests**

```js
// app/_ai_level_test.js
const assert = require("assert");
const triage = require("./triage.js");

function ok(c,m){ assert.ok(c,m); console.log("  OK",m); }

console.log("== mergeLevelDecision ==");
ok(typeof triage.mergeLevelDecision === "function", "exports mergeLevelDecision");

const floorHigh = { riskLevel:"high", emergency:true, triggers:["胸痛"] };
const aiLow = { riskLevel:"low", needsDoctor:false, level:4, source:"ai" };
const mergedH = triage.mergeLevelDecision(floorHigh, aiLow);
ok(mergedH.riskLevel === "high", "floor high blocks AI downgrade");

const floorLow = { riskLevel:"low", sentinel:true, triggers:["常见健康咨询/科普引导"] };
const aiMed = { riskLevel:"medium", needsDoctor:false, level:3, source:"ai" };
const mergedM = triage.mergeLevelDecision(floorLow, aiMed);
ok(mergedM.riskLevel === "medium", "AI can raise low→medium");

const floorMed = { riskLevel:"medium", triggers:["用药处方"] };
const aiL4 = { riskLevel:"low", needsDoctor:false, level:4, source:"ai" };
const mergedNoDown = triage.mergeLevelDecision(floorMed, aiL4);
ok(mergedNoDown.riskLevel === "medium", "AI cannot downgrade medium→low");

console.log("== resolveMessageLevel fallback ==");
ok(typeof triage.resolveMessageLevel === "function", "exports resolveMessageLevel");
const r = triage.resolveMessageLevel("我肚子有点疼", 1, { aiLevel:null });
ok(r.levelInfo.level === 3 || r.levelInfo.level === 4, "fallback classify belly pain L3/L4");
ok(r.source === "local" || r.source === "floor", "null ai → local/floor source");

console.log("ALL PASS");
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd app && node _ai_level_test.js
```

- [ ] **Step 3: Implement in `triage.js`**

```js
const LEVEL_RANK = { 6:0, 4:1, 3:2, 2:3, 1:4, 5:1 }; // L5 handled separately (code path)

function mergeLevelDecision(floor, ai){
  floor = floor || {};
  if(!ai || ai.source !== "ai") return { ...floor, levelSource:"floor" };
  const floorRank = rankMax(floor.riskLevel, null); // reuse existing RISK_RANK
  const aiRank = rankMax(ai.riskLevel, null);
  const riskLevel = aiRank > floorRank ? ai.riskLevel : floor.riskLevel;
  const needsDoctor = needsDoctorFromTriggers(floor.triggers) || !!ai.needsDoctor;
  const levelInfo = classifyLevel("", null, {
    riskLevel,
    needsDoctor,
    needsHuman: riskLevel !== "low",
    emergency: !!floor.emergency,
    sentinel: !!floor.sentinel,
    riskTriggers: floor.triggers || []
  });
  return {
    riskLevel,
    needsDoctor,
    needsHuman: riskLevel !== "low",
    emergency: !!floor.emergency,
    sentinel: !!floor.sentinel,
    triggers: floor.triggers || [],
    level: levelInfo.level,
    levelLabel: levelInfo.label,
    levelSource:"merged",
    aiReason: ai.reason || ""
  };
}

function resolveMessageLevel(text, doctorId, opts){
  opts = opts || {};
  const floor = scanRisk(text, doctorId);
  if(floor.riskLevel === "high"){
    const li = classifyLevel(text, doctorId, { riskLevel:"high", emergency:!!floor.emergency, riskTriggers:floor.triggers });
    return { floor, ai:null, merged:{ ...floor, level:li.level, levelLabel:li.label, levelSource:"floor" }, levelInfo:li, source:"floor" };
  }
  const ai = opts.aiLevel; // precomputed or null
  const merged = mergeLevelDecision(floor, ai);
  const levelInfo = classifyLevel(text, doctorId, {
    riskLevel: merged.riskLevel,
    needsDoctor: merged.needsDoctor,
    needsHuman: merged.needsHuman,
    emergency: merged.emergency,
    sentinel: merged.sentinel,
    riskTriggers: merged.triggers
  });
  return { floor, ai, merged, levelInfo, source: ai ? "merged" : "local" };
}
```

Export `mergeLevelDecision`, `resolveMessageLevel`.

- [ ] **Step 4: Re-run — ALL PASS**

---

### Task 2: `assessLevelLLM` + env gate

**Files:**
- Modify: `app/triage.js`
- Modify: `app/_ai_level_test.js`

- [ ] **Step 1: Env helper**

```js
function aiLevelClassifierEnabled(){
  return process.env.AI_LEVEL_CLASSIFIER === "1";
}
```

- [ ] **Step 2: Implement `assessLevelLLM(text, ctx)`** (pattern copy from `assessRiskLLM` ~1324)

System prompt (concise):
- Output ONLY JSON: `{ "riskLevel":"low|medium|high", "needsDoctor":boolean, "reason":"≤80字" }`
- Map semantics: high=急症/L1; medium+needsDoctor=true → L2; medium+needsDoctor=false → L3; low → L4
- No patient-facing text, no diagnosis/prescription
- If uncertain → medium, needsDoctor=false

Parse with existing `parseJsonObject` / `coerceRiskAssessment` patterns; invalid → `null`.

- [ ] **Step 3: Tests with mock** — when `TRIAGE_AI_DISABLED=1`, `assessLevelLLM` returns null (document in test). Optional: stub fetch in test file for one happy path.

- [ ] **Step 4: Wire `resolveMessageLevel` async variant**

```js
async function resolveMessageLevelAsync(text, doctorId, ctx){
  const floor = scanRisk(text, doctorId);
  if(floor.riskLevel === "high") return resolveMessageLevel(text, doctorId, { aiLevel:null });
  let aiLevel = null;
  if(aiLevelClassifierEnabled()){
    const raw = await assessLevelLLM(text, ctx);
    if(raw) aiLevel = { ...raw, source:"ai", level:null };
  }
  return resolveMessageLevel(text, doctorId, { aiLevel });
}
```

Export async helper.

---

### Task 3: Integrate handleIncoming + agent runtime

**Files:**
- Modify: `app/triage.js` (`handleIncoming` after floor/combineRisk)
- Modify: `app/agent/runtime.js`
- Modify: `app/message_log.js` (if logs level separately)

- [ ] **Step 1: `handleIncoming`** — when `AI_LEVEL_CLASSIFIER=1` and floor≠high:
  - Call `assessLevelLLM` **after** existing `assessRiskLLM` OR **replace** risk-net merge for level display only (keep `combineRisk` for safety; level display uses `mergeLevelDecision(floor, aiLevel)`).
  - Pass merged `riskLevel`/`needsDoctor` into medium/low branches (already use `classifyLevel`).
  - Store `levelSource` / `aiReason` in `decision.reasoningSummary` for audit.

- [ ] **Step 2: `agent/runtime.js`** — replace direct `classifyLevel(text, doctorId, { riskLevel: clinical...})` with:

```js
const resolved = await triage.resolveMessageLevelAsync(text, doctorId, { doctor: ctx });
const levelInfo = resolved.levelInfo;
```

Keep `needsDoctor` from merged result.

- [ ] **Step 3: `message_log.js`** — pass `riskLevel`, `needsDoctor`, `sentinel` from outbound triage/agent reply so inbox level matches send path.

- [ ] **Step 4: Tests** — extend `_agent_test.js`:
  - With `AI_LEVEL_CLASSIFIER=0`: behavior unchanged (regression)
  - Mock/stub: AI returns medium for belly → L3, `reply_advice`, no mp

---

### Task 4: Acceptance table + deploy

**Files:** `_ai_level_test.js`, `_agent_test.js`, `_qiwe_business_test.js`

- [ ] **Step 1: Add acceptance asserts** (spec §4 table) — local floor paths without live LLM where possible:

| Input | Assert |
|-------|--------|
| 我肚子有点疼 | gate ok; level 3 or 4; !canAttachMiniProgram |
| 这个药还能继续吃吗 | level 2; canAttach true |
| 胸痛喘不上气 | level 1; !canAttach |
| 今天天气真好 | gate chitchat |

- [ ] **Step 2: Run suite**

```bash
node _ai_level_test.js
node _agent_test.js
node _qiwe_business_test.js
```

- [ ] **Step 3: Deploy with env doc**

Add to server env (default off until validated):

```
AI_LEVEL_CLASSIFIER=0   # set 1 on test server after smoke
```

```bash
python _deploy_test_server.py
```

- [ ] **Step 4: Smoke on server** — enable `AI_LEVEL_CLASSIFIER=1` in `/etc/chunyu-doctor.env`, restart PM2, send belly pain phrase.

- [ ] **Step 5: Update spec status** → `已确认 / 已实现`

---

## Spec coverage

| Spec § | Task |
|--------|------|
| 3.1 gate | Done (Step A) |
| 3.2 AI classifier | Task 2 |
| 3.3 module wiring | Task 3 |
| 3 merge / floor | Task 1 |
| §4 acceptance | Task 4 |
| §5 phased rollout | Task 4 env default off |

## Open decision (locked for plan)

**Reuse existing LLM supplier** (`modelConfig`, same timeout/disable flags) with a **separate lightweight prompt** (`assessLevelLLM`). Do not add a second API vendor in v1.

## Self-review

- No placeholder steps.
- Default-off env preserves production until smoke.
- Floor high never calls AI (spec constraint).
- L1–L6 labels unchanged; only inference path changes.
