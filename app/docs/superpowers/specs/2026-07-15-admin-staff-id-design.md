# 管理员工号 staff_id 设计

## 目标

每位后台账号同时具备：

- **账户号 `username`**：登录用，人工填写，允许字母/数字/下划线；创建时必填。
- **工号 `staff_id`**：纯数字 8 位，创建时自动生成；前 3 位标识身份层级（类比身份证前三位管地区）。

已有账号：**只补发 `staff_id`**，不改登录账户号、密码与会话。

内部主键 `admins.id`（自增整数）保持不变，继续用于外键、审计与会话关联。

## 决策摘要

| 项 | 决定 |
|---|---|
| 存储 | 新列 `admins.staff_id TEXT UNIQUE` |
| 登录 | 仍用 `username`，不用 `staff_id` 登录 |
| 创建 | `username` 必填；去掉空用户名自动分配数字账号 |
| 已有数据 | 启动时按当前 `role` 补发缺失的 `staff_id` |
| 角色变更 | **不重发工号** |
| UI | 列表增加「工号」；新建只读提示「保存后生成」；编辑不可改工号 |

## 编号规则

格式：`PPPSSSSS`（共 8 位字符串，前导零保留）。

| 前缀 PPP | 角色 `role` |
|----------|-------------|
| 101 | `super` |
| 201 | `ops_manager` |
| 301 | `assistant` |
| 401 | `viewer` |
| 309 | `scoped`（历史兼容） |

- 后 5 位 `SSSSS`：同前缀内从 `00001` 起，取该前缀已有最大序号 +1。
- 分配须唯一；冲突时递增重试。
- 未知角色：按 `assistant`（301）分配，并打审计/日志，避免卡死创建。

## 数据与迁移

1. `ensureColumn("admins", "staff_id", "TEXT")`（或等价迁移）。
2. 唯一索引：`CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_staff_id ON admins(staff_id) WHERE staff_id IS NOT NULL`（或全局 UNIQUE；补发完成后不应长期为 NULL）。
3. 启动补发（幂等）：
   - `SELECT id, role FROM admins WHERE staff_id IS NULL OR trim(staff_id)='' ORDER BY id`
   - 按上表前缀调用 `allocateStaffId(role)` 写回。
4. **不**改写远程/本地 `username`；**不**用本地脏库覆盖生产 `data.db`。

## API / 后端行为

- `adminOut` / 列表查询：增加 `staffId`（来自 `staff_id`）。
- `POST /api/admin/admins`：
  - `username` 为空 → `400`（不再调用 `allocateNumericUsername`）。
  - 校验仍为 `^[A-Za-z0-9_]{3,32}$`。
  - 插入前按 `role` 分配 `staff_id` 一并写入。
- `PUT /api/admin/admins/:id`：忽略客户端传入的 `staffId`/`staff_id`；角色变更不改工号。
- 登录、改密、鉴权：逻辑不变，仍按 `username`。

可删除或停用 `allocateNumericUsername`（若无其它引用）。

## 前端（admin-ui + 旧版视需要）

- 账号列表：列「工号」展示 `staffId`。
- 新建：账户号必填；工号展示只读占位文案。
- 编辑：工号只读；账户号保持不可改（与现状一致）。
- 创建成功提示可附带生成的工号。

旧版 `admin-legacy`：至少保证创建走同一 API（必填 username）；列表展示工号为加分项，本迭代以新版为准若工期紧可只改新版。

## 非目标

- 不把 `staff_id` 改成 SQLite 主键。
- 不用工号登录（本迭代）。
- 不强制改已有 `username`。
- 角色变更不重编号。

## 验证

- 本地：为空/非法 username 创建失败；合法创建后返回 8 位且前缀与角色匹配。
- 补发：已有账号启动后均有 `staff_id`，`username` 未变。
- 同角色连续创建：后 5 位递增、不冲突。
- 改角色后工号不变。
- 现有相关 smoke / `_fulltest` 中依赖「空 username 自动分配」的用例改为显式传 username。
- 语法检查与相关 API 手工点验。

## 部署注意

- 代码部署到测试机后依赖启动迁移补发；**禁止**用本地 `data.db` 覆盖服务器库。
