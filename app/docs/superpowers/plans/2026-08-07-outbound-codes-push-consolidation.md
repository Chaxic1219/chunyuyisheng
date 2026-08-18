# 编号与推送整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将群与话术 / 编号中心 / 关键词规则 / 企微贴片收敛为菜单「编号与推送」下的素材库与触发编排两页，并以 `outbound_assets` + `outbound_triggers` + `outbound_trigger_steps` 为唯一出站真相源。

**Architecture:** 新建 outbound 模块（schema/repo/resolve/migrate/API）；`engine.match` 与入群欢迎改为读触发步骤并展开为现有 `responses[]` 形状，继续走 `prepareDelivery`/`deliverReplyToQiwe`；admin-ui 新两页只引用素材；旧路由重定向；一次性 `schema_patches` 迁移现网 rules/scripts。

**Tech Stack:** Node.js + SQLite（`app/`）、Vue3 + Element Plus（`admin-ui/`）、现有 `qiwe_weapp_templates` 贴片底层

**Spec:** `app/docs/superpowers/specs/2026-08-07-outbound-codes-push-consolidation-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| Create `app/modules/outbound/schema.js` | DDL + ensureSchema |
| Create `app/modules/outbound/repo.js` | assets/triggers/steps CRUD |
| Create `app/modules/outbound/resolve.js` | match trigger → expand steps → responses[] |
| Create `app/modules/outbound/migrate.js` | rules/scripts → outbound 一次性迁移 |
| Create `app/routes/outbound-admin.js` | `/api/admin/outbound/*` |
| Modify `app/db.js` | 调用 ensureSchema + migrate patch |
| Modify `app/engine.js` | 优先 outbound match |
| Modify `app/patient_reply.js` | 有 outbound 命中时跳过 `withConfiguredCodeScript` |
| Modify `app/modules/qiwe/callback.js` | 入群按 join 触发编排发多条 |
| Modify `app/welcome.js` | join 文案可从 outbound text 步取（或仅作 fallback） |
| Modify `app/server.js` | register outbound routes |
| Create `admin-ui/.../outbound/assets/index.vue` | 素材库页 |
| Create `admin-ui/.../outbound/triggers/index.vue` | 触发编排页 |
| Create `admin-ui/.../outbound/components/*` | 素材表单、步骤编辑器 |
| Modify `admin-ui/src/api/chunyu/index.ts` | outbound API 客户端 |
| Modify `admin-ui/src/router/modules/chunyu.ts` | 新菜单 + 旧 redirect |
| Modify `admin-ui/.../qiwe/index.vue` | 移除贴片运营段（保留凭证） |
| Create `app/_outbound_test.js` | 单元/集成测试 |

拍板（来自设计开放项）：

- 禁用素材被引用时：**跳过该步 + console 日志**
- 旧 rules 写 API：迁移后 **仍可读**；写入返回 `410` 或友好提示「请改用编号与推送」（实现 Task 6）
- 「新建编号」：**同时**创建 `group_code` 文件夹语义 + 空 `kind=code` 触发
- 非出站话术（`transferHuman` / `emergency` / `memberVisit` / `doctorHomeShortLink`）迁到 **医生运营** 可编辑域，避免随「群与话术」一起消失

本仓库若无 `.git`，各 Task 末「Commit」步骤改为：记录变更清单即可，不强制 `git commit`。

---

### Task 1: outbound schema + repo

**Files:**
- Create: `app/modules/outbound/schema.js`
- Create: `app/modules/outbound/repo.js`
- Modify: `app/db.js`（在既有 ensure 流程中调用）
- Test: `app/_outbound_test.js`

- [ ] **Step 1: 写失败测试（表不存在 / CRUD）**

```js
// app/_outbound_test.js（片段）
const assert = require("assert");
process.env.DB_PATH = require("path").join(require("os").tmpdir(), `outbound-${Date.now()}.db`);
const { db } = require("./db.js");
const repo = require("./modules/outbound/repo.js");

const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
assert(doctor);
const a = repo.createAsset({
  doctorId: doctor.id, type: "text", title: "t1",
  payload: { text: "你好" }, groupCode: "101"
});
assert(a && a.id, "应能创建 asset");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node app/_outbound_test.js`  
Expected: `Cannot find module './modules/outbound/repo.js'` 或表不存在

- [ ] **Step 3: 实现 schema**

```js
// app/modules/outbound/schema.js
"use strict";
function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbound_assets(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      group_code TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbound_triggers(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      match_type TEXT NOT NULL DEFAULT 'exact',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbound_trigger_steps(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_outbound_assets_doctor ON outbound_assets(doctor_id, group_code);
    CREATE INDEX IF NOT EXISTS idx_outbound_triggers_doctor ON outbound_triggers(doctor_id, kind, code);
    CREATE INDEX IF NOT EXISTS idx_outbound_steps_trigger ON outbound_trigger_steps(trigger_id, sort);
  `);
}
module.exports = { ensureSchema };
```

- [ ] **Step 4: 实现 repo（createAsset / listAssets / updateAsset / deleteAsset；createTrigger / getTrigger / replaceSteps / listTriggers）**

关键约束在 `deleteAsset`：

```js
function deleteAsset(doctorId, assetId){
  const n = db.prepare(
    `SELECT COUNT(*) c FROM outbound_trigger_steps s
     JOIN outbound_triggers t ON t.id=s.trigger_id
     WHERE s.asset_id=? AND t.doctor_id=?`
  ).get(+assetId, +doctorId).c;
  if(n > 0){
    const err = new Error("素材仍被触发编排引用，请先移除引用");
    err.code = "ASSET_IN_USE";
    throw err;
  }
  db.prepare("DELETE FROM outbound_assets WHERE id=? AND doctor_id=?").run(+assetId, +doctorId);
}
```

`createCodeBundle(doctorId, code)`：插入 `group_code=code` 的空触发 `kind=code`（无 steps）。

- [ ] **Step 5: 在 `db.js` 启动路径调用 `require("./modules/outbound/schema.js").ensureSchema(db)`**

- [ ] **Step 6: 跑测试通过**

Run: `node app/_outbound_test.js`  
Expected: PASS（至少 create/list/delete-in-use）

- [ ] **Step 7: Commit（若有 git）** — `feat(outbound): add assets/triggers schema and repo`

---

### Task 2: resolve —— 匹配并展开为 responses[]

**Files:**
- Create: `app/modules/outbound/resolve.js`
- Modify: `app/_outbound_test.js`

- [ ] **Step 1: 写测试：3 步（text,text,mp）展开顺序**

```js
const resolve = require("./modules/outbound/resolve.js");
// 插入 trigger 101 + 3 steps 后：
const hit = resolve.matchCode(doctor.id, "101");
assert.strictEqual(hit.responses.length, 3);
assert.strictEqual(hit.responses[0].type, "text");
assert.strictEqual(hit.responses[2].type, "mp");
```

- [ ] **Step 2: 跑测失败 → 实现 resolve**

```js
// app/modules/outbound/resolve.js 核心
function assetToResponse(asset){
  const payload = typeof asset.payload === "string" ? JSON.parse(asset.payload || "{}") : (asset.payload || {});
  if(asset.type === "text") return { type:"text", text: String(payload.text || "") };
  if(asset.type === "mp") return {
    type:"mp",
    text: payload.title || asset.title || "",
    title: payload.title || "",
    external: { shortLink: payload.shortLink || "" },
    weappCode: payload.weappCode || payload.templateCode || "",
    templateCode: payload.templateCode || payload.weappCode || ""
  };
  if(asset.type === "link") return {
    type:"link",
    title: payload.title || asset.title || "",
    external: { url: payload.url || "" },
    source: payload.source || "",
    page: payload.page || ""
  };
  return null;
}

function expandTrigger(triggerId){
  const steps = db.prepare(
    `SELECT s.*, a.type, a.title, a.payload, a.enabled AS asset_enabled
     FROM outbound_trigger_steps s
     JOIN outbound_assets a ON a.id=s.asset_id
     WHERE s.trigger_id=? AND s.enabled=1
     ORDER BY s.sort, s.id`
  ).all(+triggerId);
  const responses = [];
  for(const s of steps){
    if(!s.asset_enabled){ console.warn("[outbound] skip disabled asset", s.asset_id); continue; }
    const r = assetToResponse(s);
    if(r) responses.push(r);
  }
  return responses;
}

function matchCode(doctorId, text){
  // 逻辑对齐 engine：exact 先，再 includes + scanRisk
  // 从 outbound_triggers WHERE doctor_id AND kind='code' AND enabled=1
  // 命中返回 { code, bot:'小宝医助', responses, source:'outbound' }
}

function matchJoin(doctorId){
  const t = db.prepare(
    `SELECT * FROM outbound_triggers WHERE doctor_id=? AND kind='join' AND enabled=1 ORDER BY sort,id LIMIT 1`
  ).get(+doctorId);
  if(!t) return null;
  return { kind:"join", responses: expandTrigger(t.id), source:"outbound", triggerId: t.id };
}
```

- [ ] **Step 3: 测试 PASS**

- [ ] **Step 4: Commit** — `feat(outbound): resolve code/join triggers to responses`

---

### Task 3: 迁移脚本

**Files:**
- Create: `app/modules/outbound/migrate.js`
- Modify: `app/db.js`（`schema_patches` id: `outbound_v1_migrate_from_rules_scripts`）
- Modify: `app/_outbound_test.js`

- [ ] **Step 1: 测试用临时 DB：造 rules(101 mp) + scripts.code101 文案 + groupWelcome，跑 migrate 后断言**

```js
// 期望：
// - 1 个 kind=code code=101 触发
// - steps[0] text 含 code101 文案
// - steps 后续含 mp
// - 1 个 kind=join，首步 text = groupWelcome
```

- [ ] **Step 2: 实现 `migrateDoctor(doctorId)` / `migrateAllDoctors()`**

规则：

1. 若 `patchApplied('outbound_v1_migrate_from_rules_scripts')` 则跳过整库  
2. 每位医生若已有任意 `outbound_triggers` 则跳过该医生（防重入）  
3. 每条 enabled `rules` → trigger + 把 `responses[]` 转 asset（`group_code=code`）+ steps  
4. `ops_configs.scripts` 的 `code{N}`：若该 code 触发 steps 尚无「正文相等」的 text，则 **unshift** 一条 text asset  
5. `groupWelcome` + 现网 `welcomeWeappPayload()` 返回的码 → join 触发（text + 对应 mp assets；mp 尽量挂 `qiwe_weapp_templates`）  
6. `markPatchApplied`

- [ ] **Step 3: 本地跑测 PASS；记录周/王医生迁移后 trigger/step 数量探测脚本（可进 `_outbound_test.js` 或独立 `_run_outbound_migrate_probe.py`）**

- [ ] **Step 4: Commit** — `feat(outbound): migrate rules/scripts into outbound tables`

---

### Task 4: 接线 engine + patient_reply

**Files:**
- Modify: `app/engine.js`
- Modify: `app/patient_reply.js`
- Modify: `app/_outbound_test.js`（或扩展现有 `_unittest.js` 中与 101 相关的窄测）

- [ ] **Step 1: `engine.match` 优先 outbound**

```js
function match(doctorId, text){
  const t = norm(text);
  if(!t) return null;
  if(t==="1"||t==="菜单"||t==="功能"||t==="全部功能"||isMenuIntent(t)) return { menu:true };

  try{
    const outbound = require("./modules/outbound/resolve.js");
    if(outbound.hasOutboundConfig(doctorId)){
      const hit = outbound.matchCode(doctorId, text);
      if(hit) return hit;
      return null; // 已迁移医生：不再回落旧 rules，避免双源
    }
  }catch(e){}

  // 旧逻辑：读 rules ...
}
```

`hasOutboundConfig(doctorId)`：`SELECT 1 FROM outbound_triggers WHERE doctor_id=? LIMIT 1`

- [ ] **Step 2: `buildPatientReply` 跳过 scripts 前置**

```js
if(Array.isArray(out.responses)){
  out.responses = fillPatientPlaceholder(clone(out.responses), patientName);
  if(out.source !== "outbound"){
    out.responses = withConfiguredCodeScript(did, out.code, out.responses, patientName, { omitPatientName:groupScene });
  }
  // science gate 仍保留
}
```

- [ ] **Step 3: 测试「仅 outbound 3 步、无 scripts」→ `buildPatientReply` / 或直接 `resolve`+模拟 delivery 输入长度为 3**

- [ ] **Step 4: Commit** — `feat(outbound): engine and patient_reply use outbound source`

---

### Task 5: 入群欢迎改走 join 触发

**Files:**
- Modify: `app/modules/qiwe/callback.js`（`fireGroupWelcome`）
- Modify: `app/_welcome_video_test.js`（或新建断言：有 join 编排时 weappCodes 来自 steps，而非写死）
- Keep: `app/welcome.js` 作 **无 join 触发时的 fallback 文案**

- [ ] **Step 1: 改 `fireGroupWelcome`**

伪代码：

```js
const outbound = require("../outbound/resolve.js");
const joinHit = outbound.matchJoin(doctorId);
if(welcomeEnabled && joinHit && joinHit.responses.length){
  // 用 prepareDelivery 同类逻辑：从 responses 拆 replyText / weappCodes / linkCards
  // 禁止再调用 welcomeWeappPayload() 写死 979/808
}else if(welcomeEnabled){
  // 旧：buildGroupWelcomeText + welcomeWeappPayload（仅未迁移医生）
}
```

复用 `delivery.prepareDelivery` 或抽出 `responsesToWelcomePayload(responses)`，避免复制粘贴出错。

- [ ] **Step 2: 更新 `_welcome_video_test.js`**

- 迁移后医生：join steps 决定 codes  
- 未迁移：保持旧断言（若测试 DB 总是跑 migrate，则改断言为「编排结果」）

- [ ] **Step 3: Commit** — `feat(outbound): group welcome uses join trigger steps`

---

### Task 6: Admin API

**Files:**
- Create: `app/routes/outbound-admin.js`
- Modify: `app/server.js`（`registerOutboundAdminRoutes`）
- Modify: `app/routes/content-admin.js`（rules POST/PUT/DELETE → 迁移后提示改用 outbound）

- [ ] **Step 1: 实现路由**

```
GET    /api/admin/outbound/assets?doctorId=
POST   /api/admin/outbound/assets
PUT    /api/admin/outbound/assets/:id
DELETE /api/admin/outbound/assets/:id
POST   /api/admin/outbound/codes          // { doctorId, code } → createCodeBundle
GET    /api/admin/outbound/triggers?doctorId=
POST   /api/admin/outbound/triggers
PUT    /api/admin/outbound/triggers/:id   // body 含 steps:[{assetId,sort,enabled}]
DELETE /api/admin/outbound/triggers/:id
```

鉴权/医生作用域：照抄 `registerContentAdminRoutes` / `config-center` 的 doctorId 校验方式。

- [ ] **Step 2: 用 curl 或小脚本打本地 API（若需登录 cookie，则用现有 admin 测试辅助）**

- [ ] **Step 3: Commit** — `feat(outbound): admin CRUD API`

---

### Task 7: admin-ui API + 菜单「编号与推送」

**Files:**
- Modify: `admin-ui/src/api/chunyu/index.ts`
- Modify: `admin-ui/src/router/modules/chunyu.ts`
- Modify: `admin-ui/src/views/chunyu/config/fields.ts` + OpsDoctor meta（非出站话术迁入医生运营）

- [ ] **Step 1: 增加 API 函数** `chunyuOutboundAssets` / `chunyuOutboundTriggers` / `chunyuOutboundSaveTrigger` 等

- [ ] **Step 2: 路由**

在 `Ops` children **最前**插入：

```ts
{
  path: 'outbound',
  name: 'OpsOutbound',
  redirect: '/ops/outbound/assets',
  meta: { title: '编号与推送', icon: 'ri:send-plane-2-line' },
  children: [
    {
      path: 'assets',
      name: 'OpsOutboundAssets',
      component: '/chunyu/ops/outbound/assets/index',
      meta: { title: '素材库', icon: 'ri:folder-image-line', keepAlive: true }
    },
    {
      path: 'triggers',
      name: 'OpsOutboundTriggers',
      component: '/chunyu/ops/outbound/triggers/index',
      meta: '触发编排' // title/icon 按项目 meta 惯例写全
    }
  ]
}
```

注意：若项目路由 **不支持嵌套 children 二级**，则平铺为：

- `path: 'outbound/assets'` meta.title=`素材库`，父级用隐藏分组或 `activeMenu`
- 并增加仅作菜单分组的 `编号与推送`（按现有 PureAdmin 菜单约定；参考同文件其它分组写法）

旧项处理：

```ts
// scripts / codes / knowledge/rules → redirect
{ path: 'scripts', redirect: '/ops/outbound/assets', meta: { isHide: true } }
{ path: 'codes', redirect: '/ops/outbound/triggers', meta: { isHide: true } }
// knowledge 下 rules：isHide + redirect
```

- [ ] **Step 3: 把 `transferHuman`/`emergency`/`memberVisit`/`doctorHomeShortLink` 划入 `OpsDoctor` 的 `opsDomains`（从 scripts 字段集拆出 `SCRIPT_AUX_FIELDS`）**

- [ ] **Step 4: Commit** — `feat(admin-ui): outbound menu and API client`

---

### Task 8: 素材库页面

**Files:**
- Create: `admin-ui/src/views/chunyu/ops/outbound/assets/index.vue`
- Create: `admin-ui/src/views/chunyu/ops/outbound/components/AssetEditorDrawer.vue`
- Create: `admin-ui/src/views/chunyu/ops/outbound/components/GroupCodeSidebar.vue`

- [ ] **Step 1: 左栏分组（含 入群=`welcome`、未分组）+「新建编号」调用 `POST /codes`**

- [ ] **Step 2: 右栏素材列表；新建 text/mp/link；mp 编辑内嵌调用现有 `chunyuQiweCover*` API（从 `qiwe/index.vue` 抽复用函数或小组件）**

- [ ] **Step 3: 删除时若 `ASSET_IN_USE` 展示后端错误文案**

- [ ] **Step 4: 本地 `pnpm`/`npm` dev 点选冒烟**

- [ ] **Step 5: Commit** — `feat(admin-ui): outbound assets library page`

---

### Task 9: 触发编排页面

**Files:**
- Create: `admin-ui/src/views/chunyu/ops/outbound/triggers/index.vue`
- Create: `admin-ui/src/views/chunyu/ops/outbound/components/TriggerStepEditor.vue`  
  （可参考 `CodeResponseSteps.vue` 的增删排序 UX，但选项改为「选素材」而非内联编辑正文）

- [ ] **Step 1: 触发列表（入群 / 各 code）+ 启用开关 + 别名编辑**

- [ ] **Step 2: 步骤编辑：添加条目（弹层从素材库多选/单选）、移除、上移下移；保存整表 `PUT triggers/:id`**

- [ ] **Step 3: 验收路径：把 101 配成 2 text + 1 mp，保存后 GET 回显 3 步**

- [ ] **Step 4: Commit** — `feat(admin-ui): outbound trigger playlist editor`

---

### Task 10: 企微页去贴片运营 + 文案链接清理

**Files:**
- Modify: `admin-ui/src/views/chunyu/qiwe/index.vue`（隐藏/删除 §③ 贴片运营 UI，保留凭证与回调）
- Modify: 文案里指向「群与话术/编号中心」的 hint（如 `GroupEditDialog.vue`、`OpsHealthPanel.vue`、`ops/index.vue`）改为「编号与推送」

- [ ] **Step 1: 企微页贴片段改为提示「请到 编号与推送 → 素材库」**

- [ ] **Step 2: 全局替换运营引导链接**

- [ ] **Step 3: Commit** — `chore(admin-ui): retire old outbound config entry points`

---

### Task 11: 回归、构建、生产验证

**Files:** 测试与部署脚本（按仓库惯例 `_run_*.py` / `pm2`）

- [ ] **Step 1: 跑**

```
node app/_outbound_test.js
node app/_welcome_video_test.js
# 若耗时可接受：node app/_unittest.js 中与 rules/101/welcome 相关子集
```

- [ ] **Step 2: `admin-ui` build，部署 app + admin 静态资源到现网**

- [ ] **Step 3: 生产探测**

- 周/王：`outbound_triggers` 已迁移；发测试编号（或 dry-run 展开）steps 条数 = 迁移前「scripts 文案 + rules responses」合并结果  
- 在触发编排把某测试号临时改为 3 步，确认预览/投递计划含 3 项  
- 确认侧栏只有「编号与推送」两入口可改出站；旧 URL 会跳转

- [ ] **Step 4: 恢复测试号编排（若曾改生产）并记录结果**

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| 菜单编号与推送两页 | 7–9 |
| 素材库 text/mp/link + 分组 + 复用 | 1, 8 |
| 触发编排只引用 + 可增减条目 | 2, 9 |
| 入群 N 条可配 | 5, 9 |
| 保存即生效 | 6（无 publish 域） |
| 旧入口替换 | 7, 10 |
| 迁移 rules/scripts/welcome | 3 |
| engine/投递唯一真相源 | 4, 5 |
| 引用中不可删素材 | 1, 6, 8 |
| 非出站话术不丢失 | 7 |

## Placeholder / consistency self-review

- 无 TBD；开放项已在文首拍板  
- `source:'outbound'` 在 resolve → engine → patient_reply 一致  
- `group_code=welcome` 与 `kind=join` 并存：分组展示用 welcome，匹配用 kind  
- 响应形状与现 `delivery`/`CodeResponseSteps` 的 `mp`/`link`/`text` 对齐
