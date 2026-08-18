# 患者端小程序 · V3.2 第一期自主健康闭环设计

**日期：** 2026-07-30  
**状态：** 已批准（待实施计划）  
**范围：** `patient-uniapp` + `app` 后端 `/api/mp/v32`；ColorUI 视觉对齐；出图任务包  
**前序：**

- `春雨患者端小程序升级上下文交接.md`（Codex 已做 ColorUI 壳与 mock 回退）
- `春雨健康管理服务平台完整产品需求文档_PRD_V3.2.md`
- 交互原型：`index.html`（13 场景）
- `2026-07-23-patient-miniprogram-ia-redesign-design.md`（三 Tab 骨架）

**工程目录：**

- 小程序：`C:\Users\11\Desktop\www\chunyu-doctor-review\patient-uniapp`
- 后端：`C:\Users\11\Desktop\www\chunyu-doctor-review\app`
- 组件库：ColorUI（`src/colorui`，来源 weilanwl/coloruicss）

---

## 1. 背景与问题

Codex 已将患者端升级为 V3.2 三 Tab（首页｜咨询｜我的），接入 ColorUI 与 App* 组件，并增加 `/api/mp/v32` 客户端调用。但：

1. 后端尚无 `/api/mp/v32/*` 实现，请求失败后**静默回退 mock**，不符合「真实功能与数据」要求。
2. 视觉与原型青绿体系未完全对齐（如 Tab 选中色仍为蓝）。
3. 健康计划 / 今日任务 / 档案确认 → 计划生成闭环未在服务端落地。
4. 插图与部分图标仍不完整或风格不统一，需交给 Codex Image Gen 批量产出。

## 2. 已锁定决策

| 项 | 决策 |
|----|------|
| 本期范围 | **PRD 第一期**：自主健康闭环与三入口 |
| 数据策略 | **后端补齐 `/api/mp/v32`**，复用现有档案 / 健康记录 / AI；默认**禁止静默 mock 回退** |
| 视觉策略 | **原型青绿 + ColorUI**；ui-ux-pro-max / impeccable 用于无障碍与节奏校验，**不重做品牌色** |
| 计划来源 | **档案链路**：上传/已有 → 确认抽取 → 模板生成计划与今日任务 |
| 双助手 | **现有 `/api/mp/ai-chat` + 意图路由增强**；人工转接仅入口与状态 |
| 不做 | 在线支付、医生共管接管、复杂家属 ACL、后台健康工作台大改、新 OCR 引擎 |
| 落地路径 | **方案 1**：后端契约先行 + 前端去 mock 回退 + 出图包并行 |

---

## 3. 成功标准

1. 登录用户首页 Feed 来自真实 `/api/mp/v32/home-feed`，无计划时为 HOME-001 空态，**不出现假进度**。
2. 用户可确认档案关键信息后生成计划草稿并启用；今日任务可完成并回写，首页完成度变化。
3. 咨询直进对话；消息可路由到健康助手或生活管家；支持切换；失败可重发。
4. 「我的」健康资产计数来自真实聚合，入口文案为「健康档案 / 健康计划 / 健康记录 / 家属管理」。
5. `USE_MOCK=false` 生产路径下，`requestV32` 失败展示错误态而非 clone mock。
6. `type-check`、`test:ui`、`build:mp-weixin` 通过；契约测试覆盖「禁止静默 mock」。
7. 出图任务压缩包可独立交付给 Codex 生成并接入 `src/static`。

---

## 4. 架构

```text
patient-uniapp (uni-app + ColorUI + App* 组件)
        │  HTTPS Bearer
        ▼
app  /api/mp/*（登录、档案、AI）+ /api/mp/v32/*（Feed、计划、任务、家属、服务目录）
        │
        ▼
现有 patients / archive / health-records / AI 会话
+ health_plans / health_plan_items / health_task_instances
+ health_metric_logs / family_members / feed_dismissals
```

### 4.1 关键约定

1. `doctor_id` 对健康计划可选；支持自主管理。
2. V3.2 聚合接口在服务端组装，前端不拼假数据。
3. mock 文件仅作单测夹具，不进默认运行路径。
4. 开发可用显式开关临时启用 mock（默认关）。

---

## 5. 页面与信息架构

### 5.1 Tab

| Tab | 职责 | 原型场景 |
|-----|------|----------|
| 首页 | 「现在最该做什么」；动态模块排序 | 01–03 |
| 咨询 | 直进对话；双助手；可切换 | 04–07 |
| 我的 | 长期资产与低频管理 | 12–13 |

### 5.2 二级闭环（一期）

| 页面 | 路径 | 能力 |
|------|------|------|
| 健康档案 | `pages/records/index` | 列表、待确认、确认；接现有上传 |
| 健康计划 | `pages/plans/detail` | 当前计划、今日任务、完成回写、启用/暂停 |
| 健康记录 | `pages/archive/health` | 指标/用药/过程记录 |
| 家属管理 | `pages/family/index` | 列表 + 邀请；复杂授权后置 |
| 健康服务 | `pages/services/index` | 只读目录与咨询引导；**无支付** |
| 登录绑定 | `pages/auth/bind` | 微信/短信现有能力 |

### 5.3 首页模块顺序（服务端排序）

1. 紧急/高优先级异常（有则置顶）  
2. 今日任务摘要  
3. 当前健康计划卡 →「查看健康计划」  
4. 健康档案卡 →「进入健康档案」/「继续确认」  
5. 快捷操作：上传档案、问用药、记录指标、预约复诊、健康服务  
6. 服务摘要（无合同可空）  
7. 推荐服务（可关闭、去重）

状态：HOME-001 无计划 / HOME-002 有计划 / HOME-004 异常优先。

### 5.4 「我的」结构

- 资料卡（完整度不足 → 完善档案）
- 健康资产四入口（名称优先，数量辅助）
- 服务与交易（一期只读/接现有回复）
- 设置入口（长辈模式、消息、隐私、导出删除）

### 5.5 弱化入口

旧服务申请、医生主页等不进首页枢纽；经生活管家或「我的」低频入口到达。

### 5.6 视觉壳

- Tab 选中色：原型青绿约 `#176b52`（替换 `#5D87FF`）
- ColorUI：`cu-card`、`bg-gradual-green`、`cu-chat`、`App*` 组件
- 长辈模式：触控 ≥ 44×44，关键字号可放大
- 品牌锚点取自原型，不以 ui-ux-pro-max 默认青蓝覆盖：

| Token | 值 |
|-------|-----|
| Primary | `#176b52` |
| Primary Dark | `#0c4535` |
| Soft Green | `#e5f3ec` |
| Background | `#f3f4ef` |
| Ink | `#17201c` |
| Muted | `#6a756f` |
| Amber | `#936015` |
| Danger | `#a33c33` |
| Blue | `#2c638e` |

设计校验（impeccable / ui-ux-pro-max）：高对比、无 emoji 图标、无紫粉 AI 渐变、焦点环可见、`prefers-reduced-motion`。

---

## 6. 数据流与接口

### 6.1 业务闭环

```text
上传/已有档案
  → 待确认抽取项
  → POST 生成计划草稿 → 启用
  → 每日任务实例
  → 完成回写 → 首页 Feed 重算
  → 咨询带 pageContext → 助手路由 →（可选）回写记录
```

### 6.2 新增存储（最小表）

| 对象 | 用途 |
|------|------|
| `health_plans` | 计划：draft/active/paused；自管模式；来源档案 |
| `health_plan_items` | 用药/指标/复诊模板项 |
| `health_task_instances` | 某日任务：pending/done/skipped |
| `health_metric_logs` | 指标记录 |
| `family_members` | 家属轻量列表 |
| `feed_dismissals` | 关闭的推荐卡 |

关联现有 `patient_id`，不新建平行用户体系。

### 6.3 `/api/mp/v32`（需登录）

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/home-feed` | 按优先级组装模块 |
| GET | `/mine-assets` | 健康资产真实计数 |
| GET | `/records` | 档案资料 + 待确认摘要 |
| POST | `/records/:id/confirmations` | 确认/修正抽取项 |
| POST | `/plans/generate` | 基于已确认档案生成草稿 |
| GET | `/plans/current` | 当前计划 + 今日任务 |
| POST | `/plans/:id/activate\|pause\|resume` | 状态变更 |
| POST | `/tasks/:id/complete` | 完成任务（可带指标） |
| GET | `/services` | 只读服务目录（配置/种子） |
| GET/POST | `/family` | 列表 / 邀请写入 |

### 6.4 复用接口

- 登录绑手机、档案读写、`/api/mp/health-records`、`POST /api/mp/ai-chat`
- 咨询传 `assistantRole` + `pageContext`；服务端增强路由与人设

### 6.5 计划生成规则（一期）

1. 已确认用药 → 用药任务模板  
2. 已确认指标要求 → 指标任务  
3. 已确认复诊时间 → 复诊提醒  
4. 信息不足 → 可解释原因 + 引导补档案，不假装完整计划  

### 6.6 前端契约

- `requestV32`：失败抛错/错误态，默认不 clone mock  
- Store：loading / empty / error  
- mock 仅单测夹具  

---

## 7. 组件与错误处理

### 7.1 组件

延续：`AppButton`、`AppHeroPanel`、`AppEmptyState`、`AppNotice`、`AppListRow`、`AppServiceProductCard`、`AppMetricGrid`、`AppActionTile`、`AppStatusBadge`、`PatientForm`。

首页按模块拆可排序块；咨询用 `cu-chat` + 角色条。

### 7.2 错误与边界

| 场景 | 行为 |
|------|------|
| 网络/5xx | 错误卡 + 重试；不填假数据 |
| 401 | `ensureLogin` → 绑手机 → 回跳 |
| 计划信息不足 | 原因文案 +「去完善档案」 |
| 任务校验失败 | 行内/Toast 错误，保持 pending |
| AI 超时 | 保留用户气泡，可重发 |
| 助手误匹配 | 切换入口；记录切换事件 |
| 缺图 | ColorUI 图标 + 色块占位 |

---

## 8. 出图资产包

交付物路径（实施时生成 zip）：

`patient-uniapp/design-assets/v32-image-gen-pack/` → 压缩为 `春雨患者端-V32-出图任务包.zip`

含：`README.md`、`STYLE.md`、`manifest.json`（文件名、尺寸、用途、英文/中文 prompt、负面约束）。

资产清单见同目录 `manifest.json`。生成后落入：

- `src/static/visual/*`
- `src/static/tab/*`（青绿选中态）
- 助手头像等更新 `constants/v32Assets.ts`

---

## 9. 验证计划

1. 后端冒烟：登录后 home-feed / plans/current / tasks complete  
2. `npm run type-check`、`npm run test:ui`（契约含禁止静默 mock）  
3. `npm run build:mp-weixin`  
4. 手工：无计划 → 确认档案 → 生成计划 → 完成任务 → Feed 变化；咨询路由与切换  
5. 出图包不阻塞接口联调，可并行  

---

## 10. 分期边界（重申）

**本期必须：** 三入口、动态首页、档案确认、计划生成与今日任务、双助手直聊匹配、自主管理责任文案、ColorUI 对齐、真实 `/api/mp/v32`。

**本期不做：** 支付、Pro 接管、复杂家属协作、多机构、设备接入、完整 OCR 新引擎。

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 现有档案抽取字段不足 | 结构化确认 + 模板计划；明确空态 |
| AI 路由不准 | 可切换 + 路由日志 |
| ColorUI 与微信 WXSS 兼容 | 沿用 sanitize-mp-css / 契约测试 |
| 工程无 git | 文档落入 `app/docs`；变更靠目录备份与主人确认提交策略 |

---

## 12. 下一步

1. 主人审阅本 spec。  
2. 批准后调用 writing-plans 写实施计划。  
3. 并行：主人将出图 zip 交给 Codex Image Gen，回填 `static`。  
```
