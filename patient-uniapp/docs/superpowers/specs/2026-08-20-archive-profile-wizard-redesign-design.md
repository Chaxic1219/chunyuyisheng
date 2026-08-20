# 更新档案页 · 分步向导 + 手风琴重设计

**日期：** 2026-08-20  
**状态：** 已实现  
**范围：** `patient-uniapp` `/pages/archive/profile` 编辑态；`PatientForm` 向导/手风琴/Chip 能力  
**非范围：** 查看态 UI、后端 API、其他建档入口（邀请页等默认表单样式不变）

## 决策

- **布局：** A 分步向导 + C 手风琴（第 3 步）
- **配色：** 沿用春雨绿 `#2aa876` / `#1f8a64`
- **多选：** Chip 标签替代竖条 checkbox 列表

## 三步结构

| 步骤 | 字段 |
|------|------|
| 1 基本信息 | 头像（页级）、姓名、性别、出生日期、手机号 |
| 2 体征信息 | 血型、身高、体重、健康备注；顶部 BMI/年龄预览 |
| 3 健康档案 | 手风琴：当前病情 / 过敏信息 / 疾病史 / 门诊凭证 |

## 交互

- 顶部进度条 + 步骤标题；底部固定「上一步 / 下一步 / 保存更新」
- 第 1 步字段列表行（标签左、值右）；第 3 步多选 Chip
- 协议勾选仅第 3 步；提交走 `PatientForm.submit()` expose
- 已有档案用户可点「返回查看」退出编辑

## 实现

- `profile.vue`：向导壳层、`WIZARD_STEPS`、`HEALTH_ACCORDION`
- `PatientForm.vue`：`visibleFieldKeys`、`accordionSections`、`checkboxVariant`、`fieldLayout`、`hideSubmit` 等；`validate({ fieldKeys, requireConsent })` expose
