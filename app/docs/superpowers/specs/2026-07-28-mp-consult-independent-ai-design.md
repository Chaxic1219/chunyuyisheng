# 小程序咨询独立 AI 对话（仿静态项目内核）设计

**日期：** 2026-07-28  
**状态：** 已批准并实施中  
**范围：** 患者端 UniApp 咨询页 + 新建 Node 代理模块；不改企微群聊、分诊台、原 `/api/message` 行为。

## 背景

当前小程序咨询页通过 `sendMessage` → `POST /api/message` 走系统既有 AI/分诊链路，并与本地 `consultMessages` 历史耦合。主人要求：

1. 咨询页新增垃圾桶：清空上下文并重新开启一轮对话；
2. 小程序 AI **不走**原系统对话逻辑；
3. 重新配置 API、对话设定与内容；
4. 以 `d:\静态项目` 的 AI 对话内核为参照（`aiProxy` + 上下文 + 清空），做独立模块落地，**不**搬校园 Agent Skills / 课表等业务。

## 目标

- 小程序咨询变为独立 LLM 对话通道。
- 垃圾桶可一键清空本地历史并换新 `sessionId`。
- 服务端提供仿 `aiProxy` 的非流式 chat completions 代理与独立 system prompt。
- 消息不进入 `message_log` / AI 分诊台。

## 非目标

- 不复刻校园 Agent Skills、语音、识图、天气、真流式 DB watch。
- 不重做咨询页整体视觉为校园 aichat 皮肤（仅加垃圾桶与换 API）。
- 不修改企微入站、分诊、出站发卡逻辑。
- 首版不把附图送入新 LLM（避免与旧上传链路缠绕）。

## 已确认决策

| 项 | 选择 |
|----|------|
| 复刻范围 | A：对话内核（清空 + 代理 + prompt + 近轮上下文） |
| 代理落点 | 春雨 Node 新路由（非微信云函数） |
| 人设 | 春雨健康助手（独立身份，不隶属任何医生） |
| 消息归档 | 完全独立：不写 message_log、不进分诊 |
| 流式 | 非流式一次性返回 |
| 落地路径 | 独立模块 + 新前端 API 客户端（路径 2） |

## 架构

```text
patient-uniapp/pages/consult
  ├─ 垃圾桶 → 确认 → 清本地历史 + 新 sessionId + 欢迎语
  └─ 发送 → api/aiChat.ts → POST /api/mp/ai-chat
                              ↓
                    modules/mpAi（新建）
                      ├─ buildSystemPrompt(doctor)
                      ├─ 组装 OpenAI 兼容 messages
                      └─ HTTP → DeepSeek/兼容网关（非流式）
                              ↓
                         { reply: { id, role, text } }
```

**边界：** 咨询页不再调用 `sendMessage` / `/api/message`。密钥仅存服务端。

## 组件与文件

### 服务端（`app/`）

- `modules/mpAi/prompt.js` — system prompt 拼装  
- `modules/mpAi/client.js` — chat completions 调用（仿静态项目 `aiProxy` 请求形态）  
- `modules/mpAi/index.js` — `chat({ doctorId, text, history, sessionId })` 门面  
- `routes/mp-ai.js` — 注册 `POST /api/mp/ai-chat`  
- 测试：`_mp_ai_test.js`（prompt + mock 上游成功/失败）

### 前端（`patient-uniapp/`）

- `src/api/aiChat.ts` — `postMpAiChat(...)`  
- `src/pages/consult/index.vue` — 垃圾桶 UI；改用 `aiChat`；独立 storage key；去掉对 `/api/message` 的依赖  
- 可选：`src/utils/mpAiSession.ts` — sessionId 读写

## 数据流

### 发送

1. 用户输入文字 → 追加 user 气泡到本地 messages。  
2. `history` = 近约 10 轮（不含欢迎语占位，或欢迎语不送上游）。  
3. `POST /api/mp/ai-chat` 带 `doctorId`、`sessionId`、`text`、`history`。  
4. 服务端拼 system + history + 本轮 user → 调模型 → 返回 assistant 文本。  
5. 前端追加 assistant 气泡并持久化到本地。

### 清空

1. 二次确认。  
2. 删除本地历史 storage；生成新 `sessionId`。  
3. `messages = [欢迎语]`。  
4. Toast「已清空」。  
5. 后续请求仅带新 session 与空/新 history。

## API 契约

`POST /api/mp/ai-chat`

请求：

```json
{
  "doctorId": "1",
  "sessionId": "uuid",
  "text": "用户问题",
  "history": [{ "role": "user", "text": "..." }, { "role": "assistant", "text": "..." }]
}
```

成功：

```json
{
  "reply": {
    "id": "…",
    "role": "assistant",
    "text": "…"
  }
}
```

鉴权：可选小程序 Bearer（有则识别会话，无也可聊，与现咨询「不强制登录」一致）。

环境变量（优先）：

- `MP_AI_API_KEY`
- `MP_AI_BASE_URL`（默认兼容 `https://api.deepseek.com` 或项目既有兼容网关形态）
- `MP_AI_MODEL`

未配置 `MP_AI_*` 时，允许回退读取现有 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`（**仅共用密钥与地址，代码路径不得进入 triage / agent / health_chat**）。

## 人设（system prompt 要点）

- 身份：**春雨健康助手**（平台独立助手）。  
- **不隶属**任何一位医生或医院团队，不代表某位医生发言。  
- 风格：自然、接得住、可适度追问。  
- 可做：一般健康科普、诊后注意事项常识提醒、引导完善档案/加号等产品入口。  
- 不可做：确诊、开药、替代面诊；不以某医生名义给诊疗意见；急危重症引导线下急诊/120。  

欢迎语与 UI 署名统一为「春雨健康助手」。

## 错误处理

| 情况 | 行为 |
|------|------|
| 缺 API Key | 503，文案提示未配置 |
| 上游超时/非 2xx | 502，前端可重试 |
| 空 text | 400 |
| 医生不存在 | 404 |

前端失败时保留 `failedPayload` 重试能力（文字-only）。

## 存储

- 历史 key：`mpAiChatHistory`（与旧 `consultMessages` 分离，避免串话）。  
- session key：`mpAiSessionId`。  
- 上限：本地最多保留约 200 条气泡；送上游约 10 轮。

## 测试要点

1. 单元：prompt 含医生名与禁诊约束；client 在 mock 下返回 content。  
2. 缺 Key 时接口 fail-closed。  
3. 手测：发送不打 `/api/message`；清空后模型看不到旧轮次；分诊台无新消息。  
4. 回归：H5/企微原 `/api/message` 路径不受影响。

## 风险与缓解

- **密钥回退误用旧逻辑**：实现上 `mpAi` 模块禁止 require triage/agent/health_chat。  
- **附图首版不支持**：UI 可保留选图，发送时若仅有图无字则提示「当前仅支持文字」。  
- **与旧本地历史并存**：换独立 storage key，进入页只读新 key。

## 结论

采用「独立 `modules/mpAi` + `/api/mp/ai-chat` + 咨询页垃圾桶与本地会话重置」方案，对齐静态项目对话内核职责，同时保持医患通产品边界与现有 Node 部署形态。
