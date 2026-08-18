# 建群成员选择器：按微信名 / userId 搜索

日期：2026-07-16  
状态：已批准（方案 1；UI 修订为「上搜下选」；写完文档后直接实现）

## 目标

「新增测试群 · 真建群」时，医助从系统已认识的企微用户中按**微信名或 userId**搜索并加入已选列表，提交时用完整 userId 调 `createRoom`。不再依赖大段手填 textarea 作为主路径。

## 非目标

- 不同步完整企微通讯录
- 不改 createOnQiwe 编排与实验开关
- 编辑已有群不加选人器
- 不新建独立通用 ContactPicker 页面（仅嵌在 GroupEditDialog）

## 已确认决策

| 项 | 选择 |
|---|---|
| 人选池 | 患者档案（qiwe/wecom identity）∪ 社群成员，按 userId 去重 |
| 范围 | 默认当前医生，可切「全部」 |
| 交互 | 上方搜索（微信名或 userId）→ 结果添加 → 下方已选列表 |
| 兜底 | 输入完整 userId 且本地无档案时，可「按 userId 添加」 |
| 实现 | 新 contacts 接口 + 对话框内嵌选人区 |

## 接口

`GET /api/admin/community/contacts?doctorId=&scope=doctor|all`

- 权限：与社群概览同级（登录 + 医生归属 gate）；只读
- `scope=doctor`（默认）须有效 `doctorId`；`scope=all` 返回管理员可见范围内全部（gate 后按当前会话可访问的医生过滤；若现有 gate 仅校验单个 doctorId，则 `all` 时仍传当前 doctorId 作入口，服务端合并该管理员可访问医生的联系人——若无多医生 ACL 数据则退化为全库，与后台「切换医生」能力对齐时优先用 admin 可访问医生列表）

**简化落地（首版）**：`scope=doctor` 仅当前 `doctorId`；`scope=all` 查全库有企微 id 的联系人（测试机单机运维可接受）。若后续要按 admin_doctors 收紧，再加过滤。

返回：

```json
{
  "ok": true,
  "items": [
    {
      "userId": "1688...",
      "displayName": "张三",
      "source": "patient" | "member" | "both",
      "doctorId": 1
    }
  ]
}
```

合并：同 userId 优先保留更像微信名的非空 `display_name`；两边都有则 `source=both`。

## UI（GroupEditDialog，仅新建 + createOnQiwe）

1. **搜索成员**：范围切换（当前医生 / 全部）+ 输入框（微信名或 userId）
2. **匹配结果**：紧贴搜索框下方，可滚动；点行或「添加」进入已选
3. **已选成员列表**：微信名 + userId 末 4 位；可移除
4. 提交：`memberIds` = 已选完整 userId 数组；至少 1 人
5. 视觉：沿用现有 ElDialog / ElForm 密度与色板，不加卡片堆叠；结果区与已选区用轻分隔，保持简洁

## 错误与边界

- contacts 失败：toast；仍允许按 userId 添加
- 重复添加：提示已在列表
- 无匹配且非合法 userId：提示未找到
- 真建群失败：沿用现有，不落假群

## 测试

- listContacts：患者 ∪ 成员去重、scope 过滤、空名回落
- UI 契约：createGroup 仍收 memberIds 数组（既有 DRY_RUN 编排用例保留）

## 与真建群设计关系

扩展 [2026-07-16-qiwe-create-test-group-design.md](./2026-07-16-qiwe-create-test-group-design.md) 的成员录入方式；建群编排不变。
