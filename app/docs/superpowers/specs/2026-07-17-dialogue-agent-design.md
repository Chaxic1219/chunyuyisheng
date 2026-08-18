# 对话 Agent Runtime 设计（混合模式 · 一期）

**日期：** 2026-07-17  
**状态：** 已实现；云端测试环境已开（`DIALOGUE_AGENT_ENABLED=1`，`AGENT_DRY_RUN=0`）  
**目标工程：** `app/agent/` + QiWe 群/单聊接入开关；欢迎语统一见 `welcome.js`  
**产品模式：** B · 混合自然语言 + 编号硬跳转保留  

## 1. 已确认决策

| 项 | 决策 |
|----|------|
| 交互 | 自然语言办事；复杂医疗转人工；服务类直出春雨卡 |
| 编号 | 保留硬跳转（纯 `101`/`1`/菜单口令走 CodeFastPath） |
| 通道一期 | 群 + QiWe 单聊；H5 仍旧 `patient_reply` |
| Agent 形态 | **单 Agent + 工具集** |
| 出站 | 低危服务类可自动发；自由医疗建议待审 |
| medium + 仅发卡 | **允许 `card_only` 自动发**（短交接语 + 卡，无病情解读） |
| medium + 医疗建议文案 | **强制 review** |
| 风险 | 两轴：`ClinicalRisk` × `SendPolicy`；多信号定档；动作门控为主裁判 |
| 环境 | 本地默认 `AGENT_DRY_RUN=1`；云测显式 `=0` 与群/QiWe 出站闸门联动 |
| 回复文案 | **优先 LLM 生成**（过双闸）；无模型时用多样化软模板，禁止回到「请发 101」口令说明书作为唯一终态 |
| 欢迎语 | **运营 `groupWelcome` → 硬编码兜底**（QiWe / community / admin 同源；社群工作台不再本群改写） |
| 运营配置安全域 | **与两轴对齐**：`levels.*.action/sendPolicy` 说明 + 自动升级旧默认；真出站仍由 `agent/risk.js` 裁定 |

## 2. 目标与成功标准

### 2.1 目标

用 Dialogue Agent Runtime 替换群/单聊主回话路径：理解 → 风险 → 计划 → 工具 → 合成 → 出站闸门；编号硬跳转兼容；引导春雨小程序靠工具而非教口令。

### 2.2 成功标准（本地）

1. 纯编号行为与现网 `engine.match` 硬跳转一致（`source=code_fast_path`）。  
2. 「想找主任看看 / 怎么挂号」→ 自然引导语 + `open_chunyu_card`，患者无需发编号。  
3. 急危 → ClinicalRisk high/emergency + 固定安全话术；不自动发病情解读。  
4. 「胃痛想开药」类 → SendPolicy=review，进待审或 handoff。  
5. `AGENT_DRY_RUN=1` 时出站标记 `sent_mode=dry_run` / 模拟，不调真发或 QiWe 已 DRY_RUN。  
6. 单测覆盖 CodeFastPath、风险两轴、服务意图发卡、医疗 handoff；默认 `TRIAGE_AI_DISABLED=1` 可跑。  

### 2.3 明确不做（一期）

- H5 切新核、真多企微头像（云测 Agent 已开，正式全量另批） 
- 销售裂变 / 完整 RAG / 多医生同群联动  
- 删除 `engine`/`triage`（仍作地板与 H5 / CodeFastPath）  

## 3. 架构

```text
QiWe processEvent（开关开）
  → CodeFastPath? → 旧 engine 响应形状
  → else DialogueAgent.run(turn)
       Understand → RiskEngine → Planner → Tools → Composer → OutboundGate
  → 映射为 buildPatientReply 兼容形状 → prepareDelivery（既有投递）
```

### 3.1 模块

| 文件 | 职责 |
|------|------|
| `agent/runtime.js` | `runTurn` 编排 |
| `agent/session.js` | 多轮槽位/摘要（内存 + 可选落库） |
| `agent/understand.js` | 抽槽、服务意图、医疗意图启发式 |
| `agent/risk.js` | ClinicalRisk + SendPolicy |
| `agent/planner.js` | intended_action + tool_calls |
| `agent/tools.js` | open_chunyu_card / open_menu / handoff / reply_text / ask_clarify / noop |
| `agent/compose.js` | LLM 或软模板合成患者可见文案 |
| `agent/index.js` | 开关、对外 API |

### 3.2 与旧链路关系

- 开关关：`processEvent` 仍只调 `buildPatientReply`。  
- 开关开：群/单聊文本走 Agent；失败 fail-closed 回落 `buildPatientReply`。  
- H5：不动。  
- `replyAutoSendable`：识别 `dialogue_agent` / `code_fast_path`，尊重 `triage.canAutoSend`。  

## 4. 风险引擎

### 4.1 输入

`utterance + slots + history_summary + attachmentHints + intended_action(+ outbound draft)`  

词表 `scanRisk` 仅作 **ClinicalRisk 地板**（只升不降）。

### 4.2 两轴

- `ClinicalRisk`: `low | medium | high`（emergency 记在 flags）  
- `SendPolicy`: `auto | card_only | review | block`  

### 4.3 动作门控（冻结）

| ClinicalRisk | intended_action | SendPolicy |
|--------------|-----------------|------------|
| low | reply_service / open_chunyu_card / open_menu | auto |
| low | reply_medical_advice | review |
| medium | open_chunyu_card only（无医疗建议句） | card_only → 可自动 |
| medium | 含医疗建议 / handoff | review |
| high / emergency | 任意自由建议 | block → 安全模板；emergency 不附问诊成交卡 |

外发前对 **载荷**（文案）再跑 `postScanLowRiskReply`；不过则降级安全模板或改 review。

## 5. 工具

| 工具 | 说明 |
|------|------|
| `open_chunyu_card(code)` | 加载 rules 中该 code 的 mp/link 响应 |
| `open_menu` | `buildMenuText` |
| `reply_text` | Composer 产出 |
| `handoff_human` | needsHuman + 待审 |
| `ask_clarify` | 补槽问句 |
| `noop_silent` | 明确噪音（门控已静默的不进 Agent） |

默认服务码映射（可配置覆盖）：咨询→101，挂号→303/201，加号→404，住院→414，简介→808。

## 6. Composer（非写死）

1. 有模型且未 `TRIAGE_AI_DISABLED`：生成 ≤200 字服务引导，禁止诊断/用药；过 `postScanLowRiskReply` + 可选 L2 recheck。  
2. 失败：按 `goal` 选软模板库中 **随机/轮换** 的 2～3 条变体（仍引导工具结果，不强迫患者记编号）。  
3. high/emergency：沿用 triage 安全话术语义（确定性，允许）。  

## 7. 本地环境

```text
DIALOGUE_AGENT_ENABLED=1
AGENT_DRY_RUN=1          # 默认视为开；显式 =0 才允许与 QiWe 真发联动（仍受 qiwe.DRY_RUN）
TRIAGE_AI_DISABLED=1     # 单测
# 可选：LOW 路径复用 MIMO/DEEPSEEK key 做真实合成
```

验收：**不部署、不上传生产机。**

## 8. 验证

- `_agent_test.js`：CodeFastPath、服务意图发卡、医疗 review、急危 block、SendPolicy 表。  
- 手动：本地 `node _agent_demo.js` 多轮假对话打印 tool_calls 与文案。  

## 9. 开放项

| 项 | 状态 |
|----|------|
| Session 持久化表 `agent_sessions` | **已做**（内存 + SQLite） |
| 附件视觉信号（报告/药盒启发式） | **已做**（文件名启发式；未接多模态 OCR） |
| `community.handleInbound` 接 Agent | **已做** |
| H5 二期接入同一 Runtime | 未做 |
| 与多医生同群规格对齐 | 未做 |
| 多模态真正读图 | 未做 |  

---

**自行裁定记录：** medium 仅发卡 → `card_only` 可自动；夹带医疗建议 → review。  
**下一步：** 实现 `app/agent/*` 并接线 QiWe（开关默认关，本地测时开）。
