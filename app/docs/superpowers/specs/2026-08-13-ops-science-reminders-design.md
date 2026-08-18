# 运营中心 · 科普提醒（一期）

日期：2026-08-13  
状态：已确认（方案甲）

## 目标

把「生成周五科普 / 生成运营候选」从社群工作台迁到运营中心，并扩展为**每日/每周可设定的科普提醒计划**：到点只生成出站 `pending` 草稿，人工确认后再发送。

## 范围

### 做

1. 新菜单：运营中心 → **科普提醒**（`/ops/science-reminders`）
2. 计划表 CRUD：目标群、周期（每天/每周几）、整点小时、主题、来源（模板科普 / ready 知识源候选）、启用
3. 服务端 tick（与现有周运营类似，默认可用）：到点幂等生成 `pending`，`source=science_reminder`
4. 草稿区：筛选科普相关草稿，编辑 / 发送 / 取消（复用现有出站 API）
5. 快捷生成：立即周五科普、立即运营候选（可选群）
6. 社群工作台去掉两个生成按钮，文案引导到本页

### 不做（一期）

- 到点自动发群
- 分钟级调度、多步骤编排
- 新权限码（复用 `community.campaign.create` / `ops.candidate_generate`）

## 数据

表 `science_reminder_plans`：

| 字段 | 说明 |
|------|------|
| doctor_id / group_id | 归属 |
| cadence | `daily` \| `weekly` |
| weekday | 0–6（周日=0），仅 weekly |
| hour | 0–23，按北京时间整点 |
| topic | 主题 |
| mode | `template` \| `ops_candidate` |
| knowledge_id | 可选，mode=ops_candidate |
| enabled | 0/1 |
| last_fire_key | 幂等键（日：`YYYY-MM-DD`；周：`YYYY-Www-d`） |

## 二期页面升级（2026-08-13 已上线）

- 去掉「立刻生成周五科普 / 立刻生成运营候选」
- 主流程：生成科普文案弹窗（主题+基础信息+是否引用知识源）→ AI 草稿 → 审核区可推送群聊 / 设置定时（方案 A：创建每日每周计划，到点仍待审）
- 接口：`POST /api/admin/science-reminders/ai-draft`
