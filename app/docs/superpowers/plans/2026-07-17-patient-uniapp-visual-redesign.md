# 患者端小程序整体视觉重绘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改后端和 mock API 契约的前提下，将患者端 11 个页面重绘为已批准的 Art Design Pro 医生私域型视觉系统。

**Architecture:** 通过共享设计令牌和 `uni.scss` 提供统一基础样式，复用现有 `DoctorCard`、`CoreEntries`、`FnGroup`、`PatientForm` 与 `AppIcon`，页面只负责各自的信息布局。三张位图由 Image 2 生成并保存到 `src/static/visual`，小图标继续使用代码原生 SVG 路径。

**Tech Stack:** UniApp Vue 3、TypeScript、Pinia、Vite、微信小程序、Node.js 内置测试运行器、Image 2。

## Global Constraints

- 不接入或修改后端，保持 `USE_MOCK=true` 和现有 API 类型。
- 不新增 UI 框架或运行时依赖。
- 医生为第一视觉主体，AI 仅作辅助说明。
- 品牌主色固定为 `#5D87FF`，页面底色固定为 `#F4F7FB`。
- 普通触控目标不小于 44px，长辈模式不小于 52px。
- 位图内不放正文、按钮、导航或关键信息。
- 当前目录不是 Git 仓库，因此所有 commit 步骤省略并在最终报告说明。

---

### Task 1: 建立 UI 合同测试

**Files:**
- Create: `patient-uniapp/tests/ui-contract.test.mjs`
- Modify: `patient-uniapp/package.json`

**Interfaces:**
- Consumes: 现有页面与组件源码文件。
- Produces: `pnpm run test:ui`，检查令牌、主页面语义、长辈模式和图片资产存在性。

- [ ] **Step 1:** 使用 Node `node:test` 编写测试，断言 `tokens.css` 包含新令牌、首页包含医生信任区与健康指引、咨询页包含安全提示、档案和我的包含概览区、三张视觉资产存在。
- [ ] **Step 2:** 运行 `node --test tests/ui-contract.test.mjs`，确认因为新令牌/结构/资产尚不存在而失败。
- [ ] **Step 3:** 在 `package.json` 添加 `"test:ui": "node --test tests/ui-contract.test.mjs"`。

### Task 2: 重建设计令牌与全局基础样式

**Files:**
- Modify: `packages/patient-design/tokens.css`
- Modify: `packages/patient-design/tokens.json`
- Modify: `patient-uniapp/src/App.vue`
- Modify: `patient-uniapp/src/uni.scss`

**Interfaces:**
- Produces: `--primary-deep`、`--accent-violet`、`--mist-blue`、`--surface-muted`、`--text-strong`、`--shadow-card` 等 CSS 变量；`.page-shell`、`.ambient-bg`、`.section-heading`、`.state-card` 等基础类。

- [ ] **Step 1:** 将批准色板、圆角、阴影、字号和间距同步到 CSS/JSON。
- [ ] **Step 2:** 设置页面基础背景、文字、按钮重置、安全区和长辈模式变量。
- [ ] **Step 3:** 运行 `pnpm run type-check`，确认全局样式改动未破坏编译。

### Task 3: 重绘公共组件

**Files:**
- Modify: `patient-uniapp/src/components/AppIcon.vue`
- Modify: `patient-uniapp/src/components/DoctorCard.vue`
- Modify: `patient-uniapp/src/components/CoreEntries.vue`
- Modify: `patient-uniapp/src/components/FnGroup.vue`
- Modify: `patient-uniapp/src/components/PatientForm.vue`

**Interfaces:**
- `DoctorCard`: 继续接收 `doctor` 与 `intro`。
- `CoreEntries`: 继续接收 `CoreItem[]` 并发出 `open(key)`。
- `FnGroup`: 继续接收标题和 `FnItem[]` 并发出 `open(key)`。
- `PatientForm`: 继续接收 `config` 与 `type`，不改变提交数据结构。

- [ ] **Step 1:** 扩充线性图标映射并统一 24px 图标容器。
- [ ] **Step 2:** 将医生卡改为带资历标签、团队说明与雾蓝装饰的信任卡。
- [ ] **Step 3:** 将核心入口改为 2×2 卡片，在线咨询为唯一渐变主卡。
- [ ] **Step 4:** 将功能组改为白卡列表，明确图标、标题、说明和箭头层级。
- [ ] **Step 5:** 将表单改为说明头卡 + 字段卡 + 同意区 + 主按钮，并保留原校验与提交行为。

### Task 4: 重绘四个核心 Tab

**Files:**
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/consult/index.vue`
- Modify: `patient-uniapp/src/pages/archive/index.vue`
- Modify: `patient-uniapp/src/pages/mine/index.vue`

**Interfaces:**
- 保持所有 `navigateTo`、`switchTab`、`makePhoneCall` 和 mock 调用不变。

- [ ] **Step 1:** 首页按品牌栏、医生卡、快速服务、健康指引、分组列表重新编排。
- [ ] **Step 2:** 咨询页增加医生团队说明、安全提示、欢迎卡、报告引导与浮动输入区。
- [ ] **Step 3:** 档案页增加蓝紫概览卡、统计、联络摘要和双主操作。
- [ ] **Step 4:** 我的页增加患者资产概览、两组导航和隐私说明，并加入长辈模式入口。

### Task 5: 重绘健康记录与内容页

**Files:**
- Modify: `patient-uniapp/src/pages/archive/health.vue`
- Modify: `patient-uniapp/src/pages/article/detail.vue`
- Modify: `patient-uniapp/src/pages/faq/index.vue`
- Modify: `patient-uniapp/src/pages/replies/index.vue`

**Interfaces:**
- 保持查询、过滤、折叠和文章 key 选择行为不变。

- [ ] **Step 1:** 健康记录页改为分类网格、记录卡和正式空状态。
- [ ] **Step 2:** 文章页增加 Image 2 封面、医生审核标识、正文卡和安全提示。
- [ ] **Step 3:** FAQ 改为独立问答卡并强化展开状态。
- [ ] **Step 4:** 回复页增加查询说明、输入卡、结果卡、加载与空状态。

### Task 6: 统一三类表单页面壳

**Files:**
- Modify: `patient-uniapp/src/pages/form/add.vue`
- Modify: `patient-uniapp/src/pages/form/admission.vue`
- Modify: `patient-uniapp/src/pages/form/contact.vue`

**Interfaces:**
- 三个页面继续只从 store 读取对应 `FormConfig`，交给 `PatientForm`。

- [ ] **Step 1:** 统一页面雾蓝背景、加载状态和长辈模式 class。
- [ ] **Step 2:** 为每类表单传入区别化说明文案，但不改变配置或提交类型。

### Task 7: 生成并接入 Image 2 资产

**Files:**
- Create: `patient-uniapp/src/static/visual/rehab-guide-cover.png`
- Create: `patient-uniapp/src/static/visual/report-upload-guide.png`
- Create: `patient-uniapp/src/static/visual/health-record-empty.png`

**Interfaces:**
- 首页/文章使用 `rehab-guide-cover.png`。
- 咨询使用 `report-upload-guide.png`。
- 健康记录空状态使用 `health-record-empty.png`。

- [ ] **Step 1:** 用 Image 2 分别生成三张无文字、无 Logo、蓝紫医疗编辑插画。
- [ ] **Step 2:** 将最终资产保存到 `src/static/visual`，确认图像尺寸、裁切安全区和文件可读。
- [ ] **Step 3:** 更新三个消费页面的静态路径和替代说明。

### Task 8: 构建与视觉验证

**Files:**
- Modify: `patient-uniapp/README.md`（仅在运行说明需要补充时）

**Interfaces:**
- Produces: 可由微信开发者工具打开的 `dist/build/mp-weixin`。

- [ ] **Step 1:** 运行 `pnpm run test:ui`，预期全部通过。
- [ ] **Step 2:** 运行 `pnpm run type-check`，预期退出码 0。
- [ ] **Step 3:** 运行 `pnpm run build:mp-weixin`，预期退出码 0 且更新构建产物。
- [ ] **Step 4:** 启动 H5 预览或检查微信构建页面，覆盖首页、咨询、档案、我的、表单、文章、FAQ 和回复。
- [ ] **Step 5:** 检查普通/长辈模式、375px/430px 宽度、加载/错误/空状态和底部安全区。

## Self-Review

- 规格中的 11 个页面均映射到 Task 4–6。
- 三张 Image 2 资产均映射到 Task 7，并明确消费页面。
- 未修改后端、API 类型或 mock 数据结构。
- 测试、类型检查、微信构建和视觉检查均在 Task 8 闭环。
- 所有组件接口沿用当前签名，没有引入未定义的新数据类型。
