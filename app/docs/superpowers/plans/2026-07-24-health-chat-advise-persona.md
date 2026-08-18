# health_chat advise + 按医生人设 · Implementation Plan

> **For agentic workers:** 按任务顺序改；无 git 则跳过 commit。  
> **Spec:** `docs/superpowers/specs/2026-07-24-health-chat-advise-persona-design.md`

**Goal:** 澄清后输出 ≤500 字纯文本结构化建议；按需 RAG；按医生 specialty 人设；话题切换与防复读；route 提示编号。

**Architecture:** 扩展 `understand` 抽槽/身份意图 → `health_chat.resolveTurn` 相位+按需检索 → `compose_health_chat` 长建议/人设/编号 → `runtime` 写回 `adviceDelivered`。`educate` 映射为 `advise` 以兼容旧测。

**Tech Stack:** Node.js Agent（`app/agent/*`），现有 SQLite `doctors` / `knowledge_items` / `faq`。

---

### Task 1: understand — 时长口语 / 多部位 / topicKey / 身份与找医生

**Files:** `app/agent/understand.js`, `app/_health_chat_test.js`

- [x] 扩展 duration（半个小时等）、bodyPart（牙/头/胸/腰…）、`topicKey`、`isIdentityAsk`、找医生强化
- [x] 单测断言

### Task 2: health_chat — 话题重置 / 按需 RAG / 相位

**Files:** `app/agent/health_chat.js`

- [x] `needsKnowledge`、`resetClinicalSlots`、phase：`intake|advise|followup|route|identity`（`educate`→`advise` 别名输出可仍写 educate 兼容测，或测改 advise）
- [x] 仅 needsKnowledge 时 `retrieveEvidence`

### Task 3: compose — 医生人设 + 长建议 + 编号 + 防复读

**Files:** `app/agent/compose_health_chat.js`（可新建 `doctor_persona.js`）

- [x] `buildDoctorPersonaPrompt(doctorId)`
- [x] advise 软模板结构化 ≤500 无 `**`
- [x] route 含「请回复 101」；identity 含医生名科室
- [x] 与 lastAdvice 相似则短跟进

### Task 4: runtime 接线 + 测试 + 部署冒烟

**Files:** `app/agent/runtime.js`, `app/_health_chat_test.js`

- [x] 写回 adviceDelivered / lastAdviceText / topicKey
- [x] 测：话题切换、长建议、你是谁、找医生、按需 RAG
- [x] 远端部署冒烟
