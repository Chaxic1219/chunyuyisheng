# S5 售后与服务资产 Implementation Plan

> **For agentic workers:** Use subagent-driven-development. No commit unless user asks.

**Goal:** 售后工单 + 服务资产页；已支付可退；已开通仅人工工单。

**Spec:** `app/docs/superpowers/specs/2026-08-06-s5-after-sales-assets-design.md`

---

### Task 1: Schema svc_after_sales + tests table exists

### Task 2: afterSales.js module (create/list/approve/reject) + wire index

### Task 3: MP routes + admin routes

### Task 4: Admin UI after-sales page + menu

### Task 5: Miniapp API + refund-apply + assets pages + pages.json + mineDefaults entries

### Task 6: order-detail CTA + after-sales.vue polish

### Task 7: E2E tests + build + mark docs

- [x] Full `_service_package_test.js` (afterSales pending_payment / paid / active paths)
- [x] `npm run build:mp-weixin` in patient-uniapp
- [x] Static: `svc_after_sales` schema, MP/admin routes, `assets.vue`, `refund-apply`, admin `service-after-sales`, `healthEntries` 健康档案 intact, tabBar still 3 items
- [x] Mark plan/spec automated pass

Each task: implement, run `_service_package_test.js` when backend changes, build miniapp when UI changes, no commit.

---

## Verification (2026-08-06)

| Check | Result |
|-------|--------|
| `_service_package_test.js` | PASS (32 tests incl. afterSales) |
| `build:mp-weixin` | PASS |
| Static grep | PASS |
| Commit | skipped per user |
