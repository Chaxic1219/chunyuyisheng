# 健康服务中心精简 — 实施计划

**规格：** `2026-08-06-services-hub-slim-redesign.md`  
**日期：** 2026-08-06

## 任务

1. `services/index`：Hub 改为 2×2（目录/购物车/我的服务/去咨询）；去掉类目网格与中心产品列表；保留目录+健康计划引导行
2. `mine-services`：顶栏快捷（券/售后/协议/咨询）+ Tab 进行中|订单；订单态 chips 承接原 orders 页
3. `assets` / `orders` 改为 redirect 兼容页
4. `mineDefaults`、档案条、售后/退款入口统一指向 mine-services
5. 构建 `npm run build:mp-weixin`

## 完成标准

- 中心页入口 ≤4；无重复订单/资产入口
- 「我的」仅保留「我的服务」统一入口
- 旧 deep link `/assets` `/orders` 仍可达
