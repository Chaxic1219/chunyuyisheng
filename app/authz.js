/* 鉴权判定纯函数（零依赖，可被 server 与 _unittest 共用，保证单一实现不漂移）。
   只做布尔判定，不触 DB / 不触 http；DB 相关的 scope 取数仍在 server.js 的 adminScope。 */

/* 社群公开入站回调鉴权（fail-closed）：
   - 未配置 COMMUNITY_WEBHOOK_TOKEN（envToken 为空）→ 一律拒绝，绝不因"没配 token"而对外裸奔；
   - 已配置 → 请求头 x-community-token 必须精确匹配才放行；
   - demoToken 仅在演示态(--demo / SMS_DEMO=1)由 server 注入，便于本地/测试，生产侧不传 → 不影响 fail-closed。 */
function communityInboundAuthorized(envToken, headerToken, demoToken){
  const env = String(envToken || "");
  const hdr = String(headerToken || "");
  const demo = String(demoToken || "");
  if(env){ return hdr === env; }            // 已配置 → 必须匹配
  if(demo){ return hdr === demo; }           // 仅演示态：用内置 demo token 兜底，红线在生产侧仍 fail-closed
  return false;                              // 未配置且非演示 → 拒绝（缺 token 必拒）
}

/* QiWe 第三方回调鉴权（fail-closed，对齐 communityInboundAuthorized）：
   - 已配置 callbackSecret → 请求头 x-qiwe-secret / Authorization: Bearer <secret> / URL 令牌（urlToken）三通道任一精确匹配；
   - URL 令牌通道的由来：qiweapi 真实回调推送**不带任何鉴权头**（nginx 诊断实锤 qs=0 au=0），且控制台保存回调 URL 时
     会先发一次无鉴权探测 POST，被 403 就存不上——把 secret 放进 URL（路径段或 ?t=），探测 POST 打到带令牌 URL → 过闸 200
     → 控制台能保存带路径 URL → 此后每条真实推送 URL 天然带 token → 过鉴权。token 的解出在 server.js 回调路由。
   - 未配置 secret 但有 demoSecret（仅 --demo 由 server 注入）→ 用 demo 兜底（同样三通道），便于本地/集成测试；
   - 两者都没有 → 一律拒绝（绝不因"没配 secret"而对外裸奔，生产侧 fail-closed；urlToken 再像样也拒）。 */
function qiweCallbackAuthorized(secret, headerToken, authHeader, demoSecret, urlToken){
  const sec = String(secret || "");
  const hdr = String(headerToken || "").trim();
  const auth = String(authHeader || "").trim();
  const demo = String(demoSecret || "");
  const url = String(urlToken || "").trim();
  if(sec){ return hdr === sec || auth === ("Bearer " + sec) || url === sec; }    // 已配置 → 必须匹配（三通道任一）
  if(demo){ return hdr === demo || auth === ("Bearer " + demo) || url === demo; } // 仅演示态兜底（语义不变，通道对齐）
  return false;                                                                   // 未配置且非演示 → 拒绝
}

const ADMIN_ROLES = new Set(["super", "scoped", "ops_manager", "assistant", "viewer"]);
const ROLE_LABELS = {
  super: "超级管理员",
  scoped: "医助账号（旧）",
  ops_manager: "运营主管",
  assistant: "医助",
  viewer: "只读/质检"
};
const ACTION_ALIASES = {
  "outbox.send": "community.outbox.send",
  "outbox.edit": "community.outbox.edit",
  "outbox.cancel": "community.outbox.edit",
  "outbox.ignore": "community.outbox.edit",
  "outbox.assignee": "community.outbox.edit",
  "assistant-draft.generate": "assistant_draft.generate",
  "ops-candidate.generate": "ops.candidate_generate"
};
const ROLE_ACTIONS = {
  ops_manager: new Set([
    "dashboard.doctor.read",
    "audit.read_scoped",
    "doctor.profile.update",
    "rules.manage",
    "config.draft",
    "config.publish",
    "community.group.manage",
    "community.inbound.simulate",
    "community.campaign.create",
    "community.outbox.send",
    "community.outbox.edit",
    "community.moderation.resolve",
    "triage.confirm_send",
    "triage.note_status",
    "followup.manage",
    "waitlist.manage",
    "submissions.manage",
    "knowledge.manage",
    "ops.strategy.manage",
    "outcome.manage",
    "ops.candidate_generate",
    "assistant_draft.generate",
    "patients.family.update",
    "patients.health.update",
    "patients.merge",
    "patients.archive",
    "service_orders.review",
    "service_products.manage"
  ]),
  assistant: new Set([
    "dashboard.doctor.read",
    "community.inbound.simulate",
    "community.campaign.create",
    "community.outbox.send",
    "community.outbox.edit",
    "community.moderation.resolve",
    "triage.confirm_send",
    "triage.note_status",
    "followup.manage",
    "waitlist.manage",
    "submissions.manage",
    "assistant_draft.generate",
    "patients.family.update",
    "patients.health.update",
    "patients.merge",
    "patients.archive"
  ]),
  viewer: new Set([
    "dashboard.doctor.read",
    "audit.read_scoped"
  ])
};

function normalizeAdminRole(role, fallback){
  const raw = String(role == null ? "" : role).trim();
  const r = raw || (fallback || "");
  return ADMIN_ROLES.has(r) ? r : "";
}

function effectiveAdminRole(role){
  const raw = String(role == null ? "" : role).trim();
  if(!raw) return "super";
  if(raw === "scoped") return "assistant";
  return ADMIN_ROLES.has(raw) ? raw : "";
}

function roleLabel(role){
  return ROLE_LABELS[normalizeAdminRole(role, "")] || ROLE_LABELS[effectiveAdminRole(role)] || "未知角色";
}

function canonicalAdminAction(action){
  const a = String(action || "").trim();
  return ACTION_ALIASES[a] || a;
}

function roleAllowsAdminAction(role, action){
  const effective = effectiveAdminRole(role);
  const canonical = canonicalAdminAction(action);
  if(effective === "super") return true;
  return !!(ROLE_ACTIONS[effective] && ROLE_ACTIONS[effective].has(canonical));
}

function validAdminRole(role){
  return role == null || role === "" || ADMIN_ROLES.has(String(role).trim());
}

/* 超级管理员判定（与 server.adminScope 同口径）：admins.role 为空或 'super' 视为 super；其余固定角色非 super。 */
function isSuperRole(role){
  return effectiveAdminRole(role) === "super";
}

module.exports = {
  communityInboundAuthorized,
  qiweCallbackAuthorized,
  ADMIN_ROLES,
  ROLE_LABELS,
  normalizeAdminRole,
  effectiveAdminRole,
  roleLabel,
  canonicalAdminAction,
  roleAllowsAdminAction,
  validAdminRole,
  isSuperRole
};
