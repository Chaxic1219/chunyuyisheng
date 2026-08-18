# Cursor 开发交接入口

> [!WARNING]
> **资产警告：`03-assets/current-*` 全部是旧资产证据，禁止作为新 v2 图标。**
> 本包不含完成的新 v2 图标。

## 开发前置条件

收件方必须同时拥有 `patient-uniapp` 源项目。推荐使用同一 Cursor 工作区布局，将 `patient-uniapp/` 与 `cursor-icon-motion-upgrade-2026-08-06/` 作为同级目录。若只收到本 ZIP，不得开始修改代码，必须先向交付方索取 `patient-uniapp` 源项目。

## Windows ZIP 校验

在 PowerShell 中运行以下命令，并将结果与同名 `sha256.txt` 文件中的哈希对照：

```powershell
Get-FileHash -Algorithm SHA256 '春雨患者端小程序图标动效升级_Cursor交接包_2026-08-06.zip'
```

## 项目目标

在 `patient-uniapp/` 内，为患者端小程序的全部可点击控件建立统一的纯线性语义图标系统与克制的状态引导动效，优先完成服务包展示、开通和交付核心链路；同时清理错误复用与重复资源，并保证业务接口、定价、支付和健康档案数据结构不变。

## 已确认选择

- 图标方案：B，纯线性。24×24 母版、约 1.8px 圆角描边，无填充、渐变、投影、高光或拟物底座。
- 动效方案：B，状态引导。覆盖按下、处理中、成功、失败、禁用和低动效，不使用弹跳、弹簧或装饰性循环。
- 覆盖范围：A，全部可点击控件，包括按钮、图标按钮、可点击列表行、可点击卡片、顶部操作、底部导航和异常状态入口。
- 替换策略：A，语义系统化。先确定语义与公共组件契约，再按优先级迁移调用点。

本包按静态模板统计共有 **87 个交互模板**，不是早期粗略盘点的“约 82 个”。运行时循环可能产生多个实例，但验收基线以 `04-mapping/interaction-inventory.csv` 的 87 条模板记录为准。

## 项目根目录基准

所有开发、测试与构建命令均以 `patient-uniapp/` 为工作目录。交接文档中的代码路径也以该目录或交接包自身为相对基准，不依赖本机绝对路径。

## 先读顺序

1. `00-START-HERE.md`：确认范围、决策、停止条件和执行顺序。
2. `01-requirements/miniapp-icon-motion-upgrade-design.md`：权威需求与 11 项验收标准。
3. `02-implementation-plan/miniapp-icon-motion-upgrade-plan.md`：8 个 Task 的实施步骤与测试检查点。
4. `03-assets/README.md` 与 `03-assets/new-icon-output-spec.md`：旧资产证据边界、新资产输出规范和 400KB 预算。
5. `04-mapping/interaction-inventory.csv` 与 `04-mapping/page-replacement-summary.md`：87 个交互模板的逐项语义、tone、motion 和页面迁移口径。
6. `05-visual-reference/icon-style-B-monoline.html` 与 `05-visual-reference/motion-B-guided.html`：已确认的视觉和动效参考。
7. `06-cursor/PROJECT-CONTEXT.md`、`06-cursor/CURSOR-DEVELOPMENT-PROMPT.md`、`06-cursor/ACCEPTANCE-CHECKLIST.md`：工程现状、可粘贴执行提示和最终验收清单。

## 交付目录结构

```text
cursor-icon-motion-upgrade-2026-08-06/
├─ 00-START-HERE.md
├─ 01-requirements/          已确认需求副本，权威要求
├─ 02-implementation-plan/   已确认的 8 Task 实施计划副本
├─ 03-assets/                旧资产证据、重复组与新资产输出规范
├─ 04-mapping/               87 个交互模板映射与页面替换总结
├─ 05-visual-reference/      方案 B 的视觉和动效参考
├─ 06-cursor/                Cursor 主提示、上下文、验收清单
├─ PACKAGE-CONTENTS.md       包内容索引与权威性说明
└─ MANIFEST.sha256           除自身外全部文件的 SHA-256 清单
```

## 资产边界

当前包**不包含已经完成的新 v2 图标**。`03-assets/current-*`、`03-assets/current-icons-to-replace/` 和 `03-assets/current-tab-assets/` 全部是旧资产快照与证据，禁止直接复制、改名或充当 `patient-uniapp/src/static/icons/v2/` 新稿。

新图标必须先依据 `03-assets/new-icon-output-spec.md` 生成并确认纯线性 SVG 母版，再导出 96×96 透明 PNG、按需生成 tone 版本并压缩。全部 v2 PNG 总体积不得超过 400KB。

## Cursor 执行顺序

1. 先完整阅读 `01` 至 `05`，核对 87 条映射和纯线性输出规范。
2. Task 1 先写语义注册表失败测试与可编译接口骨架，但不落最终资产；再生成完整纯线性 SVG 母版与必要 tone，提交主人确认并停止等待。只有主人明确确认后，才检查导出工具、导出 PNG、完成注册表实现和接入媒体解析器。
3. 严格按实施计划 Task 1 → Task 8 顺序，以失败测试、最小实现、人工确认闸门和通过测试为循环。
4. 语义名与 tone 独立；具体场景优先采用 `interaction-inventory.csv` 的 motion，未指定时才使用注册表默认 motion。
5. 迁移页面调用点时保留旧名称别名兼容层，但生产页面、组件、mock 和 store 必须改用新语义名。
6. 每批运行适用的 `npm run test:icons`、`npm run test:ui`、`npm run type-check`；Task 1 创建 `test:icons` 后才可执行该命令。
7. Task 8 最后运行 `npm run build:mp-weixin`，再在微信开发者工具与真机完成核心链路人工验收。

## 风险与停止条件

- 发现图标语义不能从需求、计划或 87 条映射确定时：停止该调用点迁移，使用 `action-unknown` 作为明确的临时语义并记录文件、控件和待确认原因，不得回退 `help` 或自行发明业务含义。
- SVG 母版未获得主人明确确认时：只允许保留失败测试与注册表接口骨架；停止 PNG 批量导出、最终注册表实现、媒体解析器接入和页面迁移，不得使用旧资产冒充新稿。
- 执行 `Get-Command inkscape` 未发现 Inkscape 时：停止资产导出，让主人选择安装 Inkscape 或提供等价 SVG→PNG 工具；禁止自行下载或静默安装。
- 需要修改业务接口、服务包定价、支付流程、健康档案数据结构或非图标/动效业务逻辑时：停止并请求确认。
- 原生 `button` 的 `open-type`、表单行为、事件签名或防重逻辑可能变化时：停止该改动并先补回归测试。
- v2 资源超过 400KB、关键测试失败、TypeScript 报错、微信构建失败或出现缺图时：不得继续宣称完成，先定位并修复根因。
- 遇到未知工作区改动时：不得覆盖或还原，先确认来源并仅处理本任务相关文件。

## 数据与安全

本交接包不包含患者数据、账号、令牌、密钥、Cookie、支付凭据或线上配置。执行过程中也不得把真实患者信息或任何凭据写入代码、测试、日志、截图和交付文档。
