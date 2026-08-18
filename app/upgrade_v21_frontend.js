// 医患通 v2.1 前端升级脚本 - 一页闭环 UI
// 在本地或服务器执行: node upgrade_v21_frontend.js
// 功能: 在 admin.html 中插入「消息中心」tab + 一页闭环面板

const fs = require("fs");
const adminHtmlPath = __dirname + "/public/admin.html";
const adminJsPath = __dirname + "/public/src/admin.js";

// ====== 1. admin.html: 插入消息中心的独立 script ======
let html = fs.readFileSync(adminHtmlPath, "utf8");

if(html.includes("msgCenterSection")){
  console.log("[frontend 1/2] ⏭️ 消息中心 UI 已存在");
} else {
  const msgCenterScript = `
<script>
// ====== 消息中心 - 一页闭环 UI [v2.1] ======
// 注入到现有导航体系中,作为独立 section

(function(){
  // 等待主 app 加载完成
  const waitApp = setInterval(function(){
    const nav = document.getElementById("nav");
    if(!nav) return;
    clearInterval(waitApp);
    injectMsgCenter(nav);
  }, 300);

  function injectMsgCenter(nav){
    // 在导航第一位插入「消息中心」按钮
    const sections = nav.querySelectorAll(".nav-section");
    if(!sections.length) return;
    const firstSection = sections[0];
    const btn = document.createElement("button");
    btn.id = "navMsgCenter";
    btn.textContent = "💬 消息中心";
    btn.style.cssText = "display:block;width:100%;text-align:left;border:none;background:none;padding:11px 14px;border-radius:8px;cursor:pointer;font-size:14px;color:#555;margin-bottom:3px;font-weight:600";
    btn.onclick = function(){ showMsgCenter(); };
    firstSection.insertBefore(btn, firstSection.children[1] || null);
    
    // 定时刷新待处理数角标
    refreshMsgBadge();
    setInterval(refreshMsgBadge, 15000);
  }

  var msgCenterVisible = false;
  var msgCenterData = { messages:[], pending:0, currentPatient:null };

  async function refreshMsgBadge(){
    try {
      const r = await api("GET", "/api/admin/messages?limit=1&status=pending");
      const btn = document.getElementById("navMsgCenter");
      if(!btn) return;
      const pending = r && r.pending || 0;
      btn.textContent = pending > 0 ? ("💬 消息中心 (" + pending + ")") : "💬 消息中心";
      if(pending > 0) btn.style.color = "#07c160";
      else btn.style.color = "#555";
    } catch(e){}
  }

  window.showMsgCenter = async function(filter){
    msgCenterVisible = true;
    // 隐藏其他 section
    const main = document.querySelector(".main");
    if(!main) return;

    // 获取消息列表
    const params = new URLSearchParams();
    params.set("limit", "50");
    if(filter && filter.level) params.set("level", filter.level);
    if(filter && filter.status) params.set("status", filter.status);
    if(filter && filter.patientId) params.set("patientId", filter.patientId);

    let data;
    try { data = await api("GET", "/api/admin/messages?" + params.toString()); }
    catch(e){ data = { messages:[], pending:0, total:0 }; }
    msgCenterData.messages = data.messages || [];
    msgCenterData.pending = data.pending || 0;

    renderMsgCenter(main, filter);
  };

  function renderMsgCenter(main, filter){
    const msgs = msgCenterData.messages;
    const levelColors = { 1:"#e03131", 2:"#e8590c", 3:"#f59f00", 4:"#37b24d", 5:"#868e96", 6:"#ced4da" };
    const levelLabels = { 1:"急症", 2:"需医生", 3:"需医助", 4:"低风险", 5:"编号", 6:"闲聊" };

    // 按患者聚合
    const byPatient = {};
    msgs.forEach(function(m){
      const key = m.patient_id || m.sender_id || "unknown";
      if(!byPatient[key]) byPatient[key] = { name: m.patient_name || key, messages:[], topLevel:9 };
      byPatient[key].messages.push(m);
      if(m.level < byPatient[key].topLevel) byPatient[key].topLevel = m.level;
    });
    // 按最高优先级排序
    const patients = Object.entries(byPatient).sort(function(a,b){ return a[1].topLevel - b[1].topLevel; });

    main.innerHTML = '<div id="msgCenterSection">' +
      '<div class="card"><h2>💬 消息中心 <span class="sub">全量消息 · 一页处理 · 按患者聚合</span></h2>' +
      // 筛选栏
      '<div class="toolbar">' +
        '<button class="pill' + (!filter || !filter.status ? ' on' : '') + '" onclick="showMsgCenter()">全部</button>' +
        '<button class="pill' + (filter && filter.status==="pending" ? ' on' : '') + '" onclick="showMsgCenter({status:\\'pending\\'})">待处理 (' + msgCenterData.pending + ')</button>' +
        '<button class="pill' + (filter && filter.level==="1" ? ' on' : '') + '" onclick="showMsgCenter({level:\\'1\\'})">🔴 急症</button>' +
        '<button class="pill' + (filter && filter.level==="2" ? ' on' : '') + '" onclick="showMsgCenter({level:\\'2\\'})">🟠 需医生</button>' +
        '<button class="pill' + (filter && filter.level==="3" ? ' on' : '') + '" onclick="showMsgCenter({level:\\'3\\'})">🟡 需医助</button>' +
        '<button class="pill' + (filter && filter.level==="4" ? ' on' : '') + '" onclick="showMsgCenter({level:\\'4\\'})">🟢 已自动</button>' +
      '</div></div>' +
      // 消息列表 + 详情面板
      '<div style="display:flex;gap:16px;align-items:flex-start">' +
        // 左侧: 患者列表
        '<div style="flex:0 0 320px;max-height:70vh;overflow-y:auto">' +
          patients.map(function(entry){
            const pid = entry[0];
            const p = entry[1];
            const latest = p.messages[0];
            const color = levelColors[p.topLevel] || "#868e96";
            const isActive = msgCenterData.currentPatient === pid;
            return '<div onclick="selectPatient(\\'' + pid + '\\')" style="padding:12px;border:1px solid ' + (isActive ? '#07c160' : '#eee') + ';border-radius:10px;margin-bottom:8px;cursor:pointer;background:' + (isActive ? '#f0fdf4' : '#fff') + '">' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
                '<b style="font-size:14px">' + esc(p.name) + '</b>' +
                '<span style="margin-left:auto;font-size:11px;color:#999">' + (p.messages.length) + '条</span>' +
              '</div>' +
              '<div style="font-size:12px;color:#666;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((latest.text||"").slice(0,40)) + '</div>' +
              '<div style="font-size:11px;color:#aaa;margin-top:2px">' + levelLabels[p.topLevel] + ' · ' + timeAgo(latest.created_at) + '</div>' +
            '</div>';
          }).join("") +
        '</div>' +
        // 右侧: 详情面板
        '<div id="msgDetailPanel" style="flex:1;min-width:0">' +
          '<div class="card"><div class="empty">← 选择一个患者查看详情</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  window.selectPatient = async function(patientId){
    msgCenterData.currentPatient = patientId;
    const panel = document.getElementById("msgDetailPanel");
    if(!panel) return;

    // 获取该患者的历史消息
    let history;
    try { history = await api("GET", "/api/admin/messages/patient/" + encodeURIComponent(patientId)); }
    catch(e){ history = { messages:[] }; }
    const msgs = history.messages || [];

    const levelColors = { 1:"#e03131", 2:"#e8590c", 3:"#f59f00", 4:"#37b24d", 5:"#868e96", 6:"#ced4da" };
    const levelLabels = { 1:"🔴 急症", 2:"🟠 需医生", 3:"🟡 需医助", 4:"🟢 低风险", 5:"⚪ 编号", 6:"💤 闲聊" };

    const patientName = msgs.length ? (msgs[0].patient_name || patientId) : patientId;
    const pendingMsgs = msgs.filter(function(m){ return m.reply_status === "pending"; });
    const latestPending = pendingMsgs[0];

    panel.innerHTML =
      '<div class="card">' +
        '<h2>' + esc(patientName) + ' <span class="sub">' + msgs.length + ' 条历史消息</span></h2>' +
        // 消息时间线
        '<div style="max-height:300px;overflow-y:auto;margin-bottom:16px;border:1px solid #f0f0f0;border-radius:8px;padding:12px">' +
          msgs.slice(0,20).reverse().map(function(m){
            const color = levelColors[m.level] || "#868e96";
            const isInbound = m.direction === "inbound";
            return '<div style="margin-bottom:10px;padding:8px 12px;border-radius:8px;background:' + (isInbound ? '#f8f9fa' : '#e7f7ee') + ';border-left:3px solid ' + color + '">' +
              '<div style="font-size:11px;color:#999;margin-bottom:3px">' +
                (isInbound ? '患者' : '回复') + ' · ' + (levelLabels[m.level]||"") + ' · ' + timeAgo(m.created_at) +
              '</div>' +
              '<div style="font-size:13px">' + esc((m.text||"").slice(0,200)) + '</div>' +
              (m.ai_draft ? '<div style="font-size:12px;color:#07c160;margin-top:4px">AI 草稿: ' + esc(m.ai_draft.slice(0,100)) + '</div>' : '') +
              (m.reply_sent ? '<div style="font-size:12px;color:#1976d2;margin-top:4px">已回复: ' + esc(m.reply_sent.slice(0,100)) + '</div>' : '') +
            '</div>';
          }).join("") +
        '</div>' +
        // 回复区
        (latestPending ?
          '<div style="border-top:1px solid #eee;padding-top:14px">' +
            '<div style="font-size:13px;color:#666;margin-bottom:6px">✍️ 回复 @' + esc(patientName) + '（发送到群）</div>' +
            (latestPending.ai_draft ? '<div style="font-size:12px;color:#07c160;margin-bottom:8px;padding:8px;background:#f0fdf4;border-radius:6px">💡 AI 建议: ' + esc(latestPending.ai_draft) + '<button onclick="document.getElementById(\\'msgReplyInput\\').value=this.parentElement.textContent.replace(\\'💡 AI 建议: \\',\\'\\')" style="margin-left:8px;font-size:11px;border:1px solid #07c160;background:none;color:#07c160;border-radius:4px;padding:2px 6px;cursor:pointer">采纳</button></div>' : '') +
            '<textarea id="msgReplyInput" placeholder="输入回复内容..." style="width:100%;min-height:70px;border:1px solid #ddd;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical">' + (latestPending.ai_draft || '') + '</textarea>' +
            '<div style="margin-top:8px;display:flex;gap:8px">' +
              '<button onclick="sendMsgReply(\\'' + (latestPending.triage_session_id || latestPending.id) + '\\')" style="background:#07c160;color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:13px;cursor:pointer">发送回复到群</button>' +
              '<button onclick="markMsgHandled(\\'' + (latestPending.triage_session_id || latestPending.id) + '\\')" style="background:#f0f2f5;color:#444;border:none;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer">标记已处理</button>' +
              '<button onclick="transferToDoctor(\\'' + (latestPending.triage_session_id || latestPending.id) + '\\')" style="background:#fff7e6;color:#e8590c;border:1px solid #ffd8a8;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer">转医生</button>' +
            '</div>' +
          '</div>'
        : '<div style="color:#999;font-size:13px;padding-top:14px;border-top:1px solid #eee">该患者无待处理消息</div>') +
      '</div>';
  };

  window.sendMsgReply = async function(sessionId){
    const ta = document.getElementById("msgReplyInput");
    if(!ta || !ta.value.trim()){ alert("请输入回复内容"); return; }
    try {
      const r = await api("POST", "/api/admin/triage/" + sessionId + "/manual-reply", { text: ta.value.trim() });
      if(r && r.ok){ alert("✅ 已发送到群"); showMsgCenter({status:"pending"}); }
      else { alert("发送失败：" + (r.error || "未知错误")); }
    } catch(e){ alert("发送异常：" + e.message); }
  };

  window.markMsgHandled = async function(sessionId){
    try {
      await api("POST", "/api/admin/triage/" + sessionId + "/status", { status:"resolved" });
      alert("✅ 已标记处理"); showMsgCenter({status:"pending"});
    } catch(e){ alert("操作失败：" + e.message); }
  };

  window.transferToDoctor = async function(sessionId){
    try {
      await api("POST", "/api/admin/triage/" + sessionId + "/status", { status:"handoff", note:"转医生处理" });
      alert("✅ 已转医生，通知已发送"); showMsgCenter({status:"pending"});
    } catch(e){ alert("操作失败：" + e.message); }
  };

  function timeAgo(ts){
    if(!ts) return "";
    var diff = Date.now() - new Date(ts).getTime();
    var min = Math.floor(diff/60000);
    if(min < 1) return "刚刚";
    if(min < 60) return min + "分钟前";
    var h = Math.floor(min/60);
    if(h < 24) return h + "小时前";
    return Math.floor(h/24) + "天前";
  }

  function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
})();
</script>
`;

  html = html.replace("</body>", msgCenterScript + "\n</body>");
  fs.writeFileSync(adminHtmlPath, html);
  console.log("[frontend 1/2] ✅ 消息中心一页闭环 UI 已插入 admin.html");
}

// ====== 2. server.js: 补充 status API（转人工/标记处理） ======
let srv = fs.readFileSync(__dirname + "/server.js", "utf8");

const statusAPI = `
/* [v2.1] 分诊状态变更 API（转人工/标记处理） */
route("POST", /^\\/api\\/admin\\/triage\\/(\\d+)\\/status$/, async (req,res,m)=>{
  const s=authed(req); if(!s) return json(res,401,{error:"未登录"});
  const b = await parseBody(req);
  const sessionId = +m[1];
  const status = b.status || "resolved";
  const note = b.note || "";
  
  // 更新分诊会话状态
  db.prepare("UPDATE triage_sessions SET status=?,resolved_at=datetime('now'),resolved_by=? WHERE id=?").run(status, s.username||String(s.adminId), sessionId);
  
  // 更新 message_log
  db.prepare("UPDATE message_log SET reply_status=?,replied_by=?,replied_at=datetime('now') WHERE triage_session_id=? AND reply_status='pending'").run(
    status === "handoff" ? "transferred" : "resolved",
    s.username || String(s.adminId),
    sessionId
  );
  
  // 如果转医生，记录审计日志
  if(status === "handoff"){
    try {
      db.prepare("INSERT INTO admin_audit_log(admin_id,action,resource_type,resource_id,doctor_id,meta,created_at) VALUES(?,?,?,?,?,?,datetime('now'))").run(
        s.adminId || 1, "triage.handoff", "triage_session", sessionId, null, JSON.stringify({note})
      );
    } catch(e){}
  }
  
  json(res,200,{ok:true, status});
});
`;

if(!srv.includes("/api/admin/triage") || !srv.includes("/status")){
  // 找到 manual-reply 路由之后插入
  const manualIdx = srv.indexOf("manual-reply");
  if(manualIdx > 0){
    const routeEnd = srv.indexOf("});", manualIdx + 200);
    if(routeEnd > 0){
      srv = srv.slice(0, routeEnd + 4) + "\n" + statusAPI + srv.slice(routeEnd + 4);
    }
  } else {
    // fallback
    const listenIdx = srv.lastIndexOf("console.log(`  ");
    if(listenIdx > 0) srv = srv.slice(0, listenIdx) + statusAPI + "\n" + srv.slice(listenIdx);
  }
  fs.writeFileSync(__dirname + "/server.js", srv);
  console.log("[frontend 2/2] ✅ triage status API 已添加到 server.js");
} else {
  console.log("[frontend 2/2] ⏭️ status API 已存在");
}

console.log("\n✅ 前端升级完成！");
console.log("本地验证: node server.js --demo");
console.log("部署: rsync + systemctl restart chunyu-doctor");
