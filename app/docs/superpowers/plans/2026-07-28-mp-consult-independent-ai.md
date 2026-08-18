# 小程序咨询独立 AI 对话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小程序咨询页改走独立 `/api/mp/ai-chat`（仿静态项目 aiProxy 内核），并加垃圾桶清空上下文；不进分诊、不调 `/api/message`。

**Architecture:** 新建 `modules/mpAi`（prompt + OpenAI 兼容 client + chat 门面）与 `routes/mp-ai.js`；前端 `api/aiChat.ts` + 咨询页改存储 key / sessionId / 清空按钮。

**Tech Stack:** Node（内置 fetch）、SQLite 只读医生名、UniApp Vue3

**Spec:** `app/docs/superpowers/specs/2026-07-28-mp-consult-independent-ai-design.md`

---

### File map

| 文件 | 职责 |
|------|------|
| `app/modules/mpAi/prompt.js` | system prompt |
| `app/modules/mpAi/client.js` | chat completions HTTP |
| `app/modules/mpAi/index.js` | `chat()` 门面 |
| `app/routes/mp-ai.js` | `POST /api/mp/ai-chat` |
| `app/server.js` | 注册路由 |
| `app/_mp_ai_test.js` | 单测 |
| `patient-uniapp/src/api/aiChat.ts` | 前端客户端 |
| `patient-uniapp/src/utils/mpAiSession.ts` | sessionId / history key |
| `patient-uniapp/src/pages/consult/index.vue` | UI + 换 API |

---

### Task 1: mpAi prompt + client + chat + 测试

**Files:**
- Create: `app/modules/mpAi/prompt.js`
- Create: `app/modules/mpAi/client.js`
- Create: `app/modules/mpAi/index.js`
- Create: `app/_mp_ai_test.js`

- [x] **Step 1: 写失败测试 `_mp_ai_test.js`**
- [x] **Step 2: 实现 prompt.js / client.js / index.js**
- [x] **Step 3: 跑通 `node _mp_ai_test.js`**

---

### Task 2: 注册路由

**Files:**
- Create: `app/routes/mp-ai.js`
- Modify: `app/server.js`（require + `registerMpAiRoutes` 紧挨 mp-auth）

- [x] **Step 1: 实现 `registerMpAiRoutes`：校验 text/doctorId，调 `mpAi.chat`，映射 400/404/502/503**
- [x] **Step 2: 在 `_mp_ai_test.js` 增加路由级 smoke（直接调 register 或 chat 门面已够则可跳过 HTTP）**

---

### Task 3: 前端 aiChat + session 工具

**Files:**
- Create: `patient-uniapp/src/api/aiChat.ts`
- Create: `patient-uniapp/src/utils/mpAiSession.ts`

- [x] **Step 1: `mpAiSession.ts` — HISTORY_KEY=`mpAiChatHistory`，SESSION_KEY=`mpAiSessionId`，ensureSessionId / clearSession**
- [x] **Step 2: `aiChat.ts` — `postMpAiChat` → `POST /api/mp/ai-chat`，带可选 Bearer**

---

### Task 4: 改造咨询页

**Files:**
- Modify: `patient-uniapp/src/pages/consult/index.vue`

- [x] **Step 1: 顶栏加「清空」按钮（文字即可，无需新图标资源）**
- [x] **Step 2: 改用 `postMpAiChat`；独立 history key；去掉 `sendMessage` / stripMpBoilerplate 对旧链路依赖**
- [x] **Step 3: 仅附图无字时 toast「当前仅支持文字」**
- [x] **Step 4: clearChat 确认框 + 重置欢迎语**

---

### Task 5: 验证

- [x] **Step 1: `node _mp_ai_test.js` 全绿**
- [x] **Step 2: 确认 `consult/index.vue` 无 `/api/message` / `sendMessage` 引用**

**Note:** 不自动 git commit（除非主人要求）。
