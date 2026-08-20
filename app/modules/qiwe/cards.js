"use strict";
/* QiWe 小程序卡 / 链接卡 / 模板采集 / 自动发闸 / 欢迎卡模板 */
const S = require("./shared");
const {
  db, qiwe,
  miniProgramResponses,
  pendingTemplateCodes, PENDING_TEMPLATE_MS, now,
  cleanText, httpUrl, encodeUrlForWechatFetch, resolveLinkUrl, publicOrigin, defaultLinkIconUrl,
  activeDoctorId, resolveEventDoctorId
} = S;

function replyCode(reply){
  // entryCode 增读（甲方验收实弹缺陷一修 2026-07-03 夜）：triage.handleIncoming 原样结果的编号在顶层 entryCode
  // （buildPatientReply 会映射成 intentCode，但直连桥的 ai_triage 形状回复不经该映射）。优先级 intentCode > entryCode > code，
  // 既有消费方（rememberPendingTemplateCode 的 {code:evt.text}、keyword_rule 的 reply.code、ai_intent 的 intentCode）语义零变化。
  return String((reply && (reply.intentCode || reply.entryCode || reply.code)) || "").trim();
}

function nativeWeappAllowedResponse(r){
  const ext = (r && r.external) || {};
  if(ext.nativeCard === false) return false;
  // 外链 H5 若不在春雨小程序业务域名内，禁止走原生卡（应发企微链接卡），避免「不支持打开 https://…」。
  const extUrl = String(ext.url || r.linkUrl || r.url || "").trim();
  if(extUrl && /^https?:\/\//i.test(extUrl) && !isChunyuH5WebviewHostAllowed(extUrl)){
    return false;
  }
  // fallback_short_link 默认只能进入兜底入口再手动点目标页；202 的「我的全部服务」是例外：
  // 真实卡片 page_path 必须再经 templateNativeWeappAllowed 校验为 all_service，旧首页卡仍 fail-closed。
  if(ext.status === "fallback_short_link"){
    const text = [r && r.title, r && r.sub, r && r.page, ext.shortLink, ext.shortLinkScope, ext.note]
      .filter(Boolean).join(" ");
    return /PuW00A6zBsHAw9y|我的全部服务|我的订单|订单\/回复/.test(text);
  }
  return true;
}

function nativeWeappResponses(reply){
  return miniProgramResponses(reply).filter(nativeWeappAllowedResponse);
}


function linkCardFromResponse(r){
  if(!r) return null;
  if(r.type === "image") return null;
  const ext = r.external || {};
  // 深链卡 linkUrl 可能是相对路径 /?p=<key>（域名深链承接）→ resolveLinkUrl 先按 PUBLIC_ORIGIN 补全绝对 https，
  //   origin 空 → 返回空串 → 下方 url 为空 → 跳过该卡（fail-closed，绝不发相对路径死链）；绝对 http/s 链接原样通过。
  const url = httpUrl(resolveLinkUrl(r.linkUrl || r.url || ext.url || ext.urlLink || ext.linkUrl));
  if(!url) return null;
  const iconUrl = encodeUrlForWechatFetch(
    r.iconUrl || r.thumbUrl || r.coverUrl || ext.iconUrl || ext.coverUrl || defaultLinkIconUrl()
  );
  return {
    title:cleanText(r.title || ext.label || "相关链接", 120),
    desc:cleanText(r.desc || r.sub || r.source || ext.service || ext.provider || ext.note || "", 240),
    iconUrl,
    linkUrl:url
  };
}

function linkCards(reply){
  const responses = Array.isArray(reply) ? reply : (reply && reply.responses);
  const seen = new Set();
  const out = [];
  for(const r of (Array.isArray(responses) ? responses : [])){
    const card = linkCardFromResponse(r);
    if(!card || !card.linkUrl) continue;
    if(seen.has(card.linkUrl)) continue;
    seen.add(card.linkUrl);
    out.push(card);
  }
  return out;
}

/* 链接卡右侧缩略图：只用小体积公开图（/uploads/link-icons/）。
   禁止直接塞 qiwe-covers 大封面（常 1MB+），否则企微整卡发送失败。 */
function enrichLinkCardsWithTemplateThumb(doctorId, code, cards){
  if(!doctorId || !Array.isArray(cards) || !cards.length) return cards;
  const codeKey = String(code || "").trim();
  if(!codeKey) return cards;
  const origin = publicOrigin();
  if(!origin) return cards;
  const candidates = [
    origin + "/uploads/link-icons/" + codeKey + "-d" + Number(doctorId) + ".png",
    origin + "/uploads/link-icons/" + codeKey + ".png",
    origin + "/uploads/link-icons/default.png"
  ];
  // 优先本编号专用小图，否则 default；不读 weapp 大封面。
  // 规则卡常已带 default.png；仍要升级为编号专用图（存在则用，否则保留 default）。
  const thumb = candidates[0];
  const fallback = candidates[2];
  for(const card of cards){
    // 入群视频问候页不是编号服务兜底深链，禁止用 979 等编号小图标覆盖（正式群聊为春雨默认十字标）。
    const link = String(card.linkUrl || "");
    if(/\/welcome-video\//i.test(link)) continue;
    const cur = String(card.iconUrl || "");
    const isWeak = !cur
      || /chunyu-doctor-icon\.png/i.test(cur)
      || /\/uploads\/qiwe-covers\//i.test(cur)
      || /\/uploads\/link-icons\/default\.png/i.test(cur);
    if(isWeak){
      // 先写编号专用路径；若文件不存在，sendLink 失败会自动去 icon 重试，仍能发出链接。
      card.iconUrl = thumb || fallback;
    }
  }
  return cards;
}

/* 兜底链接卡抑制（甲方 2026-07-06·h5_webview 四码「优先 weapp、成功即不重复发兜底链接卡」）：
   同源扩展既有「有卡片就不发文本链接」的 omitLinkCards 机制——把「压制」从 mp 短链文本延伸到「该规则的兜底 linkCards」。
   返回该「实发 weapp 编号」当前 enabled 规则响应会成卡的 linkUrl 集合（用 linkCardFromResponse 同口径解析，
   PUBLIC_ORIGIN 相对深链补全、绝对 http/s 原样，确保与 articleLinkCards 里对应卡的 linkUrl 逐字对齐）。
   仅返回「属于实发 weapp 那条规则」的 URL —— 低危 LLM 合并回复可拼入别的编号(attach)的 link 卡，那些绝不能被压制。
   fail-closed 边界（关键）：本集合只在「weapp 真发成功后」于投递点用来跳过对应卡；weapp 未就绪 / sendWeapp 失败
   一律不使用（linkCards 照发、链接永不丢）。code 不存在 / 规则关闭 / 解析失败 → 空 Set（不压制任何卡，保守）。 */
function ruleResponsesForCode(doctorId, code){
  if(!doctorId || !code) return [];
  try{
    const r = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(doctorId, String(code));
    const parsed = r && r.responses ? JSON.parse(r.responses) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(e){ return []; }
}

function weappRuleLinkUrls(doctorId, code){
  const urls = new Set();
  for(const r of ruleResponsesForCode(doctorId, code)){
    const card = linkCardFromResponse(r);
    if(card && card.linkUrl) urls.add(card.linkUrl);
  }
  return urls;
}

/* 欢迎卡小程序未就绪时的 H5 兜底：取规则里的 link 卡；联络表额外可读 contactForm.externalUrl。 */
function welcomeCodeFallbackLinkCards(doctorId, code){
  const responses = ruleResponsesForCode(doctorId, code);
  const list = linkCards({ responses });
  if(list.length) return enrichLinkCardsWithTemplateThumb(doctorId, code, list);
  if(String(code) !== "979" && String(code) !== "联络表") return [];
  try{
    const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(+doctorId);
    const content = JSON.parse((row && row.content) || "{}");
    const url = httpUrl((content.contactForm && content.contactForm.externalUrl) || "");
    if(!url) return [];
    const cards = [{
      title: cleanText((content.contactForm && content.contactForm.title) || "医患联络表", 120),
      desc: cleanText((content.contactForm && content.contactForm.desc) || "提交基础信息建档", 240),
      iconUrl: defaultLinkIconUrl(),
      linkUrl: url
    }];
    return enrichLinkCardsWithTemplateThumb(doctorId, code, cards);
  }catch(e){ return []; }
}

function welcomeCodeFallbackTexts(doctorId, code){
  return ruleResponsesForCode(doctorId, code)
    .filter(r=>r && r.type === "text" && String(r.text || "").trim())
    .map(r=>String(r.text).trim().slice(0, 1200));
}

/* weapp 是否「回执确认真发」（codex 跨厂复核 fail-closed 反例修 2026-07-06）：sendWeapp 的 promise 不抛错 ≠ 业务真发出——
   qiweapi 可能 code:0（HTTP/API 层成功）却 data.isSendSuccess=0/false（业务侧未发出）。这种「resolved 但未真发」若被当成功，
   会抑制该规则兜底 linkCard → 小程序卡实际没发、兜底链接也被跳过 → 破「链接永不丢」红线。
   判据（保守·只在明确指示未发时才判 false）：回执里 isSendSuccess **显式为假值** → 未真发(返 false)；
   假值口径（codex 第 3 轮硬化 2026-07-06）：数字/布尔 0/false；字符串先 .trim().toLowerCase() 归一化后 ∈ {"0","false"}
   —— 覆盖 "0"/"false"/"False"/"FALSE"/" false "（大小写/前后空白）等真实回执变体，绝不因大写/空白漏判成"已发"→误抑制兜底卡。
   其余（isSendSuccess 真 / DRY_RUN 桩 data.dryRun=true / qiweapi 某 method 不回该字段 → 字段 undefined）→ 视为已发(返 true)。
   为何字段缺失判 true：DRY_RUN 桩与部分真实回执不带 isSendSuccess，一律判 false 会让抑制永不触发（回归 100% 冗余卡）、
   且「多发一张兜底卡」本就不丢链接、安全侧无害；而「显式为假」是明确的未发信号、必须 fail-closed 不抑制。 */
function weappSendConfirmed(res){
  const data = (res && res.data) || {};
  if("isSendSuccess" in data){
    const v = data.isSendSuccess;
    if(v === 0 || v === false) return false;                       // 数字/布尔假值
    if(typeof v === "string"){                                     // 字符串归一化（去空白+小写）后判假值：覆盖 "False"/" false " 等变体
      const norm = v.trim().toLowerCase();
      if(norm === "0" || norm === "false") return false;
    }
    return true;
  }
  return true;   // 无 isSendSuccess 字段（DRY_RUN 桩 / 部分真实回执）→ 沿用「promise 未抛错 + code:0」既有成功语义
}

/* 818 海报真图素材解析（fail-closed·仅在 QIWE_SENDIMAGE_EXPERIMENTAL 开态被调用；关态整条分支短路，绝不进此函数）。
   判据：reply 含 image 响应（type==='image' 且 page/svg==='poster'）+ 该医生 content.posterImage 通过白名单校验
   （仅 /assets/<name>.{jpg,jpeg,png}，与患者端 ui.js validPosterImage 同白名单）→ 读真实 jpg 字节发图；
   否则返回 null（无 posterImage / SVG 生成海报无真实 jpg → 保持现状文字占位，见任务卡「SVG 生成海报不发图」）。
   路径穿越双防护：① 正则只放行 /assets/ + basename（无 / \ .. 段）；② path.resolve 后校验仍在 ASSETS_DIR 内（realpath 前缀锚定）。
   纯 I/O 读文件、无副作用；文件不存在/读失败 → null（不抛错、回落文字占位）。 */

function codeNativeWeappAllowed(doctorId, code){
  if(!doctorId || !code) return false;
  // 甲方 2026-07-03 裁定（看真实测试群截图）：挂号「春雨小程序发卡不发文本短链」——解禁挂号原生卡。
  // 解禁后 hasReadyTemplate=true 时既有 omitMiniPrograms 机制自动「发卡 + 文本不带 #小程序:// 行」。105 all_service 白名单与其余逻辑零改动。
  let responses = [];
  try{
    const r = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(doctorId, String(code));
    const parsed = r && r.responses ? JSON.parse(r.responses) : [];
    responses = Array.isArray(parsed) ? parsed : [];
  }catch(e){ responses = []; }
  return nativeWeappResponses({ responses }).length > 0;
}

/* 春雨医生小程序 h5_webview 业务域名白名单（未登记域名会报「不支持打开 https://…」）。
   医患通自建域名 yht.chunyutianxia.com 等不得包进 h5_webview，应改发企微链接卡。 */
function isChunyuH5WebviewHostAllowed(url){
  try{
    const host = new URL(String(url || "")).hostname.toLowerCase();
    return host === "chunyuyisheng.com" || host.endsWith(".chunyuyisheng.com");
  }catch(e){ return false; }
}

function extractH5WebviewEmbeddedUrl(pagePath){
  const s = String(pagePath || "");
  if(!/h5_webview/i.test(s)) return null;
  const m = s.match(/[?&]url=([^&]+)/i);
  if(!m) return null;
  try{ return decodeURIComponent(m[1]); }catch(e){ return null; }
}

function templateNativeWeappAllowed(code, template){
  if(!template || !template.ready) return false;
  const c = String(code || template.code || "").trim();
  // 查看回复 all_service 只允许订单页原生模板；旧 202 仅作迁移兼容，新编号为 105。
  if(c === "105" || c === "202"){
    return /(^|\/)pages\/all_service\/index\.html(?:[?#]|$)/.test(String(template.pagePath || ""));
  }
  // h5_webview 包了非春雨域名（如 yht 建档短链）→ 小程序内打不开，禁止发原生卡，改走 linkCards。
  const embedded = extractH5WebviewEmbeddedUrl(template.pagePath);
  if(embedded && !isChunyuH5WebviewHostAllowed(embedded)) return false;
  return true;
}

/* 真发闸门（#5a，fail-closed 收紧）：autoSend ON 时，仅以下回复可自动真发，与 triage canAutoSend / 社群 auto_keywords 口径一致——
   · source=keyword_rule / ai_intent（确定性编号/规则/意图命中，= 医生预置安全话术）→ 可自动发；
   · source=ai_triage / triage_error（走 AI 分诊）→ 仅当 reply.triage.canAutoSend===true 才自动发（三档裁定 2026-07-02：low/high 为 true——
     low 发双闸 LLM 文本(生产 LOW_RISK_LLM_REPLY=1 开态)/否则服务模板、high 发本地安全话术+101 卡且 needsHuman 仍 true；medium 恒 false 转人工 pending）。
   · 其它/缺字段 → false（保守默认）。注意：真发内容 = responsesToQiweText（low 档 LOW_RISK_LLM_REPLY=1 时含过双闸的 LLM 文本、否则确定性安全模板+101 卡），绝不发 aiDraft（不变）。 */
function replyAutoSendable(reply){
  const src = reply && reply.source;
  if(src === "keyword_rule" || src === "ai_intent") return true;
  if(src === "mp_ai" || src === "qiwe_dm") return true;
  if(src === "code_fast_path") return !!(reply.triage && reply.triage.canAutoSend !== false);
  if(src === "dialogue_agent") return !!(reply.triage && reply.triage.canAutoSend === true && reply.triage.sendPolicy !== "review");
  if(src === "service_ack" || src === "triage_service_ack") return true; // 安全模板自动真发
  if(src === "ai_triage" || src === "triage_error") return !!(reply.triage && reply.triage.canAutoSend === true);
  return false;
}

function agentReplyShouldAutoDeliver(cfg, reply){
  if(reply && reply.dryRun) return false;
  if(reply && reply.source === "dialogue_agent" && reply.triage){
    const t = reply.triage;
    return t.canAutoSend === true && t.sendPolicy !== "review";
  }
  if(replyAutoSendable(reply)) return !!(cfg && cfg.autoSend);
  return false;
}

function captureKey(evt, cfg){
  if(evt && evt.fromRoomId) return "room:" + evt.fromRoomId;
  return "dm:" + String((cfg && cfg.testToId) || (evt && (evt.replyToId || evt.senderId || evt.receiverId)) || "default");
}

function knownWeappCode(doctorId, code){
  if(!doctorId || !code) return false;
  const row = db.prepare("SELECT 1 FROM qiwe_weapp_templates WHERE doctor_id=? AND code=? AND source_short_link<>''").get(doctorId, code);
  return !!row;
}

function rememberPendingTemplateCode(evt, cfg, doctorId){
  // 严格真实自发（同 weappCaptureSkip 口径）：不用 isFromSelf（含 loggedInUserId 回落 self 的漏洞），改 senderId===selfUserId；selfUserId 未配则不记。
  if(!evt || !evt.isText) return "";
  if(!cfg || !cfg.selfUserId || evt.senderId !== cfg.selfUserId) return "";
  const code = replyCode({ code:evt.text });
  if(!/^\d{3}$/.test(code) || !knownWeappCode(doctorId, code)) return "";
  pendingTemplateCodes.set(captureKey(evt, cfg), { code, at:now() });
  return code;
}

function primePendingTemplateCode(cfg, doctorId, code, toIds){
  const c = cleanText(code, 40);
  if(!/^\d{3}$/.test(c) || !knownWeappCode(doctorId, c)) return [];
  const keys = [];
  for(const raw of (Array.isArray(toIds) ? toIds : [])){
    const toId = cleanText(raw, 160);
    if(!toId) continue;
    const key = toId.indexOf("room:") === 0 || toId.indexOf("dm:") === 0
      ? toId
      : (toId.length >= 16 ? ("room:" + toId) : ("dm:" + toId));
    pendingTemplateCodes.set(key, { code:c, at:now() });
    keys.push(key);
  }
  return keys;
}

function takePendingTemplateCode(evt, cfg){
  const key = captureKey(evt, cfg);
  const item = pendingTemplateCodes.get(key);
  if(!item) return "";
  if(now() - item.at > PENDING_TEMPLATE_MS){
    pendingTemplateCodes.delete(key);
    return "";
  }
  pendingTemplateCodes.delete(key);
  return item.code;
}

function inferTemplateCode(evt, card, pendingCode){
  if(pendingCode) return pendingCode;
  const text = [
    evt && evt.text,
    card && card.title,
    card && card.desc,
    card && card.pagePath
  ].filter(Boolean).join(" ");
  const m = text.match(/\b(\d{3})\b/);
  if(m) return m[1];
  // 找医生/找专家/换医生/院内转诊 类卡片（转诊已整体下线、标题无三位编号）无法可靠归类 → 返回空码；captureWeappTemplate 据此
  //   早退不保存，避免误落覆盖、破坏既有模板（codex 红线复核·修1/r6）。加同义词 + /i 大小写不敏感（pages/DoctorList 也命中）；位置在 101/105 之前。
  if(/找医生|找专家|换个?医生|院内转诊|转诊|doctor[_-]?list|doctorlist|search|hospital|department/i.test(text)) return "";
  if(/doc_mainpage|doc_id=|吕富靖|周玉春|图文|问诊|医生主页/.test(text)) return "101";
  if(/我的全部服务|全部服务|我的订单|all_service/.test(text)) return "105";
  return "";   // 默认（无法确信归类）→ 空码跳过、不保存，绝不默认落 101 覆盖既有模板（codex r6 定论）
}

function templateCaptureLocked(doctorId, code){
  if(!doctorId || !code) return false;
  const row = db.prepare("SELECT raw_payload FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(Number(doctorId), String(code));
  return !!(row && row.raw_payload);
}

function archiveBusinessGroup(evt, doctorId){
  if(!evt || !evt.isGroup) return null;
  const msgType = evt.isMemberJoin ? "event"
    : (evt.isVoice ? "voice"
    : (evt.isWeapp ? "weapp"
    : (evt.isImage || qiwe.isImageMsgType(evt.msgType) ? "image"
    : (evt.isText ? "text" : "media"))));
  return require("../community").archiveQiweInbound({
    doctorId,
    roomId:evt.fromRoomId,
    senderId:evt.senderId,
    senderName:evt.senderName,
    text:evt.text,
    msgType,
    externalMsgId:evt.externalMsgId,
    rawPayload:evt.raw
  });
}

function captureWeappTemplate(evt, cfg){
  // 按群主诊医生归档模板（多医生）：周群采集不得落到吕的 doctorId。
  const doctorId = resolveEventDoctorId(evt, cfg) || activeDoctorId(cfg);
  if(!doctorId) return { ok:false, error:"doctor_not_found" };

  // 真实群只允许已由 QiWe 同步、且管理员明确选中的业务群进入患者与分诊链路。
  if(evt.isGroup){
    const communityRecord = archiveBusinessGroup(evt, doctorId);
    if(!communityRecord.accepted){
      return { ok:true, skipped:communityRecord.reason || "non_business_group",
        event:{ senderId:evt.senderId, receiverId:evt.receiverId, msgType:evt.msgType, isGroup:true } };
    }
  }
  qiwe.syncWeappTemplatesFromRules(doctorId);
  const card = qiwe.normalizeWeappCard(evt.raw || evt.msgData);
  let pendingCode = takePendingTemplateCode(evt, cfg);
  if(!pendingCode){
    try{
      const coverOps = require("./weapp_cover_ops.js");
      pendingCode = coverOps.takeDbPendingCaptureCode(doctorId, evt, cfg);
    }catch(e){ pendingCode = ""; }
  }
  const code = inferTemplateCode(evt, card, pendingCode);
  // 空码 = 无法可靠归类的卡片（如找医生/院内转诊，转诊已下线）→ 早退不保存；saveWeappTemplate 遇空码会抛错，
  //   更不能落默认 101 覆盖既有 101 模板（codex 红线复核·修1）。
  if(!code) return { ok:true, skipped:"uninferable_code", doctorId };
  // 模板永久锁（甲方 2026-07-03 裁定：已封装的卡片必须改代码才能改）：已有真实 raw_payload 的模板位拒绝任何运行时覆盖——
  // 含「先发编号再发卡」这条托管号覆盖路径（删原 !pendingCode 豁免）。空白模板位（raw_payload 空）仍保留首次学习，
  // 否则 202 all_service 等真卡永远采不进来。rememberPendingTemplateCode/takePendingTemplateCode 保留（首学仍用 pendingCode 归类）。
  if(templateCaptureLocked(doctorId, code)) return { ok:true, skipped:"weapp_template_locked", doctorId, code };
  const saved = qiwe.saveWeappTemplate({
    doctorId,
    code,
    card:evt.raw || evt.msgData,
    rawPayload:evt.raw
  });
  try{ require("./weapp_cover_ops.js").completePendingCapture(doctorId, code); }catch(e){}
  return {
    ok:true,
    skipped:"weapp_template_saved",
    doctorId,
    code,
    title:saved && saved.title,
    ready:!!(saved && saved.ready),
    missing:(saved && saved.missing) || []
  };
}

/* 从「允许原生直达」的 mp 响应反查其所属规则编号（缺陷一修 2026-07-03 夜，确定性 DB 反查、零猜测）：
   按 external.shortLink + title 双相等 与该医生 enabled=1 规则响应精确匹配——同医生多编号常共用同一条主页短链
   （101/102/404/808/909 都挂医生主页 shortLink），只锚 shortLink 会误配到别的编号（模板 title 各不相同），
   加 title 相等才唯一锚定所属规则。无 shortLink / 无 title 的响应不反查（无模板可锚，fail-closed）。
   返回编号按响应顺序去重；查询失败/无命中 → []（回落现状）。 */
function inferResponseCodes(doctorId, responses){
  const anchors = (Array.isArray(responses) ? responses : [])
    .map(r=>({ link:String(((r && r.external) || {}).shortLink || "").trim(), title:String((r && r.title) || "").trim() }))
    .filter(a=>a.link && a.title);
  if(!doctorId || !anchors.length) return [];
  let rows = [];
  try{ rows = db.prepare("SELECT code,responses FROM rules WHERE doctor_id=? AND enabled=1 ORDER BY sort,id").all(doctorId); }catch(e){ rows = []; }
  const parsed = rows.map(row=>{
    let list = [];
    try{ list = JSON.parse(row.responses || "[]"); }catch(e){ list = []; }
    return { code:String(row.code == null ? "" : row.code).trim(), list:Array.isArray(list) ? list : [] };
  });
  const codes = [];
  for(const a of anchors){
    for(const row of parsed){
      if(!row.code || codes.includes(row.code)) continue;
      const hit = row.list.some(x=>x && typeof x === "object"
        && String(((x.external) || {}).shortLink || "").trim() === a.link
        && String(x.title || "").trim() === a.title);
      if(hit) codes.push(row.code);
    }
  }
  return codes;
}

/* 小程序贴片独立读取（主人 2026-08-04）：只按当前主编号读取模板，禁止跨编号复用。 */
function resolveWeappDelivery(doctorId, primaryCode, nativeMiniResponses){
  const t = (doctorId && primaryCode && nativeMiniResponses.length)
    ? qiwe.loadWeappTemplate(doctorId, primaryCode)
    : null;
  const ready = templateNativeWeappAllowed(primaryCode, t);
  return {
    code:primaryCode,
    template:t,
    ready:ready
  };
}

/* 规则响应可声明 weappCode（如 626→626a/626b），用于一次回复连发多张原生小程序卡。
   独立读取口径：无显式 weappCode 时不再按 shortLink 复用其它编号模板。 */
function resolveMultiWeappCodes(doctorId, nativeMiniResponses){
  const out = [];
  const seen = new Set();
  const push = code=>{
    const c = String(code || "").trim();
    if(!c || seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  for(const r of (Array.isArray(nativeMiniResponses) ? nativeMiniResponses : [])){
    const explicit = String((r && (r.weappCode || r.templateCode)) || "").trim();
    if(explicit){ push(explicit); continue; }
  }
  return out;
}

/* 可发送模板：不强制 code 落在 rules 表（支持 626a/626b 等辅助码）。 */
function loadSendableWeappTemplate(doctorId, code){
  const tpl = qiwe.loadWeappTemplate(doctorId, code);
  if(tpl && tpl.ready && templateNativeWeappAllowed(code, tpl)) return tpl;
  const viaRule = codeNativeWeappAllowed(doctorId, code) ? tpl : null;
  if(viaRule && viaRule.ready && templateNativeWeappAllowed(code, viaRule)) return viaRule;
  throw new Error("欢迎卡模板未就绪：" + code);
}

function filterSendableWeappCodes(doctorId, codes){
  const out = [];
  const seen = new Set();
  for(const raw of (Array.isArray(codes) ? codes : [])){
    const c = String(raw || "").trim() === "联络表" ? "979" : String(raw || "").trim();
    if(!c || seen.has(c)) continue;
    try{
      loadSendableWeappTemplate(doctorId, c);
      seen.add(c);
      out.push(c);
    }catch(e){ /* 未采集就绪：不进 weapp 队列，改走链接卡兜底 */ }
  }
  return out;
}

function shortLinkForWeappCode(responses, code){
  const key = String(code || "").trim();
  for(const r of (Array.isArray(responses) ? responses : [])){
    if(!r || (r.type !== "mp" && r.type !== "mini_program")) continue;
    if(String(r.weappCode || r.templateCode || "").trim() === key){
      return String((r.external && r.external.shortLink) || r.shortLink || "").trim();
    }
  }
  return "";
}


const WELCOME_WEAPP_CODES = ["979", "808"];

function welcomeWeappPayload(){
  return WELCOME_WEAPP_CODES.slice();
}

/* 医生 content.welcomeVideo → 入群链接卡。无配置 / pagePath 非法 / PUBLIC_ORIGIN 空 → null（下游保持原小程序欢迎卡）。 */
function welcomeVideoLinkCard(doctorId){
  try{
    const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(+doctorId);
    const content = JSON.parse((row && row.content) || "{}");
    const wv = content && content.welcomeVideo;
    if(!wv || typeof wv !== "object") return null;
    const pagePath = cleanText(wv.pagePath || "", 240);
    if(!pagePath || !/^\//.test(pagePath)) return null;
    const url = httpUrl(resolveLinkUrl(pagePath));
    if(!url) return null;
    const iconRaw = cleanText(wv.iconUrl || "", 500);
    return {
      title: cleanText(wv.cardTitle || "医生视频问候", 120),
      desc: cleanText(wv.cardDesc || "点击观看", 240),
      iconUrl: encodeUrlForWechatFetch(iconRaw || defaultLinkIconUrl()),
      linkUrl: url
    };
  }catch(e){ return null; }
}

function loadWelcomeWeappTemplate(doctorId, code){
  const tplCandidate = codeNativeWeappAllowed(doctorId, code) ? qiwe.loadWeappTemplate(doctorId, code) : null;
  const tpl = templateNativeWeappAllowed(code, tplCandidate) ? tplCandidate : null;
  if(!tpl || !tpl.ready) throw new Error("欢迎卡模板未就绪：" + code);
  return tpl;
}

async function sendWelcomeWeappCards(toId, doctorId, cfg){
  const sentCards = [], cardErrors = [];
  for(const code of WELCOME_WEAPP_CODES){
    try{
      const tpl = loadWelcomeWeappTemplate(doctorId, code);
      const r = await qiwe.sendWeapp(toId, tpl, cfg);
      if(!weappSendConfirmed(r)) throw new Error("weapp 回执未确认真发（isSendSuccess 假）");
      sentCards.push({ code:tpl.code, title:tpl.title });
    }catch(e){
      cardErrors.push({ code, error:(e && e.message) || "发送失败" });
    }
  }
  return { sentCards, cardErrors };
}

/* 给患者的入群欢迎话术：与运营配置同源（welcome.resolveWelcomeText）。
   零病情、零 LLM——安全等级同 keyword_rule。文案只认运营配置，不再读群 welcome_text。 */

module.exports = {
  replyCode, nativeWeappAllowedResponse, nativeWeappResponses,
  linkCardFromResponse, linkCards, enrichLinkCardsWithTemplateThumb, weappRuleLinkUrls, weappSendConfirmed,
  isChunyuH5WebviewHostAllowed, extractH5WebviewEmbeddedUrl,
  codeNativeWeappAllowed, templateNativeWeappAllowed,
  replyAutoSendable, agentReplyShouldAutoDeliver,
  captureKey, knownWeappCode, rememberPendingTemplateCode, primePendingTemplateCode, takePendingTemplateCode,
  inferTemplateCode, templateCaptureLocked, captureWeappTemplate,
  inferResponseCodes, resolveWeappDelivery, resolveMultiWeappCodes, loadSendableWeappTemplate, filterSendableWeappCodes, shortLinkForWeappCode,
  archiveBusinessGroup,
  WELCOME_WEAPP_CODES, welcomeWeappPayload, welcomeVideoLinkCard, loadWelcomeWeappTemplate, sendWelcomeWeappCards,
  welcomeCodeFallbackLinkCards, welcomeCodeFallbackTexts
};
