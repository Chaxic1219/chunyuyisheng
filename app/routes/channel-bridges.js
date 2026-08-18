"use strict";

/**
 * 企微 / QiWe 通道回调与凭证路由（从 server.js 迁出）。
 */
function registerChannelBridgeRoutes(route, ctx){
  const {
    parseBody, json, gate, requireAdminAction, send, readRaw,
    db, wecom, qiwe, qiweBridge, community, patientReply, authz,
    QIWE_DEMO_SECRET, parseBodyBigIntSafe, MESSAGE_MAX_BODY,
    adminAudit, adminAuditBestEffort, auditRequestId, auditText
  } = ctx;
  const maxBody = MESSAGE_MAX_BODY || (6 * 1024 * 1024);

function wecomDoctorId(cfg){
  if(cfg && cfg.doctorId && db.prepare("SELECT 1 FROM doctors WHERE id=?").get(+cfg.doctorId)) return +cfg.doctorId;
  const d = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  return d ? d.id : null;
}
async function handleWecomMessage(cfg, xml){
  const parsed = wecom.parseInboundXml(xml);
  const doctorId = wecomDoctorId(cfg);
  if(!doctorId) return;
  if(parsed.kind === "text"){
    const inp = parsed.input;
    // 入站只做 enqueue（全 pending），回调里不向企微发任何内容（含固定回执）——始终人工确认，零自动发。
    await community.handleInbound({ doctorId, channelType:"wecom",
      externalGroupId:inp.externalGroupId, externalUserId:inp.externalUserId, senderName:inp.senderName,
      senderRole:"patient", text:inp.text, externalMsgId:inp.externalMsgId, rawPayload:inp.rawPayload });
  }else if(parsed.kind === "kf_event"){
    console.log("[wecom] 微信客服事件，待 sync_msg 拉取正文（联调后实现）:", parsed.openKfid);
  }else if(parsed.kind === "media"){
    // TODO 下一步联调：下载素材 → 图片走 mimo-v2.5 多模、语音走 mimo-v2.5-asr 转写 → 进同一管线；
    // 同样不在回调里自动发回执，统一入队列待医助确认。
    console.log("[wecom] 收到媒体消息（", parsed.mediaType, "），待联调入管线；不自动回复。");
  }
}

/* 企业微信回调（无 cookie，靠 msg_signature + AES 校验）。未配置 Token/AESKey → 501，绝不外呼。 */
route("GET", /^\/api\/wecom\/callback$/, (req,res,m,q)=>{
  const cfg = wecom.loadConfig();
  if(!cfg.callbackToken || !cfg.aesKey) return send(res,501,"企业微信回调未配置（缺 Token/EncodingAESKey）","text/plain; charset=utf-8");
  try{ send(res,200, wecom.verifyUrl(cfg, q), "text/plain; charset=utf-8"); }
  catch(e){ send(res,401,"verify failed","text/plain; charset=utf-8"); }
});
route("POST", /^\/api\/wecom\/callback$/, async (req,res,m,q)=>{
  const cfg = wecom.loadConfig();
  if(!cfg.callbackToken || !cfg.aesKey) return send(res,501,"企业微信回调未配置","text/plain; charset=utf-8");
  const raw = await readRaw(req);
  let message = "";
  // 先验签 + AES 解密（确保来源合法），失败 → 回 200 丢弃（不让企微反复重试）。
  try{ message = wecom.decryptCallback(cfg, q, wecom.extractEncrypt(raw)).message; }
  catch(e){ console.error("[wecom] 回调解密失败:", e && e.message); return send(res,200,"","text/plain; charset=utf-8"); }
  // 防重放（仅对验签通过的回调记录 nonce，避免缓存被伪造请求污染）：timestamp 超 ±5min 或 nonce 在窗口内重复 → 丢弃。
  if(!wecom.callbackReplayOk(q)){
    console.error("[wecom] 回调防重放拦截（timestamp 过期或 nonce 重复）:", q && q.timestamp, q && q.nonce);
    return send(res,200,"","text/plain; charset=utf-8");
  }
  send(res,200,"","text/plain; charset=utf-8"); // 5 秒内回 200；回复经 API 异步发，避免企微重试
  handleWecomMessage(cfg, message).catch(e=>console.error("[wecom] 处理消息出错:", e && e.message));
});
route("POST", /^\/api\/admin\/wecom\/config$/, async (req,res)=>{
  const s=gate(req,res); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",null,"仅超级管理员可配置企业微信凭证")) return; // 企业级凭证：非 super（scoped）一律 403
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const before = wecom.loadConfig();
  try{
    const saved = wecom.saveConfig(b);
    adminAudit(req, s, {
      action:"credential.update", resourceType:"credential_config", resourceId:"wecom",
      doctorId:b.doctorId ? +b.doctorId : (before.doctorId || 0),
      before, after:wecom.loadConfig(), meta:{ provider:"wecom" }
    });
    json(res,200,{ ok:true, config:saved });
  }
  catch(e){ json(res,400,{error:e.message}); }
});

// fail-closed：未配 callbackSecret 时不再放行（旧 fail-open 红线#4）；判定逻辑收口到 authz.qiweCallbackAuthorized（可单测）。
// urlToken：从回调 URL 解出的令牌（路径段或 ?t=），令牌即密钥——绝不进任何日志/错误响应（见下方错误边界的 redact）。
function qiweSecretOk(req, cfg, urlToken){
  return authz.qiweCallbackAuthorized(cfg.callbackSecret, req.headers["x-qiwe-secret"], req.headers.authorization, QIWE_DEMO_SECRET, urlToken);
}

function qiwePayloadSummary(body){
  let events = [];
  try{ events = qiwe.extractEvents(body) || []; }catch(e){ events = []; }
  return {
    eventCount: events.length,
    events: events.slice(0, 8).map(evt => ({
      cmd: evt && evt.cmd != null ? Number(evt.cmd) : null,
      msgType: evt && evt.msgType != null ? Number(evt.msgType) : null,
      isGroup: !!(evt && evt.isGroup),
      hasText: !!(evt && evt.text),
      textLen: evt && evt.text ? String(evt.text).length : 0,
      hasWeapp: !!(evt && evt.weapp),
      hasImage: !!(evt && evt.image),
      hasFile: !!(evt && evt.file)
    })),
    truncated: events.length > 8
  };
}

function qiweSendSummary(sendResult){
  if(!sendResult || typeof sendResult !== "object") return null;
  return {
    sent: !!sendResult.sent,
    skipped: sendResult.skipped || "",
    error: sendResult.error || "",
    isSendSuccess: sendResult.isSendSuccess != null ? !!sendResult.isSendSuccess : undefined,
    code: sendResult.code != null ? sendResult.code : undefined,
    message: sendResult.message || sendResult.msg || ""
  };
}

function qiweResultSummary(item){
  if(!item || typeof item !== "object") return { ok:false, error:"invalid_result" };
  const sentParts = Array.isArray(item.sentParts) ? item.sentParts : [];
  const qiweResults = Array.isArray(item.qiweResults) ? item.qiweResults : [];
  return {
    ok: item.ok !== false,
    sent: !!item.sent,
    skipped: item.skipped || "",
    error: item.error || "",
    source: item.source || "",
    sendPolicy: item.sendPolicy || "",
    level: item.level || "",
    dryRun: item.dryRun != null ? !!item.dryRun : undefined,
    hasReply: !!(item.reply || item.replyText || item.replyPreview),
    sentParts: sentParts.length,
    qiweResults: qiweResults.length,
    qiwe: qiweSendSummary(item.qiwe || item.sendResult)
  };
}

/* QiWe 第三方真实账号回调：文本触发患者回复；小程序卡片回调用于采集 sendWeapp 模板。
   URL 令牌通道（qiweapi 推送不带任何鉴权头的适配）：同时匹配
     /api/qiwe/callback、/api/qiwe/callback/<token>（路径段 [A-Za-z0-9_-]{16,128}）、以及 ?t=<token>。
   效果链：qiweapi 控制台保存回调 URL 时先发一次**无鉴权探测 POST**——打到带令牌 URL → 过闸 200 → 控制台能保存
   带路径的 URL；此后每条真实推送的 URL 天然带 token → 过鉴权。头部两通道保留；fail-closed 语义不变。 */
route("POST", /^\/api\/qiwe\/callback(?:\/([A-Za-z0-9_-]{16,128}))?$/, async (req,res,m,q)=>{
  const cfg = qiwe.loadConfig();
  // 大整数 ID 保真解析（真实抓包实锤 2026-07-03）：数字 roomId/senderId 超安全整数会丢精度→白名单失配。用 parseBodyBigIntSafe 在 JSON.parse 前串化 15+ 位数字值。
  //   仅此回调路由改用该解析；oversize/大小上限语义与 parseBody 完全一致，parseBody 本身与其它路由零改动。
  const b = await parseBodyBigIntSafe(req);
  if(b.__oversize) return json(res,200,{ok:false,error:"payload_oversize"});
  const urlToken = (m && m[1]) || (q && q.t) || "";   // 路径段优先，其次 ?t=；两者都没有 → 空串（回退头部通道判定）
  if(!qiweSecretOk(req, cfg, urlToken)) return json(res,403,{error:"QiWe callback secret 不匹配"});
  // 临时诊断·默认关：仅当 QIWE_CAPTURE_RAW=1 时，记录已过鉴权的回调原始报文(body，不含 header 里的 callback_secret)，
  // 用于真机抓 qiweapi「入群/群成员变更」事件的未知 cmd/字段格式——qiweapi 无文档、铁规则不准猜参数，只能抓真实报文；记完即关。
  if(process.env.QIWE_CAPTURE_RAW === "1"){
    try{ console.error("[QIWE_RAW_CAPTURE]", JSON.stringify(qiwePayloadSummary(b))); }
    catch(e){ console.error("[QIWE_RAW_CAPTURE] <unserializable>"); }
  }
  const accepted = qiwe.extractEvents(b).length;
  json(res,200,{ ok:true, accepted });             // 先回 200，避免 QiWe 超 3 秒重试
  qiweBridge.handleCallbackBody(b, cfg).then(r=>{
    const sent = (r.results || []).filter(x=>x && x.sent).length;
    const errors = (r.results || []).filter(x=>x && x.error).length;
    if(sent || errors) console.log("[qiwe] callback", JSON.stringify({ accepted:r.accepted, sent, errors, results:(r.results || []).map(qiweResultSummary) }));
  }).catch(e=>console.error("[qiwe] 处理回调出错:", e && e.message));
});

route("GET", /^\/api\/admin\/qiwe\/config$/, (req,res)=>{
  const s=gate(req,res); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",null,"仅超级管理员可查看 QiWe 凭证配置")) return;
  json(res,200,{ ok:true, config:qiwe.publicConfig() });
});
route("POST", /^\/api\/admin\/qiwe\/config$/, async (req,res)=>{
  const s=gate(req,res); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",null,"仅超级管理员可配置 QiWe 凭证")) return;
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const before = qiwe.loadConfig();
  try{
    // testToId 由回调在托管号入群时自动维护，禁止手工覆盖（避免与自动白名单脱节）。
    delete b.testToId;
    // 禁止通过企微配置改医生本体：忽略前端传来的 doctorId
    delete b.doctorId;
    const saved = qiwe.saveConfig(b);
    let visibility = null;
    try{
      visibility = await require("../qiwe_sync.js").reconcileGroupVisibility();
    }catch(e){
      console.warn("[qiwe] reconcileGroupVisibility after config save:", e && e.message);
    }
    adminAudit(req, s, {
      action:"credential.update", resourceType:"credential_config", resourceId:"qiwe",
      doctorId:saved.doctorId || before.doctorId || 0,
      before, after:qiwe.loadConfig(), meta:{ provider:"qiwe", visibility }
    });
    json(res,200,{ ok:true, config:saved, visibility });
  }
  catch(e){ json(res,400,{error:e.message}); }
});
route("GET", /^\/api\/admin\/qiwe\/cards$/, (req,res,m,q)=>{
  const cfg = qiwe.loadConfig();
  const did = Number(q.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  try{ json(res,200,{ ok:true, doctorId:did, cards:qiwe.publicWeappTemplates(did) }); }
  catch(e){ json(res,400,{error:e.message}); }
});
route("POST", /^\/api\/admin\/qiwe\/preview-reply$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const cfg = qiwe.loadConfig();
  const did = Number(b.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  const wantsSend = b.send === true || b.send === 1 || b.send === "1";
  if(wantsSend && !requireAdminAction(req,res,s,"qiwe.preview_send",{doctorId:did},"仅超级管理员可触发 QiWe 测试发送")) return;
  let sendRequestId = null;
  try{
    const safeTarget = String(cfg.testToId || cfg.selfUserId || "").trim();
    const reply = await patientReply.buildPatientReply({
      doctorId:did,
      text:b.text || "101",
      patientName:b.patientName || "企微测试患者",
      patientKey:"qiwe-preview:" + (safeTarget || "local")
    });
    const deliveryPlan = qiweBridge.prepareDelivery(did, reply, b.patientName || "企微测试患者");
    let sendResult = null;
    if(wantsSend){
      sendRequestId = auditRequestId(req);
      adminAudit(req, s, {
        action:"qiwe.preview_send", resourceType:"qiwe_preview", resourceId:String(did), doctorId:did,
        channel:"qiwe", outcome:"requested", requestId:sendRequestId,
        meta:{ target:"configured_test_target", text:auditText(b.text || "101", 120), hasMiniProgram:deliveryPlan.hasMiniProgram }
      });
      if(!safeTarget){
        adminAuditBestEffort(req, s, {
          action:"qiwe.preview_send", resourceType:"qiwe_preview", resourceId:String(did), doctorId:did,
          channel:"qiwe", outcome:"failed", reason:"未配置 QiWe 测试发送目标", requestId:sendRequestId,
          meta:{ target:"missing" }
        });
        return json(res,400,{error:"未配置 QiWe 测试发送目标"});
      }
      sendResult = await qiweBridge.deliverReplyToQiwe({
        cfg,
        doctorId:did,
        reply,
        toId:safeTarget,
        patientName:b.patientName || "企微测试患者"
      });
      adminAuditBestEffort(req, s, {
        action:"qiwe.preview_send", resourceType:"qiwe_preview", resourceId:String(did), doctorId:did,
        channel:"qiwe", outcome:(sendResult && sendResult.sent) ? "success" : "failed",
        reason:(sendResult && sendResult.sent) ? "" : "QiWe 测试发送未发出",
        requestId:sendRequestId, after:{ sent:!!(sendResult && sendResult.sent) },
        meta:{ hasMiniProgram:deliveryPlan.hasMiniProgram, externalMsgId:sendResult && sendResult.externalMsgId ? "configured" : "" }
      });
    }
    json(res,200,{
      ok:true,
      doctorId:did,
      reply,
      replyText:deliveryPlan.replyText,
      weapp:deliveryPlan.weappPublic,
      hasMiniProgram:deliveryPlan.hasMiniProgram,
      sent:!!(sendResult && sendResult.sent),
      sendResult
    });
  }catch(e){
    if(wantsSend && sendRequestId){
      adminAuditBestEffort(req, s, {
        action:"qiwe.preview_send", resourceType:"qiwe_preview", resourceId:String(did), doctorId:did,
        channel:"qiwe", outcome:"failed", reason:e.message || "发送失败", requestId:sendRequestId
      });
    }
    json(res,400,{error:e.message});
  }
});
route("GET", /^\/api\/admin\/qiwe\/cover-templates$/, (req,res,m,q)=>{
  const cfg = qiwe.loadConfig();
  const did = Number(q.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",{doctorId:did},"仅超级管理员可管理小程序封面")) return;
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    json(res,200,{ ok:true, doctorId:did, templates:coverOps.listCoverTemplates(did) });
  }catch(e){ json(res,400,{error:e.message}); }
});
route("GET", /^\/api\/admin\/qiwe\/cover-recapture\/status$/, (req,res,m,q)=>{
  const cfg = qiwe.loadConfig();
  const did = Number(q.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const code = String(q.code || "").trim();
  const s=gate(req,res,did); if(!s)return;
  if(!code) return json(res,400,{error:"缺少 code"});
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    json(res,200,{ ok:true, ...coverOps.recaptureStatus(did, code) });
  }catch(e){ json(res,400,{error:e.message}); }
});
route("POST", /^\/api\/admin\/qiwe\/cover-recapture\/prepare$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const cfg = qiwe.loadConfig();
  const did = Number(b.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",{doctorId:did},"仅超级管理员可更新小程序封面")) return;
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    const result = await coverOps.prepareRecapture({
      doctorId: did,
      code: b.code,
      syncSiblings: b.syncSiblings !== false,
      // 真机采样禁止自动群发；编号/卡片由运营手动发送
      autoSendCode: false,
      startedBy: s.username || s.name || "admin"
    });
    adminAudit(req, s, {
      action:"qiwe.cover_recapture_prepare", resourceType:"qiwe_weapp_template", resourceId:String(b.code || ""),
      doctorId:did, after:{ code:b.code, unlocked:result.unlockedCodes }
    });
    json(res,200,result);
  }catch(e){ json(res,400,{error:e.message}); }
});
route("POST", /^\/api\/admin\/qiwe\/cover-recapture\/cancel$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const cfg = qiwe.loadConfig();
  const did = Number(b.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",{doctorId:did},"仅超级管理员可取消封面采集")) return;
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    const changes = coverOps.cancelRecapture(did, b.code);
    json(res,200,{ ok:true, doctorId:did, code:String(b.code || ""), cancelled:changes });
  }catch(e){ json(res,400,{error:e.message}); }
});
route("POST", /^\/api\/admin\/qiwe\/cover-copy$/, async (req,res)=>{
  const b = await parseBody(req);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 1MB）"});
  const cfg = qiwe.loadConfig();
  const did = Number(b.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",{doctorId:did},"仅超级管理员可编辑贴片文案")) return;
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    const result = coverOps.updateCardCopy({
      doctorId: did,
      code: b.code,
      title: b.title,
      desc: b.desc
    });
    adminAudit(req, s, {
      action:"qiwe.cover_copy_update", resourceType:"qiwe_weapp_template", resourceId:String(b.code || ""),
      doctorId:did, after:{ title:result.title, desc:result.desc }
    });
    json(res,200,result);
  }catch(e){ json(res,400,{error:e.message}); }
});
route("POST", /^\/api\/admin\/qiwe\/cover-custom-upload$/, async (req,res)=>{
  const b = await parseBody(req, maxBody);
  if(b.__oversize) return json(res,413,{error:"请求体过大（上限 6MB）"});
  const cfg = qiwe.loadConfig();
  const did = Number(b.doctorId || cfg.doctorId || qiweBridge.activeDoctorId(cfg));
  const s=gate(req,res,did); if(!s)return;
  if(!requireAdminAction(req,res,s,"credential.manage",{doctorId:did},"仅超级管理员可上传自定义封面")) return;
  try{
    const coverOps = require("../modules/qiwe/weapp_cover_ops.js");
    const result = await coverOps.applyCustomCover({
      doctorId: did,
      code: b.code,
      imageDataUrl: b.imageDataUrl,
      syncSiblings: b.syncSiblings !== false,
      startedBy: s.username || s.name || "admin"
    });
    adminAudit(req, s, {
      action:"qiwe.cover_custom_upload", resourceType:"qiwe_weapp_template", resourceId:String(b.code || ""),
      doctorId:did, after:{ synced:result.syncedCodes, ready:result.ready, size:result.coverFileSize }
    });
    json(res,200,result);
  }catch(e){ json(res,400,{error:e.message}); }
});


}

module.exports = { registerChannelBridgeRoutes };
