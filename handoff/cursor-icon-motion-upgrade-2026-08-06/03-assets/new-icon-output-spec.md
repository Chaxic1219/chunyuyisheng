# 新图标输出规范：风格 B（纯线性）

## 已确认基础规则

- 母版画布：24×24。
- 线条：1.8px，圆角端点与圆角转角，纯描边；不使用填充、渐变、投影、高光或拟物底座。
- 运行时输出：每个资源 96×96 透明 PNG，由同一 SVG 母版导出并执行无损压缩。
- 色调：默认主色 `primary`；仅按下表输出必要的反白 `inverse`、灰色 `muted`、危险色 `danger` 版本。
- 预算：`src/static/icons/v2/*.png` 总体积不得超过 400KB。
- 命名：按业务动作命名，禁止新增仅描述页面位置的 `asset-*`、`quick-*` 名称。
- 动效：默认只修改 `transform` 与 `opacity`；普通动效不超过 240ms，持续加载除外；低动效模式将位移、缩放与结果上浮关闭。

## 目录、颜色与文件名

- SVG 母版建议目录：`patient-uniapp/design/icons/v2-svg/`；PNG 输出目录：`patient-uniapp/src/static/icons/v2/`。
- 权威色值：主色 `#176B52`、反白 `#FFFFFF`、灰色 `#89948E`、危险色 `#A33C33`。
- 基础 semantic 与 tone 独立；文件名只允许 `<semantic>.png`、`<semantic>-inverse.png`、`<semantic>-muted.png`、`<semantic>-danger.png`。
- 主色文件不加 `-primary` 后缀；只导出下表登记的按需 tone。

## 导出、压缩与预算核验

以下命令在 `patient-uniapp` 目录执行，不要求本交接包新增业务脚本。SVG 文件名应已包含必要 tone 后缀。

当前交接环境在 2026-08-06 执行前置检查时未检测到 Inkscape。任何实施环境都必须先运行：

```powershell
$inkscape = Get-Command inkscape -ErrorAction SilentlyContinue
if (-not $inkscape) { throw "未检测到 Inkscape；停止导出，请主人选择安装 Inkscape 或提供等价 SVG→PNG 工具" }
```

缺失时必须停止资产导出并请主人选择安装 Inkscape 或提供等价 SVG→PNG 工具，禁止静默安装、下载或擅自切换工具。以下导出命令只有在主人确认 SVG 母版且前置检查通过后才能执行。

```powershell
$svgDir = Resolve-Path 'design/icons/v2-svg'
$pngDir = 'src/static/icons/v2'
New-Item -ItemType Directory -Force $pngDir | Out-Null
Get-ChildItem -File $svgDir -Filter '*.svg' | ForEach-Object {
  $target = Join-Path $pngDir ($_.BaseName + '.png')
  & inkscape $_.FullName --export-filename=$target --export-width=96 --export-height=96
  if ($LASTEXITCODE -ne 0) { throw "SVG 导出失败：$($_.Name)" }
}
python scripts/optimize-icon-assets.py
$bytes = (Get-ChildItem -File $pngDir -Filter '*.png' | Measure-Object Length -Sum).Sum
if ($bytes -gt 409600) { throw "图标预算超限：$bytes bytes > 409600 bytes" }
"icon total: {0:N1} KB" -f ($bytes / 1KB)
```

`scripts/optimize-icon-assets.py` 由实施计划任务创建，负责 Pillow 无损压缩与 96×96 尺寸检查；在该脚本落地前不得跳过压缩和预算核验。

## 动效优先级

`interaction-inventory.csv` 的 `tone` 列是 87 个具体控件/场景的权威色调来源，并决定按需导出的 tone 文件；其 motion 列优先于本表默认动效，其次使用 semantic 默认动效，两者均未配置时为 `none`。例如 `service-detail`、`service-activate` 在服务查看/开通场景使用 `right`，首页快捷上传使用 `up`。

## 批准的完整语义清单

| semantic_name | 必要输出色调 | 默认动效 |
| --- | --- | --- |
| `action-add` | primary | `expand` |
| `action-clear` | primary | `none` |
| `action-close` | primary, danger | `none` |
| `action-confirm` | primary, inverse | `confirm` |
| `action-create` | primary, inverse | `expand` |
| `action-more` | primary | `none` |
| `action-refresh` | primary, inverse | `rotate` |
| `action-send` | primary, inverse | `right` |
| `action-unknown` | primary | `none` |
| `action-update` | primary, inverse | `none` |
| `nav-back` | primary | `left` |
| `nav-chevron-right` | primary, muted | `right` |
| `nav-consult` | primary, inverse | `none` |
| `nav-home` | primary, muted | `none` |
| `nav-profile` | primary, muted | `none` |
| `upload-record` | primary, inverse | `up` |
| `medication` | primary | `none` |
| `metric-record` | primary | `none` |
| `follow-up` | primary | `none` |
| `service-package` | primary | `none` |
| `consult-doctor` | primary, inverse | `none` |
| `profile-edit` | primary, inverse | `none` |
| `reminder` | primary | `none` |
| `doctor-group` | primary | `none` |
| `invite-patient` | primary | `none` |
| `group-service` | primary | `none` |
| `quick-question` | primary | `none` |
| `record-bind` | primary, inverse | `none` |
| `plan-create` | primary | `none` |
| `record-edit` | primary | `none` |
| `health-record` | primary | `none` |
| `health-log` | primary | `none` |
| `task-next` | primary | `right` |
| `health-plan` | primary | `none` |
| `plan-consult` | primary | `none` |
| `service-detail` | primary | `none` |
| `service-activate` | primary, inverse | `none` |
| `rehab-guide` | primary | `none` |
| `postop-assessment` | primary | `none` |
| `goods-order` | primary | `none` |
| `service-rights` | primary | `none` |
| `member-add` | primary | `none` |
| `member-record` | primary | `none` |
| `permission-scope` | primary | `none` |
| `wechat` | primary, inverse | `none` |
| `phone-bind` | primary, inverse | `none` |
| `verification-code` | primary | `none` |
| `order` | primary | `none` |
| `service-center` | primary | `none` |
| `privacy` | primary | `none` |
| `account-security` | primary | `none` |
| `data-export` | primary | `none` |
| `data-delete` | primary, danger | `none` |
| `account-logout` | primary, danger | `none` |
| `wechat-unbind` | primary, danger | `none` |
| `settings` | primary | `none` |
| `elder-mode` | primary | `none` |
| `camera` | primary | `none` |
| `search` | primary | `none` |
| `attachment` | primary | `none` |
| `help-center` | primary | `none` |
| `doctor-profile` | primary | `none` |
| `health-assistant` | primary | `none` |
| `inpatient-service` | primary | `none` |
| `nutrition` | primary | `none` |
| `reply-record` | primary | `none` |
| `status-loading` | primary, inverse | `rotate` |
| `status-success` | primary | `confirm` |
| `status-error` | primary, danger | `none` |
| `status-warning` | primary, inverse | `none` |
| `status-empty` | primary, muted | `none` |

## 动效类型定义

| 类型 | 行为 |
| --- | --- |
| `none` | 不做方向性位移；容器仍可保留 0.98 的统一按压反馈。 |
| `up` | 上传箭头按下时向上约 3px。 |
| `right` | 发送、进入、下一步或方向箭头向右约 3px。 |
| `left` | 返回箭头向左约 3px。 |
| `rotate` | 刷新点击旋转一周；`status-loading` 在请求期间持续旋转。 |
| `expand` | 添加、创建图标轻微放大后恢复。 |
| `confirm` | 勾选淡入并轻微放大，约 200–220ms。 |

危险操作（删除、退出、解绑）不使用摇晃；通过 `danger` 色调、确认流程与明确文案表达风险。底部导航仅做颜色和透明度平滑切换，不弹跳。
