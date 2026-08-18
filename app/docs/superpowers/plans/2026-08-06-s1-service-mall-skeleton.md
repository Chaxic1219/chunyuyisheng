# S1 服务包商城骨架 Implementation Plan

> **Verification (2026-08-06):** S1 automated verification passed — `_service_package_test.js` all green; `npm run build:mp-weixin` succeeded; static grep checks for orders pages, mineDefaults, healthEntries, catalog chips, orders API, service-instances limit 100 all confirmed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留健康档案与 AI 咨询主链的前提下，按 bee 风格完成服务包「单品选购 + 我的订单」骨架（mock 支付），三支柱入口同级可见。

**Architecture:** 扩展现有 `servicePackage`（`svc_products.category` + 患者订单列表 API）；小程序强化目录/详情并新建订单列表/详情页；管理端商品表单补分类与封面；不改 Tab 结构、不接 api工厂、不实现真支付（S4）。

**Tech Stack:** Node/SQLite（`app/modules/servicePackage`）、uni-app（`patient-uniapp`）、Vue3 admin（`admin-ui`）、现有 `_service_package_test.js` 冒烟风格。

**Spec:** `app/docs/superpowers/specs/2026-08-06-bee-style-service-mall-three-pillars-design.md` §4

---

## File map

| 文件 | 职责 |
|------|------|
| `app/modules/servicePackage/schema.js` | `svc_products.category` 迁移 |
| `app/modules/servicePackage/catalog.js` | 列表按 category 过滤；DTO 带 category/cover |
| `app/modules/servicePackage/orders.js` | `listForPerson` 支持 status/分页 |
| `app/modules/servicePackage/adminProducts.js` | 创建/编辑写入 category、cover |
| `app/routes/mp-service-package.js` | `GET /api/mp/orders`；products 支持 `category` |
| `app/_service_package_test.js` | 分类过滤 + 订单列表断言 |
| `patient-uniapp/src/api/servicePackage.ts` | `listMyOrders`、类型补 category |
| `patient-uniapp/src/pages/services/catalog.vue` | 分类 + 列表 UI |
| `patient-uniapp/src/pages/services/detail.vue` | 封面/价格区强化 |
| `patient-uniapp/src/pages/services/orders.vue` | **新建** 我的订单 Tab |
| `patient-uniapp/src/pages/services/order-detail.vue` | **新建** 订单详情进度 |
| `patient-uniapp/src/pages.json` | 注册新页 |
| `patient-uniapp/src/constants/mineDefaults.ts` | 「我的订单」入口 |
| `patient-uniapp/src/pages/services/index.vue` | 入口指向目录/订单，不削弱其它 |
| `patient-uniapp/src/pages/index/index.vue` | 确认档案/服务包入口同级（仅必要时微调） |
| `admin-ui/.../service-products/index.vue` | 分类、封面字段 |
| `admin-ui/src/api/chunyu/index.ts` | 类型/请求体补字段 |

**Out of S1:** 购物车、优惠券、真微信支付、退款申请页、第四 Tab。

---

### Task 1: Schema — product category

**Files:**
- Modify: `app/modules/servicePackage/schema.js`
- Test: `app/_service_package_test.js`

- [ ] **Step 1: 在 `ensureSchema` 中增加可重复执行的 category 列迁移**

在 `svc_products` 建表语句之后追加（若不存在则 `ALTER`）：

```javascript
function ensureColumn(db, table, column, ddlFragment) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddlFragment}`);
  }
}

// inside ensureSchema, after svc_products create/index:
ensureColumn(db, "svc_products", "category", "category TEXT NOT NULL DEFAULT 'rehab'");
db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_products_category ON svc_products(doctor_id, category, status)`);
```

约定分类枚举（S1 固定字符串）：`rehab`（康复服务包）、`followup`（复诊相关）、`other`。

- [ ] **Step 2: 种子商品写入 category**

在 `seedWangOrthopedicPackage` 的 `INSERT INTO svc_products` 增加 `category` 列，值 `'rehab'`（若 INSERT 列清单需同步改）。

- [ ] **Step 3: 扩展冒烟测试 — category 列存在**

在 `app/_service_package_test.js` 的 tables 测试后增加：

```javascript
await test("svc_products has category", () => {
  const cols = db.prepare(`PRAGMA table_info(svc_products)`).all().map((c) => c.name);
  assert.ok(cols.includes("category"), "category column");
});
```

- [ ] **Step 4: 运行测试**

Run: `cd app && node _service_package_test.js`  
Expected: 全部 `ok -`，含新断言。

- [ ] **Step 5: Commit**（仅当主人要求提交时执行；默认可跳过）

```bash
git add app/modules/servicePackage/schema.js app/_service_package_test.js
git commit -m "feat(service-package): add product category column for S1 catalog"
```

---

### Task 2: Catalog list by category + DTO

**Files:**
- Modify: `app/modules/servicePackage/catalog.js`
- Modify: `app/routes/mp-service-package.js`
- Test: `app/_service_package_test.js`

- [ ] **Step 1: 写失败测试 — 按 category 过滤**

在种子与 publish 之后：

```javascript
await test("listPublished filters by category", () => {
  const svc = createServicePackage(db);
  const all = svc.catalog.listPublished({ doctorId: doctor.id });
  assert.ok(all.length >= 1);
  const rehab = svc.catalog.listPublished({ doctorId: doctor.id, category: "rehab" });
  assert.ok(rehab.every((p) => p.category === "rehab"));
  const empty = svc.catalog.listPublished({ doctorId: doctor.id, category: "followup" });
  assert.strictEqual(empty.length, 0);
});
```

先运行应 FAIL（无 `category` 字段或过滤）。

- [ ] **Step 2: 实现 `mapVersionRow` 带上 category；`listPublished` 支持过滤**

```javascript
// mapVersionRow 增加参数或从 row 读：
category: row.category || row.product_category || "rehab",

// listPublished:
function listPublished({ doctorId, category } = {}) {
  let sql = `
    SELECT v.*, p.doctor_id AS product_doctor_id, p.slug, p.category AS product_category
    FROM svc_product_versions v
    JOIN svc_products p ON p.id = v.product_id
    WHERE p.status = 'published' AND p.current_version_id = v.id
  `;
  const args = [];
  if (doctorId) {
    sql += ` AND p.doctor_id = ?`;
    args.push(+doctorId);
  }
  if (category) {
    sql += ` AND p.category = ?`;
    args.push(String(category));
  }
  sql += ` ORDER BY v.id DESC`;
  return db.prepare(sql).all(...args).map((r) =>
    mapVersionRow({ ...r, category: r.product_category }, doctorRow(r.product_doctor_id))
  );
}
```

- [ ] **Step 3: 路由透传 query**

`GET /api/mp/service-products` 已有 doctorId；增加：

```javascript
const category = q.category ? String(q.category) : undefined;
const list = svc.catalog.listPublished({ doctorId, category });
```

- [ ] **Step 4: 跑测试至 PASS**

Run: `cd app && node _service_package_test.js`

---

### Task 3: Patient order list API

**Files:**
- Modify: `app/modules/servicePackage/orders.js`
- Modify: `app/routes/mp-service-package.js`
- Test: `app/_service_package_test.js`

- [ ] **Step 1: 写失败测试**

在创建订单（mock 已付）后：

```javascript
await test("listForPerson filters by status", async () => {
  const svc = createServicePackage(db);
  // 假设已有 personId + 至少一笔 paid_pending_profile 或 active 订单
  const listed = svc.orders.listForPerson(personId, { status: "paid_pending_profile" });
  assert.ok(Array.isArray(listed));
  assert.ok(listed.every((o) => o.status === "paid_pending_profile"));
  const page = svc.orders.listForPerson(personId, { limit: 10, offset: 0 });
  assert.ok(page.length <= 10);
});
```

（按现有测试里实际 person/order 变量名对齐。）

- [ ] **Step 2: 扩展 `listForPerson`**

```javascript
function listForPerson(personId, { status, limit = 50, offset = 0 } = {}) {
  closeExpiredPending(personId);
  const lim = Math.min(Math.max(+limit || 50, 1), 100);
  const off = Math.max(+offset || 0, 0);
  let sql = `SELECT * FROM svc_orders WHERE person_id=?`;
  const args = [+personId];
  if (status) {
    sql += ` AND status=?`;
    args.push(String(status));
  }
  sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
  args.push(lim, off);
  return db.prepare(sql).all(...args).map(mapOrder);
}
```

- [ ] **Step 3: 新增路由（在单条 GET 之前注册，避免被吞）**

```javascript
route("GET", /^\/api\/mp\/orders$/, (req, res, m, q) => {
  const sess = requirePerson(req, res);
  if (!sess) return;
  const status = q.status ? String(q.status) : undefined;
  const limit = q.limit;
  const offset = q.offset;
  const orders = svc.orders.listForPerson(+sess.person_id, { status, limit, offset });
  json(res, 200, { data: { orders } });
});
```

注意：现有 `GET /api/mp/orders/:id` 用正则 `\/orders\/(\d+)$`，与列表不冲突。

- [ ] **Step 4: 跑测试 PASS**

---

### Task 4: Admin product category + cover

**Files:**
- Modify: `app/modules/servicePackage/adminProducts.js`
- Modify: `admin-ui/src/views/chunyu/service-products/index.vue`
- Modify: `admin-ui/src/api/chunyu/index.ts`（若有 product 类型）

- [ ] **Step 1: `adminProducts` normalize 读写 `category`**

创建/更新产品时：

```javascript
category: ["rehab", "followup", "other"].includes(String(body.category || "").trim())
  ? String(body.category).trim()
  : "rehab",
```

`INSERT/UPDATE svc_products` 写入 `category`；列表 API 返回 `category`。  
`cover` 已在 version 层 — 确认表单可编辑并提交到 version 创建逻辑。

- [ ] **Step 2: Admin UI 表单**

在 `service-products/index.vue` 增加：

- `el-select`：分类 rehab/followup/other（中文标签：康复服务包 / 复诊相关 / 其他）  
- `el-input`：封面 URL（`cover`）  
提交 payload 带上 `category`、`cover`。

- [ ] **Step 3: 本地打开管理端「服务包商品」**，创建/编辑保存后列表可见分类；小程序目录可按分类筛到。

---

### Task 5: Miniapp API client

**Files:**
- Modify: `patient-uniapp/src/api/servicePackage.ts`

- [ ] **Step 1: 扩展类型**

```typescript
export type ServiceProduct = {
  // ...existing
  category?: string;
  cover?: string;
};

export type OrderListQuery = {
  status?: string;
  limit?: number;
  offset?: number;
};
```

- [ ] **Step 2: 增加方法**

```typescript
export function listServiceProducts(params?: { doctorId?: number; category?: string }) {
  const q = new URLSearchParams();
  if (params?.doctorId) q.set("doctorId", String(params.doctorId));
  if (params?.category) q.set("category", params.category);
  const qs = q.toString();
  return requestMp<{ products?: ServiceProduct[]; list?: ServiceProduct[] } | ServiceProduct[]>(
    `/service-products${qs ? `?${qs}` : ""}`,
    { auth: false }
  );
}

export function listMyOrders(params?: OrderListQuery) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  return requestMp<{ orders: ServiceOrder[] }>(`/orders${qs ? `?${qs}` : ""}`, { auth: true });
}
```

（若已有 `listServiceProducts`，只补 `category` 与 `listMyOrders`，避免重复。）

---

### Task 6: Catalog UI — bee 式分类列表

**Files:**
- Modify: `patient-uniapp/src/pages/services/catalog.vue`

- [ ] **Step 1: 顶部分类 chips + 列表**

分类：全部 / 康复服务包 / 复诊相关 / 其他 → 对应 `'' | rehab | followup | other`。  
选中后调 `listServiceProducts({ doctorId, category })`。  
列表项：封面（无则图标）、标题、副标题、价格、点击进详情。

布局参考 bee 列表密度，但沿用春雨绿白视觉与现有字号 token（与首页一致）。

- [ ] **Step 2: 构建**

Run: `cd patient-uniapp && npm run build:mp-weixin`  
Expected: DONE Build complete.

---

### Task 7: Detail polish（封面 + 价格）

**Files:**
- Modify: `patient-uniapp/src/pages/services/detail.vue`

- [ ] **Step 1:** 有 `cover` 时顶部全宽图；价格区展示服务费/商品/运费/合计（已有字段则强化排版）。  
CTA「立即购买」→ checkout，逻辑不变。

- [ ] **Step 2:** build 同上。

---

### Task 8: 我的订单 + 订单详情页

**Files:**
- Create: `patient-uniapp/src/pages/services/orders.vue`
- Create: `patient-uniapp/src/pages/services/order-detail.vue`
- Modify: `patient-uniapp/src/pages.json`

- [ ] **Step 1: 注册 pages.json**

在 `pages/services` 分包增加：

```json
{ "path": "orders", "style": { "navigationBarTitleText": "我的订单", "navigationBarBackgroundColor": "#F4F7F3" } },
{ "path": "order-detail", "style": { "navigationBarTitleText": "订单详情", "navigationBarBackgroundColor": "#F4F7F3" } }
```

- [ ] **Step 2: `orders.vue`**

- Tab 映射：

| UI Tab | status 查询 |
|--------|-------------|
| 待付款 | `pending_payment` |
| 待资料 | `paid_pending_profile` |
| 审核中 | `pending_review` |
| 已开通 | `active` |
| 退款/关闭 | 客户端拉全量后过滤 `refunding|refunded|closed_timeout`，或多次请求合并（S1 可简化为两次：无 status + 前端 filter） |

S1 推荐：每个 Tab 传对应 `status`；「退款/关闭」用前端对 `listMyOrders()` 全量（limit 50）过滤三种状态。

- 列表项：标题（snapshot）、金额、状态文案、点击 → `order-detail?id=`

- [ ] **Step 3: `order-detail.vue`**

- `GET /orders/:id` 已有 → 展示进度：待支付 → 已支付 → 已填资料 → 审核中 → 已开通。  
- 操作：  
  - `pending_payment` → 调 pay / 回 checkout  
  - `paid_pending_profile` → onboarding  
  - `active` 且有 instanceId → instance  
  - 其它只读 + 联系说明  

- [ ] **Step 4: build**

---

### Task 9: 三支柱入口同级

**Files:**
- Modify: `patient-uniapp/src/constants/mineDefaults.ts`
- Modify: `patient-uniapp/src/pages/mine/index.vue`（若入口被 normalize 覆盖，同步 `renameCopilotLabels` / mine normalize）
- Modify: `patient-uniapp/src/pages/services/index.vue`
- Modify: `patient-uniapp/src/pages/index/index.vue`（仅确认，不削弱档案）

- [ ] **Step 1: 我的 — serviceEntries 增加「我的订单」**

```typescript
{ key: "orders", icon: "asset-services", title: "我的订单", sub: "", url: "/pages/services/orders", tone: "green" },
{ key: "services", icon: "asset-services", title: "我的服务", sub: "", url: "/pages/services/mine-services", tone: "green" },
```

放在「我的服务」旁；健康档案相关 `healthEntries` **不得删减**。

- [ ] **Step 2: 健康服务中心**

增加明显入口：「服务包目录」「我的订单」；保留医生切换与档案/计划快捷，避免只剩商城。

- [ ] **Step 3: 首页抽查**

确认快捷「健康档案」仍在；「医生管家」仍进 catalog。不改咨询 Tab。

- [ ] **Step 4: 若 `normalizeMineAssetsLabels` 会丢掉新 key，补映射到 `/pages/services/orders`。**

---

### Task 10: 端到端验收 + 回归三支柱

- [ ] **Step 1: 后端冒烟**

`cd app && node _service_package_test.js` → 全绿。

- [ ] **Step 2: 小程序**

`cd patient-uniapp && npm run build:mp-weixin` → 成功；开发者工具清缓存。

手工：

1. 打开健康档案页  
2. 打开咨询 Tab，能发消息或进入会话  
3. 目录分类 → 详情 → 下单 → mock 支付 → 支付结果  
4. 我的订单各 Tab → 订单详情 → 填资料（若状态需要）  
5. 我的服务仍可见实例/订单  

- [ ] **Step 3: 管理端**

商品改分类/封面 → 小程序目录反映；订单审核流仍可用。

- [ ] **Step 4: 更新规格状态旁注「S1 已实现」或在 plan 顶部勾选完成（实现完成后）。**

---

## Spec coverage check

| Spec §4 项 | Task |
|------------|------|
| 目录分类+列表 | 1,2,6 |
| 详情强化 | 7 |
| 确认订单/支付结果（保留） | 既有；8 链回 |
| 我的订单 Tab | 8 |
| 订单详情进度 | 8 |
| 健康服务中心分工 | 9 |
| 我的服务保留 | 9 |
| 入口同级 | 9 |
| 后台分类封面上下架 | 4 |
| 订单列表 API | 3 |
| mock 支付不变 | 不改 providers |
| 档案/咨询不回退 | 9,10 |

## Placeholder scan

无 TBD；S2–S6 不在本 plan。

## Type consistency

- 分类：`rehab` | `followup` | `other`  
- 订单 status 与现有状态机一致  
- 路由：`GET /api/mp/orders` 列表；`GET /api/mp/orders/:id` 详情  

---

## Execution handoff

Plan complete and saved to `app/docs/superpowers/plans/2026-08-06-s1-service-mall-skeleton.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 新开子代理，任务间评审  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?
