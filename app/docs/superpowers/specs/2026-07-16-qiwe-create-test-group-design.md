# 社群「新增测试群」真建群启用设计

日期：2026-07-16  
状态：已批准（用户选方案一，写完文档后直接实现）

## 目标

医助在社群工作台点击「+ 新增测试群」并配置后，可选择在企微侧**真实创建群聊**，把返回的 `roomId` 写回本地社群配置，并自动改名、加入 `testToId` 白名单。

## 非目标

- 不默认勾选业务群（`is_business` 仍为 0，事后手开）
- 不拉取群活码 QR
- 不改「同步企微群」既有路径
- 编辑已有群不触发建群

## 已确认决策

| 项 | 选择 |
|---|---|
| 成员来源 | 搜索系统内联系人（微信名/userId）加入已选列表；详见 [member-picker 设计](./2026-07-16-qiwe-member-picker-design.md) |
| 业务群 | 默认不勾 |
| 收尾 | `modifyRoomName` + `ensureRoomInTestToId` |
| 失败 | 真建群失败则整单失败、不落本地假群 |
| 开关 | 保留 `QIWE_CREATEROOM_EXPERIMENTAL`；测试机部署设为 `1` |

## 流程

```
打开「新增」→ 命名建议
  → 勾选「在企微创建真实群聊」（默认开）
  → 填写成员 userId（≥1）
  → 保存
       ├─ createOnQiwe=false → 仅 community.createGroup（现状 manual）
       └─ createOnQiwe=true
            → 校验 QiWe 配置 + 实验开关 + 成员非空
            → qiwe.createRoom(memberIds, {isOuterRoom:1})
            → 解析 roomId
            → qiwe.modifyRoomName(roomId, name)（失败记 warning，不回滚）
            → 落库 data_source=qiwe, channel=qiwe, external_group_id=roomId, is_business=0
            → qiwe.ensureRoomInTestToId(roomId)
            → 返回 group + qiweCreate 摘要
```

## API

`POST /api/admin/community/groups` 扩展 body：

- `createOnQiwe?: boolean`（默认 false，兼容旧客户端）
- `memberIds?: string[] | string`（createOnQiwe 时必填）

成功响应可附带：

```json
{ "ok": true, "group": {...}, "qiweCreate": { "roomId": "...", "renamed": true, "testToIdUpdated": true } }
```

## UI

`GroupEditDialog.vue` 仅新增模式：

- Switch：在企微创建真实群聊（默认 true）
- Textarea：成员 userId
- 文案提示：需托管号已登录；实验开关未开时后端报错可读
- 成功 toast：区分「已在企微建群」/「已新增本地测试配置」

## 安全

- 权限：`community.group.manage`
- `createRoom` 仍受 `QIWE_CREATEROOM_EXPERIMENTAL` + `roomWriteBlocked` 门控
- 成员列表清洗去空去重；禁止空列表
- 不在日志打印 token

## 测试

- DRY_RUN：createOnQiwe → 桩 roomId、落库、testToId 追加
- 成员为空 / 开关关 → 400、无新行
- createOnQiwe=false → 仍 manual 现状
