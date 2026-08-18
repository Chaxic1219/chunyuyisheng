# 交接包内容索引

## 权威性说明

实施时按以下优先级解释材料：

1. `01-requirements/` 是已确认的权威需求与验收边界。
2. `02-implementation-plan/` 是权威实施顺序、文件范围与测试检查点。
3. `04-mapping/interaction-inventory.csv` 是 87 个交互模板的逐项语义、tone、motion 和优先级权威映射；具体场景 motion 高于 semantic 默认 motion。
4. `03-assets/new-icon-output-spec.md` 是新图标母版、色值、tone、导出和 400KB 预算的权威资产规范。
5. `05-visual-reference/` 是已确认方案 B 的视觉参考，用于判断风格和动效克制度，不替代需求与映射表。

若摘要与上述权威材料不一致，应停止实施并核对；不得静默选择。本包已将早期“约 82 个”统一校正为复审后的 87 个交互模板。

## 目录与文件用途

### `00-START-HERE.md`

总入口。说明项目目标、四项已确认选择、项目根目录基准、阅读顺序、资产边界、Cursor 执行顺序、风险、停止条件和安全约束。

### `01-requirements/`

包含 `miniapp-icon-motion-upgrade-design.md`。这是已确认设计副本，定义目标、非目标、语义系统、动效、低动效、资源预算、11 项验收标准和风险控制。

### `02-implementation-plan/`

包含 `miniapp-icon-motion-upgrade-plan.md`。这是 8 个 Task 的完整实施计划副本，包含每步失败测试、最小实现、文件范围、命令和预期结果。

### `03-assets/`

- `README.md`：资产快照使用边界。
- `current-icon-inventory.csv`：旧图标目录的 54 文件盘点、体积、哈希、重复组和替换建议。
- `current-tab-inventory.csv`：旧底部导航的 20 文件盘点。
- `duplicate-groups.md`：9 个完全重复组及删除前提。
- `new-icon-output-spec.md`：新 SVG/PNG、tone、色值、动效和 400KB 预算的权威规范。
- `current-icons-to-replace/`、`current-tab-assets/`：2026-08-06 的旧资产只读证据快照。

这里所有名称以 `current-` 开头的内容以及两个 `current-*` 资产目录都是**旧资产快照**，不是新版素材，不得复制、改名或直接进入 v2。

### `04-mapping/`

- `interaction-inventory.csv`：87 个静态交互模板的逐项位置、控件类型、文案、旧视觉、目标 semantic、tone、motion、优先级和说明；tone 仅允许 `primary`、`inverse`、`muted`、`danger`。
- `page-replacement-summary.md`：按首页、咨询、档案、计划、服务包、我的、设置、家庭、认证/表单、辅助页和底部导航汇总迁移口径。

这是页面调用迁移的权威映射。遇到运行时未知语义时使用 `action-unknown` 并记录，不得从旧图猜测。

### `05-visual-reference/`

- `icon-style-B-monoline.html`：方案 B 纯线性图标的视觉参考、规格和禁止项。
- `motion-B-guided.html`：方案 B 状态引导动效的节奏、状态和低动效参考。

两者是浏览器可打开的**视觉参考**，不包含可直接交付的 SVG 母版或 v2 PNG。

### `06-cursor/`

- `CURSOR-DEVELOPMENT-PROMPT.md`：可直接粘贴给 Cursor 的中文主提示。
- `PROJECT-CONTEXT.md`：技术栈、关键组件、命令、非 Git 状态、资产基线和构建限制。
- `ACCEPTANCE-CHECKLIST.md`：将设计验收条款和最终工程验证转成可勾选清单。

### `MANIFEST.sha256`

除清单自身外，本交接目录所有文件的相对路径与 SHA-256。路径使用 `/`，按相对路径排序，不含本机绝对信息。用于检查包内容完整性和传输后是否被修改。

## 安全边界

本包不含患者信息、账号、令牌、密钥、Cookie、支付凭据或线上配置。实施过程也不得向交付材料、测试样例、日志或截图写入这些内容。
