/* 患者消息统一回复链路：患者端 /api/message 与 QiWe 单聊回调共用。
   安全边界：只下发 triage.response（确定性安全模板或允许自动发送文本），不把模型 draft 直接发给患者。 */
const { db } = require("./db.js");
const engine = require("./engine.js");
const triage = require("./triage.js");
const opsConfig = require("./ops_config.js");
const scienceContent = require("./science_content.js");

const now = () => new Date().toISOString();

function cleanText(v, n){
  return String(v == null ? "" : v).replace(/\s+\n/g, "\n").trim().slice(0, n || 1200);
}

/* 对外 origin（域名深链承接，甲方 2026-07-03）：与 qiwe_bridge.publicOrigin 同口径读 env，不硬编码域名（可移植纪律）。
   故意不 require qiwe_bridge（qiwe_bridge 已 require 本模块，避免循环依赖）；只读同一批 env 变量。无 env → 空串。 */
function publicOrigin(){
  return String(process.env.PUBLIC_ORIGIN || process.env.APP_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
}

/* 相对深链在企微/社群「文本」行里的补全（fail-closed）：以 "/" 开头的相对 linkUrl 用 publicOrigin 补成绝对 https；
   origin 空 → 返回空串 → 上游省略该链接行（绝不在文本里发相对路径死链，标题行不受影响）。web 患者端同域、不走此文本路径，渲染不动。 */
function absoluteDeepLink(v){
  const s = cleanText(v, 1000);
  if(!/^\//.test(s)) return "";           // 非相对路径 → 不在此处理（本函数只管深链补全，绝对链接由 externalJumpText 走 external）
  const origin = publicOrigin();
  return origin ? origin + s : "";
}

function fillPatientPlaceholder(responses, patientName){
  const pname = (patientName && patientName !== "网页咨询者") ? String(patientName).slice(0,20) : "";
  if(Array.isArray(responses)) responses.forEach(r=>{
    if(r && typeof r.text === "string") r.text = r.text.replace(/@?\{patient\}\s?/g, pname ? (pname + " ") : "");
  });
  return responses;
}

function clone(v){
  return JSON.parse(JSON.stringify(v));
}

function scriptVars(doctorId, patientName){
  let d = {};
  try{ d = db.prepare("SELECT name,hospital,dept,specialty,group_name FROM doctors WHERE id=?").get(+doctorId) || {}; }catch(e){ d = {}; }
  return {
    patient: cleanText(patientName || "", 80),
    group: cleanText(d.group_name || "", 120),
    doctor: cleanText(d.name || "", 80),
    dept: cleanText(d.dept || d.specialty || "", 80),
    hospital: cleanText(d.hospital || "", 120)
  };
}

function configuredCodeScript(doctorId, code, patientName){
  const scripts = opsConfig.scripts(doctorId);
  return opsConfig.render(opsConfig.scriptValue(scripts, "code" + cleanText(code, 40)), scriptVars(doctorId, patientName));
}

function withConfiguredCodeScript(doctorId, code, responses, patientName, options){
  const list = Array.isArray(responses) ? responses : [];
  const script = cleanText(configuredCodeScript(doctorId, code, patientName), 2400);
  if(!script) return list;
  const current = responsesToQiweText({ responses:list }, patientName, options || {});
  if(current && current.indexOf(script) >= 0) return list;
  // 规则里若还有已被固定话术完整覆盖的纯文本（如 103「医院电话」），去掉以免叠发
  const rest = list.filter((r)=>{
    if(!r || r.type !== "text") return true;
    const t = cleanText(r.text, 2400);
    if(!t) return false;
    return script.indexOf(t) < 0;
  });
  return [{ type:"text", text:script }].concat(rest);
}

/* 群菜单动态文案：读医生 content.menu.{title,items[{code,label}]} 逐行 "<code> <label>"。
   纯函数、不碰 DB（content 由调用方传入）；不写死任何医生菜单（不同医生发「1」各得各的）。
   content.menu 缺失/空 → 安全兜底文案（不崩、不泄露别的医生编号）。 */
function buildMenuText(content){
  const menu = (content && content.menu) || {};
  const title = cleanText(menu.title, 80) || "群功能菜单";
  const items = Array.isArray(menu.items) ? menu.items : [];
  const lines = items.map(it=>{
    const code = cleanText(it && it.code, 20);
    const label = cleanText(it && it.label, 60);
    return code ? (label ? `${code} ${label}` : code) : "";
  }).filter(Boolean);
  if(!lines.length) return "群功能菜单\n（本群暂未配置功能编号，您可直接描述问题，或发送 101 进入 1对1 咨询入口。）";
  return (title + "\n" + lines.join("\n")).slice(0, 3600);
}

function httpError(status, message){
  const e = new Error(message);
  e.status = status;
  return e;
}

async function buildPatientReply(input){
  const did = Number(input && input.doctorId);
  const attachments = Array.isArray(input && input.attachments) ? input.attachments : [];
  const text = cleanText(input && input.text, 500);
  const suppressPatientName = !!(input && input.suppressPatientName);
  const patientName = suppressPatientName ? "网页咨询者" : (cleanText((input && input.patientName) || "康复中的小宇", 40) || "康复中的小宇");
  const patientKey = cleanText((input && input.patientKey) || "demo-patient", 120) || "demo-patient";
  // 群/DM 场景标志（甲方 2026-07-03 群内脱敏裁定）：显式 input.isGroup 优先；未显式给时以 suppressPatientName 兜底
  // （qiwe 桥群消息历来只置 suppressPatientName）。任一说是群 → 按群处理（隐私 fail-closed：档案摘要只注入 DM 场景）。
  // 小程序 channel=mp：强制按一对一 DM（非群），支持长对话 history。
  const channel = cleanText((input && input.channel) || "", 20).toLowerCase();
  const groupScene = channel === "mp"
    ? false
    : ((input && input.isGroup !== undefined) ? !!input.isGroup : suppressPatientName);
  const history = Array.isArray(input && input.history) ? input.history : [];

  if(!did) throw httpError(400, "缺少 doctorId");
  if(!text && !attachments.length) throw httpError(400, "消息或图片不能为空");
  if(!db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did)) throw httpError(404, "医生不存在");

  const logText = (text || "患者上传图片/报告") + (attachments.length ? ` [图片${attachments.length}张]` : "");
  db.prepare("INSERT INTO msg_log(doctor_id,direction,text,created_at) VALUES(?,?,?,?)").run(did, "in", logText.slice(0,600), now());

  const matched = attachments.length ? null : engine.match(did, text);
  if(matched){
    const out = Object.assign({}, matched);
    // 动态群菜单：engine 命中「1/菜单/功能/全部功能」只返回 {menu:true}，在此按该医生 content.menu 算出菜单文案，
    // 供 responsesToQiweText 直接取（保持那边纯格式化、不碰 DB）。
    if(out.menu){
      let content = {};
      try{ content = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(did) || {}).content || "{}"); }catch(e){ content = {}; }
      out.menuText = buildMenuText(content);
    }
    if(Array.isArray(out.responses)){
      out.responses = fillPatientPlaceholder(clone(out.responses), patientName);
      // outbound 已内嵌话术步，不再前插 ops_configs scripts
      if(out.source !== "outbound"){
        out.responses = withConfiguredCodeScript(did, out.code, out.responses, patientName, { omitPatientName:groupScene });
      }
      // 606 科普卡门控：无 scienceArticles 不发卡链；有内容则按 content 重建卡。
      try{
        const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(did);
        out.responses = scienceContent.gateScienceCodeResponses(out.code, out.responses, row && row.content);
      }catch(e){}
    }
    if(out.source !== "outbound") out.source = "keyword_rule";
    return out;
  }

  if(text && !attachments.length){
    try{
      const intent = await triage.classifyIntent(did, text);
      if(intent && intent.menu){
        let content = {};
        try{ content = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(did) || {}).content || "{}"); }catch(e){ content = {}; }
        return { bot:"小宝医助", menu:true, menuText:buildMenuText(content), source:"ai_intent" };
      }
      if(intent && intent.code && Array.isArray(intent.responses)){
        // 103 意图候选增强（2026-07-10）：闸从「responses 非空」放宽为「前插脚本后非空」——
        // withConfiguredCodeScript 对 responses=[] 会前插 code 脚本（103→电话话术），无脚本则返回 []→fallthrough（行为不变）。
        let responses = withConfiguredCodeScript(
          did,
          intent.code,
          fillPatientPlaceholder(clone(intent.responses), patientName),
          patientName,
          { omitPatientName:groupScene }
        );
        try{
          const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(did);
          responses = scienceContent.gateScienceCodeResponses(intent.code, responses, row && row.content);
        }catch(e){}
        if(responses.length){
          return {
            bot:"小宝医助",
            responses,
            source:"ai_intent",
            intentCode:intent.code
          };
        }
      }
    }catch(e){
      // 意图识别失败时继续进入 AI 分诊；fail-closed 由 triage.handleIncoming 保底。
    }
  }

  try{
    const r = await triage.handleIncoming({
      doctorId:did,
      text,
      attachments,
      patientName,
      patientKey,
      patientId:input && input.patientId,
      isGroup:groupScene,
      history,
      channel
    });
    const responseText = r.response && r.response.text ? r.response.text : "";
    if(responseText) db.prepare("INSERT INTO msg_log(doctor_id,direction,text,created_at) VALUES(?,?,?,?)").run(did, "out", responseText, now());
    const auto = !!(r.triage && r.triage.canAutoSend);
    // 三档-高危附卡（2026-07-02 裁定）：handleIncoming 对 high 返回 extraResponses（该医生 101 问诊入口卡，
    // 确定性 DB 内容），与安全话术同批下发；entryCode→intentCode 供 qiwe 桥按既有 101 卡片模板机制发原生卡。
    const extras = Array.isArray(r.extraResponses) && r.extraResponses.length
      ? fillPatientPlaceholder(clone(r.extraResponses), patientName) : [];
    const out = {
      bot:r.bot,
      responses:[r.response, ...extras],
      triage:r.triage,
      autoSent:auto,
      handoff:!!(r.triage && r.triage.needsHuman),   // 三档后 canAutoSend/needsHuman 解耦：high 自动发但仍转人工跟进
      sessionId:r.sessionId,
      decisionId:r.decisionId,
      source:"ai_triage"
    };
    if(r.entryCode) out.intentCode = r.entryCode;
    return out;
  }catch(e){
    return {
      bot:"小宝医助",
      responses:[{
        type:"text",
        text:"您的问题已收到。当前分诊服务暂时繁忙，我已提示医助人工查看；如有明显腹痛、发热、黄疸、呕吐等情况，请及时到正规医院就诊。"
      }],
      triage:{ riskLevel:"medium", canAutoSend:false, needsHuman:true, suggestedAction:"AI分诊异常，转人工" },
      autoSent:false,
      handoff:true,
      source:"triage_error"
    };
  }
}

function externalJumpText(r){
  const ext = (r && r.external) || {};
  const link = ext.shortLink || r.shortLink || ext.urlLink || ext.urlScheme || ext.url || r.url || "";
  const scope = ext.shortLinkScope || "";
  if(!link) return "";
  return scope ? `${link}\n适用范围：${scope}` : link;
}

function isMiniProgramResponse(r){
  if(!r) return false;
  const ext = r.external || {};
  return r.type === "mp" || ext.mode === "mini_program" || !!ext.shortLink;
}

/* 「该响应是否会真成为企微链接卡片」判定（甲方 2026-07-03·有卡片就不发文本链接）：
   必须与 qiwe_bridge.linkCardFromResponse/resolveLinkUrl 同口径——取同一组 url 字段，绝对 http(s) 原样、
   相对深链(/开头)按 publicOrigin() 补全，补全后仍须是 http(s) 才算成卡。PUBLIC_ORIGIN 空 → 相对深链补全为空 → 不成卡
   → 文本行必须保留（fail-closed 两侧对齐，链接不丢）。故意在本模块本地复刻判定（不 require qiwe_bridge，避免循环依赖）。 */
function willBecomeLinkCard(r){
  if(!r) return false;
  const ext = r.external || {};
  const raw = cleanText(r.linkUrl || r.url || ext.url || ext.urlLink || ext.linkUrl, 1000);
  if(!raw) return false;
  let url = raw;
  if(/^\//.test(raw)){                       // 相对深链 → 用 publicOrigin 补全（origin 空 → 空串 → 不成卡）
    const origin = publicOrigin();
    url = origin ? origin + raw : "";
  }
  return /^https?:\/\//i.test(url);          // 补全后必须绝对 http(s)（与 qiwe_bridge.httpUrl 一致）才算成卡
}

function miniProgramResponses(reply){
  const responses = Array.isArray(reply) ? reply : (reply && reply.responses);
  return (Array.isArray(responses) ? responses : []).filter(isMiniProgramResponse);
}

function responseToPlainText(r, options){
  if(!r) return "";
  if(options && options.omitMiniPrograms && isMiniProgramResponse(r)) return "";
  if(options && options.omitQr && r.type === "qr") return "";
  // 有卡片就不发文本链接（甲方 2026-07-03·616 场景去重）：会真成为链接卡片的响应，在文本里整条省略——避免同一链接
  //   既进 payload.linkCards 又进文本行重复发。willBecomeLinkCard 与 qiwe_bridge 成卡口径一致；PUBLIC_ORIGIN 空 →
  //   相对深链不成卡 → 此处不省略 → 文本行保留（fail-closed 两侧对齐，链接不丢）。
  if(options && options.omitLinkCards && willBecomeLinkCard(r)) return "";
  if(r.type === "text") return cleanText(r.text, 1400);
  if(r.type === "mp"){
    const lines = [`【${cleanText(r.title || "春雨医生小程序", 80)}】${r.sub ? " " + cleanText(r.sub, 120) : ""}`];
    const jump = externalJumpText(r);
    if(jump) lines.push(jump);
    return lines.filter(Boolean).join("\n");
  }
  if(r.type === "link"){
    const lines = [`【${cleanText(r.title || "相关链接", 80)}】${r.source ? " " + cleanText(r.source, 120) : ""}`];
    const jump = externalJumpText(r);
    // 深链卡（linkUrl 相对路径 /?p=<key>，无 external）：补全绝对 https 后作为跳转行；origin 空 → 该链接行省略（fail-closed，只留标题行，不发死链）。
    const deepJump = jump ? "" : absoluteDeepLink(r.linkUrl);
    if(jump) lines.push(jump);
    else if(deepJump) lines.push(deepJump);
    return lines.filter(Boolean).join("\n");
  }
  if(r.type === "qr"){
    return `【联系医生】${cleanText(r.name || "医生团队", 80)}${r.sub ? " · " + cleanText(r.sub, 80) : ""}${r.caption ? "\n" + cleanText(r.caption, 160) : ""}`;
  }
  if(r.type === "popup") return `【查看信息】${cleanText(r.modal || r.title || "详情", 80)}`;
  if(r.type === "image") return "";
  if(r.type === "feed_video") return "";
  return cleanText(r.text || r.title || JSON.stringify(r), 800);
}

function responsesToQiweText(reply, patientName, options){
  if(reply && reply.menu){
    // 动态菜单文案由 buildPatientReply 预先算入 reply.menuText（读该医生 content.menu）；此处只取，不碰 DB。
    return cleanText(reply.menuText, 3600) || buildMenuText(null);
  }
  const responses = Array.isArray(reply) ? reply : (reply && reply.responses);
  const patient = options && options.omitPatientName ? "" : cleanText(patientName, 20);
  const text = (Array.isArray(responses) ? responses : [])
    .map(r=>responseToPlainText(r, options || {}))
    .filter(Boolean)
    .join("\n\n")
    .replace(/@?\{patient\}\s?/g, patient ? (patient + " ") : "")
    .trim();
  return text.slice(0, 3600);
}

module.exports = {
  buildPatientReply,
  responsesToQiweText,
  miniProgramResponses,
  fillPatientPlaceholder,
  buildMenuText,
  withConfiguredCodeScript,
  scienceContent
};
