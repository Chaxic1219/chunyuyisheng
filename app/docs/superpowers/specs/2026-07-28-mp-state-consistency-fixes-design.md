# 小程序状态一致性修复设计

日期：2026-07-28  
范围：`patient-uniapp` 登录回跳、本地缓存、咨询会话、首页待跟进状态  
状态：待审阅

## 目标

修复小程序端 4 类高优先级一致性问题：

1. 邀请建档未绑手机号时，登录回跳丢失 token 参数  
2. 本地缓存未按当前会话隔离，导致头像/档案/聊天记录可能串号  
3. AI 咨询历史与 `sessionId` 未按当前身份隔离，可能带入旧上下文  
4. 首页把“待跟进加载失败”和“确实无待办”混成同一空态

## 非目标

- 不新增页面
- 不改 Tab 结构
- 不重做整套登录流程
- 不在本轮做低优先级视觉微调

## 设计

### 1. 登录回跳保留完整参数

- `ensureLogin(returnUrl)` 继续接收字符串，但调用方必须传入完整带参 URL
- `invite/form` 进入绑手机号时，回跳地址改为 `/pages/invite/form?t=<token>`
- `bind` 页保持现有 `returnUrl` 解码逻辑，继续按原 URL `redirectTo`

### 2. 本地缓存按当前会话命名空间隔离

以下缓存不再使用全局固定 key，而是改为“前缀 + 当前身份”：

- 患者档案本地缓存
- 我的页头像缓存
- AI 聊天历史
- AI `sessionId`

命名空间优先级：

1. `auth.patientId`
2. `auth.personId`
3. `mpToken` 的截断值
4. `doctorId`

目标是保证同设备切号、silent login 重建会话、切医生后，不再读到上一位患者的数据。

### 3. 咨询会话隔离与自动旋转

- `mpAiSession` 工具层改为按命名空间存储 `history` 与 `sessionId`
- `consult` 页进入时若检测到身份 key 变化，自动清理当前桶并生成新 `sessionId`
- 历史恢复前校验关联身份；不匹配则丢弃并回到欢迎语

### 4. 首页待跟进改为三态

`getFollowupSummary()` 返回：

- `success`：有正常结果
- `empty`：无待跟进
- `error`：接口失败

首页状态卡据此显示：

- `success + count > 0`：展示待跟进摘要
- `empty`：展示“暂无待跟进事项”
- `error`：展示“待跟进加载失败，点击重试”

## 实现边界

- 主要修改：
  - `patient-uniapp/src/utils/ensureLogin.ts`
  - `patient-uniapp/src/pages/invite/form.vue`
  - `patient-uniapp/src/pages/auth/bind.vue`
  - `patient-uniapp/src/utils/mpAiSession.ts`
  - `patient-uniapp/src/pages/consult/index.vue`
  - `patient-uniapp/src/api/patient.ts`
  - `patient-uniapp/src/pages/index/index.vue`
  - `patient-uniapp/src/pages/mine/index.vue`
  - `patient-uniapp/src/stores/auth.ts`

## 验收

1. 从带 token 的邀请建档页去绑手机号，绑定后能回到原邀请问卷  
2. 切换账号/医生后，不再读到上一位患者的头像、姓名、聊天记录  
3. AI 咨询清空或切换身份后，新的问题不会带上旧历史  
4. 首页待跟进接口失败时，不再显示“暂无待跟进事项”  
