"use strict";

/**
 * 随访相关路由（模块化试点：从 server.js 迁出，行为与原文一致）。
 */
function registerFollowupRoutes(route, ctx){
  const {
    parseBody, json, gate, rowDoctorId, requireAdminAction,
    followup, db, isPhone, verifySms
  } = ctx;

  route("POST", /^\/api\/followup\/mine$/, async (req, res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res, 413, { error:"请求体过大（上限 1MB）" });
    const did = b.doctorId, phone = String(b.phone || "").trim();
    if(!did || !db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) return json(res, 404, { error:"医生不存在" });
    if(!isPhone(phone)) return json(res, 400, { error:"请输入正确手机号" });
    const smsError = verifySms(phone, b.code);
    if(smsError) return json(res, 400, { error:smsError });
    json(res, 200, { ok:true, followups: followup.mine(did, phone) });
  });

  route("GET", /^\/api\/admin\/followups$/, (req, res, m, q)=>{
    const s = gate(req, res, +q.doctorId); if(!s) return;
    json(res, 200, followup.listQueue(+q.doctorId));
  });

  route("GET", /^\/api\/admin\/followups\/(\d+)$/, (req, res, m)=>{
    const s = gate(req, res, rowDoctorId("followups", +m[1])); if(!s) return;
    const d = followup.detail(+m[1]);
    d ? json(res, 200, d) : json(res, 404, { error:"随访不存在" });
  });

  route("GET", /^\/api\/admin\/followup-plans$/, (req, res, m, q)=>{
    const s = gate(req, res, +q.doctorId); if(!s) return;
    json(res, 200, followup.plansFor(+q.doctorId));
  });

  route("POST", /^\/api\/admin\/followups$/, async (req, res)=>{
    const b = await parseBody(req);
    if(b.__oversize) return json(res, 413, { error:"请求体过大（上限 1MB）" });
    if(!b.doctorId || !b.planKey) return json(res, 400, { error:"缺少 doctorId 或 planKey" });
    const s = gate(req, res, +b.doctorId); if(!s) return;
    if(!requireAdminAction(req, res, s, "followup.manage", { doctorId:+b.doctorId }, "无随访处理权限")) return;
    const fu = followup.enroll(b.doctorId, {
      name: b.name,
      phone: String(b.phone || "").trim(),
      planKey: b.planKey,
      enrolledAt: b.enrolledAt
    });
    fu ? json(res, 200, { ok:true, id:fu.id }) : json(res, 400, { error:"方案不存在" });
  });

  route("POST", /^\/api\/admin\/followups\/(\d+)\/node$/, async (req, res, m)=>{
    const did = rowDoctorId("followups", +m[1]);
    const s = gate(req, res, did); if(!s) return;
    if(!requireAdminAction(req, res, s, "followup.manage", { doctorId:did }, "无随访处理权限")) return;
    const b = await parseBody(req);
    const d = followup.markNode(+m[1], +b.idx, b.status, s.username);
    d ? json(res, 200, d) : json(res, 404, { error:"随访不存在" });
  });
}

module.exports = { registerFollowupRoutes };
