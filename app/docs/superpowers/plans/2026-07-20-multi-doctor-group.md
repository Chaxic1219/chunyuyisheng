# 多医生同群（主诊自动回复 · 协诊共享可见）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同一企微业务群可挂 1 名主诊 + N 名协诊：自动回复仅主诊、协诊可人工出站、协诊医助默认可看共享队列（可关）、患者提交归属主诊。

**Architecture:** 新增 `community_group_doctors` 与群级 `share_visible_to_collab`；入站/同步改为「群优先 → primary」；`overview`/出站鉴权走统一 `canAdminSeeGroup`；保留 `community_groups.doctor_id` 双写主诊以兼容旧读路径。一期不做医助级 `admin_group_prefs`、不做模式 C。

**Tech Stack:** Node.js（`db.js` / `community.js` / `qiwe_bridge.js` / `qiwe_sync.js` / `server.js`）、SQLite、`admin-ui` Vue3、`_qiwe_business_test.js` / `_unittest.js`

**Spec:** `app/docs/superpowers/specs/2026-07-17-multi-doctor-group-design.md`（主人说「继续」→ 按 §1/§4/§5 冻结执行）

**一期拍板（本计划写死）：**

1. 仅群级 `share_visible_to_collab`（默认 1）；医助级偏好二期
2. 优先改 `/admin` 社群工作台（`admin-ui`）；旧 `public/src/admin.js` 可不做全量 UI，但 API 需可用
3. 生产已知重复群 `external_group_id=10730375163571533` 必须在迁移中合并
4. 修复：`findQiweBusinessGroup` 当前未 `module.exports`，`qiwe_bridge` 实际走 fallback——本计划一并导出并切到群优先实现

---

## File Map

| Path | Responsibility |
|------|----------------|
| `app/db.js` | 建表、加列、索引；启动时回填 primary；合并重复 `external_group_id` |
| `app/community_group_doctors.js` | 纯领域：resolvePrimary、canAdminSeeGroup、setGroupDoctors、listGroupDoctors、约束校验 |
| `app/community.js` | `findQiweBusinessGroup` 群优先；`archiveQiweInbound`/`overview`/`updateGroup` 接主诊与可见性；导出查找函数 |
| `app/qiwe_bridge.js` | 群消息路径 `replyDoctorId = primary`，禁止配置医生抢答 |
| `app/qiwe_sync.js` | `upsertGroup` 按 `external_group_id` 全局幂等；新建群写 primary 行 |
| `app/server.js` | `GET/PUT .../groups/:id/doctors`；PATCH 共享开关；overview/outbox 鉴权 |
| `app/_qiwe_business_test.js` | 业务群回归 + 多医生新断言 |
| `app/_unittest.js` | 可见性 / 一群一 primary 单测 |
| `admin-ui/src/api/chunyu/index.ts` | doctors API |
| `admin-ui/src/views/chunyu/community/GroupEditDialog.vue` | 主诊/协诊/共享开关 UI |
| `admin-ui/src/views/chunyu/community/index.vue` | 列表展示主诊标签（可选最小） |

---

### Task 1: Schema + 回填 primary + 单测骨架

**Files:**
- Modify: `app/db.js`
- Create: `app/community_group_doctors.js`（先空壳导出，Task 2 填满）
- Modify: `app/_unittest.js`

- [ ] **Step 1: 写失败单测**

在 `app/_unittest.js` 追加：

```js
console.log("\n== U-MDG. 多医生同群 schema / primary ==");
try {
  const cgd = require("./community_group_doctors.js");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='community_group_doctors'").get();
  ok(!!tables, "community_group_doctors 表存在");
  const cols = db.prepare("PRAGMA table_info(community_groups)").all().map(r => r.name);
  ok(cols.includes("share_visible_to_collab"), "share_visible_to_collab 列存在");
  const g = db.prepare("SELECT id, doctor_id FROM community_groups ORDER BY id LIMIT 1").get();
  if (g) {
    const p = cgd.resolvePrimaryDoctorId(g.id);
    ok(p === +g.doctor_id, "无关联表行时回退 groups.doctor_id");
  }
} catch (e) {
  ok(false, "U-MDG 加载失败: " + (e && e.message));
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-MDG|community_group_doctors"`  
Expected: 失败（表不存在或模块缺失）

- [ ] **Step 3: `db.js` 建表 / 加列 / 回填**

在现有 `ensureColumn("community_groups", ...)` 块附近追加：

```js
ensureColumn("community_groups", "share_visible_to_collab", "INTEGER DEFAULT 1");

db.exec(`CREATE TABLE IF NOT EXISTS community_group_doctors (
  group_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator',
  auto_reply INTEGER NOT NULL DEFAULT 0,
  can_outbound INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT,
  note TEXT,
  PRIMARY KEY (group_id, doctor_id),
  FOREIGN KEY (group_id) REFERENCES community_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
)`);

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cgd_one_primary
  ON community_group_doctors(group_id) WHERE role = 'primary'`);

// QiWe 真群 external_group_id 全局唯一（合并重复后再建；若建失败先跳过并打日志，见 Task 3）
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cg_qiwe_external
    ON community_groups(external_group_id)
    WHERE data_source = 'qiwe'
      AND external_group_id IS NOT NULL
      AND trim(external_group_id) != ''
      AND external_group_id NOT LIKE 'local-%'`);
} catch (e) {
  console.warn("[migrate] idx_cg_qiwe_external deferred:", e && e.message);
}

// 回填：每个群至少一行 primary = 当前 doctor_id
const groupsNeedPrimary = db.prepare(`
  SELECT g.id, g.doctor_id FROM community_groups g
  WHERE g.doctor_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM community_group_doctors d
      WHERE d.group_id = g.id AND d.role = 'primary'
    )`).all();
const insPrimary = db.prepare(`INSERT OR IGNORE INTO community_group_doctors
  (group_id, doctor_id, role, auto_reply, can_outbound, joined_at)
  VALUES (?, ?, 'primary', 1, 1, ?)`);
const nowIso = new Date().toISOString();
for (const g of groupsNeedPrimary) {
  if (!g.doctor_id) continue;
  insPrimary.run(g.id, g.doctor_id, nowIso);
}
```

- [ ] **Step 4: 创建 `app/community_group_doctors.js` 最小实现**

```js
"use strict";
const { db } = require("./db.js");

function resolvePrimaryDoctorId(groupId) {
  const gid = +groupId;
  if (!Number.isInteger(gid) || gid <= 0) return null;
  const row = db.prepare(
    `SELECT doctor_id FROM community_group_doctors WHERE group_id=? AND role='primary' LIMIT 1`
  ).get(gid);
  if (row) return +row.doctor_id;
  const g = db.prepare(`SELECT doctor_id FROM community_groups WHERE id=?`).get(gid);
  return g && g.doctor_id ? +g.doctor_id : null;
}

function listGroupDoctors(groupId) {
  return db.prepare(
    `SELECT d.group_id, d.doctor_id, d.role, d.auto_reply, d.can_outbound, d.joined_at, d.note,
            doc.name AS doctor_name
     FROM community_group_doctors d
     LEFT JOIN doctors doc ON doc.id = d.doctor_id
     WHERE d.group_id=?
     ORDER BY CASE d.role WHEN 'primary' THEN 0 ELSE 1 END, d.doctor_id`
  ).all(+groupId);
}

module.exports = {
  resolvePrimaryDoctorId,
  listGroupDoctors
  // canAdminSeeGroup / setGroupDoctors 在 Task 2 补齐
};
```

- [ ] **Step 5: 再跑单测**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-MDG"`  
Expected: U-MDG 断言通过（其它旧测保持绿）

- [ ] **Step 6: Commit**

```bash
git add app/db.js app/community_group_doctors.js app/_unittest.js
git commit -m "feat(mdg): add community_group_doctors schema and primary backfill"
```

---

### Task 2: 可见性 / 写协作医生 / 约束

**Files:**
- Modify: `app/community_group_doctors.js`
- Modify: `app/_unittest.js`

- [ ] **Step 1: 扩展失败单测**

追加到 U-MDG 块（或新建 `U-MDG-VIS`）：

```js
console.log("\n== U-MDG-VIS. 共享可见与 setGroupDoctors ==");
try {
  const cgd = require("./community_group_doctors.js");
  const docs = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 2").all();
  ok(docs.length >= 2, "至少两名医生供测");
  const d1 = docs[0].id, d2 = docs[1].id;
  const stamp = Date.now();
  const gIns = db.prepare(`INSERT INTO community_groups(
    doctor_id,channel_type,external_group_id,name,status,welcome_enabled,auto_reply_enabled,
    review_mode,created_at,updated_at,data_source,is_business,share_visible_to_collab
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    d1, "qiwe", "mdg-test-" + stamp, "MDG测群", "active", 1, 1,
    "human_review", new Date().toISOString(), new Date().toISOString(), "qiwe", 1, 1
  );
  const gid = gIns.lastInsertRowid;
  cgd.setGroupDoctors(gid, { primaryDoctorId: d1, collaboratorIds: [d2], shareVisibleToCollab: 1 });
  ok(cgd.resolvePrimaryDoctorId(gid) === d1, "主诊为 d1");
  ok(cgd.listGroupDoctors(gid).some(x => x.doctor_id === d2 && x.role === "collaborator"), "协诊写入");

  const adminCollab = db.prepare(
    `INSERT INTO admins(username,password_hash,role,active,created_at) VALUES(?,?,?,?,?)`
  ).run("mdg_collab_" + stamp, "x", "scoped", 1, new Date().toISOString()).lastInsertRowid;
  db.prepare(`INSERT INTO admin_doctors(admin_id,doctor_id) VALUES(?,?)`).run(adminCollab, d2);
  ok(cgd.canAdminSeeGroup({ adminId: adminCollab, role: "scoped", scope: new Set([d2]) }, gid) === true, "协诊医助默认可看");

  db.prepare(`UPDATE community_groups SET share_visible_to_collab=0 WHERE id=?`).run(gid);
  ok(cgd.canAdminSeeGroup({ adminId: adminCollab, role: "scoped", scope: new Set([d2]) }, gid) === false, "关闭共享后不可见");

  const adminPrimary = db.prepare(
    `INSERT INTO admins(username,password_hash,role,active,created_at) VALUES(?,?,?,?,?)`
  ).run("mdg_pri_" + stamp, "x", "scoped", 1, new Date().toISOString()).lastInsertRowid;
  db.prepare(`INSERT INTO admin_doctors(admin_id,doctor_id) VALUES(?,?)`).run(adminPrimary, d1);
  ok(cgd.canAdminSeeGroup({ adminId: adminPrimary, role: "scoped", scope: new Set([d1]) }, gid) === true, "主诊医助仍可见");

  let threw = false;
  try { cgd.setGroupDoctors(gid, { primaryDoctorId: null, collaboratorIds: [d2] }); } catch (e) { threw = true; }
  ok(threw, "禁止无主诊");
} catch (e) {
  ok(false, "U-MDG-VIS 失败: " + (e && e.message));
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-MDG-VIS|setGroupDoctors"`  
Expected: 失败

- [ ] **Step 3: 实现 `canAdminSeeGroup` / `setGroupDoctors`**

在 `community_group_doctors.js` 补全并导出。`scope === null` 表示 super（与 `server.adminScope` 一致）：

```js
function canAdminSeeGroup(admin, groupId) {
  const gid = +groupId;
  const g = db.prepare(`SELECT * FROM community_groups WHERE id=?`).get(gid);
  if (!g) return false;
  if (admin && admin.scope === null) return true;

  let covered = admin && admin.scope instanceof Set ? admin.scope : null;
  if (!covered) {
    const adminId = +(admin && admin.adminId);
    covered = new Set(
      db.prepare(`SELECT doctor_id FROM admin_doctors WHERE admin_id=?`).all(adminId).map(r => +r.doctor_id)
    );
  }
  const primaryId = resolvePrimaryDoctorId(gid);
  if (primaryId && covered.has(primaryId)) return true;
  if (+g.share_visible_to_collab === 1) {
    const collabs = db.prepare(
      `SELECT doctor_id FROM community_group_doctors WHERE group_id=? AND role='collaborator'`
    ).all(gid);
    if (collabs.some(r => covered.has(+r.doctor_id))) return true;
  }
  return false;
}

function setGroupDoctors(groupId, opts) {
  const gid = +groupId;
  const primary = +(opts && opts.primaryDoctorId);
  const collabs = [...new Set(((opts && opts.collaboratorIds) || []).map(x => +x))]
    .filter(x => Number.isInteger(x) && x > 0 && x !== primary);
  if (!Number.isInteger(primary) || primary <= 0) throw new Error("必须指定主诊");
  const g = db.prepare(`SELECT id FROM community_groups WHERE id=?`).get(gid);
  if (!g) throw new Error("群不存在");
  if (!db.prepare(`SELECT id FROM doctors WHERE id=?`).get(primary)) throw new Error("主诊医生不存在");
  for (const cid of collabs) {
    if (!db.prepare(`SELECT id FROM doctors WHERE id=?`).get(cid)) throw new Error("协诊医生不存在: " + cid);
  }
  const share = opts && opts.shareVisibleToCollab != null ? (+opts.shareVisibleToCollab ? 1 : 0) : null;
  const joined = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM community_group_doctors WHERE group_id=?`).run(gid);
    db.prepare(`INSERT INTO community_group_doctors
      (group_id,doctor_id,role,auto_reply,can_outbound,joined_at) VALUES (?,?,?,?,?,?)`)
      .run(gid, primary, "primary", 1, 1, joined);
    for (const cid of collabs) {
      db.prepare(`INSERT INTO community_group_doctors
        (group_id,doctor_id,role,auto_reply,can_outbound,joined_at) VALUES (?,?,?,?,?,?)`)
        .run(gid, cid, "collaborator", 0, 1, joined);
    }
    db.prepare(`UPDATE community_groups SET doctor_id=?, updated_at=? WHERE id=?`)
      .run(primary, joined, gid);
    if (share != null) {
      db.prepare(`UPDATE community_groups SET share_visible_to_collab=? WHERE id=?`).run(share, gid);
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) {}
    throw e;
  }
  return listGroupDoctors(gid);
}

module.exports = {
  resolvePrimaryDoctorId,
  listGroupDoctors,
  canAdminSeeGroup,
  setGroupDoctors
};
```

- [ ] **Step 4: 跑通单测**

Run: `cd app; node _unittest.js 2>&1 | Select-String "U-MDG"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/community_group_doctors.js app/_unittest.js
git commit -m "feat(mdg): group doctor visibility and setGroupDoctors"
```

---

### Task 3: 合并重复 `external_group_id`

**Files:**
- Modify: `app/db.js`（启动迁移函数 `mergeDuplicateQiweGroups`）
- Modify: `app/_qiwe_business_test.js`

- [ ] **Step 1: 写迁移断言**

在临时库插入两行同 `external_group_id='room-dup-1'`、各挂一条 `community_messages`，调用 `mergeDuplicateQiweGroups()`，断言只剩 1 行且消息 `group_id` 均指向保留行。

- [ ] **Step 2: 实现合并**

规则（规格 §7）：

1. 找出 `data_source='qiwe'` 且非 `local-%` 的重复 `external_group_id`
2. **保留行**：优先 `is_business=1`，再比成员数/消息数，再比更小 `id`
3. 丢弃行的 `community_members` / `community_messages` / `outbound_queue` 的 `group_id` 改挂保留 id（成员按 `external_user_id` 去重）
4. 合并 `community_group_doctors`（保留 primary；协诊并集）
5. `DELETE` 丢弃群行
6. `console.log` 打印映射 `{ external_group_id, keepId, dropIds }`
7. 合并后再尝试创建 `idx_cg_qiwe_external`

生产已知：`10730375163571533` → ids `4,148`。

- [ ] **Step 3: 跑测**

Run: `cd app; node _qiwe_business_test.js`  
Expected: 合并断言 PASS；原有业务群测仍绿

- [ ] **Step 4: Commit**

```bash
git add app/db.js app/_qiwe_business_test.js
git commit -m "feat(mdg): merge duplicate qiwe community_groups by external_group_id"
```

---

### Task 4: 入站群优先 + 导出 `findQiweBusinessGroup`

**Files:**
- Modify: `app/community.js`
- Modify: `app/_qiwe_business_test.js`

- [ ] **Step 1: 改写查找逻辑**

```js
function findQiweBusinessGroup(doctorId, roomId) {
  return findQiweBusinessGroupByRoom(roomId, { hintDoctorId: doctorId });
}

function findQiweBusinessGroupByRoom(roomId, opts) {
  const rid = cleanText(roomId, 120);
  if (!rid) return { accepted: false, reason: "invalid_event" };
  const group = db.prepare(`SELECT * FROM community_groups WHERE external_group_id=?
    ORDER BY CASE WHEN data_source='qiwe' THEN 0 ELSE 1 END, is_business DESC, id LIMIT 1`).get(rid);
  if (!group) return { accepted: false, reason: "non_business_group" };
  const cgd = require("./community_group_doctors.js");
  const primaryId = cgd.resolvePrimaryDoctorId(group.id) || group.doctor_id;
  if (group.is_business) {
    return { accepted: true, group, primaryDoctorId: +primaryId };
  }
  const bizCount = db.prepare(
    `SELECT COUNT(*) c FROM community_groups WHERE is_business=1 AND (
       id IN (SELECT group_id FROM community_group_doctors WHERE doctor_id=?)
       OR doctor_id=?
     )`
  ).get(+primaryId, +primaryId).c;
  if (bizCount === 0 && !isPlaceholderGroupId(group.external_group_id)) {
    return { accepted: true, group, primaryDoctorId: +primaryId, legacyOpen: true };
  }
  return { accepted: false, reason: "non_business_group", group, primaryDoctorId: +primaryId };
}
```

- [ ] **Step 2: `archiveQiweInbound` 使用 primary**

找到群后将落库用的 `did` 覆盖为 `hit.primaryDoctorId`。若缺失：`accepted:false, reason:"missing_primary"`。

- [ ] **Step 3: `module.exports` 增加 `findQiweBusinessGroup`、`findQiweBusinessGroupByRoom`**

- [ ] **Step 4: 测试**

两名医生、同一 room 只挂主诊关联；用协诊 `doctorId` 调 `archiveQiweInbound` 仍 accepted，且消息 `doctor_id===主诊`。

Run: `cd app; node _qiwe_business_test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/community.js app/_qiwe_business_test.js
git commit -m "feat(mdg): group-first findQiweBusinessGroup and archive as primary"
```

---

### Task 5: `qiwe_bridge` 群消息 replyDoctorId = primary

**Files:**
- Modify: `app/qiwe_bridge.js`

- [ ] **Step 1: 群消息入口改写**

在调用 `activeDoctorId(cfg)` 且处理群消息的路径（约 `fromRoomId` / 自动回复段）：

```js
let doctorId = activeDoctorId(cfg);
if (evt.isGroup || evt.fromRoomId) {
  const hit = community.findQiweBusinessGroupByRoom
    ? community.findQiweBusinessGroupByRoom(evt.fromRoomId)
    : community.findQiweBusinessGroup(doctorId, evt.fromRoomId);
  if (!hit || !hit.accepted) {
    return { ok: true, skipped: "non_business_group", roomId: evt.fromRoomId };
  }
  doctorId = hit.primaryDoctorId;
  if (!doctorId) {
    console.error("[qiwe] business group missing primary", hit.group && hit.group.id);
    return { ok: true, skipped: "missing_primary", roomId: evt.fromRoomId };
  }
}
```

确保 `group_gate` / rules / triage / 自动出站均用该 `doctorId`；全群自动出站仍至多 1 条。

- [ ] **Step 2: dry-run 断言**

配置 `cfg.doctorId=协诊`，群 primary=主诊，发 `101`，出站/`message_log.doctor_id` 为主诊。

- [ ] **Step 3: Commit**

```bash
git add app/qiwe_bridge.js
git commit -m "feat(mdg): qiwe group replies use primary doctor only"
```

---

### Task 6: `qiwe_sync.upsertGroup` 全局幂等

**Files:**
- Modify: `app/qiwe_sync.js`
- Modify: `app/_qiwe_business_test.js`

- [ ] **Step 1: 改写 `upsertGroup`**

按 `external_group_id` 全局查找；存在则 UPDATE（不改 `is_business`、不改已有 primary）；不存在则 INSERT（`doctor_id=同步上下文`，`is_business=0`）并用 `setGroupDoctors` 写 primary。**不**因二次同步自动把另一医生加成协诊（协诊只走管理 API）。

- [ ] **Step 2: 测试**

同一 `roomId` 分别以 doctorA / doctorB 同步两次 → 仅 1 行群；primary 仍为首次同步医生。

- [ ] **Step 3: Commit**

```bash
git add app/qiwe_sync.js app/_qiwe_business_test.js
git commit -m "feat(mdg): upsertGroup global by external_group_id"
```

---

### Task 7: overview 可见性过滤 + 出站鉴权

**Files:**
- Modify: `app/community.js`（`overview`）
- Modify: `app/server.js`
- Modify: `app/_unittest.js`

- [ ] **Step 1: `overview(doctorId, adminCtx)`**

有 `adminCtx` 时：`groups`/`messages`/`outbox` 按 `canAdminSeeGroup` 过滤；无 `adminCtx` 时保持现网「仅该医生」行为。

- [ ] **Step 2: GET `/api/admin/community` 传入**

```js
const adminCtx = { adminId: s.adminId, scope: adminScope(s) };
json(res, 200, community.overview(+q.doctorId, adminCtx));
```

- [ ] **Step 3: 出站 send 鉴权**

有 `group_id`：`canAdminSeeGroup`；操作代表医生须为 primary，或（协诊且 `can_outbound=1` 且 admin 覆盖该协诊）。发送成功后不改 `submissions` / `patients.doctor_id`。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(mdg): filter community overview and authorize collab outbound"
```

---

### Task 8: 管理 API（群医生 + 共享开关）

**Files:**
- Modify: `app/server.js`
- Modify: `app/community.js`（`updateGroup` 支持 `shareVisibleToCollab`）
- Modify: `admin-ui/src/api/chunyu/index.ts`

- [ ] **Step 1: 路由**

- `GET /api/admin/community/groups/:id/doctors` — 需 `canAdminSeeGroup`
- `PUT /api/admin/community/groups/:id/doctors` — 仅 super 或覆盖主诊的 scoped；body: `{ primaryDoctorId, collaboratorIds, shareVisibleToCollab }`
- 现有 `PUT .../groups/:id` 增加 `shareVisibleToCollab`

- [ ] **Step 2: admin-ui API**

```ts
export function chunyuCommunityGroupDoctors(groupId: number) {
  return cyGet(`/api/admin/community/groups/${groupId}/doctors`)
}
export function chunyuCommunitySetGroupDoctors(groupId: number, body: {
  primaryDoctorId: number
  collaboratorIds: number[]
  shareVisibleToCollab?: boolean
}) {
  return cyPut(`/api/admin/community/groups/${groupId}/doctors`, body)
}
```

- [ ] **Step 3: 本地 curl 冒烟后 Commit**

```bash
git commit -m "feat(mdg): admin APIs for group doctors and share visibility"
```

---

### Task 9: admin-ui 群配置 UI

**Files:**
- Modify: `admin-ui/src/views/chunyu/community/GroupEditDialog.vue`
- Modify: `admin-ui/src/views/chunyu/community/index.vue`（列表主诊标签，最小）

- [ ] **Step 1: 编辑态加载 `chunyuCommunityGroupDoctors`**

- [ ] **Step 2: 表单**

- 主诊单选、协诊多选、开关「协诊医助可见本群消息」
- 说明文案：自动回复仅主诊；协诊可人工回复；患者建档/加号归属主诊
- 保存：`updateGroup` + `chunyuCommunitySetGroupDoctors`

- [ ] **Step 3: 构建**

Run: `cd admin-ui; pnpm run build`  
Expected: 写入 `app/public/admin-v2/`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(mdg): group edit UI for primary/collaborators/share toggle"
```

---

### Task 10: 提交归属断言 + 全量回归 + 规格收尾

**Files:**
- Modify: `app/_qiwe_business_test.js` / `_unittest.js`
- Modify: `app/docs/superpowers/specs/2026-07-17-multi-doctor-group-design.md`

- [ ] **Step 1: 断言入站 `doctor_id === primaryId`**

- [ ] **Step 2: 回归**

```bash
cd app
node _unittest.js
node _qiwe_business_test.js
npm run test:unit
```

Expected: 全绿

- [ ] **Step 3: 规格状态改为「已实现」**（全部任务完成后）

- [ ] **Step 4: Commit**

```bash
git commit -m "test(mdg): ownership assertions and mark spec implemented"
```

---

## 手工回归清单（测服业务群）

1. 吕富靖主诊 + 另一医生协诊；发 `101` → 仅主诊编号卡一条  
2. 发常见症状 → 仅主诊链路回复  
3. 协诊 scoped 医助登录 → 默认可见；关共享开关 → 不可见  
4. 协诊医助人工回复 → 群内可见；建档/加号仍挂主诊  
5. 更换主诊 → 之后自动回复用新主诊规则  
6. 未改挂的单医生群 → 与改前一致  
7. 合并后 `10730375163571533` 仅一行  

部署前备份 `/var/lib/chunyu-doctor/data.db`；保留合并映射日志。

---

## Spec coverage（自检）

| 规格节 | 任务 |
|--------|------|
| §4.1 `community_group_doctors` | Task 1–2 |
| §4.2 共享开关 + 全局唯一索引 | Task 1、3 |
| §4.3 消息/出站/提交归属 | Task 4–5、7、10 |
| §5.1 入站主诊 | Task 4–5 |
| §5.2 协诊人工出站 | Task 7 |
| §5.3 可见性 | Task 2、7 |
| §5.4 同步 | Task 6 |
| §5.5 加减协诊/换主诊 | Task 2、8–9 |
| §6 API/UI | Task 8–9 |
| §7 迁移 | Task 1、3 |
| §12 医助级 prefs | **明确不做（二期）** |
| 导出 `findQiweBusinessGroup` 缺口 | Task 4 |

---

## 回滚

1. 关闭 UI/API 写入协作医生  
2. 读路径回退 `groups.doctor_id`（`resolvePrimaryDoctorId` 已支持）  
3. 合并出错则从备份库恢复  
