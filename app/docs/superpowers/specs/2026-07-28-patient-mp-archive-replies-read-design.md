# 患者端小程序 · 查看回复真读 + 档案真读收口

**日期：** 2026-07-28  
**状态：** 已实施（计划见 `docs/superpowers/plans/2026-07-28-patient-mp-archive-replies-read.md`）  
**范围：** `patient-uniapp` + `app` 患者可读 API；对齐「查看回复闭环」与「服务端档案为准」  
**非范围：** 健康记录真读、扩 `/api/mp/me` 塞完整 11 项、放开 admin 档案接口、换绑手机、QiWe 分诊台、视觉大改  
**前序：**  
- `2026-07-23-patient-mp-wechat-login-design.md`（登录 / `me` / 软推）  
- `2026-07-23-patient-miniprogram-ia-redesign-design.md`（待跟进 → 查看回复）  
- `2026-07-20-patient-profile-extensible-design.md`（11 项写路径；读规格原偏管理端）

---

## 1. 背景与目标

登录、绑手机、`hasProfile` 软推、建档写库（`/api/submit` / invite）已打通。断点在读侧：

1. **查看回复**：后端 `POST /api/replies/mine` 与 H5 已真读；小程序传假 `doctorId:"x"` / `code:"000000"`，期望 `{items}` 与服务端 `{replies,followups}` 错位，且未用 mp 会话免短信。  
2. **档案真读**：无患者侧读 API；`getMyArchive` 为 mock + 本地 `patientProfile`；首页/`我的` 两套口径（本地 vs `auth.hasProfile`）。  
3. **首页待跟进**：`getFollowupSummary` 用本地档硬编码假数。

主人确认采用 **方案 B：回复闭环 + 档案真读**（健康记录留二期）。

### 1.1 成功标准

1. 已绑手机的小程序会话可一键拉取本人在当前医生下的 submissions 回复与 followups，无需再输手机号/短信。  
2. H5 原「手机号 + 短信」路径行为不变。  
3. 首页「待跟进」条数/最近标题来自同一真数据源，与回复列表一致。  
4. 新增患者侧档案读 API；清本地 storage 后重新登录，仍能看到服务端已建档内容（身份证脱敏）。  
5. `mine` / 首页建档态以 `me.hasProfile` + 真读结果为准，本地 profile 仅作写成功后的缓存，不再是唯一真相。  
6. 不改健康记录页（仍可 mock，二期另开）。

---

## 2. 已锁定决策

| 项 | 决策 |
|----|------|
| 范围 | **B**：回复真读对齐 + 档案患者读；健康记录不做 |
| 回复接口 | **增强现有** `POST /api/replies/mine`，不新建平行路径 |
| 免短信 | 与 `/api/submit` 同款：`Authorization: Bearer` + 已绑号 → 用会话 `persons.phone`；`doctorId` 必须与会话一致 |
| 档案读路径 | 新建 `GET /api/mp/archive`（挂在 mp 会话下，语义清晰） |
| `me` 形态 | **保持轻量**（`hasProfile` + `profileSummary.name`）；完整字段走 archive |
| 本地 profile | 提交成功后仍可写缓存；展示优先级：真读 > 本地 > 空态 |
| Admin 路由 | **禁止**直接给小程序调；只复用 `profileStore` / 脱敏工具 |

---

## 3. 数据流

### 3.1 查看回复（已登录）

```text
进入「查看回复」或首页待跟进
  → ensureLogin（已有）
  → POST /api/replies/mine
       Authorization: Bearer <mpToken>
       body: { doctorId: bootstrap.doctor.id }
  → 服务端：requireSession → phone_bound → doctorId 匹配
       → phone = persons.phone（忽略客户端乱传 phone/code）
       → 现有 submissions 扫描 + followup.mine
  → 前端映射 replies/followups → 列表项
  → 首页摘要：pendingCount / latestTitle 同源聚合
```

### 3.2 查看回复（H5 / 未绑号兼容）

保持现状：`phone` + `code` + `verifySms`；不要求 Bearer。

### 3.3 档案真读

```text
绑定成功 / 完善档案成功 / 进入「我的」或档案相关展示
  → GET /api/mp/archive
       Authorization: Bearer <mpToken>
  → 服务端：会话 patientId/personId + doctorId
       → 读 person 核心列 + profileStore 扩展字段
       → 身份证 mask；手机号 mask
  → 前端 getMyArchive 消费；失败时可短暂回退本地缓存并 toast
```

---

## 4. API 契约

### 4.1 `POST /api/replies/mine`（增强）

**鉴权（二选一，优先会话）：**

1. Bearer 有效且 `phone_bound`：  
   - 请求体 `doctorId` 必填；`sess.doctor_id` 必须存在且与 `body.doctorId` 一致，否则 403。  
   - `phone` 取自 `persons.phone`；不校验 `code`。  
   - 客户端传错 phone/code **忽略**，不得用客户端 phone 覆盖会话手机。  
2. 否则：沿用现逻辑（合法 phone + 短信）。

**响应（不变形状，小程序对齐消费）：**

```json
{
  "ok": true,
  "replies": [
    { "id": 1, "type": "门诊加号", "status": "助理处理中", "at": "...", "summary": ["..."] }
  ],
  "followups": [ /* followup.mine 原形状 */ ]
}
```

**错误：**

- 无会话且短信失败：400（现有）  
- Bearer 未绑号：401/400，文案引导绑手机  
- `doctorId` 与会话不一致：403  

### 4.2 `GET /api/mp/archive`（新增）

**鉴权：** `Authorization: Bearer`；必须 `phone_bound`；必须有当前医生下的 `patient_id`（无 patient 时 `hasProfile` 语义为空档）。

**响应（患者可见精简版，对齐管理端字段子集）：**

```json
{
  "ok": true,
  "hasProfile": true,
  "patient": {
    "id": 123,
    "name": "张三",
    "gender": "女",
    "birthDate": "1990-01-01",
    "phoneMasked": "138****0000"
  },
  "profile": {
    "idNumberMasked": "**************1234",
    "disease": "...",
    "pregnancyStatus": "...",
    "foodContactAllergies": { "values": [], "other": "" },
    "drugAllergies": { "values": [], "other": "" },
    "diseaseHistory": { "values": [], "other": "" }
  }
}
```

说明：

- 姓名：返回本人全名（与 `/api/mp/me` 的 `profileSummary.name` 一致）；**手机号、身份证必须脱敏**（复用现有 mask 工具）。  
- 无档：`ok:true, hasProfile:false, patient/profile` 空或省略。  
- 不返回 `fieldMeta`、`extension`、`adminOnlyFields`。

### 4.3 首页待跟进（不强制新接口）

一期：`getFollowupSummary` 复用 `getRepliesMine` 结果客户端聚合：

- `pendingCount`：`replies` 中状态非终态条数 + 未完成 `followups`（终态集合实施时与后台 status 枚举对齐，缺省：含「已完成」「已取消」「已关闭」视为终态）。  
- `latestTitle`：按时间最近一条的 `type` + `status`。  

若未登录/未绑号：摘要为 0，不请求。

---

## 5. 前端改动要点

| 位置 | 改动 |
|------|------|
| `api/patient.ts` `getRepliesMine` | 传真 `doctorId`；带 Bearer；映射 `replies`→列表；可选合并 followups |
| `api/patient.ts` `getFollowupSummary` | 调真 replies；去掉本地假数 |
| `api/patient.ts` `getMyArchive` | 调 `GET /api/mp/archive`；映射为现有 `PatientArchive` / 展示结构 |
| `pages/replies/index.vue` | 已登录：免输手机、进入即拉；去掉「任意号查 mock」文案 |
| `pages/index/index.vue` | 建档态 / 待跟进：优先 `auth.hasProfile` + 真摘要 |
| `pages/mine/index.vue` | 身份卡：优先真读姓名 / `me.profileSummary` |
| `stores/auth.ts` | 可选：缓存 `profileSummary.name`（不扩完整档） |
| 健康相关 API / `health.vue` | **不动** |

---

## 6. 后端改动要点

| 位置 | 改动 |
|------|------|
| `routes/patient-public.js` `/api/replies/mine` | 增加 Bearer 分支；会话 doctor/phone 约束 |
| `routes/mp-auth.js`（或等价） | 注册 `GET /api/mp/archive` |
| 实现复用 | `mp_auth.requireSession`、`profileStore.readPersonFields`、`patientProfile.maskIdNumber`、现有 replies 扫描与 `followup.mine` |
| 测试 | 优先 `_unittest.js` / 现有 mp 相关用例：会话免短信、doctor 不一致 403、H5 短信路径回归、archive 脱敏与无档 |

---

## 7. 错误处理

- 会话过期：前端 `ensureLogin` / 静默 relogin；接口 401。  
- 已登录未绑号进回复页：引导 `pages/auth/bind`（现有门禁）。  
- archive 失败：toast「暂时无法加载档案」；有本地缓存可只读展示并标注非实时（文案简短）。  
- replies 空列表：空态「暂无提交记录」，非错误。

---

## 8. 测试要点

1. **回复 · 会话路径**：医生 A 下同号提交加号 → 小程序 Bearer 拉取可见；不得看到医生 B 记录。  
2. **回复 · 短信路径**：无 Bearer，正确短信仍可查（H5 回归）。  
3. **回复 · 伪造**：Bearer 下传别人的 phone/code 不得串号。  
4. **待跟进**：有 pending 时首页数字与列表一致；清本地档后仍正确。  
5. **档案**：写档案成功 → 清 `patientProfile` storage → 再登录 → archive 仍有内容；身份证非明文。  
6. **无档**：`hasProfile=false`，archive 空，软推仍在。  
7. **健康页**：行为与改前一致（仍 mock）。

---

## 9. 受影响文件（预期）

- `app/routes/patient-public.js`  
- `app/routes/mp-auth.js`（及必要时 `app/mp_auth.js`）  
- `app/_unittest.js`（或等价测试）  
- `patient-uniapp/src/api/patient.ts`  
- `patient-uniapp/src/pages/replies/index.vue`  
- `patient-uniapp/src/pages/index/index.vue`  
- `patient-uniapp/src/pages/mine/index.vue`  
- `patient-uniapp/src/stores/auth.ts`（轻量）

---

## 10. 结论

本期用「**增强 replies/mine 会话免验 + 新建 GET /api/mp/archive**」两刀，收口小程序 P0 读侧假真接口与「服务端档案为准」；健康记录与扩 me 明确排除，避免范围膨胀。
