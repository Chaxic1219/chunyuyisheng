# 项目上下文

## 工程基准

- 项目根目录：`patient-uniapp/`。
- 技术栈：UniApp、Vue 3、TypeScript、Pinia、微信小程序；测试使用 Node.js `node:test`，资源优化使用 Python Pillow。
- 当前目录不是 Git 仓库。本任务不初始化 Git、不提交代码，也不得依赖 Git 回滚；遇到未知改动应先核对，不能覆盖。
- 交接包与项目中不得写入患者数据或任何凭据。

## 当前资产基线

- `patient-uniapp/src/static/icons/`：54 个文件，约 667.8KB，实际 43 个不同位图。
- 完全重复资源：9 组，涉及 20 个文件。
- `patient-uniapp/src/static/tab/`：当前快照共 20 个文件，含 PNG 与 SVG；均为旧底部导航证据。
- `04-mapping/interaction-inventory.csv`：87 个静态交互模板。
- `03-assets/current-*`、`current-icons-to-replace/`、`current-tab-assets/` 都是旧资产快照，不是可交付的新 v2 图标。
- 新资源目标：`patient-uniapp/src/static/icons/v2/*.png` 总体积不超过 400KB。

## 现有关键组件与文件

- `src/components/AppIcon.vue`：现有图标展示入口，需接入语义注册表、tone、state 和 motion。
- `src/components/AppButton.vue`：现有文本按钮，需统一图标、加载/成功/失败、防重复点击和可访问名称。
- `src/components/AppListRow.vue`、`AppActionTile.vue`、`AppServiceProductCard.vue`：列表、快捷入口和服务卡片迁移重点。
- `src/components/AppPageHeader.vue`、`AppBackNav.vue`、`AppSectionHeader.vue`：页头、返回与独立操作入口。
- `src/components/AppHeroPanel.vue`、`AppEmptyState.vue`、`AppNotice.vue`：状态和提示场景。
- `src/utils/mediaSrc.ts`：当前图标/媒体解析入口；需保留既有安全校验，接入新注册表并移除 `help` 回退。
- `src/stores/app.ts`：Pinia 应用状态；新增并持久化低动效偏好。
- `src/App.vue`：全局按压和语义动效 CSS；低动效通过根节点状态类实现。
- `src/constants/mineDefaults.ts`、`src/api/mock/v32.ts`、`src/stores/consultation.ts`：旧位置型名称和冲突语义迁移点。
- `src/custom-tab-bar/index.js`、`index.wxml`、`index.wxss`：微信自定义底部导航资源、选中态和低动效反馈。
- `scripts/sync-mp-static.py`、`scripts/optimize-visual-assets.py`、`scripts/patch-wechat-config.mjs`：现有微信构建资源链路。
- `tests/ui-contract.test.mjs`：现有 UI 契约测试；实施计划将新增 `tests/icon-motion.test.mjs`。

完整修改范围、逐文件步骤和语义映射以 `02-implementation-plan/miniapp-icon-motion-upgrade-plan.md` 为准，不以本摘要替代计划。

## 脚本命令

所有命令在 `patient-uniapp/` 执行。

- 当前已有：`npm run test:ui`、`npm run type-check`、`npm run build:mp-weixin`。
- Task 1 新增：`npm run test:icons`，并将 `test:ui` 扩展为同时运行 UI 契约与图标动效契约。
- Task 8 将 `build:mp-weixin` 接入 `scripts/optimize-icon-assets.py`，再执行 UniApp 微信构建、静态同步和微信配置补丁。
- 每批验证：`npm run test:icons && npm run test:ui && npm run type-check`。
- 最终验证：上述三项通过后运行 `npm run build:mp-weixin`。

当前尚未存在 `test:icons` 脚本，因此在 Task 1 完成前执行该命令失败属于预期起点，不应通过临时跳过测试来规避。

## 构建与低动效限制

当前构建流程会移除 `prefers-reduced-motion`，因此不能依赖该媒体查询实现低动效。必须由 `src/stores/app.ts` 保存偏好，并在应用根节点和自定义底部导航使用状态类关闭图标位移、缩放和结果上浮；颜色、文字、禁用和加载状态仍需保留。低动效模式与老年模式相互独立。

## SVG 导出工具前置检查

当前交接环境在 2026-08-06 执行 `Get-Command inkscape` 的结果为未检测到 Inkscape。Cursor 环境在主人确认 SVG 母版后仍必须重新执行该命令；若缺失，立即停止资产导出，让主人选择安装 Inkscape 或提供等价 SVG→PNG 工具。禁止自行下载、静默安装或擅自改用未确认工具。此停止条件不影响 Task 1 的失败测试、注册表接口骨架和 SVG 母版设计，但会阻止 PNG 导出及后续最终注册表、页面开发。

## 不可越界事项

- 不修改业务接口、服务包定价、商品/权益规则、支付流程、健康档案数据结构。
- 不改变原生按钮的 `open-type`、表单行为、事件签名或授权路径。
- 不用旧 PNG 代替新母版，不让页面直接拼接 v2 静态路径。
- 不删除仍有引用的旧资源；先完成调用迁移和静态扫描，再处理确认无引用的重复或旧资源。
- 不把未知语义映射为 `help`；使用 `action-unknown` 并记录。
