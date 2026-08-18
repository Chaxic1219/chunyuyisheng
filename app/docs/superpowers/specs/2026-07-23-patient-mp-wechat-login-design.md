# 患者端小程序 · 微信登录与手机号档案匹配

**日期：** 2026-07-23  
**状态：** 开发中 / 骨架已落地部分；实施计划见 `docs/superpowers/plans/2026-07-23-patient-mp-wechat-login.md`  
**范围：** `patient-uniapp` + `app` 患者端 API；微信登录、绑手机、按手机号匹配/挂接档案、无档软推完善  
**非范围：** 换绑手机、跨端 SSO 门户、匿名历史消息强制回溯、跨医生病历全文自动拷贝、视觉大改  
**相关：**  
- `2026-07-23-patient-miniprogram-ia-redesign-design.md`（三 Tab / 档案入口）  
- `2026-07-20-patient-invite-link-design.md`（短信 / 已验证手机号 merge）  
- `2026-07-22-global-person-profile-design.md`（person 层）

> **与全局主档关系：** `2026-07-22` 规格写明企微 userId 为运营侧自动合并键，手机号字段可更新但不作为企微侧查找键。本规格在**小程序已验证手机号**路径上明确：用已验证手机号解析/创建共享 `person`（对齐该文档成功标准中「已验证手机号收敛」），并绑定 `openid`。实施时扩展 `person` 查找逻辑，避免与仅企微合并路径互相覆盖错人。

---

## 1. 背景与目标

当前小程序身份为本地随机 `patientKey` + 可选本地档案，无微信登录、无服务端会话。后台已有 H5 短信、邀请建档按手机号合并、`psid`、`persons`/`patients` 模型，但未接到小程序。

主人要求：微信登录小程序后绑定手机号，按手机号匹配是否做过患者档案；没有则推荐补充档案。

### 1.1 成功标准

1. 档案相关入口可完成：微信登录 → 绑手机（一键优先 / 短信回退）→ 服务端会话有效。  
2. 同一已验证手机号对应全平台同一 `person`；在当前医生下挂接或创建 `patient`。  
3. 已有完整档案：进入原目标页并轻提示已关联。  
4. 无档/不完整：推荐完善档案（软推），不硬拦咨询。  
5. 咨询在未登录时可匿名临时会话；已登录后新消息挂正式患者身份。  
6. 配置：`WECHAT_MP_APP_ID` / `WECHAT_MP_APP_SECRET` 与公众号 OA 凭证分离；开发态可强制短信。

---

## 2. 已锁定决策

| 项 | 决策 |
|----|------|
| 方案 | **方案 1 · 轻量会话**（Bearer `mp_token`，复用 person/patient） |
| 绑手机 | **C**：微信 `getPhoneNumber` 优先；未开通/失败 → 短信验证码 |
| 门槛 | **登录**在档案相关入口硬要求；**补档**软推；咨询可匿名 |
| 时机 | **C**：触发档案相关能力时再弹登录/绑手机 |
| 匹配范围 | **B**：全平台按手机号认同一 `person`，再挂当前医生 `patient` |
| 会话 | 小程序本地 `mp_token` + `Authorization: Bearer`；不依赖 Cookie |
| 历史匿名消息 | 一期**不**强制回溯合并 |

---

## 3. 触发与主流程

### 3.1 需登录的入口

- 首页「完善档案」
- 我的：患者档案填写、健康记录、查看回复
- 服务申请：加号、住院、联络表
- 邀请建档页（未登录时）

### 3.2 不强制登录

- 首页浏览、FAQ、知识文章
- 在线咨询（匿名临时 `patientKey` 可继续）

### 3.3 主流程

```text
用户点击档案相关入口
  → 无有效 mp_token？
      → wx.login → POST /api/mp/login → 临时会话
      → 未绑手机？
          → 优先 getPhoneNumber → POST /api/mp/bind-phone
          → 否则 手机号 + 短信 → 同接口（sms 分支）
  → 服务端：验手机 → person 匹配/创建 → 当前医生 patient 挂接/创建
  → GET /api/mp/me
      → hasProfile=true  → 进入原目标 + 轻提示「已关联您的档案」
      → hasProfile=false → 进入目标或档案表 + 推荐「完善患者档案」
```

Token 过期：静默 `wx.login` 刷新；若服务端仍识别该 `openid` 已绑手机，无需重绑。

---

## 4. 身份匹配与合并

### 4.1 两层模型

| 层 | 含义 |
|----|------|
| `person` | 全平台自然人；主认人键为**已验证手机号**；绑定小程序 `openid` |
| `patient` | 某医生团队下的就诊关系；咨询、档案、跟进挂此层 |

### 4.2 绑手机成功后（手机号视为已验证）

1. 按手机号查/建 `persons`，`phone_verified=1`，绑定 `openid`。  
2. 在当前 `doctorId` 下：  
   - 已有该 person / 已验证同号 `patient` → 挂接会话；  
   - 仅有未验证同号旧档 → **自动 merge**（对齐邀请链路「已验证可合」；小程序一期不弹二次确认）；  
   - 皆无 → 新建 `patient` 并关联 person（可先空档）。  
3. 跨医生：复用同一 `person`；在新医生下再挂/建 `patient`。  
4. 档案读写一期以**当前医生 patient 档案**为准；不把 A 医生病历全文拷到 B 医生。

### 4.3 `hasProfile`（当前医生）

一期判定：至少具备**姓名 + 已验证手机号**（可与现有建档问卷必填对齐，实施计划中可收紧）。  
不完整 → 软推完善，不拦咨询。

### 4.4 安全边界（一期）

- 一个 `openid` 同时只绑一个已验证手机号；**不做换绑**。  
- `mp_token` 表示：已登录 person + 当前 doctor 下的 patient。  
- 匿名咨询登录后：仅**新消息**挂正式身份。

---

## 5. API 与配置

### 5.1 新增接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/mp/login` | body: `{ code, doctorId? }` → `code2session`；返回 `{ mpToken, phoneBound, expiresIn }` |
| `POST` | `/api/mp/bind-phone` | Bearer；body: `{ phoneCode }`（微信）或 `{ phone, smsCode }`；返回会话摘要 + `hasProfile` |
| `GET` | `/api/mp/me` | Bearer；`{ phoneMasked, hasProfile, profileSummary, doctorId, patientId }` |
| `POST` | `/api/mp/logout` | 可选；作废 token |

### 5.2 复用

- `POST /api/sms/send`（短信回退）
- 现有档案/邀请表单提交成功后客户端刷新 `/api/mp/me`
- 邀请 merge 决策思路（`patient_invite.js` 已验证同号）

### 5.3 配置

| 键 | 说明 |
|----|------|
| `WECHAT_MP_APP_ID` / `WECHAT_MP_APP_SECRET` | 小程序，与 `WECHAT_OA_*` 分离 |
| 客户端 `PHONE_BIND_MODE` | `auto`（默认）/ `wechat` / `sms`（开发强制短信） |
| `manifest` / 构建 | 填入真实小程序 AppID |

微信公众平台需开通「手机号快速验证组件」；未开通时 UI 自动走短信。

---

## 6. 小程序改动清单

| 项 | 说明 |
|----|------|
| `stores/auth` + `api/auth.ts` | token 存本地；请求带 Bearer |
| `pages/auth/bind` | 微信手机号按钮 + 短信回退 |
| `ensureLogin(returnUrl)` | 档案相关入口统一门禁 |
| 首页 / 我的 | 登录后按 `hasProfile` 显示完善档案推荐条 |
| 咨询 | 未登录匿名；已登录带正式 patient 身份 |
| 本地 `patientProfile` | 逐步以 `/api/mp/me` + 服务端档案为准；过渡期可双写 |

---

## 7. 明确不做（一期）

- 换绑手机、多设备账号中心、H5/小程序 Cookie 统一门户  
- 匿名历史消息强制回溯合并  
- 跨医生病历自动拷贝  
- 冷启动全屏强制登录  

---

## 8. 验收要点

1. 未登录点「完善档案」→ 出现绑手机页 → 成功后进入档案表。  
2. 已验证手机号在后台已有该医生档案 → 进入后 `hasProfile=true`，不重复空档。  
3. 同手机号换医生（测试）→ 同一 person，新医生下有独立 patient。  
4. `PHONE_BIND_MODE=sms` 时可完整走通短信绑定。  
5. 未登录仍可打开咨询并发送消息。  
6. 契约/冒烟：新增 auth 相关 UI/路由不破坏三 Tab 契约。

---

## 9. 下一步

主人审阅本 spec 通过后 → `writing-plans` 输出实施计划（库表/`patient_identities`、路由、UniApp 门禁、测试）→ 再编码。
