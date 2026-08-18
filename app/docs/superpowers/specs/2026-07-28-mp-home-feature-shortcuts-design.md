# 小程序首页功能补齐设计

日期：2026-07-28  
范围：`patient-uniapp` 首页（`pages/index/index`）  
状态：待审阅

## 目标

首页在去掉医生专属入口后偏空。在不恢复医生名片/门诊/饮食/风采等专属内容的前提下，把小程序内已有的**平台通用功能**以捷径形式放回首页，形成「待办 + 服务 + 资料」结构。

## 非目标

- 不新增后端接口或新页面
- 不恢复特定医生展示（姓名、门诊时间、医生风采等）
- 不把「邀请建档（演示）」放到首页
- 不改 Tab 结构（仍为 首页 / 咨询 / 我的）

## 信息架构

保留现有顶部品牌栏与待办卡（完善档案 / 去咨询 / 待跟进）。其下增加两组 `FnGroup` 列表：

### 1. 服务申请

| key | 标题 | 副文案 | 跳转 |
|-----|------|--------|------|
| add | 门诊加号 | 提交加号需求 | `/pages/form/add`（需登录） |
| adm | 住院预约 | 术前准备与排期登记 | `/pages/form/admission`（需登录） |
| contact | 医患联络表 | 补充基础信息 | `/pages/form/contact`（需登录） |

### 2. 我的资料

| key | 标题 | 副文案 | 跳转 |
|-----|------|--------|------|
| profile | 患者档案填写 | 基本信息、病史与用药情况 | `/pages/archive/profile`（需登录） |
| health | 健康记录 | 分类查看健康资料 | `/pages/archive/health`（需登录） |
| replies | 查看回复 | 申请与跟进进度 | `/pages/replies/index`（需登录） |
| faq | 常见问题 | 咨询、加号与隐私说明 | `/pages/faq/index`（无需登录） |

## 交互

- 需登录入口统一走现有 `ensureLogin`；登录后按目标页 `navigateTo` / Tab `switchTab`
- 文案与图标 key 与「我的」页对齐，复用 `FnGroup` / `AppIcon` 已有映射
- 首页与「我的」允许入口重复：首页是捷径，我的是完整中心

## 实现要点

- 仅改 `patient-uniapp/src/pages/index/index.vue`（扩展 `secondaryItems` 为两组或拆成两个 computed + 两个 `FnGroup`）
- 更新 `open(key)` 路由表与门禁集合，与「我的」页一致
- 更新 `tests/ui-contract.test.mjs`：首页应匹配加号/档案等入口，且仍禁止 `DoctorCard` / 医生姓名拼接
- 重建 `pnpm run build:mp-weixin`

## 验收

1. 首页待办卡下方可见「服务申请」「我的资料」两组入口
2. 点击加号/住院/联络表/档案/健康记录/回复：未登录会走登录；已登录进入对应页
3. 常见问题可直接进入
4. 页面无特定医生姓名、门诊时间、医生风采等专属入口
