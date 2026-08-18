/* ===== 医助后台 SPA ===== */
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); // 含单引号转义：data-edit/data-clone 用单引号包裹，漏单引号会被含 ' 的字段突破属性边界注入事件处理器(存储型XSS)
const fmtCnTime = (v, mode) => {
  if (window.TimeFmt && window.TimeFmt.fmtCnTime) return window.TimeFmt.fmtCnTime(v, mode);
  const s = String(v == null ? "" : v).replace("T", " ");
  return mode === "mdhm" ? s.slice(5, 16) : s.slice(0, 16);
};
let DOCTORS = [], curDoc = null, curTab = "triage", myRole = null, currentAdmin = null, CAPS = null;
let archivePatientId = null;
let triageSessionId = null;
let triagePane = "chat";
let configDomain = "scripts";
let followupId = null;
let reminders = null;       // 主动提醒缓存：{ ok,total,counts,items } —— 切换医生/处置后刷新，导航角标据此渲染
let highlightSubId = null;  // 从提醒列表点击跳转「提交记录」时要高亮滚动到的提交 id
let communityRefreshTimer = null;

async function api(method, url, body){
  const o = { method, headers:{} };
  if(body){ o.headers["Content-Type"]="application/json"; o.body=JSON.stringify(body); }
  const r = await fetch(url, o);
  let j = null; try{ j = await r.json(); }catch(e){}
  if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
  return j;
}

/* ---------- 登录 ---------- */
async function tryBoot(){
  try{ setCurrentAdmin(await api("GET","/api/admin/me")); enterApp(); }
  catch(e){ $("#loginView").classList.remove("hidden"); $("#appView").classList.add("hidden"); }
}
$("#loginBtn").onclick = async ()=>{
  $("#loginErr").textContent = "";
  try{
    const me = await api("POST","/api/admin/login",{ username:$("#lu").value, password:$("#lp").value });
    try{ setCurrentAdmin(await api("GET","/api/admin/me")); }catch(e){ setCurrentAdmin(me); }
    enterApp();
  }catch(e){ $("#loginErr").textContent = e.message; }
};
$("#logoutBtn").onclick = async ()=>{ await api("POST","/api/admin/logout"); location.reload(); };
$("#passwordBtn").onclick = ()=>selfPasswordModal();
const gotoNewBtn = $("#gotoNewBtn");
if(gotoNewBtn) gotoNewBtn.onclick = ()=>{ location.href = "/admin"; };
function setCurrentAdmin(me){
  currentAdmin = me || {};
  myRole = currentAdmin.role || "super";
  refreshWho();
}
function refreshWho(){
  const name = currentAdmin.displayName || currentAdmin.username || "";
  const role = (CAPS && CAPS.roleLabel) || roleText(myRole);
  const scope = CAPS && CAPS.scopeText ? ` · ${CAPS.scopeText}` : "";
  $("#who").textContent = name ? `${name} · ${role}${scope}` : "";
}
async function loadCapabilities(){
  if(!curDoc){ CAPS = null; refreshWho(); return; }
  try{
    CAPS = await api("GET","/api/admin/me/capabilities?doctorId="+curDoc);
    if(CAPS.admin) setCurrentAdmin(CAPS.admin); else refreshWho();
  }catch(e){
    CAPS = { ok:false, actions:{}, tabs:{}, error:e.message };
    refreshWho();
  }
  ensureVisibleTab();
  applyTopCapabilities();
}

async function enterApp(){
  $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  await loadDoctors();
  await loadCapabilities();
  await loadReminders();   // 拉提醒并渲染导航角标（内部已调用 buildNav）
  render();
}

/* ---------- 主动提醒（站内只读，绝不触发发送） ---------- */
async function loadReminders(){
  try{ reminders = await api("GET","/api/admin/reminders?doctorId="+curDoc); }
  catch(e){ reminders = null; }
  buildNav();   // 角标随提醒数刷新
}

async function loadDoctors(){
  DOCTORS = await api("GET","/api/admin/doctors");
  const sel = $("#docSel"); sel.innerHTML = "";
  DOCTORS.forEach(d=>{
    const o=document.createElement("option");
    o.value=d.id;
    o.textContent=`${d.name}（${d.hospital||"-"} · ${d.dept||"-"}）${d.active?" · 上线中":""}`;
    o.setAttribute("data-search", `${d.name||""} ${d.title||""} ${d.hospital||""} ${d.dept||""} ${d.group_name||""}`.toLowerCase());
    sel.appendChild(o);
  });
  if(!curDoc || !DOCTORS.find(d=>d.id==curDoc)) curDoc = (DOCTORS.find(d=>d.active)||DOCTORS[0]).id;
  sel.value = curDoc;
  sel.onchange = async ()=>{ curDoc = +sel.value; archivePatientId = null; await loadCapabilities(); await loadReminders(); render(); };
  let docTopSearch = $("#docTopSearch");
  if(!docTopSearch){
    docTopSearch = document.createElement("input");
    docTopSearch.id = "docTopSearch";
    docTopSearch.type = "search";
    docTopSearch.placeholder = "搜医生/医院/科室";
    docTopSearch.autocomplete = "off";
    docTopSearch.style.cssText = "max-width:160px;margin-right:6px;padding:4px 8px;border:1px solid #d6dbdf;border-radius:8px;font:inherit";
    sel.parentNode.insertBefore(docTopSearch, sel);
  }
  docTopSearch.oninput = ()=>{
    const needle = docTopSearch.value.trim().toLowerCase();
    Array.from(sel.options).forEach(o=>{
      const hay = (o.getAttribute("data-search") || o.textContent || "").toLowerCase();
      o.hidden = !!(needle && hay.indexOf(needle) < 0);
    });
  };
  // 上下线已废弃：患者端按邀请/最近使用归属
  const actBtn = $("#activateBtn");
  if(actBtn) actBtn.style.display = "none";
  applyTopCapabilities();
}

function capFor(action){
  const a = String(action || "");
  return CAPS && CAPS.actions && CAPS.actions[a] ? CAPS.actions[a] : null;
}
function can(action){
  const cap = capFor(action);
  if(cap) return !!cap.allowed;
  return myRole === "super";
}
function disabledReason(action){
  const cap = capFor(action);
  return cap && cap.reason ? cap.reason : "当前账号无该操作权限";
}
function tabCap(key){
  if(CAPS && CAPS.tabs && CAPS.tabs[key]) return CAPS.tabs[key];
  return { visible:(key!=="qiwe" && key!=="accounts") || myRole==="super", readOnly:false, reason:"" };
}
function visibleTabKeys(){
  return TABS.map(t=>t[0]).filter(k=>tabCap(k).visible);
}
function ensureVisibleTab(){
  const keys = visibleTabKeys();
  if(keys.length && !keys.includes(curTab)) curTab = keys[0];
}
function actionAttrs(action){
  return can(action) ? "" : ` disabled title="${esc(disabledReason(action))}"`;
}
function configActionAttrs(action, editable){
  if(editable && can(action)) return "";
  return ` disabled title="${esc(editable ? disabledReason(action) : "当前配置只读")}"`;
}
function applyActionState(btn, action){
  if(!btn) return false;
  if(can(action)){ btn.disabled = false; btn.title = ""; return true; }
  btn.disabled = true;
  btn.title = disabledReason(action);
  return false;
}
async function withButtonLoading(btn, text, fn){
  if(!btn) return fn();
  const oldText = btn.textContent;
  btn.disabled = true;
  if(text) btn.textContent = text;
  try{ return await fn(); }
  finally{ btn.disabled = false; if(text) btn.textContent = oldText; }
}
function bindActionButton(btn, action, handler, opts){
  if(!btn) return;
  const allowed = applyActionState(btn, action);
  btn.onclick = async ()=>{
    if(!can(action)){ alert(disabledReason(action)); return; }
    if(opts && opts.confirm && !confirm(opts.confirm)) return;
    try{
      await withButtonLoading(btn, opts && opts.loadingText, async ()=>handler(btn));
    }catch(e){ alert(e.message); }
  };
  if(!allowed && opts && opts.hideWhenDenied) btn.style.display = "none";
}
function bindConfigButton(btn, action, editable, handler, opts){
  if(!btn) return;
  if(!editable){
    btn.disabled = true;
    btn.title = "当前配置只读";
    btn.onclick = ()=>alert("当前配置只读");
    return;
  }
  bindActionButton(btn, action, handler, opts);
}
function applyTopCapabilities(){
  const b = $("#activateBtn");
  if(b) b.style.display = "none";
}

/* ---------- 导航 ---------- */
const TABS = [
  ["triage","AI分诊台","AI"],["community","社群工作台","群"],["followup","随访队列","访"],["waitlist","候补名单","候"],["dash","仪表盘","表"],
  ["ops","运营策略","策"],["config","运营配置","配"],
  ["subs","提交记录","交"],["archive","患者档案","档"],
  ["audit","审计日志","审"],["rules","关键词规则","规"],["faq","FAQ","问"],
  ["doctors","医生管理","医"],["accounts","账户与权限","权"],["qiwe","企微配置","企"]
];
const NAV_GROUPS = [
  ["日常工作",["triage","community","followup","waitlist","dash"]],
  ["运营中心",["ops","config"]],
  ["提交与档案",["subs","archive"]],
  ["知识与规则",["audit","rules","faq"]],
  ["医生与系统",["doctors","accounts","qiwe"]]
];
const TAB_MAP = Object.fromEntries(TABS.map(t=>[t[0],t]));
function buildNav(){
  ensureVisibleTab();
  const nav = $("#nav"); nav.innerHTML = "";
  const remTotal = (reminders && reminders.total) || 0;
  NAV_GROUPS.forEach(([title, keys])=>{
    const visible = keys.filter(k=>tabCap(k).visible);
    if(!visible.length) return;
    const sec = document.createElement("div"); sec.className = "nav-section";
    const h = document.createElement("div"); h.className = "nav-title"; h.textContent = title; sec.appendChild(h);
    visible.forEach(k=>{
      const item = TAB_MAP[k];
      const b=document.createElement("button"); b.className=k===curTab?"on":""; b.onclick=()=>{ if(k!=="archive") archivePatientId=null; curTab=k; buildNav(); render(); };
      const ico=document.createElement("span"); ico.className="nav-ico"; ico.textContent=item[2];
      const txt=document.createElement("span"); txt.className="nav-label"; txt.textContent=item[1];
      b.appendChild(ico); b.appendChild(txt);
      if(k==="subs" && remTotal>0){ const badge=document.createElement("span"); badge.className="nav-badge"; badge.textContent = remTotal>99?"99+":String(remTotal); b.appendChild(badge); }
      sec.appendChild(b);
    });
    nav.appendChild(sec);
  });
}

/* ---------- 渲染分发 ---------- */
function render(){
  ensureVisibleTab();
  if(curTab !== "community" && communityRefreshTimer){ clearTimeout(communityRefreshTimer); communityRefreshTimer = null; }
  const m = $("#main"); m.innerHTML = '<div class="empty">加载中…</div>';
  const fn = { triage:renderTriage, community:renderCommunity, followup:renderFollowup, waitlist:renderWaitlist, dash:renderDash, ops:renderOps, config:renderConfigCenter, subs:renderSubs, archive:renderArchive, audit:renderAudit, rules:renderRules, faq:renderFaq, doctors:renderDoctors, accounts:renderAccounts, qiwe:renderQiwe }[curTab];
  if(!fn){ m.innerHTML = '<div class="empty">当前角色没有可访问的页面。</div>'; return; }
  Promise.resolve(fn(m)).catch(e=>{ m.innerHTML = `<div class="empty">页面加载失败：${esc(e.message||e)}<br><span class="sub">请确认已登录且本地服务在运行（http://localhost:3000）</span></div>`; });
}

/* ---------- 仪表盘 ---------- */
async function renderDash(m){
  const s = await api("GET","/api/admin/stats?doctorId="+curDoc);
  const total = s.byType.reduce((a,b)=>a+b.c,0);
  const rem = reminders || {};
  const remTotal = rem.total || 0;
  const remItems = rem.items || [];
  const countChips = Object.entries(rem.counts || {}).filter(([,n])=>n>0).map(([t,n])=>`<span class="tag warn">${esc(t)} ${n}</span>`).join(" ");
  m.innerHTML = `
    <div class="card"><h2>主动提醒 <span class="sub">加号 / 住院预约等待联系的提交 · 处置后角标自动减少</span>${remTotal?`<span class="nav-badge" style="margin-left:auto">${remTotal>99?"99+":remTotal}</span>`:""}</h2>
      ${remTotal?`<div class="toolbar">${countChips}</div>`:""}
      ${remItems.length?`<div class="rem-list">${remItems.map(remItemHtml).join("")}</div>`:'<div class="empty">暂无待联系提醒。患者提交加号/住院预约后会自动出现在这里。</div>'}
    </div>
    <div class="card"><h2>仪表盘 <span class="sub">当前医生：${esc(curName())}</span></h2>
      <div class="stats">
        <div class="stat"><div class="n">${total}</div><div class="l">表单提交总数</div></div>
        <div class="stat" style="background:linear-gradient(135deg,#3aa1ff,#2b7de9)"><div class="n">${s.msgs}</div><div class="l">患者消息条数</div></div>
        <div class="stat" style="background:linear-gradient(135deg,#9b5cff,#7a3fd6)"><div class="n">${s.rules}</div><div class="l">已配置关键词规则</div></div>
        <div class="stat" style="background:linear-gradient(135deg,#ff9f43,#f97316)"><div class="n">${s.triagePending||0}</div><div class="l">待人工分诊</div></div>
      </div></div>
    <div class="card"><h2>各类提交分布</h2>
      ${s.byType.length?`<table><tr><th>类型</th><th>数量</th></tr>${s.byType.map(t=>`<tr><td><span class="tag">${esc(t.type)}</span></td><td>${t.c}</td></tr>`).join("")}</table>`:'<div class="empty">暂无提交。去患者端填一张联络表/加号试试。</div>'}
    </div>`;
  m.querySelectorAll("[data-rem]").forEach(b=>b.onclick=()=>{ highlightSubId=+b.dataset.rem; subType=""; curTab="subs"; buildNav(); render(); });
}
function curName(){ const d=DOCTORS.find(x=>x.id==curDoc); return d?d.name:""; }
function remItemHtml(it){
  return `<button class="rem-item" data-rem="${esc(it.id)}">
    <span class="tag warn">${esc(it.type)}</span>
    <span class="rem-sum">${esc(it.summary||"")}</span>
    <span class="rem-time">${esc(fmtCnTime(it.createdAt))}</span>
  </button>`;
}

/* ---------- 社群工作台 ---------- */
let communityOutboxFilter = "pending"; // pending | all
const COMMUNITY_FEED_LIMIT = 20;

function communityInboundTableHtml(messages){
  const rows = (messages || []).slice(0, COMMUNITY_FEED_LIMIT);
  if(!rows.length) return '<div class="empty" style="padding:22px">暂无入站消息。真实消息会在 QiWe 回调后显示；模拟数据仅用于测试。</div>';
  return `<div class="community-scroll"><table><thead><tr><th>#</th><th>来源</th><th>内容</th><th>处理</th><th>风险</th><th>时间</th></tr></thead><tbody>${rows.map(communityMessageRow).join("")}</tbody></table></div>`;
}

function communityOutboxTableHtml(outbox, filter){
  const all = outbox || [];
  const filtered = filter === "all" ? all : all.filter(o=>o.status === "pending");
  const rows = filtered.slice(0, COMMUNITY_FEED_LIMIT);
  const pendingCount = all.filter(o=>o.status === "pending").length;
  if(!rows.length){
    return `<div class="empty" style="padding:22px">${filter === "pending" ? "暂无待发送内容。" : "暂无出站记录。"}</div>`;
  }
  return `<div class="community-scroll"><table><thead><tr><th>#</th><th>来源</th><th>内容</th><th>状态</th><th></th></tr></thead><tbody>${rows.map(outboxRow).join("")}</tbody></table></div>`;
}

function bindCommunityFeedActions(root, outbox){
  if(!root) return;
  root.querySelectorAll("[data-osend]").forEach(b=>bindActionButton(b, "community.outbox.send", async()=>{ await api("POST","/api/admin/community/outbox/"+b.dataset.osend+"/send"); render(); }, { confirm:"确认发送这条出站内容？", loadingText:"发送中…" }));
  root.querySelectorAll("[data-ocancel]").forEach(b=>bindActionButton(b, "community.outbox.edit", async()=>{ await api("POST","/api/admin/community/outbox/"+b.dataset.ocancel+"/cancel"); render(); }, { confirm:"取消这条待发送内容？", loadingText:"取消中…" }));
  root.querySelectorAll("[data-oedit]").forEach(b=>bindActionButton(b, "community.outbox.edit", ()=>outboxEditModal((outbox||[]).find(o=>o.id==b.dataset.oedit))));
  root.querySelectorAll("[data-oassist]").forEach(b=>bindActionButton(b, "assistant_draft.generate", async()=>{
    const instruction = prompt("AI 改写要求（可留空，例如：更口语、更简短、更适合群内发送）", "");
    if(instruction === null) return;
    const r = await api("POST","/api/admin/community/outbox/"+b.dataset.oassist+"/assist-draft",{ instruction });
    if(!r.changed) alert("未自动改写："+(r.reason||"模型不可用，已保留原草稿"));
    render();
  }, { confirm:"AI 只会改写待发送草稿，不会自动发送。继续？", loadingText:"改写中…" }));
  root.querySelectorAll("[data-oassign]").forEach(b=>bindActionButton(b, "community.outbox.edit", async()=>{ await api("POST","/api/admin/community/outbox/"+b.dataset.oassign+"/assignee",{ assignee:b.dataset.assignee||null }); render(); }, { loadingText:"处理中…" }));
  root.querySelectorAll("[data-oignore]").forEach(b=>bindActionButton(b, "community.outbox.edit", async()=>{ await api("POST","/api/admin/community/outbox/"+b.dataset.oignore+"/ignore"); render(); }, { confirm:"忽略这条待发送内容？将不再发送。", loadingText:"忽略中…" }));
  const resolveMod = (id, action, force)=>api("POST","/api/admin/community/moderation/"+id+"/resolve",{ action, force:!!force });
  root.querySelectorAll("[data-mod-dismiss]").forEach(b=>bindActionButton(b, "community.moderation.resolve", async()=>{
    await resolveMod(b.dataset.modDismiss, "dismiss"); render();
  }, { confirm:"确认为误报并关闭？", loadingText:"关闭中…" }));
  root.querySelectorAll("[data-mod-block]").forEach(b=>bindActionButton(b, "community.moderation.resolve", async()=>{
    await resolveMod(b.dataset.modBlock, "block"); render();
  }, { confirm:"标记拦截该发言人后续内容（人工策略）？", loadingText:"标记中…" }));
  root.querySelectorAll("[data-mod-kick]").forEach(b=>bindActionButton(b, "community.moderation.resolve", async()=>{
    await resolveMod(b.dataset.modKick, "kick", true); render();
  }, { confirm:"极端操作：确认踢出该成员？（需 QIWE_MODERATION_ENFORCE_EXPERIMENTAL=1 或 DRY_RUN）", loadingText:"踢出中…" }));
  root.querySelectorAll("[data-mod-revoke]").forEach(b=>bindActionButton(b, "community.moderation.resolve", async()=>{
    await resolveMod(b.dataset.modRevoke, "revoke", true); render();
  }, { confirm:"极端操作：确认撤回该消息？（需 QIWE_MODERATION_ENFORCE_EXPERIMENTAL=1 或 DRY_RUN）", loadingText:"撤回中…" }));
}

async function softRefreshCommunityFeeds(){
  if(curTab !== "community") return;
  const inboundMount = $("#communityInboundMount");
  const outboxMount = $("#communityOutboxMount");
  if(!inboundMount || !outboxMount) return;
  try{
    const data = await api("GET","/api/admin/community?doctorId="+curDoc);
    const messages = data.messages || [];
    const outbox = data.outbox || [];
    const summary = data.summary || {};
    const pending = summary.pendingOutbox != null ? summary.pendingOutbox : outbox.filter(o=>o.status==="pending").length;
    const kpiHost = document.querySelector("[data-community-kpi='pending']");
    if(kpiHost) kpiHost.innerHTML = opsKpi("待发送", pending||0, `${summary.sentOutbox||0} 条已发送`);
    inboundMount.innerHTML = communityInboundTableHtml(messages);
    outboxMount.innerHTML = communityOutboxTableHtml(outbox, communityOutboxFilter);
    bindCommunityFeedActions(inboundMount, outbox);
    bindCommunityFeedActions(outboxMount, outbox);
  }catch(e){ /* 软刷新失败不打断当前页 */ }
}

async function renderCommunity(m){
  if(communityRefreshTimer){ clearTimeout(communityRefreshTimer); communityRefreshTimer = null; }
  const data = await api("GET","/api/admin/community?doctorId="+curDoc);
  const groups = data.groups || [];
  const messages = data.messages || [];
  const outbox = data.outbox || [];
  const summary = data.summary || {};
  const groupOptions = groups.map(g=>`<option value="${g.id}">${esc(g.name)} · ${channelText(g.channelType)}</option>`).join("");
  const pendingCount = outbox.filter(o=>o.status==="pending").length;
  m.innerHTML = `
    <div class="card community-hero">
      <div class="community-head">
        <div><h2>社群工作台 <span class="sub">群配置 · 入站回调 · 自动回复 · 人工发送队列</span></h2>
          <p>把真实微信群/企微群接到统一业务层：入群欢迎语、群消息入站、关键词规则、AI 分诊和医助审核都在这里闭环。</p></div>
        <div class="triage-btns" style="margin-top:0"><button class="btn g" id="syncQiweGroupsBtn"${actionAttrs("community.group.manage")}>同步企微群</button><button class="btn p" id="addGroupBtn"${actionAttrs("community.group.manage")}>+ 新增测试群</button></div>
      </div>
      <div class="ops-kpis">
        ${opsKpi("群配置", summary.totalGroups||groups.length||0, `企微同步 ${summary.qiweGroups||0}`)}
        ${opsKpi("企微群", summary.qiweGroups||summary.groups||0, "同步后自动接收消息与回复")}
        ${opsKpi("真实成员", summary.members||0, "来自 QiWe 群详情同步")}
        ${opsKpi("真实入站", summary.inbound||0, "来自 QiWe 回调的群消息")}
        <div data-community-kpi="pending">${opsKpi("待发送", summary.pendingOutbox||pendingCount||0, `${summary.sentOutbox||0} 条已发送`)}</div>
      </div>
      <div class="community-note">下方列出全部群配置。企微真实群同步或新建后自动接收消息、欢迎语与自动回复；手工群仅供测试。</div>
    </div>
    <div class="community-grid">
      <section class="card community-section">
        <h2>群配置 <span class="sub">同步或新建企微群即可；手工群仅供测试</span></h2>
        ${groups.length ? groups.map(groupCard).join("") : '<div class="empty">暂无群配置。</div>'}
      </section>
      <section class="card community-section">
        <h2>模拟真实入站 <span class="sub">用于本地验证回调链路</span></h2>
        <div class="community-sim">
          <div class="fld"><label>目标群</label><select id="simGroup">${groupOptions}</select></div>
          <div class="fld"><label>事件类型</label><select id="simEvent"><option value="message">群消息</option><option value="member_join">新患者入群</option></select></div>
          <div class="fld"><label>发送人</label><input id="simName" value="社群测试患者"></div>
          <div class="fld"><label>消息内容</label><textarea id="simText" style="font-family:inherit;min-height:92px">101</textarea></div>
          <div class="triage-btns"><button class="btn p" id="simSend"${actionAttrs("community.inbound.simulate")}>提交入站</button><button class="btn g" id="simJoin"${actionAttrs("community.inbound.simulate")}>模拟入群</button><button class="btn d" id="simRisk"${actionAttrs("community.inbound.simulate")}>模拟高风险</button></div>
        </div>
      </section>
    </div>
    <div class="community-grid">
      <section class="card community-section">
        <div class="community-feed-head">
          <h2>入站消息</h2>
        </div>
        <div id="communityInboundMount">${communityInboundTableHtml(messages)}</div>
      </section>
      <section class="card community-section">
        <div class="community-feed-head">
          <h2>出站队列</h2>
          <div class="community-feed-tools">
            <button type="button" class="pill ${communityOutboxFilter==="pending"?"on":""}" data-outbox-filter="pending">待发送 (${pendingCount})</button>
            <button type="button" class="pill ${communityOutboxFilter==="all"?"on":""}" data-outbox-filter="all">最近全部</button>
          </div>
        </div>
        <div id="communityOutboxMount">${communityOutboxTableHtml(outbox, communityOutboxFilter)}</div>
      </section>
    </div>`;
  bindActionButton($("#addGroupBtn"), "community.group.manage", ()=>groupModal(null), { hideWhenDenied:false });
  bindActionButton($("#syncQiweGroupsBtn"), "community.group.manage", async ()=>{
    const r = await api("POST","/api/admin/community/qiwe/sync",{ doctorId:curDoc });
    alert(`同步完成：${r.groups||0} 个群，${r.members||0} 名成员`);
    await renderCommunity(m);
  }, { loadingText:"同步中…" });
  m.querySelectorAll("[data-gedit]").forEach(b=>bindActionButton(b, "community.group.manage", ()=>groupModal(JSON.parse(b.dataset.gedit))));
  const sim = async (patch)=>{
    if(!groups.length){ alert("请先新增群配置"); return; }
    const groupId = +$("#simGroup").value;
    const g = groups.find(x=>x.id===groupId) || groups[0];
    const body = { doctorId:curDoc, groupId:g.id, channelType:g.channelType, externalGroupId:g.externalGroupId,
      eventType:$("#simEvent").value, senderName:$("#simName").value.trim() || "社群患者",
      externalUserId:"admin-sim-"+curDoc+"-"+($("#simName").value.trim() || "patient"), text:$("#simText").value.trim(), ...patch };
    await api("POST","/api/admin/community/inbound",body);
    render();
  };
  bindActionButton($("#simSend"), "community.inbound.simulate", ()=>sim({}), { loadingText:"提交中…" });
  bindActionButton($("#simJoin"), "community.inbound.simulate", ()=>{ $("#simEvent").value="member_join"; return sim({ eventType:"member_join", text:"" }); }, { loadingText:"提交中…" });
  bindActionButton($("#simRisk"), "community.inbound.simulate", ()=>{ $("#simEvent").value="message"; $("#simText").value="我胸痛还呼吸困难"; return sim({ text:"我胸痛还呼吸困难" }); }, { loadingText:"提交中…" });
  m.querySelectorAll("[data-outbox-filter]").forEach(b=>b.onclick=()=>{
    communityOutboxFilter = b.dataset.outboxFilter === "all" ? "all" : "pending";
    const mount = $("#communityOutboxMount");
    if(mount){
      mount.innerHTML = communityOutboxTableHtml(outbox, communityOutboxFilter);
      bindCommunityFeedActions(mount, outbox);
    }
    m.querySelectorAll("[data-outbox-filter]").forEach(x=>x.classList.toggle("on", x.dataset.outboxFilter===communityOutboxFilter));
  });
  bindCommunityFeedActions($("#communityInboundMount"), outbox);
  bindCommunityFeedActions($("#communityOutboxMount"), outbox);
  // 定时只软刷新入站/出站，避免整页重绘造成「不断往下生成」的观感并保留滚动位置
  const scheduleCommunitySoftRefresh = ()=>{
    if(communityRefreshTimer) clearTimeout(communityRefreshTimer);
    communityRefreshTimer = setTimeout(async ()=>{
      if(curTab !== "community") return;
      await softRefreshCommunityFeeds();
      if(curTab === "community") scheduleCommunitySoftRefresh();
    }, 15000);
  };
  scheduleCommunitySoftRefresh();
}
function channelText(v){ return ({wechat:"微信群",wecom:"官方企微",qiwe:"QiWe企微群",web:"Web",sms:"短信"}[v]||v||""); }
function reviewText(v){ return ({human_review:"人工审核",auto_keywords:"仅关键词自动发",paused:"暂停自动处理"}[v]||v||""); }
function communityStatusText(v){ return ({pilot:"试点",active:"运行中",paused:"暂停",archived:"归档"}[v]||v||""); }
function riskText(v){ return v === "high" ? "高风险" : v === "medium" ? "中风险" : "低风险"; }
function statusText(s){ return ({ai_following:"AI跟进中",needs_human:"待人工",human_reviewed:"人工已审",closed:"已关闭",resolved:"已处理",handoff:"已转医生",pending:"待处理"}[s]||s||""); }
function groupCard(g){
  const source = g.dataSource === "qiwe"
    ? `<span class="tag green">真实同步</span>`
    : `<span class="tag warn">测试/手工</span>`;
  return `<div class="community-group">
    <div class="cg-top"><div><b>${esc(g.name)}</b><span>${channelText(g.channelType)} · ${communityStatusText(g.status)} · ${source}</span></div><button class="btn g s" data-gedit='${esc(JSON.stringify(g))}'${actionAttrs("community.group.manage")}>编辑</button></div>
    <div class="cg-meta"><span>外部群ID：${esc(g.externalGroupId||"待接入")}</span><span>成员：${g.memberCount||0}</span><span>审核：${reviewText(g.reviewMode)}</span></div>
    <p>欢迎语正文由「运营配置」统一管理${g && g.welcomeEnabled===false?"（本群已停发）":""}</p>
  </div>`;
}
function communityMessageRow(r){
  const flag = moderationFlagHtml(r);
  const source = r.dataSource === "qiwe" ? '<span class="tag green">真实 QiWe</span>' : '<span class="tag warn">模拟/手工</span>';
  const openMod = r.moderationFlag && (!r.moderationStatus || r.moderationStatus==="open" || r.moderationStatus==="failed");
  const actions = openMod
    ? `<div class="mod-actions" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
        <button class="btn g s" data-mod-dismiss="${r.id}"${actionAttrs("community.moderation.resolve")}>误报关闭</button>
        <button class="btn g s" data-mod-block="${r.id}"${actionAttrs("community.moderation.resolve")}>标记拦截</button>
        <button class="btn d s" data-mod-kick="${r.id}"${actionAttrs("community.moderation.resolve")} title="极端：踢出群">踢出</button>
        <button class="btn d s" data-mod-revoke="${r.id}"${actionAttrs("community.moderation.resolve")} title="极端：撤回消息">撤回</button>
      </div>`
    : (r.moderationStatus ? `<div class="ops-muted">已处置：${esc(r.moderationAction||r.moderationStatus)}${r.moderationResolvedBy?(" · "+esc(r.moderationResolvedBy)):""}</div>` : "");
  return `<tr><td>${r.id}</td><td>${esc(r.senderName)}<div class="ops-muted">${r.msgType==="event"?"入群事件":"群消息"} · ${source}</div></td>
    <td>${esc((r.text||"").slice(0,90))}${flag}${actions}</td><td><span class="tag ${processTag(r.processStatus)}">${esc(processText(r.processStatus))}</span><div class="ops-muted">${esc(r.matchedSource||"")}</div></td>
    <td>${r.riskLevel?`<span class="risk ${esc(r.riskLevel)}">${riskText(r.riskLevel)}</span>`:"-"}</td><td>${esc(fmtCnTime(r.createdAt,"mdhm"))}</td></tr>`;
}
function moderationFlagText(v){
  return ({offtopic:"待关注·无关话题",anti_doctor:"待关注·对医生不利"}[v]||"待关注");
}
function moderationLevelBadge(v){
  // 群风控严重等级（Phase A2a·词表地板）：高=红显眼 / 中=黄 / 低=灰淡。
  // 注意：这是群风控等级，与「病情风险」列（医疗分诊三档）完全独立，别混用。
  const m = ({ high:["tag red","高危"], medium:["tag warn","中"], low:["tag","低"] })[v];
  return m ? `<span class="${m[0]}" title="群风控等级（与病情风险无关）">${esc(m[1])}</span> ` : "";
}
function moderationFlagHtml(r){
  if(!r.moderationFlag) return "";
  const keys = String(r.moderationKeys||"").trim();
  const title = keys ? ` title="命中词：${esc(keys)}"` : "";
  // Phase A2b：AI 语义天网判定留痕（role=施害/警示/受害/正常 + 一句话依据）——有值才显示，老行/纯词表行不变
  const aiRole = String(r.moderationAiRole||"").trim(), aiReason = String(r.moderationAiReason||"").trim();
  const aiLine = (aiRole || aiReason) ? `<div class="ops-muted">AI 判定：${esc([aiRole, aiReason].filter(Boolean).join("·"))}</div>` : "";
  return `<div class="ops-muted">${moderationLevelBadge(r.moderationLevel)}<span class="tag warn"${title}>${esc(moderationFlagText(r.moderationFlag))}</span></div>${keys?`<div class="ops-muted">命中词：${esc(keys)}</div>`:""}${aiLine}`;
}
function outboxRow(o){
  const text = (o.text||"").length>80 ? o.text.slice(0,80)+"…" : o.text;
  const toDoctor = o.assignee==="doctor";
  const statusCls = o.status==="sent"?"green":(o.status==="cancelled"||o.status==="ignored")?"warn":"blue";
  const actions = o.status==="pending"
    ? `<button class="btn p s" data-osend="${o.id}"${actionAttrs("community.outbox.send")}>确认发送</button> <button class="btn g s" data-oedit="${o.id}"${actionAttrs("community.outbox.edit")}>改字</button> <button class="btn g s" data-oassist="${o.id}"${actionAttrs("assistant_draft.generate")}>AI改写</button> `
      + (toDoctor ? `<button class="btn g s" data-oassign="${o.id}" data-assignee=""${actionAttrs("community.outbox.edit")}>撤回转医助</button> ` : `<button class="btn g s" data-oassign="${o.id}" data-assignee="doctor"${actionAttrs("community.outbox.edit")}>转医生</button> `)
      + `<button class="btn g s" data-oignore="${o.id}"${actionAttrs("community.outbox.edit")}>忽略</button> <button class="btn d s" data-ocancel="${o.id}"${actionAttrs("community.outbox.edit")}>取消</button>`
    : "-";
  const aiMark = o.payload && o.payload.assistantDraft ? `<div class="ops-muted">AI 已改写 · ${esc(o.payload.assistantDraft.contextScope||"")}</div>` : "";
  const evidence = o.payload && Array.isArray(o.payload.evidence) && o.payload.evidence.length ? `<div class="ops-muted">依据：${esc(o.payload.evidence.map(x=>x.title).join(" / "))}</div>` : "";
  const dataSource = o.dataSource === "qiwe" ? '<span class="tag green">真实 QiWe</span>' : '<span class="tag warn">测试/手工</span>';
  return `<tr><td>${o.id}</td><td><span class="tag blue">${esc(sourceText(o.source))}</span><div class="ops-muted">${esc(o.priority||"normal")} · ${dataSource}</div></td>
    <td>${esc(text)}${aiMark}${evidence}</td><td><span class="tag ${statusCls}">${esc(outStatusText(o.status))}</span>${toDoctor?` <span class="tag warn">待医生</span>`:""}<div class="ops-muted">${esc(fmtCnTime(o.createdAt,"mdhm"))}</div>${o.updatedBy?`<div class="ops-muted">最后操作：${esc(o.updatedBy)} · ${esc(fmtCnTime(o.updatedAt,"mdhm"))}</div>`:""}</td>
    <td>${actions}</td></tr>`;
}
function processTag(s){ return /sent|queued|pending|welcome|rule/.test(s||"") ? "green" : /paused|manual|high/.test(s||"") ? "warn" : "blue"; }
function processText(s){
  return ({received:"已接收",welcome_queued:"欢迎语待发送",rule_pending_review:"规则待审核",rule_auto_sent:"规则已自动发送",triage_pending_review:"分诊待审核",triage_auto_sent:"分诊已自动发送",manual_only:"仅人工处理",paused:"已暂停",ignored_empty:"空消息忽略"}[s]||s||"");
}
function sourceText(s){ return ({welcome:"入群欢迎",faq_welcome:"常见问题卡",keyword_rule:"关键词规则",ai_triage:"AI分诊",weekly_ops:"周五科普",ops_candidate:"运营候选",manual:"人工"}[s]||s||""); }
function outStatusText(s){ return ({pending:"待发送",sending:"发送中",sent:"已发送",cancelled:"已取消",ignored:"已忽略"}[s]||s||""); }
function outboxEditModal(o){
  if(!o) return;
  modal("修改待发送文案", `<div class="fld"><label>文案内容（可多行编辑）</label><textarea id="ob_edit_text" style="font-family:inherit;min-height:140px"></textarea></div>`, async ()=>{
    const text = $("#ob_edit_text").value.trim();
    if(!text){ alert("文案不能为空"); return false; }
    await api("POST","/api/admin/community/outbox/"+o.id+"/edit",{ text });
    render(); return true;
  });
  $("#ob_edit_text").value = o.text || ""; // 用 .value 预填原文（非 innerHTML，杜绝存储型 XSS）
}
async function groupModal(g){
  const edit=!!g;
  const isQiwe = !!(g && g.dataSource === "qiwe");
  let suggest=null;   // 仅新增时拉一次建群命名建议（只读，不真建群）；失败则静默退回手填
  if(!edit){ try{ const r=await api("GET","/api/admin/community/groups/suggest-name?doctorId="+curDoc); if(r&&r.ok) suggest=r; }catch(e){} }
  const initName = edit ? (g.name||"") : (suggest&&suggest.suggestedName || "");
  const roomHint = (!edit&&suggest&&suggest.roomBaseName)
    ? `<div class="hint">企微后台配自动建群群活码时的 room_base_name 可填：<b>${esc(suggest.roomBaseName)}</b>（群名可改，留空则由后端按模板自动命名）</div>` : "";
  modal(`${edit?"编辑":"新增"}社群配置`, `
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>群名称</label><input id="cg_name" value="${esc(initName)}">${roomHint}</div>
      <div style="flex:1"><label>渠道</label><select id="cg_channel"${isQiwe?" disabled":""}>${["wechat","wecom","qiwe","web","sms"].map(x=>opt(x,g&&g.channelType,channelText(x))).join("")}</select></div>
    </div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>外部群 ID</label><input id="cg_ext" value="${esc(g?g.externalGroupId:"")}" placeholder="企微/微信回调里的群 ID"${isQiwe?" readonly":""}></div>
      <div style="flex:1"><label>负责人</label><input id="cg_owner" value="${esc(g?g.owner:"医助运营")}"></div>
    </div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>成员数</label><input id="cg_members" type="number" min="0" value="${g?g.memberCount:0}"${isQiwe?" readonly":""}></div>
      <div style="flex:1"><label>状态</label><select id="cg_status">${["pilot","active","paused","archived"].map(x=>opt(x,g&&g.status,communityStatusText(x))).join("")}</select></div>
      <div style="flex:1"><label>审核模式</label><select id="cg_review">${["human_review","auto_keywords","paused"].map(x=>opt(x,g&&g.reviewMode,reviewText(x))).join("")}</select></div>
    </div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>发送欢迎语</label><select id="cg_welcome_en"><option value="1"${!g||g.welcomeEnabled?" selected":""}>启用</option><option value="0"${g&&!g.welcomeEnabled?" selected":""}>停用</option></select><div class="hint">仅开关；正文请到运营配置修改</div></div>
      <div style="flex:1"><label>自动处理</label><select id="cg_auto"><option value="1"${!g||g.autoReplyEnabled?" selected":""}>启用</option><option value="0"${g&&!g.autoReplyEnabled?" selected":""}>停用</option></select></div>
    </div>
    <div class="fld"><label>备注</label><textarea id="cg_notes" style="font-family:inherit;min-height:80px">${esc(g?g.notes:"")}</textarea></div>
  `, async ()=>{
    const payload = { doctorId:curDoc, name:$("#cg_name").value.trim(), channelType:$("#cg_channel").value,
      externalGroupId:$("#cg_ext").value.trim(), owner:$("#cg_owner").value.trim(), memberCount:+$("#cg_members").value||0,
      status:$("#cg_status").value, reviewMode:$("#cg_review").value, welcomeEnabled:$("#cg_welcome_en").value==="1",
      autoReplyEnabled:$("#cg_auto").value==="1", notes:$("#cg_notes").value.trim() };
    if(edit && !payload.name){ alert("群名称必填"); return false; }   // 新增时留空允许：后端按模板自动命名（编辑仍需保留群名）
    if(edit) await api("PUT","/api/admin/community/groups/"+g.id,payload); else await api("POST","/api/admin/community/groups",payload);
    render(); return true;
  });
}

/* ---------- 运营策略台 ---------- */
async function renderOps(m){
  const data = await api("GET","/api/admin/ops-strategy?doctorId="+curDoc);
  const st = data.strategy || {};
  const knowledge = data.knowledge || [];
  const outcomes = data.outcomes || [];
  const summary = data.summary || {};
  const latest = summary.latestOutcome || outcomes[0] || null;
  const delta = latest ? (latest.outpatient_current||0) - (latest.outpatient_baseline||0) : 0;
  const deltaText = latest ? `${latest.outpatient_baseline||0} → ${latest.outpatient_current||0}` : "待回收";
  const deltaSub = latest ? `${esc(latest.period)} · ${delta>=0?"+":""}${delta} 人` : "每月回收医生反馈后展示";
  m.innerHTML = `
    <div class="card ops-hero">
      <div class="ops-head">
        <div><h2>运营策略台 <span class="sub">知识库分层 · 群运营边界 · 医生画像 · 价值评估</span></h2>
          <p>把最新横向信息沉淀成可执行配置：先做群运营，不默认主动私聊；知识库分医院、科室、医生个人和实时运营四层；效果用医生反馈与门诊量趋势回收。</p></div>
        <button class="btn p" id="opsEditStrategy"${actionAttrs("ops.strategy.manage")}>编辑策略</button>
      </div>
      <div class="ops-kpis">
        ${opsKpi("知识条目", summary.knowledgeTotal||knowledge.length, `${summary.knowledgeReady||0} 条可上线 · ${summary.knowledgeDraft||0} 条草稿`)}
        ${opsKpi("最新门诊量", deltaText, deltaSub)}
        ${opsKpi("医生感知增长", latest ? (latest.perceived_growth ? "是" : "未确认") : "待回收", "不做强因果承诺")}
        ${opsKpi("群活跃 / 线索", latest ? `${latest.group_active||0} / ${latest.consult_leads||0}` : "待回收", "群互动与咨询意向")}
      </div>
      <div class="ops-policy">
        ${opsPolicy("群运营模式", st.group_mode)}
        ${opsPolicy("私聊边界", st.private_chat_policy)}
        ${opsPolicy("合作医生画像", st.doctor_profile)}
        ${opsPolicy("科室适配判断", st.specialty_fit)}
        ${opsPolicy("药企价值评估", st.pharma_value)}
        ${opsPolicy("效果回收口径", st.notes)}
      </div>
    </div>
    <div class="ops-grid">
      <section class="card ops-section">
        <h2>AI 知识库分层 <span class="sub">预制菜 / 半预制 / 现炒菜</span><button class="btn p s" id="opsAddKnowledge" style="margin-left:auto"${actionAttrs("knowledge.manage")}>+ 新增知识</button></h2>
        ${knowledge.length ? `<table><tr><th>层级</th><th>模式</th><th>标题 / 内容</th><th>来源 / 负责人</th><th>状态</th><th></th></tr>
          ${knowledge.map(knowledgeRow).join("")}</table>` : '<div class="empty">暂无知识条目。</div>'}
      </section>
      <section class="card ops-section">
        <h2>效果回收 <span class="sub">医生门诊量趋势 · 主观感知 · 群活跃</span><button class="btn p s" id="opsAddOutcome" style="margin-left:auto"${actionAttrs("outcome.manage")}>+ 新增回收</button></h2>
        ${outcomes.length ? `<table><tr><th>周期</th><th>门诊量</th><th>感知</th><th>群活跃</th><th>线索</th><th></th></tr>
          ${outcomes.map(outcomeRow).join("")}</table>` : '<div class="empty">暂无效果回收。建议每月让运营或商务回填一次医生反馈。</div>'}
      </section>
    </div>`;
  bindActionButton($("#opsEditStrategy"), "ops.strategy.manage", ()=>strategyModal(st));
  bindActionButton($("#opsAddKnowledge"), "knowledge.manage", ()=>knowledgeModal(null));
  bindActionButton($("#opsAddOutcome"), "outcome.manage", ()=>outcomeModal());
  m.querySelectorAll("[data-kedit]").forEach(b=>bindActionButton(b, "knowledge.manage", ()=>knowledgeModal(JSON.parse(b.dataset.kedit))));
  m.querySelectorAll("[data-kdel]").forEach(b=>bindActionButton(b, "knowledge.manage", async()=>{ await api("DELETE","/api/admin/knowledge/"+b.dataset.kdel); render(); }, { confirm:"删除该知识条目？", loadingText:"删除中…" }));
  m.querySelectorAll("[data-odel]").forEach(b=>bindActionButton(b, "outcome.manage", async()=>{ await api("DELETE","/api/admin/outcomes/"+b.dataset.odel); render(); }, { confirm:"删除该效果回收记录？", loadingText:"删除中…" }));
}
function opsKpi(label, value, sub){
  return `<div class="ops-kpi"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(sub||"")}</small></div>`;
}
function opsPolicy(title, body){
  return `<div class="ops-policy-item"><span>${esc(title)}</span><p>${esc(body||"待配置")}</p></div>`;
}
function knowledgeRow(k){
  const body = (k.body||"").length>72 ? (k.body.slice(0,72)+"…") : (k.body||"");
  return `<tr><td><span class="tag blue">${esc(k.layer)}</span></td><td><span class="ops-mode ${opsModeCls(k.mode)}">${esc(k.mode)}</span></td>
    <td><b>${esc(k.title)}</b><div class="ops-muted">${esc(body)}</div></td>
    <td>${esc(k.source||"-")}<div class="ops-muted">${esc(k.owner||"")}</div></td>
    <td>${opsStatusTag(k.status)}</td>
    <td><button class="btn g s" data-kedit='${esc(JSON.stringify(k))}'${actionAttrs("knowledge.manage")}>编辑</button> <button class="btn d s" data-kdel="${k.id}"${actionAttrs("knowledge.manage")}>删</button></td></tr>`;
}
function outcomeRow(o){
  const delta = (o.outpatient_current||0) - (o.outpatient_baseline||0);
  return `<tr><td><b>${esc(o.period)}</b><div class="ops-muted">${esc(fmtCnTime(o.created_at))}</div></td>
    <td>${o.outpatient_baseline||0} → ${o.outpatient_current||0}<div class="ops-muted">${delta>=0?"+":""}${delta} 人</div></td>
    <td>${o.perceived_growth?'<span class="tag green">有感知</span>':'<span class="tag warn">未确认</span>'}</td>
    <td>${o.group_active||0}</td><td>${o.consult_leads||0}<div class="ops-muted">${esc(o.notes||"")}</div></td>
    <td><button class="btn d s" data-odel="${o.id}"${actionAttrs("outcome.manage")}>删</button></td></tr>`;
}
function opsModeCls(mode){ return mode==="预制菜"?"pre":mode==="现炒菜"?"live":"semi"; }
function opsStatusTag(s){
  if(s==="ready") return '<span class="tag green">可上线</span>';
  if(s==="retired") return '<span class="tag">已停用</span>';
  return '<span class="tag warn">草稿</span>';
}
function opt(v, cur, label){ return `<option value="${esc(v)}"${v===cur?" selected":""}>${esc(label||v)}</option>`; }
function strategyModal(s){
  modal("编辑运营策略", `
    <div class="fld"><label>群运营模式</label><textarea id="os_group" style="font-family:inherit">${esc(s.group_mode||"")}</textarea></div>
    <div class="fld"><label>私聊边界</label><textarea id="os_private" style="font-family:inherit">${esc(s.private_chat_policy||"")}</textarea></div>
    <div class="fld"><label>合作医生画像</label><textarea id="os_profile" style="font-family:inherit">${esc(s.doctor_profile||"")}</textarea></div>
    <div class="fld"><label>科室适配判断</label><textarea id="os_fit" style="font-family:inherit">${esc(s.specialty_fit||"")}</textarea></div>
    <div class="fld"><label>药企价值评估</label><textarea id="os_pharma" style="font-family:inherit">${esc(s.pharma_value||"")}</textarea></div>
    <div class="fld"><label>效果回收口径</label><textarea id="os_notes" style="font-family:inherit">${esc(s.notes||"")}</textarea></div>
  `, async ()=>{
    await api("PUT","/api/admin/ops-strategy",{ doctorId:curDoc, group_mode:$("#os_group").value.trim(),
      private_chat_policy:$("#os_private").value.trim(), doctor_profile:$("#os_profile").value.trim(),
      specialty_fit:$("#os_fit").value.trim(), pharma_value:$("#os_pharma").value.trim(), notes:$("#os_notes").value.trim() });
    render(); return true;
  });
}
function knowledgeModal(k){
  const edit = !!k, curLayer = (k&&k.layer)||"医生个人", curMode = (k&&k.mode)||"半预制", curStatus = (k&&k.status)||"draft";
  modal(`${edit?"编辑":"新增"}知识条目`, `
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>知识层级</label><select id="k_layer">${["医院通用","医院/科室通用","医生个人","群运营动态"].map(x=>opt(x,curLayer)).join("")}</select></div>
      <div style="flex:1"><label>生产模式</label><select id="k_mode">${["预制菜","半预制","现炒菜"].map(x=>opt(x,curMode)).join("")}</select></div>
      <div style="flex:1"><label>状态</label><select id="k_status">${[["draft","草稿"],["ready","可上线"],["retired","已停用"]].map(x=>opt(x[0],curStatus,x[1])).join("")}</select></div>
    </div>
    <div class="fld"><label>标题</label><input id="k_title" value="${esc(k?k.title:"")}" placeholder="如：本周门诊变更与群公告"></div>
    <div class="fld"><label>内容</label><textarea id="k_body" style="font-family:inherit;min-height:150px">${esc(k?k.body:"")}</textarea></div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>来源</label><input id="k_source" value="${esc(k?k.source:"")}" placeholder="医生/科室/运营实时整理"></div>
      <div style="flex:1"><label>负责人</label><input id="k_owner" value="${esc(k?k.owner:"")}" placeholder="医学运营 / 群运营"></div>
    </div>
  `, async ()=>{
    const payload = { doctorId:curDoc, layer:$("#k_layer").value, mode:$("#k_mode").value, status:$("#k_status").value,
      title:$("#k_title").value.trim(), body:$("#k_body").value.trim(), source:$("#k_source").value.trim(), owner:$("#k_owner").value.trim() };
    if(!payload.title){ alert("标题必填"); return false; }
    if(edit) await api("PUT","/api/admin/knowledge/"+k.id,payload); else await api("POST","/api/admin/knowledge",payload);
    render(); return true;
  });
}
function outcomeModal(){
  const ym = new Date().toISOString().slice(0,7);
  modal("新增效果回收", `
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>回收周期</label><input id="o_period" type="month" value="${ym}"></div>
      <div style="flex:1"><label>基准门诊量</label><input id="o_base" type="number" min="0" value="0"></div>
      <div style="flex:1"><label>本期门诊量</label><input id="o_cur" type="number" min="0" value="0"></div>
    </div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>医生是否直观感知增长</label><select id="o_growth"><option value="1">是</option><option value="0" selected>未确认</option></select></div>
      <div style="flex:1"><label>群活跃次数</label><input id="o_active" type="number" min="0" value="0"></div>
      <div style="flex:1"><label>咨询/就诊线索</label><input id="o_leads" type="number" min="0" value="0"></div>
    </div>
    <div class="fld"><label>回收备注</label><textarea id="o_notes" style="font-family:inherit;min-height:100px" placeholder="例如：医生反馈本月门诊新患者略有增加，但无法直接归因到产品；群内高频问题集中在复诊和检查准备。"></textarea></div>
  `, async ()=>{
    const period = $("#o_period").value.trim();
    if(!period){ alert("回收周期必填"); return false; }
    await api("POST","/api/admin/outcomes",{ doctorId:curDoc, period, outpatient_baseline:+$("#o_base").value||0,
      outpatient_current:+$("#o_cur").value||0, perceived_growth:$("#o_growth").value==="1",
      group_active:+$("#o_active").value||0, consult_leads:+$("#o_leads").value||0, notes:$("#o_notes").value.trim() });
    render(); return true;
  });
}

async function renderConfigCenter(m){
  let data, audit, triageSessions = [];
  try{
    data = await api("GET","/api/admin/config-center?doctorId="+curDoc);
    audit = await api("GET","/api/admin/config-center/audit?doctorId="+curDoc);
    try{ triageSessions = await api("GET","/api/admin/triage/sessions?doctorId="+curDoc); }catch(e){ triageSessions = []; }
  }catch(e){
    m.innerHTML = `<div class="card"><h2>运营配置中心</h2><div class="empty">加载失败：${esc(e.message)}</div></div>`;
    return;
  }
  const domains = data.domains || [];
  if(!domains.length){
    m.innerHTML = `<div class="card"><h2>运营配置中心</h2><div class="empty">当前账号没有可编辑的配置域。</div></div>`;
    return;
  }
  if(!domains.find(d=>d.domain===configDomain)) configDomain = domains[0].domain;
  const cur = domains.find(d=>d.domain===configDomain) || domains[0];
  const draftCfg = cur.draft || {};
  const jsonText = JSON.stringify(cur.draft || {}, null, 2);
  const publishedText = JSON.stringify(cur.published || {}, null, 2);
  const draftChanged = configChanged(cur.draft || {}, cur.published || {});
  m.innerHTML = `
    <div class="config-page">
      <div class="config-tabs">
        ${domains.map(d=>`<button class="${d.domain===cur.domain?"on":""}" data-cfg-domain="${esc(d.domain)}">${esc(d.title)}${d.superOnly?'<span>超管</span>':''}</button>`).join("")}
      </div>
      <div class="cfg-contextbar">
        <div>
          <div class="cfg-action-title">${esc(cur.title)} <span>${esc(cur.desc||"")}</span></div>
          <div class="cfg-state-line">
            <span>${cur.scope==="global"?"适用所有医生":"只影响当前医生"}</span>
            <span>${cur.canEdit?"运营可编辑":"只读"}</span>
            <span>当前使用 v${cur.publishedVersion||0}</span>
          </div>
        </div>
          <div class="cfg-context-help">左侧改内容，右侧看“现在患者和医助实际看到的版本”。</div>
      </div>
      <div class="card cfg-actionbar">
        <div class="toolbar cfg-action-buttons">
          <button class="btn p" id="cfgSave"${configActionAttrs("config.draft", cur.canEdit)}>保存草稿</button>
          <button class="btn g" id="cfgPreview"${can("config.draft") ? "" : actionAttrs("config.draft")}>预览校验</button>
          <button class="btn p" id="cfgPublish"${configActionAttrs("config.publish", cur.canEdit)}>发布生效</button>
          <button class="btn d" id="cfgRollback"${configActionAttrs("config.publish", cur.canEdit)}>回滚</button>
        </div>
        <div class="cfg-action-copy">
          <b id="cfgDirtyState" class="${draftChanged?"dirty":(cur.updatedAt?"saved":"")}">${configDraftStateTitle(cur, draftChanged)}</b>
          <span id="cfgDirtyHint">${configDraftStateHint(cur, draftChanged)}</span>
        </div>
        <div class="cfg-live-mini">
          <b>${configLiveStateText(cur, draftChanged)}</b>
          <span>${cur.publishedAt ? `发布于 ${configTimeText(cur.publishedAt)}` : "尚未发布自定义版本"}</span>
        </div>
      </div>
      <div id="cfg_msg" class="community-note cfg-msg">${configStatusMessage(cur, draftChanged)}</div>
      <div class="ops-grid config-workbench">
        <section class="card ops-section config-editor">
          <h2>编辑内容 <span class="sub">先保存草稿，确认无误后再发布</span></h2>
          ${configWorkflowGuide(cur, draftChanged)}
          ${configFriendlyEditor(cur, draftCfg)}
          <details class="cfg-advanced">
            <summary>批量维护（管理员使用）</summary>
            <div class="fld"><label>批量配置内容</label><textarea id="cfg_json" style="min-height:260px;font-family:ui-monospace,Consolas,monospace" ${can("config.draft")?"":"readonly"}>${esc(jsonText)}</textarea>
              <div class="hint">普通运营请优先改上方场景卡片；这里用于管理员批量维护，禁止填写任何密钥或密码。</div></div>
          </details>
        </section>
        <section class="card ops-section config-live-panel">
          <h2>当前正在使用 <span class="sub">患者群和医助后台实际看到的内容</span></h2>
          ${configPublishedNotice(cur, draftChanged)}
          ${configPublishedViewer(cur, cur.published || {})}
          <details class="cfg-advanced">
            <summary>批量查看（管理员使用）</summary>
            <pre class="cfg-json-view">${esc(publishedText)}</pre>
          </details>
          <h2 style="margin-top:16px">操作记录 <span class="sub">最近 80 条</span></h2>
          ${configAuditHtml(audit.rows || [])}
        </section>
      </div>
      ${configTriageQueueHtml(triageSessions || [])}
    </div>`;
  m.querySelectorAll("[data-cfg-domain]").forEach(b=>b.onclick=()=>{ configDomain=b.dataset.cfgDomain; render(); });
  m.querySelectorAll("[data-config-session]").forEach(b=>b.onclick=()=>{ triageSessionId=+b.dataset.configSession; curTab="triage"; triagePane="chat"; buildNav(); render(); });
  const msg = (html, bad)=>{ const el=$("#cfg_msg"); el.innerHTML=html; el.style.borderColor = bad ? "#ffd6d6" : "#edf0f2"; el.style.background = bad ? "#fff7f7" : "#f7f9fa"; };
  const dirtyState = $("#cfgDirtyState");
  const dirtyHint = $("#cfgDirtyHint");
  const setDirty = (dirty)=>{
    if(!dirtyState || !dirtyHint) return;
    dirtyState.textContent = dirty ? "有未保存修改" : "草稿已保存";
    dirtyHint.textContent = dirty ? "当前输入框里的改动还没保存；离开页面前请先点“保存草稿”。" : "草稿已经保存；发布前不会影响患者或医助。";
    dirtyState.className = dirty ? "dirty" : "saved";
  };
  const readCfg = ()=>{
    try{
      let v = JSON.parse($("#cfg_json").value);
      if(!v || typeof v !== "object" || Array.isArray(v)) throw new Error("批量配置内容格式不正确");
      v = collectConfigForm(cur.domain, v);
      $("#cfg_json").value = JSON.stringify(v, null, 2);
      return v;
    }catch(e){ alert("批量配置内容格式错误："+e.message); return null; }
  };
  m.querySelectorAll(".cfg-field, #cfg_json").forEach(el=>el.addEventListener("input", ()=>setDirty(true)));
  m.querySelectorAll("[data-insert-field]").forEach(btn=>btn.onclick=()=>{
    const card = btn.closest(".cfg-card");
    const ta = card && card.querySelector("textarea.cfg-field");
    if(!ta) return;
    const token = btn.dataset.insertField || "";
    const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const end = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0,start) + token + ta.value.slice(end);
    ta.focus();
    const pos = start + token.length;
    try{ ta.setSelectionRange(pos,pos); }catch(e){}
    setDirty(true);
  });
  bindConfigButton($("#cfgSave"), "config.draft", cur.canEdit, async()=>{
    const cfg = readCfg(); if(!cfg) return;
    try{ const r = await api("PUT","/api/admin/config-center/"+cur.id+"/draft",{config:cfg}); setDirty(false); msg(`草稿已保存（${configTimeText(r.updatedAt)}，操作人 ${esc(r.updatedBy||"-")}）。<br>注意：保存草稿不会立即影响患者，确认无误后请点“发布生效”。<br>${configValidationText(r.validation)}`); }
    catch(e){ msg("保存失败："+esc(e.message), true); }
  }, { loadingText:"保存中…" });
  bindActionButton($("#cfgPreview"), "config.draft", async()=>{
    const cfg = readCfg(); if(!cfg) return;
    try{ const r = await api("POST","/api/admin/config-center/"+cur.id+"/preview",{config:cfg}); msg(`${esc(r.impact||"")}<br>${configValidationText(r.validation)}<br>${esc(r.testResult||"")}`, !r.ok); }
    catch(e){ msg("预览失败："+esc(e.message), true); }
  }, { loadingText:"校验中…" });
  bindConfigButton($("#cfgPublish"), "config.publish", cur.canEdit, async()=>{
    try{ const r = await api("POST","/api/admin/config-center/"+cur.id+"/publish",{}); msg(`发布成功：v${r.version}（${configTimeText(r.publishedAt)}）。${configValidationText(r.validation)}`); render(); }
    catch(e){ msg("发布失败："+esc(e.message), true); }
  }, { confirm:"确认发布该配置？发布后患者群和医助后台会优先使用这版内容；发布前会再次校验，失败不会生效。", loadingText:"发布中…" });
  bindConfigButton($("#cfgRollback"), "config.publish", cur.canEdit, async()=>{
    try{ const r = await api("POST","/api/admin/config-center/"+cur.id+"/rollback",{}); msg(`回滚完成：v${r.version}${r.restoredPrevious?"，已恢复上一版":"，无上一版，已同步当前发布版"}。`); render(); }
    catch(e){ msg("回滚失败："+esc(e.message), true); }
  }, { confirm:"确认回滚到上一已发布版本？如果没有上一版，将恢复当前已发布配置。", loadingText:"回滚中…" });
}
function configTriageQueueHtml(sessions){
  const rows = (sessions || []).slice(0,6);
  return `<section class="card config-queue">
    <div class="config-queue-head">
      <h2>AI 分诊 / 待审核草稿 <span class="sub">${rows.length ? rows.length+" 条最近会话" : "当前无待处理"}</span></h2>
      <button class="btn g s" type="button" data-config-session="${rows[0] ? esc(rows[0].id) : ""}" ${rows[0]?"":"disabled"}>进入 AI 分诊台</button>
    </div>
      ${rows.length ? `<table>
      <tr><th>患者/来源</th><th>最近消息</th><th>风险等级</th><th>处理状态</th><th>操作</th></tr>
      ${rows.map(s=>`<tr>
        <td>${esc(s.patient_name||"群友")}</td>
        <td>${esc((s.last_patient_text||"").slice(0,56))}</td>
        <td><span class="risk ${esc(s.risk_level||"low")}">${riskText(s.risk_level)}</span></td>
        <td>${esc(statusText(s.status))}</td>
        <td><button class="btn p s" type="button" data-config-session="${esc(s.id)}">查看处理</button></td>
      </tr>`).join("")}
    </table>` : `<div class="empty">暂无最近分诊会话。运营配置发布后，会在患者群和医助后台生效。</div>`}
  </section>`;
}
function configFriendlyEditor(cur, cfg){
  if(cur.domain === "scripts") return configScriptsEditor(cfg);
  if(cur.domain === "prompts") return configPromptsEditor(cfg);
  if(cur.domain === "safety") return configSafetyEditor(cfg);
  if(cur.domain === "doctor_group") return configDoctorGroupViewer(cfg);
  if(cur.domain === "codes_cards") return configCodesCardsViewer(cfg);
  return `<div class="community-note">当前配置暂未做场景化表单，可使用下方“批量维护”编辑。</div>`;
}
function configSort(v){
  if(Array.isArray(v)) return v.map(configSort);
  if(v && typeof v === "object"){
    return Object.keys(v).sort().reduce((o,k)=>{ o[k] = configSort(v[k]); return o; }, {});
  }
  return v;
}
function configChanged(a,b){
  try{ return JSON.stringify(configSort(a||{})) !== JSON.stringify(configSort(b||{})); }
  catch(e){ return true; }
}
function configTimeText(t){
  return t ? (fmtCnTime(t) || "暂无记录") : "暂无记录";
}
function configLiveStateText(cur, changed){
  if(changed) return "有草稿未发布";
  if((cur.publishedVersion||0) > 0) return "已发布生效";
  return "使用默认值";
}
function configDraftStateTitle(cur, changed){
  if(changed) return "有草稿未发布";
  if(cur.updatedAt) return "草稿已保存";
  return "尚未保存草稿";
}
function configDraftStateHint(cur, changed){
  if(changed) return "右侧仍是当前生效内容；预览校验通过后再发布。";
  if(cur.updatedAt) return `最近保存 ${configTimeText(cur.updatedAt)}；发布后才影响患者和医助。`;
  return "先编辑并保存草稿，再预览校验、发布生效。";
}
function configStatusMessage(cur, changed){
  const saved = cur.updatedAt ? `最近保存：${configTimeText(cur.updatedAt)}${cur.updatedBy?` / ${esc(cur.updatedBy)}`:""}` : "还没有保存记录";
  const pub = cur.publishedAt ? `已发布：v${cur.publishedVersion||0} / ${configTimeText(cur.publishedAt)}${cur.publishedBy?` / ${esc(cur.publishedBy)}`:""}` : "还没有单独发布，系统使用医生默认内容";
  return `${saved}。${pub}。${changed ? "当前有已保存但未发布的改动，发布后才会影响患者和医助。" : "当前没有待发布改动。"}`;
}
function configWorkflowGuide(cur, changed){
  return `<div class="cfg-workflow">
    <div class="cfg-step ${changed?"on":""}"><b>1. 编辑草稿</b><span>这里会显示已经保存过的草稿；改动后先保存，不会立刻影响患者。</span></div>
    <div class="cfg-step"><b>2. 预览校验</b><span>系统检查是否漏填、是否碰到安全红线；失败时不会发布。</span></div>
    <div class="cfg-step ${!changed && cur.publishedAt?"on":""}"><b>3. 发布生效</b><span>右侧“当前生效版本”才是患者和医助当前实际使用的内容。</span></div>
  </div>`;
}
function configPublishedNotice(cur, changed){
  const pub = cur.publishedAt ? `当前版本：v${cur.publishedVersion||0}，${configTimeText(cur.publishedAt)} 发布` : "当前还没有发布过运营自定义版本";
  return `<div class="cfg-published-note ${changed?"warn":""}">
    <b>${changed ? "草稿已变更但尚未发布" : "这是当前实际使用内容"}</b>
    <span>${esc(pub)}。${changed ? "左侧保存过的草稿不会自动生效，发布后这里会同步更新。" : "运营验收时以这里和发布记录为准。"}</span>
  </div>`;
}
function configPublishedViewer(cur, cfg){
  const empty = !cfg || !Object.keys(cfg).length;
  const fallback = empty ? `<div class="cfg-published-note warn"><b>没有运营自定义发布</b><span>系统会继续使用医生默认内容；保存草稿并发布后，这里会显示运营可读版本。</span></div>` : "";
  if(cur.domain === "scripts") return `${fallback}<div class="cfg-cards cfg-readonly-cards">${scriptConfigFields().filter(f=>!f.hidden).map(f=>cfgReadOnlyCard(f, cfg[f.key])).join("")}</div>`;
  if(cur.domain === "prompts") return `${fallback}<div class="cfg-cards cfg-readonly-cards">${promptConfigFields().map(f=>cfgReadOnlyCard(f, cfg[f.key])).join("")}</div>`;
  if(cur.domain === "safety") return `${fallback}${configSafetyPublishedViewer(cfg)}`;
  if(cur.domain === "doctor_group") return `${fallback}${configDoctorGroupViewer(cfg)}`;
  if(cur.domain === "codes_cards") return `${fallback}${configCodesCardsViewer(cfg)}`;
  return `${fallback}<div class="community-note">当前配置暂未做运营摘要，管理员可展开下方“批量查看”。</div>`;
}
function cfgVarChips(){
  return `<details class="cfg-vars">
    <summary>插入自动填充项</summary>
    <p>点击后会插入“患者称呼、群名称、医生姓名”等字段，发布后系统会自动填成真实信息。</p>
    <div class="cfg-var-body">
      <button type="button" data-insert-field="【患者称呼】">患者称呼</button>
      <button type="button" data-insert-field="【患者群名称】">患者群名称</button>
      <button type="button" data-insert-field="【负责医生】">负责医生</button>
      <button type="button" data-insert-field="【科室】">科室</button>
      <button type="button" data-insert-field="【医院】">医院</button>
    </div>
  </details>`;
}
const CFG_DISPLAY_TOKENS = [
  ["{patient}", "【患者称呼】"],
  ["{group}", "【患者群名称】"],
  ["{doctor}", "【负责医生】"],
  ["{dept}", "【科室】"],
  ["{hospital}", "【医院】"]
];
function configStripInternalTokens(v){
  return String(v == null ? "" : v)
    .replace(/[（(]\s*\{senderId\}\s*[）)]/g, "")
    .replace(/\{senderId\}/g, "");
}
function configTextForOps(v){
  let s = configStripInternalTokens(v);
  CFG_DISPLAY_TOKENS.forEach(pair=>{ s = s.split(pair[0]).join(pair[1]); });
  return s;
}
function configTextForSave(v){
  let s = configStripInternalTokens(v);
  CFG_DISPLAY_TOKENS.forEach(pair=>{ s = s.split(pair[1]).join(pair[0]); });
  return s;
}
function cfgTextCard(f, value){
  const readonly = f.readonly || !can("config.draft");
  return `<div class="cfg-card">
    <div class="cfg-card-head">
      <div><b>${esc(f.title)}</b><p>${esc(f.summary||"")}</p></div>
      <span class="cfg-status ${f.statusCls||""}">${esc(f.status||"可配置")}</span>
    </div>
    <div class="cfg-meta">
      <span><b>谁会看到</b>${esc(f.audience||"-")}</span>
      <span><b>什么时候用</b>${esc(f.trigger||"-")}</span>
      <span><b>系统会怎么做</b>${esc(f.impact||"-")}</span>
    </div>
    ${f.vars ? cfgVarChips() : ""}
    <textarea class="cfg-field" data-cfg-key="${esc(f.key)}" ${readonly?"readonly":""}>${esc(configTextForOps(value||""))}</textarea>
    ${f.tip?`<div class="hint">${esc(f.tip)}</div>`:""}
  </div>`;
}
function cfgReadOnlyCard(f, value){
  const text = Array.isArray(value) ? value.join("\n") : (value || "");
  const valueHtml = cfgPublishedValueHtml(configTextForOps(text));
  return `<div class="cfg-card cfg-read-card">
    <div class="cfg-card-head">
      <div><b>${esc(f.title)}</b><p>${esc(f.summary||"")}</p></div>
      <span class="cfg-status ${f.statusCls||""}">${esc(f.status||"正在使用")}</span>
    </div>
    <div class="cfg-meta">
      <span><b>谁会看到</b>${esc(f.audience||"-")}</span>
      <span><b>什么时候用</b>${esc(f.trigger||"-")}</span>
      <span><b>系统会怎么做</b>${esc(f.impact||"-")}</span>
    </div>
    <div class="cfg-read-value">${valueHtml}</div>
    ${f.tip?`<div class="hint">${esc(f.tip)}</div>`:""}
  </div>`;
}
function cfgPublishedValueHtml(text){
  const t = String(text || "").trim();
  if(t === "-") return `<span class="cfg-empty-value"><b>不外发</b>该功能当前标记为“-”，患者发送这个编号时不会使用这条话术。</span>`;
  if(!t) return `<span class="cfg-empty-value"><b>未单独发布</b>当前没有运营自定义内容，系统继续使用医生默认内容。</span>`;
  return esc(text);
}
/* 字段定义含 hidden:true 的卡片会在编辑/只读两处渲染跳过，见 configScriptsEditor / configPublishedViewer。
   吕富靖编号话术以最新 docx 的「引导语」列为固定内容来源；616/626/808 也直接展示固定值。 */
function scriptConfigFields(){
  return [
    { key:"groupWelcome", title:"新患者进群欢迎语", summary:"患者刚进入群时看到的第一段说明（全群统一，仅在此维护）。", audience:"新入群患者 / 群内成员", trigger:"有人加入患者群", impact:"所有群共用这段欢迎语；社群工作台仅可开关是否发送", status:"正在使用", statusCls:"ok", vars:true,
      tip:"建议包含：欢迎、改群昵称、发送 1 看菜单、发送 101 咨询、急症线下就医/120。" },
    { key:"memberVisit", title:"医助内部新患者提醒", summary:"提醒医助有人首次出现，不能发给患者。", audience:"医助 / 运营内部", trigger:"新患者首次在群里发言", impact:"只出现在医助侧边栏/审核台，不会发到群里", status:"仅内部", statusCls:"safe", vars:true,
      tip:"这条只供医助关注，不会直接发到群里。" },
    { key:"voice", title:"语音识别失败提示", summary:"系统听不清语音时给患者的服务型提示。", audience:"发语音的患者", trigger:"收到语音但没有识别出文字", impact:"会进入医助确认流程", status:"正在使用", statusCls:"ok", vars:true },
    { key:"nonText", title:"图片 / 文件兜底提示", summary:"患者发图片、文件、视频时的安全兜底。", audience:"发资料的患者", trigger:"收到图片、文件或视频", impact:"会进入医助确认流程", status:"正在使用", statusCls:"ok", vars:true },
    { key:"transferHuman", title:"转人工提示", summary:"病情、用药、诊断等需要人工确认时使用。", audience:"患者", trigger:"命中人工处理或中高风险", impact:"患者群处理流程会使用这段提醒", status:"群内使用", statusCls:"semi" },
    { key:"emergency", title:"急症提醒", summary:"胸痛、呼吸困难、呕血黑便等红旗场景。", audience:"患者", trigger:"命中高风险红旗词", impact:"患者群处理流程会优先使用这段提醒", status:"群内使用", statusCls:"semi" },
    { key:"code101", title:"101 医生咨询", summary:"引导患者 1 对 1 咨询医生。", audience:"发送 101 的患者", trigger:"患者群编号 101", impact:"患者群会回复这段话，并配合医生主页卡片", status:"正在使用", statusCls:"ok" },
    { key:"code102", title:"102 视频问诊", summary:"引导患者进入视频问诊/医生主页入口。", audience:"发送 102 的患者", trigger:"患者群编号 102", impact:"患者群会回复这段话，并配合医生主页卡片", status:"正在使用", statusCls:"ok" },
    { key:"code103", title:"103 查看就医相关电话", summary:"回复医院院区电话、科室电话和地址。", audience:"发送 103 的患者", trigger:"患者群编号 103", impact:"患者群会直接回复", status:"正在使用", statusCls:"ok" },
    { key:"code105", title:"105 查看回复", summary:"提示患者查看医生回复。", audience:"发送 105 的患者", trigger:"患者群编号 105", impact:"患者群会回复这段话，并配合查看回复卡片", status:"正在使用", statusCls:"ok" },
    { key:"code201", title:"201 挂号及门诊时间", summary:"说明挂号平台、出诊时间与就诊路径。", audience:"发送 201 的患者", trigger:"患者群编号 201", impact:"患者群会按挂号规则回复", status:"正在使用", statusCls:"ok" },
    { key:"code202", title:"202 特殊疾病门诊", summary:"最新配置标记低优先级不做，默认不外发。", audience:"发送 202 的患者", trigger:"患者群编号 202", impact:"填“-”表示暂不对患者回复", status:"不做", statusCls:"safe" },
    { key:"code301", title:"301 加号", summary:"说明群内专属加号和申请步骤。", audience:"发送 301 的患者", trigger:"患者群编号 301", impact:"患者群会回复；加号前会引导先填医患联络表", status:"正在使用", statusCls:"ok" },
    { key:"code302", title:"302 住院预约", summary:"说明住院预约登记、医助告知和电话通知边界。", audience:"发送 302 的患者", trigger:"患者群编号 302", impact:"患者群会回复，并配合问卷/卡片入口", status:"正在使用", statusCls:"ok" },
    { key:"code501", title:"501 转诊认识其他医生", summary:"最新配置标记低优先级不做，默认不外发。", audience:"发送 501 的患者", trigger:"患者群编号 501", impact:"填“-”表示暂不对患者回复", status:"不做", statusCls:"safe" },
    { key:"code606", title:"606 学习科普", summary:"引导患者关注吕主任科普渠道。", audience:"发送 606 的患者", trigger:"患者群编号 606", impact:"患者群会直接回复", status:"正在使用", statusCls:"ok" },
    { key:"code616", title:"616 住院及手术知识", summary:"按最新引导语固定为直接弹出链接。", audience:"发送 616 的患者", trigger:"患者群编号 616", impact:"患者群会配合链接或文章入口", status:"正在使用", statusCls:"ok" },
    { key:"code626", title:"626 就医常见问题", summary:"按最新引导语固定为直接弹出链接。", audience:"发送 626 的患者", trigger:"患者群编号 626", impact:"患者群会配合常见问题入口", status:"正在使用", statusCls:"ok" },
    { key:"code808", title:"808 医生简介展示", summary:"按最新引导语固定为直接弹出链接。", audience:"发送 808 的患者", trigger:"患者群编号 808", impact:"患者群会配合医生介绍入口", status:"正在使用", statusCls:"ok" },
    { key:"code818", title:"818 医生介绍给亲友", summary:"引导保存医生海报并转发。", audience:"发送 818 的患者", trigger:"患者群编号 818", impact:"患者群会回复海报转发说明", status:"正在使用", statusCls:"ok" },
    { key:"code888", title:"888 查看我的特权卡", summary:"当前甲方裁定不做，默认不外发。", audience:"发送 888 的患者", trigger:"患者群编号 888", impact:"填“-”表示暂不对患者回复", status:"不做", statusCls:"safe" },
    { key:"code909", title:"909 感谢医生", summary:"回复感谢医生后的确认话术。", audience:"发送 909 的患者", trigger:"患者群编号 909", impact:"患者群会回复，并配合感谢医生入口", status:"正在使用", statusCls:"ok" },
    { key:"code919", title:"919 评价医生", summary:"引导分享就医感受。", audience:"发送 919 的患者", trigger:"患者群编号 919", impact:"患者群会回复，并配合评价入口", status:"正在使用", statusCls:"ok" },
    { key:"code979", title:"979 医患联络表", summary:"引导患者提交基础信息并改群昵称。", audience:"发送 979 / 医患联络表 / 建档 的患者", trigger:"患者发送 979，或提到建档、联络表、基础信息", impact:"患者群会回复，并配合问卷/卡片入口", status:"正在使用", statusCls:"ok" }
  ];
}
function promptConfigFields(){
  return [
    { key:"riskAssessment", title:"风险判断说明", summary:"两轴：ClinicalRisk（病情）× SendPolicy（出站：auto / card_only / review / block）。", audience:"医助后台判断结果 / Agent 口径", trigger:"患者发来普通问题时", impact:"影响风险判断说明，不会覆盖本地安全红线", status:"正在使用", statusCls:"ok" },
    { key:"intakeCard", title:"病历整理说明", summary:"说明系统按哪些维度整理患者资料。", audience:"医助看到的病历卡", trigger:"生成患者信息摘要时", impact:"影响医助看到的结构化资料", status:"正在使用", statusCls:"ok" },
    { key:"lowRiskReply", title:"低风险回复风格", summary:"低风险服务回复：自然语言引导 + 发卡，不要只教编号口令。", audience:"低风险患者 / 医助审核区", trigger:"患者问题被判为低风险（SendPolicy=auto）时", impact:"仍会经过安全扫描，不可诊断/开药", status:"正在使用", statusCls:"ok" },
    { key:"intentRecognition", title:"患者需求识别说明", summary:"识别咨询、挂号、住院、随访、投诉、闲聊、紧急症状；保留编号硬跳转。", audience:"Agent 意图与编号快路径", trigger:"判断患者想办什么事时", impact:"无法判断或涉医疗判断时转人工", status:"正在使用", statusCls:"ok" }
  ];
}
function configScriptsEditor(cfg){
  return `<div class="cfg-explain">
      <b>这页改的是“会被患者或医助看到的话”。</b>
      <span>先保存草稿，再预览校验，最后发布；发布后系统优先使用这里的内容，读不到才用医生默认话术。</span>
    </div>
    <div class="cfg-cards">${scriptConfigFields().filter(f=>!f.hidden).map(f=>cfgTextCard(f, cfg[f.key])).join("")}</div>`;
}
function configPromptsEditor(cfg){
  return `<div class="cfg-explain">
      <b>这页改的是 AI 助手的判断口径，不是直接发给患者的原文。</b>
      <span>运营可以写业务边界和表达风格；不能让 AI 下诊断、开药、解释报告或承诺疗效。</span>
    </div>
    <div class="cfg-cards">${promptConfigFields().map(f=>cfgTextCard(f, cfg[f.key])).join("")}</div>`;
}
function configSafetyEditor(cfg){
  const levels = cfg.levels || {};
  return `<div class="cfg-explain danger">
      <b>安全红线 + 风险两轴（ClinicalRisk × SendPolicy）。</b>
      <span>红旗词/转人工词只允许超管维护。出站以 Dialogue Agent 为准：中风险仅发卡可自动，医疗建议须人工确认。</span>
    </div>
    <div class="cfg-cards">
      ${cfgTextCard({ key:"redFlags", title:"高风险红旗词", summary:"命中后 ClinicalRisk=high：固定安全话术 + 转人工，提示线下急诊/120。", audience:"患者群和医助后台", trigger:"患者消息包含这些词", impact:"全局生效，系统不能把它降成低风险", status:"超管", statusCls:"danger", tip:"一行一个词，例如：胸痛、呼吸困难、呕血、黑便。"}, (cfg.redFlags||[]).join("\n"))}
      ${cfgTextCard({ key:"humanTriggers", title:"必须人工判断词", summary:"诊断、用药、手术、报告解读等 → SendPolicy=review，不能自动答。", audience:"患者群和医助后台", trigger:"患者提出具体医疗判断", impact:"全局生效，命中后转人工待审", status:"超管", statusCls:"danger", tip:"一行一个词，例如：要不要手术、怎么吃药、报告怎么看。"}, (cfg.humanTriggers||[]).join("\n"))}
      ${cfgTextCard({ key:"levels.high.action", title:"高风险处理动作", summary:((levels.high&&levels.high.name)||"高风险")+" · SendPolicy=block", audience:"医助后台 / 与 Agent 对齐的说明", trigger:"ClinicalRisk=high 或急危", impact:"仅允许自动发固定安全话术，禁止自由医疗建议", status:"红线", statusCls:"danger", tip:"block = 安全模板可发，病情解读不可发。" }, levels.high && levels.high.action)}
      ${cfgTextCard({ key:"levels.medium.action", title:"中风险处理动作", summary:((levels.medium&&levels.medium.name)||"中风险")+" · card_only / review", audience:"医助后台 / 与 Agent 对齐的说明", trigger:"ClinicalRisk=medium", impact:"仅发卡可自动；夹带医疗建议必须人工确认", status:"策略", statusCls:"semi", tip:"勿再写「一律草稿人工确认」。" }, levels.medium && levels.medium.action)}
      ${cfgTextCard({ key:"levels.low.action", title:"低风险处理动作", summary:((levels.low&&levels.low.name)||"低风险")+" · SendPolicy=auto", audience:"医助后台 / 与 Agent 对齐的说明", trigger:"ClinicalRisk=low 的服务意图", impact:"自然语言引导与发卡可自动，仍过二次安全扫描", status:"策略", statusCls:"semi", tip:"服务类可自动；不可诊断、开药、解读报告。" }, levels.low && levels.low.action)}
    </div>`;
}
function configSafetyPublishedViewer(cfg){
  const levels = cfg.levels || {};
  return `<div class="cfg-explain danger">
      <b>当前发布的安全红线（已与 Agent 两轴对齐）。</b>
      <span>这是只读摘要；高风险仍由系统兜底，不能降低 ClinicalRisk。</span>
    </div>
    <div class="cfg-cards cfg-readonly-cards">
      ${cfgReadOnlyCard({ title:"高风险红旗词", summary:"命中后 ClinicalRisk=high：固定安全话术 + 转人工。", audience:"患者群和医助后台", trigger:"患者消息包含这些词", impact:"全局生效，系统不能把它降成低风险", status:"超管", statusCls:"danger" }, cfg.redFlags||[])}
      ${cfgReadOnlyCard({ title:"必须人工判断词", summary:"诊断、用药、手术、报告解读等 → review。", audience:"患者群和医助后台", trigger:"患者提出具体医疗判断", impact:"全局生效，命中后转人工待审", status:"超管", statusCls:"danger" }, cfg.humanTriggers||[])}
      ${cfgReadOnlyCard({ title:"高风险处理动作", summary:((levels.high&&levels.high.name)||"高风险")+" · block", audience:"医助后台 / Agent", trigger:"ClinicalRisk=high", impact:"安全模板可发，自由医疗建议不可发", status:"红线", statusCls:"danger" }, levels.high && levels.high.action)}
      ${cfgReadOnlyCard({ title:"中风险处理动作", summary:((levels.medium&&levels.medium.name)||"中风险")+" · card_only / review", audience:"医助后台 / Agent", trigger:"ClinicalRisk=medium", impact:"仅发卡可自动；医疗建议待审", status:"策略", statusCls:"semi" }, levels.medium && levels.medium.action)}
      ${cfgReadOnlyCard({ title:"低风险处理动作", summary:((levels.low&&levels.low.name)||"低风险")+" · auto", audience:"医助后台 / Agent", trigger:"ClinicalRisk=low", impact:"服务引导/发卡可自动", status:"策略", statusCls:"semi" }, levels.low && levels.low.action)}
    </div>`;
}
function configDoctorGroupViewer(cfg){
  const d = cfg.doctor || {};
  const groups = cfg.groups || [];
  return `<div class="cfg-explain">
      <b>这里说明“这套配置属于哪位医生、哪些群”。</b>
      <span>医生资料和群配置建议到「医生管理 / 社群工作台」编辑；这里保留批量维护入口用于迁移和复核。</span>
    </div>
    <div class="cfg-summary-grid">
      ${opsPolicy("医生", `${d.name||"-"} · ${d.dept||"-"} · ${d.hospital||"-"}`)}
      ${opsPolicy("群数量", `${groups.length} 个`)}
      ${opsPolicy("默认新群", cfg.defaultNewGroup ? `欢迎语${cfg.defaultNewGroup.welcomeEnabled?"启用":"停用"} · ${cfg.defaultNewGroup.reviewMode||"-"}` : "待配置")}
    </div>
    ${groups.length?`<table><tr><th>群名</th><th>外部群ID</th><th>欢迎语</th><th>自动处理</th><th>审核</th></tr>${groups.map(g=>`<tr><td>${esc(g.name)}</td><td>${esc(g.externalGroupId||"-")}</td><td>${g.welcomeEnabled?"启用":"停用"}</td><td>${g.autoReplyEnabled?"启用":"停用"}</td><td>${esc(g.reviewMode||"-")}</td></tr>`).join("")}</table>`:'<div class="empty">暂无群配置。</div>'}`;
}
function configCodesCardsViewer(cfg){
  const codes = cfg.codes || [];
  const cards = cfg.cards || [];
  return `<div class="cfg-explain">
      <b>这里说明“患者发哪个编号，对应什么承接”。</b>
      <span>运营只需要确认编号、标题、入口是否可用；卡片的底层参数由采集流程维护。</span>
    </div>
    <div class="cfg-summary-grid">
      ${opsPolicy("编号组", `${codes.length} 个`)}
      ${opsPolicy("卡片模板", `${cards.length} 个`)}
      ${opsPolicy("兜底规则", (cfg.fallback&&cfg.fallback.missingCard)||"未配置")}
    </div>
    ${codes.length?`<table><tr><th>编号</th><th>患者可能说法</th><th>是否启用</th><th>承接内容数</th></tr>${codes.map(c=>`<tr><td>${esc(c.code)}</td><td>${esc((c.aliases||[]).join(" / "))}</td><td>${c.enabled?"是":"否"}</td><td>${(c.responses||[]).length}</td></tr>`).join("")}</table>`:'<div class="empty">暂无编号配置。</div>'}`;
}
function collectConfigForm(domain, base){
  const cfg = JSON.parse(JSON.stringify(base || {}));
  document.querySelectorAll(".cfg-field[data-cfg-key]").forEach(el=>{
    const key = el.dataset.cfgKey;
    const val = configTextForSave(el.value);
    if(domain === "safety" && (key === "redFlags" || key === "humanTriggers")){
      cfg[key] = val.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    }else if(key.indexOf(".") > -1){
      const parts = key.split(".");
      let obj = cfg;
      for(let i=0;i<parts.length-1;i++){ if(!obj[parts[i]] || typeof obj[parts[i]]!=="object") obj[parts[i]] = {}; obj = obj[parts[i]]; }
      obj[parts[parts.length-1]] = val.trim();
    }else{
      cfg[key] = val.trim();
    }
  });
  return cfg;
}
function configValidationText(v){
  if(!v) return "";
  const err = (v.errors||[]).map(x=>`<div style="color:#fa5151">· ${esc(x)}</div>`).join("");
  const warn = (v.warnings||[]).map(x=>`<div style="color:#b8860b">· ${esc(x)}</div>`).join("");
  return `${v.ok?"校验通过":"校验未通过"}${err}${warn}`;
}
function configAuditHtml(rows){
  if(!rows.length) return '<div class="empty">暂无发布记录。</div>';
  return `<table><tr><th>时间</th><th>配置</th><th>动作</th><th>操作人</th><th>结果</th></tr>${rows.map(r=>`
    <tr><td>${esc(fmtCnTime(r.createdAt))}</td><td>${esc(r.title)}</td><td><span class="tag blue">${esc(configActionText(r.action))}</span></td>
    <td>${esc(r.actor||"-")}</td><td>${esc((r.result&&r.result.ok)===false?"未通过":"成功")}</td></tr>`).join("")}</table>`;
}
function configActionText(a){ return ({seed:"初始化",draft:"草稿",preview:"预览",publish:"发布",rollback:"回滚"}[a]||a); }

/* ---------- AI 分诊台 ---------- */
async function renderTriage(m){
  // v2.1 一页闭环：左消息队列 + 右处理面板
  let qp = "doctorId="+curDoc;
  if(window._triageFilter) qp += "&status="+window._triageFilter;
  if(window._triageLevel) qp += "&level="+window._triageLevel;
  const data = await api("GET","/api/admin/messages?"+qp);
  const msgs = data.messages || [];
  const pendingCount = data.pending || 0;
  let legacySessions = [];
  if(!msgs.length){
    try{ legacySessions = await api("GET","/api/admin/triage/sessions?doctorId="+curDoc) || []; }catch(e){ legacySessions = []; }
  }

  // 默认选第一条待处理
  if(!window._triageMsgId){
    const first = msgs.find(x=>x.reply_status==="pending");
    window._triageMsgId = first ? first.id : (msgs[0]?msgs[0].id:null);
  }

  const emptyHint = !msgs.length
    ? `<div class="empty">暂无消息。若企微群有人发消息但这里为空：请到「社群工作台」同步企微群后重试。${!legacySessions.length?"":"下方可查看升级前的历史分诊会话。"}</div>
      ${legacySessions.length?`<div style="margin-top:12px"><b class="sub">历史分诊会话（升级前）</b>
        <table><tr><th>#</th><th>患者</th><th>状态</th><th>风险</th><th>最近内容</th><th>时间</th></tr>
        ${legacySessions.slice(0,30).map(s=>`<tr><td>${s.id}</td><td>${esc(s.patientName||s.patient_name||s.patientKey||"-")}</td>
          <td><span class="tag">${esc(statusText(s.status))}</span></td>
          <td>${s.riskLevel||s.risk_level?`<span class="risk ${esc(s.riskLevel||s.risk_level)}">${riskText(s.riskLevel||s.risk_level)}</span>`:"-"}</td>
          <td>${esc(((s.lastPatientText||s.last_patient_text||"")+"").slice(0,40))}</td>
          <td>${esc(fmtCnTime(s.createdAt||s.created_at,"mdhm"))}</td></tr>`).join("")}
        </table></div>`:""}`
    : null;

  m.innerHTML = `
    <div class="triage-head">
      <div><h2>AI分诊台 <span>一页闭环 · 看消息→回复→发送</span></h2>
        <p>全量消息 + 筛选 · 回复框 + AI草稿 · 发送即闭环 · 转医生通知 · 患者历史</p></div>
    </div>
    <div class="triage-v21-toolbar">
      <button class="pill ${!window._triageFilter?' on':''}" onclick="triageFilter(null)">全部 (${data.total||0})</button>
      <button class="pill ${window._triageFilter==='pending'?' on':''}" onclick="triageFilter('pending')"><span class="dot dot-red"></span> 待处理 (${pendingCount})</button>
      <button class="pill ${window._triageFilter==='escalated'?' on':''}" onclick="triageFilter('escalated')"><span class="dot dot-orange"></span> 已转医生</button>
      <button class="pill ${window._triageFilter==='sent'?' on':''}" onclick="triageFilter('sent')"><span class="dot dot-green"></span> 已发送</button>
      <button class="pill ${window._triageFilter==='resolved'?' on':''}" onclick="triageFilter('resolved')"><span class="dot dot-green"></span> 已处理</button>
      <span style="width:1px;height:20px;background:#e8e8e8;margin:0 4px"></span>
      <button class="pill ${!window._triageLevel?' on':''}" onclick="triageLevelFilter(null)">全部级别</button>
      <button class="pill ${window._triageLevel==='1'?' on':''}" onclick="triageLevelFilter('1')"><span class="dot dot-red"></span> L1急症</button>
      <button class="pill ${window._triageLevel==='2'?' on':''}" onclick="triageLevelFilter('2')"><span class="dot dot-orange"></span> L2需医生</button>
      <button class="pill ${window._triageLevel==='3'?' on':''}" onclick="triageLevelFilter('3')"><span class="dot dot-yellow"></span> L3需医助</button>
      <button class="pill ${window._triageLevel==='4'?' on':''}" onclick="triageLevelFilter('4')"><span class="dot dot-green"></span> L4低风险</button>
      <button class="pill ${window._triageLevel==='5'?' on':''}" onclick="triageLevelFilter('5')">L5编号</button>
      <button class="pill ${window._triageLevel==='6'?' on':''}" onclick="triageLevelFilter('6')">L6闲聊</button>
    </div>
    <div class="triage-v21-shell">
      <div class="triage-v21-left" id="triageMsgList">
        ${emptyHint || renderMsgList(msgs)}
      </div>
      <div class="triage-v21-right" id="triageDetail">
        <div class="empty">← 选择一条消息查看详情</div>
      </div>
    </div>`;
  // 自动加载选中消息
  if(window._triageMsgId) loadMsgDetail(window._triageMsgId);
}

function renderMsgList(msgs){
  if(!msgs.length) return '<div class="empty">暂无消息</div>';
  return msgs.map(msg=>{
    const active = msg.id === window._triageMsgId ? ' triage-msg-active':'';
    const levelIcon = ({1:'<span class="dot dot-red"></span>',2:'<span class="dot dot-orange"></span>',3:'<span class="dot dot-yellow"></span>',4:'<span class="dot dot-green"></span>',5:'<span class="dot dot-gray"></span>',6:'<span class="dot dot-gray"></span>'})[msg.level]||'<span class="dot dot-gray"></span>';
    const levelTag = msg.level_label || ({1:'急症',2:'需医生',3:'需医助',4:'低风险',5:'编号',6:'闲聊'}[msg.level]||'');
    const statusTag = msg.reply_status==='pending' ? '<span class="tag warn">待处理</span>' :
      msg.reply_status==='sent' ? '<span class="tag green">已发送</span>' :
      msg.reply_status==='escalated' ? '<span class="tag blue">已转医生</span>' :
      msg.reply_status==='doctor_replied' ? '<span class="tag blue">医生已回</span>' :
      msg.reply_status==='resolved' ? '<span class="tag green">已处理</span>' :
      msg.reply_status==='send_failed' ? '<span class="tag red">发送失败</span>' :
      '<span class="tag">'+esc(msg.reply_status||'')+'</span>';
    const time = msg.created_at ? fmtCnTime(msg.created_at, "mdhm") : '';
    return `<div class="triage-msg-item${active}" onclick="loadMsgDetail(${msg.id})">
      <div class="triage-msg-top">
        <span class="triage-msg-level" title="${esc(levelTag)}">${levelIcon}</span>
        <span class="triage-msg-name triage-name-link" title="点击打开患者档案" onclick="event.stopPropagation();openPatientProfile('${esc(msg.patient_id||msg.sender_id||"")}')">${esc(msg.patient_name||msg.sender_id||'未知')}</span>
        <span class="tag ${msg.level<=3?'warn':msg.level===6?'':'green'}">${esc(levelTag)}</span>
        ${statusTag}
        <span class="triage-msg-time">${time}</span>
      </div>
      ${msg.group_id && (msg.group_name||msg.groupName) ? `<div class="triage-msg-group">${esc(msg.group_name||msg.groupName)}</div>` : ''}
      <div class="triage-msg-text">${esc((msg.text||'').slice(0,60))}</div>
    </div>`;
  }).join('');
}

window.triageFilter = function(status){
  window._triageFilter = status;
  window._triageMsgId = null;
  render();
};

window.triageLevelFilter = function(level){
  window._triageLevel = level;
  window._triageMsgId = null;
  render();
};

function triageProfileHtml(profile, msg){
  const p = profile.patient;
  const name = p ? (p.archiveLabel || p.real_name || p.display_name || msg.patient_name || "未知患者") : (msg.patient_name || msg.sender_id || "未知患者");
  const phone = p && p.phone ? esc(p.phone) : "";
  const stage = p && p.follow_stage ? `<span class="tag blue">${esc(p.follow_stage)}</span>` : "";
  const notes = p && p.notes ? `<div class="sub" style="margin-top:6px">医助备注：${esc(p.notes)}</div>` : "";
  const subs = (profile.submissions||[]).slice(0,3).map(s=>{
    let payload = {}; try{ payload = JSON.parse(s.payload||"{}"); }catch(e){}
    return `<div class="sub">· ${esc(s.type||"")} ${esc(payload["主要疾病 / 主诉"]||payload["主要疾病"]||payload["姓名"]||"")} · ${esc((s.at||"").slice(0,10))}</div>`;
  }).join("");
  const follows = (profile.followups||[]).slice(0,2).map(f=>`<div class="sub">· 随访 ${esc(f.plan_name||"")} · ${esc(f.status||"")}</div>`).join("");
  const idents = (profile.identities||[]).slice(0,2).map(i=>`<div class="sub">· ${esc(i.channel||"")} ${esc(i.external_id||"").slice(0,24)}</div>`).join("");
  const archived = p ? `<span class="tag green">已建档</span>` : `<span class="tag">未建档</span>`;
  return `<div class="triage-profile-card">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <strong>${esc(name)}</strong>${phone?` · ${phone}`:""} ${stage} ${archived}
      <button class="btn g s" type="button" onclick="openPatientProfile('${esc(msg.patient_id||msg.sender_id||"")}')">查看档案</button>
    </div>
    ${notes}
    <span class="sub">共 ${profile.stats.total||0} 条消息 · 待处理 ${profile.stats.pending||0} · 首次 ${(profile.stats.first_msg||"").slice(0,10)}</span>
    ${subs?`<div style="margin-top:8px"><b style="font-size:12px">建档/提交</b>${subs}</div>`:""}
    ${follows?`<div style="margin-top:6px"><b style="font-size:12px">随访</b>${follows}</div>`:""}
    ${idents?`<div style="margin-top:6px"><b style="font-size:12px">渠道身份</b>${idents}</div>`:""}
  </div>`;
}

/* 分诊台点名：直接进「患者档案」详情页（对话记录），不再弹重复空档案层 */
window.openPatientProfile = async function(patientKey){
  if(!patientKey){ alert("暂无患者标识，无法查看档案"); return; }
  let pid = +patientKey;
  if(!(Number.isInteger(pid) && pid > 0)){
    try{
      const profile = await api("GET","/api/admin/messages/patient/"+encodeURIComponent(patientKey)+"/profile?doctorId="+curDoc);
      pid = profile.patient ? +profile.patient.id : 0;
    }catch(e){ alert("打开档案失败："+(e.message||e)); return; }
  }
  if(!(Number.isInteger(pid) && pid > 0)){ alert("该消息尚未关联患者档案"); return; }
  archivePatientId = pid;
  curTab = "archive";
  buildNav();
  render();
};

window.loadMsgDetail = async function(msgId){
  window._triageMsgId = msgId;
  // 高亮列表项
  document.querySelectorAll('.triage-msg-item').forEach(el=>el.classList.remove('triage-msg-active'));
  const clicked = event && event.currentTarget;
  if(clicked) clicked.classList.add('triage-msg-active');

  const panel = document.getElementById('triageDetail');
  panel.innerHTML = '<div class="empty">加载中...</div>';

  // 获取消息数据（从列表里找）
  const data = await api("GET","/api/admin/messages?doctorId="+curDoc);
  const msg = (data.messages||[]).find(x=>x.id===msgId);
  if(!msg){ panel.innerHTML = '<div class="empty">消息不存在</div>'; return; }

  // 获取患者历史 + 同患者待处理
  let history = { messages:[] };
  let pendingMsgs = { messages:[], count:0 };
  let profile = { patient:null, stats:{}, submissions:[], followups:[], identities:[] };
  const patientKey = msg.patient_id || msg.sender_id || "";
  if(patientKey){
    try { history = await api("GET","/api/admin/messages/patient/"+encodeURIComponent(patientKey)+"?doctorId="+curDoc); } catch(e){}
    try { pendingMsgs = await api("GET","/api/admin/messages/patient/"+encodeURIComponent(patientKey)+"/pending?doctorId="+curDoc); } catch(e){}
    try { profile = await api("GET","/api/admin/messages/patient/"+encodeURIComponent(patientKey)+"/profile?doctorId="+curDoc); } catch(e){}
  }

  const levelLabel = msg.level_label || ({'1':'急症','2':'需医生','3':'需医助','4':'低风险','5':'编号指令','6':'闲聊'}[msg.level]||'');
  const levelColor = ({'1':'red','2':'orange','3':'yellow','4':'green','5':'gray','6':'gray'}[msg.level]||'gray');

  // 同患者多条待处理提示
  const multiPending = pendingMsgs.count > 1 ? `<div class="triage-multi-hint">⚠️ 该患者还有 ${pendingMsgs.count-1} 条待处理消息 <button class="btn g btn-sm" onclick="showPatientPending('${esc(msg.patient_id)}')">合并查看</button></div>` : '';

  const profileCard = triageProfileHtml(profile, msg);

  panel.innerHTML = `
    ${profileCard}
    ${multiPending}
    <div class="triage-detail-card">
      <div class="triage-detail-meta">
        <span class="tag ${levelColor==='red'?'red':levelColor==='orange'?'warn':levelColor==='yellow'?'warn':'green'}">${levelLabel}</span>
        <span class="sub">${msg.created_at?fmtCnTime(msg.created_at):''}</span>
        <span class="sub">${msg.channel||''} ${msg.group_id?(msg.group_name||msg.groupName?('·'+esc(msg.group_name||msg.groupName)):'·群聊'):'·私聊'}</span>
      </div>
      <div class="triage-detail-text">"${esc(msg.text||'')}"</div>
    </div>
    <div class="triage-reply-section">
      <label>回复内容 ${msg.ai_draft?'<span class="sub">(AI草稿已填入，可编辑)</span>':''}</label>
      <textarea id="triageReplyText" class="triage-reply-input" placeholder="输入回复内容...">${esc(msg.ai_draft||'')}</textarea>
      <div class="triage-reply-actions">
        <button class="btn p" onclick="triageSend(${msg.id})">发送到${msg.group_id?(msg.group_name||msg.groupName?('「'+esc(msg.group_name||msg.groupName)+'」'):'群'):'患者'}</button>
        <button class="btn g" onclick="triageEscalate(${msg.id})">转医生</button>
        <button class="btn g" onclick="triageResolve(${msg.id})">标记已处理</button>
        <button class="btn g s hidden" data-material-detail="${msg.triage_session_id||''}">材料整理详情</button>
      </div>
    </div>
    <div class="triage-history-section">
      <h3>历史消息 <span class="sub">${(history.messages||[]).length} 条</span></h3>
      <div class="triage-history-list">
        ${(history.messages||[]).slice(0,20).map(h=>`<div class="triage-history-item">
          <span class="sub">${fmtCnTime(h.created_at,"mdhm")}</span>
          <span class="triage-msg-text">${esc((h.text||'').slice(0,80))}</span>
          <span class="tag ${h.reply_status==='sent'?'green':h.reply_status==='pending'?'warn':''}">${h.reply_status||''}</span>
        </div>`).join('')}
        ${!(history.messages||[]).length ? '<div class="empty">无历史消息</div>' : ''}
      </div>
    </div>`;
};

window.triageSend = async function(msgId){
  const text = (document.getElementById('triageReplyText')||{}).value;
  if(!text||!text.trim()){ alert('回复内容不能为空'); return; }
  const btn = event.currentTarget; btn.disabled=true; btn.textContent='发送中...';
  try {
    const res = await api("POST","/api/admin/messages/"+msgId+"/send",{text:text.trim()});
    if(res.sent){
      btn.textContent='✅ 已发送'; btn.className='btn g';
      // 刷新列表
      setTimeout(()=>render(), 800);
    } else {
      btn.textContent='⚠️ 发送失败(已入队列)'; btn.className='btn d';
      setTimeout(()=>{ btn.disabled=false; btn.textContent='重试发送'; btn.className='btn p'; }, 2000);
    }
  } catch(e){ btn.disabled=false; btn.textContent='发送失败'; btn.className='btn d'; alert(e.message||'发送失败'); }
};

window.triageEscalate = async function(msgId){
  const note = prompt('转医生备注（可选）：','');
  try {
    await api("POST","/api/admin/messages/"+msgId+"/escalate",{note:note||''});
    alert('已转医生，等待医生回复');
    render();
  } catch(e){ alert(e.message||'转医生失败'); }
};

window.triageResolve = async function(msgId){
  try {
    await api("POST","/api/admin/messages/batch-resolve",{ids:[msgId], status:'resolved'});
    render();
  } catch(e){ alert(e.message||'操作失败'); }
};

window.showPatientPending = async function(patientId){
  try {
    const data = await api("GET","/api/admin/messages/patient/"+encodeURIComponent(patientId)+"/pending?doctorId="+curDoc);
    const msgs = data.messages||[];
    const ids = msgs.map(x=>x.id);
    const texts = msgs.map(x=>'• '+esc((x.text||'').slice(0,60))).join('\n');
    const panel = document.getElementById('triageDetail');
    panel.querySelector('.triage-multi-hint').innerHTML = `
      <div class="card" style="background:#fffbe6;border:1px solid #ffe58f;padding:12px">
        <strong>该患者 ${msgs.length} 条待处理消息：</strong><br>
        <pre style="white-space:pre-wrap;font-size:12.5px;margin:8px 0">${texts}</pre>
        <button class="btn p" onclick="triageBatchResolve([${ids.join(',')}])">全部标记已处理</button>
      </div>`;
  } catch(e){ alert('加载失败'); }
};

window.triageBatchResolve = async function(ids){
  try {
    await api("POST","/api/admin/messages/batch-resolve",{ids, status:'resolved'});
    render();
  } catch(e){ alert(e.message||'操作失败'); }
};

function sendText(s){ return ({received:"已接收",auto_sent:"已自动发送给患者",service_sent:"已发送给患者（承接安全话）",system_notice:"已回复系统受理提示 · 待人工回复",draft_review:"待审核 · 确认后才发给患者",handoff_notice:"已提示转人工",sent:"人工已发送",note:"已记录"}[s]||s||""); }

function noteModal(sessionId){
  modal("加入档案备注", `<div class="fld"><label>备注内容</label><textarea id="note_text" style="font-family:inherit;min-height:100px" placeholder="例如：患者出现红旗症状，已建议线下就医并等待人工跟进。"></textarea></div>`, async ()=>{
    await api("POST","/api/admin/triage/sessions/"+sessionId+"/note",{ text:$("#note_text").value.trim() });
    render(); return true;
  });
}
/* ---------- 随访队列 ---------- */
async function renderFollowup(m){
  const list = await api("GET","/api/admin/followups?doctorId="+curDoc);
  if(!followupId || !list.some(f=>f.id==followupId)) followupId = list[0] ? list[0].id : null;
  const detail = followupId ? await api("GET","/api/admin/followups/"+followupId) : null;
  m.innerHTML = `
    <div class="card"><h2>随访队列 <span class="sub">术式/病种 SOP · 到期提醒 · 节点闭环</span>
      <button class="btn p s" id="enrollBtn" style="margin-left:auto"${actionAttrs("followup.manage")}>+ 入组建档患者</button></h2>
      ${list.length ? `<div class="fq-wrap">
        <div class="fq-list">${list.map(fqRow).join("")}</div>
        <div class="fq-detail">${detail ? fqDetail(detail) : '<div class="empty">选择左侧随访查看时间轴</div>'}</div>
      </div>` : '<div class="empty">暂无随访入组。患者在「医患联络表」选择随访方案即自动入组，或点右上「入组建档患者」。</div>'}
    </div>`;
  m.querySelectorAll("[data-fq]").forEach(b=>b.onclick=()=>{ followupId=+b.dataset.fq; render(); });
  m.querySelectorAll("[data-node]").forEach(b=>bindActionButton(b, "followup.manage", async()=>{ const [id,idx,st]=b.dataset.node.split(":"); await api("POST","/api/admin/followups/"+id+"/node",{idx:+idx,status:st}); render(); }, { loadingText:"处理中…" }));
  const eb=m.querySelector("#enrollBtn"); if(eb) bindActionButton(eb, "followup.manage", ()=>enrollModal());
}
function fqRow(f){
  const due = f.next && f.next.state==="due";
  const nextTxt = f.next ? `${f.next.title}（${f.next.dueDate}）` : "全部完成";
  return `<button class="fq-item ${f.id==followupId?"on":""}" data-fq="${f.id}">
    <div class="fq-top"><b>${esc(f.patientName)}</b><span class="fq-tail">尾号${esc(f.phoneTail||"")}</span></div>
    <div class="fq-plan">${esc(f.planName)}</div>
    <div class="fq-next ${due?"due":""}">${due?"⏰ 待跟进：":"下一节点："}${esc(nextTxt)} · ${f.done}/${f.total}</div></button>`;
}
function fqDetail(d){
  const stText={done:"已完成",pushed:"已推送",due:"待跟进",upcoming:"待开始"};
  return `<div class="fq-dh"><div><b>${esc(d.patientName)}</b> · ${esc(d.planName)}</div>
    <div class="fq-dsub">起算 ${esc(d.enrolledAt)} · 进度 ${d.done}/${d.total} · ${d.status==="completed"?"已完结":"进行中"}</div></div>
    <div class="fq-nodes">${(d.nodes||[]).map(n=>`
      <div class="fq-node ${esc(n.state)}">
        <div class="fq-n-t">${esc(n.title)} <span class="fq-n-date">${esc(n.dueDate)}</span> <span class="tag ${esc(n.state)}">${stText[n.state]||""}</span></div>
        ${n.edu?`<div class="fq-n-edu">${esc(n.edu)}</div>`:""}
        ${n.reminder?`<div class="fq-n-rem">复诊提醒：${esc(n.reminder)}</div>`:""}
        <div class="fq-n-acts">
          ${(n.status!=="pushed"&&n.status!=="done")?`<button class="btn g s" data-node="${d.id}:${n.idx}:pushed"${actionAttrs("followup.manage")}>标记已推送</button>`:""}
          ${n.status!=="done"?`<button class="btn p s" data-node="${d.id}:${n.idx}:done"${actionAttrs("followup.manage")}>标记已完成</button>`:`<button class="btn g s" data-node="${d.id}:${n.idx}:pending"${actionAttrs("followup.manage")}>撤销</button>`}
        </div></div>`).join("")}</div>`;
}
function enrollModal(){
  Promise.all([api("GET","/api/admin/followup-plans?doctorId="+curDoc), api("GET","/api/admin/submissions?doctorId="+curDoc+"&type="+encodeURIComponent("联络表"))]).then(([plans,subs])=>{
    const pats=(subs||[]).map(s=>({name:(s.payload||{})["姓名"]||"",phone:(s.payload||{})["手机号"]||""})).filter(p=>p.phone);
    if(!plans.length){ alert("该医生暂无随访方案（方案库为空）"); return; }
    if(!pats.length){ alert("暂无建档患者可入组"); return; }
    modal("入组建档患者", `
      <div class="fld"><label>建档患者</label><select id="en_pat">${pats.map((p,i)=>`<option value="${i}">${esc(p.name)}（${esc(p.phone)}）</option>`).join("")}</select></div>
      <div class="fld"><label>随访方案</label><select id="en_plan">${plans.map(p=>`<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("")}</select></div>
      <div class="fld"><label>随访起算日期（手术/治疗日，选填）</label><input id="en_date" type="date"></div>
    `, async ()=>{
      const p=pats[+$("#en_pat").value]; if(!p){ alert("请选择患者"); return false; }
      await api("POST","/api/admin/followups",{ doctorId:curDoc, name:p.name, phone:p.phone, planKey:$("#en_plan").value, enrolledAt:$("#en_date").value||undefined });
      render(); return true;
    });
  }).catch(e=>alert(e.message));
}

/* ---------- 智能候补名单 ---------- */
async function renderWaitlist(m){
  const list = await api("GET","/api/admin/waitlist?doctorId="+curDoc);
  const bySlot={}; list.forEach(w=>{ (bySlot[w.slot]=bySlot[w.slot]||[]).push(w); });
  const slots=Object.keys(bySlot);
  m.innerHTML = `<div class="card"><h2>智能候补名单 <span class="sub">加号停诊/满号 → 患者候补 → 名额释放一键自动通知</span></h2>
    ${slots.length ? slots.map(s=>{
      const es=bySlot[s], waiting=es.filter(w=>w.status==="waiting").length;
      return `<div class="wl-slot"><div class="wl-head"><div><b>${esc(s)}</b> <span class="wl-cnt">候补 ${waiting} 人 / 共 ${es.length}</span></div>
        ${waiting ? `<button class="btn p s" data-release="${esc(s)}"${actionAttrs("waitlist.manage")}>释放名额并通知（${waiting}人）</button>` : '<span class="tag green">已全部通知</span>'}</div>
        <table><tr><th>#</th><th>患者</th><th>尾号</th><th>加入时间</th><th>状态</th></tr>
        ${es.map(w=>`<tr><td>${w.id}</td><td>${esc(w.name)}</td><td>${esc(w.tail)}</td><td>${esc(fmtCnTime(w.at,"mdhm"))}</td>
          <td>${w.status==="notified"?'<span class="tag green">已通知</span>':'<span class="tag warn">候补中</span>'}</td></tr>`).join("")}</table></div>`;
    }).join("") : '<div class="empty">暂无候补。患者在「门诊加号」选到停诊/满号时段时可加入候补名单。</div>'}
  </div>`;
  m.querySelectorAll("[data-release]").forEach(b=>bindActionButton(b, "waitlist.manage", async()=>{
    const r=await api("POST","/api/admin/waitlist/release",{doctorId:curDoc,slot:b.dataset.release});
    alert("已通知 "+(r.notified||0)+" 位候补患者（演示态，生产接短信/企业微信推送）"); render();
  }, { confirm:"确认释放该时段候补名额并通知患者？", loadingText:"通知中…" }));
}

/* ---------- 提交记录 ---------- */
let subType = "";
async function renderSubs(m){
  const types = ["","联络表","加号","住院预约","口碑","story"];
  const rows = await api("GET",`/api/admin/submissions?doctorId=${curDoc}${subType?"&type="+encodeURIComponent(subType):""}`);
  m.innerHTML = `
    <div class="card"><h2>提交记录 <span class="sub">点状态可在「待跟进/已联系/已完成」间切换</span></h2>
      <div class="toolbar">${types.map(t=>`<span class="pill ${subType===t?"on":""}" data-t="${t}">${t||"全部"}</span>`).join("")}</div>
      ${rows.length?`<table><tr><th>#</th><th>类型</th><th>内容</th><th>时间</th><th>状态</th></tr>
        ${rows.map(r=>`<tr data-row="${r.id}"><td>${r.id}</td><td><span class="tag">${esc(r.type)}</span></td>
          <td>${kv(r.payload)}</td><td>${esc(fmtCnTime(r.at))}</td>
          <td><button class="btn s ${statCls(r.status)}" data-id="${r.id}" data-st="${esc(r.status)}"${actionAttrs("submissions.manage")}>${esc(r.status)}</button></td></tr>`).join("")}</table>`
        :'<div class="empty">暂无该类型提交。</div>'}
    </div>`;
  m.querySelectorAll(".pill").forEach(p=>p.onclick=()=>{ subType=p.dataset.t; render(); });
  m.querySelectorAll("[data-st]").forEach(b=>bindActionButton(b, "submissions.manage", async()=>{
    const order=["待跟进","已联系","已完成"]; const next=order[(order.indexOf(b.dataset.st)+1)%order.length];
    await api("PUT","/api/admin/submissions/"+b.dataset.id,{status:next}); await loadReminders(); render();
  }, { loadingText:"更新中…" }));
  if(highlightSubId!=null){   // 从仪表盘提醒列表点进来：高亮并滚动到对应提交
    const row = m.querySelector('[data-row="'+highlightSubId+'"]');
    if(row){ row.classList.add("row-flash"); row.scrollIntoView({block:"center",behavior:"smooth"}); }
    highlightSubId = null;
  }
}
function statCls(s){ return s==="已完成"?"p":s==="已联系"?"g":"d"; }
function fmtVal(v){
  const s = String(v == null ? "" : v);
  // 裸 ISO / SQLite UTC 时间戳 → 北京时间；其它字段原样
  if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return fmtCnTime(s) || s;
  return s;
}
function kv(o){ return Object.entries(o||{}).map(([k,v])=>`<span style="color:#999">${esc(k)}</span> ${esc(fmtVal(v))}`).join("　"); }

/* ---------- 患者档案（企微建档 + 联络表） ---------- */
function archiveTime(v){
  return fmtCnTime(v);
}

async function renderArchive(m){
  if(archivePatientId){
    await renderArchiveDetail(m, archivePatientId);
    return;
  }
  let rows = [];
  try{ rows = await api("GET",`/api/admin/patients?doctorId=${curDoc}`); }
  catch(e){
    // 兼容旧后端：回落联络表
    const legacy = await api("GET",`/api/admin/submissions?doctorId=${curDoc}&type=联络表`);
    rows = (legacy||[]).map(r=>{
      const p=r.payload||{};
      return { id:r.id, realName:p["姓名"]||"", displayName:"", phone:p["手机号"]||"", disease:p["主要疾病 / 主诉"]||p["主要疾病"]||"", city:p["所在城市"]||"", channels:"联络表", msgCount:0, createdAt:r.at, hasContactForm:true };
    });
  }
  m.innerHTML = `<div class="card"><h2>患者档案 <span class="sub">按最近对话时间排序 · 点击进入对话记录 · 支持家庭医生维度</span></h2>
    ${rows.length?`<table class="archive-table"><tr><th>#</th><th>昵称/姓名</th><th>手机</th><th>渠道</th><th>家庭医生</th><th>最近对话</th><th>消息</th><th>时间</th><th>并档</th></tr>
      ${rows.map(r=>{
        const name = r.displayName || r.realName || "未命名";
        const nick = r.realName && r.displayName && r.realName!==r.displayName && !String(r.displayName).includes(r.realName)
          ? r.realName : "";
        const preview = (r.lastMsgText || "").trim();
        const fam = r.familyDoctorEnrolled
          ? `<span class="tag green">已纳入</span>${r.familyRole?`<div class="sub">${esc(({self:"本人",spouse:"配偶",child:"子女",parent:"父母",other:"其他"}[r.familyRole]||r.familyRole))}</div>`:""}${r.familyHouseholdId?`<div class="sub">户 ${esc(r.familyHouseholdId)}</div>`:""}`
          : '<span class="sub">—</span>';
        const mergeOp = r.duplicatePhonePending
          ? (r.duplicatePhoneSuggestedKeepId === r.id
            ? `<button class="btn p s" data-merge-phone="1" data-keep-id="${r.duplicatePhoneSuggestedKeepId}" data-merge-ids="${esc((r.duplicatePhoneGroupIds||[]).join(","))}"${actionAttrs("patients.merge")}>合并同号(${r.duplicatePhoneGroupSize||0})</button>`
            : `<span class="tag warn">待并入 #${r.duplicatePhoneSuggestedKeepId}</span>`)
          : '<span class="sub">—</span>';
        return `<tr class="archive-row" data-pid="${r.id}" title="查看往期对话">
          <td>${r.id}</td>
          <td><b>${esc(name)}</b>${nick?`<div class="sub">昵称 ${esc(nick)}</div>`:""}${r.externalIdTail?`<div class="sub">ID…${esc(r.externalIdTail)}</div>`:""}${r.hasContactForm?'<div class="sub">已填联络表</div>':""}${r.autoMergedPhoneCount?`<div class="sub"><span class="tag green">已自动并档 ${r.autoMergedPhoneCount}</span></div>`:""}${r.duplicatePhonePending?`<div class="sub"><span class="tag warn">同手机号待确认</span></div>`:""}</td>
          <td>${esc(r.phone||"-")}${r.phoneVerified?' <span class="tag green">已验</span>':""}</td>
          <td>${esc(r.channels||"-")}</td>
          <td>${fam}</td>
          <td class="archive-preview">${preview ? esc(preview.slice(0,48))+(preview.length>48?"…":"") : '<span class="sub">暂无对话</span>'}${r.disease?`<div class="sub">${esc(r.disease)}</div>`:""}</td>
          <td>${r.msgCount||0}</td>
          <td>${esc(archiveTime(r.lastMsgAt||r.updatedAt||r.createdAt)||"-")}</td>
          <td>${mergeOp}</td>
        </tr>`;
      }).join("")}</table>`
      :'<div class="empty">暂无患者档案。企微群里有人发消息或患者端提交联络表后，会在此汇总。</div>'}</div>`;
  m.querySelectorAll("[data-merge-phone]").forEach(btn=>bindActionButton(btn, "patients.merge", async()=>{
    const keepId = +(btn.dataset.keepId || 0);
    const mergeIds = String(btn.dataset.mergeIds || "").split(",").map(x=>+x).filter(x=>Number.isInteger(x) && x > 0 && x !== keepId);
    if(!keepId || !mergeIds.length){ alert("没有可合并的重复档案"); return; }
    if(!confirm(`确认合并同手机号档案？\n保留 #${keepId}\n并入 #${mergeIds.join(", #")}`)) return;
    await api("POST", "/api/admin/patients/merge", { doctorId:curDoc, keepId, mergeIds });
    render();
  }, { loadingText:"合并中…" }));
  m.querySelectorAll("[data-pid]").forEach(row=>{
    row.style.cursor = "pointer";
    row.onclick = (ev)=>{
      if(ev && ev.target && ev.target.closest && ev.target.closest("[data-merge-phone]")) return;
      archivePatientId = +row.dataset.pid;
      render();
    };
  });
}

function archiveIsOutbound(msg){
  const d = String(msg.direction || "").toLowerCase();
  return d === "outbound" || d === "out" || d === "assistant";
}

function archiveBubbleHtml(side, who, at, text, tagsHtml){
  return `<div class="archive-bubble ${side}">
    <div class="archive-bubble-meta"><span>${esc(who)}</span><span>${esc(archiveTime(at))}</span></div>
    <div class="archive-bubble-text">${esc(text || "（空消息）")}</div>
    ${tagsHtml || ""}
  </div>`;
}

async function renderArchiveDetail(m, patientId){
  m.innerHTML = `<div class="card"><div class="empty">加载对话中…</div></div>`;
  let data;
  try{
    data = await api("GET", `/api/admin/patients/${patientId}/messages?doctorId=${curDoc}&limit=500`);
  }catch(e){
    m.innerHTML = `<div class="card">
      <div class="archive-detail-head"><button class="btn g" id="archiveBack">← 返回档案</button></div>
      <div class="empty">加载失败：${esc(e.message||e)}</div>
    </div>`;
    $("#archiveBack").onclick = ()=>{ archivePatientId = null; render(); };
    return;
  }
  const p = data.patient || {};
  const msgs = data.messages || [];
  const household = data.householdMembers || [];
  const title = p.realName || p.displayName || ("患者 #"+patientId);
  const roleLabel = ({self:"本人",spouse:"配偶",child:"子女",parent:"父母",other:"其他"})[p.familyRole] || "";
  const bubbles = [];
  msgs.forEach(msg=>{
    const isOut = archiveIsOutbound(msg);
    const tags = (msg.levelLabel||msg.level)
      ? `<div class="archive-bubble-tags"><span class="tag">${esc(msg.levelLabel||msg.level)}</span>${msg.replyStatus?` <span class="tag">${esc(msg.replyStatus)}</span>`:""}</div>`
      : "";
    bubbles.push(archiveBubbleHtml(
      isOut ? "out" : "in",
      isOut ? "医助/系统" : (msg.patientName || title),
      msg.createdAt,
      msg.text,
      tags
    ));
    const draft = String(msg.aiDraft || "").trim();
    if(!isOut && draft && draft !== String(msg.text||"").trim()){
      bubbles.push(archiveBubbleHtml("out", "医助/系统", msg.createdAt, draft,
        msg.replyStatus ? `<div class="archive-bubble-tags"><span class="tag">${esc(msg.replyStatus)}</span></div>` : ""));
    }
  });
  const hhHtml = household.length
    ? `<div class="ops-muted" style="margin-top:6px">同户成员：${household.map(h=>esc((h.realName||h.displayName||("#"+h.id))+(h.familyRole?("·"+(({self:"本人",spouse:"配偶",child:"子女",parent:"父母",other:"其他"})[h.familyRole]||h.familyRole)):""))).join("、")}</div>`
    : "";
  m.innerHTML = `<div class="card archive-detail">
    <div class="archive-detail-head">
      <button class="btn g" id="archiveBack">← 返回档案</button>
      <div class="archive-detail-title">
        <h2>${esc(title)} <span class="sub">往期对话 · 共 ${msgs.length} 条</span></h2>
        <div class="archive-detail-meta">
          ${p.displayName && p.realName && p.displayName!==p.realName ? `<span>昵称 ${esc(p.displayName)}</span>` : ""}
          ${p.phone ? `<span>${esc(p.phone)}</span>` : ""}
          ${p.followStage ? `<span>${esc(p.followStage)}</span>` : ""}
          ${p.familyDoctorEnrolled ? `<span class="tag green">家庭医生${roleLabel?("·"+roleLabel):""}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="card" style="margin:12px 0;padding:12px;border:1px solid #edf0f2;border-radius:10px">
      <h3 style="margin:0 0 8px;font-size:14px">家庭医生维度</h3>
      <div class="toolbar" style="gap:8px;flex-wrap:wrap;align-items:center">
        <label>角色 <select id="famRole">
          <option value="">未设置</option>
          ${[["self","本人"],["spouse","配偶"],["child","子女"],["parent","父母"],["other","其他"]].map(([v,l])=>`<option value="${v}" ${p.familyRole===v?"selected":""}>${l}</option>`).join("")}
        </select></label>
        <label>同户ID <input id="famHh" value="${esc(p.familyHouseholdId||"")}" placeholder="同户标识" style="width:140px"></label>
        <label><input type="checkbox" id="famEnroll" ${p.familyDoctorEnrolled?"checked":""}> 纳入家庭医生</label>
        <button class="btn p s" id="famSave"${actionAttrs("patients.family.update")}>保存</button>
      </div>
      ${hhHtml}
    </div>
    ${bubbles.length ? `<div class="archive-chat" id="archiveChat">${bubbles.join("")}</div>`
      : '<div class="empty">该患者暂无对话记录。</div>'}
  </div>`;
  $("#archiveBack").onclick = ()=>{ archivePatientId = null; render(); };
  const chat = $("#archiveChat");
  if(chat) chat.scrollTop = chat.scrollHeight;
  const saveBtn = $("#famSave");
  if(saveBtn) bindActionButton(saveBtn, "patients.family.update", async()=>{
    await api("PUT", `/api/admin/patients/${patientId}/family`, {
      doctorId:curDoc,
      familyRole:$("#famRole").value,
      familyHouseholdId:$("#famHh").value.trim(),
      familyDoctorEnrolled:$("#famEnroll").checked
    });
    render();
  }, { loadingText:"保存中…" });
}

/* ---------- 审计日志 ---------- */
const AUDIT_ACTIONS = ["","account.create","account.update","account.disable","account.enable","account.reset_password","credential.update","config.publish","config.rollback","outbox.send","triage.confirm_send"];
const AUDIT_RESOURCES = ["","admin","credential_config","ops_config","outbox","triage_decision"];
const AUDIT_OUTCOMES = ["","requested","success","failed"];
async function renderAudit(m){
  const full = can("audit.read_full");
  const scoped = can("audit.read_scoped");
  if(!full && !scoped){ m.innerHTML=`<div class="empty">${esc(disabledReason("audit.read_scoped"))}</div>`; return; }
  const doctorOptions = full ? `<option value="">全部医生</option>${DOCTORS.map(d=>`<option value="${d.id}" ${d.id==curDoc?"selected":""}>${esc(d.name)}</option>`).join("")}` : `<option value="${curDoc}" selected>${esc(curName())}</option>`;
  m.innerHTML = `<div class="card"><h2>审计日志 <span class="sub">${full?"完整后台流水":"当前医生只读摘要"}</span></h2>
    <div class="toolbar" style="align-items:flex-end">
      <div class="fld" style="min-width:150px"><label>医生</label><select id="auditDoctor" ${full?"":"disabled"}>${doctorOptions}</select></div>
      <div class="fld" style="min-width:170px"><label>动作</label><select id="auditAction">${AUDIT_ACTIONS.map(x=>`<option value="${esc(x)}">${esc(x||"全部")}</option>`).join("")}</select></div>
      <div class="fld" style="min-width:150px"><label>资源</label><select id="auditResource">${AUDIT_RESOURCES.map(x=>`<option value="${esc(x)}">${esc(x||"全部")}</option>`).join("")}</select></div>
      <div class="fld" style="min-width:130px"><label>结果</label><select id="auditOutcome">${AUDIT_OUTCOMES.map(x=>`<option value="${esc(x)}">${esc(x||"全部")}</option>`).join("")}</select></div>
      <div class="fld" style="min-width:140px"><label>操作者</label><input id="auditActor" placeholder="前缀匹配"></div>
      <button class="btn p" id="auditSearch">查询</button>
    </div>
    <div id="auditRows" class="empty">正在加载审计日志…</div>
  </div>`;
  const load = async ()=>{
    const params = new URLSearchParams();
    const did = $("#auditDoctor").value;
    if(did || !full) params.set("doctorId", did || String(curDoc));
    const a=$("#auditAction").value, rt=$("#auditResource").value, oc=$("#auditOutcome").value, actor=$("#auditActor").value.trim();
    if(a) params.set("action", a);
    if(rt) params.set("resourceType", rt);
    if(oc) params.set("outcome", oc);
    if(actor) params.set("actor", actor);
    params.set("limit", "120");
    let data;
    try{ data = await api("GET","/api/admin/audit?"+params.toString()); }
    catch(e){ $("#auditRows").innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; return; }
    $("#auditRows").innerHTML = auditTable(data.rows || [], data.scope);
    m.querySelectorAll("[data-audit-detail]").forEach(b=>b.onclick=()=>auditDetailModal(b.dataset.auditDetail));
  };
  $("#auditSearch").onclick = load;
  await load();
}
function auditTable(rows, scope){
  if(!rows.length) return '<div class="empty">暂无符合条件的审计记录。</div>';
  return `<table><tr><th>时间</th><th>操作者</th><th>动作</th><th>资源</th><th>医生</th><th>结果</th><th></th></tr>${rows.map(r=>`
    <tr><td>${esc(auditTime(r.createdAt))}</td><td>${esc(r.actorUsername||"-")}<div class="ops-muted">${esc(roleText(r.actorRole)||r.actorRole||"")}</div></td>
      <td><span class="tag blue">${esc(r.action)}</span><div class="ops-muted">${esc(r.reason||"")}</div></td>
      <td>${esc(r.resourceType||"-")}<div class="ops-muted">#${esc(r.resourceId||"-")}</div></td>
      <td>${r.doctorId||"-"}</td><td><span class="tag ${r.outcome==="failed"?"warn":"green"}">${esc(r.outcome||"success")}</span></td>
      <td><button class="btn g s" data-audit-detail="${r.id}">详情</button></td></tr>`).join("")}</table>
      <div class="hint">当前范围：${scope==="full"?"完整审计":"当前医生摘要"}。敏感凭证字段由后端脱敏，非 super 不展示凭证审计详情。</div>`;
}
async function auditDetailModal(id){
  try{
    const r = await api("GET","/api/admin/audit/"+id);
    const a = r.audit || {};
    infoModal("审计详情 #"+id, `<div class="mini-kv">
      <div><span>动作</span> ${esc(a.action||"-")}</div>
      <div><span>操作者</span> ${esc(a.actorUsername||"-")} · ${esc(roleText(a.actorRole)||a.actorRole||"")}</div>
      <div><span>资源</span> ${esc(a.resourceType||"-")} #${esc(a.resourceId||"-")}</div>
      <div><span>医生</span> ${esc(a.doctorId||"-")}</div>
      <div><span>结果</span> ${esc(a.outcome||"success")} ${a.reason?`· ${esc(a.reason)}`:""}</div>
      <div><span>时间</span> ${esc(auditTime(a.createdAt))}</div>
    </div>
    <div class="fld"><label>meta</label><pre style="white-space:pre-wrap;background:#f7f8fa;border-radius:8px;padding:10px;max-height:180px;overflow:auto">${esc(auditJsonText(a.meta))}</pre></div>
    <div class="fld"><label>before</label><pre style="white-space:pre-wrap;background:#f7f8fa;border-radius:8px;padding:10px;max-height:180px;overflow:auto">${esc(auditJsonText(a.before))}</pre></div>
    <div class="fld"><label>after</label><pre style="white-space:pre-wrap;background:#f7f8fa;border-radius:8px;padding:10px;max-height:180px;overflow:auto">${esc(auditJsonText(a.after))}</pre></div>`);
  }catch(e){ alert(e.message); }
}
function auditTime(t){ return t ? (fmtCnTime(t) || "-") : "-"; }
function auditJsonText(v){
  const secret = /password|passwd|salt|hash|token|secret|key|guid|authorization|cookie/i;
  const clean = (x,k,depth)=>{
    if(secret.test(String(k||""))) return "[redacted]";
    if(x == null || typeof x === "string" || typeof x === "number" || typeof x === "boolean") return x;
    if(depth > 5) return "[max-depth]";
    if(Array.isArray(x)) return x.map(v=>clean(v,k,depth+1));
    const out = {};
    Object.keys(x || {}).forEach(key=>{ out[key] = clean(x[key], key, depth+1); });
    return out;
  };
  return JSON.stringify(clean(v || {}, "", 0), null, 2);
}

/* ---------- 关键词规则 CRUD ---------- */
async function renderRules(m){
  const rows = await api("GET","/api/admin/rules?doctorId="+curDoc);
  m.innerHTML = `<div class="card"><h2>关键词规则 <span class="sub">服务端引擎据此自动回复</span></h2>
    <div class="toolbar"><button class="btn p" id="addRule"${actionAttrs("rules.manage")}>+ 新增规则</button></div>
    ${rows.length?`<table><tr><th>代号</th><th>别名</th><th>机器人</th><th>匹配</th><th>回复条数</th><th>外部跳转</th><th>启用</th><th></th></tr>
      ${rows.map(r=>`<tr><td><b>${esc(r.code)}</b></td><td>${esc((r.aliases||[]).join("、"))}</td><td>${esc(r.bot)}</td>
        <td><span class="tag">${r.match==="includes"?"包含":"精确"}</span></td><td>${(r.responses||[]).length}</td>
        <td>${ruleExternalCount(r)?`<span class="tag blue">${ruleExternalCount(r)} 个</span>`:'-'}</td>
        <td>${r.enabled?'<span class="tag green">启用</span>':'<span class="tag warn">停用</span>'}</td>
        <td><button class="btn g s" data-edit='${esc(JSON.stringify(r))}'${actionAttrs("rules.manage")}>编辑</button> <button class="btn d s" data-del="${r.id}"${actionAttrs("rules.manage")}>删</button></td></tr>`).join("")}</table>`
      :'<div class="empty">该医生暂无规则。</div>'}</div>`;
  bindActionButton($("#addRule"), "rules.manage", ()=>ruleModal(null));
  m.querySelectorAll("[data-edit]").forEach(b=>bindActionButton(b, "rules.manage", ()=>ruleModal(JSON.parse(b.dataset.edit))));
  m.querySelectorAll("[data-del]").forEach(b=>bindActionButton(b, "rules.manage", async()=>{ await api("DELETE","/api/admin/rules/"+b.dataset.del); render(); }, { confirm:"删除该规则？", loadingText:"删除中…" }));
}
function ruleExternalCount(r){ return (r.responses||[]).filter(x=>x&&x.external).length; }
function ruleModal(r){
  const edit = !!r;
  modal(`${edit?"编辑":"新增"}关键词规则`, `
    <div class="fld"><label>代号（患者发送的关键词）</label><input id="r_code" value="${esc(r?r.code:"")}" placeholder="如 101 / 饮食"></div>
    <div class="fld"><label>别名（逗号分隔，可选）</label><input id="r_alias" value="${esc(r?(r.aliases||[]).join(","):"")}" placeholder="咨询,向主任咨询"></div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>机器人</label><input id="r_bot" value="${esc(r?r.bot:"小宝医助")}"></div>
      <div style="flex:1"><label>匹配方式</label><select id="r_match"><option value="exact"${r&&r.match==="exact"?" selected":""}>精确</option><option value="includes"${r&&r.match==="includes"?" selected":""}>包含</option></select></div>
      <div style="flex:1"><label>启用</label><select id="r_en"><option value="1"${!r||r.enabled?" selected":""}>启用</option><option value="0"${r&&!r.enabled?" selected":""}>停用</option></select></div>
    </div>
    <div class="fld"><label>回复内容 responses（JSON 数组）</label>
      <textarea id="r_resp">${esc(JSON.stringify(r?r.responses:[{type:"text",text:"请输入回复…"}],null,2))}</textarea>
      <div class="hint">支持类型：text / mp(小程序卡) / link(链接卡) / qr(二维码) / popup(弹窗) / image(海报)。可给 mp/link 加 external 字段配置春雨 H5/API/小程序跳转；文本里 {patient} 会替换为患者昵称。</div></div>
  `, async ()=>{
    let responses; try{ responses = JSON.parse($("#r_resp").value); }catch(e){ alert("responses 不是合法 JSON"); return false; }
    const payload = { doctorId:curDoc, code:$("#r_code").value.trim(), aliases:$("#r_alias").value.split(",").map(s=>s.trim()).filter(Boolean),
      bot:$("#r_bot").value.trim(), match:$("#r_match").value, enabled:+$("#r_en").value, responses };
    if(!payload.code){ alert("代号必填"); return false; }
    if(edit) await api("PUT","/api/admin/rules/"+r.id,payload); else await api("POST","/api/admin/rules",payload);
    render(); return true;
  });
}

/* ---------- FAQ CRUD ---------- */
async function renderFaq(m){
  const rows = await api("GET","/api/admin/faq?doctorId="+curDoc);
  m.innerHTML = `<div class="card"><h2>群友常见问题 FAQ</h2>
    <div class="toolbar"><button class="btn p" id="addFaq"${actionAttrs("rules.manage")}>+ 新增问题</button></div>
    ${rows.length?`<table><tr><th>分组</th><th>问题</th><th>答案</th><th>排序</th><th></th></tr>
      ${rows.map(r=>`<tr><td><span class="tag">${esc(r.grp)}</span></td><td>${esc(r.q)}</td><td style="color:#666">${esc(r.a)}</td><td>${r.sort}</td>
        <td><button class="btn g s" data-edit='${esc(JSON.stringify(r))}'${actionAttrs("rules.manage")}>编辑</button> <button class="btn d s" data-del="${r.id}"${actionAttrs("rules.manage")}>删</button></td></tr>`).join("")}</table>`
      :'<div class="empty">暂无 FAQ。</div>'}</div>`;
  bindActionButton($("#addFaq"), "rules.manage", ()=>faqModal(null));
  m.querySelectorAll("[data-edit]").forEach(b=>bindActionButton(b, "rules.manage", ()=>faqModal(JSON.parse(b.dataset.edit))));
  m.querySelectorAll("[data-del]").forEach(b=>bindActionButton(b, "rules.manage", async()=>{ await api("DELETE","/api/admin/faq/"+b.dataset.del); render(); }, { confirm:"删除？", loadingText:"删除中…" }));
}
function faqModal(r){
  const edit=!!r;
  modal(`${edit?"编辑":"新增"} FAQ`, `
    <div class="fld"><label>分组</label><input id="f_grp" value="${esc(r?r.grp:"看病就医")}"></div>
    <div class="fld"><label>问题</label><input id="f_q" value="${esc(r?r.q:"")}"></div>
    <div class="fld"><label>答案</label><textarea id="f_a" style="font-family:inherit;min-height:80px">${esc(r?r.a:"")}</textarea></div>
    <div class="fld"><label>排序</label><input id="f_sort" type="number" value="${r?r.sort:0}"></div>
  `, async ()=>{
    const payload={ doctorId:curDoc, grp:$("#f_grp").value.trim(), q:$("#f_q").value.trim(), a:$("#f_a").value.trim(), sort:+$("#f_sort").value };
    if(!payload.q){ alert("问题必填"); return false; }
    if(edit) await api("PUT","/api/admin/faq/"+r.id,payload); else await api("POST","/api/admin/faq",payload);
    render(); return true;
  });
}

/* ---------- 医生管理 ---------- */
async function renderDoctors(m){
  m.innerHTML = `<div class="card"><h2>医生管理 <span class="sub">多医生模板 · 患者端按邀请/最近使用归属</span></h2>
    <div class="toolbar"><button class="btn p" id="addDoc"${actionAttrs("doctor.create")}>+ 新增医生</button>
      <input id="docSearch" type="search" placeholder="搜索：姓名 / 医院 / 科室 / 职称 / 群名" autocomplete="off" style="margin-left:auto;min-width:220px;padding:6px 10px;border:1px solid #d6dbdf;border-radius:8px;font:inherit">
      <span id="docSearchEmpty" style="display:none;color:#999;font-size:12px;margin-left:8px">无匹配医生</span></div>
    <table><tr><th>#</th><th>姓名</th><th>医院 / 科室</th><th>群名</th><th></th></tr>
      ${DOCTORS.map(d=>`<tr data-docrow data-search="${esc(((d.name||"")+" "+(d.title||"")+" "+(d.hospital||"")+" "+(d.dept||"")+" "+(d.group_name||"")).toLowerCase())}"><td>${d.id}</td><td><b>${esc(d.name)}</b> <span style="color:#999">${esc(d.title||"")}</span></td>
        <td>${esc(d.hospital||"")} · ${esc(d.dept||"")}</td><td>${esc(d.group_name||"")}</td>
        <td><button class="btn g s" data-clone='${esc(JSON.stringify({id:d.id,name:d.name}))}'${actionAttrs("doctor.clone")}>克隆</button> <button class="btn d s" data-del="${d.id}" data-del-name="${esc(d.name||"")}"${actionAttrs("doctor.delete")}>删除</button></td></tr>`).join("")}</table>
    <p style="color:#999;font-size:12px;margin-top:10px">提示：新增医生自带 101/114/303 基础规则与联络表模板；<b>「克隆」</b>可复制底座；<b>「删除」</b>会清除该医生关联数据且不可恢复（至少保留一位医生）。</p></div>`;
  bindActionButton($("#addDoc"), "doctor.create", ()=>docModal());
  m.querySelectorAll("[data-clone]").forEach(b=>bindActionButton(b, "doctor.clone", ()=>cloneModal(JSON.parse(b.dataset.clone))));
  m.querySelectorAll("[data-del]").forEach(b=>bindActionButton(b, "doctor.delete", async()=>{
    const id = +b.getAttribute("data-del");
    const name = b.getAttribute("data-del-name") || ("#"+id);
    if(DOCTORS.length <= 1){ alert("至少保留一位医生，无法删除"); return; }
    if(!confirm("确认删除医生「"+name+"」？将清除其规则/社群/患者等关联数据，且不可恢复。")) return;
    await api("DELETE","/api/admin/doctors/"+id);
    await loadDoctors();
    await loadCapabilities();
    render();
  }, { loadingText:"删除中…" }));
  const docSearch = $("#docSearch");
  if(docSearch){
    docSearch.oninput = ()=>{
      const q = docSearch.value.trim().toLowerCase();
      let shown = 0;
      m.querySelectorAll("tr[data-docrow]").forEach(tr=>{
        const hit = !q || (tr.getAttribute("data-search")||"").includes(q);
        tr.style.display = hit ? "" : "none";
        if(hit) shown++;
      });
      const empty = $("#docSearchEmpty"); if(empty) empty.style.display = (q && shown===0) ? "" : "none";
    };
  }
}
function docModal(){
  modal("新增医生", `
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>英文 slug（唯一）</label><input id="d_slug" placeholder="如 wang"></div>
      <div style="flex:1"><label>姓名</label><input id="d_name" placeholder="如 王强"></div>
    </div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>职称</label><input id="d_title" value="主任医师"></div>
      <div style="flex:1"><label>科室</label><input id="d_dept" placeholder="如 心内科"></div>
    </div>
    <div class="fld"><label>医院</label><input id="d_hosp" placeholder="如 XX医院"></div>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:2"><label>擅长 / 专长</label><input id="d_spec" placeholder="高血压 · 冠心病"></div>
      <div style="flex:1"><label>医院电话</label><input id="d_phone" placeholder="021-xxxx"></div>
    </div>
  `, async ()=>{
    const b={ slug:$("#d_slug").value.trim(), name:$("#d_name").value.trim(), title:$("#d_title").value.trim(),
      dept:$("#d_dept").value.trim(), hospital:$("#d_hosp").value.trim(), specialty:$("#d_spec").value.trim(), hospital_phone:$("#d_phone").value.trim() };
    if(!b.slug||!b.name){ alert("slug 与姓名必填"); return false; }
    try{ await api("POST","/api/admin/doctors",b); await loadDoctors(); render(); return true; }
    catch(e){ alert(e.message); return false; }
  });
}

function cloneModal(src){
  modal(`克隆医生 · 复制「${esc(src.name)}」整套底座`, `
    <p style="color:#666;font-size:12.5px;margin-bottom:12px">将复制 <b>${esc(src.name)}</b> 的全部关键词规则、FAQ、随访方案库与 content 话术到新医生（新医生默认未上线、患者数 0）。</p>
    <div class="fld row3" style="display:flex;gap:10px">
      <div style="flex:1"><label>新医生 英文 slug（唯一）</label><input id="cl_slug" placeholder="如 wang2"></div>
      <div style="flex:1"><label>新医生姓名</label><input id="cl_name" placeholder="如 王医生"></div>
    </div>
  `, async ()=>{
    const slug=$("#cl_slug").value.trim(), name=$("#cl_name").value.trim();
    if(!slug||!name){ alert("slug 与姓名必填"); return false; }
    try{ await api("POST",`/api/admin/doctors/${src.id}/clone`,{slug,name}); await loadDoctors(); render(); return true; }
    catch(e){ alert(e.message); return false; }
  });
}

async function renderAccounts(m){
  if(!can("admin.manage")){ m.innerHTML=`<div class="empty">${esc(disabledReason("admin.manage"))}</div>`; return; }
  let rows = [];
  try{ rows = await api("GET","/api/admin/admins"); }
  catch(e){ m.innerHTML = `<div class="card"><h2>账户与权限</h2><div class="empty">加载失败：${esc(e.message)}</div></div>`; return; }
  const active = rows.filter(a=>a.active).length;
  const supers = rows.filter(a=>a.role==="super" && a.active).length;
  const scoped = rows.filter(a=>a.role!=="super").length;
  m.innerHTML = `<div class="card"><h2>账户与权限 <span class="sub">管理员账号、医生范围和登录状态</span><button class="btn p s" id="addAccount" style="margin-left:auto">+ 新增账号</button></h2>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><div class="n">${rows.length}</div><div class="l">账号总数</div></div>
      <div class="stat"><div class="n">${active}</div><div class="l">启用中</div></div>
      <div class="stat"><div class="n">${supers}</div><div class="l">超级管理员</div></div>
      <div class="stat"><div class="n">${scoped}</div><div class="l">医生范围账号</div></div>
    </div>
    <div class="community-grid" style="margin-bottom:14px">
      <section class="community-section">${roleCardsHtml(rows)}</section>
      <section class="community-section">${roleMatrixHtml()}</section>
    </div>
    ${rows.length?`<table><tr><th>工号</th><th>账号</th><th>角色</th><th>医生范围</th><th>状态</th><th>最近登录</th><th>密码修改</th><th>备注</th><th></th></tr>
      ${rows.map(accountRow).join("")}</table>`:'<div class="empty">暂无管理员账号。</div>'}</div>`;
  $("#addAccount").onclick = ()=>accountModal(null);
  m.querySelectorAll("[data-account-edit]").forEach(b=>bindActionButton(b, "admin.manage", ()=>accountModal(rows.find(a=>a.id==b.dataset.accountEdit))));
  m.querySelectorAll("[data-account-reset]").forEach(b=>bindActionButton(b, "admin.manage", ()=>resetPasswordModal(rows.find(a=>a.id==b.dataset.accountReset))));
}
function accountRow(a){
  const status = a.active ? '<span class="tag green">启用</span>' : '<span class="tag warn">停用</span>';
  const staffId = a.staffId || a.staff_id || "-";
  return `<tr>
    <td><code>${esc(staffId)}</code></td>
    <td><b>${esc(a.displayName || a.username)}</b><br><span style="color:#999">${esc(a.username)}</span></td>
    <td>${roleBadge(a.role)}<div class="ops-muted">${esc(roleSummary(a.role))}</div></td>
    <td>${esc(accountScopeText(a))}</td>
    <td>${status}</td>
    <td>${esc(accountTime(a.lastLoginAt))}</td>
    <td>${esc(accountTime(a.passwordChangedAt))}</td>
    <td>${esc(a.note || "-")}</td>
    <td><button class="btn g s" data-account-edit="${a.id}"${actionAttrs("admin.manage")}>编辑</button> <button class="btn d s" data-account-reset="${a.id}"${actionAttrs("admin.manage")}>重置密码</button></td>
  </tr>`;
}
function roleText(role){
  return ({ super:"超级管理员", ops_manager:"运营主管", assistant:"医助", viewer:"只读/质检", scoped:"医助账号（旧）" }[role] || "未知角色");
}
function roleSummary(role){
  return ({
    super:"全局系统管理",
    ops_manager:"配置、运营内容和审核",
    assistant:"分诊、社群、随访和提交处理",
    viewer:"只读质检，不改不发",
    scoped:"旧医助别名，按医助口径"
  }[role] || "未知权限");
}
function roleBadge(role){
  const cls = role==="super" ? "blue" : role==="viewer" ? "" : role==="ops_manager" ? "green" : "warn";
  return `<span class="tag ${cls}">${esc(roleText(role))}</span>`;
}
function roleCardsHtml(rows){
  const roles = ["super","ops_manager","assistant","viewer","scoped"];
  return `<h2>角色说明 <span class="sub">固定岗位，不做自定义角色</span></h2>
    <div class="rem-list">${roles.map(r=>{
      const count = rows.filter(a=>(a.role||"super")===r).length;
      return `<div class="rem-item" style="cursor:default"><span>${roleBadge(r)}</span><span class="rem-sum">${esc(roleSummary(r))}</span><span class="rem-time">${count} 个账号</span></div>`;
    }).join("")}</div>`;
}
function roleMatrixHtml(){
  const rows = [
    ["账号/凭证/完整审计","super"],
    ["运营配置发布、知识源、运营候选","super / ops_manager"],
    ["分诊确认、社群 outbox、随访/提交","super / ops_manager / assistant"],
    ["审计摘要、业务只读质检","super / ops_manager / viewer"]
  ];
  return `<h2>权限矩阵 <span class="sub">按钮仍以后端 capabilities 为准</span></h2>
    <table><tr><th>能力范围</th><th>允许角色</th></tr>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join("")}</table>`;
}
function accountTime(t){ return t ? (fmtCnTime(t) || "-") : "-"; }
function accountScopeText(a){
  if(a.role==="super") return "全部医生";
  const names = (a.doctorIds||[]).map(id=>DOCTORS.find(d=>d.id==id)).filter(Boolean).map(d=>d.name);
  return names.length ? names.join(" / ") : "未分配";
}
function doctorChecks(ids){
  const selected = new Set((ids||[]).map(x=>+x));
  return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
    ${DOCTORS.map(d=>`<label style="display:flex;align-items:center;gap:6px;border:1px solid #edf0f2;border-radius:8px;padding:8px 9px"><input type="checkbox" data-admin-doctor value="${d.id}" ${selected.has(d.id)?"checked":""}>${esc(d.name)}</label>`).join("")}
  </div>`;
}
function selectedDoctorIds(){
  return [...document.querySelectorAll("[data-admin-doctor]:checked")].map(x=>+x.value);
}
function accountModal(a){
  const edit = !!a;
  const roleOptions = [
    ["assistant","医助"],
    ["ops_manager","运营主管"],
    ["viewer","只读/质检"],
    ["super","超级管理员"],
    ["scoped","医助账号（旧 scoped）"]
  ];
  const currentRole = a ? (a.role || "super") : "assistant";
  modal(edit ? "编辑账号" : "新增账号", `
    ${edit?`<div class="fld"><label>账号名</label><input value="${esc(a.username)}" disabled></div>`:`<div class="fld"><label>账号名</label><input id="acc_username" placeholder="必填，例如 assistant01"></div>`}
    <div class="fld"><label>工号</label><input value="${esc(edit ? (a.staffId || a.staff_id || "") : "")}" disabled placeholder="保存后按角色自动生成"></div>
    ${edit?"":'<div class="fld"><label>初始密码</label><input id="acc_password" type="password" placeholder="至少 6 位"></div>'}
    <div class="fld"><label>展示名</label><input id="acc_display" value="${esc((a&&a.displayName)||"")}" placeholder="用于顶部和审计展示"></div>
    <div class="fld"><label>角色</label><select id="acc_role">${roleOptions.map(([v,l])=>`<option value="${v}" ${currentRole===v?"selected":""}>${l}</option>`).join("")}</select>
      <div class="hint" id="acc_role_hint">${esc(roleSummary(currentRole))}</div></div>
    <div class="fld"><label>医生范围</label>${doctorChecks((a&&a.doctorIds)||[])}<div class="hint" id="acc_scope_preview"></div></div>
    <div class="fld"><label>状态</label><select id="acc_active"><option value="1" ${!a||a.active?"selected":""}>启用</option><option value="0" ${a&&!a.active?"selected":""}>停用</option></select></div>
    <div class="fld"><label>备注</label><textarea id="acc_note" style="font-family:inherit;min-height:80px">${esc((a&&a.note)||"")}</textarea></div>`, async ()=>{
      const role = $("#acc_role").value;
      if(role!=="super" && selectedDoctorIds().length===0){ alert("非超级管理员至少绑定一位医生"); return false; }
      const payload = { role, displayName:$("#acc_display").value.trim(), active:$("#acc_active").value==="1", doctorIds:role==="super"?[]:selectedDoctorIds(), note:$("#acc_note").value.trim() };
      try{
        if(edit) await api("PUT","/api/admin/admins/"+a.id,payload);
        else{
          payload.username = $("#acc_username").value.trim();
          payload.password = $("#acc_password").value;
          if(!payload.username){ alert("请填写登录账户号"); return false; }
          await api("POST","/api/admin/admins",payload);
        }
        render(); return true;
      }catch(e){ alert(e.message); return false; }
    });
  const updatePreview = ()=>{
    const role = $("#acc_role").value;
    $("#acc_role_hint").textContent = roleSummary(role);
    const ids = selectedDoctorIds();
    const names = ids.map(id=>DOCTORS.find(d=>d.id===id)).filter(Boolean).map(d=>d.name);
    $("#acc_scope_preview").textContent = role==="super" ? "医生范围：全部医生" : ("已授权医生：" + (names.length ? names.join(" / ") : "未选择（保存前必须选择）"));
  };
  $("#acc_role").onchange = updatePreview;
  document.querySelectorAll("[data-admin-doctor]").forEach(x=>x.onchange=updatePreview);
  updatePreview();
}
function resetPasswordModal(a){
  if(!a) return;
  modal("重置密码", `<div class="fld"><label>账号</label><input value="${esc(a.username)}" disabled></div>
    <div class="fld"><label>新密码</label><input id="reset_password" type="password" placeholder="留空则自动生成临时密码"></div>`, async ()=>{
      try{
        const r = await api("POST","/api/admin/admins/"+a.id+"/reset-password",{ password:$("#reset_password").value });
        if(r.temporaryPassword) alert("临时密码："+r.temporaryPassword);
        else alert("密码已重置");
        render(); return true;
      }catch(e){ alert(e.message); return false; }
    });
}
function selfPasswordModal(){
  modal("修改我的密码", `<div class="fld"><label>旧密码</label><input id="self_old_password" type="password"></div>
    <div class="fld"><label>新密码</label><input id="self_new_password" type="password" placeholder="至少 6 位"></div>`, async ()=>{
      try{
        await api("POST","/api/admin/me/password",{ oldPassword:$("#self_old_password").value, newPassword:$("#self_new_password").value });
        alert("密码已修改，请重新登录");
        location.reload();
        return false;
      }catch(e){ alert(e.message); return false; }
    });
}

/* ---------- 企微配置（仅超级管理员·纯前端接线，后端端点/表/脱敏均现成） ---------- */
async function renderQiwe(m, flash){
  if(!can("credential.manage")){ m.innerHTML=`<div class="empty">${esc(disabledReason("credential.manage"))}</div>`; return; }
  let c;
  try{ const r = await api("GET","/api/admin/qiwe/config"); c = r.config || {}; }
  catch(e){ m.innerHTML = `<div class="card"><h2>企微配置</h2><div class="empty">加载失败：${esc(e.message)}</div></div>`; return; }
  const ph = v => esc(v ? v : "未配置");   // 脱敏字段 placeholder：显示后端掩码，无则「未配置」；绝不作为 value
  m.innerHTML = `
    <div class="card">
      <h2>企微配置 <span class="sub">第三方企微执行控制台凭证 · 仅超级管理员可见</span></h2>
      <div class="toolbar">
        ${c.configured?'<span class="tag green">已配置</span>':'<span class="tag warn">未配置</span>'}
        <span class="tag ${c.dryRun?'warn':'blue'}">${c.dryRun?'DRY_RUN 演练（不实发）':'实发模式'}</span>
        <span class="tag ${c.autoSend?'warn':''}">自动发送 autoSend：${c.autoSend?'开':'关'}</span>
        <span class="tag ${c.allowGroup?'warn':''}">允许群发 allowGroup：${c.allowGroup?'开':'关'}</span>
      </div>
      <div class="community-note" style="margin-bottom:14px">脱敏字段（凭证 token / 设备 guid / 回调密钥 callbackSecret）只显示掩码占位，<b>留空 = 沿用当前、不会清空</b>；只有实际重新输入才会更新。系统绝不会把掩码原样回存为真实凭证。</div>

      <div class="fld"><label>凭证 token（脱敏）</label>
        <input id="qw_token" type="password" autocomplete="new-password" placeholder="${ph(c.token)}" value="">
        <div class="hint">当前：${esc(c.token||"未配置")}。留空保持不变。</div></div>
      <div class="fld"><label>设备 guid（脱敏）</label>
        <input id="qw_guid" type="password" autocomplete="new-password" placeholder="${ph(c.guid)}" value="">
        <div class="hint">当前：${esc(c.guid||"未配置")}。留空保持不变。</div></div>
      <div class="fld"><label>回调密钥 callbackSecret（脱敏）</label>
        <input id="qw_secret" type="password" autocomplete="new-password" placeholder="${ph(c.callbackSecret)}" value="">
        <div class="hint">当前：${esc(c.callbackSecret||"未配置")}。留空保持不变。</div></div>

      <div class="fld row3" style="display:flex;gap:10px">
        <div style="flex:1"><label>路由医生 doctorId</label><input id="qw_doctorId" value="${esc(c.doctorId!=null?c.doctorId:"")}" placeholder="留空=沿用当前"></div>
        <div style="flex:1"><label>本账号 selfUserId</label><input id="qw_selfUserId" value="${esc(c.selfUserId||"")}" placeholder="企微本账号 userId"></div>
        <div style="flex:1"><label>测试对象 testToId</label><input id="qw_testToId" value="${esc(c.testToId||"")}" placeholder="测试发送的接收方"><div class="hint">⚠️ 填入群 roomId = 放开该真实群自动处理，默认仅本人；放开真实群请谨慎</div></div>
      </div>
      <div class="fld"><label>接口地址 apiUrl</label><input id="qw_apiUrl" value="${esc(c.apiUrl||"")}" placeholder="默认 http://manager.qiweapi.com/qiwe/api/qw/doApi"></div>
      <div class="fld"><label>备注 note</label><input id="qw_note" value="${esc(c.note||"")}" placeholder="可选"></div>

      <div class="fld" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="qw_enabled" ${c.enabled?"checked":""}> 启用 enabled（读回调 + 入队的半自动开关，不触发自动真发）</label>
      </div>
      <div class="hint">autoSend / allowGroup 为敏感开关（关系是否自动真发 / 群发），本面板<b>只读展示</b>（上方徽章）；如需变更请走后端配置（env / API），避免从 UI 误开自动发。V1 为半自动：人工审核后手动发、autoSend 默认关。</div>

      <div class="toolbar" style="margin-top:6px">
        <button class="btn p" id="qwSave"${actionAttrs("credential.manage")}>保存配置</button>
        <button class="btn g" id="qwTest"${actionAttrs("qiwe.preview_send")}>测试连接（发到本人 testToId/selfUserId）</button>
        <span id="qw_msg" style="font-size:12.5px;color:#07a050;align-self:center"></span>
      </div>
      <div class="hint" style="margin-top:2px">测试连接以「101」触发一次患者回复并按 send=true 发送到 testToId/selfUserId（不发真实患者群）。</div>
    </div>`;
  if(flash) setQwMsg(flash);
  bindActionButton($("#qwSave"), "credential.manage", async()=>{
    const payload = {
      doctorId:$("#qw_doctorId").value.trim(),
      selfUserId:$("#qw_selfUserId").value.trim(),
      testToId:$("#qw_testToId").value.trim(),
      apiUrl:$("#qw_apiUrl").value.trim(),
      note:$("#qw_note").value.trim(),
      enabled:$("#qw_enabled").checked
      // autoSend / allowGroup 敏感开关不从 UI 提交：后端 bool(input.x, prev.x) 回落 prev 保持不变，避免从后台一键误开自动真发/群发（红线③ V1 半自动）
    };
    // 掩码回传陷阱：token/guid/callbackSecret 只有用户实际重新输入才带上；留空则从 payload 省略 → 后端 v()||prev 保持不变，绝不把掩码写回真实凭证
    const token=$("#qw_token").value.trim(), guid=$("#qw_guid").value.trim(), secret=$("#qw_secret").value.trim();
    if(token) payload.token = token;
    if(guid) payload.guid = guid;
    if(secret) payload.callbackSecret = secret;
    try{ await api("POST","/api/admin/qiwe/config",payload); renderQiwe(m,"已保存 ✓ 脱敏字段留空即沿用旧值"); }
    catch(e){ setQwMsg("保存失败："+e.message, true); }
  }, { loadingText:"保存中…" });
  bindActionButton($("#qwTest"), "qiwe.preview_send", async()=>{
    setQwMsg("测试发送中…");
    try{
      const r = await api("POST","/api/admin/qiwe/preview-reply",{ text:"101", send:true });
      if(r.sent) setQwMsg("测试发送成功 ✓（回复片段："+(r.replyText||"").replace(/\s+/g," ").slice(0,32)+"…）");
      else setQwMsg("已生成回复但未实发（sent=false）："+((r.sendResult&&(r.sendResult.error||r.sendResult.msg))||"请检查 token/guid/testToId 配置"), true);
    }catch(e){ setQwMsg("测试失败："+e.message, true); }
  }, { confirm:"确认向配置的 testToId/selfUserId 发送一条 QiWe 测试消息？", loadingText:"测试中…" });
}
function setQwMsg(text, err){ const el=$("#qw_msg"); if(el){ el.textContent=text; el.style.color = err?"#fa5151":"#07a050"; } }   // textContent 天然转义，无需 esc

/* ---------- 通用弹层 ---------- */
function infoModal(title, inner){
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal"><div class="m"><h3>${esc(title)}</h3>${inner}
    <div class="m-actions"><button class="btn p" id="mClose">关闭</button></div></div></div>`;
  $("#mClose").onclick = ()=>root.innerHTML="";
  root.querySelector(".modal").onclick = e=>{ if(e.target===root.querySelector(".modal")) root.innerHTML=""; };
}
function modal(title, inner, onOk){
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal"><div class="m"><h3>${esc(title)}</h3>${inner}
    <div class="m-actions"><button class="btn g" id="mCancel">取消</button><button class="btn p" id="mOk">保存</button></div></div></div>`;
  $("#mCancel").onclick = ()=>root.innerHTML="";
  root.querySelector(".modal").onclick = e=>{ if(e.target===root.querySelector(".modal")) root.innerHTML=""; };
  $("#mOk").onclick = async ()=>{ const close = await onOk(); if(close!==false) root.innerHTML=""; };
}

tryBoot();

