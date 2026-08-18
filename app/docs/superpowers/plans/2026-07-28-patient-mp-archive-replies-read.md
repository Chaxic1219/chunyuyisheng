# 患者端小程序 · 回复真读 + 档案真读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小程序已绑号会话可一键真读「我的回复」与「本人档案」，首页待跟进同源；并产出 `dist/build/mp-weixin` 供微信开发者工具打开。

**Architecture:** 增强 `POST /api/replies/mine`（Bearer 免短信，doctorId 与会话一致）；新增 `GET /api/mp/archive`（会话读 person + profileStore，脱敏）；小程序 API/页面改消费真契约，本地 profile 仅作缓存回退。

**Tech Stack:** Node `app/`（mp_auth、patient-public、patient_profile）；uni-app `patient-uniapp`（Pinia、uni.request）；微信小程序 `mp-weixin` 构建。

**Spec:** `app/docs/superpowers/specs/2026-07-28-patient-mp-archive-replies-read-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `app/routes/patient-public.js` | replies/mine 会话鉴权分支 |
| `app/routes/mp-auth.js` | `GET /api/mp/archive` |
| `app/server.js` | 向 mp-auth 注入 `db` / `profileStore` / `patientProfile` / `mpAuth` 所需依赖 |
| `app/_mp_archive_replies_test.js` | 新增：会话 replies + archive 单测 |
| `patient-uniapp/src/api/patient.ts` | getRepliesMine / getFollowupSummary / getMyArchive |
| `patient-uniapp/src/stores/auth.ts` | 缓存 `profileName` |
| `patient-uniapp/src/pages/replies/index.vue` | 已登录免输手机、进入即拉 |
| `patient-uniapp/src/pages/index/index.vue` | 建档态用 auth.hasProfile；待跟进真摘要 |
| `patient-uniapp/src/pages/mine/index.vue` | 身份卡优先服务端姓名 |

**非范围：** 健康记录真读、提交 commit（除非主人要求）、部署演示服。

---

### Task 1: 后端 replies/mine Bearer 分支

**Files:**
- Modify: `app/routes/patient-public.js`（`/api/replies/mine` 路由块）

- [ ] **Step 1: 抽出列表构建为本地函数，并加会话解析**

在 `route("POST", /^\/api\/replies\/mine$/` 内，鉴权改为：

```javascript
route("POST", /^\/api\/replies\/mine$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const did = b.doctorId;
  if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res,404,{error:"医生不存在"});

  let phone = String(b.phone||"").trim();
  let usedMp = false;
  try{
    const { bearerToken } = require("./mp-auth.js");
    const mpAuth = require("../mp_auth.js");
    const tok = bearerToken(req);
    if(tok){
      const sess = mpAuth.requireSession(tok);
      if(!sess.phone_bound || !sess.person_id) return json(res,401,{error:"请先绑定手机号"});
      if(sess.doctor_id == null || +sess.doctor_id !== +did) return json(res,403,{error:"医生不匹配"});
      const person = db.prepare("SELECT phone, phone_verified FROM persons WHERE id=?").get(sess.person_id);
      if(!person || !person.phone_verified || !person.phone) return json(res,401,{error:"请先绑定手机号"});
      phone = String(person.phone).trim();
      usedMp = true;
    }
  }catch(e){
    if(String(e.message||"").includes("unauthorized") || String(e.message||"").includes("session")){
      return json(res,401,{error:"unauthorized"});
    }
    /* 无 token 时继续短信路径 */
  }

  if(!usedMp){
    if(!isPhone(phone)) return json(res,400,{error:"请输入正确手机号"});
    const smsError = verifySms(phone, b.code);
    if(smsError) return json(res,400,{error:smsError});
  }

  const rows = db.prepare("SELECT id,type,payload,status,created_at FROM submissions WHERE doctor_id=? ORDER BY id DESC LIMIT 500").all(did);
  const mine = rows.map(r=>{
    let p={}; try{ p=JSON.parse(r.payload||"{}"); }catch(e){}
    const phones = [p["手机号"], p["患者手机号"], p["代办人手机"], p["联系电话"], p["手机"]].filter(Boolean).map(String);
    return { r, p, hit:phones.includes(phone) };
  }).filter(x=>x.hit).slice(0,50).map(x=>({
    id:x.r.id,
    type:x.r.type,
    status:x.r.status,
    at:x.r.created_at,
    summary:Object.entries(x.p).filter(([k])=>!/(手机号|手机|身份证|验证|同意)/.test(k)).slice(0,6).map(([k,v])=>`${k}：${String(v).slice(0,60)}`)
  }));
  json(res,200,{ ok:true, replies:mine, followups:followup.mine(did, phone) });
});
```

注意：仅有无效 Bearer 时返回 401；完全无 Authorization 头时走短信路径（不要因 requireSession 抛错误伤 H5）。

修正逻辑：仅当 `bearerToken(req)` 非空时才 `requireSession`；无 token 则短信。

- [ ] **Step 2: 本地快速验证（可选脚本或手工）**

Run: 启动 `node server.js` 后用已有短信路径回归；会话路径用 Task 3 单测覆盖。

---

### Task 2: 后端 GET /api/mp/archive

**Files:**
- Modify: `app/routes/mp-auth.js`
- Modify: `app/server.js`（扩大 `registerMpAuthRoutes` 注入）

- [ ] **Step 1: server.js 注入依赖**

```javascript
registerMpAuthRoutes(route, {
  parseBody, json, verifySms, MESSAGE_MAX_BODY,
  db, profileStore, patientProfile
});
```

- [ ] **Step 2: 在 mp-auth.js 注册 archive**

```javascript
function registerMpAuthRoutes(route, ctx) {
  const { parseBody, json, verifySms, MESSAGE_MAX_BODY, db, profileStore, patientProfile } = ctx;
  // ... existing routes ...

  route("GET", /^\/api\/mp\/archive$/, (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) return json(res, 401, { error: "unauthorized" });
      const sess = mpAuth.requireSession(token);
      if (!sess.phone_bound || !sess.person_id) {
        return json(res, 200, { ok: true, hasProfile: false });
      }
      const person = db.prepare("SELECT * FROM persons WHERE id=?").get(sess.person_id);
      if (!person || !person.phone_verified) {
        return json(res, 200, { ok: true, hasProfile: false });
      }
      const patientId = sess.patient_id != null ? +sess.patient_id : null;
      const patient = patientId
        ? db.prepare("SELECT * FROM patients WHERE id=?").get(patientId)
        : null;
      const fields = profileStore.readPersonFields(sess.person_id);
      const name =
        (person.real_name && String(person.real_name).trim()) ||
        (patient && patient.real_name && String(patient.real_name).trim()) ||
        (patient && patient.display_name && String(patient.display_name).trim()) ||
        "";
      const hasProfile = !!(name && person.phone);
      if (!hasProfile) return json(res, 200, { ok: true, hasProfile: false });

      const idRaw = fields.idNumber || "";
      const allergies = (v) =>
        v && typeof v === "object" ? v : { values: [], other: "" };

      json(res, 200, {
        ok: true,
        hasProfile: true,
        patient: {
          id: patientId,
          name,
          gender: (person.gender || (patient && patient.gender) || ""),
          birthDate: (person.birth_date || (patient && patient.birth_date) || ""),
          phoneMasked: mpAuth /* use local mask */ 
        },
        profile: {
          idNumberMasked: idRaw ? patientProfile.maskIdNumber(idRaw) : "",
          disease: fields.disease || "",
          pregnancyStatus: fields.pregnancyStatus || "",
          foodContactAllergies: allergies(fields.foodContactAllergies),
          drugAllergies: allergies(fields.drugAllergies),
          diseaseHistory: allergies(fields.diseaseHistory)
        }
      });
    } catch (e) {
      json(res, 401, { error: "unauthorized" });
    }
  });
}
```

phoneMasked：复用 `mp_auth` 内 mask 逻辑——在 `mp_auth.js` export 一个 `maskPhone`，或在路由内复制三段掩码（与 summarizeSession 一致：`138****0000`）。

优先：在 `mp_auth.js` 增加 `exports.maskPhone = maskPhone`，archive 路由调用。

---

### Task 3: 后端单测

**Files:**
- Create: `app/_mp_archive_replies_test.js`

- [ ] **Step 1: 写测试**（require server 不 listen；直接调路由或用现有 http 辅助）

若项目惯用 `http` 打本地端口，用临时 PORT。最小断言：

1. 无 token + 错短信 → 400  
2. 有绑定会话 + 正确 doctorId → 200，`replies` 数组  
3. 会话 doctor 与 body 不一致 → 403  
4. Bearer 下传他人 phone 仍只返回会话手机记录  
5. `GET /api/mp/archive` 无 token → 401；有档会话 → `hasProfile` + 脱敏身份证不含完整明文  

- [ ] **Step 2: 运行**

```bash
cd app && node _mp_archive_replies_test.js
```

Expected: 全部 ok / exit 0

---

### Task 4: 小程序 API 层

**Files:**
- Modify: `patient-uniapp/src/api/patient.ts`
- Modify: `patient-uniapp/src/stores/auth.ts`

- [ ] **Step 1: auth store 增加 profileName**

`applyMe` 读取 `data.profileSummary?.name`；`clear` 清空。

- [ ] **Step 2: 改写 getRepliesMine / getFollowupSummary / getMyArchive**

```typescript
import { getMpToken } from "./auth";

const REPLY_DONE = new Set(["已完成", "已取消", "已关闭", "completed", "cancelled", "closed"]);

function formatAllergy(v: unknown): string {
  if (!v) return "无";
  if (typeof v === "string") return v || "无";
  const o = v as { values?: string[]; other?: string };
  const values = Array.isArray(o.values) ? [...o.values] : [];
  const other = (o.other || "").trim();
  if (other) {
    const idx = values.indexOf("其他");
    if (idx >= 0) values[idx] = `其他（${other}）`;
  }
  return values.length ? values.join("、") : "无";
}

export type ReplyItem = { title: string; status: string; time: string; at?: string };

export async function getRepliesMine(doctorId: number): Promise<{ items: ReplyItem[]; raw: { replies: any[]; followups: any[] } }> {
  if (USE_MOCK) { /* keep mock items */ }
  const header: Record<string, string> = { "Content-Type": "application/json" };
  const t = getMpToken();
  if (t) header.Authorization = `Bearer ${t}`;
  const res = await uni.request({
    url: `${API_BASE}/api/replies/mine`,
    method: "POST",
    header,
    data: { doctorId },
  });
  const data = res.data as any;
  if (res.statusCode && res.statusCode >= 400) throw new Error(data?.error || "查询失败");
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const followups = Array.isArray(data.followups) ? data.followups : [];
  const items: ReplyItem[] = [
    ...replies.map((r: any) => ({ title: String(r.type || "提交"), status: String(r.status || ""), time: String(r.at || ""), at: String(r.at || "") })),
    ...followups.map((f: any) => ({ title: String(f.title || f.planName || "随访"), status: String(f.status || ""), time: String(f.updatedAt || f.at || ""), at: String(f.updatedAt || f.at || "") })),
  ];
  return { items, raw: { replies, followups } };
}

export async function getFollowupSummary(doctorId?: number): Promise<FollowupSummary> {
  if (!getMpToken() || !doctorId) return { pendingCount: 0, latestTitle: "" };
  try {
    const { items, raw } = await getRepliesMine(doctorId);
    const pendingReplies = raw.replies.filter((r) => !REPLY_DONE.has(String(r.status || "")));
    const pendingFu = raw.followups.filter((f) => !REPLY_DONE.has(String(f.status || "")) && String(f.status) !== "completed");
    const pendingCount = pendingReplies.length + pendingFu.length;
    const sorted = [...items].sort((a, b) => String(b.at || b.time).localeCompare(String(a.at || a.time)));
    const latest = sorted[0];
    return {
      pendingCount,
      latestTitle: latest ? `${latest.title} · ${latest.status}` : "",
    };
  } catch {
    return { pendingCount: 0, latestTitle: "" };
  }
}

export async function getMyArchive(): Promise<PatientArchive> {
  if (USE_MOCK) { /* existing mock+local */ }
  const t = getMpToken();
  if (!t) {
    // fallback local
  }
  const res = await uni.request({
    url: `${API_BASE}/api/mp/archive`,
    method: "GET",
    header: { Authorization: `Bearer ${t}` },
  });
  const data = res.data as any;
  if (res.statusCode && res.statusCode >= 400) throw new Error(data?.error || "加载失败");
  if (!data.hasProfile) {
    const local = getLocalProfile();
    // map empty or local fallback into PatientArchive
  }
  // map patient/profile → PatientArchive.contactSummary
}
```

签名变更：`getRepliesMine(doctorId)` —— 更新所有调用方。

---

### Task 5: 页面

**Files:**
- Modify: `patient-uniapp/src/pages/replies/index.vue`
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/mine/index.vue`

- [ ] **Step 1: replies** — `onShow`：ensureLogin → 已绑号则 `load()`；去掉手机输入与 Demo 文案；展示列表/空态/错误重试。

- [ ] **Step 2: index** — `hasProfile = auth.hasProfile || !!local`；`getFollowupSummary(store.doctor?.id)`。

- [ ] **Step 3: mine** — `displayName` 优先 `auth.profileName`，其次本地；`archiveLabel` 用 `auth.hasProfile || local`。

---

### Task 6: 构建微信小程序包

**Files:** 无源码；产出 `patient-uniapp/dist/build/mp-weixin`

- [ ] **Step 1: 启动本地 app（新 API 必须本地，演示服尚未部署）**

```bash
cd app && set PORT=3200&& node server.js
```

- [ ] **Step 2: 构建指向本机**

```bash
cd patient-uniapp
# Windows PowerShell:
$env:VITE_API_BASE="http://127.0.0.1:3200"; pnpm run build:mp-weixin
```

- [ ] **Step 3: 微信开发者工具**

导入目录：`patient-uniapp/dist/build/mp-weixin`  
勾选：不校验合法域名、web-view、TLS 版本及 HTTPS 证书。  
本机需保持 `app` 在 3200 监听。

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| replies Bearer 免短信 | 1 |
| doctorId 一致 / 忽略伪造 phone | 1, 3 |
| H5 短信不变 | 1 |
| GET /api/mp/archive | 2 |
| 首页待跟进同源 | 4, 5 |
| mine/index 服务端为准 | 5 |
| 健康记录不动 | — |
| 微信开发者工具可预览 | 6 |
