# 多医生同群（主诊自动回复 · 协诊共享可见）设计

**日期：** 2026-07-17  
**状态：** 已实现（实施计划：`plans/2026-07-20-multi-doctor-group.md`）  
**目标工程：** `app/`（后端 + 旧后台）、`admin-ui/`（新医助后台对接）  
**产品模式：** B · 同群共享 + 主诊负责自动回复  

## 1. 已确认决策

拍板（一期强制遵守）：

1. **仅主诊自动回复**；协诊不参与自动欢迎语、编号规则、AI 分诊自动出站。
2. **协诊可人工回复**：协诊本人及对应医助可在共享队列上主动出站，解决群内问题。
3. **协诊对应的 scoped 医助默认能看到共享群消息**；该可见性可关闭（群级或医助偏好，见 §5.3）。
4. **患者建档 / 加号 / 住院 / 联络表等提交一律归属主诊** `doctor_id`，不因协诊人工回复而改挂。

## 2. 目标与边界

### 2.1 目标

让一个真实企微业务群可以挂多名医生：

- 群内消息只归档一份；
- 自动回复主体始终是主诊；
- 协诊与其医助可共享看见、可人工处理；
- 患者表单与档案归属清晰，不因多医生挂群而分裂。

### 2.2 成功标准

1. 同一 `external_group_id` 在库中只有一条业务群实体（合并历史重复行）。
2. 群可配置 1 名 `primary` + N 名 `collaborator`。
3. 入站触发的自动出站全群任意时刻至多 1 条，且话术/规则取自主诊。
4. 协诊 scoped 医助在默认设置下能看到该共享群的入站/出站；关闭共享可见后不可见。
5. 新建联络表、加号、住院等 `submissions` 的 `doctor_id` 恒等于当前主诊。
6. 未挂多医生的旧群行为与改造前一致（兼容回退）。
7. 相关单测与本地/测试群回归通过。

### 2.3 明确不做（一期）

- 按关键词/病种把自动回复路由到不同医生（模式 C）。
- 同一条入站消息复制进多个医生的分诊台各一份。
- 多个 QiWe 实例按医生拆分回调。
- 患者端 H5 / UniApp 多医生切换与群方案联动。
- 改变非业务群静默策略、短信真发、支付等无关能力。

## 3. 角色与权限

### 3.1 群内医生角色

| 角色 | 代码值 | 自动回复 | 人工出站 | 后台可见共享队列 |
|------|--------|----------|----------|------------------|
| 主诊 | `primary` | 是（唯一） | 是 | 是 |
| 协诊 | `collaborator` | 否 | 是 | 是（受共享可见开关约束） |

每个业务群有且仅有一名主诊。更换主诊时：原主诊降为协诊，新主诊升为 primary，自动回复权一并转移。

### 3.2 医助账号

| 操作 | super | scoped（负责主诊） | scoped（仅负责某协诊） |
|------|-------|--------------------|------------------------|
| 查看共享群消息/出站 | ✓ | ✓ | ✓（默认；可关） |
| 人工出站 | ✓ | ✓ | ✓（若 `can_outbound=1`） |
| 设置业务群 / 改主诊 / 加减协诊 | ✓ | ✓ | ✗ |
| 关闭/打开「协诊医助共享可见」 | ✓ | ✓ | ✗ |
| 审核/编辑主诊自动回复草稿 | ✓ | ✓ | 只读可见草稿，不可改主诊自动策略 |

说明：协诊医助「能看」不等于「能改群配置」。人工出站使用出站队列，发送成功后记在群上，`outbound_queue.doctor_id` 记**实际操作所代表的医生**（主诊医助操作记主诊；协诊医助操作记该协诊），但**不改变**患者提交归属。

## 4. 数据模型

### 4.1 新增 `community_group_doctors`

```sql
CREATE TABLE IF NOT EXISTS community_group_doctors (
  group_id      INTEGER NOT NULL,
  doctor_id     INTEGER NOT NULL,
  role          TEXT NOT NULL DEFAULT 'collaborator', -- primary | collaborator
  auto_reply    INTEGER NOT NULL DEFAULT 0,           -- 仅 primary 应为 1
  can_outbound  INTEGER NOT NULL DEFAULT 1,
  joined_at     TEXT,
  note          TEXT,
  PRIMARY KEY (group_id, doctor_id),
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- 每群至多一名主诊（SQLite 部分唯一索引）
CREATE UNIQUE INDEX IF NOT EXISTS idx_cgd_one_primary
  ON community_group_doctors(group_id) WHERE role = 'primary';
```

写入约束（应用层双重校验）：

- `role='primary'` ⇒ `auto_reply=1`；
- `role='collaborator'` ⇒ `auto_reply=0`；
- 全群 `auto_reply=1` 的行数 ≤ 1。

### 4.2 `community_groups` 调整

| 字段 | 变更 |
|------|------|
| `doctor_id` | **保留**，语义固定为当前主诊；与关联表 primary 双写 |
| `share_visible_to_collab` | **新增** INTEGER DEFAULT 1：协诊侧 scoped 医助是否默认可看共享队列 |
| `external_group_id` | QiWe 真群在 `data_source='qiwe'` 且非 `local-%` 时全局唯一 |

建议索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_cg_qiwe_external
  ON community_groups(external_group_id)
  WHERE data_source = 'qiwe'
    AND external_group_id IS NOT NULL
    AND trim(external_group_id) != ''
    AND external_group_id NOT LIKE 'local-%';
```

### 4.3 消息 / 出站 / 提交

| 表 | 一期约定 |
|----|----------|
| `community_messages` | `doctor_id` = **主诊**（回复主体 / 归档归属）；不按协诊复制 |
| `outbound_queue` | 自动出站：`doctor_id` = 主诊；人工出站：`doctor_id` = 操作所代表医生；另可保留 `group_id` |
| `message_log` | 与入站一致，归主诊；协诊通过共享视图读取，不复制行 |
| `submissions` / 患者建档相关 | **一律** `doctor_id` = 当时主诊；协诊人工回复不改写历史提交归属 |
| `patients` | 由群消息解析出的患者默认挂主诊；已存在记录不因协诊出站改挂 |

### 4.4 医助「可关」共享可见的两层开关

1. **群级开关** `community_groups.share_visible_to_collab`（默认 `1`）  
   - =0：所有协诊 scoped 医助都看不到该群共享队列（super / 主诊医助仍可见）。
2. **医助级偏好**（可选一期最小实现）  
   - 若工期紧：一期只做群级开关；  
   - 若一并做：`admin_group_prefs(admin_id, group_id, share_visible INTEGER)`，默认跟随群级，医助可对自己关掉。

规格默认：**一期必须有群级开关；医助级偏好列为加分项，有则做、无则在实施计划注明二期。**

## 5. 核心流程

### 5.1 入站（群消息）

```text
QiWe callback
  → 解析 fromRoomId = external_group_id
  → 查 community_groups（业务群门禁，不先绑 doctor）
  → 非业务群：静默返回（保持现网）
  → 取 primary：community_group_doctors.role='primary'
       若无关联表行：回退 groups.doctor_id（兼容）
  → replyDoctorId = primary
  → group_gate / rules / triage 全部使用 replyDoctorId
  → 落 community_messages / message_log（doctor_id=primary）
  → 自动出站至多 1 条（auto_send 等现网闸门不变）
```

改造要点文件：`qiwe_bridge.js`（`activeDoctorId` 群分支）、`community.js`（`findQiweBusinessGroup`）。

### 5.2 人工出站（协诊主动回答）

```text
医助在共享队列点「回复/确认发送」
  → 鉴权：super，或 admin_doctors 覆盖主诊，
           或（share 可见开启 且 admin_doctors 覆盖某协诊 且 can_outbound=1）
  → 写入 outbound_queue（doctor_id=操作代表医生，group_id=群）
  → QiWe 发送成功后标记 sent
  → 不修改 submissions / patients.doctor_id
```

### 5.3 共享可见判定

某 scoped 医助 `A` 看群 `G`：

```text
visible =
  A.role == super
  OR A 的 admin_doctors 含 G.primary
  OR (
       G.share_visible_to_collab == 1
       AND A 的 admin_doctors 与 G 的 collaborator 有交集
       AND （若有医助级偏好：prefs.share_visible != 0）
     )
```

列表/详情/分诊共享视图均用同一函数，避免前后端不一致。

### 5.4 同步

`qiwe_sync.js`：

- `upsertGroup` 按 `external_group_id` **全局**幂等，不再 `(doctorId, roomId)` 各插一行。
- 同步出的新群：默认非业务群；创建时写入 `community_group_doctors` 一行，primary = 发起同步时的当前医生上下文（或配置默认医生），与现网「先同步再勾业务群」一致。
- 把已有群挂到协诊：只写关联表，不新建 groups 行。

### 5.5 加减协诊 / 更换主诊

| 操作 | 规则 |
|------|------|
| 添加协诊 | `INSERT` role=collaborator, auto_reply=0, can_outbound=1 |
| 移除协诊 | 删除关联；不影响历史消息；若该医助仅因该协诊可见则不再可见 |
| 更换主诊 | 事务内：旧 primary→collaborator 且 auto_reply=0；新医生→primary 且 auto_reply=1；`groups.doctor_id` 同步更新；写审计日志 |
| 禁止 | 删除唯一 primary 且不指定继任；协诊 auto_reply=1 |

## 6. API 与后台界面

### 6.1 后端 API（建议）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/community/groups/:id/doctors` | 列出主诊/协诊 |
| PUT | `/api/admin/community/groups/:id/doctors` | 全量或增量设置协作医生（含换主诊） |
| PATCH | `/api/admin/community/groups/:id` | 含 `share_visible_to_collab`、`is_business` |
| GET | `/api/admin/community/workspace` | 群/消息/出站按 §5.3 过滤 |

旧后台 `public/src/admin.js` 与 `admin-ui` 至少一侧一期可用；优先保证现网 `/admin` 社群工作台可配置，admin-ui 跟进同构字段。

### 6.2 UI 要点

群配置卡片增加：

- 主诊（单选，必填）
- 协诊（多选）
- 开关：「协诊医助可见本群消息」（绑定 `share_visible_to_collab`）
- 说明文案：「自动回复仅主诊；协诊可人工回复；患者建档/加号归属主诊」

共享队列展示主诊标签；人工回复时显示「以某某医生身份出站」以免混淆。

## 7. 迁移

1. 备份 `data.db`。
2. 建 `community_group_doctors` 与索引。
3. 对每个现有 `community_groups` 行插入 primary = 旧 `doctor_id`。
4. 合并同一 QiWe `external_group_id` 的重复行（保留业务数据更全的一条，迁移成员/消息的 `group_id`，删除冗余群行）。
5. 设置 `share_visible_to_collab=1`。
6. 读路径：有关联表用关联表，否则回退 `doctor_id`。

生产已知需合并样例：同一外部群 id `10730375163571533` 的重复行。

## 8. 错误处理

- 回调找不到群 / 非业务群：保持静默成功，不落业务表。
- 业务群无 primary：拒绝自动回复，打错误日志，后台提示「请设置主诊」；人工出站仍可按权限进行。
- 换主诊事务失败：整单回滚。
- QiWe 同步失败：不覆盖已有群成员成功态（沿用现网同步错误策略）。
- 权限不足：API 返回 403，不泄露其他医生队列。

## 9. 验证

### 9.1 自动化

- 关联表：一群一 primary；collaborator 强制 `auto_reply=0`。
- 可见性函数：主诊医助 / 协诊医助 / 关闭共享 / super 四类断言。
- 入站：自动出站 doctor_id=primary；全群不产生第二条自动出站。
- 人工出站：协诊可发；`submissions.doctor_id` 不变。
- 迁移：重复 external_group_id 合并后唯一；旧单医生群行为不变。

### 9.2 手工回归（测试业务群）

1. 吕富靖主诊 + 另一医生协诊，发 `101` → 仅主诊编号卡一条。  
2. 发常见症状 → 仅主诊链路回复。  
3. 协诊 scoped 医助登录 → 默认可见；关闭群共享开关 → 不可见。  
4. 协诊医助人工回复一条 → 群内可见；建档/加号仍挂主诊。  
5. 更换主诊 → 之后自动回复用新主诊规则。  
6. 未改挂的单医生群 → 与改前一致。

## 10. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 合并重复群丢消息 | 先备份；合并脚本打印映射表；可逆窗口内保留备份库 |
| 协诊可见扩大隐私面 | 默认开但可关；仅 scoped 覆盖到的协诊医生 |
| 文案仍写旧医生名 | 自动回复模板变量统一取当前 primary |
| 回调仍用旧 `activeDoctorId` | 群消息路径单测锁死「群 → primary」 |

回滚：关闭多医生写入入口；读路径回退仅 `groups.doctor_id`；关联表可保留不删。

## 11. 实施顺序（供后续 plan 拆解）

1. 数据表 + 迁移 + 兼容读  
2. 回调/同步「群优先」+ 防抢答  
3. 共享可见过滤 + 协诊人工出站鉴权  
4. 群配置 API/UI（主诊/协诊/共享开关）  
5. 提交归属断言（建档/加号）与回归  

预计一期约 6～10 人天（不含模式 C）。

## 12. 开放加分项（非阻塞）

- 医助级 `admin_group_prefs` 个人关闭共享可见。  
- 欢迎语末尾列出协诊专家名单（静态文案）。  
- admin-ui 与旧 `/admin` 双端同时交付（可先旧后台）。

---

**审阅结论：** 主人回复「继续」→ §1 / §4 / §5 视为一期冻结规格；实施计划见 `plans/2026-07-20-multi-doctor-group.md`。
