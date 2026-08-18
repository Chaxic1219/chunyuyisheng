# S3 优惠券 × 营销 Implementation Plan

> **Automated verification:** PASS — 2026-08-06 (`node _service_package_test.js` 21/21; `build:mp-weixin`; static checks OK)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 医生维度优惠券模板 + 领取 + 结算抵扣 + 支付核销；权益页真实数据；mock 支付。

**Architecture:** 新表 `svc_coupon_templates` / `svc_coupons`；`coupons.js` 模块；订单增加 discount/payable；支付成功核销；管理端 CRUD；小程序 rights/checkout 改造。

**Tech Stack:** 同 S1/S2 servicePackage + uni-app + admin-ui

**Spec:** `app/docs/superpowers/specs/2026-08-06-s3-service-coupons-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `schema.js` | 两表 + orders 列 discount/payable/coupon_id |
| `coupons.js` | **新建** claim/list/quote/lock/unlock/redeem |
| `orders.js` | createOrder 接受 couponId；写折后应付 |
| `payments.js` | markPaid / mock 后 redeem；关单 unlock |
| `adminCoupons.js` | **新建** 模板 CRUD/发放 |
| `index.js` | 装配 |
| `mp-service-package.js` / `service-package-admin.js` | 路由 |
| `_service_package_test.js` | 报价/领取/下单核销/关单退回 |
| `patient-uniapp` api + rights + checkout | |
| `admin-ui` 优惠券页 + 路由菜单 | |

---

### Task 1: Schema

- [ ] 建 `svc_coupon_templates`、`svc_coupons`  
- [ ] `ensureColumn`：`svc_orders.coupon_id`、`discount_amount_cents`、`payable_amount_cents`  
- [ ] 旧单：`payable` 为空时读路径回退 `total_amount_cents`  
- [ ] 测试表存在  
- [ ] `node _service_package_test.js` PASS；不 commit  

---

### Task 2: coupons.js + quote/claim

```javascript
// createCoupons(db, catalog)
// listClaimableTemplates(personId, doctorId)
// claim(personId, templateId)
// listMine(personId, { status })
// quote({ personId, doctorId, subtotalCents, couponId }) → { discountCents, payableCents, coupon }
// assertUsable(personId, couponId, doctorId, subtotalCents)
```

规则：

- fixed: subtotal >= threshold → discount = min(discount_cents, subtotal - 1)  
- percent: discount = min(floor(subtotal * percent_off / 100), max_discount or inf, subtotal - 1)  
- payable = max(1, subtotal - discount)  

测试：claim、quote fixed、超限拒绝。  

---

### Task 3: createOrder + lock coupon

- [ ] `createOrder`：`couponId` 可选；subtotal = 行合计 total；quote；写 coupon_id/discount/payable；头 `total_amount_cents` **保持折前**；支付用 payable  
- [ ] 创建成功将券 `locked` + order_id  
- [ ] `mapOrder` 返回 discountAmountCents、payableAmountCents、couponId  
- [ ] 测试：带券下单 payable 正确、券 locked  

---

### Task 4: payments redeem / unlock

- [ ] `markPaid` / mock auto：`coupons.redeem(orderId)` → used  
- [ ] `closeExpiredPending` 或关单路径：`unlockByOrder(orderId)` → available  
- [ ] `fullRefund`（驳回）：券 `void`（按规格）  
- [ ] 支付金额校验使用 payableAmountCents  
- [ ] 测试：支付后 used；超时后 available  

---

### Task 5: Admin coupons API + UI

- [ ] `adminCoupons.js` + routes under `/api/admin/coupon-templates`  
- [ ] admin-ui 新页面：列表/创建/编辑/上下架/按 personId 发放  
- [ ] 菜单入口「优惠券」（chunyu 路由模块）  

---

### Task 6: Miniapp API + rights.vue

- [ ] `servicePackage.ts`：listClaimable、claim、listMyCoupons、quoteCoupon  
- [ ] `rights.vue`：拉取 mine 列表分 Tab 可用/已用/过期；空态保留说明  
- [ ] 可选简单领券入口（rights 内嵌可领列表）  

---

### Task 7: checkout 选券

- [ ] checkout 加载可用券（quote 或 mine available + doctor 匹配）  
- [ ] 选择后展示应付；提交带 couponId  
- [ ] 无券路径回归  
- [ ] build:mp-weixin  

---

### Task 8: E2E

- [x] 全量 `_service_package_test.js`  
- [x] build  
- [x] 静态：健康档案入口仍在；无新 Tab  
- [x] 计划文件顶部标注自动化通过  

---

## Spec coverage

| 项 | Task |
|----|------|
| 模板两类 | 1–2,5 |
| 领取/我的券 | 2,6 |
| 结算抵扣 | 3,7 |
| 核销/解锁/void | 4 |
| 管理端 | 5 |
| 三支柱 | 6–8 |

---

## Execution handoff

Plan: `app/docs/superpowers/plans/2026-08-06-s3-service-coupons.md`

**1. Subagent-Driven（推荐）**  
**2. Inline Execution**

Which approach?
