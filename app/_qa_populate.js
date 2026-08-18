/* QA 数据灌入：在 demo 模式下，为「全面 UI 扫查」给各视图灌真实内容
   依赖：服务以 node server.js --demo 运行（/api/sms/send 明文返回 code）
   用法：node _qa_populate.js */
const BASE = "http://localhost:3000";
const DID = 1;

async function post(url, body, cookie){
  const r = await fetch(BASE+url, { method:"POST",
    headers:{ "Content-Type":"application/json", ...(cookie?{Cookie:cookie}:{}) },
    body:JSON.stringify(body) });
  let j=null; try{ j=await r.json(); }catch(e){}
  return { status:r.status, j, setCookie:r.headers.get("set-cookie") };
}
async function sms(phone){ const {j}=await post("/api/sms/send",{phone}); return j&&j.code; }
const dAgo = n => new Date(Date.now()-n*86400000).toISOString().slice(0,10);
const log = (...a)=>console.log(...a);

(async()=>{
  // 0. 后台登录（部分操作可能需要，且验证多租户视图）
  const login = await post("/api/admin/login",{username:"admin",password:"admin888"});
  const cookie = (login.setCookie||"").split(";")[0];
  log("登录:", login.status, cookie?"ok":"无cookie");

  // 1. AI 分诊会话（低/中/红旗 三档）—— 触发 triage + 结构化病历卡
  for(const [t,name,key] of [
    ["我术后能不能吃鸡蛋，饮食上要注意什么","咨询者·饮食","qa-low"],
    ["最近总是反复腹胀、隐隐作痛，需要去复查吗","咨询者·复查","qa-mid"],
    ["我右上腹痛得很厉害，还发烧、皮肤发黄，怎么办","咨询者·红旗","qa-red"],
  ]){
    const r = await post("/api/message",{doctorId:DID,text:t,patientName:name,patientKey:key});
    log("分诊:", r.status, "urgency=", r.j&&r.j.triage&&r.j.triage.urgency&&r.j.triage.urgency.tier, "risk=", r.j&&r.j.triage&&r.j.triage.riskLevel);
  }

  // 2. 联络表 + 随访自动入组（起算 10 天前，让 1/3/7 天到期、30 天待开始）
  const c1 = await sms("13800138010");
  const f1 = await post("/api/submit",{doctorId:DID,type:"联络表",phone:"13800138010",code:c1,consent:true,payload:{
    "姓名":"张建国","手机号":"13800138010","主要疾病 / 主诉":"多发胆囊结石",
    "随访方案":"腹腔镜胆囊切除术后随访","手术/治疗日期":dAgo(10),"所在城市":"上海",
    "病情简述":"反复右上腹隐痛半年余，B 超示胆囊多发结石，已行腹腔镜胆囊切除术。" }});
  log("联络表+随访:", f1.status, "enrolledPlan=", f1.j&&f1.j.enrolledPlan);

  // 3. 另一位建档患者（用于认证口碑墙）
  const c2 = await sms("13800138020");
  const f2 = await post("/api/submit",{doctorId:DID,type:"联络表",phone:"13800138020",code:c2,consent:true,payload:{
    "姓名":"李秀英","手机号":"13800138020","主要疾病 / 主诉":"胆囊息肉 0.8cm","所在城市":"南京" }});
  log("联络表2:", f2.status);
  const c2b = await sms("13800138020"); // 成功验证会清节流，可立即再取码
  const tm = await post("/api/testimonial",{doctorId:DID,phone:"13800138020",code:c2b,
    text:"黄主任团队随访特别细致，术后每个阶段都有提醒和指导，复诊也帮忙加了号，恢复比我预期顺利，真心感谢。"});
  log("认证口碑:", tm.status, tm.j&&tm.j.name);

  // 4. 门诊加号（有效时段）
  const ad = await post("/api/submit",{doctorId:DID,type:"加号",consent:true,date:"周二 上午",payload:{
    "患者姓名":"王芳","手机号":"13800138030","期望就诊日":"周二 上午","加号原因":"外地复诊，术后第二次随访" }});
  log("加号:", ad.status);

  // 5. 住院预约
  const adm = await post("/api/submit",{doctorId:DID,type:"住院预约",consent:true,payload:{
    "患者姓名":"赵建军","手机号":"13800138031","诊断 / 拟手术":"胆囊结石拟行腹腔镜胆囊切除术","期望住院时间":"两周内" }});
  log("住院:", adm.status);

  // 6. 故事
  log("故事:", (await post("/api/submit",{doctorId:DID,type:"story",payload:{name:"康复患者·孙先生",text:"五年前查出胆结石，黄主任帮我保住了胆囊，现在一切都好，分享给还在纠结的病友。"}})).status);

  // 8. 候补名单（加号撞停诊「周四 全天」→ 409 → 加入候补两人）
  const blocked = await post("/api/submit",{doctorId:DID,type:"加号",consent:true,date:"周四 全天",payload:{
    "患者姓名":"周敏","手机号":"13800138040","期望就诊日":"周四 全天" }});
  log("加号撞停诊:", blocked.status, "waitlistable=", blocked.j&&blocked.j.waitlistable);
  log("候补1:", (await post("/api/waitlist",{doctorId:DID,slot:"周四 全天",name:"周敏",phone:"13800138040",consent:true})).status);
  log("候补2:", (await post("/api/waitlist",{doctorId:DID,slot:"周四 全天",name:"吴磊",phone:"13800138041",consent:true})).status);

  log("\n=== 灌数据完成 ===");
})().catch(e=>{ console.error("populate 失败:", e); process.exit(1); });
