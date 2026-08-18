"use strict";

/**
 * 医生后台路由（从 server.js 迁出）。
 */
function registerDoctorsAdminRoutes(route, ctx){
  const {
    parseBody,
    json,
    gate,
    rowDoctorId,
    requireAdminAction,
    db,
    adminScope,
    now,
    doctorListOut,
    patientProfile,
    inviteStore,
    inviteUrlForToken,
    adminAudit,
    cleanText,
    afterDoctorProvisioned, rememberRemovedDoctorSlug, forgetRemovedDoctorSlug
  } = ctx;

route("GET", /^\/api\/admin\/doctors$/, (req,res)=>{ const s=gate(req,res); if(!s)return;
  const sc=adminScope(s);
  let rows = db.prepare("SELECT id,slug,name,title,hospital,dept,specialty,hospital_phone,active FROM doctors ORDER BY id").all();
  if(sc!==null) rows = rows.filter(d=>sc.has(d.id)); // 子管理员只看归属医生
  json(res,200, rows.map(doctorListOut)); });
route("POST", /^\/api\/admin\/doctors$/, async (req,res)=>{ const s=gate(req,res); if(!s)return;
  if(!requireAdminAction(req,res,s,"doctor.create",null,"仅超级管理员可创建医生")) return;
  const b = await parseBody(req);
  if(!b.slug||!b.name) return json(res,400,{error:"slug 与 name 必填"});
  const content = { doctorProfile:{intro:b.intro||(b.name+" 医生简介"),profile:{oneline:"提供规范化诊疗与随访管理。"},columns:[],news:[],thanks:[],cases:[]},
    disclaimer:"本页面为本地演示，不构成诊断、处方或疗效承诺；紧急情况请立即到院。",
    consentText:"处理目的：用于本医生健康班的建档、随访与医助联系。\n处理范围：姓名、手机号、疾病描述及您主动上传的病历资料。\n保存期限：本地演示数据库留存；生产环境应按最短必要期限保存。\n您的权利：可申请查阅、更正、删除或撤回授权。",
    contactForm:{
      title:"医患通患者档案",
      desc:"提交基础信息建档（仅医生团队可见）",
      fields: patientProfile.defaultContactProfileFields(["消化系统疾病","其它"]),
      submitText:"提交建档",
      success:{ title:"已提交", desc:"医助会联系您。" }
    },
    clinicArticle:{title:b.name+" · 出诊时间",source:"医院服务号",body:[{h:"出诊",p:"待配置"}],tip:""},
    consult:{title:"群内咨询",text:"可在群内描述病情，助理会引导就医。",guide:"发送 101 获取咨询入口。"},
    story:{title:"给"+b.name+"医生写感谢信",intro:"欢迎在这里写下您想对医生和医助团队说的感谢，内容会转达给医生团队。",prompts:[],samples:[]},
    menu:{title:"群功能菜单",items:[{code:"101",label:"咨询"},{code:"114",label:"医院电话"},{code:"303",label:"出诊时间"}]},
    quickKeywords:[{c:"101",l:"咨询"},{c:"303",l:"门诊"},{c:"1",l:"全部功能"}] };
  const intro = { opensFaq:false, items:[{bot:"小助医助",type:"text",text:"您好，欢迎加入"+b.name+"医生的健康班。发送 1 查看功能。"}] };
  try{
    const r = db.prepare(`INSERT INTO doctors(slug,name,title,hospital,dept,specialty,group_name,member_count,scope_note,hospital_phone,bots,clinic,accounts,content,intro,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(b.slug,b.name,b.title||"主任医师",b.hospital||"",b.dept||"",b.specialty||"",
      b.group_name||(b.name+"健康班"),0,"院外公益健康班",b.hospital_phone||"",JSON.stringify(["小助医助"]),
      JSON.stringify({place:"",times:[]}),JSON.stringify([]),JSON.stringify(content),JSON.stringify(intro));
    const did = r.lastInsertRowid;
    // 给新医生几条基础规则
    const baseRules=[
      {code:"101",aliases:["咨询"],match:"exact",bot:"小助医助",responses:[{type:"text",text:"@{patient} 请通过下方二维码咨询医生。"},{type:"qr",name:b.name,sub:b.dept||"",caption:"扫一扫保持联系",code:"haodaifu"}]},
      {code:"114",aliases:["医院电话"],match:"exact",bot:"小助医助",responses:[{type:"text",text:"@{patient} 医院咨询电话👇"},{type:"popup",modal:"hospitalPhone"}]},
      {code:"303",aliases:["门诊"],match:"exact",bot:"小助医助",responses:[{type:"text",text:"出诊时间如下👇"},{type:"link",title:b.name+" · 出诊时间",source:"医院服务号",thumb:"hospital",page:"article:clinic"}]}
    ];
    baseRules.forEach((rl,i)=>db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,sort) VALUES(?,?,?,?,?,?,?)").run(did,rl.code,JSON.stringify(rl.aliases),rl.match,rl.bot,JSON.stringify(rl.responses),i));
    try{ if(typeof afterDoctorProvisioned === "function") afterDoctorProvisioned(did); }
    catch(e){ console.error("[doctor.create] afterDoctorProvisioned", e && e.message); }
    try{ if(typeof forgetRemovedDoctorSlug === "function") forgetRemovedDoctorSlug(b.slug); }catch(e){}
    adminAudit(req, s, {
      action:"doctor.create", resourceType:"doctor", resourceId:did, doctorId:did,
      after:{ id:did, slug:b.slug, name:b.name, active:false },
      meta:{ baseRules:baseRules.map(x=>x.code) }
    });
    json(res,200,{ ok:true, id:did });
  }catch(e){ json(res,400,{error:"创建失败（slug 可能重复）："+e.message}); }
});
route("PUT", /^\/api\/admin\/doctors\/(\d+)$/, async (req,res,m)=>{
  const did = +m[1];
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"doctor.profile.update",{doctorId:did},"无医生资料维护权限")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const row = db.prepare("SELECT * FROM doctors WHERE id=?").get(did);
  if(!row) return json(res,404,{error:"医生不存在"});
  const name = cleanText(b.name != null ? b.name : row.name, 80);
  if(!name) return json(res,400,{error:"姓名必填"});
  const title = cleanText(b.title != null ? b.title : row.title, 40);
  const hospital = cleanText(b.hospital != null ? b.hospital : row.hospital, 120);
  const dept = cleanText(b.dept != null ? b.dept : row.dept, 80);
  const specialty = cleanText(b.specialty != null ? b.specialty : row.specialty, 200);
  const hospitalPhone = cleanText(b.hospital_phone != null ? b.hospital_phone : b.hospitalPhone != null ? b.hospitalPhone : row.hospital_phone, 40);
  try{
    db.prepare(`UPDATE doctors SET name=?, title=?, hospital=?, dept=?, specialty=?, hospital_phone=? WHERE id=?`)
      .run(name, title, hospital, dept, specialty, hospitalPhone, did);
    adminAudit(req, s, {
      action:"doctor.profile.update", resourceType:"doctor", resourceId:did, doctorId:did,
      before:{ id:did, name:row.name, title:row.title, hospital:row.hospital, dept:row.dept },
      after:{ id:did, name, title, hospital, dept, specialty }
    });
    json(res,200,{ ok:true, doctor:doctorListOut(db.prepare("SELECT id,slug,name,title,hospital,dept,specialty,hospital_phone,active FROM doctors WHERE id=?").get(did)) });
  }catch(e){ json(res,400,{error:"更新失败："+e.message}); }
});
route("POST", /^\/api\/admin\/doctors\/(\d+)\/activate$/, (req,res,m)=>{ const s=gate(req,res,+m[1]); if(!s)return;
  // 2026-08-13：患者端改按邀请/最近使用选医生，全局「上下线」已废弃；接口保留以免旧客户端报错
  if(!requireAdminAction(req,res,s,"doctor.activate",{doctorId:+m[1]},"仅超级管理员可操作")) return;
  if(!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(+m[1])) return json(res,404,{error:"医生不存在"});
  json(res,200,{ ok:true, deprecated:true, message:"上下线已废弃：患者端按邀请链接与最近使用医生归属" });
});

route("DELETE", /^\/api\/admin\/doctors\/(\d+)$/, (req,res,m)=>{
  const did = +m[1];
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"doctor.delete",{doctorId:did},"仅超级管理员可删除医生")) return;
  const row = db.prepare("SELECT id,slug,name FROM doctors WHERE id=?").get(did);
  if(!row) return json(res,404,{error:"医生不存在"});
  const totalDoctors = db.prepare("SELECT COUNT(*) c FROM doctors").get().c;
  if(totalDoctors <= 1) return json(res,400,{error:"至少保留一位医生，无法删除最后一位"});
  const counts = {
    patients: db.prepare("SELECT COUNT(*) c FROM patients WHERE doctor_id=?").get(did).c,
    groups: db.prepare("SELECT COUNT(*) c FROM community_groups WHERE doctor_id=?").get(did).c,
    rules: db.prepare("SELECT COUNT(*) c FROM rules WHERE doctor_id=?").get(did).c,
    messageLog: (()=>{ try{ return db.prepare("SELECT COUNT(*) c FROM message_log WHERE doctor_id=?").get(did).c; }catch(e){ return 0; } })()
  };
  try{
    // node:sqlite DatabaseSync 无 better-sqlite3 的 db.transaction()
    db.exec("BEGIN IMMEDIATE");
    try{
      try{ db.prepare("DELETE FROM message_log WHERE doctor_id=?").run(did); }catch(e){}
      try{ db.prepare("DELETE FROM doctor_notifications WHERE doctor_id=?").run(did); }catch(e){}
      try{ db.prepare("DELETE FROM msg_log WHERE doctor_id=?").run(did); }catch(e){}
      try{ db.prepare("DELETE FROM patient_sessions WHERE doctor_id=?").run(did); }catch(e){}
      try{ db.prepare("UPDATE qiwe_configs SET doctor_id=NULL WHERE doctor_id=?").run(did); }catch(e){}
      if(typeof rememberRemovedDoctorSlug === "function") rememberRemovedDoctorSlug(row.slug, row.name);
      db.prepare("DELETE FROM doctors WHERE id=?").run(did);
      db.exec("COMMIT");
    }catch(inner){
      try{ db.exec("ROLLBACK"); }catch(e){}
      throw inner;
    }
  }catch(e){
    return json(res,400,{error:"删除失败："+(e && e.message || String(e))});
  }
  adminAudit(req, s, {
    action:"doctor.delete", resourceType:"doctor", resourceId:did, doctorId:did,
    before: row, after:null, meta: counts
  });
  json(res,200,{ ok:true, deletedId:did, counts });
});

/* 一键克隆：把源医生整套「底座」（content/intro/clinic/accounts/bots + 全部规则 + FAQ）复制给新医生（对标春雨医生批量复制） */
route("POST", /^\/api\/admin\/doctors\/(\d+)\/clone$/, async (req,res,m)=>{ const s=gate(req,res,+m[1]); if(!s)return;
  if(!requireAdminAction(req,res,s,"doctor.clone",{doctorId:+m[1]},"仅超级管理员可克隆医生")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  if(!b.slug || !b.name) return json(res,400,{error:"slug 与 name 必填"});
  const src = db.prepare("SELECT * FROM doctors WHERE id=?").get(+m[1]);
  if(!src) return json(res,404,{error:"源医生不存在"});
  try{
    const r = db.prepare(`INSERT INTO doctors(slug,name,title,hospital,dept,specialty,group_name,member_count,scope_note,hospital_phone,bots,clinic,accounts,content,intro,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      b.slug, b.name, src.title, src.hospital, src.dept, src.specialty, b.name+"医生健康班", 0, src.scope_note, src.hospital_phone,
      src.bots, src.clinic, src.accounts, src.content, src.intro);
    const did = r.lastInsertRowid;
    db.prepare("SELECT code,aliases,match_type,bot,responses,enabled,sort FROM rules WHERE doctor_id=? ORDER BY sort,id").all(+m[1])
      .forEach(x=>db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,?,?)")
        .run(did,x.code,x.aliases,x.match_type,x.bot,x.responses,x.enabled,x.sort));
    db.prepare("SELECT grp,q,a,link,sort FROM faq WHERE doctor_id=? ORDER BY sort,id").all(+m[1])
      .forEach(x=>db.prepare("INSERT INTO faq(doctor_id,grp,q,a,link,sort) VALUES(?,?,?,?,?,?)").run(did,x.grp,x.q,x.a,x.link,x.sort));
    try{ if(typeof afterDoctorProvisioned === "function") afterDoctorProvisioned(did); }
    catch(e){ console.error("[doctor.clone] afterDoctorProvisioned", e && e.message); }
    try{ if(typeof forgetRemovedDoctorSlug === "function") forgetRemovedDoctorSlug(b.slug); }catch(e){}
    adminAudit(req, s, {
      action:"doctor.clone", resourceType:"doctor", resourceId:did, doctorId:did,
      before:{ sourceDoctorId:+m[1], sourceName:src.name },
      after:{ id:did, slug:b.slug, name:b.name, active:false },
      meta:{ clonedFrom:+m[1] }
    });
    json(res,200,{ ok:true, id:did, clonedFrom:src.name });
  }catch(e){ json(res,400,{error:"克隆失败（slug 可能重复）："+e.message}); }
});

route("GET", /^\/api\/admin\/doctors\/(\d+)\/invite-link$/, (req,res,m)=>{
  const did = +m[1];
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无建档链接权限")) return;
  const link = inviteStore.ensureLink(did, { createdBy: s.username });
  json(res,200,{
    ok:true,
    url: inviteUrlForToken(req, link.token),
    token: link.token,
    expiresAt: link.expires_at || null,
    useCount: link.use_count || 0,
    note: link.note || null
  });
});
route("POST", /^\/api\/admin\/doctors\/(\d+)\/invite-link$/, async (req,res,m)=>{
  const did = +m[1];
  const s = gate(req,res,did); if(!s) return;
  if(!requireAdminAction(req,res,s,"patients.health.update",{doctorId:did},"无建档链接权限")) return;
  const b = await parseBody(req);
  const link = inviteStore.ensureLink(did, {
    note: b.note,
    expiresInDays: b.expiresInDays,
    maxUses: b.maxUses,
    rotate: b.rotate === true,
    createdBy: s.username
  });
  json(res,200,{
    ok:true,
    url: inviteUrlForToken(req, link.token),
    token: link.token,
    expiresAt: link.expires_at || null,
    useCount: link.use_count || 0,
    note: link.note || null,
    rotated: b.rotate === true
  });
});
}

module.exports = { registerDoctorsAdminRoutes };
