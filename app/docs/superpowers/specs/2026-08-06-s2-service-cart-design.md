# S2 购物车 × 多行订单 — 设计规格

**日期：** 2026-08-06  
**状态：** S2 已实现（automated verification passed 2026-08-06；原批准 2026-08-06「继续」）  
**上级规格：** `2026-08-06-bee-style-service-mall-three-pillars-design.md`  
**前置：** S1 商城骨架已落地（分类目录、单品下单、我的订单）  
**硬约束延续：** 三支柱并列；不削弱档案/咨询；不接 api工厂；支付仍 mock（真支付属 S4）

---

## 1. 目标

在服务包支柱内补齐 bee 式购物车能力：

1. 详情可「加入购物车」或「立即购买」  
2. 购物车：改数量、删除、按**当前服务医生**隔离  
3. 结算生成**一笔订单、多行明细**；金额服务端汇总  
4. 管理端订单详情展示多行  
5. 支付/状态机仍走现有 mock 链路；档案与咨询入口不回退  

---

## 2. 关键决策

### 2.1 购物车存哪里

**采用服务端购物车**（`svc_cart_items`），按 `person_id + doctor_id` 隔离。

| 方案 | 结论 |
|------|------|
| 仅本地 storage | 换机丢失、难对账；否 |
| 服务端表 | 可审计、与医生租户一致；**是** |

未登录：加购前 `ensureLogin`（与下单一致）。

### 2.2 一单多行 vs 多单

**采用一单多行**（`svc_order_lines` + 订单头）。

- 一次支付、一个 `order_no`、一个支付单。  
- 跨医生商品**禁止**同车结算：加购时若 `version.doctorId !== cart.doctorId`，提示清空或切换医生。  
- 数量：S2 默认每个服务包 `qty` 为 1～N（上限 5）；同一 `version_id` 合并数量。

### 2.3 履约（开通）语义

多行订单支付成功后：

- 整单仍走：`pending_payment → paid_pending_profile → pending_review → active`  
- **术后资料**：S2 仍**整单一份** profile（与现网一致，降低复杂度）  
- **开通**：审核通过后为**每一行**创建一个 `svc_instances`（标题取该行快照）；订单头 `instance_id` 指向**第一行**实例（兼容旧字段），全部实例挂 `order_id`  

若某行商品不需要资料：仍共用整单 profile 门槛（S2 不拆分）。

### 2.4 「立即购买」

保留直购：不经过购物车，仍走现有单行 `createOrder`（内部可写成 1 行 `order_lines`，便于统一读模型）。

---

## 3. 数据模型

### 3.1 `svc_cart_items`

| 列 | 说明 |
|----|------|
| id | PK |
| person_id | 患者 |
| doctor_id | 车所属医生 |
| version_id | 商品版本 |
| qty | 1–5 |
| created_at / updated_at | |
| UNIQUE(person_id, version_id) | 同版本合并 |

换医生清空或拒绝混加（实现：加购校验 doctor_id 一致，否则 409 `cart_doctor_mismatch`）。

### 3.2 `svc_order_lines`

| 列 | 说明 |
|----|------|
| id | PK |
| order_id | FK |
| product_id / version_id | |
| qty | |
| title / snapshot_json | 行级快照 |
| service/goods/shipping/total_amount_cents | **单价 × qty 后的行合计**（服务端算） |

### 3.3 `svc_orders` 头表兼容

- 保留 `product_id` / `version_id` = **首行**（兼容旧列表/详情）  
- `*_amount_cents` = **各行汇总**  
- `snapshot_json` 增加 `lines: [...]` 摘要（可选冗余，便于旧客户端）  
- `instance_id` = 首行实例；实例表继续 `order_id` 关联，可多行  

单行旧订单：无 `order_lines` 时，读接口从头表合成一行（兼容 S1 数据）。

---

## 4. API（患者）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/mp/cart?doctorId=` | 当前医生购物车 + 服务端重算金额 |
| POST | `/api/mp/cart/items` | body: `{ versionId, qty?, doctorId }` 加购/改数 |
| PATCH | `/api/mp/cart/items/:id` | `{ qty }`；qty=0 删除 |
| DELETE | `/api/mp/cart/items/:id` | 删除 |
| DELETE | `/api/mp/cart?doctorId=` | 清空该医生车 |
| POST | `/api/mp/orders` | **扩展**：`{ items:[{versionId,qty}], ...收货/协议 }` 或保留旧 `{ versionId }` 单行 |
| GET | `/api/mp/orders/:id` | 响应增加 `lines[]` |

金额：**禁止**信任前端 total；一律按当前 published version 重算。

---

## 5. 小程序页面

| 页面 | 行为 |
|------|------|
| `detail.vue` | 双 CTA：「加入购物车」「立即购买」 |
| **新建** `cart.vue` | 列表、步进器、合计、去结算；空态引导目录 |
| `checkout.vue` | 支持从购物车进入（展示多行）；提交 `items[]`；提交成功后清空对应车 |
| 入口 | 健康服务中心 / 目录顶栏 / 我的（可选「购物车」）；**不新增 Tab** |
| `order-detail.vue` | 展示多行明细 |
| 档案、咨询 | 不动主链 |

视觉：延续春雨绿白与 S1 字号 token。

---

## 6. 管理后台

- 服务订单详情：表格展示多行（标题、数量、行金额、小计）  
- 列表仍显示订单总价 + 首行标题（或「等 N 项」）  
- 审核通过/驳回：整单维度（与现网一致）；开通侧按行建实例  

---

## 7. 状态机与支付

不变：

```text
pending_payment → paid_pending_profile → pending_review → active
```

mock 支付、超时关闭、驳回全额退款逻辑沿用；退款金额 = 订单头 `total_amount_cents`。

---

## 8. 明确不做（S2）

- 跨医生混结、优惠券（S3）、真微信支付（S4）  
- 购物车分享、失效商品自动替换策略以外的复杂推荐  
- 按行分别填资料 / 分别支付  
- 餐饮外卖/桌号等 bee 专属能力  

---

## 9. 验收（DoD）

- [ ] 同医生多包可加购、改数量、删除、清空  
- [ ] 跨医生加购被拒绝或需先清空，文案明确  
- [ ] 结算一单多行；服务端金额正确；mock 支付成功  
- [ ] 订单详情与管理端可见多行  
- [ ] 审核通过后每行有服务实例；我的服务可看到  
- [ ] 立即购买（单行）仍可用  
- [ ] 健康档案、AI 咨询入口与功能无回退  

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| 多实例与旧 `instance_id` | 头字段指首行；列表按 `order_id` 查全部实例 |
| 车内商品下架 | GET cart 时标记 `unavailable`，结算排除并提示 |
| 与 S1 单行订单共存 | 读路径无 lines 时合成单行 |

---

## 11. 审阅请求

请主人确认本 S2 规格（尤其 **服务端购物车**、**整单一份资料 + 按行开通实例**）。  

回复 **批准** 后编写 `plans/2026-08-06-s2-service-cart.md` 并再选执行方式；批准前不写业务代码。
