# QiWe 分诊台医生归属收口设计

**日期：** 2026-07-27  
**范围：** 仅调整 QiWe 账号切换后的 AI 分诊台消息可见性与医生归属映射；不修改医生本体资料，不做历史医生搬迁。

## 背景

当前系统已支持 QiWe 账号切换，并用 `community_groups.qiwe_hidden` 隐藏当前账号未加入的旧群。但 AI 分诊台仍可能按旧 `doctor_id` 或宽松回退逻辑展示不属于当前 QiWe 账号的医生消息，造成“当前账号看到别的医生消息”的错位。

主人要求更严格的口径：

1. 分诊台只显示当前 QiWe 账号已加入且可见的企微群消息。
2. 该账号下的企微患者私聊，也必须按当前 QiWe 账号对应医生过滤。
3. 不修改任何医生本体信息，只调整 QiWe 对应群聊/消息映射。

## 目标

让 AI 分诊台中的 QiWe 消息只来自“当前 QiWe 账号有效作用域”，且**所有入档医生自动生效、无需二次绑定 `qiwe_configs.doctorId`**：

- 群消息：按页面所选医生过滤；群已同步到 `community_groups`，且 `qiwe_hidden=0`（当前账号已加入可见）。
- 私聊消息：按页面所选医生过滤即可；不要求 `message_log.doctor_id === qiwe_configs.doctorId`。

## 非目标

- 不修改 `doctors` 表内容。
- 不批量重写历史 `patients`、`patient_identities`、`message_log` 的医生归属。
- 不改变非 QiWe 渠道的分诊台逻辑。
- 不改变社群工作台中“业务群”的手工勾选语义。

## 现状判断

### 1. 分诊台查询

`routes/messages-admin.js` 当前主查询以 `message_log.doctor_id=?` 为入口，再叠加 `MSGLOG_VISIBLE_IN_TRIAGE`。  
该过滤已排除：

- QiWe 私聊空群号直接进群分诊的情况；
- 非业务群消息；
- 找不到业务群归属的群消息。

但它还没有直接使用“当前 QiWe 账号作用域”做二次约束，因此旧 `doctor_id` 或宽松 fallback 仍可能把消息带进当前分诊视图。

### 2. QiWe 医生归属

`modules/qiwe/shared.js` 中：

- `activeDoctorId(cfg)` 会在配置缺失时回退到 active 医生或首个医生；
- `resolveEventDoctorId(evt, cfg)` 群消息优先用群主诊，找不到再回退；
- 私聊天然更容易走 fallback。

这对“单账号固定单医生”的生产场景过于宽松，会让当前 QiWe 账号在分诊链路中吞入非当前医生的私聊消息。

## 方案

### A. 收紧 QiWe 当前账号医生解析

为 QiWe 分诊/归档链路增加“当前账号医生”显式解析函数，语义如下：

1. 优先取当前 QiWe 配置中的 `doctorId`。
2. 若无有效 `doctorId`，则按 fail-closed 处理：
   - 分诊相关展示与入库不再回退到“任意 active 医生”；
   - 仅在明确需要的非分诊辅助场景保留旧 fallback。

这样可以阻止 QiWe 私聊因 fallback 被错误记到其他医生名下。

### B. 收紧 AI 分诊台 QiWe 查询作用域

在 `messages-admin.js` 的分诊查询里，对 QiWe 消息追加当前账号作用域过滤：

1. **QiWe 群消息**
   - 必须能关联到 `community_groups`；
   - 该群 `data_source='qiwe'`；
   - `qiwe_hidden=0`；
   - 该群归属医生等于当前 QiWe 配置医生；
   - 若群被隐藏或不是当前医生，分诊台不显示。

2. **QiWe 私聊消息**
   - `group_id` 为空时，只允许 `message_log.doctor_id = currentQiweDoctorId`；
   - 不允许通过患者昵称或其它宽松命中把别的医生私聊串进当前视图。

3. **非 QiWe 消息**
   - 保持现状，不扩大影响面。

### C. 保持“只隐藏，不搬迁”

历史错误归属消息不做批量搬迁；本次只保证：

- 当前分诊台不再显示不属于当前 QiWe 账号医生作用域的消息；
- 新进入的 QiWe 消息按更严格规则落到正确医生作用域。

## 数据流

### 群消息

QiWe 回调 -> 解析事件医生 -> 命中当前医生的已同步且可见群 -> 写入 `message_log` -> 分诊台按当前医生 + `qiwe_hidden=0` 再过滤展示

### 私聊消息

QiWe 回调 -> 解析当前 QiWe 配置医生 -> 写入该医生名下 `message_log` / 患者解析 -> 分诊台仅显示当前 QiWe 配置医生的私聊

## 错误处理

- 若当前 QiWe 配置缺失有效 `doctorId`，QiWe 分诊相关逻辑应 fail-closed：
  - 不把消息错误归到别的 active 医生；
  - 分诊台不展示越界消息；
  - 日志打印明确原因，便于排查配置问题。
- 若群未同步或已被 `qiwe_hidden=1`，则该群消息不进入当前分诊台。

## 测试要点

1. 当前 QiWe 账号 A，配置医生 1：
   - 医生 1 的可见 QiWe 群消息出现在分诊台；
   - 被隐藏的旧群消息不出现；
   - 医生 2 的 QiWe 群消息不出现。

2. 当前 QiWe 账号 A，配置医生 1：
   - 医生 1 的 QiWe 私聊出现；
   - 医生 2 的 QiWe 私聊不出现；
   - 配置缺失时不再回退到任意 active 医生。

3. 非 QiWe 消息：
   - 原分诊台逻辑不回归。

## 受影响文件

- `app/modules/qiwe/shared.js`
- `app/modules/qiwe/callback.js`
- `app/routes/messages-admin.js`
- 可能补充到现有测试文件（优先复用 `_qiwetest.js` 或 `_unittest.js`）

## 结论

本次采用“**当前 QiWe 配置医生 + 可见 QiWe 群**”双约束，收紧分诊台与新入库消息的 QiWe 归属；不改医生本体，不搬迁历史医生资料，只修正当前账号视角下的分诊信息对应关系。
