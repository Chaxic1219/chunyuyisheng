# Agent 群聊沙盒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在医助后台新增 ChatGPT 布局的群聊患者模拟页，强制沙盒调用 Dialogue Agent，绝不真发企微。

**Architecture:** 新路由 `agent-sandbox-admin.js` 仅调用 `agent.runTurn` + `session.resetSession`；admin-ui 新增 `/daily/agent-sandbox` 全屏对话页，配色走 `--el-*` token。

**Tech Stack:** Node.js route 模块、Vue 3 + Element Plus（admin-ui）、现有 `agent/index.js`

**Spec:** `docs/superpowers/specs/2026-07-29-agent-sandbox-chat-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `app/routes/agent-sandbox-admin.js` | 沙盒 turn / reset API |
| `app/server.js` | 注册路由 |
| `app/_agent_sandbox_api_test.js` | 后端冒烟：有回复、不写 outbox |
| `admin-ui/src/api/chunyu/index.ts` | API 客户端 |
| `admin-ui/src/views/chunyu/agent-sandbox/index.vue` | 对话页 UI |
| `admin-ui/src/router/modules/chunyu.ts` | 菜单路由 |

---

### Task 1: 后端沙盒 API + 单测

**Files:**
- Create: `chunyu-doctor-review/app/routes/agent-sandbox-admin.js`
- Create: `chunyu-doctor-review/app/_agent_sandbox_api_test.js`
- Modify: `chunyu-doctor-review/app/server.js`（require + register）

- [ ] **Step 1: 实现路由模块**

```js
"use strict";
const agent = require("../agent/index.js");
const sessionStore = require("../agent/session.js");
const { responsesToPlainText } = require("../agent/adapter.js");

function cleanSessionId(v){
  return String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function bubblesFromReply(reply){
  const list = Array.isArray(reply && reply.responses) ? reply.responses : [];
  const texts = list
    .filter(r => r && r.type === "text" && String(r.text || "").trim())
    .map(r => String(r.text).trim().slice(0, 2000));
  return texts;
}

function patientKeyOf(adminId, doctorId, sessionId){
  return "sandbox:" + Number(adminId || 0) + ":" + Number(doctorId) + ":" + cleanSessionId(sessionId);
}

function registerAgentSandboxAdminRoutes(route, ctx){
  const { parseBody, json, gate } = ctx;

  route("POST", /^\/api\/admin\/agent\/sandbox-turn$/, async (req, res) => {
    const b = await parseBody(req);
    const doctorId = Number(b.doctorId);
    const s = gate(req, res, doctorId);
    if(!s) return;
    if(!agent.agentEnabled()){
      return json(res, 503, { error: "Dialogue Agent 未开启（DIALOGUE_AGENT_ENABLED≠1）" });
    }
    const text = String(b.text || "").trim().slice(0, 1000);
    if(!text) return json(res, 400, { error: "消息不能为空" });
    let sessionId = cleanSessionId(b.sessionId);
    if(!sessionId){
      sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    const patientKey = patientKeyOf(s.adminId, doctorId, sessionId);
    const patientName = String(b.patientName || "测试群友").trim().slice(0, 40) || "测试群友";
    try{
      const reply = await agent.runTurn({
        doctorId,
        text,
        patientKey,
        patientName,
        isGroup: true
      });
      const bubbles = bubblesFromReply(reply);
      const silent = !bubbles.length;
      json(res, 200, {
        ok: true,
        sessionId,
        bot: (reply && reply.bot) || "医助",
        bubbles,
        silent,
        // 不返回完整 agentMeta（一期产品决策）；可留 source 便于排错
        source: reply && reply.source || null
      });
    }catch(e){
      const status = e && e.status ? e.status : 500;
      json(res, status, { error: (e && e.message) || "沙盒调用失败" });
    }
  });

  route("POST", /^\/api\/admin\/agent\/sandbox-reset$/, async (req, res) => {
    const b = await parseBody(req);
    const doctorId = Number(b.doctorId);
    const s = gate(req, res, doctorId);
    if(!s) return;
    const sessionId = cleanSessionId(b.sessionId);
    if(!sessionId) return json(res, 400, { error: "缺少 sessionId" });
    const patientKey = patientKeyOf(s.adminId, doctorId, sessionId);
    sessionStore.resetSession(doctorId, patientKey);
    json(res, 200, { ok: true });
  });
}

module.exports = { registerAgentSandboxAdminRoutes, bubblesFromReply, patientKeyOf, cleanSessionId };
```

- [ ] **Step 2: 在 server.js 注册**

在其它 admin routes require 旁增加：

```js
const { registerAgentSandboxAdminRoutes } = require("./routes/agent-sandbox-admin.js");
```

在 `registerTriageAdminRoutes(...)` 之后调用：

```js
registerAgentSandboxAdminRoutes(route, { parseBody, json, gate });
```

- [ ] **Step 3: 写冒烟单测 `_agent_sandbox_api_test.js`**

覆盖：`bubblesFromReply` 抽文本；`patientKeyOf` 格式；直接 `agent.runTurn` 沙盒 key 不依赖 HTTP（与现有 `_agent_test.js` 风格一致）。另查：调用前后可用 `SELECT COUNT(*) FROM outbound_queue` 断言不变——若测试库与进程同 DB。

```js
/* 运行: node _agent_sandbox_api_test.js */
process.env.DIALOGUE_AGENT_ENABLED = "1";
process.env.AGENT_DRY_RUN = "1";
process.env.TRIAGE_AI_DISABLED = process.env.TRIAGE_AI_DISABLED || "1";

const { bubblesFromReply, patientKeyOf } = require("./routes/agent-sandbox-admin.js");
const agent = require("./agent/index.js");
const { db } = require("./db.js");

function ok(c, m){ if(!c) throw new Error(m); console.log("OK", m); }

async function main(){
  ok(bubblesFromReply({ responses:[{type:"text",text:"你好"},{type:"mp",title:"卡"}] }).length === 1, "只抽 text");
  ok(patientKeyOf(9, 1, "abc").indexOf("sandbox:9:1:abc") === 0, "patientKey");
  const doctorId = (db.prepare("SELECT id FROM doctors LIMIT 1").get() || {}).id;
  ok(!!doctorId, "有医生");
  const before = db.prepare("SELECT COUNT(*) AS c FROM outbound_queue").get().c;
  const r = await agent.runTurn({
    doctorId, text: "我想找医生", patientKey: "sandbox:0:test:unit1", patientName: "测试群友", isGroup: true
  });
  const after = db.prepare("SELECT COUNT(*) AS c FROM outbound_queue").get().c;
  ok(after === before, "runTurn 本身不写出站");
  ok(r && (r.source === "dialogue_agent" || r.source === "code_fast_path"), "有 agent 源");
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 运行单测**

```bash
cd chunyu-doctor-review/app && node _agent_sandbox_api_test.js
```

Expected: `all passed`

---

### Task 2: 前端 API + 路由菜单

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/router/modules/chunyu.ts`

- [ ] **Step 1: API**

在 `index.ts` 增加：

```ts
export type AgentSandboxTurnResult = {
  ok: boolean
  sessionId: string
  bot: string
  bubbles: string[]
  silent: boolean
  source?: string | null
}

export function chunyuAgentSandboxTurn(body: {
  doctorId: number
  text: string
  sessionId?: string
  patientName?: string
}) {
  return cyPost<AgentSandboxTurnResult>('/api/admin/agent/sandbox-turn', body)
}

export function chunyuAgentSandboxReset(body: { doctorId: number; sessionId: string }) {
  return cyPost<{ ok: boolean }>('/api/admin/agent/sandbox-reset', body)
}
```

- [ ] **Step 2: 菜单**

在 `chunyu.ts` 的 `Daily.children` 中 `triage` 后插入：

```ts
{
  path: 'agent-sandbox',
  name: 'AgentSandbox',
  component: '/chunyu/agent-sandbox/index',
  meta: { title: '群聊模拟', icon: 'ri:chat-ai-line', keepAlive: false }
}
```

---

### Task 3: 对话页 UI

**Files:**
- Create: `admin-ui/src/views/chunyu/agent-sandbox/index.vue`

- [ ] **Step 1: 实现页面**

要点：
- 布局：顶栏 pill「聊天」、医生 `ElSelect`、新对话按钮
- 空态居中「准备好了，随时开始」
- 圆角输入条 + 禁用「+」+ 发送；快捷三例
- 消息：user 右 / assistant 左；`silent` 显示「本轮未回复（群聊闲聊静默）」
- 样式仅用 `var(--el-*)` / `var(--el-color-primary*)`
- `sessionId`：`crypto.randomUUID()` 或 fallback；换医生 / 新对话重置
- 调用 `chunyuDoctors` + `chunyuAgentSandboxTurn` / `Reset`

页面结构骨架：

```vue
<script setup lang="ts">
import { computed, onMounted, ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  chunyuDoctors,
  chunyuAgentSandboxTurn,
  chunyuAgentSandboxReset,
  type ChunyuDoctor
} from '@/api/chunyu'

type Msg = { role: 'user' | 'assistant' | 'system'; text: string }

function newSessionId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

const doctors = ref<ChunyuDoctor[]>([])
const doctorId = ref<number | null>(null)
const sessionId = ref(newSessionId())
const input = ref('')
const sending = ref(false)
const messages = ref<Msg[]>([])
const listRef = ref<HTMLElement | null>(null)

const SUGGEST = [
  '我想找医生',
  '我肚子有点疼',
  '101'
]

const hasChat = computed(() => messages.value.length > 0)

async function loadDoctors() {
  doctors.value = await chunyuDoctors()
  if (!doctorId.value && doctors.value[0]) doctorId.value = doctors.value[0].id
}

async function resetChat(opts?: { keepDoctor?: boolean }) {
  if (doctorId.value && sessionId.value) {
    try { await chunyuAgentSandboxReset({ doctorId: doctorId.value, sessionId: sessionId.value }) } catch {}
  }
  sessionId.value = newSessionId()
  messages.value = []
  input.value = ''
}

async function onDoctorChange() {
  await resetChat()
}

async function sendText(raw?: string) {
  const text = String(raw ?? input.value).trim()
  if (!text || sending.value) return
  if (!doctorId.value) {
    ElMessage.warning('请先选择医生')
    return
  }
  messages.value.push({ role: 'user', text })
  input.value = ''
  sending.value = true
  try {
    const r = await chunyuAgentSandboxTurn({
      doctorId: doctorId.value,
      text,
      sessionId: sessionId.value
    })
    sessionId.value = r.sessionId || sessionId.value
    if (r.silent || !(r.bubbles && r.bubbles.length)) {
      messages.value.push({ role: 'system', text: '本轮未回复（群聊闲聊静默）' })
    } else {
      for (const t of r.bubbles) messages.value.push({ role: 'assistant', text: t })
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '发送失败')
    messages.value.push({ role: 'system', text: '调用失败：' + (e?.message || '未知错误') })
  } finally {
    sending.value = false
    await nextTick()
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: 'smooth' })
  }
}

onMounted(loadDoctors)
</script>
```

模板：全高 flex 列；空态 + 消息列表 + 底部输入区；CSS scoped 用系统变量（用户气泡 `primary` / 医助 `fill-color-light`）。

- [ ] **Step 2: 本地构建或 dev 打开菜单「群聊模拟」冒烟**

若项目用 pnpm：`cd admin-ui && pnpm build`（或既有脚本）。服务器静态若走 `app/public/admin-v2`，按现有部署习惯同步构建产物。

---

### Task 4: 验收对照 spec

- [ ] 发「我想找医生」有文字气泡  
- [ ] 闲聊有静默提示  
- [ ] 操作后 `outbound_queue` 不增（可用 Task1 单测 + 手工）  
- [ ] 亮色主题下对比度可读；暗色跟随 `--el-*`  

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| sandbox-turn / reset | 1 |
| 强制不写出站 | 1（API 无 enqueue + 单测） |
| 页面内选医生 | 3 |
| ChatGPT 布局 + 系统色 | 3 |
| 仅气泡无 meta | 1+3 |
| 菜单挂日常工作 | 2 |
| 新对话 / 换医生隔离 | 3 |

## 提交策略

本仓库惯例：除非主人要求，否则不自动 git commit。实现完成后口头汇报，由主人决定是否提交。
