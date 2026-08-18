# 患者端小程序 · V3.2 第一期自主健康闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 ColorUI 三 Tab 壳上，落地真实 `/api/mp/v32`（档案确认 → 计划生成 → 今日任务回写 → 动态首页），去掉静默 mock 回退，并对齐青绿视觉与出图资产接入。

**Architecture:** `app` 新增 `modules/mpV32`（仓储 + 计划生成 + Feed 组装）与 `routes/mp-v32.js`；身份锚定 `mp_auth` 的 `person_id`；复用 `patient_health_records` / archive / `mpAi`。小程序 `api/v32.ts` 失败即错误态；咨询传 `assistantRole` 增强人设。

**Tech Stack:** Node + better-sqlite3（`app/`）；uni-app + Pinia + ColorUI（`patient-uniapp/`）；契约测试 `node:test`。

**Spec:** `app/docs/superpowers/specs/2026-07-30-patient-mp-v32-phase1-design.md`

**Note:** `chunyu-doctor-review` 当前可能不是 git 仓库。凡 Commit 步骤：若 `git status` 可用则提交；否则跳过并继续。

**并行：** 出图包已在桌面 `chunyu-patient-mp-v32-image-gen-pack.zip`；Task 11 在图回填后执行，不阻塞 Task 1–10。

---

## File map

| File | Responsibility |
|------|----------------|
| `app/db.js` | 新增 V32 表（plans / items / tasks / metrics / family / dismissals / confirmations） |
| `app/modules/mpV32/schema.js` | 表 DDL 常量（可选，或直接写在 db.js） |
| `app/modules/mpV32/repo.js` | CRUD：计划、任务、家属、关闭推荐 |
| `app/modules/mpV32/planGenerator.js` | 从档案/健康记录模板生成草稿计划 |
| `app/modules/mpV32/feed.js` | 组装 home-feed / mine-assets / records / current plan |
| `app/modules/mpV32/index.js` | 对外 API |
| `app/modules/mpV32/servicesCatalog.js` | 只读服务商品种子 |
| `app/routes/mp-v32.js` | HTTP 路由注册 |
| `app/server.js` | `registerMpV32Routes` |
| `app/modules/mpAi/prompt.js` | 按 assistantRole 切换人设 |
| `app/modules/mpAi/index.js` | 接收 assistantRole / pageContext |
| `app/_mp_v32_test.js` | 后端冒烟单测 |
| `patient-uniapp/src/api/v32.ts` | 去静默 mock；补 POST 方法 |
| `patient-uniapp/src/api/config.ts` | `V32_ALLOW_MOCK_FALLBACK` 默认 false |
| `patient-uniapp/src/types/v32.ts` | 可空 plan、错误契约字段 |
| `patient-uniapp/src/stores/*.ts` | 错误态与写操作 |
| `patient-uniapp/src/pages/index/index.vue` | HOME-001/002；错误重试 |
| `patient-uniapp/src/pages/plans/detail.vue` | 完成任务调用真实 API |
| `patient-uniapp/src/pages/records/index.vue` | 确认 + 生成计划 |
| `patient-uniapp/src/pages/consult/index.vue` | 传 assistantRole |
| `patient-uniapp/src/pages.json` | Tab 选中色青绿 |
| `packages/patient-design/tokens.css` | primary 对齐 `#176b52`（若团队同意覆盖旧蓝） |
| `patient-uniapp/tests/ui-contract.test.mjs` | 禁止静默 mock；青绿 Tab |
| `patient-uniapp/src/constants/v32Assets.ts` | 新插图路径 |

**非范围：** 支付、Pro 接管、复杂家属 ACL、新 OCR 引擎、运营后台工作台。

---

### Task 1: 数据库表

**Files:**
- Modify: `app/db.js`（在 `patient_health_records` 相关段落后追加）

- [ ] **Step 1: 写入失败测试脚本骨架（先断言表不存在或空查询）**

Create: `app/_mp_v32_test.js` 开头仅探测：

```javascript
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpv32-"));
  process.env.DB_PATH = path.join(dir, "test.db"); // 若项目用其它环境变量，改为实际变量名
  // 后续 Task 加载 db 后检查表
  console.log("scaffold ok", dir);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

先确认项目 SQLite 路径环境变量（搜 `better-sqlite3` / `DB_PATH` / `data.db`），与现有 `_mp_archive_replies_test.js` 对齐。

- [ ] **Step 2: 在 `db.js` 追加表**

```javascript
db.exec(`CREATE TABLE IF NOT EXISTS health_plans(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'self',
  status TEXT NOT NULL DEFAULT 'draft',
  source_json TEXT,
  doctor_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_health_plans_person ON health_plans(person_id, status, updated_at)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_plan_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  schedule_json TEXT,
  meta_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(plan_id) REFERENCES health_plans(id) ON DELETE CASCADE
)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_task_instances(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  item_id INTEGER,
  person_id INTEGER NOT NULL,
  task_date TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(person_id, plan_id, task_date, title)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_health_tasks_day ON health_task_instances(person_id, task_date, status)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_metric_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  task_id INTEGER,
  metric_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_family_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  relation TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'helper',
  created_at TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_feed_dismissals(
  person_id INTEGER NOT NULL,
  card_key TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY(person_id, card_key)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS health_record_confirmations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  payload_json TEXT,
  confirmed_at TEXT NOT NULL,
  UNIQUE(person_id, source_key)
)`);
```

- [ ] **Step 3: 启动一次服务或 `node -e "require('./db.js')"` 确认无语法错误**

Run（在 `app/`）:

```bash
node -e "require('./db.js'); console.log('db ok')"
```

Expected: `db ok`

- [ ] **Step 4: Commit（若有 git）**

```bash
git add app/db.js app/_mp_v32_test.js
git commit -m "feat(mp-v32): add health plan and task tables"
```

---

### Task 2: mpV32 仓储与计划生成

**Files:**
- Create: `app/modules/mpV32/repo.js`
- Create: `app/modules/mpV32/planGenerator.js`
- Create: `app/modules/mpV32/servicesCatalog.js`
- Create: `app/modules/mpV32/feed.js`
- Create: `app/modules/mpV32/index.js`

- [ ] **Step 1: 实现 `repo.js` 核心函数**

```javascript
"use strict";

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function createRepo(db) {
  function getActivePlan(personId) {
    return db
      .prepare(
        `SELECT * FROM health_plans WHERE person_id=? AND status IN ('active','paused')
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`
      )
      .get(personId);
  }

  function getPlanItems(planId) {
    return db
      .prepare(`SELECT * FROM health_plan_items WHERE plan_id=? ORDER BY sort_order, id`)
      .all(planId);
  }

  function ensureTodayTasks(personId, plan) {
    if (!plan || plan.status !== "active") return [];
    const day = todayLocal();
    const items = getPlanItems(plan.id);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO health_task_instances
       (plan_id, item_id, person_id, task_date, title, kind, status, payload_json, created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?)`
    );
    for (const it of items) {
      ins.run(
        plan.id,
        it.id,
        personId,
        day,
        it.title,
        it.kind,
        it.meta_json || "{}",
        nowIso()
      );
    }
    return db
      .prepare(
        `SELECT * FROM health_task_instances WHERE person_id=? AND plan_id=? AND task_date=?
         ORDER BY id`
      )
      .all(personId, plan.id, day);
  }

  function completeTask(personId, taskId, payload) {
    const row = db
      .prepare(`SELECT * FROM health_task_instances WHERE id=? AND person_id=?`)
      .get(taskId, personId);
    if (!row) {
      const err = new Error("task_not_found");
      err.code = "not_found";
      throw err;
    }
    if (row.status === "done") return row;
    db.prepare(
      `UPDATE health_task_instances SET status='done', completed_at=?, payload_json=? WHERE id=?`
    ).run(nowIso(), JSON.stringify(payload || {}), taskId);
    if (payload && payload.metricKey) {
      db.prepare(
        `INSERT INTO health_metric_logs(person_id, task_id, metric_key, value_json, recorded_at)
         VALUES (?,?,?,?,?)`
      ).run(
        personId,
        taskId,
        String(payload.metricKey),
        JSON.stringify(payload.value != null ? payload.value : payload),
        nowIso()
      );
    }
    return db.prepare(`SELECT * FROM health_task_instances WHERE id=?`).get(taskId);
  }

  function insertPlanWithItems(personId, { title, mode, source, items, doctorId }) {
    const ts = nowIso();
    const info = db
      .prepare(
        `INSERT INTO health_plans(person_id, title, mode, status, source_json, doctor_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        personId,
        title,
        mode || "self",
        "draft",
        JSON.stringify(source || {}),
        doctorId || null,
        ts,
        ts
      );
    const planId = info.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO health_plan_items(plan_id, kind, title, schedule_json, meta_json, sort_order)
       VALUES (?,?,?,?,?,?)`
    );
    (items || []).forEach((it, idx) => {
      insItem.run(
        planId,
        it.kind,
        it.title,
        JSON.stringify(it.schedule || {}),
        JSON.stringify(it.meta || {}),
        idx
      );
    });
    return db.prepare(`SELECT * FROM health_plans WHERE id=?`).get(planId);
  }

  function setPlanStatus(personId, planId, status) {
    const row = db
      .prepare(`SELECT * FROM health_plans WHERE id=? AND person_id=?`)
      .get(planId, personId);
    if (!row) {
      const err = new Error("plan_not_found");
      err.code = "not_found";
      throw err;
    }
    db.prepare(`UPDATE health_plans SET status=?, updated_at=? WHERE id=?`).run(
      status,
      nowIso(),
      planId
    );
    return db.prepare(`SELECT * FROM health_plans WHERE id=?`).get(planId);
  }

  function listConfirmations(personId) {
    return db
      .prepare(`SELECT * FROM health_record_confirmations WHERE person_id=?`)
      .all(personId);
  }

  function upsertConfirmation(personId, sourceKey, payload) {
    const ts = nowIso();
    db.prepare(
      `INSERT INTO health_record_confirmations(person_id, source_key, status, payload_json, confirmed_at)
       VALUES (?,?, 'confirmed', ?, ?)
       ON CONFLICT(person_id, source_key) DO UPDATE SET
         status='confirmed', payload_json=excluded.payload_json, confirmed_at=excluded.confirmed_at`
    ).run(personId, sourceKey, JSON.stringify(payload || {}), ts);
    return listConfirmations(personId);
  }

  function listFamily(personId) {
    return db
      .prepare(`SELECT * FROM health_family_members WHERE person_id=? ORDER BY id`)
      .all(personId);
  }

  function addFamily(personId, { name, relation, phone, role }) {
    const info = db
      .prepare(
        `INSERT INTO health_family_members(person_id, name, relation, phone, role, created_at)
         VALUES (?,?,?,?,?,?)`
      )
      .run(
        personId,
        String(name || "").trim() || "家属",
        relation || "",
        phone || "",
        role || "helper",
        nowIso()
      );
    return db.prepare(`SELECT * FROM health_family_members WHERE id=?`).get(info.lastInsertRowid);
  }

  return {
    todayLocal,
    getActivePlan,
    getPlanItems,
    ensureTodayTasks,
    completeTask,
    insertPlanWithItems,
    setPlanStatus,
    listConfirmations,
    upsertConfirmation,
    listFamily,
    addFamily,
  };
}

module.exports = { createRepo, todayLocal, nowIso };
```

- [ ] **Step 2: 实现 `planGenerator.js`**

```javascript
"use strict";

/**
 * 基于已确认项 + 健康记录摘要生成草稿。
 * 信息不足时返回 { ok:false, reason, missing }。
 */
function generatePlanDraft({ confirmations, healthRecords, profile }) {
  const items = [];
  const confirmed = Array.isArray(confirmations) ? confirmations : [];
  const records = Array.isArray(healthRecords) ? healthRecords : [];

  const medConfirmed = confirmed.find((c) => /med|用药|处方/i.test(c.source_key));
  const metricConfirmed = confirmed.find((c) => /metric|血压|血糖|指标/i.test(c.source_key));
  const followConfirmed = confirmed.find((c) => /follow|复诊|复查/i.test(c.source_key));

  if (medConfirmed) {
    const title =
      (medConfirmed.payload && medConfirmed.payload.title) || "按医嘱服药并打卡";
    items.push({ kind: "medication", title, meta: medConfirmed.payload || {} });
  }
  if (metricConfirmed || records.some((r) => /血压|血糖|metric/i.test(String(r.category || r.title || "")))) {
    items.push({
      kind: "metric",
      title: "记录今日血压或关键指标",
      meta: { metricKey: "bp" },
    });
  }
  if (followConfirmed) {
    items.push({
      kind: "followup",
      title: "确认复诊安排",
      meta: followConfirmed.payload || {},
    });
  }

  // 无确认时：若有任意健康记录，仍可生成「回顾记录」弱计划；否则失败
  if (!items.length && records.length) {
    items.push({
      kind: "review",
      title: "回顾已有健康记录并补充用药信息",
      meta: { recordCount: records.length },
    });
  }

  if (!items.length) {
    return {
      ok: false,
      reason: "档案信息不足，请先确认用药、指标或复诊信息",
      missing: ["medication_or_metric_or_followup"],
    };
  }

  const name = (profile && (profile.name || profile.displayName)) || "我的";
  return {
    ok: true,
    title: `${name}的健康计划`.replace(/^我的的/, "我的"),
    mode: "self",
    items,
    source: {
      confirmationIds: confirmed.map((c) => c.id || c.source_key),
      recordCount: records.length,
    },
  };
}

module.exports = { generatePlanDraft };
```

- [ ] **Step 3: 实现 `servicesCatalog.js`（静态只读，非前端硬编码）**

```javascript
"use strict";

const PRODUCTS = [
  {
    key: "copilot",
    icon: "shield",
    tone: "green",
    title: "医生共管 Pro",
    desc: "计划审核和异常处理支持（本期仅展示）",
    action: "了解详情",
    toast: "共管服务即将开放购买",
  },
  {
    key: "followup",
    icon: "calendar",
    tone: "amber",
    title: "复诊协助",
    desc: "准备资料并协助预约",
    action: "去咨询生活管家",
    toast: "",
  },
];

function getServiceCenter() {
  return {
    current: {
      title: "暂无进行中的付费服务",
      desc: "需要时可通过咨询了解服务包；本期不支持在线支付。",
      action: "去咨询",
      visual: "/static/visual/health-plan-service-hero.png",
    },
    categories: [
      { key: "plan", icon: "health", label: "健康计划" },
      { key: "med", icon: "health", label: "用药支持" },
      { key: "appoint", icon: "calendar", label: "复诊协助", consult: true },
    ],
    products: PRODUCTS,
  };
}

module.exports = { getServiceCenter, PRODUCTS };
```

- [ ] **Step 4: 实现 `feed.js` 组装 home-feed / mine-assets / records / plan detail**

按现有前端 `types/v32.ts` 字段名组装。关键规则：

- 无 active 计划：`plan` 可为 `null`，同时 `hero` 走 unsigned 文案；或返回空计划对象且 `completionPercent: 0` 并设 `mode: "none"`——**选定：`plan: null`，前端兼容**。
- `pendingRecord`：无待确认则 `null`。
- `serviceProgress`：一期恒 `null`（无合同）。
- `recommendations`：过滤 `health_feed_dismissals`。

在 `feed.js` 导出：

```javascript
function buildHomeFeed(ctx) { /* ... */ }
function buildMineAssets(ctx) { /* ... */ }
function buildRecordList(ctx) { /* ... */ }
function buildPlanDetail(ctx) { /* ... */ }
function buildFamilyData(ctx) { /* ... */ }
```

`ctx` 含：`repo` 结果、profile 摘要、healthRecords、confirmations。

首页 `plan` 为 null 时前端类型需改为 `HomePlanSummary | null`（Task 5）。

- [ ] **Step 5: `index.js` 门面**

```javascript
"use strict";
const { createRepo } = require("./repo.js");
const { generatePlanDraft } = require("./planGenerator.js");
const { getServiceCenter } = require("./servicesCatalog.js");
const feed = require("./feed.js");

function createMpV32(db, deps) {
  const repo = createRepo(db);
  return {
    repo,
    generatePlanDraft,
    getServiceCenter,
    buildHomeFeed: (ctx) => feed.buildHomeFeed({ ...ctx, repo }),
    buildMineAssets: (ctx) => feed.buildMineAssets({ ...ctx, repo }),
    buildRecordList: (ctx) => feed.buildRecordList({ ...ctx, repo }),
    buildPlanDetail: (ctx) => feed.buildPlanDetail({ ...ctx, repo }),
    buildFamilyData: (ctx) => feed.buildFamilyData({ ...ctx, repo }),
  };
}

module.exports = { createMpV32 };
```

- [ ] **Step 6: Commit（若有 git）**

```bash
git add app/modules/mpV32
git commit -m "feat(mp-v32): add plan generator and feed builders"
```

---

### Task 3: HTTP 路由 `/api/mp/v32`

**Files:**
- Create: `app/routes/mp-v32.js`
- Modify: `app/server.js`

- [ ] **Step 1: 实现路由文件**

```javascript
"use strict";
const mpAuth = require("../mp_auth.js");
const { bearerToken } = require("./mp-auth.js");
const { createMpV32 } = require("../modules/mpV32");

function registerMpV32Routes(route, ctx) {
  const { parseBody, json, MESSAGE_MAX_BODY, db, profileStore, patientProfile } = ctx;
  const mpV32 = createMpV32(db, { profileStore, patientProfile });

  function requirePerson(req, res) {
    const token = bearerToken(req);
    if (!token) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
    try {
      const sess = mpAuth.requireSession(token);
      if (!sess.phone_bound || !sess.person_id) {
        json(res, 401, { error: "请先绑定手机号" });
        return null;
      }
      return sess;
    } catch (e) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
  }

  function loadHealthRecords(personId) {
    try {
      return db
        .prepare(
          `SELECT * FROM patient_health_records WHERE person_id=? ORDER BY id DESC LIMIT 100`
        )
        .all(personId);
    } catch (e) {
      return [];
    }
  }

  function loadProfile(personId) {
    // 与 GET /api/mp/archive 同源：优先 profileStore；失败则 { name:"" }
    try {
      if (patientProfile && profileStore) {
        // 按现有 archive 实现取 displayName；此处保持薄封装
      }
    } catch (e) {}
    const person = db.prepare(`SELECT * FROM persons WHERE id=?`).get(personId);
    return { name: (person && (person.name || person.display_name)) || "" };
  }

  route("GET", /^\/api\/mp\/v32\/home-feed$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    const plan = mpV32.repo.getActivePlan(personId);
    const tasks = plan ? mpV32.repo.ensureTodayTasks(personId, plan) : [];
    const data = mpV32.buildHomeFeed({
      personId,
      profile: loadProfile(personId),
      plan,
      tasks,
      confirmations: mpV32.repo.listConfirmations(personId),
      healthRecords: loadHealthRecords(personId),
    });
    json(res, 200, { data });
  });

  route("GET", /^\/api\/mp\/v32\/mine-assets$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    json(res, 200, {
      data: mpV32.buildMineAssets({
        personId,
        plan: mpV32.repo.getActivePlan(personId),
        confirmations: mpV32.repo.listConfirmations(personId),
        healthRecords: loadHealthRecords(personId),
        family: mpV32.repo.listFamily(personId),
      }),
    });
  });

  route("GET", /^\/api\/mp\/v32\/records$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    json(res, 200, {
      data: mpV32.buildRecordList({
        personId,
        profile: loadProfile(personId),
        confirmations: mpV32.repo.listConfirmations(personId),
        healthRecords: loadHealthRecords(personId),
      }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/records\/([^/]+)\/confirmations$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const sourceKey = decodeURIComponent(m[1]);
    const list = mpV32.repo.upsertConfirmation(+sess.person_id, sourceKey, b.payload || b);
    json(res, 200, { data: { confirmations: list } });
  });

  route("POST", /^\/api\/mp\/v32\/plans\/generate$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    const draft = mpV32.generatePlanDraft({
      confirmations: mpV32.repo.listConfirmations(personId),
      healthRecords: loadHealthRecords(personId),
      profile: loadProfile(personId),
    });
    if (!draft.ok) return json(res, 400, { error: draft.reason, missing: draft.missing });
    const plan = mpV32.repo.insertPlanWithItems(personId, draft);
    json(res, 200, { data: { plan } });
  });

  route("GET", /^\/api\/mp\/v32\/plans\/current$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const personId = +sess.person_id;
    let plan = mpV32.repo.getActivePlan(personId);
    if (!plan) {
      plan = db
        .prepare(
          `SELECT * FROM health_plans WHERE person_id=? ORDER BY updated_at DESC LIMIT 1`
        )
        .get(personId);
    }
    const tasks = plan && plan.status === "active" ? mpV32.repo.ensureTodayTasks(personId, plan) : [];
    json(res, 200, {
      data: mpV32.buildPlanDetail({ personId, plan, tasks }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/plans\/(\d+)\/(activate|pause|resume)$/, (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const planId = +m[1];
    const action = m[2];
    const status = action === "activate" || action === "resume" ? "active" : "paused";
    try {
      const plan = mpV32.repo.setPlanStatus(+sess.person_id, planId, status);
      if (status === "active") mpV32.repo.ensureTodayTasks(+sess.person_id, plan);
      json(res, 200, { data: { plan } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("POST", /^\/api\/mp\/v32\/tasks\/(\d+)\/complete$/, async (req, res, m) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    try {
      const task = mpV32.repo.completeTask(+sess.person_id, +m[1], b);
      json(res, 200, { data: { task } });
    } catch (e) {
      const code = e.code === "not_found" ? 404 : 400;
      json(res, code, { error: e.message });
    }
  });

  route("GET", /^\/api\/mp\/v32\/services$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    json(res, 200, { data: mpV32.getServiceCenter() });
  });

  route("GET", /^\/api\/mp\/v32\/family$/, (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    json(res, 200, {
      data: mpV32.buildFamilyData({
        family: mpV32.repo.listFamily(+sess.person_id),
      }),
    });
  });

  route("POST", /^\/api\/mp\/v32\/family$/, async (req, res) => {
    const sess = requirePerson(req, res);
    if (!sess) return;
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const row = mpV32.repo.addFamily(+sess.person_id, b);
    json(res, 200, { data: { member: row } });
  });
}

module.exports = { registerMpV32Routes };
```

- [ ] **Step 2: 在 `server.js` 注册**

在 `registerMpAiRoutes(...)` 旁增加：

```javascript
const { registerMpV32Routes } = require("./routes/mp-v32.js");
// ...
registerMpV32Routes(route, {
  parseBody,
  json,
  MESSAGE_MAX_BODY,
  db,
  profileStore,
  patientProfile,
});
```

- [ ] **Step 3: Commit（若有 git）**

```bash
git add app/routes/mp-v32.js app/server.js
git commit -m "feat(mp-v32): register /api/mp/v32 routes"
```

---

### Task 4: 后端单测冒烟

**Files:**
- Modify: `app/_mp_v32_test.js`

- [ ] **Step 1: 参照 `_mp_archive_replies_test.js` 起临时 server，写入 person 会话，测闭环**

最小断言：

1. 无 token → `GET /api/mp/v32/home-feed` → 401  
2. 有会话 → home-feed 200，`data.plan === null`（新用户）  
3. `POST .../records/med-1/confirmations` → 200  
4. `POST .../plans/generate` → 200 得 draft  
5. `POST .../plans/:id/activate` → active  
6. `GET .../plans/current` → 有今日 tasks  
7. `POST .../tasks/:id/complete` → done  
8. 再 `GET home-feed` → 完成度变化（doneCount 增加）

- [ ] **Step 2: 运行**

```bash
node _mp_v32_test.js
```

Expected: 全部 PASS / exit 0

- [ ] **Step 3: Commit（若有 git）**

```bash
git add app/_mp_v32_test.js
git commit -m "test(mp-v32): add home-feed plan task smoke"
```

---

### Task 5: 前端 API 去静默 mock + 写接口

**Files:**
- Modify: `patient-uniapp/src/api/config.ts`
- Modify: `patient-uniapp/src/api/v32.ts`
- Modify: `patient-uniapp/src/types/v32.ts`

- [ ] **Step 1: 写失败契约测试**

在 `patient-uniapp/tests/ui-contract.test.mjs` 增加：

```javascript
test("V32 API 默认禁止静默 mock 回退", () => {
  const src = read("src/api/v32.ts");
  assert.doesNotMatch(src, /fallback to mock/);
  assert.match(src, /V32_ALLOW_MOCK_FALLBACK|ALLOW_MOCK_FALLBACK/);
  assert.match(src, /throw /);
});
```

- [ ] **Step 2: 跑测确认当前失败**

```bash
npm.cmd run test:ui
```

Expected: 新测试 FAIL

- [ ] **Step 3: 改 `config.ts`**

```typescript
/** 仅本地显式打开时允许 V32 回退 mock；默认 false */
export const V32_ALLOW_MOCK_FALLBACK =
  String(import.meta.env.VITE_V32_ALLOW_MOCK_FALLBACK || "") === "1";
```

- [ ] **Step 4: 改写 `v32.ts`**

```typescript
import { API_BASE, USE_MOCK, V32_ALLOW_MOCK_FALLBACK } from "./config";

async function requestV32<T>(
  path: string,
  fallback: T,
  opts?: { method?: "GET" | "POST"; data?: unknown }
): Promise<T> {
  const method = opts?.method || "GET";
  if (USE_MOCK && V32_ALLOW_MOCK_FALLBACK) {
    await delay();
    return clone(fallback);
  }
  const header: Record<string, string> = {};
  const token = getMpToken();
  if (token) header.Authorization = `Bearer ${token}`;
  if (method === "POST") header["Content-Type"] = "application/json";

  const res = await uni.request({
    url: `${API_BASE}/api/mp/v32${path}`,
    method,
    header,
    data: opts?.data,
    timeout: 12000,
  });
  const data = (res.data || {}) as { data?: T; error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) {
    if (V32_ALLOW_MOCK_FALLBACK) {
      console.warn(`[v32] ${path} fallback to mock`, data.error);
      return clone(fallback);
    }
    throw new Error(data.error || `v32 request failed: ${res.statusCode}`);
  }
  return (data.data != null ? data.data : (data as unknown as T)) as T;
}

export async function confirmRecord(sourceKey: string, payload?: unknown) {
  return requestV32(
    `/records/${encodeURIComponent(sourceKey)}/confirmations`,
    { confirmations: [] },
    { method: "POST", data: { payload } }
  );
}

export async function generatePlan() {
  return requestV32("/plans/generate", { plan: null }, { method: "POST", data: {} });
}

export async function activatePlan(planId: number) {
  return requestV32(`/plans/${planId}/activate`, { plan: null }, { method: "POST", data: {} });
}

export async function completeTask(taskId: number, payload?: unknown) {
  return requestV32(`/tasks/${taskId}/complete`, { task: null }, {
    method: "POST",
    data: payload || {},
  });
}
```

保留 GET 封装；`USE_MOCK===true` 且未开 fallback 时也应 throw 或明确走 mock——**约定：`USE_MOCK` 仅影响旧 patient API；V32 只认 `V32_ALLOW_MOCK_FALLBACK`**。

- [ ] **Step 5: 类型：`HomeFeed.plan` / `pendingRecord` / `serviceProgress` 改为可 null**

```typescript
export interface HomeFeed {
  hero: { /* 同前 */ };
  plan: HomePlanSummary | null;
  pendingRecord: PendingRecordSummary | null;
  quickActions: QuickAction[];
  serviceProgress: ServiceProgressSummary | null;
  recommendations: ServiceRecommendation[];
}
```

- [ ] **Step 6: 再跑 `npm.cmd run test:ui` → PASS；`npm.cmd run type-check`**

- [ ] **Step 7: Commit（若有 git）**

---

### Task 6: Store 与页面接写真闭环

**Files:**
- Modify: `patient-uniapp/src/stores/healthAssets.ts`
- Modify: `patient-uniapp/src/stores/home.ts`
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/plans/detail.vue`
- Modify: `patient-uniapp/src/pages/records/index.vue`
- Modify: `patient-uniapp/src/pages/family/index.vue`
- Modify: `patient-uniapp/src/pages/services/index.vue`

- [ ] **Step 1: 首页空态**

`index.vue`：当 `feed.plan == null` 展示 HOME-001（完善档案 / 生成计划 / 去咨询），隐藏假进度；`feed` 加载失败显示 `AppEmptyState` + 重试调用 `homeStore.load(true)`。

- [ ] **Step 2: 档案页**

增加按钮「确认此项」→ `confirmRecord(sourceKey)`；「生成健康计划」→ `generatePlan` → 成功后 `activatePlan` → `uni.navigateTo` 计划详情。

信息不足时 Toast 展示服务端 `error`。

- [ ] **Step 3: 计划详情**

任务「去完成」改为调用 `completeTask(Number(task.id))`，成功后 `force` 刷新 plan + home。

- [ ] **Step 4: 家属 / 服务**

继续走 GET；家属邀请表单调 `POST /family`（可简单 `uni.showModal` 输入姓名）。

- [ ] **Step 5: type-check + 手工连本地 `VITE_API_BASE`**

- [ ] **Step 6: Commit（若有 git）**

---

### Task 7: 双助手人设增强

**Files:**
- Modify: `app/modules/mpAi/prompt.js`
- Modify: `app/modules/mpAi/index.js`
- Modify: `app/routes/mp-ai.js`
- Modify: `patient-uniapp/src/api/aiChat.ts`
- Modify: `patient-uniapp/src/pages/consult/index.vue`

- [ ] **Step 1: `buildSystemPrompt(role)`**

```javascript
function buildSystemPrompt(role) {
  const base =
    "你是春雨健康小程序助手。不做诊断结论，危急症状建议线下就医。回答简洁可执行。";
  if (role === "life") {
    return (
      base +
      "当前角色：生活管家。聚焦预约、复诊安排、服务进度、权益与售后；医疗判断请建议切换健康助手。"
    );
  }
  return (
    base +
    "当前角色：健康助手。聚焦用药、报告理解、指标与健康计划；预约物流请建议切换生活管家。"
  );
}
```

- [ ] **Step 2: `chat` 接收 `assistantRole`、`pageContext`，拼进 system 或 user 前缀**

- [ ] **Step 3: 小程序发送时带上 `consultation.role`（waiting 时先 `classifyIntent`）**

- [ ] **Step 4: 手工发「问用药」「帮我预约」验证路由与人设差异**

- [ ] **Step 5: Commit（若有 git）**

---

### Task 8: 青绿视觉 Token 与 Tab

**Files:**
- Modify: `patient-uniapp/src/pages.json`（`tabBar.selectedColor` → `#176B52`）
- Modify: `packages/patient-design/tokens.css`（`--primary` 等改为青绿，**并更新**契约测试期望）
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`

- [ ] **Step 1: 改 pages.json selectedColor**

```json
"selectedColor": "#176B52"
```

- [ ] **Step 2: 更新 tokens 与测试中的 `#5d87ff` → `#176b52`，`--page-bg` 可改为 `#f3f4ef`（与原型一致）**

- [ ] **Step 3: `npm.cmd run test:ui` PASS**

- [ ] **Step 4: Commit（若有 git）**

---

### Task 9: 契约测试补强

**Files:**
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`

- [ ] **Step 1: 增加断言**

```javascript
test("Tab 选中色为春雨青绿", () => {
  const pages = readJson("src/pages.json");
  assert.equal(String(pages.tabBar.selectedColor).toLowerCase(), "#176b52");
});

test("首页须兼容无计划空态而非写死高血压 mock 文案", () => {
  const page = read("src/pages/index/index.vue");
  assert.match(page, /plan\s*==\s*null|!.*plan|HOME-001|无计划|完善健康档案/);
});
```

- [ ] **Step 2: `npm.cmd run test:ui` → PASS**

---

### Task 10: 全量验证

- [ ] **Step 1: 后端**

```bash
node _mp_v32_test.js
```

- [ ] **Step 2: 前端**

```bash
npm.cmd run type-check
npm.cmd run test:ui
npm.cmd run build:mp-weixin
```

Expected: 全部成功；`DONE Build complete.`

- [ ] **Step 3: 手工清单打勾**

1. 新用户首页无假进度  
2. 确认档案 → 生成 → 启用计划  
3. 完成 1 个任务 → Feed 变化  
4. 咨询健康/生活切换  
5. 断网出现错误卡而非 mock 高血压计划  

---

### Task 11: 接入 Codex 出图结果（可并行延后）

**Files:**
- Replace under `patient-uniapp/src/static/**`
- Modify: `patient-uniapp/src/constants/v32Assets.ts`

- [ ] **Step 1: 主人用 zip 生成 PNG 后，按 `manifest.json` 的 `dest` 拷贝**

- [ ] **Step 2: 扩展常量**

```typescript
export const V32_VISUAL_ASSETS = {
  reportUploadGuide: "/static/visual/report-upload-guide.png",
  rehabGuideCover: "/static/visual/rehab-guide-cover.png",
  healthRecordEmpty: "/static/visual/health-record-empty.png",
  healthPlanServiceHero: "/static/visual/health-plan-service-hero.png",
  defaultUserAvatar: "/static/visual/default-user-avatar.png",
  homeHeroAction: "/static/visual/home-hero-action.png",
  emptyNoPlan: "/static/visual/empty-no-plan.png",
  familyEmpty: "/static/visual/family-empty.png",
  assistantHealth: "/static/visual/assistant-health-avatar.png",
  assistantLife: "/static/visual/assistant-life-avatar.png",
} as const;
```

- [ ] **Step 3: 咨询角色头像与空态引用新图；`build:mp-weixin` 再跑一遍**

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| `/api/mp/v32` 真实接口 | 1–4 |
| 禁止静默 mock | 5, 9 |
| 档案确认 → 计划 → 任务 | 2, 3, 6 |
| 动态首页 HOME-001/002 | 2 feed, 6 |
| 双助手增强 | 7 |
| 青绿 ColorUI / Tab | 8 |
| 服务只读无支付 | 2 catalog, 3 |
| 家属轻量 | 2, 3, 6 |
| 出图接入 | 11 |
| type-check / test:ui / build | 10 |

**Placeholder scan:** 无 TBD；Commit 步允许无 git 时跳过。

**Type consistency:** `person_id`、任务 `complete`、`plan` 可 null 前后统一。

---

## Execution handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-07-30-patient-mp-v32-phase1.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间评审，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

主人选哪一种？
