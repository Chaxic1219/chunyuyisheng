# S3 优惠券 × 营销 — 设计规格

**日期：** 2026-08-06  
**状态：** S3 implemented (automated) — 2026-08-06 E2E PASS  
**上级规格：** `2026-08-06-bee-style-service-mall-three-pillars-design.md`  
**前置：** S1 商城骨架、S2 购物车/多行订单已落地  
**硬约束：** 三支柱并列；券绑定**服务医生**；金额服务端计算；支付仍 mock（S4）；不接 api工厂

---

## 1. 目标

1. 管理端可配置券模板并上下架、手动发放  
2. 患者可领取/查看「我的优惠券」；权益页接真实数据  
3. 结算页可选一张可用券；应付金额 = 服务端（商品合计 − 抵扣），下限 0.01 元（1 分）除非全额券另定——**S3：抵扣后最低 1 分**  
4. 支付成功（含 mock）后核销；关单/驳回退款时未核销券退回可用  
5. 不削弱档案与 AI 咨询  

---

## 2. 券类型（S3 仅两类）

| type | 含义 | 字段 |
|------|------|------|
| `fixed` | 满减固定金额 | `threshold_cents`（订单商品合计达到才可用）、`discount_cents` |
| `percent` | 折扣 | `threshold_cents`、`percent_off`（1–99，表示减百分之 N）、`max_discount_cents`（封顶，0=不封顶） |

**叠加：** 一单仅一张券；不与其他活动叠加。  
**范围：** `doctor_id` 必填；可选 `category` 限制（空=该医生全部上架包）。  
**库存：** 模板 `total_quota`（0=不限）+ `claimed_count`；用户领取生成 `svc_coupons` 实例。

---

## 3. 数据模型

### `svc_coupon_templates`

| 列 | 说明 |
|----|------|
| id, doctor_id, title, type | |
| threshold_cents, discount_cents, percent_off, max_discount_cents | |
| category | 可空 |
| status | `draft` / `active` / `offline` |
| total_quota, claimed_count, per_user_limit | per_user_limit 默认 1 |
| starts_at, ends_at | 可空=不限 |
| created_at, updated_at | |

### `svc_coupons`（用户持券）

| 列 | 说明 |
|----|------|
| id, template_id, person_id, doctor_id | |
| status | `available` / `locked` / `used` / `expired` / `void` |
| discount_snapshot_cents | 下单锁定时写入预计抵扣 |
| order_id | 核销/锁定关联 |
| claimed_at, locked_at, used_at, expires_at | |

### 订单头扩展

`svc_orders` 增加（ensureColumn）：

- `coupon_id` INTEGER  
- `discount_amount_cents` INTEGER NOT NULL DEFAULT 0  
- `payable_amount_cents` — **若无此列：应付以 `total_amount_cents` 存折后价，另用 `goods_subtotal_cents` 存折前**  

**采用更清晰方案：**

- 保留现有 `service/goods/shipping/total_amount_cents` 为**折前**行汇总（与 S2 一致）  
- 新增 `discount_amount_cents`、`payable_amount_cents`（应付= max(1, total - discount)）  
- 支付/退款金额改用 `payable_amount_cents`（无列旧单则回退 total）

---

## 4. 状态与核销时机

```text
领取 → available
下单成功(pending_payment) → locked（绑定 order_id）
支付成功 → used
pending 超时关闭 / 用户取消未支付 → 解锁回 available
审核驳回全额退款 → 若已 used：S3 将券置 void（不自动退回可再用以防套利）；文档注明
```

计算 `quoteDiscount(personId, doctorId, subtotalCents, couponId)` 仅服务端。

---

## 5. API

### 患者

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/mp/coupons/templates?doctorId=` | 可领列表（active + 未超限） |
| POST | `/api/mp/coupons/claim` | `{ templateId }` |
| GET | `/api/mp/coupons/mine?status=` | 我的券 |
| GET | `/api/mp/coupons/quote` | `doctorId, subtotalCents, couponId?` 试算 |
| POST | `/api/mp/orders` | body 增加可选 `couponId` |

### 管理端

| Method | Path | 说明 |
|--------|------|------|
| CRUD | `/api/admin/coupon-templates` | 按 doctorId |
| POST | `.../publish` `.../offline` | |
| POST | `.../grant` | `{ personId }` 或手机号查人——S3 用 personId |
| GET | `/api/admin/coupons` | 发放/核销记录筛选 |

---

## 6. 小程序 / 后台 UI

| 面 | 行为 |
|----|------|
| `rights.vue` | 我的可用/已用/过期券列表；去领取入口 |
| **新建** `coupon-claim.vue` 或目录顶「领券」 | 展示可领模板 |
| `checkout.vue` | 可选券列表 + 应付展示；无券可跳过 |
| 管理端 | 新菜单「优惠券」：模板 CRUD + 发放 + 记录 |
| Tab / 档案 / 咨询 | 不改 |

---

## 7. 明确不做（S3）

- 多券叠加、满赠、秒杀、积分抵现  
- 跨医生通用券  
- 真支付（S4）  
- 退款后自动恢复 used→available（S3 void；S5 可再议）  

---

## 8. 验收 DoD

- [ ] 后台创建 fixed/percent 券并上架  
- [ ] 患者领取、权益页可见  
- [ ] 结算选用券后应付正确（服务端）；mock 支付后券 used  
- [ ] 超时关单券回 available  
- [ ] 无券下单仍可用  
- [ ] 档案、咨询无回退  

---

## 9. 审阅

本规格随「继续」视为批准方向；实现计划见 `plans/2026-08-06-s3-service-coupons.md`。若需收窄（例如仅 fixed），请在执行前说明。
