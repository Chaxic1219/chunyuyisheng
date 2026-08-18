# Agent 群聊沙盒（ChatGPT 布局 · 系统配色）· 设计说明

**日期：** 2026-07-29  
**状态：** 已实现（2026-07-29）  
**目标工程：** `admin-ui` 新页面 + `app` 专用沙盒 API  
**产品模式：** 模拟患者在企微群发消息，走真实 Dialogue Agent，绝不真发  

---

## 1. 已确认决策

| 项 | 决策 |
|----|------|
| 用途 | 模拟患者端在群聊中发信息，验收 Agent 回复 |
| 展示 | 只显示患者可见回复气泡（无调试面板） |
| 医生 | **顶栏 DoctorSwitcher「当前医生」**；本页不另设下拉；切换医生自动新会话 |
| 出站 | **强制沙盒**：只调 `agent.runTurn`，禁止 enqueue / 禁止真发企微 |
| UI 档位 | ChatGPT 式布局（居中欢迎语、圆角输入条、快捷示例）；不做语音、「工作」真功能 |
| 配色 | **与 admin-ui 整体系统统一**（`--el-color-primary` / `--el-*` / `--art-*`），不做 ChatGPT 独立绿黑配色 |
| 挂载 | 方案 1：日常工作菜单下独立页 |

## 2. 目标与成功标准

### 2.1 目标

在医助后台提供「患者群聊模拟器」：选医生 → 以患者口吻发文本 → 看到医助群内可见回复；多轮会话与线上 `isGroup:true` 行为一致。

### 2.2 成功标准

1. 发送「我想找医生」「我肚子有点疼」「101」等，能收到与线上 Agent 一致形态的文本回复（多条 responses 按序展示）。  
2. 闲聊静默轮次：界面有明确「本轮未回复」提示，不假装有回复。  
3. 任意操作不产生 `outbound_queue` 新行、不调用 QiWe 真发。  
4. 换医生 / 新对话会隔离会话（不同 `patientKey`）。  
5. 视觉：布局像参考图，颜色跟分诊台/社群台同一套 CSS 变量，亮暗主题可跟随。

### 2.3 非目标（一期）

- 不展示 `agentMeta` / path / plan / toolCalls  
- 不传附件、不做语音输入  
- 不做「聊天 / 工作」双 Tab 真切换  
- 不写入社群消息表、不分诊落库  
- 不改线上 community/qiwe 入站链路  

---

## 3. 架构

```text
admin-ui /daily/agent-sandbox
  → POST /api/admin/agent/sandbox-turn
       → agent.runTurn({ doctorId, text, patientKey, isGroup:true, patientName })
       → 仅返回 responses 文本（及 session 标识）
  → 禁止 community.enqueue / outbox / qiwe.deliver
```

### 3.1 后端

| 接口 | 职责 |
|------|------|
| `POST /api/admin/agent/sandbox-turn` | 鉴权后调 `agent.runTurn`；强制沙盒；返回气泡文本 |
| `POST /api/admin/agent/sandbox-reset` | 按 `patientKey` 清 `agent_sessions`（新对话） |

**请求（sandbox-turn）**

```json
{
  "doctorId": 1,
  "text": "我肚子有点疼",
  "sessionId": "可选，前端生成的会话 UUID",
  "patientName": "可选，默认「测试群友」"
}
```

**patientKey 约定**

```text
sandbox:{adminId}:{doctorId}:{sessionId}
```

保证：同管理员多会话隔离；换医生不串槽；与真实群 `patientKey` 不冲突。

**响应（精简，面向气泡）**

```json
{
  "ok": true,
  "sessionId": "...",
  "bot": "医助",
  "bubbles": ["回复文本1", "回复文本2"],
  "silent": false
}
```

- `bubbles`：从 `responses` 中抽出 `type===text` 的正文；非文本卡（mp/link）一期可转成一句短提示（如「（已附服务入口卡）」）或忽略——默认：**忽略非 text**，仅展示患者能读到的文字。  
- `silent: true`：`responses` 为空且为闲聊静默路径时。  

**安全硬约束**

- 路由层不得 `require` outbox enqueue。  
- 即使 `agent` 返回 `autoSent/canAutoSend`，沙盒 API 也忽略，不落出站。  
- 需 admin 登录；`doctorId` 受账号医生范围闸（与现有 admin API 一致）。

**文件落点（建议）**

- 新路由：`app/routes/agent-sandbox-admin.js`  
- 在 `server.js` / route 挂载处注册（与其他 `*-admin` 一致）

### 3.2 前端

| 项 | 说明 |
|----|------|
| 路由 | `/daily/agent-sandbox`，菜单名「Agent 沙盒」或「群聊模拟」 |
| 页面 | `admin-ui/src/views/chunyu/agent-sandbox/index.vue` |
| API | `admin-ui/src/api/chunyu/index.ts` 增加 `chunyuAgentSandboxTurn` / `Reset` |

**布局（ChatGPT 结构 + 系统色）**

1. 顶区：居中 pill「聊天」（装饰性，不可切到工作）；右上可用系统图标区放「新对话」。  
2. 工具条：医生 `ElSelect`（拉 `/api/admin/doctors`）。  
3. 空态：居中标题「准备好了，随时开始」。  
4. 输入条：大圆角；左「+」禁用占位；placeholder「模拟患者在群里说…」；回车发送。  
5. 快捷示例：3 条（找医生 / 肚子疼 / 发 101），点即填入发送。  
6. 对话态：用户右对齐气泡，医助左对齐；滚动到底。  

**配色规则（强制）**

- 背景：`var(--el-bg-color)` / `var(--el-bg-color-page)`  
- 主色按钮、选中、发送：`var(--el-color-primary)` 及 light-*  
- 边框：`var(--el-border-color)`  
- 次要文字：`var(--el-text-color-secondary)`  
- 用户气泡：主色或 `primary-light-9` 底 + 主色字/白字（跟系统对比度选一种，亮暗都可读）  
- 医助气泡：`var(--el-fill-color-light)` 或卡片底  
- **禁止**硬编码 ChatGPT 绿、纯独立灰阶主题色；允许少量布局用的透明/阴影，但色相跟系统走  

沿用现有页面模式（如 triage 的 `.pill.on`）即可。

### 3.3 会话 UX

- 首次进入生成 `sessionId`（uuid）。  
- 「新对话」：调 reset + 清空本地 messages + 新 uuid。  
- 切换医生：自动新对话（避免串会话）。  
- Agent 开关关（`DIALOGUE_AGENT_ENABLED≠1`）：接口返回明确错误文案，前端 Toast 提示。

---

## 4. 与现网关系

| 模块 | 关系 |
|------|------|
| `agent/runtime.js` | 复用 `runTurn`，不改管道语义 |
| `community/orchestrate` | 不调用 |
| `outbox` / `qiwe` | 不调用 |
| 顶栏 DoctorSwitcher | 不联动；本页自选医生 |

---

## 5. 测试要点

1. 沙盒连发两轮医疗主诉，第二轮应带会话连续性（health_chat 开时）。  
2. 发「你好呀」类闲聊 → `silent` 提示。  
3. 发 `101` → 有编号快路径文本（若规则已配）。  
4. DB：操作前后 `outbound_queue` 行数不变。  
5. 亮/暗主题下气泡对比度可读。  

---

## 6. 开放项（一期外）

- 展开调试 meta  
- 附件模拟  
- 把沙盒回复一键写入分诊草稿  

---

**自行裁定：** 非 text 响应默认不渲染卡片 UI，仅文字气泡，避免一期做成「小程序卡预览器」。  
**下一步：** 主人确认本 spec 后，写实施计划并实现。
