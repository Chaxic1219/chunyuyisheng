# 科普提醒运营闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将科普提醒升级为任务队列式运营闭环，支持可选知识策略、统一的手工/定时生成、可追踪审核和可靠计划状态，同时继续禁止自动发群。

**Architecture:** 保留 `science_reminder_plans`、`outbound_queue` 和现有权限体系；扩展计划字段，并让手工生成与计划触发共用 `generateAiScienceDraft()`。前端在现有单页内改为“待办 / 提醒计划 / 运行记录”主从布局，不引入新依赖或通用工作流引擎。

**Tech Stack:** Node.js 20+、`node:sqlite`、Vue 3、TypeScript、Element Plus、现有 Art Design Pro 后台。

---

## 文件结构与职责

- Modify: `app/modules/community/science_reminders_schema.js` — 计划表增量字段和兼容迁移。
- Modify: `app/modules/community/science_reminders.js` — 输入校验、知识策略、统一生成、计划执行和运行状态。
- Modify: `app/routes/community-admin.js` — 异步执行、权限检查和页面数据接口。
- Modify: `app/server.js` — 分钟级异步 tick，不自动发送。
- Create: `app/_science_reminder_v2_test.js` — 使用临时 SQLite 的最小回归测试。
- Modify: `app/package.json` — 将回归测试加入 `test:unit`。
- Modify: `admin-ui/src/api/chunyu/index.ts` — 明确计划、知识和草稿类型。
- Modify: `admin-ui/src/views/chunyu/ops/science-reminders/index.vue` — 原型 3 的任务队列界面。
- Modify: `app/_run_deploy_science_ai_wizard.py` — 部署文件清单和验证命令。

当前目录没有 `.git`，所以计划不包含无法执行的提交命令；每个任务使用测试或构建结果作为检查点。

### Task 1: 建立失败测试与计划字段迁移

**Files:**
- Create: `app/_science_reminder_v2_test.js`
- Modify: `app/modules/community/science_reminders_schema.js`
- Modify: `app/package.json`

- [ ] **Step 1: 创建临时数据库回归测试骨架**

创建 `app/_science_reminder_v2_test.js`：

```js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "science-reminder-v2-"));
process.env.DB_PATH = path.join(tempRoot, "test.db");

const { db } = require("./db.js");
const science = require("./modules/community/science_reminders.js");

async function run() {
  science.ensureSchema(db);
  const columns = db.prepare("PRAGMA table_info(science_reminder_plans)").all().map((x) => x.name);
  for (const name of [
    "minute",
    "audience",
    "notes",
    "knowledge_mode",
    "knowledge_ids",
    "last_attempt_at",
    "last_error"
  ]) assert.ok(columns.includes(name), `missing column ${name}`);

  assert.equal(science.normalizeKnowledgeMode({ knowledgeMode: "none" }), "none");
  assert.equal(science.normalizeKnowledgeMode({ knowledgeMode: "auto" }), "auto");
  assert.throws(
    () => science.normalizeKnowledgeIds([1, 2, 3, 4]),
    /最多选择 3 条/
  );

  const before = new Date("2026-08-13T01:29:00.000Z"); // 北京 09:29
  const due = new Date("2026-08-13T01:30:00.000Z");
  const plan = { cadence: "daily", hour: 9, minute: 30, last_fire_key: "" };
  assert.equal(science.shouldFirePlan(plan, before), false);
  assert.equal(science.shouldFirePlan(plan, due), true);

  console.log("science reminder v2 ok");
}

run()
  .finally(() => {
    try { db.close(); } catch (_) {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
```

- [ ] **Step 2: 运行测试，确认缺少新字段和函数**

Run:

```powershell
node app/_science_reminder_v2_test.js
```

Expected: FAIL，首个错误为 `missing column minute` 或 `normalizeKnowledgeMode is not a function`。

- [ ] **Step 3: 扩展计划表并兼容旧字段**

在 `ensureSchema(db)` 的建表语句中增加：

```sql
minute INTEGER NOT NULL DEFAULT 0,
audience TEXT,
notes TEXT,
knowledge_mode TEXT NOT NULL DEFAULT 'none',
knowledge_ids TEXT NOT NULL DEFAULT '[]',
last_attempt_at TEXT,
last_error TEXT,
```

在建表后使用项目已有的 `PRAGMA table_info` 模式逐列补齐：

```js
const columns = new Set(db.prepare("PRAGMA table_info(science_reminder_plans)").all().map((x) => x.name));
const additions = [
  ["minute", "INTEGER NOT NULL DEFAULT 0"],
  ["audience", "TEXT"],
  ["notes", "TEXT"],
  ["knowledge_mode", "TEXT NOT NULL DEFAULT 'none'"],
  ["knowledge_ids", "TEXT NOT NULL DEFAULT '[]'"],
  ["last_attempt_at", "TEXT"],
  ["last_error", "TEXT"]
];
for (const [name, definition] of additions) {
  if (!columns.has(name)) db.exec(`ALTER TABLE science_reminder_plans ADD COLUMN ${name} ${definition}`);
}
db.exec(`UPDATE science_reminder_plans
  SET knowledge_mode=CASE WHEN mode='ops_candidate' THEN 'auto' ELSE COALESCE(knowledge_mode,'none') END,
      mode=CASE WHEN mode='ops_candidate' THEN 'template' ELSE mode END
  WHERE mode='ops_candidate' OR knowledge_mode IS NULL`);
```

- [ ] **Step 4: 将新测试加入单元测试命令**

把 `app/package.json` 的 `test:unit` 改为：

```json
"test:unit": "node _unittest.js && node _qiwe_business_test.js && node _science_reminder_v2_test.js"
```

- [ ] **Step 5: 再次运行测试**

Run: `node app/_science_reminder_v2_test.js`

Expected: 字段断言通过，测试继续失败在尚未实现的知识或调度函数。

### Task 2: 实现可选知识策略和统一内容生成

**Files:**
- Modify: `app/modules/community/science_reminders.js`
- Test: `app/_science_reminder_v2_test.js`

- [ ] **Step 1: 增加纯输入规范化函数**

在常量区增加：

```js
const KNOWLEDGE_MODES = new Set(["none", "selected", "auto"]);
const MODES = new Set(["ai", "template"]);

function normalizeKnowledgeMode(input) {
  const raw = String((input && input.knowledgeMode) || "none");
  if (!KNOWLEDGE_MODES.has(raw)) throw new Error("知识策略仅支持 none / selected / auto");
  return raw;
}

function normalizeKnowledgeIds(value) {
  const source = Array.isArray(value) ? value : [];
  const ids = [...new Set(source.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length > 3) throw new Error("最多选择 3 条已审核知识");
  return ids;
}
```

- [ ] **Step 2: 增加服务端知识归属验证**

```js
function resolveKnowledgeItems(doctorId, input) {
  const mode = normalizeKnowledgeMode(input);
  if (mode === "none") return { mode, items: [] };
  if (mode === "auto") {
    const items = db.prepare(`SELECT * FROM knowledge_items
      WHERE doctor_id=? AND status='ready'
      ORDER BY CASE layer WHEN '医生个人' THEN 1 WHEN '医院/科室通用' THEN 2 ELSE 3 END, id DESC
      LIMIT 3`).all(+doctorId);
    return { mode, items };
  }
  const ids = normalizeKnowledgeIds(input && input.knowledgeIds);
  if (!ids.length) throw new Error("指定引用时请选择 1–3 条已审核知识");
  const marks = ids.map(() => "?").join(",");
  const items = db.prepare(`SELECT * FROM knowledge_items
    WHERE doctor_id=? AND status='ready' AND id IN (${marks})`).all(+doctorId, ...ids);
  if (items.length !== ids.length) throw new Error("部分知识不存在、未审核或不属于当前医生");
  const byId = new Map(items.map((item) => [+item.id, item]));
  return { mode, items: ids.map((id) => byId.get(id)) };
}
```

- [ ] **Step 3: 让 AI-only 成为合法路径**

在 `generateAiScienceDraft(input)` 中以 `resolveKnowledgeItems()` 替换现有单个 `knowledgeId` 查询，并设置：

```js
const knowledge = resolveKnowledgeItems(did, input || {});
const items = knowledge.items;
const evidence = items.map((x) => ({ id: x.id, title: x.title, layer: x.layer, source: x.source || "" }));
const knowledgeSummary = items
  .map((x) => `${x.title}：${String(x.body || "").replace(/\s+/g, " ").slice(0, 120)}`)
  .join("\n")
  .slice(0, 600);
```

写入出站 payload：

```js
knowledgeMode: knowledge.mode,
evidence,
planId: Number.isInteger(Number(input && input.planId)) ? Number(input.planId) : null,
groundingLabel: knowledge.mode === "none"
  ? "AI 通用知识生成 · 无外部知识依据"
  : `引用 ${evidence.length} 条已审核知识`,
reviewerRequired: true
```

- [ ] **Step 4: 扩展计划输入和输出**

`planOut()` 增加：

```js
minute: +(row.minute || 0),
audience: row.audience || "",
notes: row.notes || "",
knowledgeMode: row.knowledge_mode || "none",
knowledgeIds: JSON.parse(row.knowledge_ids || "[]"),
lastAttemptAt: row.last_attempt_at || "",
lastError: row.last_error || ""
```

`normalizePlanInput()` 增加分钟、受众、基础信息和知识策略校验：

```js
const minute = Number(input && input.minute != null ? input.minute : (existing && existing.minute) || 0);
if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("分钟须为 0–59 整数");
const audience = String(input && input.audience != null ? input.audience : (existing && existing.audience) || "").trim().slice(0, 80);
const notes = String(input && input.notes != null ? input.notes : (existing && existing.notes) || "").trim().slice(0, 800);
const knowledgeMode = normalizeKnowledgeMode({
  knowledgeMode: input && input.knowledgeMode != null ? input.knowledgeMode : (existing && existing.knowledgeMode) || "none"
});
const knowledgeIds = normalizeKnowledgeIds(
  input && input.knowledgeIds != null ? input.knowledgeIds : (existing && existing.knowledgeIds) || []
);
if (knowledgeMode === "selected" && !knowledgeIds.length) throw new Error("指定引用时请选择知识");
```

同步扩展 `createPlan()` 的 `INSERT` 和 `updatePlan()` 的 `UPDATE`，字段和值顺序固定为：

```js
`INSERT INTO science_reminder_plans(
  doctor_id,group_id,cadence,weekday,hour,minute,topic,mode,audience,notes,
  knowledge_mode,knowledge_ids,enabled,created_at,updated_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
```

```js
`UPDATE science_reminder_plans SET
  group_id=?,cadence=?,weekday=?,hour=?,minute=?,topic=?,mode=?,audience=?,notes=?,
  knowledge_mode=?,knowledge_ids=?,enabled=?,updated_at=? WHERE id=?`
```

`knowledge_ids` 使用 `JSON.stringify(n.knowledgeIds)`；`mode` 默认 `ai`，旧 `ops_candidate` 已由 Task 1 迁移为 `template`。

- [ ] **Step 5: 补充知识策略测试**

在测试中查询一个群和医生，并验证无知识路径可以保存：

```js
const group = db.prepare("SELECT id,doctor_id FROM community_groups ORDER BY id LIMIT 1").get();
assert.ok(group);
const saved = science.createPlan({
  doctorId: group.doctor_id,
  groupId: group.id,
  cadence: "weekly",
  weekday: 5,
  hour: 9,
  minute: 30,
  topic: "术后复查为什么很重要",
  audience: "术后患者",
  notes: "强调按时复查",
  mode: "ai",
  knowledgeMode: "none",
  knowledgeIds: []
});
assert.equal(saved.knowledgeMode, "none");
assert.deepEqual(saved.knowledgeIds, []);
```

- [ ] **Step 6: 运行回归测试**

Run: `node app/_science_reminder_v2_test.js`

Expected: PASS，输出 `science reminder v2 ok`。

### Task 3: 可靠计划执行、失败状态与 API

**Files:**
- Modify: `app/modules/community/science_reminders.js`
- Modify: `app/routes/community-admin.js`
- Modify: `app/server.js`
- Test: `app/_science_reminder_v2_test.js`

- [ ] **Step 1: 实现北京时间到期判断和有限补偿**

```js
function shouldFirePlan(plan, nowDate) {
  const parts = bjParts(nowDate);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const scheduled = Number(plan.hour) * 60 + Number(plan.minute || 0);
  const key = fireKeyForPlan(plan, parts);
  if (plan.last_fire_key === key) return false;
  if (plan.cadence === "daily") return nowMinutes >= scheduled;
  if (parts.weekday < Number(plan.weekday)) return false;
  if (parts.weekday > Number(plan.weekday)) return true;
  return nowMinutes >= scheduled;
}
```

同时让 `bjParts()` 返回 `minute`。

修正周计划幂等键，使用计划星期而不是实际补偿执行日：

```js
function fireKeyForPlan(plan, parts) {
  if (plan.cadence === "daily") return parts.dateKey;
  return `${campaigns.weekIso(parts.bj)}-d${Number(plan.weekday)}`;
}
```

- [ ] **Step 2: 手工与计划统一调用 AI 生成函数**

将计划执行改为异步：

```js
async function firePlanRow(row, username) {
  const plan = planOut(row);
  if (plan.mode === "template") {
    return campaigns.createWeeklyCampaign({
      doctorId: plan.doctorId,
      groupId: plan.groupId,
      topic: plan.topic,
      outboxSource: "science_reminder",
      payloadExtra: { planId: plan.id, eventType: "science_reminder" },
      username
    });
  }
  const generated = await generateAiScienceDraft({
    doctorId: plan.doctorId,
    groupId: plan.groupId,
    topic: plan.topic,
    audience: plan.audience,
    notes: plan.notes,
    knowledgeMode: plan.knowledgeMode,
    knowledgeIds: plan.knowledgeIds,
    username,
    planId: plan.id
  });
  return generated.outbox;
}
```

- [ ] **Step 3: 持久化执行成功和失败**

```js
function markAttempt(id, error) {
  db.prepare(`UPDATE science_reminder_plans
    SET last_attempt_at=?,last_error=?,updated_at=? WHERE id=?`)
    .run(nowIso(), error ? String(error).slice(0, 500) : null, nowIso(), +id);
}
```

`runScienceReminderTick()` 改成 `async`，对每个到期计划执行：成功后 `markFired()` 和 `markAttempt(id, "")`；失败后只调用 `markAttempt(id, error.message)`，不写 `last_fire_key`，允许后续重试。

- [ ] **Step 4: 修正管理接口的异步等待**

在 `/api/admin/science-reminders/run` 路由中：

```js
const generated = await science.runScienceReminderTick(new Date(), {
  force: true,
  planId: b.planId != null ? +b.planId : null,
  username: s.username
});
```

页面数据接口继续返回 `pageBundle()`，但 `pageBundle()` 增加当前医生的 `ready` 知识：

```js
knowledgeItems: db.prepare(`SELECT id,title,layer,source,updated_at
  FROM knowledge_items WHERE doctor_id=? AND status='ready' ORDER BY id DESC`).all(did)
```

- [ ] **Step 5: 将服务定时器改为每分钟异步执行**

替换 `app/server.js` 的科普提醒定时段：

```js
if (process.env.SCIENCE_REMINDER_AUTO !== "0") {
  const tick = async () => {
    try {
      const generated = await community.scienceReminders.runScienceReminderTick(new Date());
      if (generated.length) console.log("[science-reminder] 生成", generated.length, "条");
    } catch (error) {
      console.error("[science-reminder]", error && error.message);
    }
  };
  void tick();
  setInterval(() => void tick(), 60000);
  console.log("  科普提醒计划: 已开启（每分钟检查；仅产待审草稿，绝不自动发）");
}
```

- [ ] **Step 6: 增加到期、幂等和失败重试测试**

测试至少断言：09:29 不执行；09:30 执行；相同 `last_fire_key` 不执行；生成抛错后 `last_error` 非空且 `last_fire_key` 未更新。

- [ ] **Step 7: 运行后端相关测试**

Run:

```powershell
Set-Location app
node _science_reminder_v2_test.js
npm run test:unit
```

Expected: 两条命令退出码均为 0。

### Task 4: 明确前端类型与权限

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/views/chunyu/ops/science-reminders/index.vue`

- [ ] **Step 1: 增加明确类型**

```ts
export type ScienceKnowledgeMode = 'none' | 'selected' | 'auto'

export type ScienceKnowledgeItem = {
  id: number
  title: string
  layer: string
  source?: string
  updated_at?: string
}

export type ScienceReminderDraft = {
  id: number
  groupId: number
  targetName: string
  text: string
  status: 'pending' | 'sent' | 'cancelled' | string
  source: string
  createdAt?: string
  payload?: {
    topic?: string
    knowledgeMode?: ScienceKnowledgeMode
    evidence?: Array<{ id: number; title: string; layer?: string; source?: string }>
    groundingLabel?: string
    ai?: { ok?: boolean; degraded?: boolean; model?: string; generatedAt?: string }
  }
}
```

扩展 `ScienceReminderPlan`：

```ts
minute: number
audience: string
notes: string
knowledgeMode: ScienceKnowledgeMode
knowledgeIds: number[]
lastAttemptAt?: string
lastError?: string
```

- [ ] **Step 2: 扩展页面接口类型**

```ts
return cyGet<{
  ok: boolean
  plans: ScienceReminderPlan[]
  drafts: ScienceReminderDraft[]
  groups: any[]
  knowledgeItems: ScienceKnowledgeItem[]
}>(`/api/admin/science-reminders?doctorId=${doctorId}`)
```

- [ ] **Step 3: 将操作按钮绑定实际权限**

页面计算：

```ts
const canCreate = computed(() => can('community.campaign.create'))
const canEdit = computed(() => can('community.outbox.edit'))
const canSend = computed(() => can('community.outbox.send'))
```

生成和计划按钮使用 `canCreate`，保存/取消使用 `canEdit`，推送使用 `canSend`；禁用按钮旁显示 `actions[code]?.reason`。

- [ ] **Step 4: 运行类型检查，观察下一任务前的结构性失败**

Run: `npm.cmd run build`，workdir `admin-ui`。

Expected: 如果模板仍引用旧字段则 FAIL；错误必须全部位于科普提醒页及其新类型。

### Task 5: 实现原型 3 的任务队列页面

**Files:**
- Modify: `admin-ui/src/views/chunyu/ops/science-reminders/index.vue`

- [ ] **Step 1: 将页面状态改为三个页签和主从选择**

```ts
const activeTab = ref<'todo' | 'plans' | 'history'>('todo')
const selectedDraftId = ref<number | null>(null)
const selectedDraft = computed(() =>
  drafts.value.find((item) => item.id === selectedDraftId.value) || null
)
const pendingDrafts = computed(() => drafts.value.filter((item) => item.status === 'pending'))
```

- [ ] **Step 2: 在生成表单加入知识策略**

```ts
const wizard = reactive({
  groupId: 0,
  topic: '',
  audience: '',
  notes: '',
  knowledgeMode: 'none' as ScienceKnowledgeMode,
  knowledgeIds: [] as number[]
})
```

模板使用 `ElSegmented` 或现有 `ElRadioGroup` 展示“不引用 / 指定引用 / 自动匹配”；仅 `selected` 展示多选框，并设置 `multiple-limit="3"`。

- [ ] **Step 3: 实现待办主从布局**

左侧列表显示主题、目标群、生成时间、状态和知识标签；右侧显示选中草稿的知识策略、证据、正文、安全提示及操作按钮。无选中项时显示“选择一条待审草稿”空状态。

安全提示文案按 payload 渲染：

```ts
function groundingText(draft: ScienceReminderDraft) {
  if (draft.payload?.knowledgeMode === 'none') {
    return 'AI 通用知识生成 · 无外部知识依据 · 发送前需人工医学审核'
  }
  const count = draft.payload?.evidence?.length || 0
  return `引用 ${count} 条已审核知识 · 发送前仍需人工确认`
}
```

- [ ] **Step 4: 实现提醒计划页签**

使用现有计划 CRUD，不增加新页面。列表列出主题、群、周期、下次执行、上次结果、待审数量和启停操作；下次执行由前端基于周期、星期、小时和分钟计算，不写回数据库。

- [ ] **Step 5: 实现运行记录页签**

复用返回的科普草稿，按 `pending / sent / cancelled` 和计划 `lastError` 组合展示；失败项提供“重新生成”，调用现有 `/run` 接口。

- [ ] **Step 6: 保留人工发送防线**

发送按钮继续调用现有 `chunyuCommunityOutboxSend()`；不得新增自动发送开关、发送时间字段或绕过确认框的路径。

- [ ] **Step 7: 构建前端**

Run: `npm.cmd run build`，workdir `admin-ui`。

Expected: `vue-tsc --noEmit` 和 `vite build` 均成功，产物写入 `app/public/admin-v2`。

### Task 6: 端到端验证与部署

**Files:**
- Modify: `app/_run_deploy_science_ai_wizard.py`
- Verify: `app/public/admin-v2/`

- [ ] **Step 1: 更新部署文件清单**

部署脚本 `BACKEND` 必须包含：

```python
BACKEND = [
    "modules/community/science_reminders.js",
    "modules/community/science_reminders_schema.js",
    "routes/community-admin.js",
    "server.js",
    "package.json",
    "_science_reminder_v2_test.js",
]
```

- [ ] **Step 2: 本地验证**

Run:

```powershell
Set-Location app
node _science_reminder_v2_test.js
node --check modules/community/science_reminders.js
node --check routes/community-admin.js
node --check server.js
Set-Location ..\admin-ui
npm.cmd run build
```

Expected: 所有命令退出码为 0。

- [ ] **Step 3: 部署前只读备份与目标确认**

在服务器确认应用目录为 `/var/www/chunyu-doctor-review/app`、PM2 进程名为 `chunyu-doctor`，并备份数据库及本次覆盖文件到带时间戳目录；不得覆盖其他 PM2 应用。

- [ ] **Step 4: 上传并重启单一服务**

运行项目部署脚本；只上传 `BACKEND` 和构建后的 `app/public/admin-v2`，然后执行：

```bash
pm2 restart chunyu-doctor --update-env
```

- [ ] **Step 5: 生产只读验证**

通过 SSH 运行：

```bash
cd /var/www/chunyu-doctor-review/app
node _science_reminder_v2_test.js
pm2 show chunyu-doctor
pm2 logs chunyu-doctor --lines 80 --nostream
```

Expected: 测试输出 `science reminder v2 ok`；进程为 `online`；日志出现“每分钟检查；仅产待审草稿，绝不自动发”，且无新 `science-reminder` 异常。

- [ ] **Step 6: 数据安全验收**

用生产数据库只读查询确认：已有群和知识数量未减少；升级未自动创建或发送任何草稿；原有 `outbound_queue` 状态未被批量修改。

## 最终验收

- AI-only、指定引用和自动匹配三种知识策略均可生成待审草稿。
- AI-only 草稿明确显示无外部知识依据并要求人工医学审核。
- 指定引用不能跨医生、不能引用非 `ready` 知识、最多三条。
- 手工和计划任务共用生成入口。
- 计划支持分钟、下次执行、上次错误和同周期幂等。
- 创建、编辑和发送按钮与真实权限一致。
- 所有自动任务只创建 `pending`，不存在自动发群代码路径。
