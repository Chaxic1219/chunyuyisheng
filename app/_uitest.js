/* 新患者端 端到端测试（jsdom × 运行中服务端） */
const { JSDOM } = require("jsdom");
const BASE = process.env.TEST_BASE || "http://localhost:3000";
const wait = ms => new Promise(r=>setTimeout(r,ms));
let fails=[], n=0; const ok=(c,m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ "+m); } else console.log("  ✓ "+m); };
const closeViews = doc => doc.querySelectorAll(".view").forEach(v=>v.remove());

(async()=>{
  const dom = await JSDOM.fromURL(BASE+"/", { runScripts:"dangerously", resources:"usable", pretendToBeVisual:true,
    beforeParse(w){ w.fetch=(u,o)=>globalThis.fetch(new URL(u,BASE),o); } });
  const { window } = dom;
  await new Promise(res=>{ if(window.document.readyState==="complete") res(); else window.addEventListener("load",res); });
  await wait(600);
  const doc = window.document;

  // 首页
  ok(doc.querySelector(".appbar .brand"), "顶栏渲染（春雨医生）");
  ok(((doc.querySelector(".doc-card .name")||{}).textContent||"").startsWith("吕富靖"), "医生名片：吕富靖");
  ok(doc.querySelector('.core-card[data-fn="consult"]'), "核心入口：在线咨询");
  ok(doc.querySelectorAll(".fn-card").length>=6, "功能卡片分组渲染（≥6）");
  ok(!doc.body.textContent.includes("发送数字") && !doc.querySelector(".phone-notch"), "已去除手机框与数字代号玩法");

  // 长辈模式开关（适老：大字/大按钮/高对比）
  const htmlEl=doc.documentElement;
  doc.querySelector("#elderBtn").click();
  ok(htmlEl.classList.contains("elder"), "长辈模式：开启 → html.elder 生效");
  doc.querySelector("#elderBtn").click();
  ok(!htmlEl.classList.contains("elder"), "长辈模式：再次点击关闭");

  // 统一认证徽标 + 按病种服务包
  ok(doc.querySelector(".doc-card .verified-tag"), "医生名片：统一「平台认证」徽标");
  ok(doc.querySelector('[data-fn="packages"]'), "核心入口：按病种服务");
  doc.querySelector('[data-fn="packages"]').click(); await wait(300);
  ok(doc.querySelectorAll(".view .pkg").length>=1 && doc.querySelector(".view .pkg .pkg-item"), "按病种服务：病种服务包与打包项渲染");
  closeViews(doc);

  // 在线咨询：低风险
  doc.querySelector('.core-card[data-fn="consult"]').click(); await wait(300);
  ok(doc.querySelector(".chat-disclaimer"), "咨询页：顶部免责声明条");
  ok(doc.querySelector(".chat-input .tip"), "咨询页：输入框上方常驻提示");
  ok(doc.querySelector("#attachBtn") && /image\/png/.test(doc.querySelector("#imgPick").getAttribute("accept")||""), "咨询页：支持上传图片/报告（MiMo 多模态入口）");
  const poll = async (sel,tries=24)=>{ for(let i=0;i<tries && !doc.querySelector(sel);i++) await wait(500); return doc.querySelector(sel); };
  let ci=doc.querySelector("#ci"); ci.value="我术后能不能吃鸡蛋"; doc.querySelector("#cs").click();
  // 低风险走真实 MiMo，回复可能要数秒——轮询等待带「AI 生成」标识的真实回复气泡出现（而非仅「正在思考」占位）
  await poll("#thread .bubble-row.ai .ai-tag", 72);
  ok(doc.querySelectorAll("#thread .bubble-row.ai").length>=2, "低风险问题：AI 回复气泡出现");
  ok(!doc.querySelector("#thread .escalate.danger"), "低风险：未触发危险升级卡");
  ok(doc.querySelector("#thread .bubble-row.ai .ai-tag"), "AI 回复含『AI 生成内容』合规标识");
  const ttsBtn = doc.querySelector("#thread .ai-meta .tts-btn");
  ok(ttsBtn, "AI 回复含「听一听」朗读按钮");
  if(ttsBtn) ttsBtn.click();   // jsdom 无 speechSynthesis → 优雅降级不抛错

  // 在线咨询：功能码 → 春雨跳转服务卡
  ci=doc.querySelector("#ci"); ci.value="102"; doc.querySelector("#cs").click();
  await poll("#thread .bot-card.has-external .bc-action");
  const extCard=doc.querySelector("#thread .bot-card.has-external");
  ok(extCard && /春雨|小程序|待/.test(extCard.textContent), "功能码 102：聊天流渲染春雨跳转服务卡");
  extCard.querySelector(".bc-action").click(); await wait(200);
  ok(doc.querySelector(".modal .ext-info") && /wx214b7e2bcde837d6/.test(doc.querySelector(".modal").textContent) && /真实跳转|缺参数|原始 ID/.test(doc.querySelector(".modal").textContent), "春雨服务卡：点击后展示真实跳转缺口（不假装已拉起）");
  // 102 视频问诊卡复用 101 医生主页 Short Link（5ujZ4dqouQjf8Fh，甲方 2026-07-08 晚裁定·覆盖待办6·视频问诊入口在主页内，seed.js LV_CY.videoHome→lvDoctor），替换旧专属预约页短链 S9bW6EQGDjO4HNg。
  ok(/#小程序:\/\/春雨医生\/5ujZ4dqouQjf8Fh/.test(doc.querySelector(".modal").textContent) && /视频问诊|预约就诊|医生主页/.test(doc.querySelector(".modal").textContent) && /不是浏览器链接|Chrome/.test(doc.querySelector(".modal").textContent) && /复制微信短链/.test(doc.querySelector(".modal .copy-short").textContent), "春雨服务卡：显示 101 医生主页 Short Link（102 复用主页卡），并说明只能复制到微信内打开");
  doc.querySelector(".modal .cancel").click(); await wait(100);

  // 在线咨询：高风险 → 分级紧急度危险卡（时间窗 + 行动入口）
  ci=doc.querySelector("#ci"); ci.value="我上腹痛很厉害，还呕血、解黑便"; doc.querySelector("#cs").click();
  await poll("#thread .escalate.danger");
  ok(doc.querySelector("#thread .escalate.danger"), "红旗症状：触发危险升级卡 + 转人工/120");
  ok(doc.querySelector("#thread .escalate.danger .ut-chip"), "红旗卡：含就诊时间窗/去向标签");
  ok(doc.querySelector("#thread .escalate.danger .acts button[data-a]"), "红旗卡：含可点行动入口按钮");
  closeViews(doc);

  // 医患联络表（合规：验证码 + 单独同意）
  doc.querySelector('.fn-card[data-fn="file"]').click(); await wait(300);
  let form=doc.querySelector("#frm");
  ok(form && doc.querySelector("#cchk"), "联络表渲染：含单独同意勾选");
  ok(doc.querySelector(".view .steps .step"), "联络表：含节点化步骤提示（建档 3 步）");
  // 空提交不应成功
  doc.querySelector("#sub").click(); await wait(200);
  ok(!doc.querySelector(".view .done"), "联络表空提交不通过");
  // 取码（直接调 API）并填写
  const sms=await (await globalThis.fetch(BASE+"/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:"13700009999"})})).json();
  form.querySelector('[data-f="name"] input').value="测试患者UI";
  doc.querySelector("#ph").value="13700009999"; doc.querySelector("#cd").value=sms.code;
  const dz=form.querySelector('[data-f="disease"] input'); if(dz) dz.value="胃息肉";
  // 未勾同意 → 不通过
  doc.querySelector("#sub").click(); await wait(200);
  ok(!doc.querySelector(".view .done"), "未单独同意时不能提交");
  doc.querySelector("#cchk").checked=true; doc.querySelector("#sub").click(); await wait(900);
  ok(doc.querySelector(".view .done"), "验证码+单独同意后提交→成功态");
  closeViews(doc);

  // 落库校验
  const login=await globalThis.fetch(BASE+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin888"})});
  const cookie=(login.headers.getSetCookie?login.headers.getSetCookie()[0]:login.headers.get("set-cookie")).split(";")[0];
  const subs=await (await globalThis.fetch(BASE+"/api/admin/submissions?doctorId=1&type="+encodeURIComponent("联络表"),{headers:{Cookie:cookie}})).json();
  ok(subs.some(s=>s.payload["姓名"]==="测试患者UI"), "联络表已真实写入数据库（后台可见）");

  // 门诊加号：家庭代办 + 价值动作即时同意 + 停诊拦截
  doc.querySelector('.core-card[data-fn="add"]').click(); await wait(300);
  form=doc.querySelector("#frm");
  ok(doc.body.textContent.includes("加号前请先完成医患联络表"), "加号页：提示先填医患联络表");
  form.querySelector('[data-f="name"] input').value="加号UI";
  const ph2=form.querySelector('[data-f="phone"] input'); if(ph2) ph2.value="13700009999";
  // 家庭代办切换
  doc.querySelector('#proxySeg [data-who="proxy"]').click();
  ok(!doc.querySelector("#proxyFrm").hidden, "家庭代办：切换显示代办人字段");
  doc.querySelector('#proxySeg [data-who="self"]').click();
  ok(doc.querySelector("#proxyFrm").hidden, "切回本人办理：隐藏代办人字段");
  const dsel=form.querySelector('[data-f="date"] select');
  if(dsel){ const okSlot=Array.from(dsel.options).find(o=>/周二|周一|上午/.test(o.value)); if(okSlot) dsel.value=okSlot.value; }
  // 未勾即时同意 → 拦截
  doc.querySelector("#sub").click(); await wait(300);
  ok(!doc.querySelector(".view .done"), "加号未勾即时同意 → 被拦截");
  doc.querySelector("#fconsent").checked=true;
  // 停诊时段拦截
  if(dsel){ const blocked=Array.from(dsel.options).find(o=>/周四|停诊|满/.test(o.value)); if(blocked) dsel.value=blocked.value; }
  doc.querySelector("#sub").click(); await wait(600);
  ok(!doc.querySelector(".view .done"), "加号停诊时段被服务端拦截（未成功）");
  ok(doc.querySelector(".modal .join"), "停诊时段 → 弹出「加入候补名单」");
  doc.querySelector(".modal .cancel").click(); await wait(100);   // 关掉候补弹窗
  // 选回可用时段：吕富靖加号可用项为占位「就诊日（…）」，停诊项含「停诊」；正则命中可用项且不命中停诊项（兼容其他医生的 周二/周一/上午）。
  if(dsel){ const okSlot=Array.from(dsel.options).find(o=>/就诊日|周二|周一|上午/.test(o.value)); if(okSlot) dsel.value=okSlot.value; }
  doc.querySelector("#sub").click(); await wait(700);
  ok(doc.querySelector(".view .done"), "可用门诊时段加号（已填联络表+已同意）提交成功");
  closeViews(doc);

  // 认证口碑墙（建档患者 13700009999 前面已建档 → 经 API 发认证评价 → 风采页展示）
  const rsms=await (await globalThis.fetch(BASE+"/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:"13700009999"})})).json();
  const rpost=await (await globalThis.fetch(BASE+"/api/testimonial",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:1,phone:"13700009999",code:rsms.code,name:"测试患者UI",text:"建档随访体验很好，医助跟进及时，认证评价UI测试。"})})).json();
  ok(rpost && rpost.ok, "认证口碑墙：建档患者经 API 发布认证评价成功");
  doc.querySelector('.fn-card[data-fn="prof"]').click(); await wait(300);
  ok(doc.querySelector(".view .tabs"), "医生风采页打开");
  doc.querySelector('.view .tabs button[data-i="2"]').click(); await wait(200);
  ok(doc.querySelector("#reviewPane #writeReview"), "患者评价tab：含认证口碑墙写入口");
  for(let i=0;i<20 && !/认证评价UI测试/.test((doc.querySelector("#reviewList")||{}).textContent||"");i++) await wait(300);
  const rl=doc.querySelector("#reviewList");
  ok(rl && /认证评价UI测试/.test(rl.textContent) && /已认证患者/.test(rl.textContent), "认证口碑墙：风采页展示该认证评价并标「已认证患者」");
  closeViews(doc);

  // 随访自动化：用建档手机经 API 入组（建档+方案+回拨检查日），再在患者端「我的随访」看时间轴
  const fphone="13700007777", fdate=new Date(Date.now()-10*86400000).toISOString().slice(0,10);
  const fc1=await (await globalThis.fetch(BASE+"/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:fphone})})).json();
  const fenr=await (await globalThis.fetch(BASE+"/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:1,type:"联络表",phone:fphone,code:fc1.code,consent:true,payload:{姓名:"随访UI",手机号:fphone,["主要疾病 / 主诉"]:"胃息肉",随访方案:"胃肠镜检查后随访",["检查/治疗日期"]:fdate}})})).json();
  ok(fenr && fenr.enrolledPlan, "随访：建档选方案即自动入组（API）");
  doc.querySelector('.fn-card[data-fn="followup"]').click(); await wait(300);
  ok(doc.querySelector("#ffrm"), "我的随访页：手机验证表单");
  const fc2=await (await globalThis.fetch(BASE+"/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:fphone})})).json();
  doc.querySelector("#fph").value=fphone; doc.querySelector("#fcd").value=fc2.code; doc.querySelector("#fsub").click();
  for(let i=0;i<16 && !doc.querySelector("#fresult .fu-plan");i++) await wait(300);
  ok(doc.querySelector("#fresult .fu-plan"), "我的随访：验证后渲染随访时间轴");
  ok(doc.querySelectorAll("#fresult .fu-node").length>=4 && doc.querySelector("#fresult .fu-node.due"), "随访时间轴：节点齐全且有到期节点");
  closeViews(doc);

  // 多医生
  const guo=await (await globalThis.fetch(BASE+"/api/bootstrap?doctor=guo")).json();
  ok(guo.doctor.name==="郭强" && guo.doctor.dept==="风湿免疫科", "多医生：郭强配置独立");

  // 编号 818 海报：可选群活码 data URI 嵌入 + 严格白名单（防管理员可配内容的存储型 XSS）
  const UIobj=window.UI;
  const pd={name:"吕富靖",title:"主任医师",hospital:"北京友谊医院",dept:"消化内科",specialty:"胃肠息肉"};
  const pngUri="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const posterNone=UIobj.poster(pd);
  const posterQr=UIobj.poster(Object.assign({},pd,{groupQrImage:pngUri}));
  ok(/<image[\s>]/.test(posterQr) && posterQr.includes('href="'+pngUri), "海报818：合法群活码 → 嵌入 <image> 且 href 含真实 data:image/png;base64");
  ok(!/<image[\s>]/.test(posterNone), "海报818：无群活码 → 不含 <image>（与现状渲染一致）");
  const posterEvil=UIobj.poster(Object.assign({},pd,{groupQrImage:'"><script>alert(1)</script>'}));
  ok(!/<script>/.test(posterEvil) && !/<image[\s>]/.test(posterEvil) && posterEvil===posterNone, "海报818：非法值(script注入) → 白名单拦截，输出无注入且与无值渲染逐字一致");
  const posterJs=UIobj.poster(Object.assign({},pd,{groupQrImage:"javascript:alert(1)"}));
  ok(posterJs===posterNone, "海报818：javascript: 伪协议 → 拦截并回退无值渲染");

  // 818 真实海报（甲方 2026-07-03 提供）：吕富靖 content.posterImage 优先渲染真实图（含照片/简介/群活码），不再生成 SVG
  const posterRealImg=UIobj.poster(Object.assign({},pd,{posterImage:"/assets/lvfujing-818-poster.jpg"}));
  ok(/^<img /.test(posterRealImg) && posterRealImg.includes('src="/assets/lvfujing-818-poster.jpg"'), "海报818：posterImage 合法站内路径 → 渲染 <img> 引用真实图，不再生成 SVG");
  const posterExternal=UIobj.poster(Object.assign({},pd,{posterImage:"https://evil.example/x.jpg"}));
  ok(posterExternal===posterNone, "海报818：posterImage 为外链 URL（非 /assets/ 前缀） → 白名单拦截，回退与无值渲染逐字一致");
  const posterBadExt=UIobj.poster(Object.assign({},pd,{posterImage:"/assets/lvfujing-818-poster.svg"}));
  ok(posterBadExt===posterNone, "海报818：posterImage 扩展名不在白名单(svg) → 拦截，回退无值渲染");
  const posterInjection=UIobj.poster(Object.assign({},pd,{posterImage:'/assets/"><script>alert(1)</script>.jpg'}));
  ok(!/<script>/.test(posterInjection) && posterInjection===posterNone, "海报818：posterImage 含引号/尖括号(script注入) → 白名单拦截，输出无注入且与无值渲染逐字一致");
  const posterJsImg=UIobj.poster(Object.assign({},pd,{posterImage:"javascript:alert(1)"}));
  ok(posterJsImg===posterNone, "海报818：posterImage 为 javascript: 伪协议 → 拦截并回退无值渲染");

  // 吕富靖 818 端到端：bootstrap content.posterImage 直达患者端「介绍给亲友」→ 真实渲染 <img>（非生成 SVG）
  doc.querySelector('.fn-card[data-fn="share"]').click(); await wait(200);
  const posterImgEl=doc.querySelector(".view .poster-frame img");
  ok(posterImgEl && posterImgEl.getAttribute("src")==="/assets/lvfujing-818-poster.jpg", "818海报：吕富靖「介绍给亲友」渲染真实海报 <img src=/assets/lvfujing-818-poster.jpg>");
  ok(!doc.querySelector(".view .poster-frame svg"), "818海报：真实图存在时不再生成占位 SVG");
  ok(/保存海报图片/.test((doc.querySelector(".view .btn-primary")||{}).textContent||""), "818海报：真实图态下按钮文案为「保存海报图片」");
  closeViews(doc);

  // 黄安华/郭强未提供真实海报（content 无 posterImage 字段）→ 继续生成 SVG 占位海报，向后兼容不变
  const huangBoot=await (await globalThis.fetch(BASE+"/api/bootstrap?doctor=huang")).json();
  ok(!huangBoot.content.posterImage, "多医生：黄安华 content 无 posterImage → 818 仍生成 SVG 海报（不变）");
  ok(!guo.content.posterImage, "多医生：郭强 content 无 posterImage → 818 仍生成 SVG 海报（不变）");

  console.log(`\n检查项: ${n}  失败: ${fails.length}`);
  console.log(fails.length?"✗ 存在失败":"✓ 新患者端 端到端全部通过");
  window.close(); process.exit(fails.length?1:0);
})().catch(e=>{ console.error("测试异常:",e); process.exit(2); });
