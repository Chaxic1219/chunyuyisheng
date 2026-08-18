# 运营数据大盘完善

日期：2026-07-16  
状态：已实现（对齐 7/15 会议：医生看板 + 全平台大盘 + 分享图）

## 目标

- 全平台汇总（覆盖医生 / 档案 / 业务群 / 成员 / 7 日入站 / 线索）
- 医生个人看板（价值指标 + 原有运营图表）
- 一键导出 PNG 分享图，运营微信发给医生（医生无需开后台）

## API

`GET /api/admin/dashboard?scope=doctor|platform&doctorId=`

- `scope=doctor`：需 doctorId + 医生归属 gate
- `scope=platform`：按 adminScope 过滤医生；super 看全部

## UI

`/dashboard`：切换「全平台大盘 / 医生看板」；医生看板含分享卡预览与「导出医生分享图」。
