"use strict";

/**
 * 后台鉴权与账号路由（从 server.js 迁出）：
 * login / logout / me / capabilities / admins CRUD / password / audit
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function registerAuthAdminRoutes(route, ctx){
  const {
    parseBody, json, gate, requireAdminAction,
    db, now, hashPw, authz,
    sessions,
    MESSAGE_MAX_BODY, ADMIN_SESSION_COOKIE_MAX_AGE,
    loginLimitStatus, recordLoginFailure, clearLoginFailure,
    activeAdminRow, buildSession, sessionCookie, cookies,
    authed, adminRow, adminOut, auditAdminSnapshot, adminAudit,
    allowDoctor, adminScopeTextFor, tabCapabilitiesFor, actionCapabilitiesFor,
    allocateStaffId, cleanText, auditOut,
    clearSessionsForAdmin, canAdmin,
    normalizeAdminRole, normalizeDoctorIds, replaceAdminDoctors,
    adminDoctorIds, lastSuperViolation, generatedPassword
  } = ctx;
  const cryptoApi = crypto;

function findAdminByLoginAccount(account){
  const key = String(account || "").trim();
  if(!key) return null;
  if(/^\d+$/.test(key)){
    const byStaff = db.prepare("SELECT * FROM admins WHERE staff_id=?").get(key);
    if(byStaff) return byStaff;
  }
  return db.prepare("SELECT * FROM admins WHERE username=?").get(key) || null;
}
route("POST", /^\/api\/admin\/login$/, async (req,res)=>{
  const b = await parseBody(req);
  const username = String(b.username || "").trim();
  const limited = loginLimitStatus(req, username);
  if(limited) return json(res,429,{error:"登录失败次数过多，请稍后再试", retryAfter:limited.retryAfter});
  const a = findAdminByLoginAccount(username);
  if(!activeAdminRow(a) || hashPw(b.password||"", a.salt)!==a.hash){
    recordLoginFailure(req, username);
    return json(res,401,{error:"用户名/工号或密码错误"});
  }
  clearLoginFailure(req, username);
  db.prepare("UPDATE admins SET last_login_at=?, updated_at=? WHERE id=?").run(now(), now(), a.id);
  const token = cryptoApi.randomBytes(16).toString("hex");
  sessions.set(token, buildSession(a));
  res.writeHead(200,{ "Content-Type":"application/json; charset=utf-8", "Set-Cookie":sessionCookie(req, token, ADMIN_SESSION_COOKIE_MAX_AGE) });
  res.end(JSON.stringify({ ok:true, username:a.username, role:a.role || "super" }));
});
route("POST", /^\/api\/admin\/logout$/, (req,res)=>{
  const t=cookies(req).sid;
  if(t) sessions.delete(t);
  res.writeHead(200,{ "Content-Type":"application/json; charset=utf-8", "Set-Cookie":sessionCookie(req, "", 0) });
  res.end(JSON.stringify({ok:true}));
});
route("GET", /^\/api\/admin\/me$/, (req,res)=>{
  const s=authed(req);
  if(!s) return json(res,401,{error:"未登录"});
  const a = adminRow(s.adminId);
  json(res,200,adminOut(a));
});
/* 当前登录医助自助更新：展示名、备注、头像（角色/权限不可自改） */
route("PUT", /^\/api\/admin\/me$/, async (req,res)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  // 头像 base64 可能略超 1MB，放宽到与咨询附件同级
  const b = await parseBody(req, MESSAGE_MAX_BODY);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 6MB）"});
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(s.adminId);
  if(!activeAdminRow(a)) return json(res,401,{error:"未登录"});
  const before = auditAdminSnapshot(a);
  const displayName = b.displayName === undefined ? (a.display_name || "") : String(b.displayName || "").trim().slice(0, 80);
  const note = b.note === undefined ? (a.note || "") : String(b.note || "").trim().slice(0, 500);
  let avatarUrl = a.avatar_url || "";
  if(b.clearAvatar === true){
    avatarUrl = "";
  }else if(typeof b.avatarDataUrl === "string" && b.avatarDataUrl.trim()){
    const m = String(b.avatarDataUrl).trim().match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if(!m) return json(res,400,{error:"头像格式仅支持 JPEG/PNG/WebP"});
    const mime = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if(!buf.length || buf.length > 2 * 1024 * 1024) return json(res,400,{error:"头像过大（压缩后需 ≤2MB）"});
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const dir = path.join(__dirname, "..", "public", "uploads", "admin-avatars");
    try{ fs.mkdirSync(dir, { recursive:true }); }catch(e){}
    const fileName = `admin-${a.id}-${Date.now()}.${ext}`;
    const abs = path.join(dir, fileName);
    fs.writeFileSync(abs, buf);
    // 清理该管理员旧头像文件（仅 uploads/admin-avatars 下）
    if(a.avatar_url && String(a.avatar_url).startsWith("/uploads/admin-avatars/")){
      try{
        const oldAbs = path.join(__dirname, "..", "public", String(a.avatar_url).replace(/^\//, "").replace(/\//g, path.sep));
        if(oldAbs.startsWith(dir) && fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      }catch(e){}
    }
    avatarUrl = `/uploads/admin-avatars/${fileName}`;
  }
  const ts = now();
  db.prepare("UPDATE admins SET display_name=?, note=?, avatar_url=?, updated_at=? WHERE id=?")
    .run(displayName, note, avatarUrl || null, ts, a.id);
  adminAudit(req, s, {
    action:"account.self_profile_update", resourceType:"admin", resourceId:a.id, doctorId:0,
    before, after:auditAdminSnapshot(adminRow(a.id))
  });
  json(res,200,{ ok:true, admin:adminOut(adminRow(a.id)) });
});
route("GET", /^\/api\/admin\/me\/capabilities$/, (req,res,m,q)=>{
  const s=authed(req);
  if(!s) return json(res,401,{error:"未登录"});
  const a = adminRow(s.adminId);
  if(!activeAdminRow(a)) return json(res,401,{error:"未登录"});
  const didRaw = q.doctorId == null || q.doctorId === "" ? "" : String(q.doctorId);
  const did = didRaw ? Number(didRaw) : null;
  if(didRaw && (!Number.isInteger(did) || did <= 0)) return json(res,400,{error:"doctorId 非法"});
  if(did && !allowDoctor(s, did)) return json(res,403,{error:"无该医生数据的访问权限"});
  json(res,200,{
    ok:true,
    admin:adminOut(a),
    role:a.role || "super",
    effectiveRole:authz.effectiveAdminRole(a.role),
    roleLabel:authz.roleLabel(a.role || "super"),
    scopeText:adminScopeTextFor(a),
    doctorId:did,
    tabs:tabCapabilitiesFor(s, did),
    actions:actionCapabilitiesFor(s, did)
  });
});


route("GET", /^\/api\/admin\/admins$/, (req,res)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  if(!requireAdminAction(req,res,s,"admin.manage",null,"仅超级管理员可查看")) return;
  json(res,200, db.prepare("SELECT id,username,staff_id,role,active,display_name,note,created_at,updated_at,last_login_at,password_changed_at,disabled_at,disabled_by FROM admins ORDER BY id").all().map(adminOut));
});
route("POST", /^\/api\/admin\/admins$/, async (req,res)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  if(!requireAdminAction(req,res,s,"admin.manage",null,"仅超级管理员可创建管理员")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const username=String(b.username||"").trim();
  const password=String(b.password||"");
  const role = normalizeAdminRole(b.role || "assistant");
  const doctorIds = normalizeDoctorIds(b.doctorIds);
  if(!username) return json(res,400,{error:"请填写登录账户号"});
  if(!/^[A-Za-z0-9_]{3,32}$/.test(username)) return json(res,400,{error:"登录账号仅支持 3–32 位字母/数字/下划线"});
  if(password.length<6) return json(res,400,{error:"密码至少 6 位"});
  if(!role) return json(res,400,{error:"角色不合法"});
  if(role!=="super" && doctorIds.length===0) return json(res,400,{error:"非超级管理员至少绑定一位医生"});
  let staffId;
  try{ staffId = allocateStaffId(role); }
  catch(e){ return json(res,500,{error:"工号分配失败："+(e && e.message || e)}); }
  const salt = cryptoApi.randomBytes(8).toString("hex");
  const ts = now();
  try{
    const r = db.prepare("INSERT INTO admins(username,salt,hash,role,active,display_name,note,staff_id,created_at,updated_at,password_changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(username, salt, hashPw(password, salt), role, 1, String(b.displayName||"").trim(), String(b.note||"").trim(), staffId, ts, ts, ts);
    const aid = r.lastInsertRowid;
    if(role !== "super") replaceAdminDoctors(aid, doctorIds);
    adminAudit(req, s, {
      action:"account.create", resourceType:"admin", resourceId:aid, doctorId:0,
      after:auditAdminSnapshot(adminRow(aid)), meta:{ doctorIds, role, staffId }
    });
    json(res,200,{ ok:true, id:aid, admin:adminOut(adminRow(aid)) });
  }catch(e){ json(res,400,{error:"创建失败（用户名或工号可能重复）："+e.message}); }
});
route("PUT", /^\/api\/admin\/admins\/(\d+)$/, async (req,res,m)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  if(!requireAdminAction(req,res,s,"admin.manage",null,"仅超级管理员可编辑管理员")) return;
  const target = adminRow(+m[1]);
  if(!target) return json(res,404,{error:"管理员不存在"});
  const before = auditAdminSnapshot(target);
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const nextRole = b.role === undefined ? (target.role || "super") : normalizeAdminRole(b.role);
  if(!nextRole) return json(res,400,{error:"角色不合法"});
  const nextActive = b.active === undefined ? (target.active !== 0 ? 1 : 0) : (b.active ? 1 : 0);
  const nextDoctorIds = b.doctorIds === undefined ? adminDoctorIds(target.id) : normalizeDoctorIds(b.doctorIds);
  if(nextRole !== "super" && nextDoctorIds.length===0) return json(res,400,{error:"非超级管理员至少绑定一位医生"});
  const lastSuper = lastSuperViolation(target, nextRole, nextActive);
  if(lastSuper) return json(res,409,{error:lastSuper});
  const ts = now();
  const wasActive = target.active !== 0;
  const disabling = wasActive && nextActive === 0;
  const enabling = !wasActive && nextActive !== 0;
  const displayName = b.displayName === undefined ? (target.display_name || "") : String(b.displayName || "").trim();
  const note = b.note === undefined ? (target.note || "") : String(b.note || "").trim();
  const disabledAt = disabling ? ts : (enabling ? null : target.disabled_at);
  const disabledBy = disabling ? s.adminId : (enabling ? null : target.disabled_by);
  db.prepare("UPDATE admins SET role=?,active=?,display_name=?,note=?,updated_at=?,disabled_at=?,disabled_by=? WHERE id=?")
    .run(nextRole,nextActive,displayName,note,ts,disabledAt,disabledBy,target.id);
  replaceAdminDoctors(target.id, nextRole === "super" ? [] : nextDoctorIds);
  const sessionsDropped = (target.role !== nextRole || (target.active !== 0 ? 1 : 0) !== nextActive) ? clearSessionsForAdmin(target.id) : 0;
  const action = disabling ? "account.disable" : enabling ? "account.enable" : "account.update";
  adminAudit(req, s, {
    action, resourceType:"admin", resourceId:target.id, doctorId:0,
    before, after:auditAdminSnapshot(adminRow(target.id)),
    meta:{ sessionsDropped, doctorIds:nextRole === "super" ? [] : nextDoctorIds }
  });
  json(res,200,{ ok:true, admin:adminOut(adminRow(target.id)) });
});
route("POST", /^\/api\/admin\/admins\/(\d+)\/reset-password$/, async (req,res,m)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  if(!requireAdminAction(req,res,s,"admin.manage",null,"仅超级管理员可重置密码")) return;
  const target = adminRow(+m[1]);
  if(!target) return json(res,404,{error:"管理员不存在"});
  const before = auditAdminSnapshot(target);
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const generated = !String(b.password || "").trim();
  const password = generated ? generatedPassword() : String(b.password || "");
  if(password.length < 6) return json(res,400,{error:"密码至少 6 位"});
  const salt = cryptoApi.randomBytes(8).toString("hex");
  const ts = now();
  db.prepare("UPDATE admins SET salt=?,hash=?,password_changed_at=?,updated_at=? WHERE id=?")
    .run(salt, hashPw(password, salt), ts, ts, target.id);
  const sessionsDropped = clearSessionsForAdmin(target.id);
  adminAudit(req, s, {
    action:"account.reset_password", resourceType:"admin", resourceId:target.id, doctorId:0,
    before, after:{ id:target.id, username:target.username, passwordChangedAt:ts },
    meta:{ generated, sessionsDropped }
  });
  json(res,200, generated ? { ok:true, temporaryPassword:password } : { ok:true });
});
route("POST", /^\/api\/admin\/me\/password$/, async (req,res)=>{
  const s=authed(req); if(!s){ json(res,401,{error:"未登录"}); return; }
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const a = db.prepare("SELECT * FROM admins WHERE id=?").get(s.adminId);
  if(!activeAdminRow(a)) return json(res,401,{error:"未登录"});
  if(hashPw(b.oldPassword||"", a.salt)!==a.hash) return json(res,400,{error:"旧密码错误"});
  const password = String(b.newPassword || "");
  if(password.length < 6) return json(res,400,{error:"新密码至少 6 位"});
  const salt = cryptoApi.randomBytes(8).toString("hex");
  const ts = now();
  db.prepare("UPDATE admins SET salt=?,hash=?,password_changed_at=?,updated_at=? WHERE id=?")
    .run(salt, hashPw(password, salt), ts, ts, a.id);
  const sessionsDropped = clearSessionsForAdmin(a.id);
  adminAudit(req, s, {
    action:"account.self_password_change", resourceType:"admin", resourceId:a.id, doctorId:0,
    before:auditAdminSnapshot(a), after:{ id:a.id, username:a.username, passwordChangedAt:ts },
    meta:{ sessionsDropped, reLogin:true }
  });
  res.writeHead(200,{ "Content-Type":"application/json; charset=utf-8", "Set-Cookie":sessionCookie(req, "", 0) });
  res.end(JSON.stringify({ok:true, reLogin:true}));
});

function auditScopedHidden(row){
  return row && (row.resource_type === "credential_config" || row.action === "credential.update");
}
function auditReadScope(req, res, s, q, row){
  if(canAdmin(s, "audit.read_full", null)) return { full:true, doctorId:null };
  const a = adminRow(s && s.adminId);
  if(!a || !authz.roleAllowsAdminAction(a.role, "audit.read_scoped")){
    json(res,403,{error:"无审计日志权限"});
    return null;
  }
  const raw = row ? row.doctor_id : (q && q.doctorId);
  const did = Number(raw);
  if(!Number.isInteger(did) || did <= 0){
    json(res, row ? 403 : 400, { error:row ? "无该审计详情权限" : "doctorId 非法或缺失" });
    return null;
  }
  if(!canAdmin(s, "audit.read_scoped", {doctorId:did})){
    json(res,403,{error:"无该医生审计摘要权限"});
    return null;
  }
  if(row && auditScopedHidden(row)){
    json(res,403,{error:"敏感凭证审计仅超级管理员可查看"});
    return null;
  }
  return { full:false, doctorId:did };
}

/* 统一后台审计：super 查完整流水；运营主管/质检仅查本医生摘要，且不暴露凭证详情 */
route("GET", /^\/api\/admin\/audit$/, (req,res,m,q)=>{
  const s=gate(req,res); if(!s)return;
  const scope = auditReadScope(req, res, s, q, null);
  if(!scope) return;
  const where = [], args = [];
  if(q.doctorId !== undefined && q.doctorId !== ""){
    const did = Number(q.doctorId);
    if(!Number.isInteger(did) || did < 0) return json(res,400,{error:"doctorId 非法"});
    if(scope.full){ where.push("doctor_id=?"); args.push(did); }
  }
  if(!scope.full){
    where.push("doctor_id=?"); args.push(scope.doctorId);
    where.push("resource_type<>?");
    args.push("credential_config");
    where.push("action<>?");
    args.push("credential.update");
  }
  if(q.action){ where.push("action=?"); args.push(String(q.action)); }
  if(q.resourceType){ where.push("resource_type=?"); args.push(String(q.resourceType)); }
  if(q.resourceId){ where.push("resource_id=?"); args.push(String(q.resourceId)); }
  if(q.outcome){ where.push("outcome=?"); args.push(String(q.outcome)); }
  if(q.actor){ where.push("actor_username LIKE ?"); args.push(String(q.actor).slice(0,80) + "%"); }
  if(q.from){ where.push("created_at>=?"); args.push(String(q.from)); }
  if(q.to){ where.push("created_at<=?"); args.push(String(q.to)); }
  if(q.q){
    const kw = "%" + String(q.q).trim().slice(0, 80) + "%";
    where.push("(actor_username LIKE ? OR action LIKE ? OR resource_type LIKE ? OR resource_id LIKE ? OR reason LIKE ? OR outcome LIKE ?)");
    args.push(kw, kw, kw, kw, kw, kw);
  }
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  args.push(limit);
  const sql = `SELECT * FROM admin_audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
  json(res,200,{ ok:true, scope:scope.full?"full":"doctor", doctorId:scope.doctorId, rows:db.prepare(sql).all(...args).map(r=>auditOut(r, false)) });
});
route("GET", /^\/api\/admin\/audit\/(\d+)$/, (req,res,m)=>{
  const s=gate(req,res); if(!s)return;
  const row = db.prepare("SELECT * FROM admin_audit_log WHERE id=?").get(+m[1]);
  if(!row) return json(res,404,{error:"审计记录不存在"});
  const scope = auditReadScope(req, res, s, null, row);
  if(!scope) return;
  json(res,200,{ ok:true, scope:scope.full?"full":"doctor", audit:auditOut(row, true) });
});


}

module.exports = { registerAuthAdminRoutes };
