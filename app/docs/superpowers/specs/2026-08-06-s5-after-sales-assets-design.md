# S5 售后与服务资产 — 设计规格

**日期：** 2026-08-06  
**状态：** S5 automated verification **PASS**（2026-08-06）— 自动化全绿；待主人 manual QA（真机售后申请 + 管理端审核）  
**前置：** S1–S4  
**硬约束：** 三支柱不削弱；支付/退款走现有 provider；开通后部分退仅人工工单

---

## 1. 目标

1. 患者可对订单发起**取消/退款申请**并查看进度  
2. 「服务资产」页：有效实例摘要 + 快捷入口（订单/券/售后）  
3. 管理端**售后工单**列表：审核通过→全额退；拒绝→恢复原状态说明  
4. 开通后（`active`）申请：创建工单，**不自动退款**，后台人工处理备注  
5. 发票说明保留在售后页，可链到咨询  

---

## 2. 数据：`svc_after_sales`

| 列 | 说明 |
|----|------|
| id | PK |
| order_id, person_id, doctor_id | |
| type | `cancel_unpaid` / `refund_paid` / `refund_active` |
| status | `open` / `approved` / `rejected` / `closed` |
| reason TEXT | 用户原因 |
| admin_note TEXT | |
| refund_amount_cents | 申请金额（默认整单 payable） |
| created_at, updated_at, closed_at | |

---

## 3. 业务规则

| 订单状态 | 申请类型 | 自动动作 |
|----------|----------|----------|
| pending_payment | cancel_unpaid | 关单 closed + 解锁券（沿用 requestCancel） |
| paid_pending_profile / pending_review | refund_paid | 工单 open；**或**直接走现有 cancel→refunding→fullRefund（S5 采用：创建工单后管理端一键同意调用 fullRefund） |
| active | refund_active | 仅工单，不自动 refund |
| refunding/refunded/closed_* | 不可再申请 | |

一单一条 open 工单上限。

---

## 4. API

患者：
- `POST /api/mp/orders/:id/after-sales` `{ reason, type? }`
- `GET /api/mp/after-sales` / `GET /api/mp/after-sales/:id`
- `GET /api/mp/service-assets` → `{ instances, openTickets, couponAvailableCount }`

管理：
- `GET /api/admin/after-sales`
- `POST /api/admin/after-sales/:id/approve`（paid 类调 fullRefund；active 类只关单+备注）
- `POST /api/admin/after-sales/:id/reject` `{ note }`

---

## 5. 小程序 / 后台

- 新建 `refund-apply.vue`（或扩 after-sales）；订单详情入口「申请售后」  
- 新建 `assets.vue` 服务资产；我的页入口  
- 充实 `after-sales.vue` 链到申请与工单列表  
- admin-ui：`service-after-sales/index.vue` + 菜单  

---

## 6. 不做

- 自动部分退款计算、开票系统对接、物流退货  

---

## 7. DoD

- [x] 待支付可取消；已支付可申请退款并后台同意退款（automated: afterSales tests）  
- [x] 已开通申请仅生成工单（automated: active path no refund）  
- [x] 资产页可见实例（`assets.vue` + `GET /api/mp/service-assets` wired）  
- [x] 档案/咨询无回退；测试+build 通过（healthEntries 健康档案 unchanged; tabBar 3 items）  
- [ ] Manual QA: 真机申请售后 + admin 同意/拒绝流程  
