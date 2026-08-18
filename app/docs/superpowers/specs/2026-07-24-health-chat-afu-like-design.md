# 群内阿福式轻会话（health_chat）· 设计说明

**日期：** 2026-07-24  
**状态：** 已落地（工程）/ 本地 `.env.local` 与 `.env.agent` 已加 `HEALTH_CHAT_ENABLED=1`；云测需确认同名环境变量并重启进程。演示知识 patch：`health_chat_demo_kb_v1`（胆囊术后饮食/腹痛观察）。  
**实施计划：** `docs/superpowers/plans/2026-07-24-health-chat-afu-like.md`  
**产品对标：** 蚂蚁阿福式「像真正医疗助手」的对话体验（本地版，非全量复刻）  
**范围：** 企微群 / 社群入站 Dialogue Agent；一期不改小程序/H5 Runtime  
**前置：** `2026-07-17-dialogue-agent-design`、知识运营 RAG（`knowledge_items` / `retrieveKnowledge`）、L2 贴片闸门  

---

## 1. 背景与目标

### 1.1 现状问题

当前 Dialogue Agent 更像「服务路由 + 合规出站机」：

- 理解层以正则为准，问病易被打成 handoff / 开卡话术  
- Compose **不注入**知识库；知识运营与群对话断链  
- 多轮几乎只有用户原文截断，缺少 assistant 历史与相位  
- 软模板同质（「群里不做结论 / 请转人工」），不像真人医助  

主人期望：对标阿福——**会追问、能据实答、语气像人、记得上文**（已确认优先级 1+2+3+4）。

### 1.2 目标

在现有 Agent 上增加专用路径 **`health_chat`（群内阿福轻会话核）**：

1. 低/中危问病：接住 → 追问 → 有依据的健康教育  
2. 急危 / 开药 / 确诊诉求：仍走安全或 escalate，不放宽合规  
3. 纯服务 / 编号快路径：行为不变  
4. 可用开关整段回滚到现网医疗 handoff  

### 1.3 成功标准（一期可验收）

| # | 场景 | 期望 |
|---|------|------|
| 1 | 「胆囊切除后能吃鸡蛋吗」+ ready 知识命中 | 接住 + 据实要点 + ≤2 追问；不首轮教发 101 |
| 2 | 「我肚子有点疼」 | `intake`：问部位/时长/加重；不附卡 |
| 3 | 续轮补症状 | 引用上文；不重复自我介绍；有据则 `educate` |
| 4 | 「给我开点止痛药」 | `escalate`；不指导用药 |
| 5 | 急危表述 | 安全话术优先；不进 educate |
| 6 | `HEALTH_CHAT_ENABLED=0` | 与现网医疗 handoff 一致 |
| 7 | sufficiency=`none` | 诚实追问/说明不足；不编造 |

### 1.4 非目标（一期）

- 1:1 复刻阿福中台 / 大图谱 / 多模态读片  
- 小程序/H5 切同一 Runtime（二期复用核）  
- 群内正式报告解读、诊断、开药  
- 跨医生知识混检、长期跨月画像  
- 销售裂变、删除 engine/triage  

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 路线 | **B**：群内阿福轻会话层，非最小补丁、非重做全 Agent |
| 体验优先级 | 追问 + 据实答 + 人味 + 多轮记忆 |
| 通道一期 | 仅群 / 社群 Agent（`community.handleInbound` → `agent.runTurn`） |
| `intake`/`educate` | **默认不附小程序卡** |
| `escalate` + L2 | 允许附 101（兼容现网 `canAttachMiniProgram`） |
| 证据 | 强制 `retrieveKnowledge`；`none` 不编造；一期接 knowledge，建议接 FAQ |
| 回滚 | `HEALTH_CHAT_ENABLED`；关则旧行为 |

---

## 3. 架构

### 3.1 入站分流（扩展 `runTurn`）

```text
纯编号/菜单口令 → CodeFastPath（不变）
急危 floor / ClinicalRisk=high → 安全话术（不变）
明确纯服务且无医疗线索 → service + 开卡（不变）
问病/症状/护理/报告口语/子人设 → health_chat（新建）
未识别且无医疗线索 → clarify（短、人味）
```

### 3.2 模块落点

| 模块 | 职责 |
|------|------|
| `agent/health_chat.js`（新） | 相位、抽槽合并、检索、调用 compose、写 session |
| `agent/planner.js` | 新增 `intendedAction/goal=health_chat` 分支 |
| `agent/runtime.js` | 分流到 health_chat；meta.path=`health_chat` |
| `agent/compose.js` 或 `compose_health_chat.js` | 阿福式 prompt + 证据 + 多轮 |
| `agent/session.js` | `chatPhase`、完整 turns、槽位合并 |
| `triage.retrieveKnowledge` | 证据主路径（已有） |
| `agent/risk.js` | 基本沿用；health_chat 教育默认不标 `hasMedicalAdviceText` |

```text
QiWe/community
  → Agent.runTurn
       → …既有快路径/急危/纯服务…
       → health_chat.run
            Understand(+轻量抽槽) → retrieveKnowledge
            → phase 决策 → composeHealthChat → OutboundGate
```

---

## 4. 会话状态机

### 4.1 相位

| 状态 | 含义 | 转移 |
|------|------|------|
| `intake` | 信息不够，以追问为主 | 槽够或问题极具体且 evidence=enough → `educate`；红线 → `escalate` |
| `educate` | 有据健康教育 + 可选 1 追问 | 续聊补信息 → intake/educate；要看病/开药 → escalate |
| `escalate` | 开药/诊断诉求/急危/明确要医生 | 安全话术或 L2 附卡 + handoff |

### 4.2 槽位（最少集）

`bodyPart`、`duration`、`worsening`、`knownFacts`、`userGoal`  
跨轮合并：只增不瞎改；已答追问写入 knownFacts，禁止重复追问。

### 4.3 硬规则（冻结）

1. 急危只升不降；health_chat 不得压过 emergency/high  
2. 开药/点名剂量/确诊断言 → 不进 educate 自由答  
3. intake/educate 不附卡；escalate 且 L2（或显式要问诊）才可附卡  
4. 一轮结构：接住 →（有据则 2～4 句教育）→ 最多 1～2 追问；禁问卷式、禁客服开场套话  

---

## 5. 证据注入

### 5.1 来源优先级

1. `knowledge_items`（ready）+ 向量/本地检索（必须）  
2. 医生 FAQ（建议一期做）  
3. 运营科普口径（二期可选）  

### 5.2 检索

```text
query = 本轮用户话 + 已知槽位短串
→ retrieveKnowledge(ctx, query, topK=3)
```

| sufficiency | 行为 |
|-------------|------|
| enough | educate：只据 evidence 改写 + 可选 1 追问 |
| partial | 保守答片段 + 说明不够 + 追问 |
| none | 禁止编造：只 intake 或说明资料不足 |

对模型：只能用证据块；不得向患者暴露「知识库/来源编号」；可说「按我们团队常用说明」。

### 5.3 失败

无 key → 本地 2-gram；检索失败 → 当 none；与急危冲突 → 急危优先。

### 5.4 运营依赖

种子提纲若仍是空壳，检索易 none——**内容运营与工程并行**；工程侧无证据时诚实追问，不装懂。

---

## 6. Compose 人设与多轮

### 6.1 人设

- 身份：医生团队医助；不暴露 AI  
- 语气：短句、接原话；禁「这位朋友 / 温馨提示 / 我先帮您记录 / 咱们群里主要聊××」  
- 篇幅：群内约 80～220 字；可拆气泡  
- 红旗才强调急诊/120；轻症不每轮长免责  
- 运营键建议：`personaHealthChat`（缺省内置）  

与旧 compose「过宽、不强制追问」提示分离：`health_chat` **明确要求接诊式追问**。

### 6.2 Session

在 `agent_sessions` 的 JSON 语义中扩展（一期可不改表）：

- `chatPhase`  
- `slots`  
- `turns`：最近 8～12 轮，**含 user 与 assistant**  
- `summary`：≤200 字滚动摘要（可选每 4 轮更新；失败则用槽位+近 4 轮）  

Compose 输入：system → 摘要 → 槽位 → 证据+充分度 → 近 N 轮 → 本轮用户话。

### 6.3 LLM 失败降级

槽位感知软模板；禁止退回「请发 101」唯一终态；违禁撕句；escalate 走安全/交接话术。

---

## 7. Plan / 风险 / 出站

### 7.1 Planner

命中 health_chat 入口时：

- `intendedAction` / `goal` = `health_chat`  
- `toolCalls` = `[{ reply_text, tone: health_chat }]`  
- 默认 `preferredCode=null`，`hasMedicalAdviceText=false`  
- `handoff` = (phase === escalate)  
- escalate 时可加 `handoff_human`；仅 L2/显式问诊时 `open_chunyu_card(101)`  

### 7.2 SendPolicy

| phase | 倾向 | 说明 |
|-------|------|------|
| intake / educate | auto（在现 clinical 允许时） | 追问与有据教育可自动发 |
| escalate | 沿用 card_only / review | 不放宽 |
| 后置扫到开药/确诊 | 降级或 review | 单测锁样例 |

有据**生活/护理教育**一期不标 `hasMedicalAdviceText`，避免全盘进 review；靠后置扫描防「像医嘱」漏出。

### 7.3 社群

`source` 仍为 `dialogue_agent`；`agentMeta.path` = `health_chat` 便于审计。

### 7.4 开关

```text
DIALOGUE_AGENT_ENABLED=1
HEALTH_CHAT_ENABLED=1    # 新；≠1 则完全回旧医疗 handoff
```

---

## 8. 测试与验证

- 单测：`app/_health_chat_test.js`（分流、相位、evidence none、禁附卡、开关回滚）  
- 演示：扩展 `_agent_demo.js` health_chat 样例  
- 人工：上表 7 条验收  

---

## 9. 实施顺序（供 writing-plans）

1. flags + planner 分流 + 开关回滚单测  
2. session 相位/完整 turns  
3. health_chat 核：检索 + phase + compose  
4. runtime 接线 + community 冒烟  
5. FAQ 证据（若一期纳入）  
6. 样板对话回归 + 文档勾选成功标准  

---

## 10. 开放项 / 二期

| 项 | 状态 |
|----|------|
| 小程序/H5 共用 health_chat 核 | 二期 |
| 报告 OCR / 多模态 | 不做（一期） |
| 运营 prompt 控制台可视化 | 可选 |
| 效果回收与「有用回答率」指标 | 二期 |

---

**自行裁定记录：** 主人确认路线 B 与 §1～§4；对标阿福体验但合规底线（急危/开药/诊断）不放宽。  
**下一步：** 主人审阅本规格 → 无异议后调用 writing-plans 写实施计划 → 再编码。
