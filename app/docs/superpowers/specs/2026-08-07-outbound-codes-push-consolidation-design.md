# 编号与推送整合设计

日期：2026-08-07  
状态：待主人审阅  
范围：admin-ui 运营配置 + app 出站匹配/投递

## 1. 背景与目标

当前出站配置分散在四处，运营心智成本高，且存在双写：

| 旧入口 | 路由 | 主要职责 |
|--------|------|----------|
| 群与话术 | `/ops/scripts` | `ops_configs.scripts` 文案（含 `code101`、`groupWelcome`） |
| 编号中心 | `/ops/codes` | 编号总览 + `rules.responses` 多步配置 |
| 关键词规则 | `/knowledge/rules` | 规则 CRUD / 别名 |
| 企微配置 · 小程序贴片 | `/sys-cy/qiwe` §③ | `qiwe_weapp_templates` 封面捕获 |

现网典型行为（如发 `101` → 文案 + 小程序贴片）实际来自 **scripts 前置文案 + rules 的 mp 步**，无法在单一页面清晰地把「发几条、各是什么」配成任意 N 条。

**目标：** 收敛为菜单 **编号与推送** 下两个页面：

1. **素材库** — 新增/编辑编号分组与素材（文案 / 小程序贴片 / 链接）
2. **触发编排** — 配置入群或「发某编号」后按序发出的消息条目（只引用素材，可增删条目数）

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 两页分工 | A：素材库 + 触发编排 |
| 编排与素材关系 | 页2 **只引用** 页1 素材，不在编排页改正文 |
| 入群 | 与编号一样可编排 N 条，取消硬编码贴片码（如 979/808） |
| 素材复用 | 可跨触发引用；页1 **按编号分组展示**（含「入群」「未分组」） |
| 旧入口 | **直接替换**；隐藏/重定向，不保留双写入口 |
| 菜单位置 | 新菜单栏 **编号与推送** → 素材库 \| 触发编排 |
| 实现路线 | **方案 A：新建统一模型**（资产 + 触发 + 步骤） |
| 生效方式 | **保存即生效**（不做草稿/发布双状态） |

## 3. 信息架构

```
运营中心
  └── 编号与推送          （新一级菜单）
        ├── 素材库        /ops/outbound/assets
        └── 触发编排      /ops/outbound/triggers
```

旧路由处理：

- `/ops/scripts`、`/ops/codes`、`/ops/group-codes`、`/knowledge/rules` → 重定向到新菜单合适子页
- `/sys-cy/qiwe` 保留账号/凭证等通道配置；**贴片运营能力迁入素材库**（封面捕获/上传 API 复用，UI 入口迁移）

### 3.1 素材库（页1）

- 左侧：编号文件夹（`101`、`626`、…、`入群`、`未分组`）+「新建编号」
- 右侧：该分组下素材列表；支持新建文案 / 贴片 / 链接
- 贴片编辑：短链、标题、封面捕获/自定义上传（调用现有 `qiwe/cover-*`）
- **不**决定发出条数或顺序

### 3.2 触发编排（页2）

- 触发列表：`入群`、`发编号 101`、… +「新触发」
- 选中触发后：有序步骤列表，每步 = 引用一条素材
- 支持：添加条目、移除、上移/下移、启用/停用单步
- 示例：101 可配成 3 条 = 2 文案 + 1 贴片

## 4. 数据模型

医生隔离：所有表含 `doctor_id`，读写以顶栏当前医生为准。

### 4.1 `outbound_assets`

| 字段 | 说明 |
|------|------|
| `id` | PK |
| `doctor_id` | 医生 |
| `type` | `text` \| `mp` \| `link` |
| `title` | 列表展示名 |
| `payload` | JSON，见下 |
| `group_code` | 展示分组：`101` / `626` / `welcome` / `''`（未分组）；**不限制**可被哪些触发引用 |
| `enabled` | 是否可用 |
| `sort` | 分组内排序 |
| `created_at` / `updated_at` | 时间戳 |

**payload 约定：**

- `text`：`{ "text": "..." }`（支持既有 `{patient}` 等占位）
- `mp`：`{ "shortLink", "title", "templateCode?", "weappCode?" }`；原生就绪态仍落在 `qiwe_weapp_templates`（按 doctor+code 关联）
- `link`：`{ "title", "url" }`（或与现 link 卡片字段对齐的等价结构）

### 4.2 `outbound_triggers`

| 字段 | 说明 |
|------|------|
| `id` | PK |
| `doctor_id` | 医生 |
| `kind` | `code` \| `join` |
| `code` | `kind=code` 时为触发编号（如 `101`）；`join` 可空或固定 `welcome` |
| `aliases` | JSON 字符串数组（口语别名） |
| `match_type` | `exact` \| `includes`（编号默认 `exact`；`includes` 沿用现 engine 风控） |
| `enabled` | 总开关 |
| `sort` | 列表排序 |

约束：每位医生 **至多一条** 启用中的 `kind=join` 触发（应用层校验）。

### 4.3 `outbound_trigger_steps`

| 字段 | 说明 |
|------|------|
| `id` | PK |
| `trigger_id` | FK → triggers |
| `asset_id` | FK → assets |
| `sort` | 发送顺序 |
| `enabled` | 单步开关 |

同一 `trigger_id` 下多行 = 多条出站消息；增删/调序只改本表。

### 4.4 与既有表关系

| 既有 | 角色 |
|------|------|
| `qiwe_weapp_templates` | 贴片捕获/就绪底层；mp 素材引用，运营不再去企微页改贴片 |
| `rules` / `ops_configs.scripts` / `codes_cards` | 迁移源；迁移后 **读路径优先 outbound**；写路径只走 outbound API |
| `community_groups.welcome_enabled` | 入群总开关保留：关则不执行 join 触发 |

**唯一真相源：** 迁移完成后，匹配与投递只读 `outbound_*`。

## 5. 运行时

### 5.1 发编号

1. 患者消息 → `engine` 匹配启用的 `outbound_triggers(kind=code)`（exact 优先，再 aliases/includes）
2. 加载该触发下启用的 `outbound_trigger_steps`（按 `sort`）
3. 逐步展开 `outbound_assets`：
   - `text` → 文本气泡
   - `mp` → 原生小程序贴片（模板就绪）或短链回落
   - `link` → 链接卡片
4. 经现有 `prepareDelivery` / `deliverReplyToQiwe` **顺序逐条发出**

**明确取消：** `withConfiguredCodeScript` 对 `scripts.code{N}` 的自动前置。是否发文案、发几条，只看步骤里引用了几条 text 素材。

### 5.2 入群

1. 成员入群且群 `welcome_enabled` 开启
2. 查该医生启用中的 `kind=join` 触发
3. 同 5.1 按步骤展开并发送
4. **取消** 欢迎流程中写死的 `weappCodes`（如 `["979","808"]`）

### 5.3 边界

- steps 为空或全部禁用 → 不发送
- 删除素材：若仍被任意 step 引用 → **拒绝删除并提示**先从编排移除
- mp 未就绪 → 发送短链回落；素材库 UI 标「未就绪」
- 触发 steps 引用已禁用素材 → 跳过该步或整触发告警（实现时选：跳过并打日志）

## 6. 管理端 API

前缀：`/api/admin/outbound`（均需医生作用域）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/assets` | 列表 / 创建 |
| GET/PUT/DELETE | `/assets/:id` | 读改删 |
| GET/POST | `/triggers` | 列表 / 创建（body 可含 `steps[]`） |
| GET/PUT/DELETE | `/triggers/:id` | 读改删；PUT 支持整体替换 `steps` |
| POST | `/triggers/:id/steps` 或 PUT steps 数组 | 编排保存（实现择一，保持幂等） |

贴片能力：素材库内调用既有 `/api/admin/qiwe/cover-*`、`cards`、`preview-reply` 等，不新造捕获协议。

**保存即生效**，无独立 publish 域。

## 7. 迁移

上线时对每位（或在用）医生执行一次性迁移：

1. 每个启用 `rules` 行 → `outbound_triggers(kind=code)` + 将其 `responses[]` 转为 assets + steps  
2. 若存在 `scripts.code{N}` 文案，且该编号触发的 steps 中尚无等价 text → 插入为 **第一条** text 素材（保持「101 = 文案 + 贴片」）  
3. `scripts.groupWelcome` + 现网入群固定贴片码 → `kind=join` 触发 + 对应 assets/steps  
4. mp 类尽量关联已有 `qiwe_weapp_templates`  
5. 迁移标记（如 `ops_configs` 或 schema flag）避免重复跑  
6. 旧菜单路由 重定向；旧写 API 可只读或 410（实现计划里定，避免双写）

**验收等价：** 周玉春 / 王云程等迁移后，未改编排前，患者发已知编号与入群的出站条数与类型与迁移前一致。

## 8. 非目标（本期不做）

- 恢复草稿/发布双轨配置中心写模型  
- 在编排页内联新建/改写素材正文  
- 改企微登录凭证、回调、建群等通道能力  
- 重构患者 H5 / 小程序端 UI（除非出站 payload 字段对齐需要）

## 9. 验收标准

1. 侧栏仅通过 **编号与推送** 配置出站素材与触发；旧四入口不可再改同一配置  
2. 素材库可新建编号分组与 text/mp/link；mp 可捕获/上传封面  
3. 触发编排可将某编号配成 **3 条**（例如 2 文案 + 1 贴片），企微侧实际收到 3 条  
4. 入群消息完全由 join 触发编排决定，不再依赖代码内写死贴片列表  
5. 迁移后在用医生行为与迁移前等价（除非主动改配置）  
6. 单元/集成测试覆盖：匹配 → 展开 steps → 投递顺序；引用中素材不可删

## 10. 主要改动面（实现指引）

- **DB：** 新建三表 + 迁移脚本（`app/db.js` 或 migrations）  
- **Runtime：** `engine.js`、`patient_reply.js`、`welcome.js`、`modules/qiwe/callback.js`（入群）  
- **API：** 新 `routes` 模块挂载 outbound CRUD  
- **Admin UI：** 新菜单与两页；旧路由 redirect；企微页去掉贴片运营段  
- **复用：** `CodeResponseSteps` 交互可改编为「选素材 + 排序」；delivery / weapp_cover_ops 尽量不动协议

## 11. 开放实现细节（计划阶段拍板即可）

- steps 引用禁用素材时：跳过 vs 阻断整次回复（建议：跳过 + 日志）  
- 旧 `/api/admin/rules` 写接口：只读兼容多久  
- 「新建编号」是只建 `group_code` 文件夹，还是同时建空 `kind=code` 触发（建议：**同时建空触发**，减少漏配）
