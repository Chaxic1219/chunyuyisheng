# 健康服务台大改版 — 实施计划（首期）

**规格：** `2026-08-06-health-service-desk-mall-design.md`

## 文件

- `patient-uniapp/src/pages/services/index.vue` — 服务台首页大改  
- `patient-uniapp/src/pages/services/catalog.vue` — 类目+列表商城化微调  
- `patient-uniapp/src/pages/services/detail.vue` — 底栏加购/开通/咨询  
- `patient-uniapp/src/pages.json` — 标题「健康服务台」可选  
- 管理端：仅当封面/类目展示缺口时补（默认跳过）

## 任务

1. 重写 `index`：待办（订单统计+进行中）+ 四格 + 推荐商品列表  
2. `catalog`：强化类目 chip 与卡片跳转 detail  
3. `detail`：对齐商城 goods-action（加购、立即开通、咨询）  
4. `build:mp-weixin`
