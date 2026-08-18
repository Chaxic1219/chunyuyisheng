"use strict";

/**
 * 企微侧边栏聚合 API（从 server.js 迁出）。
 */
function registerWecomSidebarRoutes(route, ctx){
  const {
    json, gate, rowDoctorId,
    db, community, triage, qiwe, qiweBridge, adminScope
  } = ctx;

const SIDEBAR_CODES = [
  "101","102","103","105","201","301","302",
  "606","616","626","808","818","909","919"
];
const SIDEBAR_CODE_LABELS = {
  "101":"医生咨询",
  "102":"视频问诊",
  "103":"查看就医相关电话",
  "105":"查看回复",
  "201":"挂号及门诊时间",
  "301":"加号",
  "302":"住院预约",
  "606":"学习科普",
  "616":"住院及手术知识",
  "626":"就医常见问题",
  "808":"医生简介展示",
  "818":"介绍给亲友",
  "909":"感谢医生",
  "919":"评价医生"
};
function parseJsonArray(raw){
  try{ const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
function responseMethods(resp){
  const methods = new Set();
  const r = resp || {};
  const ext = r.external || {};
  const text = r.text || r.title || r.modal || "";
  if(String(text).trim()) methods.add("文字");
  if(r.type === "image") methods.add("图片/海报");
  if(r.type === "qr") methods.add("二维码");
  if(r.type === "popup") methods.add("弹窗/本地信息");
  if(r.page) methods.add(["contact-form","add-number","admission","review","story","thank-doctor"].includes(r.page) ? "本地表单" : "本地页面");
  if(ext.url){
    methods.add(/\/rec\//.test(ext.url) ? "问卷" : "H5/公众号");
  }
  if(ext.shortLink) methods.add("小程序短链");
  if(r.type === "mp") methods.add("小程序入口");
  return methods;
}
function responseAllowsNativeWeapp(resp){
  const ext = (resp && resp.external) || {};
  return !(ext.status === "fallback_short_link" || ext.nativeCard === false);
}
function responseNativeWeappCandidate(resp){
  const ext = (resp && resp.external) || {};
  return !!(resp && (resp.type === "mp" || ext.mode === "mini_program" || ext.shortLink));
}
function sidebarFulfillment(doctorId, cards){
  const rules = db.prepare("SELECT code,aliases,responses,enabled FROM rules WHERE doctor_id=?").all(Number(doctorId));
  const ruleMap = new Map(rules.map(r=>[r.code, r]));
  const cardMap = new Map((cards || []).map(c=>[c.code, c]));
  const rows = SIDEBAR_CODES.map(code=>{
    const rule = ruleMap.get(code);
    const responses = parseJsonArray(rule && rule.responses);
    const methods = new Set();
    responses.forEach(r=>responseMethods(r).forEach(x=>methods.add(x)));
    const card = cardMap.get(code);
    const nativeAllowed = responses.some(r=>responseNativeWeappCandidate(r) && responseAllowsNativeWeapp(r));
    if(card && card.ready && nativeAllowed) methods.add("企微原生卡片");
    else if(card && card.sourceShortLink) methods.add("小程序短链");
    const enabled = !!(rule && rule.enabled);
    const fulfilled = enabled && methods.size > 0;
    return {
      code,
      label:SIDEBAR_CODE_LABELS[code] || "",
      enabled,
      fulfilled,
      cardReady:!!(card && card.ready && nativeAllowed),
      methods:Array.from(methods),
      title:(card && card.title) || (responses[0] && (responses[0].title || responses[0].modal || responses[0].page || responses[0].text)) || "",
      missing:(card && card.missing) || []
    };
  });
  return {
    total:rows.length,
    fulfilled:rows.filter(x=>x.fulfilled).length,
    nativeCards:rows.filter(x=>x.cardReady).length,
    rows,
    gaps:rows.filter(x=>!x.fulfilled).map(x=>x.code)
  };
}

/* 企微侧边栏：面向当前聊天的小工作台聚合接口。只读聚合，发送/忽略仍走 outbox 明确动作接口。 */
route("GET", /^\/api\/admin\/wecom\/sidebar$/, (req,res,m,q)=>{
  const cfg = qiwe.loadConfig();
  const did = Number(q.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  if(!Number.isInteger(did) || did <= 0) return json(res,400,{error:"doctorId 非法"});
  const s=gate(req,res,did); if(!s)return;
  try{
    const overview = community.overview(did);
    const sessions = triage.listSessions(did).slice(0, 8);
    const requestedSessionId = Number(q.sessionId || 0);
    const fallbackSessionId = (sessions[0] && sessions[0].id) || 0;
    const requestedOwner = Number.isInteger(requestedSessionId) && requestedSessionId > 0 ? rowDoctorId("triage_sessions", requestedSessionId) : null;
    const activeSessionId = requestedOwner === did ? requestedSessionId : fallbackSessionId;
    const sessionDetail = activeSessionId ? triage.sessionDetail(activeSessionId) : null;
    const cards = qiwe.publicWeappTemplates(did);
    const readyCards = cards.filter(c=>c.ready);
    const fulfillment = sidebarFulfillment(did, cards);
    const pendingOutbox = overview.outbox.filter(o=>o.status === "pending").slice(0, 12);
    const groupId = String(q.groupId || q.externalGroupId || "").trim();
    const userId = String(q.externalUserId || q.userId || q.wxid || "").trim();
    let currentGroup = null, currentMember = null;
    if(groupId){
      currentGroup = db.prepare(`
        SELECT * FROM community_groups
        WHERE doctor_id=? AND (external_group_id=? OR CAST(id AS TEXT)=?)
        ORDER BY id DESC LIMIT 1`).get(did, groupId, groupId) || null;
    }
    if(userId){
      currentMember = db.prepare(`
        SELECT m.*, g.name AS group_name, g.external_group_id
        FROM community_members m
        LEFT JOIN community_groups g ON g.id=m.group_id
        WHERE m.doctor_id=? AND m.external_user_id=?
        ORDER BY m.id DESC LIMIT 1`).get(did, userId) || null;
    }
    const qiwePublic = qiwe.publicConfig(cfg);
    const qiweSafe = adminScope(s) === null ? qiwePublic : {
      configured:qiwePublic.configured,
      enabled:qiwePublic.enabled,
      autoSend:qiwePublic.autoSend,
      allowGroup:qiwePublic.allowGroup,
      callbackSecret:qiwePublic.callbackSecret
    };
    json(res,200,{
      ok:true,
      doctorId:did,
      qiwe:qiweSafe,
      context:{
        groupId,
        externalUserId:userId,
        group:currentGroup ? {
          id:currentGroup.id,
          name:currentGroup.name || "",
          externalGroupId:currentGroup.external_group_id || "",
          memberCount:currentGroup.member_count || 0,
          status:currentGroup.status || ""
        } : null,
        member:currentMember ? {
          id:currentMember.id,
          displayName:currentMember.display_name || "",
          externalUserId:currentMember.external_user_id || "",
          groupId:currentMember.group_id || null,
          groupName:currentMember.group_name || ""
        } : null
      },
      summary:overview.summary,
      groups:overview.groups.slice(0, 8),
      messages:overview.messages.slice(0, 16),
      pendingOutbox,
      sessions,
      sessionDetail,
      cards:{
        total:cards.length,
        ready:readyCards.length,
        readyCodes:readyCards.map(c=>c.code),
        missing:cards.filter(c=>!c.ready).slice(0, 12).map(c=>({ code:c.code, title:c.title, missing:c.missing || [] }))
      },
      fulfillment
    });
  }catch(e){ json(res,400,{error:e.message}); }
});


}

module.exports = { registerWecomSidebarRoutes };
