# L2 限定小程序贴片 · 设计说明

**日期：** 2026-07-22  
**状态：** 待实现（已口头确认方案 A + L1 不附卡）  
**范围：** 患者群 AI 回复是否附春雨小程序贴片（weapp / mp / link 卡）

---

## 1. 背景与问题

当前低风险（L4）问病、中风险引导等路径常自动附 **101** 等小程序贴片，患者侧体感变成「凡事引流小程序」，与「轻症给建议、重症再开入口」不一致。

后台展示档位（`classifyLevel`）约定：

| 档 | 含义 | 本需求对贴片 |
|----|------|--------------|
| L1 | 急症 / 高危 | **不附卡**（维持急危禁推线上问诊） |
| L2 | 需医生 | **可附卡** |
| L3 | 需医助 | **不附卡**，给建议 |
| L4 | 低风险 | **不附卡**，给建议 |
| L5 | 编号指令 | **照旧附卡**（纯编号快路径） |
| L6 | 闲聊 | **照旧**（静默/原门控） |

---

## 2. 目标

1. **只有 L2（需医生）** 的自然语言对话路径可以触发小程序贴片。  
2. **L3 / L4**（以及一切非闲聊、非纯编号的对话）提供**安全建议类文案**，不引流到小程序（不发 weapp/mp/link 贴片，文案不强制「发 101 / 进小程序」）。  
3. **L5 纯编号**（含菜单口令）保持 `code_fast_path` 现行为。  
4. **L1** 继续只发 120 / 当日就医等安全话术，不附 101。  
5. 医疗安全底线不变：群内仍禁止诊断、用药方案、解读报告；建议仅限观察要点、何时线下就医、转人工跟进等。

非目标：不改 Lv 档位定义本身；不改编号规则库内容；不做欢迎语多卡策略变更。

---

## 3. 判定与闸门

### 3.1 复用 `classifyLevel`

以 `triage.classifyLevel(text, doctorId, opts)` 的 `level` 为准（与分诊台展示一致）。

入站回复链路应传入已合并的 `riskLevel` / `needsHuman` / `emergency` / `sentinel` / `needsDoctor`（若可得），避免 log 与实发不一致。

**L2 判定（与现网一致）：** `riskLevel === "medium"` 且 triggers / opts 命中「需医生」线索（用药|处方|诊断|手术|报告|检查结果|加重|不适|不良反应|医生 等，或显式 `needsDoctor`）。

### 3.2 统一发卡闸门

新增纯函数（建议放 `triage.js` 并导出）：

```js
function canAttachMiniProgram(level, opts)
// level === 2 → true
// opts.isKeywordRule / code_fast_path → true（L5）
// 其余 → false
```

所有自然语言路径的 `attachCardResponses`、`entryCode` 设卡、`open_chunyu_card` 工具调用，必须先过此闸门。

---

## 4. 行为变更（按路径）

### 4.1 `triage.handleIncoming`

| 场景 | 现行为（摘要） | 目标行为 |
|------|----------------|----------|
| high / L1 | 安全话术，清空 extraResponses | **不变** |
| medium 且 L2 | MEDIUM 开态引导 + 附 101 | 可附 101；文案可提一对一入口 |
| medium 且 L3 | 同上常附 101 | **不附卡**；引导型/观察建议文案；`needsHuman` 仍 true |
| low / L4 + LLM attach / 问病强制 101 | 强制 attach 101 + 引流话术 | **不附卡**；`attach` 列表忽略；问病走**建议模板**（非 disease-101 引流） |
| low 澄清追问 | 已清卡 | 不变 |

建议模板原则（L3/L4）：接住诉求 → 1～3 条可执行的非诊疗建议（休息/观察红旗/何时就医）→ 说明群内不做诊断；**不**要求发编号、**不**承诺小程序贴片。

### 4.2 Dialogue Agent

- `code_fast_path`：**不变**（L5）。  
- `planner.js`：非 L2 时禁止加入 `open_chunyu_card`；医疗向改为建议/转人工文案动作（可用既有 `reply_text` + handoff，或明确 `advice` tone）。  
- `compose.js`：非发卡路径去掉「附上小程序入口 / 进春雨」类硬引流句；改为建议语气。  
- `tools.js`：执行 `open_chunyu_card` 时若闸门拒绝 → 不附卡（fail-closed）。  
- 图片/报告：若分级为 L2 可附卡；否则建议 + 转人工、不附卡。

### 4.3 与旧「问病优先 101」关系

`2026-07-14-disease-consult-first-design` 中「问病强制引导 101 + 附卡」在 **L4（及 L3）自然语言路径作废**；仅 **L2** 与 **L5 编号** 仍可走问诊入口贴片。

---

## 5. 文案与配置

- 低危 LLM system 提示：问病优先改为「给安全建议，不要引导发编号/小程序」；`attach` 在 L4 应用层强制清空。  
- `mediumGuidedFallbackReply` / `diseaseConsultPriorityReply`：L3/L4 改用不引流版本；L2 可保留入口引导。  
- 不强制改运营后台脚本字段；运行时闸门优先于模型 `attach`。

---

## 6. 验收用例

| # | 输入（示意） | 期望档 | 贴片 | 文案 |
|---|--------------|--------|------|------|
| 1 | 「有点肚子疼怎么办」 | L4 | 无 | 有观察/就医建议 |
| 2 | 「这个药还能继续吃吗」/报告怎么看类 | L2 | 可有 | 可提一对一 + 转人工 |
| 3 | 发 `101` | L5 | 有 | 编号脚本 + 卡 |
| 4 | 「今天天气真好」 | L6 | 无 | 静默/原逻辑 |
| 5 | 胸痛/呕血等 | L1 | 无 | 120/急诊安全话术 |
| 6 | 轻症求助被升 medium 但非需医生 | L3 | 无 | 建议 + 医助跟进 |

---

## 7. 风险与回滚

- **风险：** L2/L3 边界依赖 triggers 正则，可能偶发 L3 该附未附或反之 → 宁可 L3 不附（少引流），用单测锁 triggers 样例。  
- **回滚：** 恢复 low/medium 附 101 与 disease-101 强制逻辑；闸门函数改为恒 true（仅应急）。

---

## 8. 实现触点（预览）

- `app/triage.js` — `canAttachMiniProgram`、`handleIncoming` 附卡与话术  
- `app/agent/planner.js` / `compose.js` / `tools.js` / `runtime.js`  
- 单测：`app/_agent_test.js` 或既有 triage/agent 测试文件补充上表用例  

部署：现有 `_deploy_test_server.py` / PM2 `chunyu-doctor` 流程。
