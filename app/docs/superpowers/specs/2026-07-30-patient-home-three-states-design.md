# 患者端首页三态设计

**日期:** 2026-07-30  
**状态:** 已批准实施中

## 判定

`alert` 有值 → abnormal；否则有 `plan` → task；否则 → empty。

## Feed 扩展

- `alert`：高优异常卡（图二）
- `softNotice`：轻提醒条（图一续方等）
- `notice`：异常期说明条
- `subtitle`：问候副文案
- `plan.modeTag` / `plan.progressLabel`
- 异常态 `recommendations = []`

## UI

去掉深绿 brandbar；顶栏问候+铃铛；三态主卡按设计稿；快捷/档案/服务模块沿用既有卡片样式。
