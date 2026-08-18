# Cursor 开发主提示

请直接执行以下任务，不要扩大范围：

你正在实施患者端小程序图标与动效升级。项目根目录为 `patient-uniapp/`，只能修改该目录内与本升级直接相关的文件，不得修改交接包，也不得修改其他项目。开始前完整阅读交接包的以下内容：

1. `01-requirements/miniapp-icon-motion-upgrade-design.md`
2. `02-implementation-plan/miniapp-icon-motion-upgrade-plan.md`
3. `03-assets/README.md`、`03-assets/new-icon-output-spec.md`、`03-assets/duplicate-groups.md` 与两个资产清单
4. `04-mapping/interaction-inventory.csv`、`04-mapping/page-replacement-summary.md`
5. `05-visual-reference/icon-style-B-monoline.html`、`05-visual-reference/motion-B-guided.html`

已确认决策为：B 纯线性图标、B 状态引导动效、A 全部可点击控件、A 语义系统化替换。映射基线是 87 个交互模板。严格遵循 TDD、最小实现和精准改动：先写能复现缺口的失败测试，再写满足当前步骤的最少代码，不做无关重构或功能扩展。

严格按实施计划的 Task 1 至 Task 8 顺序执行，不得跳步或并行改写后续调用点。Task 1 的固定顺序是：语义注册表失败测试与可编译接口骨架（不落最终资产）→生成完整的 24×24、1.8px 圆角描边、无填充/渐变/投影/高光的纯线性 SVG 母版→向主人提交清单和预览并停止等待明确确认→检查 SVG 导出工具→导出 96×96 PNG→完成注册表实现与媒体解析器接入。接口骨架阶段允许写测试和公开接口，但不得放入旧图或最终资产；未获主人确认不得导出 PNG、完成注册表映射或开发页面。`03-assets/current-*`、`current-icons-to-replace/` 和 `current-tab-assets/` 全是旧资产证据，绝不能复制、改名、描摹充当新 v2 图标，也不能作为临时占位进入 `src/static/icons/v2/`。

主人确认 SVG 后仍须先运行 `Get-Command inkscape`。当前交接环境在 2026-08-06 未检测到 Inkscape；若 Cursor 环境也缺失，立即停止资产导出，请主人选择安装 Inkscape 或提供等价 SVG→PNG 工具，禁止自行下载、静默安装或擅自改用未确认工具。

注册表和调用点必须使用业务语义名。semantic 与 tone 必须独立：semantic 表示动作或业务含义，tone 仅使用 `primary`、`inverse`、`muted`、`danger`，禁止把 tone 拼进 semantic。`04-mapping/interaction-inventory.csv` 的 `tone` 列是 87 个具体模板的权威色调来源；具体场景 motion 高于注册表中的 semantic 默认 motion，两者都未指定时使用 `none`。

迁移期间保留旧名称到新语义的别名兼容层，以兼容服务端旧数据；但所有页面、公共组件、mock 和 store 的生产调用必须迁移到新语义名。所有页面通过 `AppIcon` 与注册表取图，不直接拼 v2 静态路径。未知业务语义统一解析为 `action-unknown`，并记录文件、控件、原始值和待确认原因；不得回退到 `help`、问号图标，也不得自行臆测业务含义。

保持现有业务事件、表单和数据流。不得修改后端接口、服务包定价、商品或权益规则、支付流程、健康档案数据结构；不得改变带 `open-type` 的原生按钮类型；不得削弱提交、开通、发送、绑定等操作的防重复机制。按钮处理中必须锁定，失败后恢复可点击，状态切换不得改变按钮宽度、卡片高度或页面布局。

每个 Task 按计划运行其指定验证。Task 1 创建脚本后使用 `npm run test:icons`；每一批完成后运行：

```text
npm run test:icons
npm run test:ui
npm run type-check
```

若某个 Task 只要求其中一部分，以计划为最低要求；已具备的三条命令应尽量全部执行并记录结果。Task 8 完成后再运行：

```text
npm run build:mp-weixin
```

任何测试、类型检查、400KB 预算、资源存在性检查或微信构建失败，都必须先修复根因，不得跳过、屏蔽或将失败描述为完成。最终还要在微信开发者工具和真机检查首页、服务包、咨询、档案、计划、我的、设置，以及普通模式、低动效模式、老年模式；独立图标按钮触控区至少 44×44px。

每个 Task 结束时输出：本 Task 改动文件、失败测试证据、实现摘要、实际执行命令与结果、剩余风险。最终输出：完整改动清单、四条最终验证结果、v2 资产数量与总字节数、87 个模板覆盖结果、微信工具/真机验收结果、`action-unknown` 记录、残余风险。没有证据的项目明确标记为未通过，不能用推测代替验证。
