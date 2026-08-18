/* 全功能验证：患者端 API + 后台 API + 分诊人工闭环 + 安全加固 */
const BASE = process.env.TEST_BASE || "http://localhost:3000";
let n=0, fails=[]; const ok=(c,m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ "+m); } else console.log("  ✓ "+m); };
let COOKIE = "";
let IMAGE_SESSION_ID = null;
// 幂等：同一服务实例重复跑也不假失败——每次运行用唯一手机号后缀，避开 30s 短信限流与历史数据累积
const RID = (Date.now()%100000).toString().padStart(5,"0");
const P = base => "139" + String(base).padStart(3,"0") + RID;   // 合法 11 位手机号
const PH = { throttle:P(1), lock:P(4), reg:P(3), unreg:P(7), wait:P(44), agent:P(33), fu:P(21), manual:P(22), noverify:P(99), f1:P(55) };
const contactPayload = (name, phone, disease="胃息肉", extra={}) => ({
  姓名:name,
  性别:"男",
  出生日期:"1990-01-01",
  手机号:phone,
  主要疾病:disease,
  ...extra
});
const SHORT = {
  home:"#小程序://春雨医生/EhSc2V0ssa0h2hF",
  video:"#小程序://春雨医生/XKw5Nt8BiFBstaF",
  expert:"#小程序://春雨医生/ZlCwdzwnSMN7FAd",
  hospital:"#小程序://春雨医生/yNJLReN2nQ4EOzg",
  // 吕富靖医生主页真实 Short Link（甲方提供）：101 走真实主页短链（303 已于 2026-07-08 换成友谊医院详情页卡，见 lvFriendship303）
  lvDoctor:"#小程序://春雨医生/5ujZ4dqouQjf8Fh",
  // 303 挂号原生卡「新版」（甲方 2026-07-08 裁定·替换春雨主页卡）：北京友谊医院患者服务平台·吕富靖医生详情页卡标记短链（seed.js LV_CY.friendshipRegister）。
  lvFriendship303:"#小程序://友谊医院/吕富靖医生详情页/lv303detail",
  // ⚠ 已停用（甲方 2026-07-08 晚裁定·覆盖待办6）：102 视频问诊卡改「复用 101 医生主页卡」（SHORT.lvDoctor·5ujZ），本短链不再被 102 引用；保留供参考。
  lvBooking:"#小程序://春雨医生/S9bW6EQGDjO4HNg",
  // ⚠ 已停用（甲方 2026-07-08 晚裁定·覆盖待办6·替换不并存）：404 末卡改「复用 101 医生主页卡」（SHORT.lvDoctor·5ujZ），本短链不再被 404 引用；909 送心意仍走独立页面级真机卡短链。
  lvClinicBooking:"#小程序://春雨医生/出诊时间地点/MCGKlVkiNDBumbz",
  lvSendHeart:"#小程序://春雨医生/送心意/pbycpPEVVipdyff",
  // 808 医生风采 h5_webview 小程序卡（2026-07-06 真机采集，独立于 101 医生主页卡）。
  lvProfileWebview:"#小程序://春雨医生/lv808webview2515",
  // 105（旧202·2026-07-09 编号迁移）查看回复真实短链（甲方 2026-07-02 采集，页面=春雨医生·我的全部服务/我的订单，seed.js CY.replies）：替换此前的主界面兜底短链 home
  myOrders:"#小程序://春雨医生/PuW00A6zBsHAw9y"
};
async function api(method, path, body, opts){
  opts=opts||{};
  const h={}; if(body!==undefined) h["Content-Type"]="application/json"; if(opts.cookie) h.Cookie=opts.cookie;
  if(opts.headers) Object.assign(h, opts.headers);
  const r = await fetch(BASE+path, { method, headers:h, body: body!==undefined?(typeof body==="string"?body:JSON.stringify(body)):undefined });
  let j=null; try{ j=await r.json(); }catch(e){}
  return { status:r.status, j, headers:r.headers };
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  console.log("== A. 患者端 bootstrap / 内容 ==");
  let b = await api("GET","/api/bootstrap");
  ok(b.status===200 && b.j.doctor.name==="吕富靖", "bootstrap 默认医生=吕富靖（唯一 active 上线医生）");
  const C=b.j.content;
  ["doctorProfile","doctorVideo","contactForm","addNumber","admission","clinicArticle","dietArticle","copyArticle","consult","story"].forEach(k=>ok(C[k],"content 含 "+k));
  ok(Array.isArray(C.followupPlans) && C.followupPlans.length>=1 && Array.isArray(C.followupPlans[0].nodes), "content 含 followupPlans（随访方案库，带节点）");
  ok(Array.isArray(C.servicePackages) && C.servicePackages.length>=1 && Array.isArray(C.servicePackages[0].items), "content 含 servicePackages（按病种服务包）");
  ok(Array.isArray(C.certifications) && C.certifications.length>=1, "content 含 certifications（统一认证徽标数据）");
  ok(C.chunyuIntegration && C.chunyuIntegration.defaultMiniProgram && C.chunyuIntegration.defaultMiniProgram.appId==="wx214b7e2bcde837d6", "content 含春雨开放平台/小程序跳转配置");
  ok(C.chunyuIntegration.defaultMiniProgram.shortLink===SHORT.home && C.chunyuIntegration.knownShortLinks && C.chunyuIntegration.knownShortLinks.video && C.chunyuIntegration.knownShortLinks.video.shortLink===SHORT.video && C.chunyuIntegration.knownShortLinks.lvDoctor && C.chunyuIntegration.knownShortLinks.lvDoctor.shortLink===SHORT.lvDoctor, "content 含已采集春雨小程序真实短链清单（含吕富靖医生主页真实短链）");
  ok(!C.chunyuIntegration.knownShortLinks.findDoctor && (!C.communityFaq || !C.communityFaq.sections.some(s=>(s.items||[]).some(it=>String(it).indexOf("特病")>=0))), "找医生短链/特病 FAQ 残留已彻底移除（505转诊/313特病 收口）");
  ok(Array.isArray(b.j.faq)&&b.j.faq.length>0, "FAQ 分组非空");
  ok(b.j.doctor.accounts&&b.j.doctor.accounts.length>0, "科普账号非空");
  ok(b.j.doctors.length>=2, "多医生列表 ≥2");
  const guo = await api("GET","/api/bootstrap?doctor=guo");
  ok(guo.status===200 && guo.j.doctor.name==="郭强", "bootstrap?doctor=guo=郭强");

  console.log("\n== B. 在线咨询 / AI 分诊（真实 MiMo） ==");
  let m1 = await api("POST","/api/message",{doctorId:1,text:"最近胃胀打嗝两天",patientKey:"ft-hello"});
  // 自动发闸门收口后：低风险且无知识库依据 → 患者侧走确定性安全模板（不再依赖 live 模型）。
  // 模型回复 / RAG 三档 / 意图编号映射的正确性已下沉到 _unittest 确定性单测，不耦合模型计时。
  ok(m1.status===200 && m1.j.triage.riskLevel==="low", "轻症胃胀打嗝 → 低风险");
  ok(m1.j.triage.urgency && m1.j.triage.urgency.tier==="routine", "轻症胃胀打嗝 → 紧急度=居家观察（routine）");
  // 选「平时生活上要注意些什么」：不含任何关键词/意图规则触发词（如 饮食/复印/挂号/加号/住院/数字码），
  // 故必落到 AI 分诊（实测 source=ai_triage、返回 triage、risk=low、回复为低风险确定性安全模板），用以验证科普问句进分诊带 triage。
  let m2 = await api("POST","/api/message",{doctorId:1,text:"饭后有点反酸嗳气，持续一两天",patientKey:"ft-edu"});
  // 加判空：万一某断言所需字段缺失，只记 ✗、不抛异常拖垮整套（其余断言保持原意图不削）。
  ok(m2.status===200 && m2.j && m2.j.triage && m2.j.triage.riskLevel==="low" && m2.j.responses?.[0]?.text?.length>10, "低风险科普 → AI 回复");
  let m3 = await api("POST","/api/message",{doctorId:1,text:"我右上腹剧烈疼痛还发高烧",patientKey:"ft-high"});
  ok(m3.j.triage.riskLevel==="high" && m3.j.triage.needsHuman===true && m3.j.triage.canAutoSend===true && m3.j.responses.some(r=>r.type==="mp"), "红旗症状 → high + 转人工 + 自动发安全话术+101问诊入口卡（三档新政策 2026-07-02）");
  ok(m3.j.triage.urgency && (m3.j.triage.urgency.tier==="urgent"||m3.j.triage.urgency.tier==="emergency") && !!m3.j.triage.urgency.timeframe, "红旗症状 → 紧急度=当天/急诊（含就诊时间窗）");
  ok(Array.isArray(m3.j.triage.actions) && m3.j.triage.actions.some(a=>a.key==="human"), "红旗症状 → 返回行动入口（含转人工）");
  let mEmg = await api("POST","/api/message",{doctorId:1,text:"我胸痛还呼吸困难",patientKey:"ft-emg"});
  ok(mEmg.j.triage.urgency && mEmg.j.triage.urgency.tier==="emergency" && mEmg.j.triage.actions.some(a=>a.key==="120"), "胸痛/呼吸困难 → 紧急度=急诊 + 行动入口含拨120");
  let m4 = await api("POST","/api/message",{doctorId:1,text:"我要不要做手术",patientKey:"ft-mid"});
  ok(m4.j.triage.riskLevel==="medium" && m4.j.triage.needsHuman===true, "手术决策 → medium + 转人工");
  ok(m4.j.triage.urgency && m4.j.triage.urgency.tier==="soon", "手术决策 → 紧急度=3天内门诊（soon）");
  ok(m4.j.triage.actions.some(a=>a.key==="adm"||a.key==="add"), "手术决策 → 行动入口含住院预约/门诊加号");
  // RAG 三档正确性已移至 _unittest（retrieveKnowledge 纯函数 + normalizeDecision 闸门），不在 HTTP 层耦合 live 模型计时。
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  let mi = await api("POST","/api/message",{doctorId:1,text:"",patientKey:"ft-image",attachments:[{type:"image",name:"检查报告.png",mime:"image/png",dataUrl:tinyPng}]});
  IMAGE_SESSION_ID = mi.j && mi.j.sessionId;
  ok(mi.status===200 && mi.j.triage.riskLevel==="medium" && mi.j.triage.needsHuman===true && mi.j.triage.canAutoSend===false, "只上传图片/报告 → medium + 转人工 + 不自动发");
  ok(Array.isArray(mi.j.triage.attachments) && mi.j.triage.attachments.length===1, "图片/报告 → 返回附件元数据");
  let mc = await api("POST","/api/message",{doctorId:1,text:"101",patientKey:"ft-code"});
  ok(mc.status===200 && mc.j.responses.some(r=>r.type==="qr"), "功能码 101 → 规则引擎返回二维码卡");
  ok(mc.j.responses.some(r=>r.external && /医生主页/.test(r.external.service||"")), "功能码 101 → 返回吕富靖医生主页/线下二维码跳转元数据");
  const graphExt = (mc.j.responses.find(r=>r.external && /医生主页/.test(r.external.service||"")) || {}).external || {};
  ok(graphExt.shortLink===SHORT.lvDoctor && graphExt.status==="short_link_ready" && /线下二维码/.test(graphExt.note||""), "功能码 101 → 接入吕富靖医生主页真实 Short Link（复制到微信内打开），同时保留线下二维码");
  let mv = await api("POST","/api/message",{doctorId:1,text:"102",patientKey:"ft-video"});
  const videoExt = (mv.j.responses.find(r=>r.external && r.external.appId==="wx214b7e2bcde837d6") || {}).external || {};
  ok(mv.status===200 && (videoExt.requires||[]).some(x=>/URL Link|URL Scheme|gh_xxx|JS-SDK/.test(x)), "功能码 102 → 返回真实小程序跳转缺口（URL Link/Scheme 或 gh_xxx + JS-SDK）");
  ok(videoExt.shortLink===SHORT.lvDoctor && videoExt.status==="short_link_ready" && /预约就诊|视频问诊|医生主页/.test(videoExt.shortLinkScope||"") && /不冒充视频问诊页面级直达/.test(videoExt.note||""), "功能码 102 → 复用 101 医生主页真实 Short Link（甲方 2026-07-08 晚裁定·覆盖待办6·视频问诊入口在主页内，不冒充页面级直达）");
  const wxCfg = await api("GET","/api/wechat/js-config?url="+encodeURIComponent(BASE+"/"));
  ok(wxCfg.status===501 && wxCfg.j.configured===false && /WECHAT_OA/.test(wxCfg.j.error||""), "微信 JS-SDK 签名未配置 → 501 明确失败（不假装可跳）");
  let mrp = await api("POST","/api/message",{doctorId:1,text:"105",patientKey:"ft-replies"});
  ok(mrp.status===200 && mrp.j.responses.some(r=>r.external && /查看回复|提问历史/.test((r.external.note||"")+(r.external.service||""))), "功能码 105（旧202·2026-07-09 编号迁移）→ 返回春雨查看回复/H5/API 跳转元数据");
  const repliesExt = (mrp.j.responses.find(r=>r.external && /查看回复|提问历史/.test((r.external.note||"")+(r.external.service||""))) || {}).external || {};
  ok(repliesExt.shortLink===SHORT.myOrders && repliesExt.status==="fallback_short_link" && /我的订单/.test(repliesExt.shortLinkScope||""), "功能码 105 → 集成真实「我的全部服务/我的订单」页短链做文本承接，但原生卡候选 gated（status=fallback_short_link，真实短链已集成、旧 pages/index 原生卡不误发）");
  let madd = await api("POST","/api/message",{doctorId:1,text:"301",patientKey:"ft-add"});
  ok(madd.status===200 && madd.j.responses.some(r=>r.external && /预约就诊/.test(r.external.service||"")), "功能码 301（旧404·2026-07-09 编号迁移）→ 返回吕富靖预约就诊元数据");
  const addExt = (madd.j.responses.find(r=>r.external && /预约就诊/.test(r.external.service||"")) || {}).external || {};
  ok(addExt.shortLink===SHORT.lvDoctor && addExt.status==="short_link_ready" && /预约就诊|视频问诊|医生主页/.test(addExt.shortLinkScope||""), "功能码 301 → 复用 101 医生主页真实 Short Link（甲方 2026-07-08 晚裁定·覆盖待办6·替换旧出诊时间地点卡；门控前三条先建档不变）");
  let madm = await api("POST","/api/message",{doctorId:1,text:"302",patientKey:"ft-admission"});
  const admR = (madm.j && madm.j.responses) || [];
  ok(madm.status===200
    && admR.some(r=>r.page==="admission" && r.ctaLabel==="填写住院预约问卷")
    && admR.some(r=>r.external && /chunyuyisheng\.com\/rec/.test((r.external&&r.external.url)||"")),
    "功能码 302（旧414·2026-07-09 编号迁移）→ 住院预约问卷（春雨 H5：page=admission + 填写住院预约问卷 + chunyuyisheng.com/rec 外链）");
  let mhosp = await api("POST","/api/message",{doctorId:1,text:"201",patientKey:"ft-hospital"});
  const hospExt = (mhosp.j.responses.find(r=>r.external && /医生详情|门诊时间/.test(r.external.service||"")) || {}).external || {};
  ok(hospExt.shortLink===SHORT.lvFriendship303 && hospExt.appId==="wxbc8c84999432ac95" && hospExt.status==="short_link_ready" && /北京友谊医院患者服务平台|医生详情/.test(hospExt.shortLinkScope||""), "功能码 201（旧303·2026-07-09 编号迁移）→ 北京友谊医院患者服务平台·吕富靖医生详情页原生小程序卡（甲方 2026-07-08 替换春雨主页卡；挂号时间地点见话术）");
  let mdoc = await api("POST","/api/message",{doctorId:1,text:"808",patientKey:"ft-doctor"});
  const docExt = (mdoc.j.responses.find(r=>r.external && /医生风采|春雨活动页/.test(r.external.service||"")) || {}).external || {};
  ok(docExt.shortLink===SHORT.lvProfileWebview && docExt.status==="short_link_ready" && /h5_webview|医生风采/.test(docExt.shortLinkScope||""), "功能码 808 → 接入吕富靖医生风采 h5_webview 小程序卡真实 Short Link");
  let mthanks = await api("POST","/api/message",{doctorId:1,text:"909",patientKey:"ft-thanks"});
  const thanksExt = (mthanks.j.responses.find(r=>r.external && /送心意/.test((r.external.service||"")+(r.external.note||""))) || {}).external || {};
  ok(mthanks.status===200 && thanksExt.shortLink===SHORT.lvSendHeart && thanksExt.status==="short_link_ready" && /送心意/.test(thanksExt.shortLinkScope||""), "功能码 909 → 接入吕富靖送心意页面级真实 Short Link（原生卡片直达）");
  ok((await api("POST","/api/message",{doctorId:999999,text:"x"})).status===404, "无效 doctorId → 404");
  ok((await api("POST","/api/message",{doctorId:1,text:""})).status===400, "空消息 → 400");

  console.log("\n== C. 短信验证码 + 安全加固 ==");
  ok((await api("POST","/api/sms/send",{phone:"139"})).status===400, "非法手机号 → 400");
  const r1 = await api("POST","/api/sms/send",{phone:PH.throttle});
  ok(r1.status===200 && r1.j.code, "发送验证码成功（演示返回 code）");
  ok((await api("POST","/api/sms/send",{phone:PH.throttle})).status===429, "30s 内重复发送 → 429（限流）");
  // 错误验证码递增锁定
  await api("POST","/api/sms/send",{phone:PH.lock});
  let wrongLast="";
  for(let i=0;i<5;i++){ const w=await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:PH.lock,code:"000000",consent:true,payload:contactPayload("x",PH.lock)}); wrongLast=w.j&&w.j.error||""; }
  ok(wrongLast.includes("次数过多"), "验证码连续错误 → 锁定（防爆破）");
  // 超大请求体（>1MB）被拒
  const big = JSON.stringify({doctorId:1,type:"x",payload:{a:"y".repeat(1100000)}});
  const bigR = await api("POST","/api/submit", big);
  ok(bigR.status===413, "超大请求体 → 413 被拦（body 上限，显式契约）");

  console.log("\n== D. 表单提交（真持久化 + 合规校验） ==");
  ok((await api("POST","/api/submit",{doctorId:1,type:"联络表",payload:{},phone:PH.reg})).status===400, "联络表无验证码 → 400");
  const codeR = await api("POST","/api/sms/send",{phone:PH.reg});
  ok((await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:PH.reg,code:codeR.j.code,consent:false,payload:{姓名:"赵六"}})).status===400, "联络表未单独同意 → 400");
  const cf = await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:PH.reg,code:codeR.j.code,consent:true,payload:contactPayload("全测赵六",PH.reg)});
  ok(cf.status===200 && cf.j.ok, "联络表（验证码+同意）→ 提交成功");

  // D1b. F1：联络表本人短信验证 → 实时身份收敛（phone_verified=1 + submission.patient_id 实时写入，无需重启）
  // 仅 localhost 直读 data.db 验证（远程 BASE 无法直读 → 跳过）
  if(/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)){
    try{
      const { DatabaseSync } = require("node:sqlite");
      const path = require("path");
      const dbf = process.env.DB_PATH || path.join(__dirname, "data.db");
      const f1p = PH.f1;
      const f1c1 = await api("POST","/api/sms/send",{phone:f1p});
      const f1s1 = await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:f1p,code:f1c1.j.code,consent:true,payload:contactPayload("F1甲",f1p,"测试")});
      ok(f1s1.status===200 && f1s1.j.ok, "F1：联络表（本人短信验证）→ 提交成功");
      const rdb = new DatabaseSync(dbf);   // 独立只读取连接（仅 SELECT，不触发 db.js 迁移/种子）
      const sub1 = rdb.prepare("SELECT patient_id FROM submissions WHERE id=?").get(f1s1.j.id);
      ok(sub1 && sub1.patient_id, "F1：联络表 submission 实时写入 patient_id（无需重启）");
      const pat1 = (sub1 && sub1.patient_id) ? rdb.prepare("SELECT phone_verified v FROM patients WHERE id=?").get(sub1.patient_id) : null;
      ok(pat1 && pat1.v === 1, "F1：本人短信验证 → 该患者 phone_verified=1（实时置位）");
      // 同号本人再次验证提交 → 收敛到同一 patient_id（externalId=phone:X 确定性 + 已验证手机号合并）
      const f1c2 = await api("POST","/api/sms/send",{phone:f1p});
      const f1s2 = await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:f1p,code:f1c2.j.code,consent:true,payload:contactPayload("F1甲",f1p,"复诊")});
      const sub2 = rdb.prepare("SELECT patient_id FROM submissions WHERE id=?").get(f1s2.j.id);
      ok(sub2 && sub1 && sub2.patient_id === sub1.patient_id, "F1：同号本人再次验证 → 收敛到同一 patient_id（不新建重复档）");
      rdb.close();
    }catch(e){ ok(false, "F1 实时收敛验证异常："+e.message); }
  } else {
    console.log("  (跳过 F1 DB 断言：非 localhost BASE，无法直读 data.db)");
  }
  // 加号停诊校验
  const slots=(C.addNumber&&C.addNumber.unavailableSlots)||[];
  const wlSlot = slots[0] || "停诊时段（演示占位 · 真实出诊/停诊时间待甲方补全）";
  // 合法出诊档白名单（date 字段 options）：取一个「非停诊」的合法档用于加号成功断言（适配 seed 变更，不写死时段名）
  const dateOpts=(((C.addNumber||{}).fields||[]).find(f=>f&&f.key==="date")||{}).options||[];
  const goodSlot=dateOpts.find(s=>!slots.includes(s))||dateOpts[0]||"就诊日（演示占位 · 出诊时间待补全）";
  if(slots.length){ const blk=await api("POST","/api/submit",{doctorId:1,type:"加号",date:slots[0],payload:{期望就诊日:slots[0]}}); ok(blk.status===409 && blk.j.waitlistable===true && blk.j.slot===slots[0], "加号停诊时段 → 409 + 可候补(waitlistable)"); }
  else { console.log("  (跳过加号停诊：未配置 unavailableSlots)"); }
  // 智能候补名单：患者加入
  ok((await api("POST","/api/waitlist",{doctorId:1,slot:wlSlot,name:"候补测",phone:PH.wait})).status===400, "候补加入无同意 → 400");
  ok((await api("POST","/api/waitlist",{doctorId:1,slot:wlSlot,name:"候补测",phone:PH.wait,consent:true})).status===200, "加入候补名单 → 成功");
  ok((await api("POST","/api/waitlist",{doctorId:1,slot:wlSlot,name:"候补测",phone:PH.wait,consent:true})).j.already===true, "重复加入同时段 → 去重（already）");
  ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:goodSlot,payload:{姓名:"无同意测",手机号:PH.reg,期望就诊日:goodSlot}})).status===400, "加号无单独同意 → 400（价值动作即时同意）");
  const noContactAdd = await api("POST","/api/submit",{doctorId:1,type:"加号",date:goodSlot,consent:true,payload:{姓名:"未建档加号",手机号:PH.noverify,期望就诊日:goodSlot}});
  ok(noContactAdd.status===400 && noContactAdd.j && noContactAdd.j.needsContactForm===true, "加号未先提交医患联络表 → 400 + needsContactForm（先建档再加号）");
  ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:goodSlot,consent:true,payload:{姓名:"加号测",手机号:PH.reg,期望就诊日:goodSlot}})).status===200, "加号（已填联络表+合法档+单独同意）→ 成功");
  ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:goodSlot,consent:true,payload:{姓名:"老人甲",手机号:PH.reg,期望就诊日:goodSlot,办理身份:"家人代办",代办人姓名:"子女乙",代办人手机:PH.agent,与患者关系:"子女"}})).status===200, "家庭代办加号（已填联络表+子女代老人）→ 成功");
  // 后端白名单收紧（既存待办：原仅黑名单 includes，可绕候补 409 提无效加号）
  if(dateOpts.length){
    ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:"随便填的非法时段ZZZ",consent:true,payload:{姓名:"非法时段测",期望就诊日:"随便填的非法时段ZZZ"}})).status===400, "加号非法时段（不在出诊档白名单）→ 400（服务端白名单收紧）");
    ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:"",consent:true,payload:{姓名:"空档测"}})).status===400, "加号空就诊日（配 options 的医生）→ 400（白名单兜住空 slot，等价 required）");
    ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:"   ",consent:true,payload:{姓名:"全空白档测",期望就诊日:"   "}})).status===400, "加号全空白就诊日 → trim 后空 → 400（白名单兜住）");
    const variant=String(slots[0]||"").replace(/\s/g,"");   // 停诊档去空格变体：原可绕 409 静默写入，现应被白名单兜住
    if(slots.length && variant!==slots[0] && !dateOpts.includes(variant)){
      ok((await api("POST","/api/submit",{doctorId:1,type:"加号",date:variant,consent:true,payload:{姓名:"变体测",期望就诊日:variant}})).status===400, "加号停诊档去空格变体（绕候补尝试）→ 400（白名单兜住，不再静默写入）");
    }
  }
  ok((await api("POST","/api/submit",{doctorId:1,type:"住院预约",consent:true,payload:{姓名:"住院测"}})).status===200, "住院预约（单独同意）→ 成功");
  ok((await api("POST","/api/submit",{doctorId:1,type:"住院预约",payload:{姓名:"住院无同意"}})).status===400, "住院无单独同意 → 400");
  ok((await api("POST","/api/submit",{doctorId:1,type:"转诊",payload:{需求:"对接"}})).status===400, "转诊提交类型已下线 → 400 拒绝（SUBMIT_TYPES 收紧）");
  ok((await api("POST","/api/submit",{doctorId:1,type:"story",payload:{name:"小测",text:"康复经历XSS<b>x</b>"}})).status===200, "患者感谢信提交 → 成功");
  const st = await api("GET","/api/stories?doctorId=1");
  ok(st.status===200 && st.j.some(x=>x.name==="小测"), "感谢信读取到刚发的感谢信");
  ok((await api("POST","/api/submit",{doctorId:1})).status===400, "缺 type → 400");

  console.log("\n== D2. 建档患者认证口碑墙（建档+本人手机双重门控） ==");
  // 未建档手机：建档校验拦截（先过短信验证再查建档→403）
  const unreg = PH.unreg;
  const unregCode = await api("POST","/api/sms/send",{phone:unreg});
  const tNoReg = await api("POST","/api/testimonial",{doctorId:1,phone:unreg,code:unregCode.j.code,text:"吕主任医术高超，恢复很好，非常感谢！"});
  ok(tNoReg.status===403 && /建档/.test(tNoReg.j.error||""), "未建档手机写评价 → 403（仅建档患者可写）");
  // 已建档手机（前面 13900000003 全测赵六已建档，其验证码已在建档时消费）：验证码错误→400
  ok((await api("POST","/api/testimonial",{doctorId:1,phone:PH.reg,code:"000000",text:"恢复得很好，很感谢医生团队的帮助。"})).status===400, "口碑：验证码错误 → 400");
  // 取一次码：短文 400 在 verifySms 之前返回、不消费该码，故下面成功用例可复用同一码（也避开 30s 重发限流）
  const okCode1 = await api("POST","/api/sms/send",{phone:PH.reg});
  ok((await api("POST","/api/testimonial",{doctorId:1,phone:PH.reg,code:okCode1.j.code,text:"很好"})).status===400, "口碑：文本过短 → 400");
  // 建档 + 本人手机验证 + 长文 → 成功（复用上面未被消费的验证码）
  const tOk = await api("POST","/api/testimonial",{doctorId:1,phone:PH.reg,code:okCode1.j.code,name:"赵六",text:"在吕主任团队这里建档随访，沟通耐心，术后恢复顺利，很感谢。"});
  ok(tOk.status===200 && tOk.j.ok, "建档患者（手机验证+长文）→ 认证评价发布成功");
  ok(/\*/.test(tOk.j.name||""), "口碑：公开署名已脱敏");
  const tl = await api("GET","/api/testimonials?doctorId=1");
  ok(tl.status===200 && tl.j.some(x=>x.verified===true && /术后恢复顺利/.test(x.text)), "口碑墙公开读取到刚发布的认证评价（带已认证标记）");

  console.log("\n== D3. 随访自动化（建档即入组 + 患者时间轴） ==");
  const fuPhone = PH.fu;
  const fuDate = new Date(Date.now()-10*86400000).toISOString().slice(0,10);   // 起算回拨 10 天，制造到期节点
  const fuCode1 = await api("POST","/api/sms/send",{phone:fuPhone});
  const enr = await api("POST","/api/submit",{doctorId:1,type:"联络表",phone:fuPhone,code:fuCode1.j.code,consent:true,payload:contactPayload("随访测试",fuPhone,"胃息肉",{随访方案:"胃肠镜检查后随访",["检查/治疗日期"]:fuDate})});
  ok(enr.status===200 && enr.j.enrolledPlan==="胃肠镜检查后随访", "建档选随访方案 → 自动入组（返回 enrolledPlan）");
  const fuCode2 = await api("POST","/api/sms/send",{phone:fuPhone});
  const mine = await api("POST","/api/followup/mine",{doctorId:1,phone:fuPhone,code:fuCode2.j.code});
  ok(mine.status===200 && Array.isArray(mine.j.followups) && mine.j.followups.length>=1, "我的随访：手机验证后返回随访列表");
  const fu0 = mine.j.followups[0];
  ok(fu0 && fu0.nodes.length===4 && fu0.nodes.some(n=>n.state==="due"), "随访时间轴：节点齐全且按起算日出现到期节点");
  ok((await api("POST","/api/followup/mine",{doctorId:1,phone:fuPhone,code:"000000"})).status===400, "我的随访：验证码错误 → 400");
  ok((await api("POST","/api/followup/mine",{doctorId:1,phone:PH.noverify,code:"000000"})).status===400, "我的随访：未验证手机 → 400（不泄露随访）");

  console.log("\n== E. 后台鉴权 ==");
  ok((await api("POST","/api/admin/login",{username:"admin",password:"wrong"})).status===401, "错误密码 → 401");
  const login = await api("POST","/api/admin/login",{username:"admin",password:"admin888"});
  const loginSetCookie = login.headers.getSetCookie?login.headers.getSetCookie()[0]:login.headers.get("set-cookie");
  COOKIE = loginSetCookie.split(";")[0];
  ok(login.status===200, "正确密码 → 登录成功");
  ok(/HttpOnly/i.test(loginSetCookie) && /SameSite=Lax/i.test(loginSetCookie) && /Max-Age=\d+/i.test(loginSetCookie), "登录 cookie 带 HttpOnly/SameSite/Max-Age");
  ok((await api("GET","/api/admin/me",undefined,{cookie:COOKIE})).status===200, "带 cookie /me → 200");
  ok((await api("GET","/api/admin/rules?doctorId=1")).status===401, "无 cookie 访问后台 → 401");
  let limitedLogin = false;
  for(let i=0;i<6;i++){
    const r = await api("POST","/api/admin/login",{username:"nosuch"+RID,password:"bad"});
    if(r.status===429) limitedLogin = true;
  }
  ok(limitedLogin, "连续错误登录触发限流 → 429");
  // 洞2 回归（2026-07-09 安全洞修）：X-Forwarded-For 最左段客户端可自报伪造，clientIp 已改只信直连对端——
  // 每次换伪造 XFF 仍必须落同一限流桶：第 6 次登录必 429。用唯一坏用户名，绝不锁真实 admin。
  let xffLast = 0;
  for(let i=0;i<6;i++){
    const r = await api("POST","/api/admin/login",{username:"xffbad"+RID,password:"bad"},{headers:{"X-Forwarded-For":(i+1)+"."+(i+1)+"."+(i+1)+"."+(i+1)}});
    xffLast = r.status;
  }
  ok(xffLast===429, "换伪造 X-Forwarded-For 连续错登不再绕过限流 → 第 6 次 429（洞2 回归）");
  ok((await api("POST","/api/admin/rules",{doctorId:1,code:"evil-origin",aliases:[],match:"exact",bot:"小宝医助",responses:[]},{cookie:COOKIE,headers:{Origin:"https://evil.example"}})).status===403, "恶意 Origin 后台写接口 → 403");
  ok((await api("POST","/api/admin/rules",{doctorId:1,code:"null-origin",aliases:[],match:"exact",bot:"小宝医助",responses:[]},{cookie:COOKIE,headers:{Origin:"null"}})).status===403, "无效 Origin 后台写接口 → 403");

  console.log("\n== F. 后台：规则 / FAQ / 提交 / 统计 ==");
  const rules0 = await api("GET","/api/admin/rules?doctorId=1",undefined,{cookie:COOKIE});
  ok(rules0.status===200 && rules0.j.length>0, "规则列表");
  const nr = await api("POST","/api/admin/rules",{doctorId:1,code:"777",aliases:["测试码"],match:"exact",bot:"小宝医助",responses:[{type:"text",text:"后台新增规则 {patient} 你好"}]},{cookie:COOKIE});
  ok(nr.status===200, "新增规则 777");
  const hit = await api("POST","/api/message",{doctorId:1,text:"777",patientKey:"ft-777"});
  ok(hit.j.responses&&hit.j.responses[0].text.includes("后台新增规则"), "新规则即时生效（/api/message 命中 777）");
  ok((await api("PUT","/api/admin/rules/"+nr.j.id,{doctorId:1,code:"777",aliases:[],match:"exact",bot:"小宝医助",responses:[{type:"text",text:"改过了"}]},{cookie:COOKIE})).status===200, "改规则");
  ok((await api("DELETE","/api/admin/rules/"+nr.j.id,undefined,{cookie:COOKIE})).status===200, "删规则");
  const nf = await api("POST","/api/admin/faq",{doctorId:1,grp:"测试",q:"测试问题?",a:"测试答案",sort:9},{cookie:COOKIE});
  ok(nf.status===200, "新增 FAQ");
  ok((await api("PUT","/api/admin/faq/"+nf.j.id,{doctorId:1,grp:"测试",q:"改了?",a:"改了",sort:9},{cookie:COOKIE})).status===200, "改 FAQ");
  ok((await api("DELETE","/api/admin/faq/"+nf.j.id,undefined,{cookie:COOKIE})).status===200, "删 FAQ");
  const subs = await api("GET","/api/admin/submissions?doctorId=1&type="+encodeURIComponent("联络表"),undefined,{cookie:COOKIE});
  ok(subs.status===200 && subs.j.some(s=>s.payload["姓名"]==="全测赵六"), "提交记录可见刚建档患者");
  ok((await api("PUT","/api/admin/submissions/"+subs.j[0].id,{status:"已联系"},{cookie:COOKIE})).status===200, "更新提交状态");
  const addSubs = await api("GET","/api/admin/submissions?doctorId=1&type="+encodeURIComponent("加号"),undefined,{cookie:COOKIE});
  ok(addSubs.status===200 && addSubs.j.some(s=>s.payload["办理身份"]==="家人代办" && s.payload["代办人姓名"]), "提交记录含家庭代办字段（代办人/关系）");
  ok((await api("GET","/api/admin/waitlist?doctorId=1")).status===401, "候补名单无 cookie → 401");
  const wl = await api("GET","/api/admin/waitlist?doctorId=1",undefined,{cookie:COOKIE});
  ok(wl.status===200 && wl.j.some(w=>w.name==="候补测" && w.status==="waiting") && wl.j.every(w=>!String(w.tail).match(/\d{7}/)), "后台候补名单列出候补患者（仅尾号）");
  const rel = await api("POST","/api/admin/waitlist/release",{doctorId:1,slot:wlSlot},{cookie:COOKIE});
  ok(rel.status===200 && rel.j.notified>=1, "释放名额 → 批量通知候补（notified≥1）");
  ok((await api("GET","/api/admin/waitlist?doctorId=1",undefined,{cookie:COOKIE})).j.filter(w=>w.slot===wlSlot && w.status==="waiting").length===0, "释放后该时段无候补中（已全部通知）");
  const stats = await api("GET","/api/admin/stats?doctorId=1",undefined,{cookie:COOKIE});
  ok(stats.status===200 && stats.j.rules>0 && typeof stats.j.triageSessions==="number", "仪表盘统计");

  console.log("\n== F2. 后台：社群工作台 / 入站回调 / 出站队列 ==");
  ok((await api("GET","/api/admin/community?doctorId=1")).status===401, "社群工作台无 cookie → 401");
  const comm0 = await api("GET","/api/admin/community?doctorId=1",undefined,{cookie:COOKIE});
  ok(comm0.status===200 && comm0.j.groups.length>=1 && typeof comm0.j.summary.pendingOutbox==="number", "社群工作台总览：默认群 + 汇总数据");
  const g0 = comm0.j.groups[0];
  const joinEvt = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:g0.id,eventType:"member_join",senderName:"社群全测患者",externalUserId:"ft-community-user"},{cookie:COOKIE});
  ok(joinEvt.status===200 && joinEvt.j.message.processStatus==="welcome_queued" && joinEvt.j.outbox.status==="pending" && /^@社群全测患者/.test(joinEvt.j.outbox.text), "入群事件 → 欢迎语 @ 新进群成员并进入待发送队列");
  ok(Array.isArray(joinEvt.j.outboxes) && joinEvt.j.outboxes.some(o=>o.source==="faq_welcome" && /^@社群全测患者/.test(o.text) && /群友常见问题/.test(o.text)), "入群事件 → 同时 @ 新进群成员弹出群友常见问题卡");
  // 幂等修复（非 fresh 库重跑）：g0 是持久化的默认群，下面 272 行会把它的 reviewMode 切到 auto_keywords 且不会复位——
  // 若沿用上一轮残留的 auto_keywords，紧接着的"101"关键词命中会在 community.js handleInbound() 创建出站项时
  // 就直接写 status=sent/sentBy="system"（review_mode==='auto_keywords' 分支），而 setOutboxStatus() 对已 sent 的
  // 记录是幂等短路直接返回、不会把 sentBy 改成"admin"——导致下面"医助确认发送"断言只在 fresh 库首跑成立。
  // 这里显式把 reviewMode 复位为 human_review，保证 ruleEvt 出站项创建时必为 pending，使该断言与库初始态无关。
  const resetMode = await api("PUT","/api/admin/community/groups/"+g0.id,{doctorId:1,name:g0.name,channelType:g0.channelType,externalGroupId:g0.externalGroupId,owner:g0.owner,memberCount:g0.memberCount,status:g0.status,reviewMode:"human_review",welcomeEnabled:g0.welcomeEnabled,autoReplyEnabled:g0.autoReplyEnabled,welcomeText:g0.welcomeText,notes:g0.notes},{cookie:COOKIE});
  ok(resetMode.status===200 && resetMode.j.group.reviewMode==="human_review", "社群配置 → 复位人工审核模式（保证出站队列断言不依赖库初始态，可重复跑）");
  const ruleEvt = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:g0.id,eventType:"message",senderName:"社群全测患者",externalUserId:"ft-community-user",text:"101"},{cookie:COOKIE});
  ok(ruleEvt.status===200 && /rule/.test(ruleEvt.j.message.processStatus) && ruleEvt.j.outbox.text.length>0, "群消息 101 → 命中关键词规则并生成出站内容");
  const sent = await api("POST","/api/admin/community/outbox/"+ruleEvt.j.outbox.id+"/send",undefined,{cookie:COOKIE});
  ok(sent.status===200 && sent.j.outbox.status==="sent" && sent.j.outbox.sentBy==="admin", "出站队列 → 医助确认发送");
  const autoGroup = await api("PUT","/api/admin/community/groups/"+g0.id,{doctorId:1,name:g0.name,channelType:g0.channelType,externalGroupId:g0.externalGroupId,owner:g0.owner,memberCount:g0.memberCount,status:g0.status,reviewMode:"auto_keywords",welcomeEnabled:g0.welcomeEnabled,autoReplyEnabled:g0.autoReplyEnabled,welcomeText:g0.welcomeText,notes:g0.notes},{cookie:COOKIE});
  ok(autoGroup.status===200 && autoGroup.j.group.reviewMode==="auto_keywords", "社群配置 → 可开启关键词自动模式");
  const idleChat = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:g0.id,eventType:"message",senderName:"闲聊患者",externalUserId:"ft-community-idle"+RID,text:"哈哈我今天好多了"},{cookie:COOKIE});
  ok(idleChat.status===200 && idleChat.j.skipped==="group_chitchat" && idleChat.j.outbox===null && idleChat.j.message.processStatus==="group_chitchat",
    "群接管门控：auto_reply_enabled=1 时普通闲聊静默，不生成出站队列");
  const freeMedical = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:g0.id,eventType:"message",senderName:"社群全测患者",externalUserId:"ft-community-user",text:"肺结节10mm是否需要手术"},{cookie:COOKIE});
  ok(freeMedical.status===200 && freeMedical.j.outbox.status==="pending" && freeMedical.j.message.processStatus==="triage_pending_review", "群内自由病情问题 → 即使自动模式也只生成待审核 AI 草稿");
  // 意图编号映射依赖 live 模型，正确性见 _unittest（classifyIntent medical 闸门确定性）；此处只保留确定性的「病情→转人工」。
  const inMed = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:g0.id,eventType:"message",senderName:"意图测试",externalUserId:"ft-intent-m"+RID,text:"我这个报告是不是癌啊严重吗"},{cookie:COOKIE});
  ok(inMed.status===200 && inMed.j.message.processStatus==="triage_pending_review", "意图识别：病情/报告解读 → 即使自动模式也转人工（不乱答）");
  const weekly = await api("POST","/api/admin/community/campaigns/weekly",{doctorId:1,groupId:g0.id,topic:"不吸烟，为什么还会得肺癌？"},{cookie:COOKIE});
  ok(weekly.status===200 && weekly.j.outbox.source==="weekly_ops" && weekly.j.outbox.status==="pending" && /@所有人/.test(weekly.j.outbox.text) && /互动提问/.test(weekly.j.outbox.text), "周五群运营 → 生成待发送科普与互动题");
  // 公开回调入口为 fail-closed：缺 token 必拒（401），不进 handleInbound——红线：未配置 COMMUNITY_WEBHOOK_TOKEN 时也绝不裸奔。
  const noTok = await api("POST","/api/community/inbound",{doctorSlug:"lvfujing",channelType:"wecom",externalGroupId:"ft-public-group",eventType:"message",senderName:"无token患者",externalUserId:"ft-notoken-user",text:"你好"});
  ok(noTok.status===401, "公开回调入口缺 token → 401（fail-closed，绝不裸奔）");
  // 演示态(--demo)内置 token = demo-community-token；生产须显式配置 COMMUNITY_WEBHOOK_TOKEN（测试经 --demo 启动，与此一致）。
  const COMMUNITY_TOKEN = process.env.COMMUNITY_WEBHOOK_TOKEN || "demo-community-token";
  const publicRisk = await api("POST","/api/community/inbound",{doctorSlug:"lvfujing",channelType:"wecom",externalGroupId:"ft-public-group",groupName:"企微公开回调测试群",eventType:"message",senderName:"回调患者",externalUserId:"ft-public-user",text:"我胸痛还呼吸困难"},{headers:{"x-community-token":COMMUNITY_TOKEN}});
  ok(publicRisk.status===200 && publicRisk.j.message.riskLevel==="high" && publicRisk.j.outbox.status==="pending" && publicRisk.j.outbox.priority==="urgent", "公开回调入口（带 token）→ 高风险消息进入紧急待审核队列");
  const comm1 = await api("GET","/api/admin/community?doctorId=1",undefined,{cookie:COOKIE});
  ok(comm1.status===200 && comm1.j.messages.some(x=>x.senderName==="回调患者") && comm1.j.outbox.some(x=>x.priority==="urgent"), "社群工作台可见公开回调消息与紧急出站队列");
  // QiWe 回调 URL 令牌通道：qiweapi 推送不带任何鉴权头 → secret 走 URL（路径段/?t=）。
  // 断言自洽化（codex 复核指出的非确定性修复）：不再依赖「DB 未配 callback_secret + --demo 兜底 demo-qiwe-secret」这个初始态假设——
  // 若库已被污染（已存非空 callback_secret），旧写法的 200 断言会翻 403。改为先用已登录 admin 会话显式保存一个已知 callback_secret，
  // 服务端 loadConfig() 的 DB 行优先于 env/demo 兜底，此后无论库是 fresh 还是已污染都恒定一致，可重复跑。
  // 空 body {} → extractEvents 归一为 0 事件，只验鉴权闸门、不触发任何出站。
  const KNOWN_SECRET = "fulltest-qiwe-secret-abcdef123456";   // ≥16 位、仅 [A-Za-z0-9_-]，满足路径段正则 {16,128}
  const qiweCfgSave = await api("POST","/api/admin/qiwe/config",{callbackSecret:KNOWN_SECRET},{cookie:COOKIE});
  ok(qiweCfgSave.status===200 && qiweCfgSave.j.ok===true, "QiWe 配置：保存已知 callback_secret（供下方 URL 令牌断言自洽使用，不依赖库初始态）");
  const QIWE_SECRET = KNOWN_SECRET;
  ok((await api("POST","/api/qiwe/callback",{})).status===403, "qiwe 回调无 token 无鉴权头 → 403（fail-closed 不变）");
  const qiwePathTok = await api("POST","/api/qiwe/callback/"+QIWE_SECRET,{});
  ok(qiwePathTok.status===200 && qiwePathTok.j.ok===true, "qiwe 回调带路径令牌 /callback/<token> → 200（控制台探测 POST 可过闸存 URL）");
  const qiweQueryTok = await api("POST","/api/qiwe/callback?t="+QIWE_SECRET,{});
  ok(qiweQueryTok.status===200 && qiweQueryTok.j.ok===true, "qiwe 回调带查询令牌 ?t=<token> → 200");
  ok((await api("POST","/api/qiwe/callback/wrongtoken-16chars",{})).status===403, "qiwe 回调带错误路径令牌 → 403");

  console.log("\n== G. 后台：多医生管理 ==");
  const docs = await api("GET","/api/admin/doctors",undefined,{cookie:COOKIE});
  ok(docs.status===200 && docs.j.length>=2, "医生列表");
  const created = await api("POST","/api/admin/doctors",{slug:"fttest"+Date.now()%100000,name:"测试医生",dept:"测试科",hospital:"测试医院"},{cookie:COOKIE});
  ok(created.status===200, "新增医生");
  ok((await api("POST","/api/admin/doctors/"+created.j.id+"/activate",undefined,{cookie:COOKIE})).status===200, "切换上线医生");
  // 一键克隆：复制吕富靖整套底座到新医生
  const cloneSlug = "clone"+(Date.now()%100000);
  const srcRules = await api("GET","/api/admin/rules?doctorId=1",undefined,{cookie:COOKIE});
  const clone = await api("POST","/api/admin/doctors/1/clone",{slug:cloneSlug,name:"克隆医生"},{cookie:COOKIE});
  ok(clone.status===200 && clone.j.id && clone.j.clonedFrom==="吕富靖", "一键克隆医生 → 成功（含来源）");
  const cloneRules = await api("GET","/api/admin/rules?doctorId="+clone.j.id,undefined,{cookie:COOKIE});
  ok(cloneRules.status===200 && cloneRules.j.length===srcRules.j.length && cloneRules.j.length>0, "克隆带走全部关键词规则（条数一致）");
  const cboot = await api("GET","/api/bootstrap?doctor="+cloneSlug);
  ok(cboot.status===200 && cboot.j.doctor.name==="克隆医生" && Array.isArray(cboot.j.content.followupPlans) && cboot.j.content.followupPlans.length>=1 && cboot.j.faq.length>0, "克隆带走 content（随访方案库）+ FAQ");
  ok((await api("POST","/api/admin/doctors/1/clone",{slug:cloneSlug,name:"重复"},{cookie:COOKIE})).status===400, "克隆 slug 重复 → 400");
  // 还原：把吕富靖设回上线
  await api("POST","/api/admin/doctors/1/activate",undefined,{cookie:COOKIE});
  ok((await api("GET","/api/bootstrap")).j.doctor.name==="吕富靖","已还原默认上线=吕富靖");

  console.log("\n== H. 后台：AI 分诊台人工闭环 ==");
  const ts = await api("GET","/api/admin/triage/sessions?doctorId=1",undefined,{cookie:COOKIE});
  ok(ts.status===200 && ts.j.length>0, "分诊会话列表非空");
  const needHuman = ts.j.find(s=>s.status==="needs_human") || ts.j[0];
  const detail = await api("GET","/api/admin/triage/sessions/"+needHuman.id,undefined,{cookie:COOKIE});
  ok(detail.status===200 && detail.j.messages.length>0 && detail.j.decisions.length>0, "分诊会话详情（消息+判断）");
  const pend = detail.j.decisions.find(d=>d.status==="pending_human") || detail.j.decisions[0];
  const conf = await api("POST","/api/admin/triage/decisions/"+pend.id+"/confirm",{text:"医助确认：建议尽快线下面诊。"},{cookie:COOKIE});
  ok(conf.status===400 && /真实出站队列|未执行真实发送|AI 分诊台/.test(conf.j.error||""), "AI 分诊台确认发送必须绑定真实出站队列/真实发送条件，拒绝假发送落库");
  const afterReject = await api("GET","/api/admin/triage/sessions/"+needHuman.id,undefined,{cookie:COOKIE});
  ok(afterReject.j.decisions.find(d=>d.id===pend.id).status!=="confirmed_sent", "拒绝假发送后分诊决策不标 confirmed_sent");
  // 结构化六要素病历卡 + 紧急度（用一条全新会话验证最新代码沉淀的数据）
  const freshMsg = await api("POST","/api/message",{doctorId:1,text:"我要不要做手术切息肉，最近上腹隐痛三天",patientKey:"ft-intake"});
  const fdetail = await api("GET","/api/admin/triage/sessions/"+freshMsg.j.sessionId,undefined,{cookie:COOKIE});
  const fdec = fdetail.j.decisions[0];
  ok(fdec && fdec.structured_intake && typeof fdec.structured_intake==="object" && ("主诉" in fdec.structured_intake) && ("就诊诉求" in fdec.structured_intake), "分诊决策落库结构化六要素病历卡");
  ok(fdec && fdec.urgency && fdec.urgency.tier && Array.isArray(fdec.recommended_actions), "分诊决策落库紧急度分级 + 行动入口");
  const imageDetail = await api("GET","/api/admin/triage/sessions/"+IMAGE_SESSION_ID,undefined,{cookie:COOKIE});
  const imagePatient = imageDetail.j.messages.find(x=>x.role==="patient" && Array.isArray(x.attachments) && x.attachments.length);
  ok(imageDetail.status===200 && imagePatient && imagePatient.attachments[0].name==="检查报告.png", "分诊会话详情可见患者上传图片/报告");
  ok(imageDetail.j.decisions[0].structured_intake && /上传|图片|报告/.test(imageDetail.j.decisions[0].structured_intake["上传材料"]||""), "图片/报告写入结构化病历卡「上传材料」");
  ok((await api("POST","/api/admin/triage/sessions/"+needHuman.id+"/note",{text:"测试备注"},{cookie:COOKIE})).status===200, "分诊加备注");
  ok((await api("POST","/api/admin/triage/sessions/"+needHuman.id+"/status",{status:"closed"},{cookie:COOKIE})).status===200, "更新会话状态");

  console.log("\n== I. 后台随访队列 ==");
  ok((await api("GET","/api/admin/followups?doctorId=1")).status===401, "随访队列无 cookie → 401");
  const fq = await api("GET","/api/admin/followups?doctorId=1",undefined,{cookie:COOKIE});
  ok(fq.status===200 && fq.j.some(f=>f.patientName==="随访测试"), "随访队列列出入组患者");
  const fqOne = fq.j.find(f=>f.patientName==="随访测试") || fq.j[0];
  const fqd = await api("GET","/api/admin/followups/"+fqOne.id,undefined,{cookie:COOKIE});
  ok(fqd.status===200 && Array.isArray(fqd.j.nodes) && fqd.j.nodes.length>0, "随访详情含时间轴节点");
  const beforeDone = fqd.j.done;
  const marked = await api("POST","/api/admin/followups/"+fqOne.id+"/node",{idx:0,status:"done"},{cookie:COOKIE});
  ok(marked.status===200 && marked.j.done===beforeDone+1, "标记节点已完成 → 进度 +1");
  const plans = await api("GET","/api/admin/followup-plans?doctorId=1",undefined,{cookie:COOKIE});
  ok(plans.status===200 && plans.j.length>=1, "随访方案库（后台）非空");
  const manual = await api("POST","/api/admin/followups",{doctorId:1,name:"手动入组测",phone:PH.manual,planKey:"polyp"},{cookie:COOKIE});
  ok(manual.status===200 && manual.j.ok, "后台手动入组建档患者");

  console.log("\n== J. 多租户：scoped 子管理员越权拦截 ==");
  const scopedUser = "scoped"+RID;
  const mkScoped = await api("POST","/api/admin/admins",{username:scopedUser,password:"scoped888",role:"scoped",doctorIds:[1]},{cookie:COOKIE});
  ok(mkScoped.status===200 && mkScoped.j.ok, "超管创建 scoped 子管理员（仅辖医生 1）");
  const scLogin = await api("POST","/api/admin/login",{username:scopedUser,password:"scoped888"});
  const SC = (scLogin.headers.getSetCookie?scLogin.headers.getSetCookie()[0]:scLogin.headers.get("set-cookie")).split(";")[0];
  ok(scLogin.status===200, "scoped 子管理员登录成功");
  ok((await api("GET","/api/admin/community?doctorId=1",undefined,{cookie:SC})).status===200, "scoped 管理员访问被分配医生(1) → 200");
  ok((await api("GET","/api/admin/community?doctorId=2",undefined,{cookie:SC})).status===403, "scoped 管理员越权访问医生(2) → 403 拦截");
  ok((await api("GET","/api/admin/admins",undefined,{cookie:SC})).status===403, "scoped 管理员查看子管理员列表 → 403（仅超管）");
  ok((await api("POST","/api/admin/doctors",{slug:"scoped"+RID,name:"越权医生"},{cookie:SC})).status===403, "scoped 创建医生 → 403（仅超管）");
  ok((await api("POST","/api/admin/doctors/1/activate",undefined,{cookie:SC})).status===403, "scoped 切换上线医生 → 403（仅超管）");
  ok((await api("POST","/api/admin/doctors/1/clone",{slug:"scopedclone"+RID,name:"越权克隆"},{cookie:SC})).status===403, "scoped 克隆医生 → 403（仅超管）");
  ok((await api("POST","/api/admin/qiwe/preview-reply",{doctorId:1,text:"101",send:false},{cookie:SC})).status===200, "scoped QiWe preview send=false → 200（仅预览）");
  ok((await api("POST","/api/admin/qiwe/preview-reply",{doctorId:1,text:"101",send:true,toId:"attacker-target"},{cookie:SC})).status===403, "scoped QiWe preview send=true → 403（仅超管）");
  const scopedWeekly = await api("POST","/api/admin/community/campaigns/weekly",{doctorId:1,groupId:g0.id,topic:"scoped 能力矩阵测试 "+RID},{cookie:SC});
  ok(scopedWeekly.status===200 && scopedWeekly.j.outbox.status==="pending", "scoped 管理员可在授权医生内生成待审 outbox");
  const scopedSent = await api("POST","/api/admin/community/outbox/"+scopedWeekly.j.outbox.id+"/send",undefined,{cookie:SC});
  ok(scopedSent.status===200 && scopedSent.j.outbox.status==="sent" && scopedSent.j.outbox.sentBy===scopedUser, "scoped 管理员可在授权医生内确认发送 outbox");
  // 洞1 回归（2026-07-09 安全洞修·gate(NaN) 旁路）：省略 doctorId 时旧代码 +undefined=NaN 跳过归属校验，
  // community 内部 resolveDoctorId 回落 doctorSlug → scoped 只带他人 slug 即跨租户越权。修后服务端先解析医生 id 再 gate。
  // 注意：本 scoped 辖医生1=lvfujing，slug-only 合法归属应放行——越权断言须用辖外 slug（guo=禁用演示医生≠医生1）。
  ok((await api("POST","/api/admin/community/campaigns/ops-candidate",{doctorSlug:"guo"},{cookie:SC})).status===403, "scoped 只带辖外 doctorSlug 生成 ops-candidate → 403（gate(NaN) 旁路已堵·洞1 回归）");
  ok((await api("POST","/api/admin/community/campaigns/weekly",{doctorSlug:"guo",topic:"越权测试"+RID},{cookie:SC})).status===403, "scoped 只带辖外 doctorSlug 生成 weekly → 403（gate(NaN) 旁路已堵·洞1 回归）");
  const slugWeekly = await api("POST","/api/admin/community/campaigns/weekly",{doctorSlug:"lvfujing",groupId:g0.id,topic:"slug 归属放行 "+RID},{cookie:SC});
  ok(slugWeekly.status===200 && slugWeekly.j.outbox.status==="pending", "scoped 只带自辖医生 doctorSlug → 解析归属后放行（slug 合法路径不误伤）");
  // 洞1 同类回归（community/inbound·slug 回落跨租户注入）：scoped 只带辖外 slug（guo≠医生1）不带 doctorId → gate 归属先拦 403，不进 handleInbound。
  ok((await api("POST","/api/admin/community/inbound",{doctorSlug:"guo",eventType:"message",senderName:"越权注入",externalUserId:"ft-cross-inject"+RID,text:"你好"},{cookie:SC})).status===403, "scoped 只带辖外 doctorSlug 打 community/inbound → 403（跨租户注入已堵·洞1 同类回归）");
  const scopedCaps = await api("GET","/api/admin/me/capabilities?doctorId=1",undefined,{cookie:SC});
  ok(scopedCaps.status===200 && scopedCaps.j.effectiveRole==="assistant" && scopedCaps.j.actions["community.outbox.send"].allowed && scopedCaps.j.tabs.community.visible,
    "capabilities：旧 scoped 作为 assistant 过渡别名，保留社群审核入口");
  const defaultRoleUser = "defaultasst"+RID;
  const defaultRole = await api("POST","/api/admin/admins",{username:defaultRoleUser,password:"default888",doctorIds:[1]},{cookie:COOKIE});
  ok(defaultRole.status===200 && defaultRole.j.admin.role==="assistant", "超管新建账号省略 role → 默认 assistant，不再默认 scoped");
  const opsUser = "ops"+RID, assistantUser = "assistant"+RID, viewerUser = "viewer"+RID;
  ok((await api("POST","/api/admin/admins",{username:opsUser,password:"ops888",role:"ops_manager",doctorIds:[1]},{cookie:COOKIE})).status===200, "超管创建 ops_manager");
  ok((await api("POST","/api/admin/admins",{username:assistantUser,password:"assistant888",role:"assistant",doctorIds:[1]},{cookie:COOKIE})).status===200, "超管创建 assistant");
  ok((await api("POST","/api/admin/admins",{username:viewerUser,password:"viewer888",role:"viewer",doctorIds:[1]},{cookie:COOKIE})).status===200, "超管创建 viewer");
  const opsLogin = await api("POST","/api/admin/login",{username:opsUser,password:"ops888"});
  const assistantLogin = await api("POST","/api/admin/login",{username:assistantUser,password:"assistant888"});
  const viewerLogin = await api("POST","/api/admin/login",{username:viewerUser,password:"viewer888"});
  const OPS = (opsLogin.headers.getSetCookie?opsLogin.headers.getSetCookie()[0]:opsLogin.headers.get("set-cookie")).split(";")[0];
  const ASST = (assistantLogin.headers.getSetCookie?assistantLogin.headers.getSetCookie()[0]:assistantLogin.headers.get("set-cookie")).split(";")[0];
  const VIEW = (viewerLogin.headers.getSetCookie?viewerLogin.headers.getSetCookie()[0]:viewerLogin.headers.get("set-cookie")).split(";")[0];
  const opsCaps = await api("GET","/api/admin/me/capabilities?doctorId=1",undefined,{cookie:OPS});
  ok(opsCaps.status===200 && opsCaps.j.effectiveRole==="ops_manager" && opsCaps.j.actions["config.publish"].allowed && !opsCaps.j.actions["credential.manage"].allowed && !opsCaps.j.tabs.accounts.visible,
    "capabilities：ops_manager 可发布运营配置，但不能管账号/凭证");
  const assistantCaps = await api("GET","/api/admin/me/capabilities?doctorId=1",undefined,{cookie:ASST});
  ok(assistantCaps.status===200 && assistantCaps.j.effectiveRole==="assistant" && assistantCaps.j.actions["triage.confirm_send"].allowed && !assistantCaps.j.actions["config.draft"].allowed && !assistantCaps.j.tabs.config.visible,
    "capabilities：assistant 可处理分诊/社群，不显示运营配置");
  const viewerCaps = await api("GET","/api/admin/me/capabilities?doctorId=1",undefined,{cookie:VIEW});
  ok(viewerCaps.status===200 && viewerCaps.j.effectiveRole==="viewer" && viewerCaps.j.tabs.community.visible && viewerCaps.j.tabs.community.readOnly && !viewerCaps.j.actions["community.outbox.send"].allowed,
    "capabilities：viewer 可见工作台但关键写按钮只读禁用");
  const viewerDraft = await api("POST","/api/admin/community/campaigns/weekly",{doctorId:1,groupId:g0.id,topic:"viewer 403 测试 "+RID},{cookie:COOKIE});
  const viewerSend = await api("POST","/api/admin/community/outbox/"+viewerDraft.j.outbox.id+"/send",undefined,{cookie:VIEW});
  ok(viewerSend.status===403, "viewer 手动调出站确认发送 → 后端 403");
  const assistDraft = await api("POST","/api/admin/community/outbox/"+freeMedical.j.outbox.id+"/assist-draft",{instruction:"改得更适合群内发送"},{cookie:ASST});
  ok(assistDraft.status===200 && assistDraft.j.outbox.status==="pending" && assistDraft.j.outbox.sentAt==null,
    "assistant 可触发 outbox AI 改写草稿，仍保持 pending 不自动发送");
  ok((await api("POST","/api/admin/community/outbox/"+freeMedical.j.outbox.id+"/assist-draft",{instruction:"越权"},{cookie:VIEW})).status===403,
    "viewer 手动调 outbox AI 改写 → 后端 403");
  const opsKnowledge = await api("POST","/api/admin/knowledge",{doctorId:1,layer:"医生个人",mode:"现炒菜",title:"N5 运营候选素材 "+RID,body:"围绕胃肠镜复查提醒和报告资料上传注意事项，提醒群友个人病情需转医生判断。",source:"fulltest",owner:"ops",status:"ready"},{cookie:OPS});
  const opsCandidate = await api("POST","/api/admin/community/campaigns/ops-candidate",{doctorId:1,groupId:g0.id,topic:"N5 运营候选 "+RID},{cookie:OPS});
  ok(opsKnowledge.status===200 && opsCandidate.status===200 && opsCandidate.j.outbox.status==="pending" && opsCandidate.j.outbox.source==="ops_candidate" && opsCandidate.j.outbox.payload.reviewerRequired===true,
    "ops_manager 可基于 ready 知识源生成 pending 运营候选，不自动发送");
  ok((await api("POST","/api/admin/community/campaigns/ops-candidate",{doctorId:1,groupId:g0.id,topic:"assistant 越权"},{cookie:ASST})).status===403,
    "assistant 手动调运营候选生成 → 后端 403");

  console.log("\n== J2. gate(NaN) 中心化 fail-close（2026-07-10 P0 纵深加固）==");
  // 旧 gate 判据 `typeof doctorId==="number" && !Number.isNaN(doctorId)`：NaN（缺省/非数字 doctorId 经 +q./+b. 转换）
  // 短路整段归属校验、登录管理员被静默放行（下游 doctor 解析同源 → 查空/400 兜住，real-exploit=0，纯纪律债）。
  // 修后 gate 中心化 fail-close：判序 401→400(NaN)→403；undefined（仅登录）/null（延迟 404）语义严格不变。断言按 status，不锁 400 文案。
  ok((await api("GET","/api/admin/rules?doctorId=abc",undefined,{cookie:COOKIE})).status===400, "gate(NaN)：super 带非数字 doctorId 查规则 → 400（fail-close）");
  const rulesNoDid = await api("GET","/api/admin/rules",undefined,{cookie:COOKIE});
  ok(rulesNoDid.status===400, "gate(NaN)：super 完全省略 doctorId 查规则 → 400（旧现状 undefined 绑定 500 入错误边界，修后统一 400 非 500）");
  // 孤儿行封死：旧行为下 POST rules/faq 省略 doctorId 会把非整数 doctor_id（TEXT 型）写成孤儿行。仅 localhost 直读 data.db 断言（同 F1）。
  const canReadDb = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
  let orphanBefore = null, rdb2 = null;
  if(canReadDb){
    try{
      const { DatabaseSync } = require("node:sqlite");
      const path = require("path");
      rdb2 = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, "data.db"));   // 独立只读取连接（仅 SELECT）
      orphanBefore = {
        rules: rdb2.prepare("SELECT COUNT(*) c FROM rules WHERE typeof(doctor_id)!='integer'").get().c,
        faq:   rdb2.prepare("SELECT COUNT(*) c FROM faq WHERE typeof(doctor_id)!='integer'").get().c
      };
    }catch(e){ ok(false, "gate(NaN)：孤儿行基线读取异常："+e.message); }
  }
  ok((await api("POST","/api/admin/rules",{code:"gate-nan-rule"+RID,aliases:[],match:"exact",bot:"小宝医助",responses:[]},{cookie:COOKIE})).status===400, "gate(NaN)：POST 规则省略 doctorId → 400（不再静默写入）");
  ok((await api("POST","/api/admin/faq",{grp:"测试",q:"gate-nan-faq"+RID+"?",a:"x",sort:9},{cookie:COOKIE})).status===400, "gate(NaN)：POST FAQ 省略 doctorId → 400（不再静默写入）");
  if(canReadDb && rdb2 && orphanBefore){
    try{
      const orphanAfter = {
        rules: rdb2.prepare("SELECT COUNT(*) c FROM rules WHERE typeof(doctor_id)!='integer'").get().c,
        faq:   rdb2.prepare("SELECT COUNT(*) c FROM faq WHERE typeof(doctor_id)!='integer'").get().c
      };
      ok(orphanAfter.rules===orphanBefore.rules && orphanAfter.faq===orphanBefore.faq, "gate(NaN)：rules/faq 非整数 doctor_id 孤儿行前后计数相等（孤儿写入已封死）");
    }catch(e){ ok(false, "gate(NaN)：孤儿行复查异常："+e.message); }
    finally{ try{ rdb2.close(); }catch(e){} }
  } else {
    console.log("  (跳过孤儿行 DB 断言：非 localhost BASE，无法直读 data.db)");
  }
  ok((await api("GET","/api/admin/community?doctorId=abc",undefined,{cookie:SC})).status===400, "gate(NaN)：scoped 带非数字 doctorId 查社群 → 400（非 200-空亦非 403）");
  // 抽样覆盖三种下游形态：直绑（stats/waitlist）、模块函数（followups/followup-plans/triage/sessions）、isInteger 二道守卫（ops-strategy）。
  for(const p of ["stats","waitlist","followups","followup-plans","triage/sessions","ops-strategy"]){
    ok((await api("GET","/api/admin/"+p+"?doctorId=abc",undefined,{cookie:COOKIE})).status===400, "gate(NaN)：GET /api/admin/"+p+"?doctorId=abc → 400");
  }
  ok((await api("GET","/api/admin/rules?doctorId=abc")).status===401, "gate(NaN)：无 cookie 带非数字 doctorId → 401 优先（判序 401→400 不变）");
  ok((await api("GET","/api/admin/qiwe/config",undefined,{cookie:COOKIE})).status===200, "gate(undefined)：仅登录门端点（qiwe/config·super）→ 200（语义不变）");
  ok((await api("GET","/api/admin/followups/99999999",undefined,{cookie:COOKIE})).status===404, "gate(null)：rowDoctorId 未命中延迟 404（followups/:id）→ 404（语义不变）");
  const previewNoDid = await api("POST","/api/admin/qiwe/preview-reply",{text:"101",send:false},{cookie:COOKIE});
  ok(previewNoDid.status===200, "qiwe preview-reply 省略 doctorId → 回落 cfg/活跃医生合法整数，行为不变（200）");

  console.log("\n== K. 运营配置中心：草稿 / 预览 / 发布 / 回滚 / 权限 ==");
  ok((await api("GET","/api/admin/config-center?doctorId=1")).status===401, "运营配置中心无 cookie → 401");
  const cfg0 = await api("GET","/api/admin/config-center?doctorId=1",undefined,{cookie:COOKIE});
  ok(cfg0.status===200 && cfg0.j.domains.length>=5, "超管打开运营配置中心 → 含全部配置域");
  const scriptsCfg = cfg0.j.domains.find(x=>x.domain==="scripts");
  const safetyCfg = cfg0.j.domains.find(x=>x.domain==="safety");
  ok(!!scriptsCfg && !!safetyCfg && safetyCfg.doctorId===0, "配置中心含医生话术 + 全局安全等级");
  ok((await api("PUT","/api/admin/config-center/"+scriptsCfg.id+"/draft",{config:scriptsCfg.draft},{cookie:ASST})).status===403,
    "assistant 手动调配置草稿保存 → 后端 403");
  const opsCfg = await api("GET","/api/admin/config-center?doctorId=1",undefined,{cookie:OPS});
  const opsScripts = opsCfg.j.domains.find(x=>x.domain==="scripts");
  const opsSaveDraft = await api("PUT","/api/admin/config-center/"+opsScripts.id+"/draft",{config:opsScripts.draft},{cookie:OPS});
  const opsPreview = await api("POST","/api/admin/config-center/"+opsScripts.id+"/preview",{config:opsScripts.draft},{cookie:OPS});
  ok(opsCfg.status===200 && opsScripts && opsSaveDraft.status===200 && opsPreview.status===200 && !opsCfg.j.domains.some(x=>x.domain==="safety"),
    "ops_manager 可维护医生域运营配置，但不能看到全局安全域");
  ok(/为保护您的隐私/.test((scriptsCfg.published||{}).code101 || "") &&
    /请您选择合适的时间/.test((scriptsCfg.published||{}).code201 || "") &&
    /医患联络表/.test((scriptsCfg.published||{})["code联络表"] || ""),
    "吕富靖固定话术默认来自 docx：101/201（旧303）/医患联络表已配置");
  ok((scriptsCfg.published||{}).code616==="直接弹出链接" && (scriptsCfg.published||{}).code626==="直接弹出链接" && (scriptsCfg.published||{}).code808==="直接弹出链接",
    "616/626/808 固定引导语=「直接弹出链接」（甲方 2026-07-09 最新 docx：按固定患者话术读取、发送侧不需要 AI 发挥；旧「-」显式关闭口径作废）");
  const nextScripts = Object.assign({}, scriptsCfg.draft, {
    groupWelcome:"配置欢迎 {patient} 加入 {doctor} 医生健康群。",
    code101:"配置101：发送 101 获取医生咨询入口。",
    code201:"配置201：挂号与出诊时间请看医院通道。",
    transferHuman:"配置转人工：此类问题需要医助进一步确认。",
    nonText:"配置非文本：图片或文件请等待医助查看。",
    voice:"配置语音：请补充文字描述，医助会人工查看。"
  });
  const saveDraft = await api("PUT","/api/admin/config-center/"+scriptsCfg.id+"/draft",{config:nextScripts},{cookie:COOKIE});
  ok(saveDraft.status===200 && saveDraft.j.validation.ok, "配置中心保存草稿 → 校验通过");
  const preview = await api("POST","/api/admin/config-center/"+scriptsCfg.id+"/preview",{config:nextScripts},{cookie:COOKIE});
  ok(preview.status===200 && preview.j.ok && /可发布/.test(preview.j.testResult||""), "配置中心预览 → 返回影响范围和测试结果");
  const published = await api("POST","/api/admin/config-center/"+scriptsCfg.id+"/publish",{}, {cookie:COOKIE});
  ok(published.status===200 && published.j.ok && published.j.version>=2, "配置中心发布 → 版本号递增");
  const commK = await api("GET","/api/admin/community?doctorId=1",undefined,{cookie:COOKIE});
  const cfgGroup0 = commK.j.groups[0];
  const prepCfgGroup = await api("PUT","/api/admin/community/groups/"+cfgGroup0.id,{
    doctorId:1,name:cfgGroup0.name,channelType:cfgGroup0.channelType,externalGroupId:cfgGroup0.externalGroupId,
    owner:cfgGroup0.owner,memberCount:cfgGroup0.memberCount,status:cfgGroup0.status,reviewMode:"human_review",
    welcomeEnabled:true,autoReplyEnabled:true,welcomeText:cfgGroup0.welcomeText,notes:cfgGroup0.notes
  },{cookie:COOKIE});
  const cfgGroup = prepCfgGroup.j.group;
  const cfgJoin = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:cfgGroup.id,eventType:"member_join",senderName:"配置入群患者",externalUserId:"ft-cfg-join"+RID},{cookie:COOKIE});
  ok(cfgJoin.status===200 && /^@配置入群患者/.test(cfgJoin.j.outbox.text) && /配置欢迎 配置入群患者/.test(cfgJoin.j.outbox.text), "发布话术运行时生效：入群欢迎语读取配置并 @ 新进群成员");
  const cfg101 = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:cfgGroup.id,eventType:"message",senderName:"配置编号患者",externalUserId:"ft-cfg-code"+RID,text:"101"},{cookie:COOKIE});
  ok(cfg101.status===200 && /配置101/.test(cfg101.j.outbox.text), "发布话术运行时生效：101 编号引导读取配置");
  const cfgVoice = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:cfgGroup.id,eventType:"message",msgType:"voice",senderName:"配置语音患者",externalUserId:"ft-cfg-voice"+RID,text:""},{cookie:COOKIE});
  ok(cfgVoice.status===200 && /配置语音/.test(cfgVoice.j.outbox.text), "发布话术运行时生效：语音失败话术读取配置");
  const cfgHuman = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:cfgGroup.id,eventType:"message",senderName:"配置转人工患者",externalUserId:"ft-cfg-human"+RID,text:"肺结节10mm是否需要手术"},{cookie:COOKIE});
  ok(cfgHuman.status===200 && /配置转人工/.test(cfgHuman.j.outbox.text), "发布话术运行时生效：转人工草稿读取配置");
  const rulesForCfg = await api("GET","/api/admin/rules?doctorId=1",undefined,{cookie:COOKIE});
  if(rulesForCfg.j.some(r=>String(r.code)==="201")){
    const cfg201 = await api("POST","/api/admin/community/inbound",{doctorId:1,groupId:cfgGroup.id,eventType:"message",senderName:"配置挂号患者",externalUserId:"ft-cfg-201"+RID,text:"201"},{cookie:COOKIE});
    ok(cfg201.status===200 && /配置201/.test(cfg201.j.outbox.text), "发布话术运行时生效：201（旧303）挂号话术读取配置");
  }else{
    ok(true, "发布话术运行时生效：当前测试医生无 201 规则，跳过 201 断言");
  }
  const rolled = await api("POST","/api/admin/config-center/"+scriptsCfg.id+"/rollback",{}, {cookie:COOKIE});
  ok(rolled.status===200 && rolled.j.ok, "配置中心回滚 → 成功");
  const badSecretCfg = await api("PUT","/api/admin/config-center/"+scriptsCfg.id+"/draft",{config:{callbackSecret:"should-not-save"}},{cookie:COOKIE});
  ok(badSecretCfg.status===400, "配置中心拒绝保存 secret/token 类字段");
  const badSafety = await api("PUT","/api/admin/config-center/"+safetyCfg.id+"/draft",{config:{redFlags:[],humanTriggers:[],levels:{}}},{cookie:COOKIE});
  ok(badSafety.status===400, "安全等级空 redFlags/humanTriggers → 阻止发布前保存");
  const scopedCfg = await api("GET","/api/admin/config-center?doctorId=1",undefined,{cookie:SC});
  ok(scopedCfg.status===200 && scopedCfg.j.domains.some(x=>x.domain==="scripts") && !scopedCfg.j.domains.some(x=>x.domain==="safety"), "scoped 配置中心只看医生域，不看全局安全/提示词");
  ok((await api("PUT","/api/admin/config-center/"+safetyCfg.id+"/draft",{config:safetyCfg.draft},{cookie:SC})).status===403, "scoped 修改全局安全等级 → 403");
  const cfgAudit = await api("GET","/api/admin/config-center/audit?doctorId=1",undefined,{cookie:COOKIE});
  ok(cfgAudit.status===200 && cfgAudit.j.rows.some(x=>x.domain==="scripts" && x.action==="publish"), "配置中心审计记录包含发布动作");

  console.log("\n== L. 管理员账号生命周期 ==");
  const meAdmin = await api("GET","/api/admin/me",undefined,{cookie:COOKIE});
  ok(meAdmin.status===200 && meAdmin.j.id && meAdmin.j.role==="super" && Array.isArray(meAdmin.j.doctorIds), "当前管理员 /me 返回 id/role/doctorIds");
  const demoteLastSuper = await api("PUT","/api/admin/admins/"+meAdmin.j.id,{role:"scoped",active:true,doctorIds:[1]},{cookie:COOKIE});
  ok(demoteLastSuper.status===409, "最后一个 active super 不能降级");
  const lifeUser = "life"+RID;
  const lifeCreated = await api("POST","/api/admin/admins",{username:lifeUser,password:"life888",displayName:"生命周期医助",role:"scoped",doctorIds:[1],note:"生命周期测试"},{cookie:COOKIE});
  const lifeId = lifeCreated.j && lifeCreated.j.id;
  ok(lifeCreated.status===200 && lifeId && lifeCreated.j.admin.displayName==="生命周期医助" && lifeCreated.j.admin.doctorIds.includes(1), "超管创建 scoped 生命周期账号");
  const adminsList = await api("GET","/api/admin/admins",undefined,{cookie:COOKIE});
  const lifeListed = (adminsList.j||[]).find(a=>a.id===lifeId);
  ok(adminsList.status===200 && lifeListed && lifeListed.active===true && lifeListed.note==="生命周期测试", "管理员列表返回状态/备注/医生范围");
  const lifeLogin = await api("POST","/api/admin/login",{username:lifeUser,password:"life888"});
  const LIFE = (lifeLogin.headers.getSetCookie?lifeLogin.headers.getSetCookie()[0]:lifeLogin.headers.get("set-cookie")).split(";")[0];
  ok(lifeLogin.status===200, "生命周期 scoped 账号可登录");
  const lifeMe = await api("GET","/api/admin/me",undefined,{cookie:LIFE});
  ok(lifeMe.status===200 && lifeMe.j.role==="scoped" && lifeMe.j.doctorIds.includes(1), "生命周期 scoped /me 返回授权医生");
  const lifeDisabled = await api("PUT","/api/admin/admins/"+lifeId,{displayName:"生命周期医助2",role:"scoped",active:false,doctorIds:[1],note:"已禁用"},{cookie:COOKIE});
  ok(lifeDisabled.status===200 && lifeDisabled.j.admin.active===false && lifeDisabled.j.admin.disabledAt, "超管禁用 scoped 账号");
  ok((await api("GET","/api/admin/community?doctorId=1",undefined,{cookie:LIFE})).status===401, "禁用账号已有 session 失效");
  ok((await api("POST","/api/admin/login",{username:lifeUser,password:"life888"})).status===401, "禁用账号不能登录");
  const lifeEnabled = await api("PUT","/api/admin/admins/"+lifeId,{displayName:"生命周期医助2",role:"scoped",active:true,doctorIds:[1],note:"已启用"},{cookie:COOKIE});
  ok(lifeEnabled.status===200 && lifeEnabled.j.admin.active===true && !lifeEnabled.j.admin.disabledAt, "超管重新启用 scoped 账号");
  const resetLife = await api("POST","/api/admin/admins/"+lifeId+"/reset-password",{password:"life999"},{cookie:COOKIE});
  ok(resetLife.status===200 && resetLife.j.ok, "超管重置 scoped 密码");
  ok((await api("POST","/api/admin/login",{username:lifeUser,password:"life888"})).status===401, "重置后旧密码失效");
  const lifeLogin2 = await api("POST","/api/admin/login",{username:lifeUser,password:"life999"});
  const LIFE2 = (lifeLogin2.headers.getSetCookie?lifeLogin2.headers.getSetCookie()[0]:lifeLogin2.headers.get("set-cookie")).split(";")[0];
  ok(lifeLogin2.status===200, "重置后新密码可登录");
  const selfPw = await api("POST","/api/admin/me/password",{oldPassword:"life999",newPassword:"life1000"},{cookie:LIFE2});
  ok(selfPw.status===200 && selfPw.j.reLogin===true, "管理员自己改密码后要求重新登录");
  ok((await api("GET","/api/admin/me",undefined,{cookie:LIFE2})).status===401, "自己改密后原 session 失效");
  ok((await api("POST","/api/admin/login",{username:lifeUser,password:"life1000"})).status===200, "自己改密后新密码可登录");

  console.log("\n== M. 统一审计与能力矩阵预留 ==");
  ok((await api("GET","/api/admin/audit?limit=5",undefined,{cookie:SC})).status===403, "scoped 查询完整审计 → 403");
  const accountCreateAudit = await api("GET","/api/admin/audit?action=account.create&resourceType=admin&resourceId="+lifeId,undefined,{cookie:COOKIE});
  ok(accountCreateAudit.status===200 && accountCreateAudit.j.rows.some(x=>x.action==="account.create" && x.resourceId===String(lifeId)), "统一审计：创建账号写 account.create");
  const accountDisableAudit = await api("GET","/api/admin/audit?action=account.disable&resourceType=admin&resourceId="+lifeId,undefined,{cookie:COOKIE});
  ok(accountDisableAudit.status===200 && accountDisableAudit.j.rows.some(x=>x.action==="account.disable"), "统一审计：禁用账号写 account.disable");
  const resetAudit = await api("GET","/api/admin/audit?action=account.reset_password&resourceType=admin&resourceId="+lifeId,undefined,{cookie:COOKIE});
  const resetRow = resetAudit.j && resetAudit.j.rows && resetAudit.j.rows[0];
  const resetDetail = resetRow ? await api("GET","/api/admin/audit/"+resetRow.id,undefined,{cookie:COOKIE}) : {status:0,j:{}};
  const resetRaw = JSON.stringify(resetDetail.j||{});
  ok(resetAudit.status===200 && resetRow && resetDetail.status===200 && !resetRaw.includes("life999") && !resetRaw.includes("life1000") && !/"salt"/i.test(resetRaw) && !/"hash"/i.test(resetRaw),
    "统一审计：重置密码不落明文密码/salt/hash");
  const credAudit = await api("GET","/api/admin/audit?action=credential.update&resourceType=credential_config&resourceId=qiwe&limit=5",undefined,{cookie:COOKIE});
  const credRow = credAudit.j && credAudit.j.rows && credAudit.j.rows[0];
  const credDetail = credRow ? await api("GET","/api/admin/audit/"+credRow.id,undefined,{cookie:COOKIE}) : {status:0,j:{}};
  const credRaw = JSON.stringify(credDetail.j||{});
  ok(credAudit.status===200 && credRow && credDetail.status===200 && !credRaw.includes(KNOWN_SECRET) && /\[redacted\]/.test(credRaw),
    "统一审计：QiWe 凭证保存写 credential.update 且密钥字段 redacted");
  // 洞3 回归（2026-07-09 安全洞修）：AUDIT_SECRET_KEY_RE 此前漏 robotKey（企微群机器人 webhook 发送密钥）——
  // wecom/config 审计 before/after=loadConfig() 原文，robotKey 明文落 admin_audit_log。修后按字段名 [redacted]。
  const robotKeyProbe = "redact-probe-"+RID;
  const wecomCfgSave = await api("POST","/api/admin/wecom/config",{robotKey:robotKeyProbe,note:"fulltest 洞3 回归"},{cookie:COOKIE});
  ok(wecomCfgSave.status===200 && wecomCfgSave.j.ok===true, "企微配置：super 保存 robotKey → 200（回包不回显原文）");
  const wecomAudit = await api("GET","/api/admin/audit?action=credential.update&resourceType=credential_config&resourceId=wecom&limit=3",undefined,{cookie:COOKIE});
  const wecomRow = wecomAudit.j && wecomAudit.j.rows && wecomAudit.j.rows[0];
  const wecomDetail = wecomRow ? await api("GET","/api/admin/audit/"+wecomRow.id,undefined,{cookie:COOKIE}) : {status:0,j:{}};
  const wecomRaw = JSON.stringify(wecomDetail.j||{});
  ok(wecomAudit.status===200 && wecomRow && wecomDetail.status===200 && !wecomRaw.includes(robotKeyProbe) && /\[redacted\]/.test(wecomRaw),
    "统一审计：wecom robotKey 凭证保存 before/after 不落明文且已 [redacted]（洞3 回归）");
  const outboxAudit = await api("GET","/api/admin/audit?action=outbox.send&resourceType=outbox&resourceId="+ruleEvt.j.outbox.id,undefined,{cookie:COOKIE});
  const outboxOutcomes = (outboxAudit.j.rows||[]).map(x=>x.outcome);
  ok(outboxAudit.status===200 && outboxOutcomes.includes("requested") && outboxOutcomes.includes("success"), "统一审计：outbox 确认发送写 requested → success");
  const scopedOutboxAudit = await api("GET","/api/admin/audit?action=outbox.send&resourceType=outbox&resourceId="+scopedWeekly.j.outbox.id+"&actor="+scopedUser,undefined,{cookie:COOKIE});
  ok(scopedOutboxAudit.status===200 && scopedOutboxAudit.j.rows.some(x=>x.actorUsername===scopedUser && x.outcome==="success"), "能力矩阵预留：scoped 授权医生 outbox.send 经 canAdmin 放行并写审计");
  const triageAudit = await api("GET","/api/admin/audit?action=triage.confirm_send&resourceType=triage_decision&resourceId="+pend.id,undefined,{cookie:COOKIE});
  const triageOutcomes = (triageAudit.j.rows||[]).map(x=>x.outcome);
  ok(triageAudit.status===200 && triageOutcomes.includes("requested") && triageOutcomes.includes("failed"), "统一审计：triage 确认发送失败写 requested → failed");
  const viewerAuditNoDoctor = await api("GET","/api/admin/audit?limit=5",undefined,{cookie:VIEW});
  ok(viewerAuditNoDoctor.status===400, "viewer 查询审计摘要必须带 doctorId");
  const assistantAudit = await api("GET","/api/admin/audit?doctorId=1&limit=5",undefined,{cookie:ASST});
  ok(assistantAudit.status===403, "assistant 不能查看审计摘要");
  const viewerAudit = await api("GET","/api/admin/audit?doctorId=1&limit=80",undefined,{cookie:VIEW});
  ok(viewerAudit.status===200 && viewerAudit.j.scope==="doctor" && (viewerAudit.j.rows||[]).every(x=>x.doctorId===1 && x.resourceType!=="credential_config"),
    "viewer 只能查看本医生审计摘要，且不展示凭证审计");
  const viewerAuditRow = (viewerAudit.j.rows||[]).find(x=>x.resourceType==="outbox" || x.resourceType==="triage_decision");
  const viewerAuditDetail = viewerAuditRow ? await api("GET","/api/admin/audit/"+viewerAuditRow.id,undefined,{cookie:VIEW}) : {status:0,j:{}};
  const viewerCredDetail = credRow ? await api("GET","/api/admin/audit/"+credRow.id,undefined,{cookie:VIEW}) : {status:0,j:{}};
  ok(viewerAuditRow && viewerAuditDetail.status===200 && viewerAuditDetail.j.scope==="doctor", "viewer 可查看本医生非敏感审计详情");
  ok(viewerCredDetail.status===403, "viewer 不能查看凭证审计详情");

  ok((await api("POST","/api/admin/logout",undefined,{cookie:COOKIE})).status===200, "登出");

  console.log(`\n检查项: ${n}  失败: ${fails.length}`);
  if(fails.length){ console.log("失败项:"); fails.forEach(f=>console.log("  - "+f)); process.exit(1); }
  else console.log("✓ 全功能验证全部通过");
})().catch(e=>{ console.error("测试异常:",e); process.exit(2); });
