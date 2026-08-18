# Dialogue Agent Runtime Implementation Plan

> **For agentic workers:** Execute task-by-task. Local only — do not deploy.

**Goal:** Ship a hybrid Dialogue Agent for QiWe group/DM with code fast-path, two-axis risk, tools for Chunyu cards, and LLM/soft-template composition.

**Architecture:** `app/agent/*` runtime behind `DIALOGUE_AGENT_ENABLED`; maps to existing reply shape for `prepareDelivery`. Default `AGENT_DRY_RUN=1`.

**Tech Stack:** Pure Node.js, reuse `engine` / `triage.scanRisk` / `postScanLowRiskReply` / `db`.

---

### Task 1: Agent core modules
- Create: `app/agent/{index,runtime,session,understand,risk,planner,tools,compose}.js`
- Test: `app/_agent_test.js`

### Task 2: QiWe wire + replyAutoSendable
- Modify: `qiwe_bridge.js` processEvent branch; `replyAutoSendable` for agent sources

### Task 3: Demo script + npm script
- Create: `app/_agent_demo.js`
- Modify: `package.json` scripts
