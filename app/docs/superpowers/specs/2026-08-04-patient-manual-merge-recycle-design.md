# 患者档案手动合并与限时回收站设计

**日期：** 2026-08-04  
**状态：** 已上线（2026-08-04）  
**范围：** admin-ui「患者档案」；后端 `patients` / 新表 `patient_archive_ops`  
**非目标（本期）：** 旧版 `admin.js` 对等改造；跨医生合并 UI；过期后物理清理；事件溯源式任意时刻还原  

---

## 1. 背景与问题

现有能力：

- 同医生自动合并（企微身份 / 已验证同号等）
- 后台「疑似同名」合并（admin-ui）
- 同号未验证仅提示（旧后台有同号并档入口）

缺口：患者先走**邀请建档**，再在**群里发言**时，两条档案经常对不上号；医助无法自由挑选两档合并，也无法在合并前看清/改写字段结果。另需**删除档案**并在短时内可恢复。

## 2. 目标

1. **手动合并任意 2 份**同医生患者档案（含从疑似同名 / 同号待确认一键进入）。
2. **字段逐条决议 + 右侧实时预览**，确认前展示合并后呈现方式。
3. **合并限时撤销（24h）**；**软删除 + 24h 恢复**；页顶**回收站**集中处理。

成功标准见 §8。

## 3. 方案选择

采用 **统一归档操作模型**（方案 2）：

- 新表 `patient_archive_ops` 记录 merge / delete、双档快照、字段决议、过期时间与状态。
- `patients.archived_at` 表示软删或已被合并归档；主列表默认过滤。
- 不采用「仅前端预览 + 物理删源」的脆回放，也不做全量事件溯源。

## 4. 用户流程

### 4.1 入口（admin-ui 患者档案页）

| 入口 | 行为 |
|------|------|
| 工具栏「合并档案」 | 勾选恰好 2 人后可用；打开合并向导 |
| 行内「疑似同一人」/「同号待确认」 | 预填两档，打开同一向导 |
| 行内「删除」 | 软删 + 写 delete ops；二次确认 |
| 页顶「回收站」 | 列出 24h 内可恢复的删除与可撤销合并 |

### 4.2 合并向导（三栏）

- 左：档案 A 只读摘要  
- 中：档案 B 只读摘要  
- 右：**合并后预览**（可编辑）  
  - 每个标量字段：选 A / 选 B / 手改  
  - 备注：默认拼接，可改  
  - **保留档（keep）**：默认「消息更多，并列则 id 更小」；可切换；消息/提交/随访/身份等关系迁到 keep  
  - 确认文案明确：另一档进回收站，24h 可撤销  

### 4.3 字段决议默认值

| 字段 | 默认 |
|------|------|
| `real_name` / `phone` / `avatar_url` 等 | 非空优先；两边都有 → 优先「有已验证手机 / 联络表渠道」一侧 |
| `display_name` | 沿用现有 `preferDisplayName` 语义，可手改 |
| `phone_verified` | 任一侧为真则真（不可手改为假若任一侧已验证——预览只读展示） |
| `notes` | 拼接，截断与现网一致（如 2000） |
| `gender` / `birth_date` / `tags` / `follow_stage` | **纳入决议**（弥补现 `mergePatients` 未合并这些字段的缺口） |

预览返回的对象必须与确认落库结果一致（同一套 `resolveFields` 纯函数）。

## 5. 数据模型

### 5.1 `patients` 扩展

- `archived_at TEXT NULL`：非空表示不在主列表展示（软删或 merge 源档归档）。

### 5.2 新表 `patient_archive_ops`

| 列 | 说明 |
|----|------|
| `id` | PK |
| `doctor_id` | 医生范围 |
| `op_type` | `merge` \| `delete` |
| `keep_patient_id` | merge 保留档；delete 时等于被删档 id |
| `source_patient_id` | merge 被并档；delete 时同 keep（或仅用 keep） |
| `field_resolutions_json` | merge 字段决议 |
| `keep_snapshot_json` | 操作前 keep 行快照（含关键计数/关联 id 列表摘要） |
| `source_snapshot_json` | 操作前 source 行快照 + 需回滚的外键归属清单 |
| `relation_moves_json` | 本次从 source→keep 迁移的表行 id 列表（供撤销精确回滚） |
| `status` | `active` \| `undone` \| `expired` |
| `expires_at` | `created_at + 24h` |
| `created_by` | 操作者 user id |
| `created_at` / `undone_at` | 时间 |

索引：`(doctor_id, status, expires_at)`；`(keep_patient_id)`；`(source_patient_id)`。

### 5.3 合并时行为（相对现状）

改造现有 `mergePatients`（或旁路 `mergePatientsSoft`）：

1. 写 `patient_archive_ops`（status=active）。  
2. 按 `field_resolutions` 写回 keep。  
3. 迁移 identities / members / messages / submissions / followups / health / triage 等到 keep（记录 `relation_moves_json`）。  
4. 对 source 设 `archived_at=now`，**不物理 DELETE**。  
5. person 层：若两边 `person_id` 不同，仍先走现有 `mergePersons`；撤销合并时 person 层若已与其它医生共享，**只回滚本医生 patient 与关系**，person 合并不自动拆（在预览中提示「全局人物关系不因撤销而拆分」）。

### 5.4 删除行为

1. 写 op_type=delete 快照。  
2. 设 `archived_at`。  
3. 不级联删消息（保留数据，仅列表隐藏）。

### 5.5 撤销

- **撤销删除**：`archived_at=NULL`，ops→`undone`。  
- **撤销合并**：按 `relation_moves_json` 把关系迁回 source；用快照恢复两行字段；source/keep 的 `archived_at` 恢复；ops→`undone`。整单事务。  
- **拒绝撤销**：ops 非 active、已过期、keep 在窗口内又作为 source 参与了另一次 active merge（依赖链）。  
- **过期任务**：定时将 `expires_at < now` 且 active 的 ops 标为 `expired`（本期不做物理删行）。

## 6. API

均需登录 + 医生范围校验。

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/admin/patients/merge-preview` | `patients.merge` | body: `{ doctorId, patientIdA, patientIdB }` → 并排字段、默认决议、preview、suggestedKeepId |
| POST | `/api/admin/patients/merge` | `patients.merge` | 扩展 body: `{ doctorId, keepId, mergeIds:[sourceId], fieldResolutions }`；仅允许 length=1 的 mergeIds（本期强制两档） |
| POST | `/api/admin/patients/:id/archive` | `patients.archive`（新增，默认同 merge 角色） | 软删 |
| GET | `/api/admin/patients/recycle-bin` | `patients.merge` 或 `patients.archive` | `doctorId`；返回 active 且未过期 ops |
| POST | `/api/admin/patients/archive-ops/:id/undo` | 与原 op 对应权限 | 撤销 |

`GET /api/admin/patients`：继续可触发自动合并副作用；结果中排除 `archived_at IS NOT NULL`；保留 `suspectDuplicate*` / `duplicatePhone*` 标记。

## 7. 前端（admin-ui）

- 文件：`admin-ui/src/views/chunyu/archive/index.vue`（及必要时拆出 `MergeWizard.vue`、`RecycleBinDrawer.vue`）。  
- API 封装：`admin-ui/src/api/chunyu/index.ts`。  
- 列表多选（最多高亮 2）；合并向导用 `merge-preview` 驱动右侧预览。  
- 回收站抽屉：类型、双方摘要、剩余时间、撤销按钮。

## 8. 错误与边界

| 情况 | 处理 |
|------|------|
| 非恰好 2 人 | 前端禁用；后端 400 |
| 档已 archived / 不存在 | 409，提示刷新 |
| 撤销过期 / 已 undone | 410 / 409 |
| 连环合并依赖 | 409 + 说明 |
| 合并后与第三档已验证同号 | 预览警告，默认可确认继续 |
| 无权限 | 隐藏按钮；API 403 |

## 9. 验收场景

1. 邀请建档档 + 群聊档：自由选 2 → 改字段 → 预览与落库一致 → 合并成功 → 回收站撤销 → 消息回到原档。  
2. 疑似同名 / 同号入口预填两档，流程同上。  
3. 删除后主列表消失；回收站 24h 内可恢复；模拟过期后不可恢复。  
4. 无 `patients.merge` / `patients.archive` 的账号看不到对应操作且 API 403。

## 10. 测试建议

- 扩展 / 新增：`app/_patient_phone_merge_test.js` 旁路或 `_patient_archive_ops_test.js`：软合并、撤销合并、软删、撤销删、过期拒绝。  
- 前端：向导决议与 preview 一致性可用组件单测或手工清单。

## 11. 明确不做（本期）

- 一次合并超过 2 份。  
- 旧 `public/admin.js` 完整对齐。  
- `POST /persons/merge` 产品化 UI。  
- 撤销时拆分已合并的全局 `persons`。  
- 过期后物理删除 archived 行与消息。
