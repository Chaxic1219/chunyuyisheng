/* ===== 春雨医生 · 患者服务中心（患者端单页应用） =====
   现代医疗青蓝设计 · 老年友好 · 功能卡片化导航（无手机框、无数字代号）
   后端契约：/api/bootstrap /api/message(→AI分诊) /api/submit /api/sms/send /api/stories */
(function () {
  const $ = (s, r=document)=>r.querySelector(s);
  const esc = UI.esc;
  const el = (h)=>{ const d=document.createElement("div"); d.innerHTML=h.trim(); return d.firstElementChild; };
  const escBr = (s)=>esc(s).replace(/\n/g,"<br>");
  const I = UI.icon;

  /* 长辈模式：综合适老（大字 / 大可点 / 高对比），开关持久化，开机即恢复 */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  if(lsGet("elderMode")==="1") document.documentElement.classList.add("elder");

  /* TTS「听一听」：浏览器语音朗读，不支持则优雅降级 */
  function speak(text){
    const synth = window.speechSynthesis;
    if(!synth || typeof SpeechSynthesisUtterance==="undefined"){ toast("当前浏览器不支持朗读"); return; }
    if(synth.speaking){ synth.cancel(); return; }      // 再点一次=停止
    const u = new SpeechSynthesisUtterance(String(text||"").replace(/\s+/g," ").trim().slice(0,800));
    u.lang = "zh-CN"; u.rate = document.documentElement.classList.contains("elder") ? 0.85 : 0.95;
    try{ synth.speak(u); }catch(e){ toast("朗读失败"); }
  }
  function ttsButton(getText){
    const b = el(`<button class="tts-btn" type="button" title="听一听">${I("sound")}<span>听一听</span></button>`);
    b.onclick = (e)=>{ e.stopPropagation(); speak(typeof getText==="function" ? getText() : getText); };
    return b;
  }

  let DATA = null;                 // bootstrap
  let PKEY = "web-" + Math.floor(Date.now()/1000) + "-" + Math.floor(Math.random()*9999);
  const CONSENT_DEFAULT = "处理目的：用于本医生院外健康服务的建档、随访与医助联系。\n处理范围：姓名、手机号、疾病描述及您主动上传的病历资料。\n保存期限：仅在为您提供服务所需期间保存。\n信息可见范围：仅本医生团队可见，不对群内其他成员公开。\n您的权利：可随时申请查阅、更正、删除或撤回本次授权。";
  const USER_AGREEMENT_DEFAULT = "本协议适用于春雨医患通内医患联络表与档案建档服务。您提交的信息仅用于本医生团队的随访联系与服务跟进。\n提交即表示您已阅读并同意按约定使用相关服务。";
  const PRIVACY_DEFAULT = CONSENT_DEFAULT;

  /* ---------- 启动 ---------- */
  fetch("/api/bootstrap" + (location.search || ""))
    .then(r=>r.json()).then(d=>{ DATA=d; if(!d.content) d.content={}; renderHome(); handleDeepLink(); })
    .catch(()=>{ $("#app").innerHTML='<div class="page" style="padding-top:80px;text-align:center;color:#4C6272">加载失败，请确认服务已启动：<code>node server.js</code></div>'; });

  /* 域名深链承接（甲方 2026-07-03）：企微/小程序把编号卡片深链到我们自己的 H5 页 /?p=<key>，落地后自动打开对应本地页。
     防任意跳转：白名单硬编码为这六个页面动作（就这六个，不开放全量 openLocalForCard 的 actions），只查表调用、绝不 eval/动态拼函数名。
     白名单外的 p 值静默忽略（不执行、只 console.warn）。复用现有 openLocalForCard 的动作实现（openForm/openProfile/openContact/openFaq/openArticle/review），不复制。 */
  function handleDeepLink(){
    let p="", inviteTok="";
    try{
      const sp=new URLSearchParams(location.search||"");
      p=String(sp.get("p")||"").trim();
      inviteTok=String(sp.get("t")||"").trim();
    }catch(e){ return; }
    if(p==="invite" && inviteTok){
      try{ openInviteForm(inviteTok); }catch(e){ try{ console.warn("[deeplink] invite 打开失败:", e && e.message); }catch(_){} }
      return;
    }
    if(!p) return;
    // 白名单集合（六编号对应 key，cc1 已核实 919=review）：admission/review/contact-form/faq/doctor-profile/article:surgery。
    const ALLOWED={ "admission":1, "review":1, "contact-form":1, "faq":1, "doctor-profile":1, "article:surgery":1 };
    if(!ALLOWED[p]){ try{ console.warn("[deeplink] 忽略非白名单 p:", p); }catch(e){} return; }
    // 复用 openLocalForCard：构造仅含 page 的伪卡，走既有 actions/article 分支（无 external → 不触发外链跳转）。
    // article:surgery 命中 openLocalForCard 的 article 前缀分支（openArticle(C.surgeryArticle)）；其余命中 actions 表。
    try{ openLocalForCard({ type:"link", page:p }); }catch(e){ try{ console.warn("[deeplink] 打开失败:", p, e && e.message); }catch(_){} }
  }

  /* ---------- 功能注册表 ---------- */
  function functions(){
    const C=DATA.content, D=DATA.doctor, list=[];
    const add=(cond,o)=>{ if(cond) list.push(o); };
    add(true,            {key:"consult", group:"看病", core:1, icon:"chat",  iconCls:"primary", title:"在线咨询", sub:"向 AI 健康助手提问，需要时转人工", open:openAssistant});
    add(C.videoConsult,  {key:"videoConsult", group:"看病", icon:"video", title:"视频问诊", sub:"申请和医生视频问诊", open:()=>openVideoConsult(C.videoConsult)});
    add(C.addNumber,     {key:"add",     group:"看病", core:2, icon:"plus",  iconCls:"add",     title:"门诊加号", sub:"现场没号了？让医生帮你加一个", open:()=>openForm(C.addNumber,{type:"加号",schedule:true})});
    add(C.admission,     {key:"adm",     group:"看病", core:3, icon:"bed",   iconCls:"bed",     title:"住院预约", sub:"需手术/住院，提交后助理评估排期", open:()=>openForm(C.admission,{type:"住院预约",notes:C.admission.notes})});
    add(C.clinicArticle, {key:"clinic",                group:"看病", icon:"clock",    title:"门诊时间", sub:"出诊地址与时间、怎么挂号", open:()=>openArticle(C.clinicArticle)});
    add(C.followupPlans&&C.followupPlans.length, {key:"followup", group:"看病", icon:"clock", title:"我的随访", sub:"术后随访计划与复诊提醒", open:openFollowup});
    add(C.servicePackages&&C.servicePackages.length, {key:"packages", group:"看病", core:4, icon:"form", iconCls:"bed", title:"按病种服务", sub:"按您的病种打包相关服务，少走弯路", open:openPackages});
    add(D.hospitalPhone, {key:"tel",                   group:"看病", icon:"phone",    title:"医院电话", sub:"医院咨询/预约热线", open:openPhone});
    add(C.doctorProfile, {key:"prof",                  group:"了解", icon:"profile",  title:"医生风采", sub:"简介、擅长、科普与患者评价", open:openProfile});
    add(C.doctorVideo,   {key:"video",                 group:"了解", icon:"video",  care:1, title:"医生视频", sub:"医生出镜的一段自我介绍", open:()=>openVideo(C.doctorVideo)});
    add(D.accounts&&D.accounts.length, {key:"sci",      group:"了解", icon:"book",  care:1, title:"科普专栏", sub:"医生在各平台的科普账号", open:openAccounts});
    add(C.dietArticle,   {key:"diet",                  group:"了解", icon:"bowl",  care:1, title:"术后饮食", sub:"康复期吃什么、怎么吃", open:()=>openArticle(C.dietArticle)});
    add(C.surgeryArticle,{key:"surgery",               group:"了解", icon:"bed",   care:1, title:"住院手术须知", sub:"入院前后注意事项", open:()=>openArticle(C.surgeryArticle)});
    add(C.contactForm,   {key:"file",                  group:"我的", icon:"form",     title:"医患联络表", sub:"提交基础信息建档（仅医生团队可见）", open:()=>openContact(C.contactForm)});
    add(C.replyCenter,   {key:"replies",               group:"我的", icon:"chat",     title:"查看回复", sub:"验证手机号查看提交与跟进", open:openReplies});
    add(C.copyArticle,   {key:"copy",                  group:"我的", icon:"copy",     title:"病案复印", sub:"病历/病案复印怎么办理", open:()=>openArticle(C.copyArticle)});
    add(DATA.faq&&DATA.faq.length, {key:"faq",          group:"我的", icon:"help",     title:"常见问题", sub:"进群必看，多数问题先看这里", open:openFaq});
    add(C.thankDoctor,   {key:"thanks",                group:"我的", icon:"heart",    title:"感谢医生", sub:"给医生团队留一段感谢", open:openThankDoctor});
    add(true,            {key:"share",                 group:"我的", icon:"transfer", title:"介绍给亲友", sub:"把医生推荐给需要的家人朋友", open:openPoster});
    return list;
  }

  /* ---------- 首页 ---------- */
  function renderHome(){
    const D=DATA.doctor, fns=functions();
    const core=fns.filter(f=>f.core).sort((a,b)=>a.core-b.core);
    const groups=[["看病","找医生看病"],["了解","了解与康复"],["我的","我的资料"]];
    const app=$("#app");
    app.innerHTML="";
    app.appendChild(el(`
      <div>
        <div class="appbar">
          <div class="brand"><img class="logo" src="/brand/logo.png?v=20260804-logo" alt="春雨医服" />春雨医生</div>
          <div class="sp"></div>
          ${docSelectHtml()}
          <button class="iconbtn" id="elderBtn" title="长辈模式（大字·大按钮·高对比）">${I("az")}</button>
          <a class="iconbtn" href="/admin" target="_blank" title="医助后台">${I("user")}</a>
        </div>
        <div class="page" id="homePage"></div>
        <div class="tabbar">
          <button class="on" data-tab="home">${I("home")}<span>首页</span></button>
          <button data-tab="consult">${I("chat")}<span>在线咨询</span></button>
          <button data-tab="mine">${I("user")}<span>我的</span></button>
        </div>
      </div>`));

    const hp=$("#homePage");
    // 医生名片（统一认证徽标：平台认证 + 数据驱动的资质项，跨医生一致）
    const certs=(DATA.content.certifications&&DATA.content.certifications.length)?DATA.content.certifications:["实名认证",(D.hospital||"").includes("医院")?"公立医院":"三甲背景"];
    hp.appendChild(el(`
      <div class="doc-card">
        <div class="top">
          <div class="avatar">${UI.avatar(D.name)}</div>
          <div class="who">
            <div class="name">${esc(D.name)}<span class="verified-tag">${I("shield")}平台认证</span></div>
            <div class="title">${esc(D.title||"")}</div>
            <div class="hosp">${esc(D.hospital||"")} · ${esc(D.dept||"")}</div>
            <div class="tags">${(D.specialty||"").split(/[·\/、]/).map(s=>s.trim()).filter(Boolean).slice(0,3).map(s=>`<span>${esc(s)}</span>`).join("")}</div>
          </div>
        </div>
        <div class="badges">
          ${certs.slice(0,4).map(c=>`<span class="b">${I("check")}${esc(c)}</span>`).join("")}
          <span class="b">${I("heart")}已服务 ${D.memberCount||0} 位患者</span>
        </div>
      </div>`));

    // 核心高频入口
    if(core.length){
      const sec=el(`<div class="section"><h2>快速找医生 <span class="hint">最常用</span></h2><div class="core-grid"></div></div>`);
      const grid=$(".core-grid",sec);
      core.forEach(f=>{ const c=el(`<button class="core-card ${f.iconCls||"primary"}" data-fn="${esc(f.key)}"><div class="ic">${I(f.icon)}</div><div class="t">${esc(f.title)}</div><div class="d">${esc(f.sub)}</div></button>`); c.onclick=f.open; grid.appendChild(c); });
      hp.appendChild(sec);
    }
    // 分组功能
    groups.forEach(([g,label])=>{
      const items=fns.filter(f=>f.group===g && !f.core);
      if(!items.length) return;
      const sec=el(`<div class="section" data-group="${g}"><h2>${label}</h2><div class="fn-grid"></div></div>`);
      const grid=$(".fn-grid",sec);
      items.forEach(f=>{
        const card=el(`<button class="fn-card" data-fn="${esc(f.key)}">
          <div class="ic ${f.care?"care":""}">${I(f.icon)}</div>
          <div class="body"><div class="t">${esc(f.title)}${f.key==="file"?'<span class="dot" title="待建档"></span>':""}</div><div class="d">${esc(f.sub)}</div></div>
          <div class="arrow">${I("arrow")}</div></button>`);
        card.onclick=f.open; grid.appendChild(card);
      });
      hp.appendChild(sec);
    });
    hp.appendChild(el(`<p style="text-align:center;color:#9aa7ad;font-size:.8125rem;margin-top:28px">春雨医生 · 患者服务中心（演示）· 内容均为脱敏示例</p>`));

    // 交互
    const eb=$("#elderBtn"); const h=document.documentElement;
    eb.classList.toggle("on", h.classList.contains("elder"));
    eb.onclick=()=>{ const on=h.classList.toggle("elder"); eb.classList.toggle("on",on); lsSet("elderMode",on?"1":"0"); toast(on?"已开启长辈模式：大字 · 大按钮 · 高对比":"已关闭长辈模式"); };
    bindDocSelect();
    app.querySelectorAll(".tabbar button").forEach(b=>b.onclick=()=>{
      const t=b.dataset.tab;
      if(t==="consult") openAssistant();
      else if(t==="mine"){ const m=app.querySelector('[data-group="我的"]'); if(m) m.scrollIntoView({behavior:"smooth"}); }
      else window.scrollTo({top:0,behavior:"smooth"});
    });
  }

  function docSelectHtml(){
    if(!DATA.doctors || DATA.doctors.length<2) return "";
    const opts = DATA.doctors.map(d=>{
      const label = `${d.name}${d.hospital?(" · "+d.hospital):""}${d.dept?(" · "+d.dept):""}`;
      return `<option value="${esc(d.slug)}" data-search="${esc(((d.name||"")+" "+(d.title||"")+" "+(d.hospital||"")+" "+(d.dept||"")).toLowerCase())}" ${d.slug===DATA.doctor.slug?"selected":""}>${esc(label)}</option>`;
    }).join("");
    return `<span class="doc-sel"><input id="docSearch" type="search" placeholder="搜医生/医院/科室" autocomplete="off" style="max-width:9rem;margin-right:4px"/><select id="docSel">${opts}</select></span>`;
  }
  function bindDocSelect(){
    const s=$("#docSel");
    if(s) s.onchange=()=>{ location.search="?doctor="+s.value; };
    const q=$("#docSearch");
    if(q && s){
      q.oninput=()=>{
        const needle = q.value.trim().toLowerCase();
        Array.from(s.options).forEach(o=>{
          const hay = (o.getAttribute("data-search") || o.textContent || "").toLowerCase();
          o.hidden = !!(needle && hay.indexOf(needle) < 0);
        });
      };
    }
  }

  /* ---------- 视图栈 ---------- */
  function syncViewLock(){
    const on=!!document.querySelector(".view");
    document.documentElement.classList.toggle("view-open",on);
    document.body.classList.toggle("view-open",on);
  }
  function openView(title, bodyNode, opts){
    opts=opts||{};
    const backHtml = opts.hideBack ? "" : `<button type="button" class="back" aria-label="返回">${I("back")}</button>`;
    const v=el(`<div class="view"><div class="view-bar">${backHtml}<div class="vt">${esc(title)}</div></div>
      <div class="view-body"><div class="view-inner"></div></div>${opts.cta?'<div class="cta-bar"></div>':""}</div>`);
    $(".view-inner",v).appendChild(bodyNode);
    if(opts.cta){ $(".cta-bar",v).appendChild(opts.cta); }
    const backBtn=$(".back",v);
    if(backBtn) backBtn.onclick=()=>closeView(v);
    document.body.appendChild(v);
    syncViewLock();
    return v;
  }
  function closeView(v){ v.style.animation="none"; v.remove(); syncViewLock(); }

  /* ---------- AI 在线咨询 ---------- */
  function openAssistant(){
    const D=DATA.doctor;
    const body=el(`<div class="chat" style="height:100%">
      <div class="chat-disclaimer">${I("info")}<div>我是 <b>AI 健康助手</b>，可提供健康科普与就医引导，<b>不能替代医生面诊与诊断</b>。涉及用药、检查结果与急症会为您转人工。</div></div>
      <div class="chat-thread" id="thread"></div>
      <div class="chat-input">
        <div class="tip">AI 回答仅供参考；可上传检查报告/患处照片，图片类材料会转医生团队审核</div>
        <div class="attach-strip" id="attachStrip" hidden></div>
        <div class="row"><button class="attach-btn" id="attachBtn" type="button" title="上传图片/报告">${I("image")}</button><input id="imgPick" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden /><textarea id="ci" rows="1" placeholder="说说您的情况，或上传图片/报告…"></textarea><button class="send" id="cs">${I("send")}</button></div>
      </div></div>`);
    // 用全屏 chat 视图（不要 inner 居中限制）
    const v=el(`<div class="view"><div class="view-bar"><button class="back">${I("back")}</button><div class="vt">在线咨询 · AI 健康助手</div><div class="sp" style="flex:1"></div><button class="iconbtn" id="toDoc" title="找医生">${I("profile")}</button></div></div>`);
    v.appendChild(body); $(".back",v).onclick=()=>closeView(v); document.body.appendChild(v); syncViewLock();
    $("#toDoc",v).onclick=()=>{ const f=functions().find(x=>x.key==="add")||functions().find(x=>x.key==="clinic"); if(f) f.open(); else toast("可在首页选择门诊加号/门诊时间"); };

    const thread=$("#thread",v), ci=$("#ci",v), cs=$("#cs",v), imgPick=$("#imgPick",v), attachBtn=$("#attachBtn",v), attachStrip=$("#attachStrip",v);
    let pendingImages = [];
    const greet=(DATA.content.consult&&DATA.content.consult.text)||"您可以描述症状或想了解的问题，我会先做基础科普与就医引导。";
    pushAI(thread, greet);

    function autosize(){ ci.style.height="auto"; ci.style.height=Math.min(ci.scrollHeight,120)+"px"; }
    function renderAttachments(){
      attachStrip.hidden = pendingImages.length === 0;
      attachStrip.innerHTML = pendingImages.map((a,i)=>`<div class="attach-chip">
        <img src="${esc(a.dataUrl)}" alt="${esc(a.name)}" /><span>${esc(a.name)}</span><button type="button" data-rm="${i}" title="移除">×</button>
      </div>`).join("");
      attachStrip.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{ pendingImages.splice(+b.dataset.rm,1); renderAttachments(); });
    }
    function readFileDataUrl(file){
      return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||"")); r.onerror=reject; r.readAsDataURL(file); });
    }
    async function shrinkImage(dataUrl){
      if(typeof Image==="undefined") return null;
      return new Promise(resolve=>{
        const img=new Image();
        img.onload=()=>{
          try{
            const max=1280, scale=Math.min(1, max/Math.max(img.width,img.height));
            const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
            const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,c.width,c.height);
            resolve({ mime:"image/jpeg", dataUrl:c.toDataURL("image/jpeg",0.78) });
          }catch(e){ resolve(null); }
        };
        img.onerror=()=>resolve(null);
        img.src=dataUrl;
      });
    }
    function dataUrlBytes(dataUrl){ const b64=String(dataUrl||"").split(",")[1]||""; return Math.floor(b64.length*3/4); }
    async function makeAttachment(file){
      if(!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("仅支持 PNG/JPG/WebP 图片");
      let mime=file.type, dataUrl=await readFileDataUrl(file);
      if(file.size > 900*1024){
        const shrunk = await shrinkImage(dataUrl);
        if(shrunk){ mime=shrunk.mime; dataUrl=shrunk.dataUrl; }
      }
      const size=dataUrlBytes(dataUrl);
      if(size > 1.5*1024*1024) throw new Error("图片仍超过 1.5MB，请先截图或压缩后上传");
      return { type:"image", name:(file.name||"图片").slice(0,60), mime, size, dataUrl };
    }
    ci.addEventListener("input",autosize);
    ci.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); doSend(); } });
    attachBtn.onclick=()=>imgPick.click();
    imgPick.onchange=async()=>{
      const slots=3-pendingImages.length;
      if(slots<=0){ toast("最多上传 3 张图片/报告"); imgPick.value=""; return; }
      const files=Array.from(imgPick.files||[]).slice(0,slots);
      for(const f of files){
        try{ pendingImages.push(await makeAttachment(f)); }
        catch(e){ toast(e.message||"图片读取失败"); }
      }
      if((imgPick.files||[]).length>slots) toast("最多上传 3 张图片/报告");
      imgPick.value="";
      renderAttachments();
    };
    cs.onclick=doSend;
    function doSend(){
      if(cs.disabled) return;                    // 防重：请求未完成时忽略再次点击/回车，避免重复提交
      const t=ci.value.trim(); if(!t && !pendingImages.length) return;
      const attachments=pendingImages.slice();
      ci.value=""; pendingImages=[]; renderAttachments(); autosize();
      cs.disabled=true;
      pushMe(thread,t,attachments);
      const typing=pushAI(thread,"正在思考…",true);
      fetch("/api/message",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:D.id,text:t,attachments,patientName:"网页咨询者",patientKey:PKEY})})
        .then(r=>r.json()).then(res=>{
          typing.remove();
          pushBotResponses(thread,res);
          const tri=res.triage;
          const tier=tri&&tri.urgency&&tri.urgency.tier;
          if(tri && ((tier && tier!=="routine") || (tri.riskLevel && tri.riskLevel!=="low"))) triageCard(thread,tri);
        }).catch(()=>{ typing.remove(); pushAI(thread,"网络异常，请稍后重试。"); })
        .finally(()=>{ cs.disabled=false; });     // 请求结束(成功/失败)恢复发送按钮
    }
  }
  function pushAI(thread,text,typing,tag){
    const n=el(`<div class="bubble-row ai"><div class="av">${UI.userAvatar("AI助手")}</div>
      <div class="bubble-wrap"><div class="bubble ${typing?"typing":""}">${escBr(text)}</div>${tag?'<div class="ai-meta"><span class="ai-tag">AI 生成内容 · 仅供参考，不构成诊断</span></div>':""}</div></div>`);
    if(tag){ const meta=n.querySelector(".ai-meta"); if(meta) meta.appendChild(ttsButton(text)); }
    thread.appendChild(n); thread.scrollTop=thread.scrollHeight; return n;
  }
  function attachmentThumbs(attachments){
    const list=Array.isArray(attachments)?attachments:[];
    return list.length ? `<div class="message-attachments">${list.map(a=>`<div class="msg-img"><img src="${esc(a.dataUrl||"")}" alt="${esc(a.name||"上传图片")}" /><span>${esc(a.name||"上传图片")}</span></div>`).join("")}</div>` : "";
  }
  function pushMe(thread,text,attachments){
    const label=text ? escBr(text) : "已上传图片/报告";
    const n=el(`<div class="bubble-row me"><div class="bubble">${label}${attachmentThumbs(attachments)}</div></div>`);
    thread.appendChild(n); thread.scrollTop=thread.scrollHeight; return n;
  }

  function pushBotResponses(thread,res){
    const responses=Array.isArray(res&&res.responses)?res.responses:[];
    if(res && res.menu && DATA.menu){
      const menuText=(DATA.menu.items||[]).map(x=>`${x.code} ${x.label}`).join("\n");
      pushAI(thread,(DATA.menu.title||"群功能菜单")+"\n"+menuText,false,false);
      return;
    }
    const texts=responses.filter(x=>x&&x.type==="text"&&x.text).map(x=>x.text);
    const cards=responses.filter(x=>x&&x.type!=="text");
    if(texts.length) pushAI(thread,texts.join("\n\n"),false,!!(res&&res.triage));
    if(cards.length) pushResponseCards(thread,cards);
    if(!texts.length && !cards.length) pushAI(thread,"我已收到您的问题。",false,!!(res&&res.triage));
  }

  function pushResponseCards(thread,cards){
    const n=el(`<div class="bot-cards">${cards.map(responseCardHtml).join("")}</div>`);
    n.querySelectorAll("[data-card]").forEach(b=>b.onclick=()=>openResponseCard(cards[+b.dataset.card]));
    thread.appendChild(n); thread.scrollTop=thread.scrollHeight; return n;
  }

  function cardIcon(card){
    if(card.type==="qr") return "qr";
    if(card.type==="link") return "book";
    if(card.type==="image") return "image";
    if(card.page==="video-consult" || card.page==="doctor-video") return "video";
    if(card.page==="add-number") return "plus";
    if(card.page==="admission") return "bed";
    return "form";
  }
  function externalStatusText(s){
    return ({ready:"已配置", short_link_ready:"微信短链", fallback_short_link:"兜底短链", blocked_by_wechat_share:"不可分享", pending_config:"待配置", pending_token:"待取 token", pending_runtime_params:"缺运行参数", pending_signature:"缺签名", pending_contract:"缺合同参数", pending_order:"缺订单", pending_url:"缺 URL", disabled:"未启用"}[s] || "待联调");
  }
  function responseCardHtml(card,i){
    const ext=card.external||{};
    const hasExt=!!(ext.provider||ext.mode||ext.docUrl||ext.urlTemplate||ext.appId);
    const title=card.title||card.name||"服务入口";
    const sub=card.sub||card.caption||card.source||"点击查看";
    const mode=ext.mode ? ext.mode.replace("_","/").toUpperCase() : (card.type==="qr"?"二维码":card.type==="mp"?"小程序卡":"服务卡");
    const action=card.ctaLabel || (hasExt ? (ext.url ? "打开春雨入口" : "查看接入信息") : (card.type==="qr"?"查看二维码":"打开"));
    return `<div class="bot-card ${hasExt?"has-external":""}">
      <div class="bc-main">
        <div class="bc-ic">${I(cardIcon(card))}</div>
        <div class="bc-copy">
          <div class="bc-title">${esc(title)}</div>
          <div class="bc-sub">${esc(sub)}</div>
          ${hasExt?`<div class="bc-meta"><span>${esc(ext.label||ext.provider||"外部入口")}</span><span>${esc(mode)}</span><span>${esc(externalStatusText(ext.status))}</span></div>`:""}
        </div>
      </div>
      ${card.type==="qr"?`<div class="bc-qr">${UI.qrCode(card.code||title)}</div>`:""}
      <button class="bc-action" type="button" data-card="${i}"><span>${esc(action)}</span>${I("arrow")}</button>
    </div>`;
  }

  function openResponseCard(card){
    const ext=card.external||null;
    if(ext && openConfiguredExternal(ext)) return;
    if(ext){ showExternalInfo(card); return; }
    openLocalForCard(card);
  }
  function hasPlaceholder(s){ return /\{[^}]+\}/.test(String(s||"")); }
  function validOriginalId(s){ return /^gh_[A-Za-z0-9_-]+$/.test(String(s||"")); }
  function validShortLink(s){ return /^#小程序:\/\/[^/\s]+(?:\/[^\s/]+){1,3}$/.test(String(s||"")); }
  function concretePath(ext){
    const p=ext.path || ext.openTagPath || ext.pathTemplate || "";
    return p && !hasPlaceholder(p) ? p : "";
  }
  function configuredUrl(s){
    return s && !hasPlaceholder(s) && /^(https?:\/\/|weixin:\/\/)/i.test(String(s)) ? String(s) : "";
  }
  function isWechat(){ return /MicroMessenger/i.test(navigator.userAgent||""); }
  function openConfiguredExternal(ext){
    const link=configuredUrl(ext.urlLink);
    if(link){ openExternalUrl(link); return true; }
    const scheme=configuredUrl(ext.urlScheme);
    if(scheme){ try{ location.href=scheme; }catch(e){ openExternalUrl(scheme); } return true; }
    const url=configuredUrl(ext.url || ext.urlTemplate);
    if(url){ openExternalUrl(url); return true; }
    return false;
  }
  function openExternalUrl(url){
    try{ window.open(url,"_blank","noopener"); }
    catch(e){ location.href=url; }
  }
  function realJumpGaps(ext){
    const gaps=[];
    if(configuredUrl(ext.urlLink) || configuredUrl(ext.urlScheme) || configuredUrl(ext.url || ext.urlTemplate)) return gaps;
    if(validShortLink(ext.shortLink)){
      gaps.push("已有微信 Short Link，可复制到微信内打开");
      gaps.push("当前短链范围："+(ext.shortLinkScope || "未标注"));
      gaps.push(ext.status==="short_link_ready" ? "网页内一键拉起仍需 URL Link/URL Scheme 或开放标签参数" : "该短链不是当前功能的精确分支，需春雨提供页面级入口");
    }
    if(ext.mode==="mini_program"){
      if(!validOriginalId(ext.username || ext.originalId)) gaps.push("春雨小程序原始 ID（gh_xxx，不是 wx 开头 appId）");
      if(!concretePath(ext)) gaps.push("已替换 token/session_id 的小程序 path");
      gaps.push("已认证公众号 JS-SDK 签名、JS 接口安全域名、openTagList");
      if(!validShortLink(ext.shortLink)) gaps.push("或由春雨/小程序主体提供 URL Link / URL Scheme / Short Link");
      if(!isWechat()) gaps.push("当前页面需在微信内置浏览器打开才能使用开放标签");
    }else if(ext.mode==="h5" || ext.mode==="h5_api"){
      gaps.push("服务端实时生成 partner/user_id/atime/sign 后的完整 H5 URL");
    }else if(ext.mode==="api"){
      gaps.push("后端先完成春雨 API 下单/建单，再返回可访问的订单或服务入口");
    }
    return gaps.concat((Array.isArray(ext.requires)?ext.requires:[]).filter(x=>!gaps.includes(x)));
  }
  function showExternalInfo(card){
    const ext=card.external||{};
    const req=(Array.isArray(ext.requires)?ext.requires:[]).map(x=>`<span class="ext-param">${esc(x)}</span>`).join("");
    const endpoint=ext.urlTemplate||ext.pathTemplate||ext.url||"待集团/春雨提供真实入口参数";
    const username=ext.username || ext.originalId || "";
    const openPath=concretePath(ext);
    const canWxOpen=ext.mode==="mini_program" && validOriginalId(username) && openPath;
    const hasShort=validShortLink(ext.shortLink);
    const gaps=realJumpGaps(ext);
    const jumpText=hasShort ? "已接入短链；网页内一键拉起仍需官方参数" : (gaps.length ? "当前缺参数，不能冒充已跳转" : "可直接发起跳转");
    const shortHelp=hasShort ? `<div class="note warn">${I("info")}<div><b>这个不是浏览器链接</b>：微信 Short Link 只能复制到微信内打开，Chrome/普通网页不能直接跳小程序。要网页一键拉起，需要春雨提供 URL Link/URL Scheme，或补齐 gh_xxx、真实 path 与公众号 JS-SDK 签名。</div></div>` : "";
    const gapHtml=gaps.length ? `<ul class="ext-gaps">${gaps.slice(0,8).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="ext-ok">${I("check")}已检测到可直跳入口，点击服务卡会直接打开。</div>`;
    const launchHtml=canWxOpen ? `<div class="ext-launch" id="wxLaunchMount">
          <div class="ext-launch-title">微信内真实拉起</div>
          <wx-open-launch-weapp id="wxLaunchBtn" username="${esc(username)}" path="${esc(openPath)}">
            <script type="text/wxtag-template">
              <style>.launch{display:block;width:100%;height:44px;line-height:44px;text-align:center;border-radius:10px;background:#0A6E8C;color:#fff;font-size:15px;font-weight:700;border:0;}</style>
              <button class="launch">打开春雨小程序</button>
            </script>
          </wx-open-launch-weapp>
          <div class="wx-launch-status">正在检查微信 JS-SDK 配置...</div>
        </div>` : "";
    modal(`<div class="m-t">${esc(ext.label||card.title||"春雨入口")}</div>
      <div class="m-b ext-info">
        ${shortHelp}
        <p>${esc(ext.note||"只有拿到真实跳转参数后才会直跳；缺参时仅展示接入缺口。")}</p>
        <div><b>真实跳转</b><span>${jumpText}</span></div>
        <div><b>接入方式</b><span>${esc((ext.mode||"h5").replace("_","/").toUpperCase())}</span></div>
        ${ext.service?`<div><b>服务</b><span>${esc(ext.service)}</span></div>`:""}
        ${ext.appId?`<div><b>小程序 appId</b><span>${esc(ext.appId)}</span></div>`:""}
        ${username?`<div><b>原始 ID</b><span>${esc(username)}</span></div>`:""}
        ${hasShort?`<div><b>小程序短链</b><code>${esc(ext.shortLink)}</code></div><div><b>短链范围</b><span>${esc(ext.shortLinkScope||"未标注")}</span></div>`:""}
        <div><b>入口模板</b><code>${esc(endpoint)}</code></div>
        ${req?`<div><b>还需要</b><span class="ext-params">${req}</span></div>`:""}
        <div><b>缺口</b><span>${gapHtml}</span></div>
        ${launchHtml}
      </div>
      <div class="m-a"><button class="cancel">关闭</button>${hasShort?'<button class="copy-short">复制微信短链</button>':(ext.docUrl?'<button class="doc">官方文档</button>':"")}<button class="ok local">打开本地备用</button></div>`,
      m=>{
        $(".cancel",m).onclick=()=>m.remove();
        const docBtn=$(".doc",m); if(docBtn) docBtn.onclick=()=>openExternalUrl(ext.docUrl);
        const copyBtn=$(".copy-short",m); if(copyBtn) copyBtn.onclick=()=>copyText(ext.shortLink, "已复制春雨医生小程序短链，请粘贴到微信内打开");
        $(".local",m).onclick=()=>{ m.remove(); openLocalForCard(card); };
        if(canWxOpen) setupWechatLaunch(m);
      });
  }
  function copyText(text, msg){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(()=>toast(msg||"已复制")).catch(()=>fallbackCopy(text,msg));
    }else fallbackCopy(text,msg);
  }
  function fallbackCopy(text,msg){
    const ta=document.createElement("textarea");
    ta.value=text; ta.style.position="fixed"; ta.style.left="-9999px"; document.body.appendChild(ta);
    ta.focus(); ta.select();
    try{ document.execCommand("copy"); toast(msg||"已复制"); }
    catch(e){ toast("复制失败，请手动复制短链"); }
    ta.remove();
  }
  let wxSdkLoading=null;
  function loadWechatSdk(){
    if(window.wx && window.wx.config) return Promise.resolve(window.wx);
    if(wxSdkLoading) return wxSdkLoading;
    wxSdkLoading=new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js";
      s.onload=()=>window.wx ? resolve(window.wx) : reject(new Error("微信 JS-SDK 未挂载"));
      s.onerror=()=>reject(new Error("微信 JS-SDK 加载失败"));
      document.head.appendChild(s);
    });
    return wxSdkLoading;
  }
  function setupWechatLaunch(root){
    const status=$(".wx-launch-status",root);
    if(!status) return;
    if(!isWechat()){ status.textContent="当前不是微信内置浏览器，开放标签不会生效；请配置 URL Link/Scheme 或在微信 H5 域名中测试。"; return; }
    loadWechatSdk().then(wx=>{
      const signedUrl=location.href.split("#")[0];
      return fetch("/api/wechat/js-config?url="+encodeURIComponent(signedUrl)).then(r=>r.json()).then(cfg=>{
        if(!cfg.configured) throw new Error(cfg.error || "微信 JS-SDK 未配置");
        wx.config({ debug:false, appId:cfg.appId, timestamp:cfg.timestamp, nonceStr:cfg.nonceStr, signature:cfg.signature, jsApiList:[], openTagList:["wx-open-launch-weapp"] });
        wx.ready(()=>{ status.textContent="微信配置已就绪，请点击上方按钮拉起春雨小程序。"; });
        wx.error(e=>{ status.textContent="微信配置失败："+(e && (e.errMsg || e.message) || "unknown"); });
      });
    }).catch(e=>{ status.textContent=e.message || "微信开放标签配置失败"; });
  }

  function openLocalForCard(card){
    const page=card.fallbackPage||card.page||"";
    const C=DATA.content||{};
    if(card.type==="popup" && card.modal==="hospitalPhone"){ openPhone(); return; }
    if(card.type==="qr"){
      modal(`<div class="m-t">${esc(card.name||"二维码")}</div><div class="m-b qr-wrap"><div class="qr">${UI.qrCode(card.code||card.name||"二维码")}</div><p>${esc(card.caption||"请扫码继续")}</p></div><div class="m-a"><button class="ok">知道了</button></div>`,m=>$(".ok",m).onclick=()=>m.remove());
      return;
    }
    if(page.indexOf("article:")===0){
      const key=page.split(":")[1];
      const map={clinic:C.clinicArticle,diet:C.dietArticle,copy:C.copyArticle,surgery:C.surgeryArticle};
      if(map[key]){ openArticle(map[key]); return; }
    }
    const actions={
      "doctor-profile":()=>openProfile(),
      "doctor-video":()=>openVideo(C.doctorVideo||{}),
      "video-consult":()=>openVideoConsult(C.videoConsult||{}),
      "contact-form":()=>openContact(C.contactForm||{}),
      "add-number":()=>openForm(C.addNumber||{}, {type:"加号", schedule:true}),
      "admission":()=>openForm(C.admission||{}, {type:"住院预约", notes:(C.admission||{}).notes}),
      "replies":()=>openReplies(),
      "accounts":()=>openAccounts(),
      "faq":()=>openFaq(),
      "thank-doctor":()=>openThankDoctor(),
      "story":()=>openStory(),
      "poster":()=>openPoster(),
      "review":()=>{ openProfile(); setTimeout(()=>{ const tabs=document.querySelectorAll('.view .tabs button[data-i="2"]'); const b=tabs[tabs.length-1]; if(b) b.click(); },0); }
    };
    if(actions[page]) actions[page]();
    else toast("该入口还需要配置真实链接");
  }

  /* 分级紧急度卡：紧急度 + 就诊时间窗/地点 + 直接行动入口（加号/住院/电话/转人工/120） */
  function triageCard(thread,tri){
    const u=tri.urgency||{};
    const sev=u.severity||(tri.riskLevel==="high"?"danger":tri.riskLevel==="medium"?"warn":"info");
    const fns=functions();
    const open={
      add:()=>{ const f=fns.find(x=>x.key==="add"); f?f.open():toast("可在首页申请门诊加号"); },
      adm:()=>{ const f=fns.find(x=>x.key==="adm"); f?f.open():toast("可在首页提交住院预约"); },
      tel:()=>{ const f=fns.find(x=>x.key==="tel"); f?f.open():toast("可在首页查看医院电话"); },
      human:()=>toast("已为您转接人工医助，请留意医生团队回复"),
      "120":()=>toast("如情况紧急，请立即拨打 120 或前往最近医院急诊")
    };
    const card=el(`<div class="escalate ${esc(sev)}">
      <div class="et">${I(sev==="danger"?"warn":"info")}<span>${esc(u.label||(sev==="danger"?"建议尽快线下就医":"这个问题建议由医生处理"))}</span></div>
      <div class="ut-meta">
        ${u.timeframe?`<span class="ut-chip">建议时间：${esc(u.timeframe)}</span>`:""}
        ${u.venue?`<span class="ut-chip">就诊去向：${esc(u.venue)}</span>`:""}
      </div>
      <div class="ut-advice">${esc(u.advice||tri.suggestedAction||"群内沟通不能替代面诊，建议进一步由医生评估。")}</div>
      <div class="acts"></div></div>`);
    const actsBox=card.querySelector(".acts");
    let list=(Array.isArray(tri.actions)&&tri.actions.length)?tri.actions:defaultActs(sev);
    list.filter(a=>a.key==="120"||a.key==="human"||fns.some(f=>f.key===a.key)).forEach(a=>{
      const b=el(`<button data-a="${esc(a.key)}" class="act-${esc(a.kind||"ghost")}">${esc(a.label)}</button>`);
      b.onclick=open[a.key]||(()=>{}); actsBox.appendChild(b);
    });
    thread.appendChild(card); thread.scrollTop=thread.scrollHeight;
  }
  function defaultActs(sev){
    return sev==="danger" ? [{key:"human",label:"转人工咨询",kind:"ghost"},{key:"120",label:"建议拨打 120",kind:"danger"}]
                          : [{key:"human",label:"转人工咨询",kind:"ghost"},{key:"add",label:"门诊加号",kind:"primary"}];
  }

  /* ---------- 我的随访（手机验证 → 随访时间轴） ---------- */
  function openFollowup(){
    const body=el(`<div>
      <div class="note info">${I("shield")}<div>随访计划与您的就诊资料相关，请用<b>建档手机号</b>验证后查看您的随访进度与复诊提醒。</div></div>
      <form class="panel" id="ffrm">
        <div class="field" data-f="phone"><label>建档手机号<span class="req">*必填</span></label>
          <div class="with-btn"><input type="tel" id="fph" placeholder="建档时填写的手机号"/><button type="button" class="codebtn" id="fsendc">获取验证码</button></div>
          <div class="err">${I("warn")}请输入正确的 11 位手机号</div></div>
        <div class="field" data-f="code"><label>短信验证码<span class="req">*必填</span></label>
          <input type="text" id="fcd" placeholder="6 位验证码" inputmode="numeric"/>
          <div class="err">${I("warn")}请输入验证码</div></div>
      </form>
      <div id="fresult"></div></div>`);
    const cta=el(`<button class="btn btn-primary" id="fsub">查看我的随访</button>`);
    const v=openView("我的随访",body,{cta});
    const phone=()=>$("#fph",body).value.trim();
    let timer=null;
    $("#fsendc",body).onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      const btn=$("#fsendc",body); btn.disabled=true;
      fetch("/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone()})}).then(r=>r.json()).then(res=>{
        if(res.error){ btn.disabled=false; toast(res.error); return; }
        toast("验证码已发送："+res.code+"（演示态）");
        let t=60; btn.textContent=t+"s"; timer=setInterval(()=>{ if(--t<=0){ clearInterval(timer); btn.disabled=false; btn.textContent="获取验证码"; } else btn.textContent=t+"s"; },1000);
      }).catch(()=>{ btn.disabled=false; toast("发送失败"); });
    };
    cta.onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      if(!$("#fcd",body).value.trim()){ body.querySelector('[data-f="code"]').classList.add("invalid"); toast("请输入验证码"); return; }
      cta.disabled=true; cta.textContent="查询中…";
      fetch("/api/followup/mine",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,phone:phone(),code:$("#fcd",body).value.trim()})})
        .then(r=>r.json()).then(res=>{
          cta.disabled=false; cta.textContent="查看我的随访";
          if(res&&res.error){ toast(res.error); return; }
          renderFollowups($("#fresult",body), res.followups||[]);
          $("#ffrm",body).style.display="none"; cta.style.display="none";
        }).catch(()=>{ cta.disabled=false; cta.textContent="查看我的随访"; toast("网络异常，请重试"); });
    };
  }
  function renderFollowups(box, list){
    if(!list.length){ box.innerHTML='<div class="panel"><p style="color:#9aa7ad">您当前没有进行中的随访计划。术后可在「医患联络表」选择随访方案加入，或联系医助开通。</p></div>'; return; }
    box.innerHTML=list.map(fuCard).join("");
    box.querySelectorAll("[data-fa]").forEach(b=>b.onclick=()=>{ const f=functions().find(x=>x.key===b.dataset.fa); if(f) f.open(); else if(b.dataset.fa==="consult") openAssistant(); });
  }
  function fuCard(fu){
    const stText={done:"已完成",pushed:"已推送",due:"待跟进",upcoming:"待开始"};
    const actLabel={add:"门诊加号",consult:"在线咨询",adm:"住院预约"};
    return `<div class="panel fu-plan">
      <div class="fu-head"><div class="fu-name">${esc(fu.planName)}</div><div class="fu-prog">${fu.done}/${fu.total} 已完成 · 起算 ${esc(fu.enrolledAt)}</div></div>
      <div class="fu-timeline">${(fu.nodes||[]).map(n=>`
        <div class="fu-node ${esc(n.state)}"><div class="fu-dot"></div>
          <div class="fu-body">
            <div class="fu-t">${esc(n.title)} <span class="fu-date">${esc(n.dueDate)}</span><span class="fu-badge ${esc(n.state)}">${stText[n.state]||""}</span></div>
            ${n.edu?`<div class="fu-edu">${escBr(n.edu)}</div>`:""}
            ${n.reminder?`<div class="fu-rem">${I("info")}<span>${escBr(n.reminder)}</span></div>`:""}
            ${(n.state==="due"&&n.action)?`<button class="fu-act" data-fa="${esc(n.action)}">${actLabel[n.action]||"去处理"}</button>`:""}
          </div></div>`).join("")}</div></div>`;
  }

  /* ---------- 查看回复 / 跟进状态 ---------- */
  function openReplies(){
    const cfg = DATA.content.replyCenter || {};
    const body=el(`<div>
      <div class="note info">${I("shield")}<div>${esc(cfg.desc||"请用建档手机号验证后查看您的提交记录和跟进状态。")}</div></div>
      <form class="panel" id="qfrm">
        <div class="field" data-f="phone"><label>建档手机号<span class="req">*必填</span></label>
          <div class="with-btn"><input type="tel" id="qph" placeholder="建档时填写的手机号"/><button type="button" class="codebtn" id="qsendc">获取验证码</button></div>
          <div class="err">${I("warn")}请输入正确的 11 位手机号</div></div>
        <div class="field" data-f="code"><label>短信验证码<span class="req">*必填</span></label>
          <input type="text" id="qcd" placeholder="6 位验证码" inputmode="numeric"/>
          <div class="err">${I("warn")}请输入验证码</div></div>
      </form>
      <div id="qresult"></div></div>`);
    const cta=el(`<button class="btn btn-primary">查看我的记录</button>`);
    openView(cfg.title||"查看回复",body,{cta});
    const phone=()=>$("#qph",body).value.trim();
    let timer=null;
    $("#qsendc",body).onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      const btn=$("#qsendc",body); btn.disabled=true;
      fetch("/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone()})}).then(r=>r.json()).then(res=>{
        if(res.error){ btn.disabled=false; toast(res.error); return; }
        toast("验证码已发送："+res.code+"（演示态）");
        let t=60; btn.textContent=t+"s"; timer=setInterval(()=>{ if(--t<=0){ clearInterval(timer); btn.disabled=false; btn.textContent="获取验证码"; } else btn.textContent=t+"s"; },1000);
      }).catch(()=>{ btn.disabled=false; toast("发送失败"); });
    };
    cta.onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      if(!$("#qcd",body).value.trim()){ body.querySelector('[data-f="code"]').classList.add("invalid"); toast("请输入验证码"); return; }
      cta.disabled=true; cta.textContent="查询中…";
      fetch("/api/replies/mine",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,phone:phone(),code:$("#qcd",body).value.trim()})})
        .then(r=>r.json()).then(res=>{
          cta.disabled=false; cta.textContent="查看我的记录";
          if(res&&res.error){ toast(res.error); return; }
          renderReplies($("#qresult",body), res.replies||[], res.followups||[]);
          $("#qfrm",body).style.display="none"; cta.style.display="none";
        }).catch(()=>{ cta.disabled=false; cta.textContent="查看我的记录"; toast("网络异常，请重试"); });
    };
  }
  function renderReplies(box, replies, followups){
    const rows = replies.length ? replies.map(r=>`<div class="list-row" style="align-items:flex-start">
      <div class="lr-ic">${I("form")}</div><div class="lr-main"><div class="lr-t">${esc(r.type)} <span class="tag-mini">${esc(r.status||"")}</span></div>
      <div class="lr-d">${esc((r.at||"").replace("T"," ").slice(0,16))}</div>
      <div class="lr-d">${(r.summary||[]).map(esc).join("　")}</div></div></div>`).join("") :
      '<p style="color:#9aa7ad">暂未查到该手机号相关提交记录。</p>';
    const fu = followups.length ? `<div class="reply-fu"><h3>随访计划</h3>${followups.map(f=>`<div class="list-row"><div class="lr-ic">${I("clock")}</div><div class="lr-main"><div class="lr-t">${esc(f.planName)}</div><div class="lr-d">进度 ${f.done}/${f.total} · 起算 ${esc(f.enrolledAt)}</div></div></div>`).join("")}</div>` : "";
    box.innerHTML = `<div class="panel"><h3>我的提交与回复状态</h3>${rows}</div>${fu}`;
  }

  /* ---------- 按病种服务包 ---------- */
  function openPackages(){
    const pkgs=DATA.content.servicePackages||[], fns=functions();
    const body=el(`<div>
      <div class="note info">${I("shield")}<div>按您的<b>病种</b>把相关的咨询、加号、住院、随访、康复等服务打包在一起，少找少走弯路。</div></div>
      ${pkgs.map(p=>`<div class="panel pkg"><div class="pkg-dz">${esc(p.disease||"")}</div><h3>${esc(p.name)}</h3><p style="color:#4C6272">${esc(p.intro||"")}</p>
        <div class="pkg-items">${(p.items||[]).map(k=>{ const f=fns.find(x=>x.key===k); return f?`<button class="pkg-item" data-k="${esc(k)}"><span class="ic">${I(f.icon)}</span><span class="t">${esc(f.title)}</span></button>`:""; }).join("")}</div></div>`).join("")}
    </div>`);
    const v=openView("按病种服务",body);
    body.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{ const f=fns.find(x=>x.key===b.dataset.k); if(f) f.open(); });
  }

  /* ---------- 医生风采 ---------- */
  function openProfile(){
    const D=DATA.doctor, p=DATA.content.doctorProfile;
    const tags=(D.specialty||"").split(/[·\/、]/).map(s=>s.trim()).filter(Boolean);
    const body=el(`<div>
      <div class="hero-banner"><div class="hb-name">${esc(D.name)} <span style="font-size:1rem;font-weight:500">${esc(D.title||"")}</span></div>
        <div class="hb-sub">${esc(D.hospital||"")} · ${esc(D.dept||"")}</div></div>
      <div class="panel kv"><h3>关于${esc(D.name)}</h3>
        <p><b>擅长：</b>${esc(tags.join("、")||"专科诊疗")}</p>
        <p><b>简介：</b>${esc(p.intro||"")}</p>
        <p><b>怎么找他看病：</b>发起「在线咨询」先做评估；需要门诊可看「门诊时间」或申请「门诊加号」。</p></div>
      <div class="tabs">
        <button class="on" data-i="0">科普</button><button data-i="1">报道</button><button data-i="2">患者评价</button><button data-i="3">病历分享</button></div>
      <div class="panel">        <div class="tab-pane on">${listOr(p.columns,c=>row("book",c.t,c.d))}</div>
        <div class="tab-pane">${newsList(p.news)}</div>
        <div class="tab-pane" id="reviewPane">
          <div class="note info">${I("shield")}<div><b>认证口碑墙</b>：仅经「医患联络表」建档并通过本人手机验证的患者可发布，从源头杜绝刷评；为真实就医体验分享，不构成疗效承诺。</div></div>
          <button class="btn btn-ghost" id="writeReview" style="margin-bottom:14px">${I("heart")} 我要写认证评价</button>
          <div id="reviewList" class="review-list"><p style="color:#9aa7ad">加载中…</p></div>
        </div>
        <div class="tab-pane">${listOr(p.cases,c=>row("form",c.t,c.d))}</div></div>
      <div class="fix-note">${I("info")} 以上为脱敏示例内容；患者评价均来自建档患者的真实体验分享，不构成疗效承诺。</div>
    </div>`);
    const cta=el(`<button class="btn btn-primary">在线咨询黄主任</button>`); cta.onclick=()=>{ openAssistant(); };
    const v=openView("医生风采",body,{cta});
    const btns=body.querySelectorAll(".tabs button"), panes=body.querySelectorAll(".tab-pane");
    btns.forEach(b=>b.onclick=()=>{ btns.forEach(x=>x.classList.remove("on")); panes.forEach(x=>x.classList.remove("on")); b.classList.add("on"); panes[+b.dataset.i].classList.add("on"); });
    // 认证口碑墙：拉取已认证评价 + 写入口
    const listEl=$("#reviewList",body);
    loadReviews(listEl, p.thanks||[]);
    $("#writeReview",body).onclick=()=>openReviewForm(()=>loadReviews(listEl, p.thanks||[]));
  }
  function loadReviews(listEl, seed){
    fetch("/api/testimonials?doctorId="+DATA.doctor.id).then(r=>r.json())
      .then(items=>renderReviews(listEl, Array.isArray(items)?items:[], seed))
      .catch(()=>renderReviews(listEl, [], seed));
  }
  function renderReviews(listEl, items, seed){
    let html="";
    html += items.length ? items.map(t=>reviewCard(t.name,t.text,t.tail,true)).join("")
                         : '<p style="color:#9aa7ad;padding:6px 0">还没有认证评价，建档后欢迎成为第一位分享真实体验的患者。</p>';
    if(seed && seed.length) html += '<div class="review-seed-label">示例评价（示意，不构成疗效承诺）</div>'+seed.map(c=>reviewCard(c.name,c.text,"",false)).join("");
    listEl.innerHTML=html;
  }
  function reviewCard(name,text,tail,verified){
    return `<div class="review-card"><div class="rc-head"><div class="av">${UI.userAvatar(name||"友")}</div>
      <div class="rc-who">${esc(name||"建档患者")}${tail?` <span class="rc-tail">尾号${esc(tail)}</span>`:""}</div>
      ${verified?`<span class="rc-badge">${I("shield")}已认证患者</span>`:`<span class="rc-badge demo">示意</span>`}</div>
      <div class="rc-text">${escBr(text)}</div></div>`;
  }
  /* 写认证评价（建档手机号 + 短信验证 + 长文） */
  function openReviewForm(onPosted){
    const body=el(`<div>
      <div class="note info">${I("shield")}<div>认证口碑墙仅向<b>已建档患者</b>开放：请用您<b>建档时填写的手机号</b>完成验证；署名将自动使用您的<b>建档姓名并脱敏</b>展示。请勿使用「根治 / 100% / 最好」等绝对化用语。</div></div>
      <form class="panel" id="rfrm">
        <div class="field" data-f="phone"><label>建档手机号<span class="req">*必填</span></label>
          <div class="with-btn"><input type="tel" id="rph" placeholder="建档时填写的手机号"/><button type="button" class="codebtn" id="rsendc">获取验证码</button></div>
          <div class="err">${I("warn")}请输入正确的 11 位手机号</div></div>
        <div class="field" data-f="code"><label>短信验证码<span class="req">*必填</span></label>
          <input type="text" id="rcd" placeholder="6 位验证码" inputmode="numeric"/>
          <div class="err">${I("warn")}请输入验证码</div></div>
        <div class="field" data-f="text"><label>我的就医体验<span class="req">*必填</span></label>
          <textarea id="rtx" placeholder="说说您在这里的真实就医 / 康复经历…（至少 10 字）"></textarea>
          <div class="hint">真实体验分享，不构成疗效承诺；通过后展示为「已认证患者」。</div>
          <div class="err">${I("warn")}至少写 10 个字</div></div>
      </form></div>`);
    const cta=el(`<button class="btn btn-primary" id="rsub">提交认证评价</button>`);
    const v=openView("写认证评价",body,{cta});
    const phone=()=>$("#rph",body).value.trim();
    let timer=null;
    $("#rsendc",body).onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      const btn=$("#rsendc",body); btn.disabled=true;
      fetch("/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone()})}).then(r=>r.json()).then(res=>{
        if(res.error){ btn.disabled=false; toast(res.error); return; }
        toast("验证码已发送："+res.code+"（演示态）");
        let t=60; btn.textContent=t+"s"; timer=setInterval(()=>{ if(--t<=0){ clearInterval(timer); btn.disabled=false; btn.textContent="获取验证码"; } else btn.textContent=t+"s"; },1000);
      }).catch(()=>{ btn.disabled=false; toast("发送失败"); });
    };
    cta.onclick=()=>{
      const form=$("#rfrm",body); let ok=true;
      const mark=(k,bad)=>{ const w=form.querySelector(`[data-f="${k}"]`); if(w){ w.classList.toggle("invalid",bad); if(bad) ok=false; } };
      mark("phone", !/^1[3-9]\d{9}$/.test(phone()));
      mark("code", !$("#rcd",body).value.trim());
      mark("text", $("#rtx",body).value.trim().length<10);
      if(!ok){ toast("请检查标红的必填项"); return; }
      cta.disabled=true; cta.textContent="提交中…";
      fetch("/api/testimonial",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        doctorId:DATA.doctor.id, phone:phone(), code:$("#rcd",body).value.trim(), text:$("#rtx",body).value.trim()
      })}).then(r=>r.json()).then(res=>{
        if(res&&res.error){ cta.disabled=false; cta.textContent="提交认证评价"; toast(res.error); return; }
        closeView(v); toast("已发布认证评价，感谢您的分享"); if(onPosted) onPosted();
      }).catch(()=>{ cta.disabled=false; cta.textContent="提交认证评价"; toast("网络异常，请重试"); });
    };
  }
  function listOr(arr,fn){ return (arr&&arr.length)?arr.map(fn).join(""):'<p style="color:#9aa7ad">暂无内容</p>'; }
  function row(ic,t,d){ return `<div class="list-row"><div class="lr-ic">${I(ic)}</div><div class="lr-main"><div class="lr-t">${esc(t)}</div><div class="lr-d">${esc(d)}</div></div><div class="lr-go">${I("arrow")}</div></div>`; }
  /* 报道：仅春雨域条目（bootstrap 已过滤）；有 img 贴图，点击打开春雨链接 */
  function newsList(arr){
    const list = Array.isArray(arr) ? arr.filter(c=>c && c.url) : [];
    if(!list.length) return '<p style="color:#9aa7ad">暂无春雨报道内容，素材到位后会自动展示</p>';
    return list.map(c=>{
      const img = c.img ? `<img class="news-thumb" src="${esc(c.img)}" alt="" loading="lazy"/>` : `<div class="lr-ic">${I("book")}</div>`;
      return `<a class="list-row news-row" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${img}<div class="lr-main"><div class="lr-t">${esc(c.t||"")}</div><div class="lr-d">${esc(c.d||"春雨医生")}</div></div><div class="lr-go">${I("arrow")}</div></a>`;
    }).join("");
  }

  /* ---------- 医生视频 ---------- */
  function openVideo(v){
    const body=el(`<div>
      <div class="hero-banner" style="text-align:center;padding:38px 24px">
        <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">${I("video")}</div>
        <div class="hb-name" style="font-size:1.125rem">${esc(v.title||"医生自我介绍")}</div>
        <div class="hb-sub">时长 ${esc(v.duration||"01:00")} · 点击播放（演示态占位）</div></div>
      <div class="panel"><p>${esc(v.caption||"")}</p>
        <p style="color:#9aa7ad;font-size:.9375rem;margin-top:8px">演示态：此处为视频占位，不会真实播放。</p></div></div>`);
    openView("医生视频",body);
  }

  /* ---------- 视频问诊入口 ---------- */
  function openVideoConsult(v){
    const body=el(`<div>
      <div class="note warn">${I("warn")}<div>${esc(v.note||"视频问诊不能处理急症；如有明显不适请及时线下就医。")}</div></div>
      <div class="panel" style="text-align:center">
        <div style="width:86px;height:86px;margin:0 auto 12px;color:#0A6E8C">${I("video")}</div>
        <h3>${esc(v.title||"视频问诊")}</h3>
        <p style="color:#4C6272;line-height:1.8">${esc(v.desc||"如医生开通视频问诊，可通过外部平台发起。")}</p>
        <div style="display:inline-block;margin:14px auto;padding:12px;border:1px solid #E6EEF0;border-radius:16px;background:#fff">${UI.qrCode(v.qr||DATA.doctor.name+"视频问诊")}</div>
        <div class="fix-note">${I("info")} 平台：${esc(v.platform||"待配置")} · 状态：${esc(v.status||"待开通")}</div>
      </div></div>`);
    const cta=el(`<button class="btn btn-primary">先做图文预问诊</button>`);
    cta.onclick=openAssistant;
    openView("视频问诊",body,{cta});
  }

  /* ---------- 文章（门诊/饮食/复印） ---------- */
  function openArticle(a){
    const readText = (a.title||"") + "。" + (a.body||[]).map(s=>(s.h||"")+"。"+(s.p||"")).join("。") + (a.tip?("。"+a.tip):"");
    const body=el(`<div class="panel article">
      <div class="art-top"><h3 style="font-size:1.25rem;margin:0">${esc(a.title)}</h3></div>
      <div style="color:#9aa7ad;font-size:.875rem;margin:6px 0 14px">${esc(a.source||"")} · 演示</div>
      ${(a.body||[]).map(s=>`<h4>${esc(s.h)}</h4><p>${escBr(s.p)}</p>`).join("")}
      ${a.tip?`<div class="tip">💡 ${escBr(a.tip)}</div>`:""}</div>`);
    $(".art-top",body).appendChild(ttsButton(readText));
    openView("健康指引",body);
  }

  /* ---------- 科普账号 ---------- */
  function openAccounts(){
    const D=DATA.doctor;
    const platIcon=p=>/微信|公众号/.test(p)?"chat":/视频号/.test(p)?"video":/抖音/.test(p)?"sound":/好大夫/.test(p)?"shield":/微医/.test(p)?"plus":"book";
    const body=el(`<div class="panel"><h3>${esc(D.name)} · 科普账号</h3>
      ${(D.accounts||[]).map(a=>`<div class="list-row"><div class="lr-ic care" style="background:#E7F6F4;color:#1FA6A0">${I(platIcon(a.platform))}</div>
        <div class="lr-main"><div class="lr-t">${esc(a.platform)}</div><div class="lr-d">${esc(a.handle)}</div></div><div class="lr-go lr-follow">关注</div></div>`).join("")}
      <p style="color:#9aa7ad;font-size:.875rem;margin-top:12px">演示态：账号为占位，点击不跳转真实平台。</p></div>`);
    const v=openView("科普专栏",body);
    body.querySelectorAll(".list-row").forEach(r=>r.onclick=()=>toast("演示态：不跳转真实平台"));
  }

  /* ---------- 感谢信（复用 story 本地提交机制；患者自己写，转后台人工，不接 AI 生成） ---------- */
  function openStory(){
    const s=DATA.content.story;
    const body=el(`<div>
      <div class="panel"><h3>${esc(s.title)}</h3><p>${esc(s.intro)}</p>
        ${(s.prompts&&s.prompts.length)?`<div class="story-prompts">${s.prompts.map(x=>`<span>${esc(x)}</span>`).join("")}</div>`:""}
        <textarea id="st" placeholder="写下您想对医生团队说的感谢…" style="width:100%;min-height:84px;border:1.5px solid #D8DDE0;border-radius:12px;padding:12px;font-size:1.0625rem;font-family:inherit;margin-top:12px;outline:none"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary" id="post" type="button">发送感谢信</button></div></div>
      <div id="slist"></div></div>`);
    const v=openView("感谢信",body);
    const list=$("#slist",body);
    const card=(name,text)=>el(`<div class="story-card"><div class="head"><div class="av">${UI.userAvatar(name)}</div><div class="nm">${esc(name)}</div></div><div class="txt">${escBr(text)}</div></div>`);
    (s.samples||[]).forEach(x=>list.appendChild(card(x.name,x.text)));
    fetch("/api/stories?doctorId="+DATA.doctor.id).then(r=>r.json()).then(rows=>rows.forEach(x=>list.appendChild(card(x.name||"群友",x.text)))).catch(()=>{});
    $("#post",body).onclick=()=>{ const t=$("#st",body).value.trim(); if(!t){ toast("先写下您想说的感谢吧"); return; }
      fetch("/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,type:"story",payload:{name:"我",text:t}})})
        .then(()=>{ list.prepend(card("我",t)); $("#st",body).value=""; toast("已提交，感谢您的鼓励"); }).catch(()=>toast("网络异常")); };
  }

  /* ---------- FAQ ---------- */
  function openFaq(){
    const body=el(`<div>${(DATA.faq||[]).map(g=>`<div class="panel"><h3>${esc(g.title)}</h3>
      ${g.items.map(it=>`<div class="list-row" style="flex-direction:column;align-items:stretch;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:center"><div class="lr-t">${esc(it.q)}</div><div class="lr-go faqarr">${I("arrow")}</div></div>
        <div class="faqa" style="max-height:0;overflow:hidden;transition:max-height .25s;color:#4C6272;font-size:1rem;line-height:1.7"><div style="padding-top:8px">${escBr(it.a)}</div></div></div>`).join("")}</div>`).join("")}</div>`);
    const v=openView("常见问题",body);
    body.querySelectorAll(".list-row").forEach(rw=>{ const a=rw.querySelector(".faqa"); rw.onclick=()=>{ const open=a.style.maxHeight&&a.style.maxHeight!=="0px"; a.style.maxHeight=open?"0":(a.scrollHeight+16)+"px"; rw.querySelector(".faqarr").style.transform=open?"":"rotate(90deg)"; }; });
  }

  /* ---------- 感谢医生 ---------- */
  function openThankDoctor(){
    const c=DATA.content.thankDoctor||{};
    const body=el(`<div>
      <div class="note info">${I("shield")}<div>${esc(c.desc||"感谢内容会先进入后台待审核，不直接公开展示。")}</div></div>
      <form class="panel" id="tfrm">
        <div class="field" data-f="phone"><label>手机号<span class="req">*必填</span></label>
          <div class="with-btn"><input type="tel" id="tph" placeholder="用于验证和防刷"/><button type="button" class="codebtn" id="tsendc">获取验证码</button></div>
          <div class="err">${I("warn")}请输入正确的 11 位手机号</div></div>
        <div class="field" data-f="code"><label>短信验证码<span class="req">*必填</span></label><input type="text" id="tcd" placeholder="6 位验证码" inputmode="numeric"/><div class="err">${I("warn")}请输入验证码</div></div>
        <div class="field" data-f="text"><label>感谢内容<span class="req">*必填</span></label><textarea id="ttx" placeholder="${esc((c.placeholders&&c.placeholders[0])||"写一段想对医生团队说的话…")}"></textarea><div class="err">${I("warn")}至少写 5 个字</div></div>
        <label class="c-check"><input type="checkbox" id="tconsent"/><span>我同意提交该感谢内容供医生团队查看，并确认不包含他人隐私信息</span></label>
      </form></div>`);
    const cta=el(`<button class="btn btn-primary">提交感谢</button>`);
    openView(c.title||"感谢医生",body,{cta});
    const phone=()=>$("#tph",body).value.trim();
    let timer=null;
    $("#tsendc",body).onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      const btn=$("#tsendc",body); btn.disabled=true;
      fetch("/api/sms/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone()})}).then(r=>r.json()).then(res=>{
        if(res.error){ btn.disabled=false; toast(res.error); return; }
        toast("验证码已发送："+res.code+"（演示态）");
        let t=60; btn.textContent=t+"s"; timer=setInterval(()=>{ if(--t<=0){ clearInterval(timer); btn.disabled=false; btn.textContent="获取验证码"; } else btn.textContent=t+"s"; },1000);
      }).catch(()=>{ btn.disabled=false; toast("发送失败"); });
    };
    cta.onclick=()=>{
      let ok=true;
      const mark=(k,bad)=>{ const w=body.querySelector(`[data-f="${k}"]`); if(w){ w.classList.toggle("invalid",bad); if(bad) ok=false; } };
      mark("phone", !/^1[3-9]\d{9}$/.test(phone()));
      mark("code", !$("#tcd",body).value.trim());
      mark("text", $("#ttx",body).value.trim().length<5);
      if(!$("#tconsent",body).checked){ ok=false; toast("请先勾选同意提交"); }
      if(!ok) return;
      cta.disabled=true; cta.textContent="提交中…";
      fetch("/api/thanks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,phone:phone(),code:$("#tcd",body).value.trim(),text:$("#ttx",body).value.trim(),consent:true})})
        .then(r=>r.json()).then(res=>{ if(res&&res.error){ cta.disabled=false; cta.textContent="提交感谢"; toast(res.error); return; } toast("已提交给医生团队，感谢您的鼓励"); document.querySelectorAll(".view").forEach(v=>closeView(v)); })
        .catch(()=>{ cta.disabled=false; cta.textContent="提交感谢"; toast("网络异常，请重试"); });
    };
  }

  /* ---------- 介绍给亲友（海报） ---------- */
  function openPoster(){
    // 群活码 / 真实海报图（均可选）在 content 里、DATA.doctor 不含，合并后交 UI.poster——
    // UI 内部对两者都做白名单校验：posterImage 校验通过时直接渲染真实图（优先），
    // 否则回退生成 SVG 海报（现状不变，字节级一致）。
    const C = DATA.content || {};
    const d = Object.assign({}, DATA.doctor, { groupQrImage:C.groupQrImage, posterImage:C.posterImage });
    const posterHtml = UI.poster(d);
    const isRealImg = /^<img /.test(posterHtml);      // 由 UI.poster 内部白名单校验结果决定，不重复校验
    const body=el(`<div><div class="poster-frame">${posterHtml}</div>
      <div class="fix-note" style="margin-top:16px">${I("info")} ${isRealImg ? "医生真实海报：已含群活码，可点击下方保存，或直接长按图片保存分享。" : "合规版海报：不含「疗效/好评率」等绝对化用语，仅展示客观信息。"}</div></div>`);
    const cta=el(`<button class="btn btn-primary">${isRealImg ? "保存海报图片" : "保存海报 SVG"}</button>`);
    cta.onclick=()=>{
      if(isRealImg){
        const a = document.createElement("a");
        a.href = C.posterImage; a.download = `${DATA.doctor.name || "医生"}推荐海报.jpg`; a.click();
        toast("已开始保存海报图片（如未自动下载，请长按图片保存）");
        return;
      }
      const blob = new Blob([posterHtml], {type:"image/svg+xml;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${DATA.doctor.name || "医生"}推荐海报.svg`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 500);
      toast("已生成海报文件");
    };
    openView("介绍给亲友",body,{cta});
  }

  /* ---------- 医院电话（弹窗） ---------- */
  function openPhone(){
    const D=DATA.doctor;
    modal(`<div class="m-t">${esc(D.hospital)}</div><div class="m-b">咨询电话<div class="big">${esc(D.hospitalPhone)}</div>工作时间 周一至周五 8:00–17:00</div>
      <div class="m-a"><button class="cancel">取消</button><button class="ok call">拨打</button></div>`,
      m=>{ $(".cancel",m).onclick=()=>m.remove(); $(".call",m).onclick=()=>{ m.remove(); toast("演示态：不会真实拨打"); }; });
  }

  /* ---------- 通用表单（加号/住院） ---------- */
  function openForm(cfg,opts){
    opts=opts||{};
    const tname=opts.type||cfg.title;
    const body=el(`<div><div class="panel"><h3>${esc(cfg.title)}</h3><p style="color:#4C6272">${esc(cfg.desc||"")}</p>
      ${(opts.notes||[]).length?`<ul style="margin:10px 0 0;padding-left:20px;color:#4C6272;font-size:1rem;line-height:1.8">${opts.notes.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}</div>
      ${cfg.requiresContactForm?`<div class="note info">${I("shield")}<div><b>加号前请先完成医患联络表。</b>系统会按手机号核对建档记录，未建档时无法直接提交加号申请。<button type="button" class="mini-btn" id="goContact">去填联络表</button></div></div>`:""}
      ${proxyToggleHtml()}
      <form class="panel" id="frm">${(cfg.fields||[]).map(fieldHtml).join("")}</form>
      ${proxyFieldsHtml()}
      <div class="panel"><label class="c-check inline-consent"><input type="checkbox" id="fconsent"/><span id="fconsentTxt">${consentLine(tname,false)}</span></label></div>
    </div>`);
    const cta=el(`<button class="btn btn-primary" id="sub">${esc(cfg.submitText||"提交")}</button>`);
    const v=openView(cfg.title,body,{cta});
    const form=$("#frm",body);
    const proxy=bindProxy(body, tname);
    const goContact=$("#goContact",body); if(goContact) goContact.onclick=()=>openContact(DATA.content.contactForm||{});
    cta.onclick=()=>{
      if(!validate(form,cfg.fields)) { toast("请检查标红的必填项"); return; }
      if(!proxy.validate()) { toast("请填写代办人信息"); return; }
      if(!$("#fconsent",body).checked){ toast("请先阅读并同意信息处理告知"); $("#fconsent",body).closest(".panel").classList.add("hl-c"); return; }
      const payload={}; let dateVal=null;
      cfg.fields.forEach(f=>{ const w=form.querySelector(`[data-f="${f.key}"]`); const val=(w.querySelector("input,select,textarea").value||"").trim(); payload[f.label]=val; if(f.type==="date"||f.key==="date") dateVal=val; });
      Object.assign(payload, proxy.payload());
      const b={doctorId:DATA.doctor.id,type:tname,payload,consent:true}; if(opts.schedule&&dateVal) b.date=dateVal;
      cta.disabled=true; cta.textContent="提交中…";
      fetch("/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(r=>r.json()).then(res=>{
        if(res&&res.error){ cta.disabled=false; cta.textContent=cfg.submitText||"提交";
          if(res.waitlistable){ const nf=(cfg.fields||[]).find(f=>f.key==="name"), pf=(cfg.fields||[]).find(f=>f.key==="phone");
            offerWaitlist(res.slot||dateVal, nf?payload[nf.label]:"", pf?payload[pf.label]:""); }
          else if(res.needsContactForm) offerContactFirst(res.error);
          else toast(res.error); return; }
        showDone(v,cfg.success);
      }).catch(()=>{ cta.disabled=false; cta.textContent=cfg.submitText||"提交"; toast("网络异常，请重试"); });
    };
  }
  function offerContactFirst(message){
    modal(`<div class="m-t">请先提交医患联络表</div>
      <div class="m-b">${esc(message||"加号申请前需要先完成基础信息建档。")}</div>
      <div class="m-a"><button class="cancel">稍后</button><button class="ok go">去填联络表</button></div>`,
      m=>{ $(".cancel",m).onclick=()=>m.remove();
        $(".go",m).onclick=()=>{ m.remove(); openContact(DATA.content.contactForm||{}); }; });
  }
  /* 智能候补名单：加号撞停诊/满号时，邀请加入候补，名额释放医助批量通知 */
  function offerWaitlist(slot, name, phone){
    modal(`<div class="m-t">该时段暂时约满 / 停诊</div>
      <div class="m-b">「${esc(slot||"该时段")}」当前无号。加入<b>候补名单</b>，名额释放后医助会第一时间通知您。</div>
      <div class="m-a"><button class="cancel">暂不</button><button class="ok join">加入候补</button></div>`,
      m=>{ $(".cancel",m).onclick=()=>m.remove();
        $(".join",m).onclick=()=>{
          fetch("/api/waitlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,slot,name,phone,consent:true})})
            .then(r=>r.json()).then(res=>{ m.remove(); toast(res&&res.already?"您已在该时段候补名单中":((res&&res.ok)?"已加入候补名单，名额释放将通知您":((res&&res.error)||"加入失败"))); })
            .catch(()=>{ m.remove(); toast("网络异常，请重试"); }); }; });
  }

  /* 家庭代办（子女代老人）+ 价值动作即时同意 —— 通用块 */
  function consentLine(type, proxy){
    return proxy
      ? `我<b>已获被办理人本人同意</b>，代为提交其姓名、手机号等个人信息用于办理本次${esc(type)}（仅本医生团队可见）。`
      : `我已阅读并<b>单独同意</b>为办理本次${esc(type)}处理上述姓名、手机号等个人信息（仅本医生团队可见）。`;
  }
  function consentAgreeHtml(){
    return `<div class="consent-agree" id="cons">
      <input type="checkbox" id="cchk" />
      <div class="consent-agree-txt">我已阅读并同意<button type="button" class="consent-link" id="openUserAgree">《用户协议》</button>和<button type="button" class="consent-link" id="openPrivacy">《隐私政策》</button>，并同意为建立档案与后续服务处理姓名、手机号、疾病及病历等信息</div>
    </div>`;
  }
  function openConsentDrawer(text, title){
    const existing = document.querySelector(".drawer-mask");
    if(existing) existing.remove();
    const drawerTitle = String(title || "隐私政策").trim() || "隐私政策";
    const d = el(`<div class="drawer-mask" role="dialog" aria-modal="true" aria-labelledby="consentDrawerTitle">
      <div class="drawer-sheet">
        <div class="drawer-handle" aria-hidden="true"></div>
        <div class="drawer-head">
          <div class="drawer-title" id="consentDrawerTitle">${esc(drawerTitle)}</div>
          <button type="button" class="drawer-close" aria-label="关闭">×</button>
        </div>
        <div class="drawer-body">${escBr(text || PRIVACY_DEFAULT)}</div>
        <div class="drawer-foot"><button type="button" class="btn btn-primary drawer-ok">我知道了</button></div>
      </div>
    </div>`);
    const close = ()=>{
      d.classList.remove("on");
      setTimeout(()=>d.remove(), 220);
    };
    d.addEventListener("click", e=>{ if(e.target === d) close(); });
    $(".drawer-close", d).onclick = close;
    $(".drawer-ok", d).onclick = close;
    document.body.appendChild(d);
    requestAnimationFrame(()=>d.classList.add("on"));
    return d;
  }
  function bindConsentAgree(root, consentText){
    const userLink = $("#openUserAgree", root);
    const privacyLink = $("#openPrivacy", root);
    if(userLink){
      userLink.onclick = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        openConsentDrawer(USER_AGREEMENT_DEFAULT, "用户协议");
      };
    }
    if(privacyLink){
      privacyLink.onclick = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        openConsentDrawer(consentText || PRIVACY_DEFAULT, "隐私政策");
      };
    }
  }
  function proxyToggleHtml(){
    return `<div class="panel invite-proxy"><label class="invite-proxy-label">办理方式</label>
      <div class="seg" id="proxySeg"><button type="button" class="seg-b on" data-who="self">本人办理</button><button type="button" class="seg-b" data-who="proxy">家人代办</button></div>
      <div class="hint" style="margin-top:8px">子女可代老人办理；选择「家人代办」后请填写您的联系方式。</div></div>`;
  }
  function proxyFieldsHtml(){
    return `<form class="panel proxy-fields" id="proxyFrm" hidden>
      <div class="field" data-f="agentName"><label>代办人姓名<span class="req">*必填</span></label><input type="text" placeholder="您（代办人）的姓名"/><div class="err">${I("warn")}请填写代办人姓名</div></div>
      <div class="field" data-f="agentPhone"><label>代办人手机<span class="req">*必填</span></label><input type="tel" placeholder="您（代办人）的手机号"/><div class="err">${I("warn")}请填写正确的 11 位手机号</div></div>
      <div class="field" data-f="relation"><label>与患者关系<span class="req">*必填</span></label><select><option value="">请选择</option><option>子女</option><option>配偶</option><option>父母</option><option>其他亲属</option></select><div class="err">${I("warn")}请选择关系</div></div>
    </form>`;
  }
  function bindProxy(body, type){
    const seg=$("#proxySeg",body), pf=$("#proxyFrm",body), ctxt=$("#fconsentTxt",body);
    // 家人代办时把「姓名」改为「患者姓名」，与下方「代办人姓名」区分，避免填错。
    const nameLabel=body.querySelector('.field[data-f="name"] > label');
    const nameTextNode=nameLabel&&Array.from(nameLabel.childNodes).find(n=>n.nodeType===3);
    const nameLabelSelf=nameTextNode?String(nameTextNode.textContent||"").trim()||"姓名":"姓名";
    let who="self";
    function syncNameLabel(){
      if(!nameTextNode) return;
      nameTextNode.textContent = who==="proxy" ? "患者姓名" : nameLabelSelf;
    }
    seg.querySelectorAll(".seg-b").forEach(b=>b.onclick=()=>{
      who=b.dataset.who; seg.querySelectorAll(".seg-b").forEach(x=>x.classList.toggle("on",x===b));
      pf.hidden = who!=="proxy"; if(ctxt) ctxt.innerHTML=consentLine(type, who==="proxy");
      syncNameLabel();
    });
    return {
      validate(){
        if(who!=="proxy") return true;
        let ok=true; const mark=(k,bad)=>{ const w=pf.querySelector(`[data-f="${k}"]`); w.classList.toggle("invalid",bad); if(bad) ok=false; };
        mark("agentName", !pf.querySelector('[data-f="agentName"] input').value.trim());
        mark("agentPhone", !/^1[3-9]\d{9}$/.test(pf.querySelector('[data-f="agentPhone"] input').value.trim()));
        mark("relation", !pf.querySelector('[data-f="relation"] select').value);
        return ok;
      },
      payload(){
        if(who!=="proxy") return { 办理身份:"本人办理" };
        return { 办理身份:"家人代办", 代办人姓名:pf.querySelector('[data-f="agentName"] input').value.trim(),
          代办人手机:pf.querySelector('[data-f="agentPhone"] input').value.trim(), 与患者关系:pf.querySelector('[data-f="relation"] select').value };
      }
    };
  }

  /* ---------- 邀请问卷建档（无验证码；同号未验证需确认并档） ---------- */
  function inviteWelcomeLines(doctorName){
    const name = String(doctorName || "医生").trim() || "医生";
    return [
      "您所填信息只有医生可见，群内其他成员看不到，请放心填写。",
      `${name}医生团队将根据您的健康状况，提供针对性的就医及康复指导，请务必填写准确信息。`
    ];
  }
  function openInviteForm(token){
    const tok=String(token||"").trim();
    if(!tok){ toast("邀请链接无效"); return; }
    const loading=el(`<div class="panel invite-loading">正在打开医患联络表…</div>`);
    const vLoad=openView("医患联络表",loading,{hideBack:true});
    vLoad.classList.add("view-invite");
    fetch("/api/invite/"+encodeURIComponent(tok)).then(r=>r.json()).then(meta=>{
      closeView(vLoad);
      if(meta.error || !meta.ok){ toast(meta.error||"邀请链接无效"); return; }
      // 整页对齐邀请目标医生（勿沿用 bootstrap 默认/上线医生，避免标题与落库医生不一致）
      if(DATA){
        DATA.doctor = Object.assign({}, DATA.doctor || {}, {
          id: meta.doctorId,
          name: meta.doctorName || (DATA.doctor && DATA.doctor.name) || "",
          title: meta.doctorTitle || (DATA.doctor && DATA.doctor.title) || "",
          hospital: meta.hospital || (DATA.doctor && DATA.doctor.hospital) || ""
        });
      }
      const docName = meta.doctorName || "医生";
      const docTitle = meta.doctorTitle || "";
      const hospital = meta.hospital || "";
      const metaLine = [hospital, docTitle ? (docName + " · " + docTitle) : docName].filter(Boolean).join(" · ");
      const cfg={ title:"医患联络表", fields:meta.fields||[], submitText:"提交联络表", success:meta.success };
      const consentText=meta.consentText||(DATA.content&&DATA.content.consentText)||CONSENT_DEFAULT;
      const body=el(`<div class="invite-page">
        <section class="invite-hero" aria-label="建档说明">
          <p class="invite-kicker">春雨医服</p>
          <h1 class="invite-title">医患联络表</h1>
          <p class="invite-lead">${inviteWelcomeLines(docName).map((line)=>`<span class="invite-lead-line">${esc(line)}</span>`).join("")}</p>
          ${metaLine ? `<div class="invite-doc">${esc(metaLine)}</div>` : ""}
        </section>
        <div class="invite-soft">${I("shield")}<div>请填写真实信息。手机号仅做格式校验，无需短信验证码；若发现同号档案，将请您确认是否合并。</div></div>
        ${proxyToggleHtml()}
        <form class="panel invite-form" id="frm">
          ${(cfg.fields||[]).map(fieldHtml).join("")}
          ${consentAgreeHtml()}
        </form>
        ${proxyFieldsHtml()}</div>`);
      const cta=el(`<button class="btn btn-primary" id="sub" type="button">${esc(cfg.submitText||"提交联络表")}</button>`);
      const v=openView(cfg.title,body,{cta, hideBack:true});
      v.classList.add("view-invite");
      const proxy=bindProxy(body, "建档");
      const form=$("#frm",body);
      form.querySelectorAll(".field[data-f]").forEach(w=>{
        const f=(cfg.fields||[]).find(x=>x.key===w.dataset.f);
        if(f&&f.type==="checkboxGroup") bindCheckboxGroup(w,f);
        if(f&&(f.type==="file"||f.key==="outpatientVoucher")) bindVoucherUpload(w);
      });
      bindConsentAgree(body, consentText);

      function collectPayload(){
        const payload={}; let outpatientVoucherUrl="";
        (cfg.fields||[]).forEach(f=>{
          const w=form.querySelector(`[data-f="${f.key}"]`);
          if(f.type==="checkboxGroup"){
            const obj=readCheckboxGroup(w,f);
            const json=JSON.stringify(obj);
            payload[f.label]=json; payload[f.key]=json;
          }else if(f.type==="file"||f.key==="outpatientVoucher"){
            const url=(w&&w.getAttribute("data-voucher-url")||"").trim();
            payload[f.label]=url; payload[f.key]=url;
            if(f.key==="outpatientVoucher"||f.label==="请上传门诊凭证") outpatientVoucherUrl=url;
          }else{
            const i=w&&w.querySelector("input,select,textarea");
            payload[f.label]=i?(i.value||"").trim():"";
          }
        });
        Object.assign(payload, proxy.payload());
        const phoneField=form.querySelector('[data-f="phone"] input');
        const phone=phoneField?(phoneField.value||"").trim():(payload["手机号"]||"");
        return { payload, outpatientVoucherUrl, phone };
      }

      function validateForm(){
        let ok=true;
        const mark=(k,bad)=>{ const w=form.querySelector(`[data-f="${k}"]`); if(w){ w.classList.toggle("invalid",bad); if(bad) ok=false; } };
        (cfg.fields||[]).forEach(f=>{
          if(!f.required) return;
          const w=form.querySelector(`[data-f="${f.key}"]`);
          if(!w) return;
          if(f.type==="checkboxGroup") mark(f.key, !readCheckboxGroup(w,f).values.length);
          else if(f.type==="file"||f.key==="outpatientVoucher") mark(f.key, !(w.getAttribute("data-voucher-url")||"").trim());
          else {
            const i=w.querySelector("input,select,textarea");
            let bad=!i||!i.value.trim();
            if(!bad && f.key==="phone") bad=!/^1[3-9]\d{9}$/.test(i.value.trim());
            mark(f.key, bad);
          }
        });
        return ok;
      }

      function doSubmit(extra){
        if(!validateForm()){ toast("请检查标红的必填项"); return; }
        if(!proxy.validate()){ toast("请填写代办人信息"); return; }
        if(!$("#cchk",body).checked){ toast("请先阅读并同意用户协议与隐私政策"); $("#cons",body).classList.add("hl"); return; }
        const pack=collectPayload();
        cta.disabled=true; cta.textContent="提交中…";
        const bodyJson=Object.assign({
          doctorId:meta.doctorId,
          payload:pack.payload,
          phone:pack.phone,
          consent:true,
          outpatientVoucherUrl:pack.outpatientVoucherUrl
        }, extra||{});
        fetch("/api/invite/"+encodeURIComponent(tok)+"/submit",{
          method:"POST",
          credentials:"include",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(bodyJson)
        }).then(r=>r.json()).then(res=>{
          if(res && res.needsMergeConfirm){
            cta.disabled=false; cta.textContent=cfg.submitText||"提交联络表";
            const c=(res.candidates||[])[0];
            const hint=c?(c.displayNameMasked+" · "+c.phoneMasked+(c.nameHint?"（姓名一致）":"")):"";
            modal(`<h3 style="margin:0 0 12px;font-size:1.125rem">发现同号档案</h3>
              <p style="color:#4C6272;line-height:1.6;margin:0 0 16px">系统中已有同手机号档案${hint?("："+esc(hint)):""}。请确认是否并入，以免重复建档。</p>
              <div style="display:flex;flex-direction:column;gap:10px">
                <button class="btn btn-primary" id="mergeYes">并入已有档案</button>
                <button class="btn btn-ghost" id="mergeNo">新建档案</button>
              </div>`, m=>{
              $("#mergeYes",m).onclick=()=>{ m.remove(); doSubmit({ confirmMergePatientId:c && c.id }); };
              $("#mergeNo",m).onclick=()=>{ m.remove(); doSubmit({ forceCreate:true }); };
            });
            return;
          }
          if(res&&res.error){
            cta.disabled=false; cta.textContent=cfg.submitText||"提交联络表";
            const errMap={
              phone_verification_required:"需要先验证手机号（请填写短信验证码，或联系医助确认短信通道已开通）",
              phone_mismatch:"填写的手机号须与已验证账号一致",
              sms_unavailable:"短信验证暂不可用，请稍后重试或联系医助",
              unauthorized:"登录已失效，请重新打开建档链接"
            };
            toast(errMap[res.error] || res.error);
            return;
          }
          const success=Object.assign({}, cfg.success||{});
          if(res && res.merged){
            success.title=success.title||"档案已更新";
            success.desc=(res.message||"已并入已有档案")+"。后续提问将关联同一档案。";
          }
          showDone(v, success);
          if(res && res.message) toast(res.message);
        }).catch(()=>{ cta.disabled=false; cta.textContent=cfg.submitText||"提交联络表"; toast("网络异常，请重试"); });
      }
      cta.onclick=()=>doSubmit();
    }).catch(()=>{ closeView(vLoad); toast("加载失败，请检查链接"); });
  }

  /* ---------- 合规联络表（手机验证码 + 单独同意；已验证会话可免二次验码） ---------- */
  function openContact(cfg){
    const consentText=(DATA.content.consentText)||CONSENT_DEFAULT;
    const others=(cfg.fields||[]).filter(f=>f.key!=="phone"&&f.key!=="name");
    let sessionPhoneBound=false;
    let sessionPhoneMasked="";
    const body=el(`<div>
      <div class="steps"><span class="step"><b>1</b>手机验证</span><span class="step"><b>2</b>填写资料</span><span class="step"><b>3</b>同意并提交</span></div>
      <div class="note info">${I("shield")}<div>您的信息<b>仅本医生团队可见</b>，不对群内其他成员公开。手机号需短信验证；提交前请阅读并同意用户协议与隐私政策。</div></div>
      <div class="note info" id="sessHint" style="display:none">${I("shield")}<div id="sessHintText"></div></div>
      ${proxyToggleHtml()}
      <form class="panel" id="frm">
        ${fieldHtml((cfg.fields||[]).find(f=>f.key==="name"))}
        <div class="field" data-f="phone"><label>手机号<span class="req">*必填</span></label>
          <div class="with-btn"><input type="tel" id="ph" placeholder="11 位手机号" /><button type="button" class="codebtn" id="sendc">获取验证码</button></div>
          <div class="err">${I("warn")}请输入正确的 11 位手机号</div></div>
        <div class="field" data-f="code" id="codeWrap"><label>短信验证码<span class="req">*必填</span></label>
          <input type="text" id="cd" placeholder="6 位验证码" inputmode="numeric" />
          <div class="hint">合规整改：原系统手机号无验证，本样板已加短信验证。</div>
          <div class="err">${I("warn")}请输入验证码</div></div>
        ${others.map(fieldHtml).join("")}
        ${cfg.upload?`<div class="field" data-f="__up" data-voucher-url=""><label>${esc(cfg.upload.label)}</label><div class="upload" id="up">＋ 点击上传（${esc(cfg.upload.note)}）</div></div>`:""}
        ${consentAgreeHtml()}
      </form>
      ${proxyFieldsHtml()}</div>`);
    const cta=el(`<button class="btn btn-primary" id="sub">${esc(cfg.submitText||"提交建档")}</button>`);
    const v=openView(cfg.title,body,{cta});
    const proxy=bindProxy(body, "建档");
    const phone=()=>$("#ph",body).value.trim();
    const form=$("#frm",body);
    form.querySelectorAll(".field[data-f]").forEach(w=>{
      const f=(cfg.fields||[]).find(x=>x.key===w.dataset.f);
      if(f&&f.type==="checkboxGroup") bindCheckboxGroup(w,f);
      if(f&&(f.type==="file"||f.key==="outpatientVoucher")) bindVoucherUpload(w);
    });
    const upWrap=form.querySelector('[data-f="__up"]'); if(upWrap) bindVoucherUpload(upWrap);
    bindConsentAgree(body, consentText);
    function applySessionUi(){
      const codeWrap=$("#codeWrap",body);
      const sendBtn=$("#sendc",body);
      if(sessionPhoneBound){
        if(codeWrap) codeWrap.style.display="none";
        if(sendBtn) sendBtn.style.display="none";
        const hint=$("#sessHint",body);
        const hintText=$("#sessHintText",body);
        if(hint&&hintText){
          hint.style.display="";
          hintText.innerHTML="您在本浏览器已验证过手机号"+(sessionPhoneMasked?("（"+esc(sessionPhoneMasked)+"）"):"")+"，无需再次输入验证码。";
        }
      }
    }
    fetch("/api/patient/session?doctorId="+encodeURIComponent(DATA.doctor.id),{credentials:"include"})
      .then(r=>r.json()).then(sess=>{
        if(sess&&sess.phoneBound){ sessionPhoneBound=true; sessionPhoneMasked=sess.phoneMasked||""; applySessionUi(); }
      }).catch(()=>{});
    let timer=null;
    $("#sendc",body).onclick=()=>{
      if(!/^1[3-9]\d{9}$/.test(phone())){ body.querySelector('[data-f="phone"]').classList.add("invalid"); toast("请先填正确手机号"); return; }
      const btn=$("#sendc",body); btn.disabled=true;
      fetch("/api/sms/send",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone()})}).then(r=>r.json()).then(res=>{
        if(res.error){ btn.disabled=false; toast(res.error); return; }
        toast("验证码已发送："+res.code+"（演示态）");
        let t=60; btn.textContent=t+"s"; timer=setInterval(()=>{ if(--t<=0){ clearInterval(timer); btn.disabled=false; btn.textContent="获取验证码"; } else btn.textContent=t+"s"; },1000);
      }).catch(()=>{ btn.disabled=false; toast("发送失败"); });
    };
    cta.onclick=()=>{
      const form=$("#frm",body); let ok=true;
      const mark=(k,bad)=>{ const w=form.querySelector(`[data-f="${k}"]`); if(w){ w.classList.toggle("invalid",bad); if(bad) ok=false; } };
      mark("name", !form.querySelector('[data-f="name"] input').value.trim());
      mark("phone", !/^1[3-9]\d{9}$/.test(phone()));
      if(!sessionPhoneBound) mark("code", !$("#cd",body).value.trim());
      (cfg.fields||[]).filter(f=>f.required&&f.key!=="phone"&&f.key!=="name").forEach(f=>{
        const w=form.querySelector(`[data-f="${f.key}"]`);
        if(!w) return;
        if(f.type==="checkboxGroup") mark(f.key, !readCheckboxGroup(w,f).values.length);
        else if(f.type==="file"||f.key==="outpatientVoucher") mark(f.key, !(w.getAttribute("data-voucher-url")||"").trim());
        else { const i=w.querySelector("input,select,textarea"); mark(f.key, i&&!i.value.trim()); }
      });
      if(!ok){ toast("请检查标红的必填项"); return; }
      if(!proxy.validate()){ toast("请填写代办人信息"); return; }
      if(!$("#cchk",body).checked){ toast("请先阅读并同意用户协议与隐私政策"); $("#cons",body).classList.add("hl"); return; }
      const payload={}; let outpatientVoucherUrl="";
      (cfg.fields||[]).forEach(f=>{
        const w=form.querySelector(`[data-f="${f.key}"]`);
        if(f.type==="checkboxGroup"){
          const obj=readCheckboxGroup(w,f);
          const json=JSON.stringify(obj);
          payload[f.label]=json; payload[f.key]=json;
        }else if(f.type==="file"||f.key==="outpatientVoucher"){
          const url=(w&&w.getAttribute("data-voucher-url")||"").trim();
          payload[f.label]=url; payload[f.key]=url;
          if(f.key==="outpatientVoucher"||f.label==="请上传门诊凭证") outpatientVoucherUrl=url;
        }else{
          const i=w&&w.querySelector("input,select,textarea");
          payload[f.label]=i?(i.value||"").trim():"";
        }
      });
      if(upWrap){
        const upUrl=(upWrap.getAttribute("data-voucher-url")||"").trim();
        if(upUrl){ outpatientVoucherUrl=outpatientVoucherUrl||upUrl; payload[cfg.upload.label||"请上传门诊凭证"]=upUrl; }
      }
      Object.assign(payload, proxy.payload());
      cta.disabled=true; cta.textContent="提交中…";
      const submitBody={doctorId:DATA.doctor.id,type:"联络表",payload,phone:phone(),consent:true,outpatientVoucherUrl};
      if(!sessionPhoneBound) submitBody.code=$("#cd",body).value.trim();
      fetch("/api/submit",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(submitBody)})
        .then(r=>r.json()).then(res=>{ if(res&&res.error){ cta.disabled=false; cta.textContent=cfg.submitText||"提交建档"; toast(res.error); return; } showDone(v,cfg.success); if(res.enrolledPlan) toast("已加入「"+res.enrolledPlan+"」随访计划，可在「我的随访」查看"); })
        .catch(()=>{ cta.disabled=false; cta.textContent=cfg.submitText||"提交建档"; toast("网络异常，请重试"); });
    };
  }

  function fieldHtml(f){
    if(!f) return "";
    const noneVal=f.noneValue!=null?String(f.noneValue):"无";
    const otherVal=f.otherValue!=null?String(f.otherValue):"其他";
    let ctrl, extra="";
    if(f.type==="textarea") ctrl=`<textarea placeholder="${esc(f.placeholder||"")}"></textarea>`;
    else if(f.type==="select") ctrl=`<select><option value="">请选择</option>${(f.options||[]).map(o=>`<option>${esc(o)}</option>`).join("")}</select>`;
    else if(f.type==="date") ctrl=`<input type="date" />`;
    else if(f.type==="checkboxGroup"){
      const opts=(f.options||[]).map(o=>{
        const isNone=o===noneVal, isOther=o===otherVal;
        const attrs=isNone?' data-cb data-none-cb':isOther?' data-cb data-other-cb':' data-cb';
        return `<label class="cb-item"><input type="checkbox" value="${esc(o)}"${attrs}/><span>${esc(o)}</span></label>`;
      }).join("");
      ctrl=`<div class="cb-group">${opts}</div>`;
      extra=`<input type="text" class="cb-other-txt" hidden placeholder="请说明其他项" />`;
    }else if(f.type==="file"||f.key==="outpatientVoucher"){
      const accept=(f.accept||["image/jpeg","image/png","image/webp","application/pdf"]).join(",");
      const note=f.note||"图片或 PDF，≤4MB";
      return `<div class="field" data-f="${esc(f.key)}" data-voucher-url=""><label>${esc(f.label)}${f.required?'<span class="req">*必填</span>':""}</label>
        <div class="upload voucher-trigger">＋ 点击上传（${esc(note)}）</div>
        <input type="file" class="voucher-input" hidden accept="${esc(accept)}" />
        ${f.hint?`<div class="hint">${esc(f.hint)}</div>`:""}<div class="err">${I("warn")}${esc(f.err||"请上传")}</div></div>`;
    }else ctrl=`<input type="${f.type==="tel"?"tel":"text"}" placeholder="${esc(f.placeholder||"")}" />`;
    return `<div class="field" data-f="${esc(f.key)}"><label>${esc(f.label)}${f.required?'<span class="req">*必填</span>':""}</label>${ctrl}${extra}
      ${f.hint?`<div class="hint">${esc(f.hint)}</div>`:""}<div class="err">${I("warn")}${esc(f.err||"请填写")}</div></div>`;
  }
  function bindCheckboxGroup(wrapper, f){
    const noneCb=wrapper.querySelector("[data-none-cb]");
    const otherCb=wrapper.querySelector("[data-other-cb]");
    const otherTxt=wrapper.querySelector(".cb-other-txt");
    const allCbs=()=>wrapper.querySelectorAll("[data-cb]");
    const syncOther=()=>{ if(!otherTxt) return; const show=otherCb&&otherCb.checked; otherTxt.hidden=!show; if(!show) otherTxt.value=""; };
    allCbs().forEach(cb=>cb.addEventListener("change",()=>{
      if(noneCb&&cb===noneCb&&noneCb.checked){ allCbs().forEach(x=>{ if(x!==noneCb) x.checked=false; }); syncOther(); }
      else if(noneCb&&cb!==noneCb&&cb.checked) noneCb.checked=false;
      syncOther();
    }));
  }
  function readCheckboxGroup(wrapper, f){
    const otherVal=f&&f.otherValue!=null?String(f.otherValue):"其他";
    const values=[]; wrapper.querySelectorAll("[data-cb]:checked").forEach(cb=>values.push(cb.value));
    const otherTxt=wrapper.querySelector(".cb-other-txt");
    const other=values.includes(otherVal)&&otherTxt?(otherTxt.value||"").trim():"";
    return { values, other };
  }
  function readFileDataUrl(file){
    return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||"")); r.onerror=reject; r.readAsDataURL(file); });
  }
  function bindVoucherUpload(wrapper){
    const trigger=wrapper.querySelector(".upload,.voucher-trigger");
    if(!trigger) return;
    let input=wrapper.querySelector(".voucher-input")||wrapper.querySelector('input[type="file"]');
    if(!input){
      input=document.createElement("input");
      input.type="file"; input.className="voucher-input"; input.hidden=true;
      input.accept="image/jpeg,image/png,image/webp,application/pdf";
      wrapper.appendChild(input);
    }
    trigger.style.cursor="pointer";
    trigger.onclick=()=>input.click();
    input.onchange=async()=>{
      const file=(input.files||[])[0]; input.value="";
      if(!file) return;
      const okType=/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type);
      if(!okType){ toast("仅支持 JPG/PNG/WebP/PDF"); return; }
      trigger.textContent="上传中…"; trigger.classList.remove("filled");
      try{
        const dataUrl=await readFileDataUrl(file);
        const b64=String(dataUrl).split(",")[1]||"";
        if(Math.floor(b64.length*3/4)>4*1024*1024){ toast("文件过大（需 ≤4MB）"); trigger.textContent="＋ 点击上传"; return; }
        const res=await fetch("/api/patient/voucher-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctorId:DATA.doctor.id,dataUrl})});
        const data=await res.json();
        if(data.error){ toast(data.error); trigger.textContent="＋ 点击上传"; return; }
        wrapper.setAttribute("data-voucher-url", data.url||"");
        trigger.classList.add("filled");
        trigger.textContent="✓ 已上传 "+(file.name||"凭证");
      }catch(e){ toast("上传失败，请重试"); trigger.textContent="＋ 点击上传"; }
    };
  }
  function validate(form,fields){
    let ok=true;
    (fields||[]).forEach(f=>{ const w=form.querySelector(`[data-f="${f.key}"]`); if(!w) return; const inp=w.querySelector("input,select,textarea"); const v=(inp.value||"").trim();
      let bad=false; if(f.required&&!v) bad=true; if(!bad&&v&&f.pattern&&!(new RegExp(f.pattern)).test(v)) bad=true; w.classList.toggle("invalid",bad); if(bad) ok=false; });
    return ok;
  }
  function showDone(v,s){
    s=s||{title:"已提交",desc:"我们会尽快与您联系。"};
    $(".view-inner",v).innerHTML="";
    const cta=v.querySelector(".cta-bar"); if(cta) cta.remove();
    $(".view-inner",v).appendChild(el(`<div class="done"><div class="ok">${I("check")}</div><h3>${esc(s.title)}</h3><p>${escBr(s.desc)}</p>
      <p style="color:#9aa7ad;font-size:.875rem;margin-top:8px">已写入服务端数据库，医助后台可查看</p>
      <button class="btn btn-ghost" id="bk" style="margin-top:20px">返回</button></div>`));
    $("#bk",v).onclick=()=>closeView(v);
  }

  /* ---------- toast / modal ---------- */
  function toast(msg){ const t=el(`<div class="toast">${esc(msg)}</div>`); document.body.appendChild(t); setTimeout(()=>t.remove(),2000); }
  function modal(html,onMount){ const m=el(`<div class="modal"><div class="box">${html}</div></div>`); m.addEventListener("click",e=>{ if(e.target===m) m.remove(); }); document.body.appendChild(m); if(onMount) onMount(m); return m; }
})();
