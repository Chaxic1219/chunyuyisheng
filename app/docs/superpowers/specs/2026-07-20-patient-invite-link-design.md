# 患者建档邀请链接（通用 + 企微加强）设计

**日期：** 2026-07-20  
**状态：** 已通过（2026-07-20）  
**目标工程：** `app/`（邀请令牌 / 提交 / 会话绑定）、`admin-ui/`（复制链接）、患者 H5（落地页）  
**产品原则：** 可分享问卷链接完成建档 → 写入对应医生患者档案 → 同会话后续提问归同一 `patient_id`；提交成功只提示，不跳转咨询。

## 1. 已确认决策

1. **分发场景 C**：通用链接必做（短信/微信/海报）；企微打开时若可识别身份则加强绑定。
2. **方案**：邀请令牌短链 `/i/{token}`（非仅复制现有深链）。
3. **入口 C**：患者档案页 + 医生/运营相关页均可「复制建档链接」。
4. **提交成功后**：仅成功提示，**不**跳转在线咨询。
5. **表单形态**：问卷式一页填写（字段仍对齐医患通 11 项，交互偏问卷而非「短信三步建档」）。
6. 手机号策略 B（折中）+ **同号未验证确认并档**：
   - 邀请链接提交：**只校验手机号格式**（`^1[3-9]\d{9}$`），**不发、不验短信验证码**。
   - 若该医生下已存在 **同一手机且 `phone_verified=1`** 的档案 → **自动并入**该 `patient_id`（更新资料）。
   - 若仅有 **未验证同号** → 返回 `needsMergeConfirm`，前端确认「并入 / 新建」后再提交。
   - 无同号 → 新建 `phone_verified=0`。
   - **不**在未确认时用未验证手机号自动串档。
7. **后续归档**：建档成功签发患者会话凭证 `psid`；同浏览器/会话内咨询挂同一 `patient_id`。换设备主要靠已验证手机或企微身份，否则可能另档（医助可后台合并）。
8. **现网联络表** `/?p=contact-form`：**仍可保留短信验证**（强绑定入口）；与邀请问卷路径分流，互不强制改成无验证码。
9. **企微与手机号（明确边界）**：
   - **不能**指望系统从企微/QiWe **静默拉取用户真实微信绑定手机号** 来替代填写或短信验证——官方客户详情接口**不返回**客户本人手机；`remark_mobiles` 仅为成员**备注**手机，且第三方/代开发常不可读，不可作为 `phone_verified=1`。
   - 企微加强的正确主轴是 **`external_userid`（+ 可选 unionid）身份收敛**，不是自动取号。
   - 若日后自建应用能读到备注手机：仅作预填/展示或 `phone_verified=0` 写入，**绝不**当可信来路并档。

## 2. 目标与成功标准

### 2.1 目标

- 医助一键生成可对外分享的问卷建档链接。
- 患者填完后进入该医生名下患者档案（新号新建 / 已验证旧号并档）。
- 同一会话内后续提问写入同一患者。

### 2.2 成功标准

1. 两处入口均可复制 `https://{host}/i/{token}`。
2. 打开链接为问卷式建档页：**无验证码输入框、无「获取验证码」**；手机号仅格式校验。
3. 提交成功 → 档案列表可见；成功页不跳咨询。
4. 已验证同号 → 不新增重复主档；新号 → 一条 `phone_verified=0` 档案。
5. 持 `psid` 的后续消息带同一 `patient_id`。
6. 令牌可过期/作废；旧深链联络表（可含短信）仍可用。

### 2.3 一期不做

- 邀请问卷强制短信验证。
- 未验证手机号之间的自动合并。
- 一人一终身永久码、复杂邀请看板。
- 强制跳转咨询。

## 3. 用户流程

```
医助「复制建档链接」→ https://host/i/TOKEN

患者打开
    → 问卷页（11 项，无验证码）
    → 手机号格式校验 + 同意勾选（建议保留）
    → POST /api/invite/:token/submit（或带 inviteToken 的专用提交）

服务端
    → 校验 token / doctorId
    → 格式合法手机号
    → 查 patients：同 doctor + phone + phone_verified=1？
         是 → pid = 该档案；更新姓名等资料 / profile / 凭证
         否 → resolvePatient(channel=invite, externalId=invite:{token}:{随机或手机哈希}, phone, phoneVerified=false)
              或显式 INSERT 未验证档并挂 identity
    → Set-Cookie psid
    → 成功页（不跳咨询）
```

企微加强：若能带 `external_userid`，写入 `patient_identities`，与上述 pid 关联（见 §4.1）。

## 4. 身份与合并（B 细则）

| 情况 | 行为 |
|------|------|
| 手机号格式非法 | 400，不建档 |
| 同医生下存在已验证同号 | 并入该档，可更新 profile；**不**因本次问卷把未验证逻辑搞乱；保持 `phone_verified=1` |
| 仅存在未验证同号 / 无同号 | **新建**未验证档（或挂到本次 invite 会话身份）；**不**与其它未验证同号自动合并 |
| 仅有企微身份、无验证手机 | 按企微 ID 归档；问卷手机写入该档但 `phone_verified` 仍 0，直至另行短信验证 |
| 仅未验证同号（未确认） | 返回 `needsMergeConfirm` + 脱敏候选；**不**自动新建也不自动合并 |
| 用户确认并入 | `confirmMergePatientId` → 并入该未验证档 |
| 用户选择新建 | `forceCreate:true` → 新建未验证档 |

说明：并入「已验证档」时，视为患者自报更新资料；不要求本次短信。未验证同号经**显式确认**后可并，兼顾防撞号与易用性。

### 4.1 企微能否自动取号并自主合并？

| 能力 | 能否 | 说明 |
|------|------|------|
| 静默拿到微信/用户真实手机号 | **否** | 客户详情无本人手机字段；家校「手机号→external_userid」不适用于普通医患客户 |
| 读取成员备注手机 `remark_mobiles` | 视权限 | 自建+客户联系权限或可得；**备注≠验证**，现网按不可信来路处理 |
| 用 `external_userid` 跨会话归同一档 | **是（推荐）** | 与现 `resolvePatient(channel=qiwe/wecom)` 一致；邀请落地能识别企微身份时挂同一 identity |
| 用企微手机替代短信做强并档 | **否** | 与 `phoneVerified` 红线冲突 |

**结论：** 自主合并靠「已验证手机（策略 B）+ 企微 external_id + psid」，**不**靠企微自动取号。

## 5. 数据模型

### 5.1 `patient_invite_links`

```sql
CREATE TABLE IF NOT EXISTS patient_invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  note TEXT,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT,
  last_used_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  -- 问卷模式：invite 路径固定 require_sms=0（一期写死）；预留列便于日后开关
  require_sms INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);
```

### 5.2 `patient_sessions`

Cookie `psid` → `patient_sessions(token, doctor_id, patient_id, expires_at, ...)`，TTL 建议 90 天。

## 6. API

### 6.1 管理端

- `POST/GET /api/admin/doctors/:id/invite-link`：生成/复用/轮换；返回完整 `url`。

### 6.2 患者端

- `GET /api/invite/:token`：医生公开信息 + **问卷字段 schema**（无 sms 相关 UI 标志：`requireSms:false`）。
- `POST /api/invite/:token/submit`：问卷提交专用（推荐与联络表 `/api/submit` 分流，避免误触发短信校验）。
  - 校验：token 有效、doctor 一致、手机格式、同意、11 项业务校验（凭证等按现档案规格）。
  - **禁止**调用 `verifySms`。
  - 按 §4 并档或新建；写 profile；`Set-Cookie: psid`。

### 6.3 咨询

- 有有效 `psid` → 消息绑定该 `patient_id`。
- 无 psid → 现网行为。

## 7. 前端

### 7.1 admin-ui

- 患者档案 + 医生/运营页：「复制建档链接」。

### 7.2 患者 H5 `/i/:token`

- 问卷布局（可一页滚动）；**无验证码区**。
- 成功态文案；禁止跳转咨询。
- 与 `openContact`（短信版）代码路径分离，避免混用。

## 8. 安全与合规

1. token 不可预测；invite ↔ doctorId 交叉校验。
2. 无验证码 → 手机号不可作为强身份；合并仅限「已验证同号」。
3. 仍建议「敏感信息处理」勾选（PIPL）；与是否短信解耦。
4. 提交限流（IP）；防止批量灌库。
5. psid 绑定 doctor_id，防跨医生冒用。
6. 门诊凭证等上传限制与现网一致。

## 9. 与现网关系

| 能力 | 关系 |
|------|------|
| 11 项档案字段 | 复用 |
| `/?p=contact-form` + 短信 | **保留**强绑定入口 |
| `/i/{token}` 问卷 | **无短信**；策略 B |
| `resolvePatient` 红线 | 邀请提交不得对未验证号做宽合并；已验证同号并档为明确特例 |

## 10. 实施分期与拍板

| 阶段 | 内容 |
|------|------|
| P0 | 表 + 复制链接 + 问卷页无验证码提交 + B 并档逻辑 + psid |
| P1 | 两处入口、过期/轮换、次数 |
| P2 | 企微带 external_id、统计 |

**已写死：**

1. 默认复用有效 token；可「重新生成」。
2. 默认不过期。
3. 邀请路径 `require_sms=0`；联络表短信路径不变。
4. 优先 H5 + server。

---

**规格自检：** 决策 B、问卷无验证码、已验证同号并档、未验证不串档、成功不跳咨询、入口 C 均已写明。
