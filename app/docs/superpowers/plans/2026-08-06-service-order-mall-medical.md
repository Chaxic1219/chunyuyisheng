# 服务包订单商城化 — 实施计划

**规格：** `2026-08-06-service-order-mall-medical-design.md`

## 文件

- `patient-uniapp/src/api/servicePackage.ts` — `cancelServiceOrder`；补齐 `doctorId`
- `patient-uniapp/src/pages/services/mine-services.vue` — 订单 Tab A + 商城式卡片/操作/角标
- `patient-uniapp/src/pages/services/order-detail.vue` — 医疗区块 + 底栏操作 + 咨询
- `patient-uniapp/src/pages/services/checkout.vue` — 轻量医疗文案（可选）

## 任务

1. API：`POST /orders/:id/cancel-request` 封装  
2. 列表：ORDER_TABS=全部+四态；badges；行内按钮；支付/取消/补资料/售后  
3. 详情：服务信息 / 资料进度 / 费用 / 底栏  
4. `npm run build:mp-weixin`
