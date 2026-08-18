/* QiWe 单聊桥离线自测：
   DB_PATH=./_qiwetest.db QIWE_DRY_RUN=1 node _qiwetest.js */
process.env.QIWE_DRY_RUN = "1";
// 真离线锁(2026-07-09)：本文件为「离线自测」，须确定性走本地模板，不受本机真实模型 key 影响。
//   清模型 key + 强制 TRIAGE_AI_DISABLED，保证带不带 key 都不真调 MiMo/DeepSeek（否则裸数字/自由文本会被活模型非确定性映射）。
//   下方各低危 LLM/意图 stub 段仍各自 save→override(delete TAD + 设 stub key + stub fetch)→restore，不受本锁影响、还原后回到锁定态。
delete process.env.MIMO_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
process.env.TRIAGE_AI_DISABLED = "1";

const qiwe = require("./qiwe.js");
const bridge = require("./qiwe_bridge.js");
const community = require("./community.js");
const triage = require("./triage.js");
const { db, resolvePatient, applySeedPatches } = require("./db.js");
const qiweShared = require("./modules/qiwe/shared.js");
const messagesAdmin = require("./routes/messages-admin.js");
// server.js 的大整数 ID 保真纯函数（require.main 守卫下 require 不触发 listen）：qiwe 回调数字 roomId/senderId 超安全整数保精度。
const { preserveBigIntIds } = require("./server.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗", m); } else console.log("  ✓", m); };
function publishScriptsConfig(doctorId, cfg){
  const text = JSON.stringify(cfg || {}, null, 2);
  const t = new Date().toISOString();
  db.prepare(`INSERT INTO ops_configs(doctor_id,domain,title,scope,draft_json,published_json,published_version,status,updated_by,updated_at,published_by,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(doctor_id,domain) DO UPDATE SET
      draft_json=excluded.draft_json,
      published_json=excluded.published_json,
      published_version=ops_configs.published_version+1,
      status='published',
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      published_by=excluded.published_by,
      published_at=excluded.published_at`)
    .run(doctorId, "scripts", "固定话术", "doctor", text, text, 1, "published", "qiwetest", t, "qiwetest", t);
}

(async ()=>{
  const active = db.prepare("SELECT id,name FROM doctors WHERE active=1 ORDER BY id LIMIT 1").get()
    || db.prepare("SELECT id,name FROM doctors ORDER BY id LIMIT 1").get();
  const cfg = qiwe.saveConfig({
    doctorId:active && active.id,
    token:"test-token-123456",
    guid:"test-guid-123456",
    selfUserId:"self-user-1",
    testToId:"self-user-1",
    enabled:true,
    autoSend:true,
    allowGroup:false,
    note:"offline qiwe test"
  });
  ok(cfg.configured && cfg.enabled && cfg.autoSend && cfg.dryRun, "保存并读取 QiWe 配置（脱敏 + DRY_RUN）");
  const linkProbe = await qiwe.sendLink("self-user-1", {
    title:"住院办理流程",
    desc:"北京友谊医院官网",
    iconUrl:"https://yht.chunyutianxia.com/assets/chunyu-doctor-icon.png",
    linkUrl:"https://www.bfh.com.cn/Html/News/Articles/5419.html"
  });
  const lp = linkProbe && linkProbe.data && linkProbe.data.params;
  ok(linkProbe && linkProbe.data && linkProbe.data.method === "/msg/sendLink"
    && lp && lp.guid === "test-guid-123456" && lp.toId === "self-user-1"
    && lp.title === "住院办理流程" && lp.linkUrl === "https://www.bfh.com.cn/Html/News/Articles/5419.html"
    && lp.iconUrl.indexOf("/assets/chunyu-doctor-icon.png") > -1,
    "sendLink：公众号/网页文章卡片 payload 使用 /msg/sendLink + title/iconUrl/linkUrl/desc");
  // 616 型 reply（贴近真实：文本正文 + 一张绝对外链卡）。含文本正文 → 修改①「有卡片就不发文本链接」下 replyText 保留正文、
  //   仅省略成卡的链接行；便于验证「文本主体照发 + 卡失败不中断」。
  const linkReply = { code:"616", source:"keyword_rule", responses:[{
    type:"text",
    text:"检查、住院前后需要准备的事项整理在这里，具体仍以医生和护士当面交代为准👇"
  }, {
    type:"link",
    title:"住院办理流程",
    source:"北京友谊医院官网",
    external:{ provider:"北京友谊医院官网", url:"https://www.bfh.com.cn/Html/News/Articles/5419.html" }
  }] };
  const linkPlan = bridge.prepareDelivery(active.id, linkReply, "测试患者");
  ok(linkPlan.linkCards && linkPlan.linkCards.length === 1 && linkPlan.linkCards[0].linkUrl.indexOf("bfh.com.cn") > -1,
    "prepareDelivery：有真实 URL 的 link 响应生成链接/文章卡片");
  // ①有卡片就不发文本链接（甲方 2026-07-03·616 场景去重）：616 型 reply（文本正文 + 绝对外链卡）→ replyText 保留正文、不再含 bfh URL 行（成卡的链接整条省略）；linkCards 仍含该卡。
  ok(linkPlan.replyText.indexOf("整理在这里") > -1 && !/bfh\.com\.cn/.test(linkPlan.replyText) && !/住院办理流程/.test(linkPlan.replyText),
    "①去重：616 有卡则文本不含该链接卡的 URL/标题行（成卡响应整条省略），文本正文照留");
  ok(linkPlan.linkCards.length === 1 && /bfh\.com\.cn/.test(linkPlan.linkCards[0].linkUrl),
    "①去重：链接改由 payload.linkCards 承载（同一链接只发一次·卡片，不再文本重复）");
  // ①反例（codex 2026-07-03）：某编号回复只有可成卡 link 响应、无正文 text → omitLinkCards 把文本整条省略 → replyText 空。
  //   修前 processEvent 的 empty_reply 早退（只看 replyText/weappReady 未纳入 linkCards）会让卡既不自动发也不落 pending（去重丢链接）。
  //   端到端回归：临时注册只含一条绝对 http link 响应的编号规则 → patient-1 发该编号触发 processEvent，验证两分支都不丢卡。测完删规则。
  const LINKONLY_CODE = "zlinkonly";
  const LINKONLY_URL = "https://www.bfh.com.cn/Html/News/Articles/9999.html";
  db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, LINKONLY_CODE);   // 清残留（幂等）
  db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,1,999)").run(
    active.id, LINKONLY_CODE, JSON.stringify([LINKONLY_CODE]), "exact", "测试医助",
    JSON.stringify([{ type:"link", title:"纯链接卡（无正文）", source:"测试", external:{ provider:"测试", url:LINKONLY_URL } }])
  );
  const savedOriginLO = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = "https://demo.example.com";   // 设 origin（绝对 http 卡本就成卡，此处对齐反例前提）
  const loEvt = base=>({ data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-linkonly-"+base+"-"+Date.now(), msgData:{ content:LINKONLY_CODE } }] });
  // ① autoSend ON：不得 empty_reply 早退，sentParts 含 link_card（keyword_rule 源 → replyAutoSendable=true → deliverReplyToQiwe 发卡）
  const loAutoCfg = qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });
  const loAuto = (await bridge.handleCallbackBody(loEvt("auto"), loAutoCfg)).results[0] || {};
  ok(loAuto.skipped !== "empty_reply" && loAuto.sent === true && (loAuto.sentParts || []).some(p=>p.type === "link_card" && /9999\.html/.test(p.linkUrl || "")),
    "①反例(autoSend ON)：只有 link 无正文的回复不再 empty_reply 早退，autoSend 经 deliverReplyToQiwe 发出 link_card（去重不丢链接）");
  // ② autoSend OFF：落 pending 且 payload.linkCards 非空 → deliverOutbox 该行 → sent 且 sentParts 含 link_card
  const loPendCfg = qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:false, allowGroup:false });
  const loPend = (await bridge.handleCallbackBody(loEvt("pend"), loPendCfg)).results[0] || {};
  ok(loPend.skipped !== "empty_reply" && loPend.reviewOnly === true && loPend.outboxId,
    "①反例(autoSend OFF)：只有 link 无正文的回复不再 empty_reply 早退，落 pending 草稿（去重不丢链接）");
  const loRow = db.prepare("SELECT text,payload FROM outbound_queue WHERE id=?").get(loPend.outboxId);
  const loPayload = JSON.parse(loRow.payload || "{}");
  ok(loPayload.qiwe && Array.isArray(loPayload.qiwe.linkCards) && loPayload.qiwe.linkCards.some(c=>/9999\.html/.test(c.linkUrl || "")),
    "①反例(autoSend OFF)：pending 草稿 payload.qiwe.linkCards 含该链接卡（draftText 文本可空、链接靠 linkCards 承载）");
  const loDeliver = await bridge.deliverOutbox({ doctor_id:active.id, text:loRow.text, payload:loRow.payload }, qiwe.loadConfig());
  ok(loDeliver.sent === true && (loDeliver.sentParts || []).some(p=>p.type === "link_card" && /9999\.html/.test(p.linkUrl || "")),
    "①反例(autoSend OFF)：deliverOutbox 发出该 pending 行 → sent 且 sentParts 含 link_card（医助确认发送不丢卡）");
  // 复原：删临时规则、恢复 PUBLIC_ORIGIN 与 autoSend 配置（不污染后续用例）
  db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, LINKONLY_CODE);
  if(savedOriginLO === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = savedOriginLO;
  qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });

  // ①反例2（codex 2026-07-03）：mp 响应带 external.url（如春雨问卷 webLink）既被 linkCardFromResponse 认成卡（进 payload.linkCards），
  //   又进 mpFallbackText —— deliverOutbox 无就绪原生模板时发 fallbackText + 又发同 URL link_card → 文本+卡片重复。
  //   修：mpFallbackText 生成加 omitLinkCards:true（成卡响应从 fallback 文本整条省略）。端到端回归：临时注册「mp 带 url 无 shortLink」编号规则（保证无就绪原生模板）。
  const MPURL_CODE = "zmpurl";
  const MPURL_URL = "https://www.chunyuyisheng.com/rec/mpurl8888";
  db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, MPURL_CODE);   // 清残留（幂等）
  db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").run(active.id, MPURL_CODE);   // 确保无就绪原生模板
  db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,1,998)").run(
    active.id, MPURL_CODE, JSON.stringify([MPURL_CODE]), "exact", "测试医助",
    // mp 带 external.url 无 shortLink：miniProgramResponse(type mp)→进 mpFallbackText；linkCardFromResponse 认 ext.url→进 linkCards；无 shortLink→无就绪原生模板
    JSON.stringify([
      { type:"text", text:"请填写下方问卷👇" },
      { type:"mp", title:"春雨问卷入口", sub:"在线问卷", page:"admission", external:{ provider:"春雨医生", label:"问卷", service:"问卷", url:MPURL_URL } }
    ])
  );
  const mpPendCfg = qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:false, allowGroup:false });
  const mpPend = (await bridge.handleCallbackBody({ data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-mpurl-pend-"+Date.now(), msgData:{ content:MPURL_CODE } }] }, mpPendCfg)).results[0] || {};
  ok(mpPend.reviewOnly === true && mpPend.outboxId, "①反例2(autoSend OFF)：mp 带 url 的回复落 pending 草稿");
  const mpRow = db.prepare("SELECT text,payload FROM outbound_queue WHERE id=?").get(mpPend.outboxId);
  const mpPayload = JSON.parse(mpRow.payload || "{}");
  ok(mpPayload.qiwe && Array.isArray(mpPayload.qiwe.linkCards) && mpPayload.qiwe.linkCards.some(c=>/mpurl8888/.test(c.linkUrl || "")),
    "①反例2(autoSend OFF)：pending payload.qiwe.linkCards 含该 url 卡（mp 带 url 被认成卡）");
  ok(!/mpurl8888/.test(mpPayload.qiwe.mpFallbackText || ""),
    "①反例2(autoSend OFF)·核心：mpFallbackText 不含该 url（omitLinkCards 省略成卡响应，deliverOutbox 不会文本+卡片重复发）");
  const mpDeliver = await bridge.deliverOutbox({ doctor_id:active.id, text:mpRow.text, payload:mpRow.payload }, qiwe.loadConfig());
  const mpUrlLinkCards = (mpDeliver.sentParts || []).filter(p=>p.type === "link_card" && /mpurl8888/.test(p.linkUrl || ""));
  const mpUrlTextFallbacks = (mpDeliver.sentParts || []).filter(p=>p.type === "text_fallback" && /mpurl8888/.test(p.preview || ""));
  ok(mpDeliver.sent === true && mpUrlLinkCards.length === 1 && mpUrlTextFallbacks.length === 0,
    "①反例2(autoSend OFF)：deliverOutbox 发出 → 该 url 只发 1 张 link_card、无同 url 的 text_fallback 重复（去重生效）");
  // 复原
  db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, MPURL_CODE);
  db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").run(active.id, MPURL_CODE);
  qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });
  // ①反例2·不成卡保留（fail-closed 正向覆盖）：omitLinkCards 只省略「会成卡」的响应——纯 mp 响应无 url/无 shortLink 不成卡 → fallback 文本保留其标题。
  //   （深链无 PUBLIC_ORIGIN 不成卡→文本保留 已由上文深链段断言覆盖；此处对 mpFallbackText 侧的 miniProgramResponses 补一条正向对照，证明去重不误伤不成卡响应。）
  const mpNoUrlText = require("./patient_reply.js").responsesToQiweText({ responses:[{ type:"mp", title:"纯本地表单入口", page:"admission" }] }, "测试患者", { omitLinkCards:true });
  ok(/纯本地表单入口/.test(mpNoUrlText),
    "①反例2·不成卡保留：无 url/无 shortLink 的纯 mp 响应不成卡 → omitLinkCards 不省略其 fallback 文本（去重不误伤、链接不丢）");

  const questionnaireReply = { code:"414", source:"keyword_rule", responses:[{
    type:"mp",
    title:"住院预约",
    sub:"问卷收集 · 运营/医助跟进",
    page:"admission",
    external:{ provider:"春雨医生", label:"住院预约问卷", service:"住院预约问卷", url:"https://www.chunyuyisheng.com/rec/j1dwloa3ht" }
  }, {
    type:"mp",
    title:"开放平台说明",
    external:{ docUrl:"https://www.chunyuyisheng.com/cooperation/open_api/interface/graph/" }
  }] };
  const questionnairePlan = bridge.prepareDelivery(active.id, questionnaireReply, "测试患者");
  ok(questionnairePlan.linkCards && questionnairePlan.linkCards.length === 1
    && questionnairePlan.linkCards[0].title === "住院预约"
    && questionnairePlan.linkCards[0].linkUrl === "https://www.chunyuyisheng.com/rec/j1dwloa3ht",
    "prepareDelivery：问卷 external.url 也生成链接卡，docUrl 接口说明不误发");
  const linkAuto = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:linkReply, toId:"self-user-1", patientName:"测试患者" });
  ok((linkAuto.sentParts || []).some(p=>p.type === "link_card" && p.title === "住院办理流程"),
    "deliverReplyToQiwe：自动/预览路径会发送链接/文章卡片");
  const linkOut = await bridge.deliverOutbox({ doctor_id:active.id, text:"住院资料请查看下方卡片", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", linkCards:linkPlan.linkCards } }) }, qiwe.loadConfig());
  ok((linkOut.sentParts || []).some(p=>p.type === "link_card" && /bfh\.com\.cn/.test(p.linkUrl || "")),
    "deliverOutbox：医助确认发送路径会发送链接/文章卡片");
  // 甲方 2026-07-08：企微端偶发卡片展示早于文字。发送层必须在正文成功发出后延迟，再发富媒体。
  // 生产默认 3000ms；离线测试用小值覆盖，验证顺序与实际等待，不让全量自测变慢。
  const prevRichDelay = process.env.QIWE_TEXT_BEFORE_RICH_DELAY_MS;
  process.env.QIWE_TEXT_BEFORE_RICH_DELAY_MS = "35";
  const delayStartAuto = Date.now();
  const delayAuto = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:linkReply, toId:"self-user-1", patientName:"测试患者" });
  const delayElapsedAuto = Date.now() - delayStartAuto;
  ok(delayElapsedAuto >= 25
    && delayAuto.textBeforeRichDelayMs === 35
    && (delayAuto.sentParts || [])[0] && delayAuto.sentParts[0].type === "text"
    && (delayAuto.sentParts || []).some(p=>p.type === "link_card"),
    "发送顺序：自动发送路径先发文本，延迟后再发链接卡片（避免企微端卡片抢先展示）");
  const delayStartOut = Date.now();
  const delayOut = await bridge.deliverOutbox({ doctor_id:active.id, text:"住院资料请查看下方卡片", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", linkCards:linkPlan.linkCards } }) }, qiwe.loadConfig());
  const delayElapsedOut = Date.now() - delayStartOut;
  ok(delayElapsedOut >= 25
    && delayOut.textBeforeRichDelayMs === 35
    && (delayOut.sentParts || [])[0] && delayOut.sentParts[0].type === "text"
    && (delayOut.sentParts || []).some(p=>p.type === "link_card"),
    "发送顺序：人工确认路径先发文本，延迟后再发链接卡片（医助后台同修）");
  if(prevRichDelay === undefined) delete process.env.QIWE_TEXT_BEFORE_RICH_DELAY_MS; else process.env.QIWE_TEXT_BEFORE_RICH_DELAY_MS = prevRichDelay;

  // 去硬编码域名（可移植纪律）：defaultLinkIconUrl 不再硬编码域名，仅从 env 注入。
  // 无 defaultLinkIconUrl 导出，故经 prepareDelivery 的 iconUrl 间接验证——用 external 不带 iconUrl 的 link 响应，
  // iconUrl 完全来自 defaultLinkIconUrl 的回退。
  const noIconReply = { code:"616", source:"keyword_rule", responses:[{
    type:"link",
    title:"住院办理流程",
    external:{ provider:"北京友谊医院官网", url:"https://www.bfh.com.cn/Html/News/Articles/5419.html" }
  }] };
  const savedOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = "https://demo.example.com";
  const originPlan = bridge.prepareDelivery(active.id, noIconReply, "测试患者");
  ok(originPlan.linkCards && originPlan.linkCards.length === 1
    && originPlan.linkCards[0].iconUrl === "https://demo.example.com/assets/chunyu-doctor-icon.png",
    "defaultLinkIconUrl：设 PUBLIC_ORIGIN 后 iconUrl 用注入域名（显式 env，不再硬编码）");
  delete process.env.PUBLIC_ORIGIN;
  const noOriginPlan = bridge.prepareDelivery(active.id, noIconReply, "测试患者");
  ok(noOriginPlan.linkCards && noOriginPlan.linkCards.length === 1
    && noOriginPlan.linkCards[0].iconUrl === ""
    && /bfh\.com\.cn/.test(noOriginPlan.linkCards[0].linkUrl),
    "defaultLinkIconUrl：无 env → iconUrl 空串，卡片仍构造不丢（空 icon 不丢卡）");
  if(savedOrigin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = savedOrigin;

  // 域名深链承接（甲方 2026-07-03）：seed 深链卡 linkUrl 存相对路径 /?p=<key>（不硬编码域名）。
  //   发送侧 fail-closed：设 PUBLIC_ORIGIN → linkCard 补全为绝对 https；无 PUBLIC_ORIGIN → 该卡跳过（绝不发相对死链），文本主体照发。
  const { responsesToQiweText } = require("./patient_reply.js");
  const deepReply = { code:"414", source:"keyword_rule", responses:[
    { type:"text", text:"如需住院治疗，请点击下方在线提交住院预约👇" },
    { type:"link", title:"住院预约（在线填写）", desc:"打开服务页在线提交住院预约", linkUrl:"/?p=admission", fallbackPage:"admission", deepLink:true }
  ] };
  const savedOrigin2 = process.env.PUBLIC_ORIGIN;
  // (a) 设 PUBLIC_ORIGIN → 深链卡补全为绝对 https
  process.env.PUBLIC_ORIGIN = "https://demo.example.com";
  const deepPlan = bridge.prepareDelivery(active.id, deepReply, "测试患者");
  ok(deepPlan.linkCards && deepPlan.linkCards.length === 1
    && deepPlan.linkCards[0].linkUrl === "https://demo.example.com/?p=admission",
    "深链(有 PUBLIC_ORIGIN)：相对 /?p=admission 补全为绝对 https 链接卡");
  // ①去重（有 PUBLIC_ORIGIN）：深链补全后成卡 → prepareDelivery.replyText 里该卡整条省略、只留文本正文（链接改由 linkCards 承载，不文本重复）。
  ok(deepPlan.replyText.indexOf("如需住院治疗") > -1
    && !/\/\?p=admission/.test(deepPlan.replyText)
    && !/demo\.example\.com/.test(deepPlan.replyText),
    "①去重(有 PUBLIC_ORIGIN)：深链成卡 → replyText 省略该链接行、只留正文（链接由 linkCards 发，不重复）");
  // (a2) 文本侧补全能力仍在：responsesToQiweText 不传 omitLinkCards 时深链行照补全为绝对 https（证明去重是 opt-in、能力不丢）。
  ok(/https:\/\/demo\.example\.com\/\?p=admission/.test(responsesToQiweText(deepReply, "测试患者", {})),
    "深链(有 PUBLIC_ORIGIN)：不传 omitLinkCards 时文本行内相对深链补全为绝对 https（去重为 opt-in）");
  // (a3) deliverReplyToQiwe 真发路径（DRY_RUN）会发出补全后的深链卡
  const deepAuto = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:deepReply, toId:"self-user-1", patientName:"测试患者" });
  ok((deepAuto.sentParts || []).some(p=>p.type === "link_card" && p.linkUrl === "https://demo.example.com/?p=admission"),
    "深链(有 PUBLIC_ORIGIN)：deliverReplyToQiwe 发出补全后的深链链接卡");
  // (b) 无 PUBLIC_ORIGIN → 该深链卡跳过（linkCards 空），文本主体照发（fail-closed，不发相对死链）
  delete process.env.PUBLIC_ORIGIN;
  const deepPlanNo = bridge.prepareDelivery(active.id, deepReply, "测试患者");
  ok((deepPlanNo.linkCards || []).length === 0, "深链(无 PUBLIC_ORIGIN)：相对深链卡跳过、不发（linkCards 空，绝不发相对死链）");
  ok(deepPlanNo.replyText && deepPlanNo.replyText.indexOf("住院预约") > -1
    && !/\/\?p=admission/.test(deepPlanNo.replyText),
    "深链(无 PUBLIC_ORIGIN)：文本主体照发（含标题/正文），文本行内不输出相对深链（fail-closed）");
  // ①去重(无 PUBLIC_ORIGIN)·fail-closed 对齐：origin 空 → 深链不成卡（willBecomeLinkCard=false）→ omitLinkCards 不省略该响应
  //   → 其标题行（「在线填写」）仍在文本里（链接不丢：卡发不出时改由文本标题行承载）。两侧口径对齐（linkCards 空 ↔ 文本保留）。
  ok(/在线填写/.test(deepPlanNo.replyText),
    "①去重(无 PUBLIC_ORIGIN)：深链不成卡 → 该响应文本行保留（omitLinkCards 不省略未成卡响应，链接不丢·fail-closed 两侧对齐）");
  const deepAutoNo = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:deepReply, toId:"self-user-1", patientName:"测试患者" });
  ok(deepAutoNo.sent === true
    && (deepAutoNo.sentParts || []).some(p=>p.type === "text")
    && !(deepAutoNo.sentParts || []).some(p=>p.type === "link_card"),
    "深链(无 PUBLIC_ORIGIN)：deliverReplyToQiwe 只发文本、不发深链卡（文本主体不受影响）");
  if(savedOrigin2 === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = savedOrigin2;

  // sendLink 抛错不中断（deliverOutbox）：payload 手工塞一张非法卡片（linkUrl 非 http）触发 qiwe.sendLink 参数校验抛错，
  // 验证文本主体照发（sent=true）、失败记 linkErrors、不计入 sentParts、不中断。
  const badCardOut = await bridge.deliverOutbox({ doctor_id:active.id, text:"文本主体应照常发出", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", linkCards:[{ title:"坏卡", linkUrl:"ftp://not-http/x" }] } }) }, qiwe.loadConfig());
  ok(badCardOut.sent === true
    && badCardOut.sentParts.some(p=>p.type === "text")
    && !badCardOut.sentParts.some(p=>p.type === "link_card")
    && (badCardOut.linkErrors || []).some(e=>e.type === "link_card_error" && e.title === "坏卡"),
    "deliverOutbox：sendLink 抛错不中断，文本主体仍 sent，失败记 linkErrors 不计入 sentParts");

  // sendLink 抛错不中断（deliverReplyToQiwe）：stub qiwe.sendLink 成抛错（prepareDelivery 会过滤非 http 卡片，故用 stub），
  // 验证文本 sentPart 仍在、results 记 link_card_error、不中断（linkReply 含一张合法 bfh 卡）。测完恢复原函数。
  const realSendLink = qiwe.sendLink;
  qiwe.sendLink = async ()=>{ throw new Error("sendLink 接口未就绪（stub）"); };
  let stubOut;
  try{ stubOut = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:linkReply, toId:"self-user-1", patientName:"测试患者" }); }
  finally{ qiwe.sendLink = realSendLink; }
  ok(stubOut && stubOut.sent === true
    && (stubOut.sentParts || []).some(p=>p.type === "text")
    && !(stubOut.sentParts || []).some(p=>p.type === "link_card")
    && (stubOut.results || []).some(r=>r.type === "link_card_error"),
    "deliverReplyToQiwe：sendLink 抛错不中断，文本主体仍 sent，results 记 link_card_error");
  const beforeCards = qiwe.publicWeappTemplates(active.id);
  // 卡片下限=18：前批已删 病情/风采/视频 三条规则（21→18）；仍校验关键码存在且 病情 不作为独立卡片
  ok(beforeCards.length >= 18 && beforeCards.some(c=>c.code === "101") && beforeCards.some(c=>c.code === "饮食") && beforeCards.some(c=>c.code === "复印") && !beforeCards.some(c=>c.code === "病情"), "同步编号与补充入口卡片清单（病情不作为独立卡片）");

  const cardCapture = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:78,
      userId:"self-user-1",
      senderId:"self-user-1",
      receiverId:"patient-1",
      senderName:"医助本人",
      msgUniqueIdentifier:"qiwe-test-weapp-" + Date.now(),
      msgData:{
        appId:"wx214b7e2bcde837d6",
        username:"gh_chunyu_test@app",
        pagePath:"pages/doctor/index?id=lvfujing",
        title:"吕富靖-内科主任医师-首都医科大学附属北京友谊医院",
        desc:"春雨医生",
        thumbUrl:"http://mmbiz.qpic.cn/test.png",
        coverFileAesKey:"test-aes-key",
        coverFileId:"test-cover-file-id",
        coverFileSize:12345
      }
    }]
  });
  ok(cardCapture.results[0] && cardCapture.results[0].ready === true, "采集并保存 101 小程序卡片模板");
  const tpl = qiwe.loadWeappTemplate(active.id, "101");
  ok(tpl && tpl.ready && tpl.title.includes("吕富靖"), "可读取 101 小程序卡片模板");

  // ①反例3（codex 2026-07-03·连锁）：weappFallbackText 被 omitLinkCards 省略后为空（mp 会成卡时），若原生卡 sendWeapp 失败，
  //   旧 catch 的 else 直接 throw → 后面 linkCards 循环不执行 → 卡不发、整条中断。修：无 fallback 但有 linkCards 时不 throw、由链接卡承载 URL。
  //   构造：101 模板 ready + mp 响应带 shortLink(成原生卡候选)+url(成链接卡) + stub sendWeapp 抛错。
  const w3Reply = { code:"101", source:"keyword_rule", responses:[
    { type:"mp", title:"吕主任主页入口", sub:"主页", external:{ shortLink:tpl.sourceShortLink, url:"https://www.chunyuyisheng.com/rec/w3card7777" } }
  ] };
  const w3Plan = bridge.prepareDelivery(active.id, w3Reply, "测试患者");
  ok(w3Plan.weappReady === true, "①反例3前置：101 模板 ready → prepareDelivery weappReady=true（走原生卡路径）");
  ok((w3Plan.weappFallbackText || "") === "" && w3Plan.linkCards.some(c=>/w3card7777/.test(c.linkUrl || "")),
    "①反例3前置：mp 成卡 → weappFallbackText 被 omitLinkCards 省略为空、URL 改由 linkCards 承载");
  const realSendWeapp = qiwe.sendWeapp;
  qiwe.sendWeapp = async ()=>{ throw new Error("sendWeapp 接口未就绪（stub 反例3）"); };
  let w3Out, w3Threw = false;
  try{ w3Out = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:w3Reply, toId:"self-user-1", patientName:"测试患者" }); }
  catch(e){ w3Threw = true; }
  finally{ qiwe.sendWeapp = realSendWeapp; }
  ok(!w3Threw && w3Out && w3Out.sent === true, "①反例3：weapp 失败 + 无 fallback 文本 + 有链接卡 → 不抛错、整条不中断（sent=true）");
  ok((w3Out.sentParts || []).some(p=>p.type === "link_card" && /w3card7777/.test(p.linkUrl || "")),
    "①反例3：weapp 失败后 linkCards 循环照常执行，链接卡发出（URL 由卡承载）");
  ok(!(w3Out.sentParts || []).some(p=>p.type === "text_fallback")
    && (w3Out.results || []).some(r=>r.type === "weapp_error"),
    "①反例3：无重复 text_fallback、results 记 weapp_error（weapp 失败被记录但不中断）");
  // ①反例3·shortLink 不算链接卡（边界）：mp 只带 shortLink 无 url → linkCardFromResponse/willBecomeLinkCard 只认 url 系字段、不认 shortLink →
  //   不成链接卡（linkCards 空）；且 mp 响应总有默认标题文本 → omitLinkCards 不省略 → weappFallbackText 非空。故 weapp 失败走 text_fallback 分支（不进新 else if、不 throw）。
  //   说明：「weapp 失败 + 无 fallback + 无卡 → throw」这一原语义分支在 omitLinkCards 下几乎不可达（mp 恒有默认标题文本使 fallback 非空；能让 fallback 空的成卡响应必有 url→linkCards 非空），
  //   故 else 的 throw 作为纯防御后备保留（无正当可达用例），此处以「shortLink 走 fallback 文本兜底、不误入新分支」正向覆盖该边界。
  const w3ShortOnlyReply = { code:"101", source:"keyword_rule", responses:[
    { type:"mp", title:"吕主任主页入口", sub:"主页", external:{ shortLink:tpl.sourceShortLink } }   // 只有 shortLink 无 url → 不成链接卡
  ] };
  const w3ShortPlan = bridge.prepareDelivery(active.id, w3ShortOnlyReply, "测试患者");
  ok(w3ShortPlan.weappReady === true && (w3ShortPlan.weappFallbackText || "").length > 0 && w3ShortPlan.linkCards.length === 0,
    "①反例3·边界前置：mp 只带 shortLink 无 url → 不成链接卡（linkCards 空）、weappFallbackText 非空（shortLink≠链接卡，mp 有默认标题文本）");
  qiwe.sendWeapp = async ()=>{ throw new Error("sendWeapp 接口未就绪（stub 反例3·shortLink）"); };
  let w3ShortOut, w3ShortThrew = false;
  try{ w3ShortOut = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:w3ShortOnlyReply, toId:"self-user-1", patientName:"测试患者" }); }
  catch(e){ w3ShortThrew = true; }
  finally{ qiwe.sendWeapp = realSendWeapp; }
  ok(!w3ShortThrew && w3ShortOut && (w3ShortOut.sentParts || []).some(p=>p.type === "text_fallback"),
    "①反例3·边界：mp 只带 shortLink → weapp 失败走 text_fallback 文本兜底（不进新 else if 分支、不 throw、链接不丢）");
  // ①反例3·deliverOutbox 同型（医助确认发送路径）：ready 模板 + payload.linkCards 有卡 + mpFallbackText 空 + stub sendWeapp 抛错 →
  //   不抛错、继续 linkCards 循环发卡、记 weapp_error（与 deliverReplyToQiwe 同修）。code=101（codeNativeWeappAllowed=真、101 模板 ready）。
  qiwe.sendWeapp = async ()=>{ throw new Error("sendWeapp 接口未就绪（stub 反例3·outbox）"); };
  let w3OutboxRes, w3OutboxThrew = false;
  const w3OutboxPayload = JSON.stringify({ qiwe:{ toId:"self-user-1", code:"101", mpFallbackText:"", weappReadyAtDraft:true, linkCards:[{ title:"主页链接卡", linkUrl:"https://www.chunyuyisheng.com/rec/w3outbox9999" }] }, source:"keyword_rule" });
  try{ w3OutboxRes = await bridge.deliverOutbox({ doctor_id:active.id, text:"", payload:w3OutboxPayload }, qiwe.loadConfig()); }
  catch(e){ w3OutboxThrew = true; }
  finally{ qiwe.sendWeapp = realSendWeapp; }
  ok(!w3OutboxThrew && w3OutboxRes && w3OutboxRes.sent === true
    && (w3OutboxRes.sentParts || []).some(p=>p.type === "link_card" && /w3outbox9999/.test(p.linkUrl || ""))
    && !(w3OutboxRes.sentParts || []).some(p=>p.type === "text_fallback")
    && (w3OutboxRes.linkErrors || []).some(er=>er.type === "weapp_error"),
    "①反例3·deliverOutbox：weapp 失败 + 无 fallback + 有 linkCards → 不抛错、发 link_card、记 weapp_error（医助确认发送同修，卡不丢）");
  // 卡片分组现状（甲方 2026-07-08 晚裁定·覆盖待办6；2026-07-09 最新 docx 编号迁移：303→201、404→301、414→302、202→105）：
  // 102/301（旧404）复用 101 医生主页卡：从各自页面级卡（102=预约页 S9bW / 旧404=出诊时间地点 MCGKl 锁卡）改回 101 医生主页短链（5ujZ4dqouQjf8Fh）同组，
  //   企微原生卡复用 101 已真机采集封面（免重采）——上方 line ~286 采集 101 卡触发 hydrateRelatedTemplates 按 5ujZ 同组补齐 102/301（qiwe.js 对 code IN('102','301','404') 特判 title/desc）；
  //   db.js seed_lv_homepage_card_102_404_2026_07_09_v1：生产态从 101 拷贝封面+锁，本地新库重置为 5ujZ 组干净占位；随后 seed_lv_docx_codes patch 把 404 迁 301（下方另测旧 patch 拷贝分支）。
  // 909=送心意页短链（pbyc...·独立组·db.js v2 真机采集锁）。
  // 808 = h5_webview·config_id=2515 小程序卡（甲方 2026-07-06·独立 source_short_link lv808webview2515+真机采集封面），独立组不被 hydrate。
  // 201（旧303）= 北京友谊医院患者服务平台·吕富靖医生详情页原生卡（甲方 2026-07-08·db.js seed_lv_friendship_303_card_2026_07_08_v1 raw_payload 锁 → docx codes patch 迁到 201）→ 独立组、不被 hydrate。
  //   201/808/909 各自单独校验其独立模板就绪（见下方 friendship201Ready / webviewWeappReady / thanksTpl）。
  const t201 = qiwe.loadWeappTemplate(active.id, "201");
  const friendship201Ready = t201 && t201.ready
    && t201.appId === "wxbc8c84999432ac95"
    && t201.username === "gh_43eb4b5211ca@app"
    && /^pages\/doctor-detail\/index\.html\?/.test(t201.pagePath || "")
    && t201.title === "北京友谊医院患者服务平台"
    && !!t201.coverFileAesKey && !!t201.coverFileId && Number(t201.coverFileSize) > 0
    && t201.appId !== tpl.appId                        // 不再等于 101 春雨主页卡 appId（wx214b7e2bcde837d6）
    && t201.sourceShortLink !== tpl.sourceShortLink;   // 与 101 医生主页短链 5ujZ 解耦（独立封面，不被 hydrate 串组）
  ok(friendship201Ready, "201（旧303）= 北京友谊医院患者服务平台·吕富靖医生详情页原生卡（甲方 2026-07-08·真机采集封面就绪、appId wxbc8c84999432ac95、与 101 主页卡解耦不被 hydrate）");
  // 808/302（旧414）/919/联络表 = h5_webview 春雨小程序卡（甲方 2026-07-06·db.js seed_lv_weapp_cards_2026_07_06_v1 直写真机采集封面三件套；414 经 docx codes patch 迁 302）：
  //   判为原生就绪（ready·missingWeappFields=0）、appId=wx2e72ecb9760b913c、pagePath=h5_webview、封面非空；808 独立 source_short_link 不与 101 主页卡同组。
  const webviewWeappReady = ["808","302","919","联络表"].every(code=>{
    const t = qiwe.loadWeappTemplate(active.id, code);
    return t && t.ready
      && t.appId === "wx2e72ecb9760b913c"
      && t.username === "gh_681d3fd5683f@app"
      && /^pages\/h5_webview\/index\.html\?url=/.test(t.pagePath || "")
      && !!t.coverFileAesKey && !!t.coverFileId && Number(t.coverFileSize) > 0
      && t.sourceShortLink !== tpl.sourceShortLink;   // 与 101 医生主页短链解耦（各自独立封面，不被 hydrate 串组）
  });
  ok(webviewWeappReady, "808/302（旧414）/919/联络表 = h5_webview 春雨小程序卡就绪（真机采集封面、appId wx2e72ecb9760b913c、与 101 主页卡解耦）");
  const videoTpl = qiwe.loadWeappTemplate(active.id, "102");
  const addTpl = qiwe.loadWeappTemplate(active.id, "301");
  const thanksTpl = qiwe.loadWeappTemplate(active.id, "909");
  // 102/301（旧404）复用 101 医生主页卡（甲方 2026-07-08 晚裁定·覆盖待办6）：与 101 同 source_short_link（5ujZ）同组，
  //   经上方 101 卡采集触发 hydrateRelatedTemplates 后，102/301 的 appId/username/pagePath/封面均与 101 一致、判就绪。
  ok(videoTpl && addTpl && videoTpl.sourceShortLink === tpl.sourceShortLink && addTpl.sourceShortLink === tpl.sourceShortLink,
    "102/301（旧404）与 101 同 source_short_link（5ujZ 医生主页短链·复用主页卡·替换旧页面级卡）");
  ok(videoTpl && videoTpl.ready && videoTpl.appId === tpl.appId && videoTpl.username === tpl.username && videoTpl.pagePath === tpl.pagePath && videoTpl.coverFileAesKey === tpl.coverFileAesKey,
    "102 = 101 医生主页卡（hydrate 后 appId/username/pagePath/封面 与 101 一致、原生卡就绪）");
  ok(addTpl && addTpl.ready && addTpl.appId === tpl.appId && addTpl.username === tpl.username && addTpl.pagePath === tpl.pagePath && addTpl.coverFileAesKey === tpl.coverFileAesKey,
    "301（旧404）= 101 医生主页卡（hydrate 后与 101 一致、原生卡就绪·替换旧出诊时间地点锁卡）");
  // db.js patch 拷贝分支（生产态·101 就绪）：删本 patch 登记 + 删 102/404 模板行 → applySeedPatches 从 101 拷贝封面三件套 + raw_payload 锁（copiedFrom:101）。
  //   注意：该旧 patch 仍按旧码写 102/404（真实中间态——fresh 全链路中随后由 seed_lv_docx_codes patch 迁 404→301 并删 404；此处单独重跑仅验证其拷贝分支代码，重建出的 404 行为本测试库残留、不影响后续用例）。
  const HOMEPAGE_PATCH_Q = "seed_lv_homepage_card_102_404_2026_07_09_v1";
  db.prepare("DELETE FROM schema_patches WHERE patch_id=?").run(HOMEPAGE_PATCH_Q);
  db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code IN (?,?)").run(active.id, "102", "404");
  applySeedPatches();   // 101 模板此刻已就绪（上方采集）→ patch 走拷贝+锁分支（生产同入口）
  const cp101 = qiwe.loadWeappTemplate(active.id, "101");
  const cp102 = qiwe.loadWeappTemplate(active.id, "102");
  const cp404 = qiwe.loadWeappTemplate(active.id, "404");
  ok(cp102 && cp102.ready && cp102.sourceShortLink === cp101.sourceShortLink && cp102.appId === cp101.appId && cp102.username === cp101.username && cp102.pagePath === cp101.pagePath && cp102.coverFileAesKey === cp101.coverFileAesKey && cp102.coverFileId === cp101.coverFileId && Number(cp102.coverFileSize) === Number(cp101.coverFileSize),
    "patch 拷贝分支：101 就绪时 applySeedPatches 把 101 封面三件套/appId/username/pagePath/短链拷贝到 102（原生卡就绪）");
  ok(cp404 && cp404.ready && cp404.sourceShortLink === cp101.sourceShortLink && cp404.appId === cp101.appId && cp404.username === cp101.username && cp404.pagePath === cp101.pagePath && cp404.coverFileAesKey === cp101.coverFileAesKey,
    "patch 拷贝分支：404 同样从 101 拷贝（覆盖旧出诊时间地点锁行成主页卡）");
  const rawCp404 = (db.prepare("SELECT raw_payload FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(active.id, "404") || {}).raw_payload || "";
  const rawCp102 = (db.prepare("SELECT raw_payload FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(active.id, "102") || {}).raw_payload || "";
  ok(/"copiedFrom":"101"/.test(rawCp404) && /"copiedFrom":"101"/.test(rawCp102) && /"seededBy":"seed_lv_homepage_card_102_404_2026_07_09_v1"/.test(rawCp404),
    "patch 拷贝分支：102/404 raw_payload 写标记（copiedFrom:101 + seededBy 本 patch）→ 成锁·hydrate 跳过·拒运行时覆盖");
  ok(thanksTpl && thanksTpl.ready
    && thanksTpl.sourceShortLink === "#小程序://春雨医生/送心意/pbycpPEVVipdyff"
    && thanksTpl.title === "送心意"
    && /^pages\/send_heart\/index\.html/.test(thanksTpl.pagePath || ""),
    "909 使用真机采集送心意卡（send_heart，原生卡就绪且与 101/301 解耦）");

  const seedPending105 = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"self-user-1",
      receiverId:"patient-1",
      senderName:"医助本人",
      msgUniqueIdentifier:"qiwe-template-code-105-" + Date.now(),
      msgData:{ content:"105" }
    }]
  });
  ok(seedPending105.results[0] && seedPending105.results[0].skipped === "self_message", "医助先发 105（旧202·查看回复）：跳过自发消息但记住待采集编号");
  const capture105 = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:78,
      userId:"self-user-1",
      senderId:"self-user-1",
      receiverId:"patient-1",
      senderName:"医助本人",
      msgUniqueIdentifier:"qiwe-test-weapp-105-" + Date.now(),
      msgData:{
        appId:"wx2e72ecb9760b913c",
        username:"gh_681d3fd5683f@app",
        pagePath:"pages/all_service/index.html",
        title:"我的全部服务",
        desc:"春雨医生",
        thumbUrl:"http://mmbiz.qpic.cn/test-105.png",
        coverFileAesKey:"test-105-aes-key",
        coverFileId:"test-105-cover-file-id",
        coverFileSize:20200
      }
    }]
  });
  ok(capture105.results[0] && capture105.results[0].code === "105" && capture105.results[0].ready === true, "显式 105→卡片：采集我的全部服务卡片模板");
  const tpl105Captured = qiwe.loadWeappTemplate(active.id, "105");
  ok(tpl105Captured && tpl105Captured.pagePath === "pages/all_service/index.html" && tpl105Captured.title === "我的全部服务", "105 模板锁定为我的全部服务页面");
  const tpl105NoAppId = qiwe.saveWeappTemplate({
    doctorId:active.id, code:"105", sourceShortLink:"#小程序://春雨医生/PuW00A6zBsHAw9y",
    card:{ username:"gh_681d3fd5683f@app", pagePath:"pages/all_service/index.html",
      title:"我的全部服务", thumbUrl:"http://mmbiz.qpic.cn/test-105-no-appid.png",
      coverFileAesKey:"test-105-no-appid-aes-key", coverFileId:"test-105-no-appid-cover-file-id", coverFileSize:20201 }
  });
  ok(tpl105NoAppId && tpl105NoAppId.ready && tpl105NoAppId.appId === tpl105Captured.appId, "105 回调缺 appId 时沿用已知春雨 appId，模板不降级");
  const noisyIndexCard = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:78,
      userId:"self-user-1",
      senderId:"self-user-1",
      receiverId:"patient-1",
      senderName:"医助本人",
      msgUniqueIdentifier:"qiwe-test-weapp-noisy-index-" + Date.now(),
      msgData:{
        appId:"wx2e72ecb9760b913c",
        username:"gh_681d3fd5683f@app",
        pagePath:"pages/h5_webview/index.html?url=https%3A%2F%2Fwww.chunyuyisheng.com%2Fv-m-general%2Fvideo-appointment",
        title:"春雨医生",
        desc:"申请视频服务",
        thumbUrl:"http://mmbiz.qpic.cn/noisy.png",
        coverFileAesKey:"noisy-aes-key",
        coverFileId:"noisy-cover-file-id",
        coverFileSize:30300
      }
    }]
  });
  ok(noisyIndexCard.results[0] && noisyIndexCard.results[0].skipped === "uninferable_code", "无编号的 index/春雨医生卡片不再被误判为 105");
  const tpl105AfterNoisy = qiwe.loadWeappTemplate(active.id, "105");
  ok(tpl105AfterNoisy && tpl105AfterNoisy.pagePath === tpl105NoAppId.pagePath && tpl105AfterNoisy.coverFileId === tpl105NoAppId.coverFileId, "已采集 105 不被无编号后续卡片覆盖");

  // ==== ④ 模板永久锁（甲方 2026-07-03 裁定：已封装模板运行时永久锁，改代码才能改）====
  //   captureWeappTemplate 删除了 !pendingCode 豁免 → 已有 raw_payload 的模板位拒绝任何运行时覆盖（含托管号「先发编号再发卡」）；
  //   空白模板位（raw_payload 空）保留首次学习。用 code 808（有 source_short_link，knownWeappCode 为真可记 pendingCode）离线造数据验证。
  //   托管号 = senderId===cfg.selfUserId：先发编号文本（自发→skipped=self_message 但记住 pendingCode）→ 再发 msgType:78 卡片（走 captureWeappTemplate）。
  const LOCK_CODE = "808";
  // (a) 空白位首学成功：显式清 raw_payload 造空白位（保留 source_short_link 让 knownWeappCode 为真）
  db.prepare("UPDATE qiwe_weapp_templates SET raw_payload=NULL WHERE doctor_id=? AND code=?").run(active.id, LOCK_CODE);
  const preLearn808 = db.prepare("SELECT raw_payload FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(active.id, LOCK_CODE);
  ok(!preLearn808 || !preLearn808.raw_payload, "④前置：808 模板位 raw_payload 已清空（空白位，可首次学习）");
  await bridge.handleCallbackBody({ data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"self-user-1", receiverId:"patient-1", senderName:"医助本人", msgUniqueIdentifier:"qiwe-lock-code-808-a-" + Date.now(), msgData:{ content:LOCK_CODE } }] });
  const learn808 = await bridge.handleCallbackBody({ data:[{
    guid:"test-guid-123456", cmd:15000, msgType:78, userId:"self-user-1", senderId:"self-user-1", receiverId:"patient-1", senderName:"医助本人",
    msgUniqueIdentifier:"qiwe-lock-weapp-808-a-" + Date.now(),
    msgData:{ appId:"wx808firstlearn", username:"gh_808_first@app", pagePath:"pages/lock808/first.html", title:"808首学模板",
      thumbUrl:"http://mmbiz.qpic.cn/lock808-a.png", coverFileAesKey:"lock808-a-aes", coverFileId:"lock808-a-cover", coverFileSize:80801 } }] });
  const learn808Out = learn808.results[0] || {};
  ok(learn808Out.skipped === "weapp_template_saved" && learn808Out.code === LOCK_CODE, "④(a) 空白位首学成功：先发编号+发卡 → skipped=weapp_template_saved（空白模板位保留首次学习）");
  const tpl808First = qiwe.loadWeappTemplate(active.id, LOCK_CODE);
  const raw808First = db.prepare("SELECT raw_payload FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(active.id, LOCK_CODE);
  ok(raw808First && raw808First.raw_payload && tpl808First && tpl808First.title === "808首学模板" && tpl808First.pagePath === "pages/lock808/first.html",
    "④(a) 首学落库：raw_payload 非空、title/pagePath = 首学卡字段");
  // (b) 已锁拒绝覆盖：紧接着对同一 code 再来一轮「先发编号+发不同字段的卡」→ 应被永久锁拒绝，模板字段与首学一致（未被覆盖）
  await bridge.handleCallbackBody({ data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"self-user-1", receiverId:"patient-1", senderName:"医助本人", msgUniqueIdentifier:"qiwe-lock-code-808-b-" + Date.now(), msgData:{ content:LOCK_CODE } }] });
  const overwrite808 = await bridge.handleCallbackBody({ data:[{
    guid:"test-guid-123456", cmd:15000, msgType:78, userId:"self-user-1", senderId:"self-user-1", receiverId:"patient-1", senderName:"医助本人",
    msgUniqueIdentifier:"qiwe-lock-weapp-808-b-" + Date.now(),
    msgData:{ appId:"wx808OVERWRITE", username:"gh_808_overwrite@app", pagePath:"pages/lock808/overwrite.html", title:"808覆盖企图",
      thumbUrl:"http://mmbiz.qpic.cn/lock808-b.png", coverFileAesKey:"lock808-b-aes", coverFileId:"lock808-b-cover", coverFileSize:80802 } }] });
  const overwrite808Out = overwrite808.results[0] || {};
  ok(overwrite808Out.skipped === "weapp_template_locked" && overwrite808Out.code === LOCK_CODE,
    "④(b) 已锁拒绝覆盖：先发编号+发不同卡 → skipped=weapp_template_locked（甲方 2026-07-03 裁定：已封装模板运行时永久锁，删了 !pendingCode 豁免）");
  const tpl808After = qiwe.loadWeappTemplate(active.id, LOCK_CODE);
  ok(tpl808After && tpl808After.title === "808首学模板" && tpl808After.pagePath === "pages/lock808/first.html" && tpl808After.appId === "wx808firstlearn",
    "④(b) 未被覆盖：808 模板 title/pagePath/appId 仍=首学值（先发编号也无法覆盖已锁模板）");

  const result = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"patient-1",
      receiverId:"self-user-1",
      senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-101-" + Date.now(),
      msgData:{ content:"101" }
    }]
  });
  const first = result.results[0] || {};
  ok(first.sent === true, "101 单聊文本触发 DRY_RUN 发送");
  ok((first.sentParts || []).some(p=>p.type === "weapp"), "101 使用原生小程序卡片发送春雨入口");
  ok(!/二维码|微信扫一扫|3 个工作日/.test(first.replyPreview || ""), "原生小程序卡片场景不再混入二维码旧话术");

  const repliesResult = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"patient-1",
      receiverId:"self-user-1",
      senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-105-" + Date.now(),
      msgData:{ content:"105" }
    }]
  });
  const repliesOut = repliesResult.results[0] || {};
  ok(repliesOut.sent === true && (repliesOut.sentParts || []).some(p=>p.type === "weapp"), "105 我的全部服务卡片采集后可发原生小程序卡片");
  ok(!/PuW00A6zBsHAw9y|我的订单|春雨主界面/.test(repliesOut.replyPreview || ""), "105 原生卡片就绪时正文不再混入旧文字短链路径");

  const reg201 = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456",
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"patient-1",
      receiverId:"self-user-1",
      senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-201-" + Date.now(),
      msgData:{ content:"201" }
    }]
  });
  const reg201Out = reg201.results[0] || {};
  // 甲方 2026-07-08 裁定：挂号原生卡从春雨主页卡换成北京友谊医院患者服务平台·吕富靖医生详情页卡（替换不并存）；2026-07-09 编号 303→201。
  //   201 模板 ready（上方 friendship201Ready 段已验证=友谊卡）→ hasReadyTemplate → sentParts 含 weapp（友谊卡 title=北京友谊医院患者服务平台）；
  //   旧春雨主页卡 appId（wx214b7e2bcde837d6）不再出现在 sentParts；omitMiniPrograms 生效 → 文本正文无 #小程序:// 短链行；挂号/门诊/出诊说明文本（keyword_rule 首条 text）仍原样保留。
  const weappPart201 = (reg201Out.sentParts || []).find(p=>p.type === "weapp");
  ok(reg201Out.sent === true && weappPart201 && weappPart201.title === "北京友谊医院患者服务平台"
    && !/wx214b7e2bcde837d6/.test(JSON.stringify(reg201Out.sentParts || [])),
    "201（旧303）发北京友谊医院患者服务平台·吕富靖医生详情页原生卡（甲方 2026-07-08 替换春雨主页卡；weapp 标题=友谊平台，旧春雨 appId 不在 sentParts）");
  ok(/挂号|门诊|出诊/.test(reg201Out.replyPreview || "") && !/#小程序:\/\//.test(reg201Out.replyPreview || ""), "201 文本仍说明挂号渠道和门诊/出诊时间，但不带 #小程序:// 短链行（发卡不发文本短链）");

  const self = await bridge.handleCallbackBody({
    data:[{
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"self-user-1",
      receiverId:"patient-1",
      msgUniqueIdentifier:"qiwe-test-self-" + Date.now(),
      msgData:{ content:"101" }
    }]
  });
  ok(self.results[0] && self.results[0].skipped === "self_message", "自己发送的消息跳过，避免回环");

  const group = await bridge.handleCallbackBody({
    data:[{
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"patient-1",
      receiverId:"self-user-1",
      fromRoomId:"room-1",
      msgUniqueIdentifier:"qiwe-test-group-" + Date.now(),
      msgData:{ content:"101" }
    }]
  });
  ok(group.results[0] && group.results[0].skipped === "group_disabled", "当前默认不处理群消息");

  qiwe.saveConfig({ allowGroup:true, testToId:"self-user-1,room-1" });
  const allowedGroup = await bridge.handleCallbackBody({
    data:[{
      cmd:15000,
      msgType:2,
      userId:"self-user-1",
      senderId:"patient-1",
      receiverId:"self-user-1",
      fromRoomId:"room-1",
      senderName:"群测试用户",
      msgUniqueIdentifier:"qiwe-test-group-allowed-" + Date.now(),
      msgData:{ content:"101" }
    }]
  });
  ok(allowedGroup.results[0] && allowedGroup.results[0].sent === true && allowedGroup.results[0].toId === "room-1", "配置群白名单后，群消息发回对应 roomId");
  ok(!/群测试用户/.test(allowedGroup.results[0].replyPreview || ""), "群聊回复不把发言人姓名拼进话术开头");

  // QIWE-MENU：发「1」→ 动态菜单（读 active 医生 content.menu），含吕富靖专属标签、≠ 旧写死短菜单；「3」不再作为菜单入口
  const menuRes = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-menu-" + Date.now(),
      msgData:{ content:"1" }
    }]
  });
  const menuOut = menuRes.results[0] || {};
  ok(menuOut.sent === true && /查看就医相关电话/.test(menuOut.replyPreview || ""), "发「1」→ 动态菜单含吕富靖专属「查看就医相关电话」（读 content.menu 最新 docx 标签·旧「向吕主任咨询」已随 2026-07-09 编号迁移改「医生咨询」，非写死）");
  ok(!/发送 101 咨询、102 视频问诊/.test(menuOut.replyPreview || ""), "不再是旧写死短菜单（无「发送 101 咨询、102 视频问诊」逗号串）");
  const oldMenuRes = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-menu-old-" + Date.now(),
      msgData:{ content:"3" }
    }]
  });
  const oldMenuOut = oldMenuRes.results[0] || {};
  ok(oldMenuOut.sent === true && !/向吕主任咨询/.test(oldMenuOut.replyPreview || "") && /发「1」|数字「1」/.test(oldMenuOut.replyPreview || ""),
    "发「3」不再触发动态菜单，只提示改发「1」查看功能");

  // ① H1：autoSend 关 → 草稿入 outbound_queue(pending)，不自动发（V1 半自动主流程）
  qiwe.saveConfig({ autoSend:false, allowGroup:false, testToId:"self-user-1" });
  const review = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-review-" + Date.now(),
      msgData:{ content:"101" }
    }]
  });
  const r1 = review.results[0] || {};
  ok(r1.reviewOnly === true && r1.sent === false && !!r1.outboxId, "autoSend 关：101 入站 → reviewOnly 草稿入队，不自动发");
  const obRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(r1.outboxId);
  ok(obRow && obRow.channel_type === "qiwe" && obRow.status === "pending" && obRow.target_type === "qiwe_dm", "草稿入 outbound_queue：channel_type='qiwe' / status='pending' / target_type='qiwe_dm'");
  const obPayload = JSON.parse((obRow && obRow.payload) || "{}");
  ok(obPayload.qiwe && obPayload.qiwe.toId === "patient-1" && obPayload.qiwe.code === "101", "草稿 payload 带 toId + code=101（发送时按 code 重查卡片，不丢卡片）");
  ok(!/二维码|微信扫一扫|工作日/.test(obRow.text || "") && /#小程序|适用范围|主页/.test(obPayload.qiwe.mpFallbackText || ""), "卡片就绪时草稿正文不混入二维码旧话术，小程序链接进 mpFallbackText（链接不丢）");

  const review105 = await bridge.handleCallbackBody({
    data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-test-review-105-" + Date.now(),
      msgData:{ content:"105" }
    }]
  });
  const qrow105 = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(review105.results[0].outboxId);
  const payload105 = JSON.parse(qrow105.payload || "{}");
  ok(payload105.qiwe && payload105.qiwe.weappReadyAtDraft === true && /PuW00A6zBsHAw9y|我的全部服务/.test(payload105.qiwe.mpFallbackText || ""), "105 待审草稿标记 weappReadyAtDraft=true，fallback 保留我的全部服务短链");
  const delivered105 = await bridge.deliverOutbox(qrow105, qiwe.loadConfig());
  ok(delivered105.sent === true && (delivered105.sentParts || []).some(p=>p.type === "weapp"), "105 确认发送会重查 all_service 模板并发原生小程序卡片");

  // ①b 洞2 fail-closed（codex 跨厂复核 Round2 抓出）：deliverOutbox 发原生卡前，除看草稿 weappReadyAtDraft，
  //     还按 code 当前规则响应重判 native-allowed（与 prepareDelivery 同源）。缺 weappReadyAtDraft 字段的旧行/手工 payload
  //     (===undefined，!==false 会误放行) 也不会把 fallback_short_link 冒充原生直达。
  const insDraftRow = (code, text, mpFallbackText)=>{
    // 故意不写 weappReadyAtDraft 字段（模拟旧 pending 行 / 手工构造 payload）
    const ins = db.prepare(`INSERT INTO outbound_queue(
      doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,status,source,priority,created_at,sent_at,sent_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      active.id, null, null, "qiwe_dm", "patient-legacy", "qiwe", text,
      JSON.stringify({ qiwe:{ toId:"self-user-1", code, mpFallbackText } }),
      "pending", "qiwe", "normal", new Date().toISOString(), null, null
    );
    return db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(ins.lastInsertRowid);
  };
  const FALLBACK_CODE = "zfallbackmp";
  db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, FALLBACK_CODE);
  db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,1,998)").run(
    active.id, FALLBACK_CODE, JSON.stringify([FALLBACK_CODE]), "exact", "测试医助",
    JSON.stringify([{ type:"mp", title:"兜底短链测试", sub:"仅文字兜底", external:{ status:"fallback_short_link", shortLink:"#小程序://春雨医生/fallback-native-test", appId:"wx2e72ecb9760b913c" } }])
  );
  const tplFallback = qiwe.saveWeappTemplate({
    doctorId:active.id, code:FALLBACK_CODE, sourceShortLink:"#小程序://春雨医生/fallback-native-test",
    card:{ appId:"wx2e72ecb9760b913c", username:"gh_681d3fd5683f@app", pagePath:"pages/index/index.html",
      title:"兜底短链测试", thumbUrl:"http://mmbiz.qpic.cn/fallback-test.png",
      coverFileAesKey:"fallback-test-aes-key", coverFileId:"fallback-test-cover-id", coverFileSize:23456 }
  });
  ok(tplFallback && tplFallback.ready, "洞2 前置：构造 fallback_short_link 但模板 ready 的临时编号（旧 !==false 逻辑会误发原生卡）");
  const legacyFallback = insDraftRow(FALLBACK_CODE, "兜底短链测试文本", "兜底短链测试 · fallback");
  const legacyPayloadFallback = JSON.parse(legacyFallback.payload || "{}");
  ok(legacyPayloadFallback.qiwe && legacyPayloadFallback.qiwe.weappReadyAtDraft === undefined, "洞2 构造：fallback 旧行 payload 缺 weappReadyAtDraft 字段（undefined，!==false 会误放行）");
  const delFallback = await bridge.deliverOutbox(legacyFallback, qiwe.loadConfig());
  ok(delFallback.sent === true && !(delFallback.sentParts || []).some(p=>p.type === "weapp"),
    "洞2 fail-closed：fallback_short_link 缺 weappReadyAtDraft 字段也不发原生卡（按 code 重判 native-allowed=否）");
  const legacy909 = insDraftRow("909", "点击下方送心意卡片", "送心意入口");
  const del909 = await bridge.deliverOutbox(legacy909, qiwe.loadConfig());
  ok(del909.sent === true && (del909.sentParts || []).some(p=>p.type === "weapp"),
    "洞2 对照：909 已升级为真实送心意页面级卡，缺 weappReadyAtDraft 字段时按当前规则重判仍可发原生卡");
  // 对照：101 缺 weappReadyAtDraft 字段仍发原生卡（101 规则响应确允许原生直达，重判 native-allowed=是，不误伤真原生 code）
  const legacy101 = insDraftRow("101", "如需 1对1 咨询医生，可点击下方卡片进入吕富靖主任主页", "图文问诊入口 · 主页短链");
  const del101 = await bridge.deliverOutbox(legacy101, qiwe.loadConfig());
  ok(del101.sent === true && (del101.sentParts || []).some(p=>p.type === "weapp"),
    "洞2 对照：101 缺 weappReadyAtDraft 字段仍发原生卡（规则响应 native-allowed，fail-closed 不误伤真原生 code）");

  // ①c 105（旧202）卡片白名单：只有真实「我的全部服务」all_service 模板可发原生卡（templateNativeWeappAllowed 对 105/旧202 同判）。
  //     构造老库/演示库遗留的 ready 首页模板（page_path=pages/index，非 all_service）盖到 105 上，验证：
  //     即便模板 ready，也不把旧首页卡误发为 105；文本承接仍带真实短链。
  const ready105 = qiwe.saveWeappTemplate({
    doctorId:active.id, code:"105", sourceShortLink:"#小程序://春雨医生/PuW00A6zBsHAw9y",
    card:{ appId:"wx214b7e2bcde837d6", username:"gh_chunyu_old@app", pagePath:"pages/index/index.html",
      title:"查看回复", thumbUrl:"http://mmbiz.qpic.cn/old105.png",
      coverFileAesKey:"old-105-aes-key", coverFileId:"old-105-cover-id", coverFileSize:23456 }
  });
  ok(ready105 && ready105.ready, "①c 前置：构造老库/演示库遗留的 105 ready 原生卡模板（page_path=pages/index=春雨主界面，非 all_service）");
  // prepareDelivery 模板二次门：105 虽允许我的全部服务原生卡，但旧 pages/index 模板不在白名单 → weappReady=false。
  const lv105rule = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=?").get(active.id, "105");
  const plan105 = bridge.prepareDelivery(active.id, { code:"105", responses:JSON.parse(lv105rule.responses) }, "测试患者", {});
  ok(plan105.weappReady === false, "①c gated：105 旧 pages/index 模板虽 ready，但 templateNativeWeappAllowed=否 → prepareDelivery weappReady=false");
  ok(/PuW00A6zBsHAw9y/.test(plan105.replyText || ""), "①c 文本承接保留：105 replyText 仍含真实「我的全部服务」短链 PuW00A6zBsHAw9y");
  // deliverOutbox 二次门：legacy 105 草稿缺 weappReadyAtDraft，即便模板 ready，也因模板不是 all_service 不发原生卡。
  const legacy105 = insDraftRow("105", "点击下方复制到微信打开可直接查看您的订单/回复\n#小程序://春雨医生/PuW00A6zBsHAw9y", "我的订单入口 · 真实短链");
  const del105 = await bridge.deliverOutbox(legacy105, qiwe.loadConfig());
  ok(del105.sent === true && !(del105.sentParts || []).some(p=>p.type === "weapp"),
    "①c deliverOutbox fail-closed：legacy 105 草稿缺 weappReadyAtDraft + 旧 pages/index 模板 ready → 不发原生卡，只发文字/短链");

  // ② setOutboxStatus 对 qiwe 行闸控真发（DRY_RUN）→ status=sent，且原生卡片必发
  const delivered = await bridge.deliverOutbox(obRow, qiwe.loadConfig());
  ok(delivered.sent === true && (delivered.sentParts || []).some(p=>p.type === "weapp"), "deliverOutbox：DRY_RUN 真发文本 + 原生小程序卡片（卡片不丢）");
  const afterSend = await community.setOutboxStatus(r1.outboxId, "sent", "qiwe-admin");
  ok(afterSend.status === "sent", "setOutboxStatus(qiwe 行) 闸控真发 → status=sent");
  ok(db.prepare("SELECT status,sent_by FROM outbound_queue WHERE id=?").get(r1.outboxId).status === "sent", "出站行落库 status=sent（医助确认才发）");

  const makeTriageDecision = (key)=>{
    const t = new Date().toISOString();
    const sess = db.prepare(`INSERT INTO triage_sessions(doctor_id,patient_key,patient_name,status,risk_level,current_handler,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(active.id, key, "分诊台真发测试", "needs_human", "medium", "待人工确认", t, t).lastInsertRowid;
    const msg = db.prepare(`INSERT INTO triage_messages(session_id,doctor_id,role,text,send_status,created_at)
      VALUES(?,?,?,?,?,?)`).run(sess, active.id, "patient", "我这个情况要不要手术", "received", t).lastInsertRowid;
    const dec = db.prepare(`INSERT INTO triage_decisions(session_id,message_id,risk_level,can_auto_send,needs_human,reasoning_summary,triggered_rules,suggested_action,doctor_style_basis,model,status,created_at,final_text,urgency,structured_intake,recommended_actions)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sess, msg, "medium", 0, 1, "测试分诊台真实发送链路", JSON.stringify(["手术决策"]), "转人工确认", "测试", "local-test", "pending_human", t, "", "soon", JSON.stringify({ 主诉:"手术咨询" }), JSON.stringify([{ key:"human", label:"转人工" }])).lastInsertRowid;
    return { sessionId:sess, decisionId:dec };
  };
  const addQiweOutboxForDecision = (link, payloadOver)=>{
    const t = new Date().toISOString();
    const payload = Object.assign({
      qiwe:{ toId:"self-user-1", code:"101", mpFallbackText:"", weappReadyAtDraft:false, linkCards:[] },
      triage:{ sessionId:link.sessionId, decisionId:link.decisionId },
      source:"ai_triage"
    }, payloadOver || {});
    const ins = db.prepare(`INSERT INTO outbound_queue(
      doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,status,source,priority,created_at,sent_at,sent_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      active.id, null, null, "qiwe_dm", "self-user-1", "qiwe", "旧草稿文本",
      JSON.stringify(payload), "pending", "qiwe", "high", t, null, null
    );
    return ins.lastInsertRowid;
  };
  const linked = makeTriageDecision("qiwe-confirm-linked-" + Date.now());
  const linkedOutboxId = addQiweOutboxForDecision(linked);
  const linkedOutbox = community.outboxForDecision(linked.decisionId);
  ok(linkedOutbox && linkedOutbox.id === linkedOutboxId, "AI 分诊台：按 payload.triage.decisionId 精确找到 QiWe 出站队列");
  const delivery = await community.sendOutboxForDecision(linked.decisionId, "人工确认真发文本（DRY_RUN）", "qiwe-admin");
  const linkedRow = db.prepare("SELECT status,text,sent_by FROM outbound_queue WHERE id=?").get(linkedOutboxId);
  ok(delivery.outbox.status === "sent" && linkedRow.status === "sent" && linkedRow.text === "人工确认真发文本（DRY_RUN）", "AI 分诊台：有 QiWe toId 时先改文案再真实出站（DRY_RUN）并标 sent");
  const confirmed = triage.confirmDecision(linked.decisionId, "人工确认真发文本（DRY_RUN）", "qiwe-admin");
  const confirmedRow = db.prepare("SELECT status,decided_by FROM triage_decisions WHERE id=?").get(linked.decisionId);
  ok(confirmedRow.status === "confirmed_sent" && confirmed.messages.some(x=>x.role==="human" && x.send_status==="sent"), "AI 分诊台：真实出站后才允许分诊决策落 confirmed_sent");

  const missing = makeTriageDecision("qiwe-confirm-missing-" + Date.now());
  let missingThrew = false, missingErr = "";
  try{ await community.sendOutboxForDecision(missing.decisionId, "不应发送", "qiwe-admin"); }
  catch(e){ missingThrew = true; missingErr = (e && e.message) || ""; }
  ok(missingThrew && /真实出站队列/.test(missingErr), "AI 分诊台：没有关联出站队列时拒绝确认发送");
  ok(db.prepare("SELECT status FROM triage_decisions WHERE id=?").get(missing.decisionId).status === "pending_human", "AI 分诊台：无队列失败后分诊决策保持 pending_human");

  const noTarget = makeTriageDecision("qiwe-confirm-notarget-" + Date.now());
  const noTargetOutboxId = addQiweOutboxForDecision(noTarget, { qiwe:{ code:"101", mpFallbackText:"", weappReadyAtDraft:false, linkCards:[] } });
  let noTargetThrew = false, noTargetErr = "";
  try{ await community.sendOutboxForDecision(noTarget.decisionId, "缺 toId 不应标已发", "qiwe-admin"); }
  catch(e){ noTargetThrew = true; noTargetErr = (e && e.message) || ""; }
  const noTargetRow = db.prepare("SELECT status,sent_by FROM outbound_queue WHERE id=?").get(noTargetOutboxId);
  ok(noTargetThrew && /toId|真实发送/.test(noTargetErr) && noTargetRow.status === "pending" && !noTargetRow.sent_by, "AI 分诊台：有关联队列但缺 QiWe toId 时拒绝假发送，队列保持 pending");

  // ==== 发送方式溯源 fail-closed（codex 反例3 修）：分诊台 alreadySent 仅认经真实通道投递的 sent_mode='real'，manual/NULL 一律拒确认 ====
  //   缺陷：医助先在社群工作台标 sent（V1 兜底仅标 sent、未真发）→ 分诊台见 status='sent' 走 alreadySent 直接放行 → confirmDecision 落 confirmed_sent（未经真实通道也能确认）。
  //   修法：sent_mode 溯源（real=真实通道投递成功 / manual=V1 兜底手动声明 / NULL=旧行或本地通道）；alreadySent 仅认 real。
  // ① V1 兜底标 sent（社群工作台路径·无 toId → sent_mode='manual'）→ 分诊台 sendOutboxForDecision 拒确认。
  const smManualLink = makeTriageDecision("qiwe-sentmode-manual-" + Date.now());
  const smManualId = addQiweOutboxForDecision(smManualLink, { qiwe:{ code:"101", mpFallbackText:"", weappReadyAtDraft:false, linkCards:[] } });  // 无 toId → 社群工作台确认走 V1 兜底
  await community.setOutboxStatus(smManualId, "sent", "workbench-admin");   // 社群工作台确认发送（不带 requireRealSend）→ V1 兜底仅标 sent
  const smManualRow = db.prepare("SELECT status,sent_mode FROM outbound_queue WHERE id=?").get(smManualId);
  ok(smManualRow.status === "sent" && smManualRow.sent_mode === "manual", "溯源①：社群工作台 V1 兜底仅标 sent（无 toId）→ sent_mode='manual'（未经真实通道）");
  let smManualThrew = false, smManualErr = "";
  try{ await community.sendOutboxForDecision(smManualLink.decisionId, "分诊台不应据此确认", "qiwe-admin"); }
  catch(e){ smManualThrew = true; smManualErr = (e && e.message) || ""; }
  ok(smManualThrew && /人工标记的已发送|不能据此确认/.test(smManualErr), "溯源①：manual 行 → sendOutboxForDecision 抛「该队列是人工标记的已发送…不能据此确认」（fail-closed 拒确认）");
  ok(db.prepare("SELECT status FROM triage_decisions WHERE id=?").get(smManualLink.decisionId).status === "pending_human", "溯源①：manual 拒确认后分诊决策保持 pending_human（未落 confirmed_sent）");

  // 周五科普兼容：旧草稿缺 toId 但挂了社群群 → 发送时从 group.external_group_id 回填后真发（不再假标 manual）
  const healGid = db.prepare(`INSERT INTO community_groups(doctor_id,channel_type,external_group_id,name,owner,member_count,status,welcome_enabled,welcome_text,auto_reply_enabled,review_mode,notes,created_at,updated_at,is_business)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
    active.id, "qiwe", "heal-room-" + Date.now(), "heal群", "医助", 0, "active", 0, "", 1, "human_review", "heal",
    new Date().toISOString(), new Date().toISOString()
  ).lastInsertRowid;
  const healIns = db.prepare(`INSERT INTO outbound_queue(
    doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,status,source,priority,created_at,sent_at,sent_by,data_source
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    active.id, healGid, null, "group", "heal群", "qiwe", "@所有人\n本周科普",
    JSON.stringify({ eventType:"weekly_ops", qiwe:{ needAtAll:true } }),
    "pending", "weekly_ops", "normal", new Date().toISOString(), null, null, "qiwe"
  );
  const healId = healIns.lastInsertRowid;
  const healSent = await community.setOutboxStatus(healId, "sent", "heal-admin");
  const healRow = db.prepare("SELECT status,sent_mode,payload FROM outbound_queue WHERE id=?").get(healId);
  let healPayload = {};
  try{ healPayload = JSON.parse(healRow.payload || "{}"); }catch(e){ healPayload = {}; }
  const healExt = db.prepare("SELECT external_group_id FROM community_groups WHERE id=?").get(healGid).external_group_id;
  ok(healSent.status === "sent" && healRow.sent_mode === "real", "周五科普兼容：缺 toId 挂群 → 回填后真发 sent_mode=real");
  ok(healPayload.qiwe && healPayload.qiwe.toId === healExt, "周五科普兼容：发送后 payload.qiwe.toId 已回填为群 external_group_id");

  // ② 真发路径（DRY_RUN 桩）：sendOutboxForDecision 走 qiwe 真发 → sent_mode='real'；重入 sendOutboxForDecision → alreadySent 放行仍工作（真发路径不被误伤）。
  const smRealLink = makeTriageDecision("qiwe-sentmode-real-" + Date.now());
  const smRealId = addQiweOutboxForDecision(smRealLink);   // 默认 payload 带 toId=self-user-1 → 走 qiwe 真发闸
  await community.sendOutboxForDecision(smRealLink.decisionId, "真发溯源文本（DRY_RUN）", "qiwe-admin");
  const smRealRow = db.prepare("SELECT status,sent_mode FROM outbound_queue WHERE id=?").get(smRealId);
  ok(smRealRow.status === "sent" && smRealRow.sent_mode === "real", "溯源②：qiwe 真发（DRY_RUN 桩）后 sent_mode='real'（经真实通道投递，溯源标记跟代码路径不跟环境）");
  const smRealAgain = await community.sendOutboxForDecision(smRealLink.decisionId, "真发溯源文本（DRY_RUN）", "qiwe-admin");
  ok(smRealAgain.ok === true && smRealAgain.alreadySent === true, "溯源②：sent_mode='real' 的行重入 sendOutboxForDecision → alreadySent 放行仍工作（真发路径不被误伤）");
  // ③ 旧生产行模拟（迁移前无 sent_mode 列 → 手工置 sent_mode=NULL）：分诊台同样拒确认（fail-closed，旧行改走社群工作台）。
  const smNullLink = makeTriageDecision("qiwe-sentmode-null-" + Date.now());
  const smNullId = addQiweOutboxForDecision(smNullLink);
  db.prepare("UPDATE outbound_queue SET status='sent',sent_mode=NULL,sent_at=?,sent_by=? WHERE id=?").run(new Date().toISOString(), "legacy", smNullId);
  let smNullThrew = false, smNullErr = "";
  try{ await community.sendOutboxForDecision(smNullLink.decisionId, "旧行不应据此确认", "qiwe-admin"); }
  catch(e){ smNullThrew = true; smNullErr = (e && e.message) || ""; }
  ok(smNullThrew && /人工标记的已发送|不能据此确认/.test(smNullErr), "溯源③：旧行 sent_mode=NULL（迁移前遗留）→ sendOutboxForDecision 拒确认（fail-closed）");

  // ==== 反例B（codex 2026-07-03）：deliverOutbox 全失败仍标已发 ====
  //   反例3 修复后 deliverOutbox 遇 weapp 失败+无 fallback+有卡不 throw；若 sendLink 也全失败 → 返回 sent:false（未发出任何部分）。
  //   community.setOutboxStatus 原无条件标 sent（不查 r.sent）→ 会把未发出的行误标已发。修：deliverOutbox 返回后加 if(!r.sent) throw → 行保持 pending。
  //   构造：code=101（ready 模板 + codeNativeWeappAllowed=真）+ weappReadyAtDraft:true + linkCards 有卡 + mpFallbackText 空；stub sendWeapp 与 sendLink 都抛错。
  const failAllIns = db.prepare(`INSERT INTO outbound_queue(
    doctor_id,group_id,message_id,target_type,target_name,channel_type,text,payload,status,source,priority,created_at,sent_at,sent_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    active.id, null, null, "qiwe_dm", "patient-failall", "qiwe", "",
    JSON.stringify({ qiwe:{ toId:"self-user-1", code:"101", mpFallbackText:"", weappReadyAtDraft:true, linkCards:[{ title:"主页链接卡", linkUrl:"https://www.chunyuyisheng.com/rec/failall1234" }] }, source:"keyword_rule" }),
    "pending", "qiwe", "normal", new Date().toISOString(), null, null
  );
  const failAllId = failAllIns.lastInsertRowid;
  const realSendWeappB = qiwe.sendWeapp, realSendLinkB = qiwe.sendLink;
  qiwe.sendWeapp = async ()=>{ throw new Error("sendWeapp 全失败（stub 反例B）"); };
  qiwe.sendLink = async ()=>{ throw new Error("sendLink 全失败（stub 反例B）"); };
  let setStatusThrew = false, setStatusErr = "";
  try{ await community.setOutboxStatus(failAllId, "sent", "qiwe-admin"); }
  catch(e){ setStatusThrew = true; setStatusErr = (e && e.message) || ""; }
  finally{ qiwe.sendWeapp = realSendWeappB; qiwe.sendLink = realSendLinkB; }
  ok(setStatusThrew, "反例B：weapp+sendLink 全失败+无 fallback → deliverOutbox 返回 sent:false → setOutboxStatus 抛错（不误标已发）");
  const failAllRow = db.prepare("SELECT status,send_error,attempts FROM outbound_queue WHERE id=?").get(failAllId);
  ok(failAllRow.status === "pending", "反例B：全失败的行 status 仍为 pending（未被误标 sent，草稿保持待发送）");
  ok((failAllRow.attempts || 0) >= 1 && (failAllRow.send_error || "").length > 0, "反例B：失败记 send_error + attempts+1（医助可见错误、可重试）");

  // ==== 并发去重（不变量③·codex 反例）：两个并发真发请求绝不都进入真实投递（患者不收重复消息） ====
  //   修法=setOutboxStatus 真发分支在任何 await 前用条件 UPDATE 原子抢占 pending→sending；抢不到的直接抛「正在发送中」。
  //   node:sqlite 同步执行，两次 UPDATE 依次原子生效——恰一个 changes===1 真发、另一个 changes===0 抛错。
  const realDeliverC = bridge.deliverOutbox;
  // (1) 直打 setOutboxStatus：两并发都过 findRow 拿到 pending，在 UPDATE 抢占上分胜负 → 恰一发、投递桩仅一次。
  {
    const cid = addQiweOutboxForDecision(makeTriageDecision("qiwe-concurrent-set-" + Date.now()));
    let deliverCalls = 0;
    bridge.deliverOutbox = async (row) => { deliverCalls++; return { sent:true, externalMsgId:"dry-concurrent-" + row.id }; };
    let settled;
    try{
      settled = await Promise.allSettled([
        community.setOutboxStatus(cid, "sent", "concurrent-A"),
        community.setOutboxStatus(cid, "sent", "concurrent-B")
      ]);
    } finally { bridge.deliverOutbox = realDeliverC; }
    const okd = settled.filter(x=>x.status==="fulfilled");
    const bad = settled.filter(x=>x.status==="rejected");
    ok(okd.length === 1 && bad.length === 1, "并发 setOutboxStatus 同一 outbox：恰一个成功、一个失败（原子抢占去重）");
    ok(bad[0] && /正在发送中|勿重复/.test((bad[0].reason && bad[0].reason.message) || ""), "并发：失败方拿到明确「正在发送中/请勿重复」错误（fail-closed）");
    const cRow = db.prepare("SELECT status FROM outbound_queue WHERE id=?").get(cid);
    ok(deliverCalls === 1 && cRow.status === "sent", "并发：真实投递桩只被调用一次 + 最终 status=sent（无重复发送）");
  }
  // (2) 端到端 sendOutboxForDecision：第二请求先被抢成 sending → findRow 查不到 → 走「正在发送中」准确报错（非「没有队列」）。
  {
    const link = makeTriageDecision("qiwe-concurrent-send-" + Date.now());
    addQiweOutboxForDecision(link);
    let deliverCalls = 0;
    bridge.deliverOutbox = async (row) => { deliverCalls++; return { sent:true, externalMsgId:"dry-send-" + row.id }; };
    let settled;
    try{
      settled = await Promise.allSettled([
        community.sendOutboxForDecision(link.decisionId, "并发确认真发文本", "concurrent-A"),
        community.sendOutboxForDecision(link.decisionId, "并发确认真发文本", "concurrent-B")
      ]);
    } finally { bridge.deliverOutbox = realDeliverC; }
    const okd = settled.filter(x=>x.status==="fulfilled");
    const bad = settled.filter(x=>x.status==="rejected");
    const badMsg = (bad[0] && bad[0].reason && bad[0].reason.message) || "";
    ok(okd.length === 1 && bad.length === 1 && deliverCalls === 1 && /正在发送中/.test(badMsg),
      "并发 sendOutboxForDecision：恰一发成功、另一报「正在发送中」（准确报错·非「没有队列」）+ 投递仅一次");
  }
  // (3) 投递失败回滚：deliverOutbox 抛错 → 抢占的 sending 回滚 pending + send_error + attempts+1（保持可重试，不误标已发）。
  {
    const rbId = addQiweOutboxForDecision(makeTriageDecision("qiwe-rollback-" + Date.now()));
    bridge.deliverOutbox = async () => { throw new Error("投递异常（rollback stub）"); };
    let rbThrew = false;
    try{ await community.setOutboxStatus(rbId, "sent", "rb-admin"); }
    catch(e){ rbThrew = true; }
    finally { bridge.deliverOutbox = realDeliverC; }
    const rbRow = db.prepare("SELECT status,send_error,attempts FROM outbound_queue WHERE id=?").get(rbId);
    ok(rbThrew && rbRow.status === "pending" && (rbRow.send_error || "").length > 0 && (rbRow.attempts || 0) >= 1,
      "投递失败回滚：sending 回滚 pending + send_error + attempts+1（草稿可重试，不误标已发）");
  }

  // ③ H2：投毒被拦（严格真实自发闸 = 方案 A）——伪造/陌生小程序卡片不写 qiwe_weapp_templates
  const legit101 = qiwe.loadWeappTemplate(active.id, "101");
  // 默认事件「省略 userId」——正是 codex3 复现条件：normalizeEvent 会把 loggedInUserId 回落成 selfUserId。
  const poison = (evtOver)=>({ data:[Object.assign({
    guid:"test-guid-123456", cmd:15000, msgType:78,
    senderId:"attacker-x", receiverId:"attacker-y",
    msgUniqueIdentifier:"qiwe-poison-" + Date.now() + "-" + Math.random(),
    msgData:{ appId:"wxEVILtampered", username:"gh_evil@app", pagePath:"pages/evil/index",
      title:"吕富靖", desc:"x", thumbUrl:"http://evil/x.png", coverFileAesKey:"evil", coverFileId:"evil", coverFileSize:1 }
  }, evtOver || {})] });
  // (a) enabled=0 → 直接 disabled，不采集
  qiwe.saveConfig({ enabled:false });
  const dis = await bridge.handleCallbackBody(poison());
  ok(dis.results[0] && dis.results[0].skipped === "disabled", "H2：enabled=0 时伪造小程序卡片事件 → skipped=disabled（不采集）");
  // (b) codex3 复现：selfUserId∈testToId + userId 缺省（loggedInUserId 回落 self）+ senderId=attacker。
  //     旧 idAllowed 闸会放行 → 投毒覆盖 101；严格自发闸下 senderId≠selfUserId → not_self，不采集。
  qiwe.saveConfig({ enabled:true, selfUserId:"self-user-1", testToId:"self-user-1" });
  const repro = await bridge.handleCallbackBody(poison());            // 注意：默认 poison 不带 userId
  ok(repro.results[0] && repro.results[0].skipped === "not_self", "H2（codex3 复现）：userId 缺省+selfUserId∈testToId 也挡住 → not_self（不再被 loggedInUserId 回落绕过）");
  // (c) 另一条回落路径：带 userId=self 但 senderId=attacker → 仍 not_self（不靠 loggedInUserId/isFromSelf 判定）
  const repro2 = await bridge.handleCallbackBody(poison({ userId:"self-user-1" }));
  ok(repro2.results[0] && repro2.results[0].skipped === "not_self", "H2：带 userId=self 但 senderId=attacker → 仍 not_self");
  // 关键不变量：active 医生 101 卡片 appId 全程未被恶意覆盖
  const after101 = qiwe.loadWeappTemplate(active.id, "101");
  ok(after101 && after101.appId === legit101.appId && after101.appId !== "wxEVILtampered", "H2：投毒全程被闸拦，101 卡片 appId 未被恶意覆盖");

  // ===== 群内语音（msgType=16）：转写→走管线入 pending；转写空→handoff 草稿 =====
  qiwe.saveConfig({ enabled:true, autoSend:false, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  const voiceOk = await bridge.handleCallbackBody({ data:[{
    guid:"test-guid-123456", cmd:15000, msgType:16, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1",
    senderName:"测试患者", msgServerId:"voice-ok-" + Date.now()
  }] });
  const vo = voiceOk.results[0] || {};
  ok(vo.reviewOnly === true && !!vo.outboxId && vo.voiceFailed !== true, "语音转写成功 → 当文本走管线，autoSend 关入 pending 草稿（reviewOnly）");
  const voRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(vo.outboxId);
  ok(voRow && voRow.channel_type === "qiwe" && voRow.status === "pending", "语音草稿 channel_type='qiwe' / status='pending'（照进待审队列，绝不自动发）");
  const voiceFail = await bridge.handleCallbackBody({ data:[{
    guid:"test-guid-123456", cmd:15000, msgType:16, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1",
    senderName:"测试患者", msgServerId:"voice-empty-" + Date.now()
  }] });
  const vf = voiceFail.results[0] || {};
  ok(vf.voiceFailed === true && !!vf.outboxId, "语音转写空/失败 → 入 pending 转人工草稿（voiceFailed），不喂空/猜测进 triage");
  const vfRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(vf.outboxId);
  ok(vfRow && vfRow.source === "qiwe_voice" && vfRow.status === "pending" && /没能听清/.test(vfRow.text || ""), "转写失败草稿 source='qiwe_voice'/pending/患者侧安抚文案（不含医学内容、绝不自动答）");

  // 修2：同一条转写失败语音重放两次 → 只生成一条 qiwe_voice 草稿（失败分支去重）
  const replayId = "voice-empty-replay-" + Date.now();
  const replayEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:16, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgServerId:replayId, msgUniqueIdentifier:replayId }] };
  const vBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_voice'").get().c;
  const rp1 = (await bridge.handleCallbackBody(replayEvt)).results[0] || {};
  const rp2 = (await bridge.handleCallbackBody(replayEvt)).results[0] || {};
  const vAfter = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_voice'").get().c;
  ok(rp1.voiceFailed === true && rp2.skipped === "duplicate" && vAfter === vBefore + 1, "转写失败语音重放 → 第二次去重(skipped=duplicate)，只新增一条草稿");

  // 修1/reject：voiceToText 抛错(模拟请求超时 reject) → 当转写失败走 handoff
  const origV2T = qiwe.voiceToText;
  qiwe.voiceToText = async ()=>{ throw new Error("qiwe http timeout"); };
  const vTimeout = (await bridge.handleCallbackBody({ data:[{ guid:"test-guid-123456", cmd:15000, msgType:16, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgServerId:"voice-timeout-" + Date.now() }] })).results[0] || {};
  qiwe.voiceToText = origV2T;
  ok(vTimeout.voiceFailed === true && !!vTimeout.outboxId, "voiceToText 请求超时/reject → 当转写失败走 handoff（不卡死、不自动答）");

  // 修：postJson 绝对超时真测——本地 http 慢滴流（发响应头+1字节后永不 end），断言 ~300ms 内 reject、不永久挂
  {
    const http = require("http");
    let srvSock = null;
    const drip = http.createServer((rq, rs)=>{ rs.writeHead(200, { "Content-Type":"application/json" }); rs.write("{"); /* 故意不 end、不再写 */ });
    drip.on("connection", s=>{ srvSock = s; });
    await new Promise(res=>drip.listen(0, "127.0.0.1", res));
    const port = drip.address().port;
    const prevTo = process.env.QIWE_HTTP_TIMEOUT_MS;
    process.env.QIWE_HTTP_TIMEOUT_MS = "300";
    const t0 = Date.now();
    let timedOut = false, errMsg = "";
    try{ await qiwe.postJson("http://127.0.0.1:" + port + "/", { a:1 }, {}); }
    catch(e){ timedOut = true; errMsg = (e && e.message) || ""; }
    const dt = Date.now() - t0;
    if(prevTo === undefined) delete process.env.QIWE_HTTP_TIMEOUT_MS; else process.env.QIWE_HTTP_TIMEOUT_MS = prevTo;
    try{ drip.close(); }catch(_){}
    if(srvSock){ try{ srvSock.destroy(); }catch(_){} }
    ok(timedOut && /timeout/i.test(errMsg) && dt < 2000, "postJson 慢滴流(永不 end) → 绝对超时 ~300ms 内 reject(含 timeout 语义)、不永久挂（实测 " + dt + "ms）");
  }

  // ===== postJson 图片方法级兜底闸（codex 第四轮·图片真发绕过链最后一环）=====
  // 真值表：非 DRY_RUN 时直调 postJson 拼 sendImage body 也被拦（真相源=模块常量 DRY_RUN·不读运行时 env）。
  ok(qiwe.roomWriteBlocked(false, false) === true, "postJson 直调 sendImage body 也被拦：非 DRY_RUN + 实验开关关 → roomWriteBlocked(false,false)=true（图片兜底闸拦截）");
  ok(qiwe.roomWriteBlocked(false, true) === false, "非 DRY_RUN + QIWE_SENDIMAGE_EXPERIMENTAL 开 → roomWriteBlocked(false,true)=false（显式开启后放行）");
  // DRY_RUN 放行口径：本测试进程 DRY_RUN=true → roomWriteBlocked(true,*)=false，故本闸不拦——直调 postJson 拼 sendImage body 不因图片闸抛「图片发送未启用」。
  ok(qiwe.roomWriteBlocked(true, false) === false && qiwe.roomWriteBlocked(true, true) === false, "DRY_RUN 下 roomWriteBlocked(true,*)=false → postJson 直调 sendImage body 不被图片兜底闸拦（DRY_RUN 放行口径）");
  {
    // 不真发网络：本地即时拒连地址(127.0.0.1:1)会抛连接错，但绝不会抛「图片发送未启用」——只断言"不因图片闸抛特定错"，不引入网络确定性依赖。
    let imgGateThrew = false;
    try{ await qiwe.postJson("http://127.0.0.1:1/", { method:"/msg/sendImage", params:{} }, {}); }
    catch(e){ if(/图片发送未启用/.test((e && e.message) || "")) imgGateThrew = true; }
    ok(imgGateThrew === false, "DRY_RUN 下 postJson({method:'/msg/sendImage'}) 不因图片兜底闸抛「图片发送未启用」（连接错另计、不算图片闸）");
  }
  // ===== 类型混淆绕过修（codex 第五轮）：闸查「序列化后的 method」而非活属性 body.method =====
  // 根因：boxed String / getter / toJSON 令「检查值 ≠ 序列化上线值」。修法=postJson 序列化一次(bodyStr)→闸从
  // JSON.parse(bodyStr).method 判定→Promise 内 Buffer.from(bodyStr) 复用同串。测试进程模块 DRY_RUN 恒 true 无法活体触发 throw，
  // 故用确定性序列化断言证明「序列化归一化把伪装还原成 /msg/sendImage、闸能抓」这套抗绕过成立。
  {
    // boxed String（new String('/msg/sendImage') !== 原始串，但 JSON.stringify 归一化为原始串）
    const boxed = { method:new String("/msg/sendImage"), params:{} };
    ok(boxed.method !== "/msg/sendImage", "反例·boxed String：body.method（活属性）严格 !== 原始串（旧闸 === 判定被绕过）");
    ok(JSON.parse(JSON.stringify(boxed)).method === "/msg/sendImage", "抗绕过·boxed String：JSON.parse(JSON.stringify(body)).method === '/msg/sendImage'（序列化归一化，新闸从序列化字节判定能抓）");
    // toJSON 在 method 层：首次读活属性返对象/非串，序列化时 toJSON 返图片串
    const tj = { method:{ toJSON(){ return "/msg/sendImage"; } }, params:{} };
    ok(typeof tj.method === "object", "反例·toJSON(method层)：body.method（活属性）是对象 !== 原始串（旧闸被绕过）");
    ok(JSON.parse(JSON.stringify(tj)).method === "/msg/sendImage", "抗绕过·toJSON(method层)：JSON.parse(JSON.stringify(body)).method === '/msg/sendImage'（toJSON 归一化，新闸从序列化字节判定能抓）");
    // toJSON 在对象层：整个 body 的 toJSON 序列化时返 {method:'/msg/sendImage'}
    const tjObj = { toJSON(){ return { method:"/msg/sendImage", params:{} }; } };
    ok(tjObj.method === undefined, "反例·toJSON(对象层)：body.method（活属性）为 undefined !== 原始串（旧闸被绕过）");
    ok(JSON.parse(JSON.stringify(tjObj)).method === "/msg/sendImage", "抗绕过·toJSON(对象层)：JSON.parse(JSON.stringify(body)).method === '/msg/sendImage'（对象层 toJSON 归一化，新闸从序列化字节判定能抓）");
    // doApi 层 String(method) 归一化 boxed String（改动2·防御纵深）
    ok(String(new String("/msg/sendImage")) === "/msg/sendImage", "抗绕过·doApi：String(new String('/msg/sendImage')) === '/msg/sendImage'（doApi 图片闸 String() 归一化 boxed method）");
    // 单次序列化·同源保证：闸解析的字节 = 上线 Buffer.from 的字节（同一 bodyStr），逐字节一致。
    const normalBody = { method:"/msg/sendText", params:{ a:1 } };
    ok(Buffer.from(JSON.stringify(normalBody)).equals(Buffer.from(JSON.stringify(normalBody))), "单次序列化同源：正常 body 序列化确定性一致（postJson 闸查 bodyStr、上线亦 Buffer.from(bodyStr)、同源；正常路径零行为变化）");
  }
  // ===== 子进程活体验证（非 DRY_RUN·图片开关关）：postJson 图片闸对 boxed/toJSON 伪装同步真拦，正常 method 不误拦 =====
  // 本测试进程模块 DRY_RUN 恒 true 无法活体触发 throw；故 spawn 一个不带 QIWE_DRY_RUN/开关的子进程（模块 DRY_RUN=false + 开关关
  // → roomWriteBlocked(false,false)=true），闸在任何网络前同步抛「图片发送未启用」。用即时拒连地址 127.0.0.1:1，正常 method
  // 走到 ECONNREFUSED（不是图片闸）→ 确定性、无网络返回依赖、不 flaky。
  {
    const cp = require("child_process");
    const childScript = `
      const qiwe = require("./qiwe.js");
      (async ()=>{
        const cases = [
          ["boxed", { method:new String("/msg/sendImage"), params:{} }],
          ["tjMethod", { method:{ toJSON(){ return "/msg/sendImage"; } }, params:{} }],
          ["tjObj", { toJSON(){ return { method:"/msg/sendImage", params:{} }; } }],
          ["raw", { method:"/msg/sendImage", params:{} }],
        ];
        const gated = [];
        for(const [name, body] of cases){
          try{ await qiwe.postJson("http://127.0.0.1:1/", body, {}); }
          catch(e){ if(/图片发送未启用/.test((e && e.message) || "")) gated.push(name); }
        }
        let normGated = false;
        try{ await qiwe.postJson("http://127.0.0.1:1/", { method:"/msg/sendText", params:{} }, {}); }
        catch(e){ normGated = /图片发送未启用/.test((e && e.message) || ""); }
        console.log("GATED=" + gated.join(",") + "|NORM=" + normGated);
      })();
    `;
    const childEnv = Object.assign({}, process.env);
    delete childEnv.QIWE_DRY_RUN;                 // 模块 DRY_RUN=false（真发模式）
    delete childEnv.QIWE_SENDIMAGE_EXPERIMENTAL;  // 图片开关关 → fail-closed 应拦
    const r = cp.spawnSync(process.execPath, ["-e", childScript], { cwd:__dirname, env:childEnv, encoding:"utf8", timeout:20000 });
    const out = (r.stdout || "") + (r.stderr || "");
    const m = /GATED=([^|]*)\|NORM=(true|false)/.exec(out);
    const gatedSet = m ? m[1].split(",").filter(Boolean) : [];
    const allGated = ["boxed", "tjMethod", "tjObj", "raw"].every(x=>gatedSet.includes(x));
    const normGated = m ? m[2] === "true" : true;
    ok(allGated && !normGated, "子进程活体（非DRY_RUN+开关关）：postJson 图片闸同步真拦 boxed/toJSON(method层)/toJSON(对象层)/原始串四种伪装、正常 sendText 不误拦（走 ECONNREFUSED，非图片闸）");
  }

  // ===== @所有人真发：默认关回落 sendText；开关 ON 才 sendHyperText；失败回落 sendText =====
  delete process.env.QIWE_ATALL_EXPERIMENTAL;   // 确保默认 OFF
  const atRow = { doctor_id:active.id, text:"本周科普 @所有人 请查收", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", needAtAll:true } }) };
  const offRes = await bridge.deliverOutbox(atRow, qiwe.loadConfig());
  ok((offRes.sentParts || []).some(p=>p.type === "text") && !(offRes.sentParts || []).some(p=>p.type === "hypertext_atall"), "@真发默认关：needAtAll 草稿仍走 sendText（正文含字面「@所有人」兜底）");
  process.env.QIWE_ATALL_EXPERIMENTAL = "1";     // 实验开关 ON
  const onRes = await bridge.deliverOutbox(atRow, qiwe.loadConfig());
  ok((onRes.sentParts || []).some(p=>p.type === "hypertext_atall"), "开关 ON：needAtAll 草稿走 sendHyperText（@所有人）");
  const hyper = await qiwe.sendHyperText("self-user-1", "本周科普", { atAll:true });
  const hcontent = hyper && hyper.data && hyper.data.params && hyper.data.params.content;
  ok(Array.isArray(hcontent) && hcontent.some(c=>c.subtype === 1 && c.text === "") && hcontent.some(c=>c.subtype === 0 && c.text === " 本周科普"), "sendHyperText payload：正文段{subtype:0}（前导空格）+ @所有人段{subtype:1,text:''}（@所有人已确认）");
  const noAt = await qiwe.sendHyperText("self-user-1", "本周科普", {});
  const ncontent = noAt && noAt.data && noAt.data.params && noAt.data.params.content;
  ok(Array.isArray(ncontent) && ncontent.length === 1 && !ncontent.some(c=>c.subtype === 1), "不 @ 时只发正文段、无 @ 段（@指定成员能力见下方独立用例）");
  const origHyper = qiwe.sendHyperText;
  qiwe.sendHyperText = async ()=>{ throw new Error("boom"); };
  const failRes = await bridge.deliverOutbox(atRow, qiwe.loadConfig());
  qiwe.sendHyperText = origHyper;
  ok((failRes.sentParts || []).some(p=>p.type === "text_atall_fallback"), "sendHyperText 失败 → 回落 sendText（@降级为文字，不中断发送）");
  delete process.env.QIWE_ATALL_EXPERIMENTAL;    // 收尾：恢复默认 OFF

  // ===== @指定成员（混合文本）：按官方文档/示例段顺序「@段在前、正文在后」拼 content（DRY_RUN 确定性，不真发/不联网）=====
  // 段格式（qiweapi api-344613914）：@指定成员 {subtype:1,text:userId}；@所有人 {subtype:1,text:""}；正文 {subtype:0,text:正文}。
  {
    const cOf = r => r && r.data && r.data.params && r.data.params.content;
    // ① 仅 @指定成员 → [@成员段, 正文段]
    const m1 = await qiwe.sendHyperText("room-1", "请查收", { atUserIds:["U123"] });
    const c1 = cOf(m1);
    ok(Array.isArray(c1) && c1.length === 2
      && c1[0].subtype === 1 && c1[0].text === "U123"
      && c1[1].subtype === 0 && c1[1].text === " 请查收",
      "@指定成员：content=[{subtype:1,text:'U123'},{subtype:0,text:' 正文'}]（@段在前、正文前导空格）");
    // ② @指定成员 + @所有人 混合 → [指定成员段..., @所有人段, 正文段]
    const m2 = await qiwe.sendHyperText("room-1", "通知", { atUserIds:["U123", "U456"], atAll:true });
    const c2 = cOf(m2);
    ok(Array.isArray(c2) && c2.length === 4
      && c2[0].subtype === 1 && c2[0].text === "U123"
      && c2[1].subtype === 1 && c2[1].text === "U456"
      && c2[2].subtype === 1 && c2[2].text === ""
      && c2[3].subtype === 0 && c2[3].text === " 通知",
      "@指定成员+@所有人混合：段顺序=[指定成员段..., @所有人段, 正文段（前导空格）]");
    // ③ 仅 @所有人（回归）→ [@所有人段, 正文段]
    const m3 = await qiwe.sendHyperText("room-1", "公告", { atAll:true });
    const c3 = cOf(m3);
    ok(Array.isArray(c3) && c3.length === 2
      && c3[0].subtype === 1 && c3[0].text === ""
      && c3[1].subtype === 0 && c3[1].text === " 公告",
      "仅 @所有人（回归）：content=[{subtype:1,text:''},{subtype:0,text:' 正文'}]");
    // ③b 正文已自带前导空格 → 不重复补
    const m3b = await qiwe.sendHyperText("room-1", " 已有空格", { atUserIds:["U1"] });
    const c3b = cOf(m3b);
    ok(c3b && c3b[1] && c3b[1].text === " 已有空格", "@指定成员：正文已有前导空格时不重复补空格");
    // ③c 固定模板 atBodySep=换行 → 正文前导 \n（@姓名与正文分行）
    const m3c = await qiwe.sendHyperText("room-1", "为保护您的隐私", { atUserIds:["U1"], atBodySep:"\n" });
    const c3c = cOf(m3c);
    ok(c3c && c3c[1] && c3c[1].text === "\n为保护您的隐私",
      "固定模板 atBodySep=\\n：content 正文段前导换行（@姓名与正文分行）");
    // ③d 已有前导换行时不重复补
    const m3d = await qiwe.sendHyperText("room-1", "\n已有换行", { atUserIds:["U1"], atBodySep:"\n" });
    const c3d = cOf(m3d);
    ok(c3d && c3d[1] && c3d[1].text === "\n已有换行", "atBodySep=\\n：正文已有前导换行时不重复补");
    // ④ 无 @（回归）→ 仅正文段
    const m4 = await qiwe.sendHyperText("room-1", "纯文本", {});
    const c4 = cOf(m4);
    ok(Array.isArray(c4) && c4.length === 1 && c4[0].subtype === 0 && c4[0].text === "纯文本",
      "无 @（回归）：content=[{subtype:0,text:正文}]（不强制加空格）");
    // ⑤ atUserIds 含空串/空白 → 经 clean 跳过，不臆造空 @ 段
    const m5 = await qiwe.sendHyperText("room-1", "去空", { atUserIds:["", "  ", "U789"] });
    const c5 = cOf(m5);
    ok(Array.isArray(c5) && c5.length === 2 && c5[0].subtype === 1 && c5[0].text === "U789" && c5[1].subtype === 0,
      "@指定成员：空/空白 userId 经 clean 跳过，不产生空 @ 段");
    // ⑥ @指定成员实验开关默认关、独立于 @所有人开关（供 Round 2 派发消费；本轮不接线、不改门控）
    delete process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    ok(qiwe.atMemberExperimentalOn() === false, "@指定成员实验开关默认关（QIWE_ATMEMBER_EXPERIMENTAL≠1 → false）");
    process.env.QIWE_ATMEMBER_EXPERIMENTAL = "1";
    ok(qiwe.atMemberExperimentalOn() === true, "QIWE_ATMEMBER_EXPERIMENTAL=1 → 开关 ON（供 Round 2 派发消费）");
    delete process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    // ⑦ 来源分流：固定模板换行 / AI 空格
    const S = require("./modules/qiwe/shared");
    ok(S.atBodySeparatorForSource("keyword_rule") === "\n"
      && S.atBodySeparatorForSource("welcome") === "\n"
      && S.atBodySeparatorForSource("ai_intent") === "\n"
      && S.atBodySeparatorForSource("ai_triage") === " "
      && S.atBodySeparatorForSource("dialogue_agent") === " "
      && S.atBodySeparatorForSource("") === " ",
      "atBodySeparatorForSource：模板换行、AI/空来源空格");
    ok(S.ensureTextMention("欢迎加入", "灿烂的阳光", { sep:"\n" }) === "@灿烂的阳光\n欢迎加入"
      && S.ensureTextMention("欢迎加入", "灿烂的阳光") === "@灿烂的阳光 欢迎加入",
      "ensureTextMention：sep=\\n 换行；默认空格");
  }

  // 去重持久化「重启等价」：判定源 = qiwe_seen 持久表（不再靠内存 Map），重启仍记得。
  // ① 同 msg_id 两次回调 → 第二次 duplicate，且 qiwe_seen 留行；② 直接预置 qiwe_seen 行(模拟上一进程残留) → 同 msg_id 回调即 duplicate。
  const dedupId = "qiwe-restart-dedup-" + Date.now();
  const dedupEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:dedupId, msgData:{ content:"101" } }] };
  const d1 = (await bridge.handleCallbackBody(dedupEvt)).results[0] || {};
  const d2 = (await bridge.handleCallbackBody(dedupEvt)).results[0] || {};
  const seenRow = db.prepare("SELECT 1 FROM qiwe_seen WHERE msg_id=?").get(dedupId);
  const preId = "qiwe-restart-preseed-" + Date.now();
  db.prepare("INSERT OR IGNORE INTO qiwe_seen(msg_id, seen_at) VALUES(?,?)").run(preId, Date.now());
  const preEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:preId, msgData:{ content:"101" } }] };
  const d3 = (await bridge.handleCallbackBody(preEvt)).results[0] || {};
  ok(d1.skipped !== "duplicate" && d2.skipped === "duplicate" && !!seenRow && d3.skipped === "duplicate", "去重持久化(重启等价)：同 msg_id 第二次=duplicate 且 qiwe_seen 留行；预置 DB 行 → 回调即 duplicate（判定源=DB、重启仍记得）");

  // 明文告警「检测口径 = postJson 真发口径」：postJson 是「非 https 一律走 http 库明文发」，故 isCleartextEndpoint 判「非 https 即明文」(同款 new URL() 解析)。
  // DRY_RUN 下 doApi 提前 return 不到 warnHttpOnce，故直测纯函数。
  ok(qiwe.isCleartextEndpoint("http://127.0.0.1:1/") === true, "http:// → 明文(true) 即告警");
  ok(qiwe.isCleartextEndpoint(" http://127.0.0.1:1/") === true, "前导空格绕过已堵：' http://…'→ true（与 postJson new URL() 规范化一致）");
  ok(qiwe.isCleartextEndpoint("HTTP://127.0.0.1:1/") === true, "大写 HTTP:// → true（不被大小写绕过）");
  ok(qiwe.isCleartextEndpoint("ftp://127.0.0.1/") === true, "非 http 非 https（ftp://）→ true（postJson 仍按非 https 走 http 库明文发 → 必告警，口径不漏）");
  ok(qiwe.isCleartextEndpoint("https://manager.qiweapi.com/") === false, "https:// → false（唯一静默口径）");
  ok(qiwe.isCleartextEndpoint("not a url") === false, "非法 URL → false（postJson 也会抛错不发，故不告警）");
  ok(qiwe.isCleartextEndpoint("") === false, "空 URL → false（不告警）");
  // warnHttpOnce：非 https 触发告警 + flag 防刷屏（此处 warnedHttp 仍 false——DRY_RUN 全程 doApi 未触发）。
  {
    const origWarn = console.warn;
    let warnCount = 0, warnMsg = "";
    console.warn = (...a)=>{ warnCount++; warnMsg = a.join(" "); };
    try{
      qiwe.warnHttpOnce("https://manager.qiweapi.com/");   // https → 不告警
      const httpsSilent = warnCount === 0;
      qiwe.warnHttpOnce(" http://127.0.0.1:1/");           // 前导空格 http(非 https) → 告警一次（绕过反例）
      const leadingSpaceWarned = warnCount === 1 && /明文/.test(warnMsg);
      qiwe.warnHttpOnce("http://again/");                  // flag 已置真 → 不再刷屏
      const latched = warnCount === 1;
      ok(httpsSilent && leadingSpaceWarned && latched, "warnHttpOnce：https 不告警；非 https 触发告警一次；warnedHttp 防刷屏（不阻断发送）");
    }finally{ console.warn = origWarn; }
  }

  // #5a 真发闸门 replyAutoSendable（纯函数，确定性）：确定性来源恒可发；AI 分诊仅 canAutoSend=true 可发；其它保守 false。
  ok(bridge.replyAutoSendable({ source:"keyword_rule" }) === true, "#5a replyAutoSendable: keyword_rule → true（确定性编号/规则）");
  ok(bridge.replyAutoSendable({ source:"ai_intent" }) === true, "#5a replyAutoSendable: ai_intent → true（确定性意图命中）");
  ok(bridge.replyAutoSendable({ source:"ai_triage", triage:{ canAutoSend:true } }) === true, "#5a replyAutoSendable: ai_triage∧canAutoSend=true → true（三档：low 服务模板 / high 安全话术+101卡）");
  ok(bridge.replyAutoSendable({ source:"ai_triage", triage:{ canAutoSend:false } }) === false, "#5a replyAutoSendable: ai_triage∧canAutoSend=false → false（medium 转人工）");
  ok(bridge.replyAutoSendable({ source:"triage_error", triage:{ canAutoSend:false } }) === false, "#5a replyAutoSendable: triage_error → false（分诊异常转人工）");
  ok(bridge.replyAutoSendable({ source:"ai_triage" }) === false, "#5a replyAutoSendable: ai_triage 缺 triage 字段 → false（保守默认）");
  ok(bridge.replyAutoSendable({ source:"weird" }) === false, "#5a replyAutoSendable: 未知 source → false");
  ok(bridge.replyAutoSendable({}) === false, "#5a replyAutoSendable: 空/缺 source → false");

  // #5a 集成（三档裁定 2026-07-02）：autoSend ON 下——high AI 分诊→自动发安全话术+101 原生卡（needsHuman 仍 true）；
  // low 自由文本→自动发 service-only 模板；medium→仍 pending；确定性编号→照旧自动发；autoSend OFF→一切照旧 pending。
  // （前面用例把 autoSend 关过，这里显式重开；DRY_RUN 仍生效，真发只是桩。）
  qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  const hiEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-autosend-hi-" + Date.now(), msgData:{ content:"我胸痛还呼吸困难" } }] };
  const hi = (await bridge.handleCallbackBody(hiEvt)).results[0] || {};
  ok(hi.sent === true && hi.reviewOnly !== true && hi.source === "ai_triage", "#5a 三档 autoSend ON：高风险 AI 分诊(canAutoSend=true) → 自动发（不再 pending）");
  ok(!(hi.sentParts || []).some(p=>p.type === "weapp"), "#5a 三档：急危重症高风险不附 101 线上问诊卡（引导线下/120）");
  ok(/120|急诊/.test(hi.replyPreview || "") && !/「101」|发「101」/.test(hi.replyPreview || "") && !/胸痛|呼吸困难/.test(hi.replyPreview || ""), "#5a 三档：急危高危自动发文本=急诊/120 指引（零线上问诊推销、零病情复述）");
  const hiSess = db.prepare("SELECT status,risk_level FROM triage_sessions WHERE patient_key=? ORDER BY id DESC LIMIT 1").get("qiwe:patient-1");
  ok(hiSess && hiSess.status === "needs_human" && hiSess.risk_level === "high", "#5a 三档：高危自动发后会话仍 needs_human 进分诊台（自动发≠取消人工）");
  const k101Evt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-autosend-101-" + Date.now(), msgData:{ content:"101" } }] };
  const k101 = (await bridge.handleCallbackBody(k101Evt)).results[0] || {};
  ok(k101.sent === true, "#5a autoSend ON：确定性编号(101=keyword_rule) → 仍自动发（不误伤确定性路径）");
  // 三档：low 自由文本 / medium——强制离线确定性（TRIAGE_AI_DISABLED，隔离本机可能存在的 LLM key），floor 判档即三档行为
  {
    const prevTad = process.env.TRIAGE_AI_DISABLED;
    process.env.TRIAGE_AI_DISABLED = "1";
    const loEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-autosend-lo-" + Date.now(), msgData:{ content:"今天天气真好谢谢你们" } }] };
    const lo = (await bridge.handleCallbackBody(loEvt)).results[0] || {};
    ok(lo.sent === true && lo.source === "ai_triage" && !(lo.sentParts || []).some(p=>p.type === "weapp"),
      "#5a 三档 autoSend ON：low 自由文本（L2 离线确定性 low）→ 自动发 service-only 模板、不附 101 卡（附卡仅 high）");
    const medEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-autosend-med-" + Date.now(), msgData:{ content:"我要不要做手术切胆" } }] };
    const me = (await bridge.handleCallbackBody(medEvt)).results[0] || {};
    ok(me.reviewOnly === true && me.sent === false && !!me.outboxId, "#5a 三档 autoSend ON：medium(手术决策) → 仍 pending 转人工（现状不变）");
    // autoSend OFF：high 也照旧 pending（autoSend 总开关最高优先），草稿带 code=101 + 卡片文本链接兜底 → 医助确认发送时走既有原生卡/文本回落机制
    qiwe.saveConfig({ autoSend:false });
    const hiOffEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:"qiwe-autosend-hioff-" + Date.now(), msgData:{ content:"我便血了" } }] };
    const hiOff = (await bridge.handleCallbackBody(hiOffEvt)).results[0] || {};
    const hiOffRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(hiOff.outboxId);
    const hiOffPayload = JSON.parse((hiOffRow && hiOffRow.payload) || "{}");
    ok(hiOff.reviewOnly === true && hiOff.sent === false && hiOffRow && hiOffRow.status === "pending" && hiOffRow.priority === "urgent",
      "#5a 三档 autoSend OFF：高风险 → 照旧 pending/urgent（autoSend 总开关不被三档绕过）");
    ok(hiOffPayload.qiwe && hiOffPayload.qiwe.code === "101" && /#小程序|主页|问诊/.test(hiOffPayload.qiwe.mpFallbackText || ""),
      "#5a 三档：高危 pending 草稿带 code=101 + 101 卡文本链接兜底（确认发送按既有机制发原生卡/回落文本）");
    qiwe.saveConfig({ autoSend:true });
    if(prevTad === undefined) delete process.env.TRIAGE_AI_DISABLED; else process.env.TRIAGE_AI_DISABLED = prevTad;
  }

  // ===== 低危 LLM 生成回复·qiwe 群路径（甲方 2026-07-03 裁定；LOW_RISK_LLM_REPLY 开态 stub 模型，DRY_RUN 真发+群脱敏+attach 卡）=====
  // stub global.fetch：按系统提示词特征分流（低危生成/L2判级/意图/callModel），确定性不联网；qiwe DRY_RUN 已全局开（第3行）。
  {
    const prevTad = process.env.TRIAGE_AI_DISABLED;
    const prevKey = process.env.MIMO_API_KEY;
    const prevDs = process.env.DEEPSEEK_API_KEY;
    const prevFlag = process.env.LOW_RISK_LLM_REPLY;
    const origFetch = global.fetch;
    delete process.env.TRIAGE_AI_DISABLED;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.MIMO_API_KEY = "sk-qiwetest-stub";
    process.env.LOW_RISK_LLM_REPLY = "1";
    let lowPrompts = [];
    const mkQ = (content)=>({ ok:true, json:async()=>({ choices:[{ message:{ content } }] }) });
    global.fetch = async (url, opts)=>{
      const body = JSON.parse(String((opts && opts.body) || "{}"));
      const sys = String(((body.messages || [])[0] || {}).content || "");
      if(sys.indexOf("医疗合规审核员") > -1) return mkQ("NO");   // L2 语义复检（codex 反例1）：默认判 NO 放行（两道都过才发）
      if(sys.indexOf("低风险服务回复助手") > -1){ lowPrompts.push(JSON.stringify(body.messages)); return mkQ('{"reply":"谢谢您的关心～平时规律作息、清淡饮食就好；想约主任聊聊发「101」，发「1」能看全部功能哦。","attach":["201"]}'); }
      if(sys.indexOf("临床风险分级") > -1) return mkQ('{"riskLevel":"low","urgency":"routine","redFlags":[],"reasoning":"stub"}');
      if(sys.indexOf("意图识别") > -1) return mkQ('{"code":null,"medical":false,"confidence":0}');
      return mkQ("stub-free-text");
    };
    // 群发言人显式建档并写「独特标记串」敏感字段（SECRET33）；验证群场景生成输入结构上不含该独特串（FAQ 通用词不作脱敏判据，避免误撞）。
    // patient_id 收敛用 qiwe DM/room 渠道键；此处直接按稳定渠道建档，与 qiwe_bridge 群消息落库口径无关（只为在库里留一份可注入的档案）。
    const SECRET33 = "胆囊结石独家病历Zx9";
    const grpPid = resolvePatient({ doctorId:active.id, channel:"qiwe_room", externalId:"patient-low-1", displayName:"群患者甲" });
    db.prepare("UPDATE patients SET notes=?, follow_stage=?, tags=? WHERE id=?").run(SECRET33, "术后随访", JSON.stringify([SECRET33]), grpPid);
    try{
      qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1,room-low" });
      const gEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"patient-low-1", receiverId:"self-user-1", fromRoomId:"room-low", senderName:"群患者甲", msgUniqueIdentifier:"qiwe-lowllm-grp-"+Date.now(), msgData:{ content:"谢谢关心，平时怎么保养比较好呀" } }] };
      const gRes = (await bridge.handleCallbackBody(gEvt)).results[0] || {};
      ok(gRes.sent === true && gRes.source === "ai_triage", "低危LLM·qiwe群：开态低危 → 自动发（DRY_RUN 真发桩，走三档 canAutoSend=true）");
      ok(/规律作息/.test(gRes.replyPreview || ""), "低危LLM·qiwe群：患者收到 LLM 生成文本（已过后置扫描，替代固定模板）");
      ok((gRes.sentParts || []).some(p=>p.type === "weapp" || p.type === "text_fallback"),
        "低危LLM·qiwe群 attach：合法编号 201（旧303）卡片经既有原生卡/回落机制发出（LLM 只选编号、卡片确定性）");
      // 群场景既有语义：suppressPatientName=true → 称呼在 patient_reply 已被替为占位「网页咨询者」（群内不念真名，本就如此）；
      // 脱敏关键=生成输入结构上不含患者档案敏感串 SECRET33（notes/tags 未注入），且提示词含「群聊场景禁止提及个人病情」硬边界。
      ok(lowPrompts.length >= 1 && lowPrompts.every(p=>p.indexOf(SECRET33) === -1) && /群聊场景/.test(lowPrompts[lowPrompts.length-1]),
        "低危LLM·qiwe群脱敏：患者有档案(SECRET33)但群场景生成输入结构上不含该敏感串，仅群内称呼占位+群聊硬边界（甲方群内脱敏裁定）");
      // 审计：qiwe 群消息也在 triage_decisions 落 +low-llm-reply 标记
      const gSess = db.prepare("SELECT id FROM triage_sessions WHERE patient_key=? ORDER BY id DESC LIMIT 1").get("qiwe:patient-low-1");
      const gDec = gSess && db.prepare("SELECT model FROM triage_decisions WHERE session_id=? ORDER BY id DESC LIMIT 1").get(gSess.id);
      ok(gDec && /\+low-llm-reply$/.test(gDec.model), "低危LLM·qiwe群审计：triage_decisions.model 带 +low-llm-reply 生成标记");
      // 降级：模型输出医疗断言 → 确定性扫描拦截、qiwe 群回落 safeReply（模型文本零直达群）
      global.fetch = async (url, opts)=>{
        const body = JSON.parse(String((opts && opts.body) || "{}"));
        const sys = String(((body.messages || [])[0] || {}).content || "");
        if(sys.indexOf("医疗合规审核员") > -1) return mkQ("NO");   // 复检（本用例词表已先命中降级，复检不会被调，加上防未来变动）
        if(sys.indexOf("低风险服务回复助手") > -1) return mkQ('{"reply":"您可以先吃点消炎药看看，不行再停药。","attach":["201"]}');
        if(sys.indexOf("临床风险分级") > -1) return mkQ('{"riskLevel":"low","urgency":"routine","redFlags":[],"reasoning":"stub"}');
        if(sys.indexOf("意图识别") > -1) return mkQ('{"code":null,"medical":false,"confidence":0}');
        return mkQ("stub-free-text");
      };
      const dgEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"patient-low-2", receiverId:"self-user-1", fromRoomId:"room-low", senderName:"群患者乙", msgUniqueIdentifier:"qiwe-lowllm-dg-"+Date.now(), msgData:{ content:"最近饮食上要注意点啥" } }] };
      const dgRes = (await bridge.handleCallbackBody(dgEvt)).results[0] || {};
      ok(dgRes.sent === true && !/消炎药|停药/.test(dgRes.replyPreview || "") && /101/.test(dgRes.replyPreview || ""),
        "低危LLM·qiwe群降级：模型输出医疗断言 → 后置扫描拦截、群回落 safeReply（模型文本零直达群）");
      // codex 反例1 第二道闸·qiwe 群 e2e：词表挡不住的泛化文本 + 复检答 YES → l2_recheck 降级、群回落 safeReply
      global.fetch = async (url, opts)=>{
        const body = JSON.parse(String((opts && opts.body) || "{}"));
        const sys = String(((body.messages || [])[0] || {}).content || "");
        if(sys.indexOf("医疗合规审核员") > -1) return mkQ("YES");   // 复检判含医疗建议 → 降级
        if(sys.indexOf("低风险服务回复助手") > -1) return mkQ('{"reply":"这种情况平时多注意观察一下就好，慢慢会缓解的。","attach":[]}');   // 词表挡不住的泛化文本
        if(sys.indexOf("临床风险分级") > -1) return mkQ('{"riskLevel":"low","urgency":"routine","redFlags":[],"reasoning":"stub"}');
        if(sys.indexOf("意图识别") > -1) return mkQ('{"code":null,"medical":false,"confidence":0}');
        return mkQ("stub-free-text");
      };
      const rcEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"patient-low-3", receiverId:"self-user-1", fromRoomId:"room-low", senderName:"群患者丙", msgUniqueIdentifier:"qiwe-lowllm-rc-"+Date.now(), msgData:{ content:"日常需要留意些什么呀" } }] };
      const rcRes = (await bridge.handleCallbackBody(rcEvt)).results[0] || {};
      ok(rcRes.sent === true && !/慢慢会缓解/.test(rcRes.replyPreview || "") && /101/.test(rcRes.replyPreview || ""),
        "低危LLM·qiwe群复检降级：词表挡不住+复检 YES → l2_recheck 降级、群回落 safeReply（第二道闸生效）");
      const rcSess = db.prepare("SELECT id FROM triage_sessions WHERE patient_key=? ORDER BY id DESC LIMIT 1").get("qiwe:patient-low-3");
      const rcDec = rcSess && db.prepare("SELECT model,reasoning_summary FROM triage_decisions WHERE session_id=? ORDER BY id DESC LIMIT 1").get(rcSess.id);
      ok(rcDec && /\+low-llm-downgraded$/.test(rcDec.model) && /l2_recheck/.test(rcDec.reasoning_summary), "低危LLM·qiwe群复检降级审计：model +low-llm-downgraded、reason 记 l2_recheck");
    }finally{
      global.fetch = origFetch;
      if(prevTad === undefined) delete process.env.TRIAGE_AI_DISABLED; else process.env.TRIAGE_AI_DISABLED = prevTad;
      if(prevKey === undefined) delete process.env.MIMO_API_KEY; else process.env.MIMO_API_KEY = prevKey;
      if(prevDs === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevDs;
      if(prevFlag === undefined) delete process.env.LOW_RISK_LLM_REPLY; else process.env.LOW_RISK_LLM_REPLY = prevFlag;
      qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
    }
  }

  // ===== Round 2：@指定成员接进群回复派发（入队存 atUserId + deliverOutbox/deliverReplyToQiwe 消费；默认关零变化）=====
  {
    // (a) autoSend 关 + 群消息 → 草稿 payload.qiwe.atUserId = 发言患者 senderId（仅群存）
    qiwe.saveConfig({ enabled:true, autoSend:false, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1,room-1" });
    const grpDraft = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-9", receiverId:"self-user-1", fromRoomId:"room-1",
      senderName:"群患者", msgUniqueIdentifier:"qiwe-atmember-enqueue-" + Date.now(), msgData:{ content:"101" }
    }] })).results[0] || {};
    const grpRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(grpDraft.outboxId);
    const grpPayload = JSON.parse((grpRow && grpRow.payload) || "{}");
    ok(grpDraft.reviewOnly === true && grpPayload.qiwe && grpPayload.qiwe.atUserId === "patient-9",
      "Round2 入队：autoSend 关群消息草稿 payload.qiwe.atUserId = 发言患者 senderId（仅群存）");

    // (b) 私聊草稿 → atUserId 存空（私聊不 @）
    qiwe.saveConfig({ allowGroup:false, testToId:"self-user-1" });
    const dmDraft = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1",
      senderName:"测试患者", msgUniqueIdentifier:"qiwe-atmember-dm-" + Date.now(), msgData:{ content:"101" }
    }] })).results[0] || {};
    const dmRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(dmDraft.outboxId);
    const dmPayload = JSON.parse((dmRow && dmRow.payload) || "{}");
    ok(dmPayload.qiwe && dmPayload.qiwe.atUserId === "", "Round2 入队：私聊草稿 atUserId 存空（私聊不 @）");

    // (c) deliverOutbox 群+atUserId：开关 OFF（默认）→ 纯 sendText（零变化）；ON → hypertext_atmember
    //     缺陷二防呆后 @成员须纯数字 userId（qiwe 真实 userId 恒为数字串）——本用例改用数字 ID，保持「开关 ON+合法 userId → atmember」语义
    const atMemberRow = { doctor_id:active.id, text:"复查结果已出，请查收", payload:JSON.stringify({ qiwe:{ toId:"room-1", atUserId:"1688857254819909" } }) };
    delete process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    const amOff = await bridge.deliverOutbox(atMemberRow, qiwe.loadConfig());
    ok((amOff.sentParts || []).some(p=>p.type === "text") && !(amOff.sentParts || []).some(p=>p.type === "hypertext_atmember"),
      "Round2 deliverOutbox：@指定成员开关 OFF（默认）→ atUserId 草稿仍走纯 sendText（默认行为零变化）");
    process.env.QIWE_ATMEMBER_EXPERIMENTAL = "1";
    const amOn = await bridge.deliverOutbox(atMemberRow, qiwe.loadConfig());
    ok((amOn.sentParts || []).some(p=>p.type === "hypertext_atmember") && !(amOn.sentParts || []).some(p=>p.type === "text" && !p.error),
      "Round2 deliverOutbox：开关 ON + atUserId → sendHyperText(@指定成员，hypertext_atmember)");

    // (d) sendHyperText 失败 → 回落 text_atmember_fallback（@降级文字，不中断发送）
    const origH = qiwe.sendHyperText;
    qiwe.sendHyperText = async ()=>{ throw new Error("boom"); };
    const amFail = await bridge.deliverOutbox(atMemberRow, qiwe.loadConfig());
    qiwe.sendHyperText = origH;
    ok((amFail.sentParts || []).some(p=>p.type === "text_atmember_fallback"),
      "Round2 deliverOutbox：sendHyperText 失败 → 回落 text_atmember_fallback（@降级文字，不中断）");

    // (e) deliverReplyToQiwe（autoSend 路径）集成：autoSend ON + 群 + 开关 ON → 回复自动 @患者本人（hypertext_atmember）
    //     缺陷二防呆后 senderId 用数字（真实 qiwe userId 形态），非数字场景由缺陷修块③覆盖
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1,room-1" });
    process.env.QIWE_ATMEMBER_EXPERIMENTAL = "1";
    const grpAuto = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"1688857254819909", receiverId:"self-user-1", fromRoomId:"room-1",
      senderName:"群患者", msgUniqueIdentifier:"qiwe-atmember-auto-" + Date.now(), msgData:{ content:"101" }
    }] })).results[0] || {};
    ok(grpAuto.sent === true && (grpAuto.sentParts || []).some(p=>p.type === "hypertext_atmember"),
      "Round2 deliverReplyToQiwe（autoSend 集成）：群 101 + 开关 ON → 回复自动 @患者本人（hypertext_atmember）");

    // (f) @所有人原用例不回归：atUserId 空 + needAtAll + atall 开关 ON → 仍走 @所有人，不被 @指定成员抢
    delete process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    process.env.QIWE_ATALL_EXPERIMENTAL = "1";
    const atallRow = { doctor_id:active.id, text:"本周科普 @所有人 请查收", payload:JSON.stringify({ qiwe:{ toId:"room-1", needAtAll:true } }) };
    const atallStill = await bridge.deliverOutbox(atallRow, qiwe.loadConfig());
    ok((atallStill.sentParts || []).some(p=>p.type === "hypertext_atall") && !(atallStill.sentParts || []).some(p=>p.type === "hypertext_atmember"),
      "Round2 回归：needAtAll 草稿（无 atUserId）→ 仍走 @所有人 hypertext_atall，不被 @指定成员抢");
    delete process.env.QIWE_ATALL_EXPERIMENTAL;

    // 收尾：关实验开关 + 恢复默认配置（不影响后续用例）
    delete process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  }

  // ===== 甲方验收实弹缺陷修（2026-07-03 夜·测试群①实拍）：①分诊 entryCode/attach 接原生卡 ②@指定成员纯数字防呆 =====
  // 生产实拍缺陷根因：低危 LLM attach=["饮食","101"] 时 entryCode=okCodes[0]="饮食"（经 patient_reply 映射为 intentCode 传到桥），
  // 原生卡机制只按这一个编号查模板 → 饮食占位模板不就绪 → 同回复里 101 已采集就绪的真卡也整体落文本短链+扫码裸文案；
  // 同时非数字 senderId（smoke-lowllm-0703）走 @成员被 qiweapi 按 0=@所有人渲染。
  {
    const prevTadF = process.env.TRIAGE_AI_DISABLED;
    const prevKeyF = process.env.MIMO_API_KEY;
    const prevDsF = process.env.DEEPSEEK_API_KEY;
    const prevFlagF = process.env.LOW_RISK_LLM_REPLY;
    const prevAtF = process.env.QIWE_ATMEMBER_EXPERIMENTAL;
    const origFetchF = global.fetch;
    const realSendTextF = qiwe.sendText;
    try{
      qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1,room-fix" });
      // 前置：101 真卡模板已在前文用例采集为 ready（raw_payload 非空）——与生产 qiwe_weapp_templates 采集态一致
      const tpl101Fix = qiwe.loadWeappTemplate(active.id, "101");
      ok(tpl101Fix && tpl101Fix.ready === true, "缺陷修前置：库内 101 模板 ready（与生产采集态一致）");

      // ① ai_triage 形状回复带顶层 entryCode=101（triage.handleIncoming 原样字段，不经 buildPatientReply 的 intentCode 映射）
      //    → replyCode 增读 entryCode → 命中 101 就绪模板 → 发原生卡；文本省略 #小程序:// 短链与「微信扫一扫」行
      const rule101Fix = JSON.parse(db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code='101' AND enabled=1").get(active.id).responses);
      const triReply101 = {
        source:"ai_triage",
        triage:{ riskLevel:"high", canAutoSend:true, needsHuman:true },
        entryCode:"101",
        responses:[{ type:"text", text:"您的情况建议尽快就医；如需 1对1 咨询可点击下方卡片进入。" }].concat(rule101Fix.filter(r=>r && r.type !== "text"))
      };
      const plan101Fix = bridge.prepareDelivery(active.id, triReply101, "测试患者");
      ok(plan101Fix.code === "101" && plan101Fix.weappReady === true,
        "缺陷一①：ai_triage 回复带顶层 entryCode=101（无 intentCode）→ replyCode 读到 entryCode、101 就绪模板命中");
      ok(!/#小程序:\/\//.test(plan101Fix.replyText) && !/微信扫一扫/.test(plan101Fix.replyText) && /尽快就医/.test(plan101Fix.replyText),
        "缺陷一①：文本侧省略 #小程序:// 短链与「微信扫一扫」行（入口由原生卡承载），安全话术正文保留");
      const send101Fix = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:triReply101, toId:"self-user-1", patientName:"测试患者" });
      ok(send101Fix.sent === true && (send101Fix.sentParts || []).some(p=>p.type === "weapp" && p.code === "101"),
        "缺陷一①：deliverReplyToQiwe sentParts 含 weapp 部件（101 原生卡真发，DRY_RUN 桩）");

      // ② 生产实拍复现（autoSend ON·低危 LLM attach=["饮食","101"]，首编号饮食无就绪模板）：
      //    修后从 native-allowed mp 响应反查命中 101 就绪真卡 → 发原生卡；实发文本不含短链/扫码行；饮食卡标题行保留（链接不丢口径）
      delete process.env.TRIAGE_AI_DISABLED;
      delete process.env.DEEPSEEK_API_KEY;
      process.env.MIMO_API_KEY = "sk-qiwetest-stub";
      process.env.LOW_RISK_LLM_REPLY = "1";
      const mkF = (content)=>({ ok:true, json:async()=>({ choices:[{ message:{ content } }] }) });
      global.fetch = async (url, opts)=>{
        const body = JSON.parse(String((opts && opts.body) || "{}"));
        const sys = String(((body.messages || [])[0] || {}).content || "");
        if(sys.indexOf("医疗合规审核员") > -1) return mkF("NO");
        if(sys.indexOf("低风险服务回复助手") > -1) return mkF('{"reply":"平时清淡饮食、规律作息就好～详细可看下方指南，想问主任本人发「101」。","attach":["饮食","101"]}');
        if(sys.indexOf("临床风险分级") > -1) return mkF('{"riskLevel":"low","urgency":"routine","redFlags":[],"reasoning":"stub"}');
        if(sys.indexOf("意图识别") > -1) return mkF('{"code":null,"medical":false,"confidence":0}');
        return mkF("stub-free-text");
      };
      const sentTextsF = [];
      qiwe.sendText = async (toId, text, c)=>{ sentTextsF.push(String(text || "")); return realSendTextF(toId, text, c); };
      const fixEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"smoke-lowllm-0703", receiverId:"self-user-1", fromRoomId:"room-fix", senderName:"冒烟患者", msgUniqueIdentifier:"qiwe-fix-lowllm-auto-"+Date.now(), msgData:{ content:"平时饮食上要注意点啥呀" } }] };
      const fixRes = (await bridge.handleCallbackBody(fixEvt)).results[0] || {};
      ok(fixRes.sent === true && (fixRes.sentParts || []).some(p=>p.type === "weapp" && p.code === "101"),
        "缺陷一②（生产实拍复现）：低危 LLM attach=[饮食,101]、首编号饮食无就绪模板 → 反查命中 101 就绪真卡、sentParts 含 weapp（不再全落文本）");
      ok(sentTextsF.length >= 1 && sentTextsF.every(t=>!/#小程序:\/\//.test(t) && !/微信扫一扫/.test(t)),
        "缺陷一②：实发文本不含 #小程序:// 短链、不含「微信扫一扫」（入口由原生卡承载）");
      ok(sentTextsF.some(t=>/清淡饮食/.test(t) && /日常饮食一般建议/.test(t)),
        "缺陷一②：LLM 文本照发 + 饮食卡（无 URL 不成卡）标题行保留（去重不丢内容口径不变）");

      // ③ pending 人工路径（autoSend OFF）同场景：草稿 payload.qiwe.code 与 prepareDelivery 同源=101、weappReadyAtDraft=true
      //    → 医助确认发送 deliverOutbox 按 code=101 重查就绪模板发原生卡
      qiwe.saveConfig({ autoSend:false });
      const fixPendEvt = { data:[{ guid:"test-guid-123456", cmd:15000, msgType:2, userId:"self-user-1", senderId:"smoke-lowllm-0704", receiverId:"self-user-1", fromRoomId:"room-fix", senderName:"冒烟患者乙", msgUniqueIdentifier:"qiwe-fix-lowllm-pend-"+Date.now(), msgData:{ content:"平时饮食上要注意点啥呀" } }] };
      const fixPend = (await bridge.handleCallbackBody(fixPendEvt)).results[0] || {};
      const fixRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(fixPend.outboxId);
      const fixPayload = JSON.parse((fixRow && fixRow.payload) || "{}");
      ok(fixPend.reviewOnly === true && fixPayload.qiwe && fixPayload.qiwe.code === "101" && fixPayload.qiwe.weappReadyAtDraft === true,
        "缺陷一③（pending 路径）：低危 attach 草稿 payload.qiwe.code=101（与 prepareDelivery 同源）+ weappReadyAtDraft=true");
      ok(!/#小程序:\/\//.test(fixRow.text || "") && !/微信扫一扫/.test(fixRow.text || "") && /#小程序:\/\//.test(fixPayload.qiwe.mpFallbackText || ""),
        "缺陷一③：草稿正文无短链/扫码行，小程序链接进 mpFallbackText（发卡失败时文本兜底、链接不丢）");
      const fixDeliver = await bridge.deliverOutbox(fixRow, qiwe.loadConfig());
      ok(fixDeliver.sent === true && (fixDeliver.sentParts || []).some(p=>p.type === "weapp" && p.code === "101"),
        "缺陷一③：deliverOutbox 按草稿 code=101 重查就绪模板发原生卡（医助确认发送路径同修）");
      qiwe.saveConfig({ autoSend:true });

      // ⑤ 回归保护：模板未就绪编号（独立锚短链，不与主页短链共享 → 反查只会命中自身）→ 行为与现状一致：
      //    不发原生卡，#小程序:// 短链文本与「微信扫一扫」行照发（文本兜底、链接不丢）
      const NOTPL_CODE = "znotpl";
      const NOTPL_RESPONSES = [
        { type:"text", text:"这项服务的入口在这里👇" },
        { type:"mp", title:"无模板测试卡", sub:"未采集真卡", external:{ provider:"春雨医生", mode:"mini_program", status:"short_link_ready", shortLink:"#小程序://春雨医生/zNoTpl9999" } },
        { type:"qr", name:"测试医生", sub:"测试科室", caption:"微信扫一扫，和我保持联系" }
      ];
      db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, NOTPL_CODE);
      db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").run(active.id, NOTPL_CODE);
      db.prepare("INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort) VALUES(?,?,?,?,?,?,1,997)").run(
        active.id, NOTPL_CODE, JSON.stringify([NOTPL_CODE]), "exact", "测试医助", JSON.stringify(NOTPL_RESPONSES));
      const noTplReply = { source:"ai_triage", triage:{ riskLevel:"low", canAutoSend:true, needsHuman:false }, entryCode:NOTPL_CODE, responses:NOTPL_RESPONSES };
      const noTplPlan = bridge.prepareDelivery(active.id, noTplReply, "测试患者");
      ok(noTplPlan.weappReady === false && /#小程序:\/\/春雨医生\/zNoTpl9999/.test(noTplPlan.replyText) && /微信扫一扫/.test(noTplPlan.replyText),
        "缺陷一⑤回归：模板未就绪编号 → 不发原生卡，短链/扫码文本兜底照旧（链接不丢，现状行为零变化）");
      const noTplSend = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:noTplReply, toId:"self-user-1", patientName:"测试患者" });
      ok(noTplSend.sent === true && !(noTplSend.sentParts || []).some(p=>p.type === "weapp"),
        "缺陷一⑤回归：deliverReplyToQiwe 不含 weapp 部件（未就绪不硬发卡）");
      db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(active.id, NOTPL_CODE);
      db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").run(active.id, NOTPL_CODE);

      // 缺陷二③④：@指定成员纯数字防呆（开关 ON 场景；非数字=生产冒烟 senderId 形态 → 跳 @ 走 sendText；纯数字照常 @）
      process.env.QIWE_ATMEMBER_EXPERIMENTAL = "1";
      const atReply = { source:"keyword_rule", responses:[{ type:"text", text:"复查提醒已收到，医助会跟进。" }] };
      const atBad = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:atReply, toId:"room-fix", patientName:"", isGroup:true, atUserId:"smoke-lowllm-0703" });
      ok(!(atBad.sentParts || []).some(p=>p.type === "hypertext_atmember" || p.type === "text_atmember_fallback") && (atBad.sentParts || []).some(p=>p.type === "text"),
        "缺陷二③：atUserId 非数字（生产冒烟 senderId 形态）→ 跳过 @、直接 sendText（不再被 qiweapi 按 0 渲染成 @所有人）");
      const atGood = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:atReply, toId:"room-fix", patientName:"", isGroup:true, atUserId:"1688857254811999" });
      ok((atGood.sentParts || []).some(p=>p.type === "hypertext_atmember"),
        "缺陷二④：atUserId 纯数字（真实 qiwe userId 形态）→ hypertext_atmember 照常");
      // 缺陷二·codex 续修：纯 0 / 前导 0 形态（qiweapi 皆当 0 → text=0=@所有人）必须不进 @成员——/^[1-9]\d*$/ 拒绝（"0"/"00"/"0123" 与前导 0）
      for(const zid of ["0", "00", "0123"]){
        const atZero = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:atReply, toId:"room-fix", patientName:"", isGroup:true, atUserId:zid });
        ok(!(atZero.sentParts || []).some(p=>p.type === "hypertext_atmember" || p.type === "text_atmember_fallback") && (atZero.sentParts || []).some(p=>p.type === "text"),
          `缺陷二④b（codex 续修）：atUserId="${zid}"（0/前导0，qiweapi 当 0=@所有人）→ 跳过 @、走 sendText（不再误 @所有人）`);
      }
      const obZero = await bridge.deliverOutbox({ doctor_id:active.id, text:"复查结果已出，请查收", payload:JSON.stringify({ qiwe:{ toId:"room-fix", atUserId:"0" } }) }, qiwe.loadConfig());
      ok(!(obZero.sentParts || []).some(p=>p.type === "hypertext_atmember" || p.type === "text_atmember_fallback") && (obZero.sentParts || []).some(p=>p.type === "text"),
        "缺陷二④b（codex 续修）：deliverOutbox 草稿 atUserId=\"0\" → 同样跳过 @ 走 sendText（两处派发闸门同封 0 形态）");
      const atRowBad = { doctor_id:active.id, text:"复查结果已出，请查收", payload:JSON.stringify({ qiwe:{ toId:"room-fix", atUserId:"smoke-lowllm-0703" } }) };
      const obBad = await bridge.deliverOutbox(atRowBad, qiwe.loadConfig());
      ok(!(obBad.sentParts || []).some(p=>p.type === "hypertext_atmember" || p.type === "text_atmember_fallback") && (obBad.sentParts || []).some(p=>p.type === "text"),
        "缺陷二③b：deliverOutbox 草稿 atUserId 非数字 → 同样跳过 @ 走 sendText（两处派发闸门同修）");
    }finally{
      qiwe.sendText = realSendTextF;
      global.fetch = origFetchF;
      if(prevTadF === undefined) delete process.env.TRIAGE_AI_DISABLED; else process.env.TRIAGE_AI_DISABLED = prevTadF;
      if(prevKeyF === undefined) delete process.env.MIMO_API_KEY; else process.env.MIMO_API_KEY = prevKeyF;
      if(prevDsF === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevDsF;
      if(prevFlagF === undefined) delete process.env.LOW_RISK_LLM_REPLY; else process.env.LOW_RISK_LLM_REPLY = prevFlagF;
      if(prevAtF === undefined) delete process.env.QIWE_ATMEMBER_EXPERIMENTAL; else process.env.QIWE_ATMEMBER_EXPERIMENTAL = prevAtF;
      qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
    }
  }

  // ===== 自动建群【能力层 + DRY_RUN】：建群/改名/群活码/拉人 4 个 method 形状断言（DRY_RUN 确定性，不真建群/不联网）=====
  // method 字符串照抄 qiweapi 官方文档：/room/createRoom、/room/modifyRoomName、/room/getRoomQrCode、/room/inviteRoomMember。
  // guid 由 doApi 统一注入 params；DRY_RUN 下 doApi 返回 { data:{ dryRun:true, method, params } } 不发真实 HTTP。
  {
    const G = "test-guid-123456";            // = 本测试 saveConfig 持久化的 guid
    const pOf = r => r && r.data && r.data.params;
    const mOf = r => r && r.data && r.data.method;

    // ① createRoom：method 精确 + DRY_RUN 不真发
    const cr = await qiwe.createRoom(["U1", "U2"], {});
    ok(mOf(cr) === "/room/createRoom" && cr.data.dryRun === true, "建群：method=/room/createRoom 且 DRY_RUN 不真发（data.dryRun=true，无真实 HTTP）");
    // ② createRoom params：guid 注入 + isOuterRoom 默认 1（整数，外部群）+ memberList 透传
    ok(pOf(cr).guid === G && pOf(cr).isOuterRoom === 1 && JSON.stringify(pOf(cr).memberList) === JSON.stringify(["U1", "U2"]),
      "建群 params：guid 注入 + isOuterRoom 默认 1（整数=外部群）+ memberList 透传");
    // ③ createRoom：isOuterRoom 显式 0（内部群）→ 整数 0 透传，不被默认 1 覆盖
    const cr0 = await qiwe.createRoom(["U1"], { isOuterRoom:0 });
    ok(pOf(cr0).isOuterRoom === 0, "建群 params：isOuterRoom 显式 0 → 整数 0（内部群，不被默认 1 覆盖）");
    // ④ createRoom：memberList 去空 + 去重
    const crClean = await qiwe.createRoom(["U1", "", "  ", "U1", "U2"], {});
    ok(JSON.stringify(pOf(crClean).memberList) === JSON.stringify(["U1", "U2"]), "建群 params：memberList 去空/去重生效（['U1','','  ','U1','U2']→['U1','U2']）");
    // ⑤ createRoom：清洗后成员为空 → 抛错（不发空建群请求）
    let crEmptyThrew = false;
    try{ await qiwe.createRoom(["", "  "], {}); }catch(e){ crEmptyThrew = true; }
    ok(crEmptyThrew, "建群：清洗后成员列表为空 → 抛错（不发空建群请求）");

    // ⑥ modifyRoomName：method 精确 + params{guid,roomId,name}
    const mr = await qiwe.modifyRoomName("room-1", "胃肠镜术后随访1群");
    ok(mOf(mr) === "/room/modifyRoomName" && pOf(mr).guid === G && pOf(mr).roomId === "room-1" && pOf(mr).name === "胃肠镜术后随访1群" && mr.data.dryRun === true,
      "改群名：method=/room/modifyRoomName + params{guid,roomId,name}（DRY_RUN 不真发）");
    let mrThrew1 = false, mrThrew2 = false;
    try{ await qiwe.modifyRoomName("", "x"); }catch(e){ mrThrew1 = true; }
    try{ await qiwe.modifyRoomName("room-1", ""); }catch(e){ mrThrew2 = true; }
    ok(mrThrew1 && mrThrew2, "改群名：缺 roomId 或缺 name → 均抛错");

    // ⑦ getRoomQrCode：method 精确 + params{guid,roomId}
    const qr = await qiwe.getRoomQrCode("room-1");
    ok(mOf(qr) === "/room/getRoomQrCode" && pOf(qr).guid === G && pOf(qr).roomId === "room-1" && qr.data.dryRun === true,
      "群活码：method=/room/getRoomQrCode + params{guid,roomId}（DRY_RUN 不真发）");
    let qrThrew = false;
    try{ await qiwe.getRoomQrCode(""); }catch(e){ qrThrew = true; }
    ok(qrThrew, "群活码：缺 roomId → 抛错");

    // ⑧ inviteRoomMember：method 精确 + params{guid,roomId,memberList(去空/去重)}
    const inv = await qiwe.inviteRoomMember("room-1", ["U3", "", "U3", "U4"]);
    ok(mOf(inv) === "/room/inviteRoomMember" && pOf(inv).guid === G && pOf(inv).roomId === "room-1"
      && JSON.stringify(pOf(inv).memberList) === JSON.stringify(["U3", "U4"]) && inv.data.dryRun === true,
      "拉人进群：method=/room/inviteRoomMember + params{guid,roomId,memberList(去空/去重)}（DRY_RUN 不真发）");
    let invThrew1 = false, invThrew2 = false;
    try{ await qiwe.inviteRoomMember("room-1", ["", " "]); }catch(e){ invThrew1 = true; }
    try{ await qiwe.inviteRoomMember("", ["U3"]); }catch(e){ invThrew2 = true; }
    ok(invThrew1 && invThrew2, "拉人进群：清洗后成员为空 或 缺 roomId → 均抛错");

    // ⑨ 真建群实验开关默认关（默认零真发；真发路径须后续编排显式开，对标 @指定成员 Round1 打法）
    delete process.env.QIWE_CREATEROOM_EXPERIMENTAL;
    ok(qiwe.createRoomExperimentalOn() === false, "真建群实验开关默认关（QIWE_CREATEROOM_EXPERIMENTAL≠1 → false）");
    process.env.QIWE_CREATEROOM_EXPERIMENTAL = "1";
    ok(qiwe.createRoomExperimentalOn() === true, "QIWE_CREATEROOM_EXPERIMENTAL=1 → 开关 ON（供后续编排消费）");
    delete process.env.QIWE_CREATEROOM_EXPERIMENTAL;

    // ⑩ 自门控纯函数 roomWriteBlocked（cc1 裁定 + codex 修：真相源=模块常量 DRY_RUN，与 doApi 同源，**不读运行时 env**→无绕过）。
    //    语义：非 DRY_RUN（doApi 会真发）且实验开关未开 → 拦(true)；其余放行(false)。四组合真值表确定性断言：
    ok(qiwe.roomWriteBlocked(false, false) === true,  "roomWriteBlocked(非DRY_RUN, 开关关) → true（拦真建群/真拉人；生产默认 QIWE_DRY_RUN未设→模块DRY_RUN=false+开关关，fail-closed）");
    ok(qiwe.roomWriteBlocked(true,  false) === false, "roomWriteBlocked(DRY_RUN, 开关关) → false（放行走桩；测试进程模块DRY_RUN=true，原 13 条能力层断言据此放行不真发）");
    ok(qiwe.roomWriteBlocked(false, true)  === false, "roomWriteBlocked(非DRY_RUN, 开关开) → false（本人真机显式 QIWE_CREATEROOM_EXPERIMENTAL=1 放行）");
    ok(qiwe.roomWriteBlocked(true,  true)  === false, "roomWriteBlocked(DRY_RUN, 开关开) → false（放行）");
    // 恒等保证：门控放行 ⟺ doApi 真发（同源模块常量 DRY_RUN）；运行时改 process.env.QIWE_DRY_RUN 不影响模块常量 → 无绕过（codex 抓出的洞已堵）。
  }

  // ===== 图片发送能力层 + 818 海报接线（甲方 2026-07-04 方案 A：先实现全套·DRY_RUN 离线测·真发本人留后）=====
  {
    const path = require("path");
    // ① uploadImage DRY_RUN → 返桩含 fileAesKey/fileId/fileMd5/fileSize（不真传；fileSize=buffer 长度）
    const upBuf = Buffer.from("fake-jpg-bytes-\xff\xd8\xff", "binary");
    const up = await qiwe.uploadImage(upBuf, "lvfujing-818-poster.jpg");
    const ud = up && up.data;
    ok(up && up.code === 0 && ud && ud.dryRun === true
      && ud.fileAesKey === "[dry]" && ud.fileId === "[dry]" && ud.fileMd5 === "[dry]" && ud.fileSize === upBuf.length,
      "图片①：uploadImage DRY_RUN → 返桩 {fileAesKey,fileId,fileMd5,fileSize=字节长度}（不真传）");

    // ② sendImage 映射正确（DRY_RUN 下 uploadImage 返桩 + doApi 返桩，捕获 doApi 收到的 /msg/sendImage params 断言字段映射）
    const si = await qiwe.sendImage("self-user-1", { buffer:upBuf, filename:"lvfujing-818-poster.jpg" });
    const sp = si && si.data && si.data.params;
    ok(si && si.data && si.data.method === "/msg/sendImage"
      && sp && sp.guid === "test-guid-123456" && sp.toId === "self-user-1"
      && sp.fileAesKey === "[dry]"     // 映射：上传 fileAesKey → 发送 fileAesKey（官方聊天图片上传响应字段）
      && sp.fileId === "[dry]"         // 映射：上传 DER fileId → 发送 fileId
      && sp.fileMd5 === "[dry]"
      && sp.fileSize === upBuf.length && Number.isInteger(sp.fileSize)   // fileSize 整数
      && sp.filename === "lvfujing-818-poster.jpg",
      "图片②：sendImage → doApi(/msg/sendImage) params 映射正确（fileAesKey、DER fileId、fileSize 整数、filename）");

    // ②b URL 上传兜底（官方 api-425758709）：本地上传在真实环境可能失败，公网素材 URL 可直接换 sendImage 凭证
    const upUrl = await qiwe.uploadImageByUrl("https://example.com/lvfujing-818-poster.jpg", "lvfujing-818-poster.jpg");
    ok(upUrl && upUrl.data && upUrl.data.fileAesKey === "[dry]" && upUrl.data.fileId === "[dry]",
      "图片②b：uploadImageByUrl DRY_RUN → 返桩 {fileAesKey,fileId,...}（URL 上传兜底能力层）");
    const siUrl = await qiwe.sendImage("self-user-1", { fileUrl:"https://example.com/lvfujing-818-poster.jpg", filename:"lvfujing-818-poster.jpg" });
    const spUrl = siUrl && siUrl.data && siUrl.data.params;
    ok(siUrl && siUrl.data && siUrl.data.method === "/msg/sendImage"
      && spUrl && spUrl.fileAesKey === "[dry]" && spUrl.fileId === "[dry]" && spUrl.filename === "lvfujing-818-poster.jpg",
      "图片②b：sendImage 无本地字节但有 fileUrl → 走 URL 上传兜底后仍发 /msg/sendImage");

    // ③ postMultipart body 构造正确（直接对 buildMultipartBody 断言，不真发）：boundary 出现、method/guid/fileType/file 段齐、Content-Type 含 boundary、Content-Length 匹配 body 长度
    const boundary = "----qiwetestboundary";
    const mbody = qiwe.buildMultipartBody({ method:"/cloud/cdnBigUpload", guid:"test-guid-123456", fileType:1 },
      { name:"file", filename:"p.jpg", buffer:upBuf, contentType:"image/jpeg" }, boundary);
    const mstr = mbody.toString("binary");
    ok(Buffer.isBuffer(mbody)
      && mstr.indexOf("--" + boundary) > -1
      && /name="method"[\s\S]*\/cloud\/cdnBigUpload/.test(mstr)
      && /name="guid"[\s\S]*test-guid-123456/.test(mstr)
      && /name="fileType"[\s\S]*1/.test(mstr)
      && /name="file"; filename="p\.jpg"/.test(mstr)
      && mstr.indexOf("Content-Type: image/jpeg") > -1
      && mstr.indexOf(upBuf.toString("binary")) > -1
      && mstr.indexOf("--" + boundary + "--") > -1,
      "图片③：buildMultipartBody 构造齐全（boundary/method/guid/fileType/file 段+二进制/结尾 boundary）");
    // Content-Length 匹配：postMultipart 用 data.length（字节数）；boundary 参与拼接、结尾 --boundary-- 收尾
    ok(mbody.length > upBuf.length && mstr.slice(-2) === "\r\n",
      "图片③：body 字节长度 = Content-Length（含 file 二进制），以 CRLF 结尾");

    // ④ 护栏：非 DRY_RUN + 开关未开 → 拦（真相源=模块常量 DRY_RUN，不读运行时 env，同 roomWriteBlocked）。
    //    本进程模块 DRY_RUN=true 无法在同进程改 false，故用纯函数真值表证明护栏语义 + 断言开关默认关（同 createRoom 打法）。
    delete process.env.QIWE_SENDIMAGE_EXPERIMENTAL;
    ok(qiwe.sendImageExperimentalOn() === false, "图片④：图片真发开关默认关（QIWE_SENDIMAGE_EXPERIMENTAL≠1 → false）");
    process.env.QIWE_SENDIMAGE_EXPERIMENTAL = "1";
    ok(qiwe.sendImageExperimentalOn() === true, "图片④：QIWE_SENDIMAGE_EXPERIMENTAL=1 → 开关 ON（供接线消费）");
    delete process.env.QIWE_SENDIMAGE_EXPERIMENTAL;
    // 护栏语义（复用 roomWriteBlocked 真值表，sendImage 自门控同源）：非 DRY_RUN+开关关=拦；DRY_RUN 放行走桩。
    ok(qiwe.roomWriteBlocked(false, false) === true,  "图片④：非DRY_RUN+图片开关关 → roomWriteBlocked=true（sendImage 抛错拦截，fail-closed）");
    ok(qiwe.roomWriteBlocked(true, false) === false,  "图片④：DRY_RUN+开关关 → false（放行走桩，本进程据此测能力层不真发）");
    // 端到端护栏活体：DRY_RUN=true → sendImage 放行（走桩返回而非抛错），证明 DRY_RUN 不被误拦
    let dryPass = false;
    try{ await qiwe.sendImage("self-user-1", { buffer:upBuf, filename:"p.jpg" }); dryPass = true; }catch(e){ dryPass = false; }
    ok(dryPass, "图片④：DRY_RUN 下 sendImage 放行（走桩不抛错，真发拦截仅在非 DRY_RUN 生效）");
    // ④' uploadImage 护栏（纵深防御，codex 抓的洞）：uploadImage 被导出可直调绕过 sendImage 自门控直传 doFileApi，
    //    故 uploadImage 内部亦置同一 roomWriteBlocked 护栏。本进程模块 DRY_RUN=true 无法同进程改 false，
    //    沿用真值表证明护栏语义（与图片④同口径，此断言同时守护 sendImage 与 uploadImage 两层）。
    ok(qiwe.roomWriteBlocked(false, false) === true,  "图片④'：非DRY_RUN+图片开关关 → roomWriteBlocked=true（uploadImage 亦抛错拦真传，纵深防御，fail-closed）");
    ok(qiwe.roomWriteBlocked(false, true) === false,  "图片④'：非DRY_RUN+图片开关开 → false（QIWE_SENDIMAGE_EXPERIMENTAL=1 放行 uploadImage 真传，本人真机）");
    // 活体：DRY_RUN=true → uploadImage 放行（在护栏前已返桩，证明 DRY_RUN 不被新护栏误拦）
    let upDryPass = false;
    try{ await qiwe.uploadImage(upBuf, "guard-probe.jpg"); upDryPass = true; }catch(e){ upDryPass = false; }
    ok(upDryPass, "图片④'：DRY_RUN 下 uploadImage 放行（护栏前先返桩，不抛错；真传拦截仅在非 DRY_RUN 生效）");
    // ④'' 上传原语 postMultipart 已取消导出（外部不可直调绕过 uploadImage 护栏直传 /doFileApi，codex 第三轮抓）；
    //     纯函数 buildMultipartBody（拼 Buffer·零网络）/ fileApiUrl（算 URL）仍导出可测。
    ok(qiwe.postMultipart === undefined, "图片④''：postMultipart 已取消导出（外部不可直调原始上传网络写函数，堵直传 /doFileApi 面）");
    ok(typeof qiwe.buildMultipartBody === "function", "图片④''：buildMultipartBody 仍导出（纯函数拼 Buffer·零网络副作用·可测 multipart 线格式）");
    ok(typeof qiwe.fileApiUrl === "function", "图片④''：fileApiUrl 仍导出（纯函数算 doFileApi URL·零网络）");
    // ④''' doApi 图片方法级护栏（纵深兜底闸）：/msg/sendImage 直调 doApi 也受 QIWE_SENDIMAGE_EXPERIMENTAL 门（真值表口径同 roomWriteBlocked）。
    //      本进程模块 DRY_RUN=true，护栏在 DRY_RUN 桩之后 → doApi("/msg/sendImage",...) 仍返桩不抛（活体证 DRY_RUN 不被误拦）。
    ok(qiwe.roomWriteBlocked(false, false) === true,  "图片④'''：非DRY_RUN+开关关 → roomWriteBlocked=true（doApi 直调 /msg/sendImage 亦抛错拦截，纵深兜底闸，fail-closed）");
    let doApiImgDryPass = false, doApiImgData = null;
    try{ doApiImgData = await qiwe.doApi("/msg/sendImage", { toId:"self-user-1", fileId:"[dry]" }); doApiImgDryPass = true; }catch(e){ doApiImgDryPass = false; }
    ok(doApiImgDryPass && doApiImgData && doApiImgData.data && doApiImgData.data.method === "/msg/sendImage",
      "图片④'''：DRY_RUN 下 doApi(/msg/sendImage,...) 仍返桩不抛（护栏在桩后，DRY_RUN 不被误拦；真发拦截仅非 DRY_RUN 生效）");
    // 参数校验：空 toId / 空字节 → 抛错（不进真发路径）
    let badToId = false, badBuf = false;
    try{ await qiwe.sendImage("", { buffer:upBuf }); }catch(e){ badToId = true; }
    try{ await qiwe.sendImage("self-user-1", { buffer:null }); }catch(e){ badBuf = true; }
    ok(badToId && badBuf, "图片④：sendImage 空 toId / 空字节 → 抛错（参数校验，fail-closed）");

    // ⑤ 818 接线：开关关时不发图，且 image 响应不再额外生成「【图片/海报】poster」占位文本
    const reply818 = { code:"818", source:"keyword_rule", responses:[
      { type:"text", text:"感谢您的信任！点击下方保存医生海报👇" },
      { type:"image", svg:"poster", page:"poster" }
    ] };
    // 纯函数：hasPosterImageResponse 认海报 image 响应；resolvePosterAsset 在有真实 posterImage jpg 时返字节
    ok(bridge.hasPosterImageResponse(reply818) === true && bridge.hasPosterImageResponse({ responses:[{ type:"text", text:"x" }] }) === false,
      "图片⑤：hasPosterImageResponse 识别海报 image 响应（type=image + page/svg=poster）");
    const posterAsset = bridge.resolvePosterAsset(active.id, reply818);
    ok(posterAsset && Buffer.isBuffer(posterAsset.buffer) && posterAsset.buffer.length > 0 && posterAsset.filename === "lvfujing-818-poster.jpg",
      "图片⑤：resolvePosterAsset 解析到真实 /assets jpg 字节（吕富靖 content.posterImage）");
    const prevPublicOrigin = process.env.PUBLIC_ORIGIN;
    process.env.PUBLIC_ORIGIN = "https://yht.chunyutianxia.com";
    const posterAssetUrl = bridge.resolvePosterAsset(active.id, reply818);
    ok(posterAssetUrl && posterAssetUrl.fileUrl === "https://yht.chunyutianxia.com/assets/lvfujing-818-poster.jpg",
      "图片⑤：PUBLIC_ORIGIN 存在时 resolvePosterAsset 附带公网 fileUrl（供 URL 上传兜底）");
    if(prevPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = prevPublicOrigin;
    // 关态（默认，开关关）：deliverReplyToQiwe 不发图 → sentParts 无 image，且不出现 image 占位
    delete process.env.QIWE_SENDIMAGE_EXPERIMENTAL;
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
    const off818 = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:reply818, toId:"self-user-1", patientName:"测试患者" });
    ok(!(off818.sentParts || []).some(p=>p.type === "image") && !/图片\/海报/.test(off818.replyText || "") && /保存医生海报/.test(off818.replyText || ""),
      "图片⑤·关态：开关关 → deliverReplyToQiwe 不发图（sentParts 无 image），image 响应不额外生成占位文本");
    // 关态 deliverOutbox（医助确认发送路径）同样不发图
    const off818Out = await bridge.deliverOutbox({ doctor_id:active.id, text:"海报文本占位", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", code:"818" } }) }, qiwe.loadConfig());
    ok(!(off818Out.sentParts || []).some(p=>p.type === "image"),
      "图片⑤·关态：开关关 → deliverOutbox 按 code=818 也不发图");
    // 开态（显式开关）：接线到位 → 发真图（DRY_RUN 走桩）
    process.env.QIWE_SENDIMAGE_EXPERIMENTAL = "1";
    const on818 = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:reply818, toId:"self-user-1", patientName:"测试患者" });
    ok((on818.sentParts || []).some(p=>p.type === "image" && p.filename === "lvfujing-818-poster.jpg"),
      "图片⑤·开态：开关开 + 真实 jpg → deliverReplyToQiwe 追加发一张海报真图（DRY_RUN 桩）");
    const on818Out = await bridge.deliverOutbox({ doctor_id:active.id, text:"海报文本占位", payload:JSON.stringify({ qiwe:{ toId:"self-user-1", code:"818" } }) }, qiwe.loadConfig());
    ok((on818Out.sentParts || []).some(p=>p.type === "image" && p.filename === "lvfujing-818-poster.jpg"),
      "图片⑤·开态：开关开 → deliverOutbox 按 code=818 反查规则含海报响应 → 发真图（医助确认发送同接线）");
    // 开态·SVG 生成海报（无真实 jpg 资产）不发图：临时把该医生 posterImage 清空 → resolvePosterAsset 返 null → 不发图（保持现状）
    const svgReply = { code:"818", source:"keyword_rule", responses:[{ type:"text", text:"海报" }, { type:"image", svg:"poster", page:"poster" }] };
    const savedContent = db.prepare("SELECT content FROM doctors WHERE id=?").get(active.id).content;
    const noPoster = JSON.parse(savedContent); delete noPoster.posterImage;
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(noPoster), active.id);
    ok(bridge.resolvePosterAsset(active.id, svgReply) === null,
      "图片⑤·开态：无真实 posterImage jpg（SVG 生成海报）→ resolvePosterAsset 返 null（不发图、保持现状）");
    const svgOn = await bridge.deliverReplyToQiwe({ cfg:qiwe.loadConfig(), doctorId:active.id, reply:svgReply, toId:"self-user-1", patientName:"测试患者" });
    ok(!(svgOn.sentParts || []).some(p=>p.type === "image"),
      "图片⑤·开态：无真实 jpg 时开关开也不发图（deliverReplyToQiwe sentParts 无 image）");
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(savedContent, active.id);   // 还原 posterImage
    // 路径穿越防护：伪造 posterImage 含穿越/非白名单扩展名 → doctorPosterImagePath 白名单拒绝 → 不发图
    const savedContent2 = db.prepare("SELECT content FROM doctors WHERE id=?").get(active.id).content;
    const evilContent = JSON.parse(savedContent2); evilContent.posterImage = "/assets/../server.js";
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(evilContent), active.id);
    ok(bridge.resolvePosterAsset(active.id, svgReply) === null,
      "图片⑤·安全：posterImage 含路径穿越(/assets/../server.js) → 白名单拒绝 → 返 null（不读越界文件）");
    db.prepare("UPDATE doctors SET content=? WHERE id=?").run(savedContent2, active.id);   // 还原
    delete process.env.QIWE_SENDIMAGE_EXPERIMENTAL;   // 收尾：恢复默认关
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  }

  // ===== 新患者入群提醒（仅明确入群提示→欢迎+医助到访提醒；普通首条发言不触发；DM 不触发；提醒不可外发；autoSend 关落 pending）=====
  {
    const WR = "room-welcome";
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1," + WR });
    publishScriptsConfig(active.id, {
      groupWelcome:"【运营欢迎】这段配置不应覆盖固定入群欢迎语。",
      voice:"【运营语音】{patient}，语音暂时无法稳定识别，请补充文字描述；医助也会人工查看。",
      nonText:"【运营资料】{patient}，资料已收到，医助会人工跟进，请稍等。",
      memberVisit:"【运营到访】新患者到访：{patient}（{senderId}）首次在群内发言，请医助关注。"
    });
    const welcomeProbe = bridge.buildGroupWelcomeText(active.id, "新患者小李");
    ok(/^@新患者小李/.test(welcomeProbe)
      && /欢迎加入吕富靖主任建立的【院外公益健康群】/.test(welcomeProbe)
      && /“1”/.test(welcomeProbe)
      && /医患联络表/.test(welcomeProbe)
      && /视频问候/.test(welcomeProbe)
      && !/运营欢迎/.test(welcomeProbe),
      "固定入群欢迎：补 @新入群成员，并使用固定四段话术（不再被运营配置覆盖）");

    // (0) 群消息接管门控：普通闲聊静默；编号/@咨询/高危仍进入既有链路。
    {
      const WRG = "room-gate";
      const prevTad = process.env.TRIAGE_AI_DISABLED;
      const prevKey = process.env.MIMO_API_KEY;
      const prevDs = process.env.DEEPSEEK_API_KEY;
      const prevFlag = process.env.LOW_RISK_LLM_REPLY;
      const origFetch = global.fetch;
      try{
        qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1," + WRG });
        delete process.env.TRIAGE_AI_DISABLED;
        delete process.env.DEEPSEEK_API_KEY;
        process.env.MIMO_API_KEY = "sk-gate-should-not-call";
        process.env.LOW_RISK_LLM_REPLY = "1";
        let fetchCalled = 0;
        global.fetch = async ()=>{ fetchCalled++; throw new Error("group chitchat must not call LLM"); };
        const beforeOut = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=?").get(WRG).c;
        const beforeSess = db.prepare("SELECT COUNT(*) c FROM triage_sessions WHERE patient_key=?").get("qiwe:gate-chat-1").c;
        const chat = (await bridge.handleCallbackBody({ data:[{
          guid:"test-guid-123456", cmd:15000, msgType:2,
          userId:"self-user-1", senderId:"gate-chat-1", receiverId:"self-user-1", fromRoomId:WRG,
          senderName:"闲聊患者甲", msgUniqueIdentifier:"qiwe-gate-chat-" + Date.now(), msgData:{ content:"哈哈我今天好多了" }
        }] })).results[0] || {};
        const afterOut = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=?").get(WRG).c;
        const afterSess = db.prepare("SELECT COUNT(*) c FROM triage_sessions WHERE patient_key=?").get("qiwe:gate-chat-1").c;
        ok(chat.skipped === "group_chitchat" && afterOut === beforeOut && afterSess === beforeSess && fetchCalled === 0,
          "群接管门控：普通闲聊 → skipped=group_chitchat，不生成欢迎/草稿/分诊会话，不调用 LLM");
      }finally{
        global.fetch = origFetch;
        if(prevTad === undefined) delete process.env.TRIAGE_AI_DISABLED; else process.env.TRIAGE_AI_DISABLED = prevTad;
        if(prevKey === undefined) delete process.env.MIMO_API_KEY; else process.env.MIMO_API_KEY = prevKey;
        if(prevDs === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevDs;
        if(prevFlag === undefined) delete process.env.LOW_RISK_LLM_REPLY; else process.env.LOW_RISK_LLM_REPLY = prevFlag;
      }

      const code = (await bridge.handleCallbackBody({ data:[{
        guid:"test-guid-123456", cmd:15000, msgType:2,
        userId:"self-user-1", senderId:"gate-code-1", receiverId:"self-user-1", fromRoomId:WRG,
        senderName:"编号患者", msgUniqueIdentifier:"qiwe-gate-code-" + Date.now(), msgData:{ content:"101" }
      }] })).results[0] || {};
      ok(code.skipped !== "group_chitchat" && code.sent === true,
        "群接管门控：群内发送编号 101 → 不静默，仍走编号回复/卡片链路");
      ok(/为保护您的隐私/.test(code.replyPreview || "") && (code.sentParts || []).some(p=>p.type === "text") && ((code.sentParts || []).some(p=>p.type === "weapp") || (code.weapp && code.weapp.code === "101")),
        "文档编号话术闭环：真实 QiWe 群内发送 101 → 先发《吕富靖相关信息》提示语，同时保留 101 小程序卡链路");
      const patientReply = require("./patient_reply.js");
      const reply929 = await patientReply.buildPatientReply({ doctorId:active.id, text:"929", patientName:"网页咨询者", isGroup:true, suppressPatientName:true });
      const text929 = patientReply.responsesToQiweText(reply929, "网页咨询者", { omitPatientName:true });
      ok(!/感谢您对吕主任的认可/.test(text929)
        && !(reply929.responses || []).some(x=>x && (x.type === "mp" || x.page === "story")),
        "编号 929 已下线：不再下发感谢信固定话术/写感谢信卡片");

      const prevTad2 = process.env.TRIAGE_AI_DISABLED;
      process.env.TRIAGE_AI_DISABLED = "1";
      try{
        const atAsk = (await bridge.handleCallbackBody({ data:[{
          guid:"test-guid-123456", cmd:15000, msgType:2,
          userId:"self-user-1", senderId:"gate-at-1", receiverId:"self-user-1", fromRoomId:WRG,
          senderName:"咨询患者", msgUniqueIdentifier:"qiwe-gate-at-" + Date.now(), msgData:{ content:"@小助手 我想问诊" }
        }] })).results[0] || {};
        ok(atAsk.skipped !== "group_chitchat" && (atAsk.sent === true || atAsk.reviewOnly === true),
          "群接管门控：@小助手 的普通咨询 → 进入回复/待审链路");
      }finally{
        if(prevTad2 === undefined) delete process.env.TRIAGE_AI_DISABLED; else process.env.TRIAGE_AI_DISABLED = prevTad2;
      }

      const high = (await bridge.handleCallbackBody({ data:[{
        guid:"test-guid-123456", cmd:15000, msgType:2,
        userId:"self-user-1", senderId:"gate-high-1", receiverId:"self-user-1", fromRoomId:WRG,
        senderName:"高危患者", msgUniqueIdentifier:"qiwe-gate-high-" + Date.now(), msgData:{ content:"我胸痛呼吸困难" }
      }] })).results[0] || {};
      const highSess = db.prepare("SELECT status FROM triage_sessions WHERE patient_key=? ORDER BY id DESC LIMIT 1").get("qiwe:gate-high-1");
      ok(high.skipped !== "group_chitchat" && (high.sent === true || high.reviewOnly === true) && highSess && highSess.status === "needs_human",
        "群接管门控：未 @ 的高危症状 → 不静默，进入高危/转人工链路");

      // 群风控 Phase A1 报警接线（2026-07-09）：不 @ 助手的刷群广告 → 门控仍静默（回复主流程一字不变），
      // 但 processEvent 在 gate 之前已调 community.recordGroupModeration 落 moderation_flag 给医助看板（放 gate 之后=最该抓的全漏）。
      {
        const spamMid = "qiwe-gate-spam-" + Date.now();
        const beforeSpamOut = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=?").get(WRG).c;
        const spam = (await bridge.handleCallbackBody({ data:[{
          guid:"test-guid-123456", cmd:15000, msgType:2,
          userId:"self-user-1", senderId:"gate-spam-1", receiverId:"self-user-1", fromRoomId:WRG,
          senderName:"刷群账号", msgUniqueIdentifier:spamMid, msgData:{ content:"加我微信代购海外保健品，优惠券秒杀" }
        }] })).results[0] || {};
        const afterSpamOut = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=?").get(WRG).c;
        const spamRow = db.prepare("SELECT moderation_flag,moderation_keys,risk_level,group_id FROM community_messages WHERE external_msg_id=?").get(spamMid);
        ok(spam.skipped === "group_chitchat" && afterSpamOut === beforeSpamOut,
          "群风控接线：刷群广告不 @ 助手 → 门控仍静默 group_chitchat、不产欢迎/草稿/回复（回复主流程不变）");
        ok(!!spamRow && spamRow.moderation_flag === "offtopic" && (spamRow.moderation_keys || "").length > 0,
          "群风控接线：被 gate 静默的刷群广告仍落 community_messages 报警行（moderation_flag='offtopic'，gate 之前扫、不漏）");
        ok(!!spamRow && spamRow.risk_level == null,
          "群风控接线：报警行不写 risk_level（与医疗分诊三档完全隔离）");
        const spamGrp = spamRow && db.prepare("SELECT channel_type,external_group_id FROM community_groups WHERE id=?").get(spamRow.group_id);
        ok(!!spamGrp && spamGrp.channel_type === "wecom" && spamGrp.external_group_id === WRG,
          "群风控接线：报警行挂 channel_type='wecom' 的群行（与 db.js 真实企微群映射同约定，不裂群）");
        // 同消息重放（同 msgUniqueIdentifier）：processEvent 的 skipReason 去重（qiwe_seen 表）在 moderation 钩子之前先挡 → 报警行不重复落
        const replay = (await bridge.handleCallbackBody({ data:[{
          guid:"test-guid-123456", cmd:15000, msgType:2,
          userId:"self-user-1", senderId:"gate-spam-1", receiverId:"self-user-1", fromRoomId:WRG,
          senderName:"刷群账号", msgUniqueIdentifier:spamMid, msgData:{ content:"加我微信代购海外保健品，优惠券秒杀" }
        }] })).results[0] || {};
        ok(replay.skipped === "duplicate" && db.prepare("SELECT COUNT(*) c FROM community_messages WHERE external_msg_id=?").get(spamMid).c === 1,
          "群风控接线：同 msgUniqueIdentifier 重放 → processEvent 去重先挡，报警行不重复落");
        // 正常病情群消息（同样被 gate 静默）不产生报警行——宁漏不误伤
        const chatMid = "qiwe-gate-chat2-" + Date.now();
        await bridge.handleCallbackBody({ data:[{
          guid:"test-guid-123456", cmd:15000, msgType:2,
          userId:"self-user-1", senderId:"gate-chat-2", receiverId:"self-user-1", fromRoomId:WRG,
          senderName:"闲聊患者乙", msgUniqueIdentifier:chatMid, msgData:{ content:"最近胃胀睡不好" }
        }] });
        ok(db.prepare("SELECT COUNT(*) c FROM community_messages WHERE external_msg_id=?").get(chatMid).c === 0,
          "群风控接线：正常病情闲聊（gate 静默）不落任何 community_messages 行（宁漏不误伤、不污染）");
      }

      qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1," + WR });
    }

    // (a) 普通群发言：即使该 senderId 首次被系统处理，也不能近似为「新入群」发欢迎。
    const wCountBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c;
    const vCountBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='member_visit' AND target_name=?").get(WR).c;
    const first = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"np-1", receiverId:"self-user-1", fromRoomId:WR,
      senderName:"新患者小李", msgUniqueIdentifier:"qiwe-welcome-first-" + Date.now(), msgData:{ content:"101" }
    }] })).results[0] || {};
    ok(first.sent === true, "入群欢迎收口：老成员/普通成员首条群消息本身仍正常回复（101 自动发，不被欢迎打断）");
    ok(db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c === wCountBefore,
      "入群欢迎收口：普通群消息不再因 senderId 首现而自动发欢迎");
    ok(db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='member_visit' AND target_name=?").get(WR).c === vCountBefore,
      "入群欢迎收口：普通群消息不再生成「新患者到访」提醒");
    let visitRow = null;

    const cfgVoice = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:16,
      userId:"self-user-1", senderId:"patient-voice-cfg", receiverId:"self-user-1",
      senderName:"语音患者", msgServerId:"voice-empty-config-" + Date.now()
    }] })).results[0] || {};
    const cfgVoiceRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(cfgVoice.outboxId || 0);
    ok(cfgVoice.voiceFailed === true && cfgVoiceRow && /运营语音/.test(cfgVoiceRow.text || ""),
      "运营配置闭环：QiWe 语音转写失败草稿优先使用 scripts.voice 话术");

    const cfgMedia = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:3,
      userId:"self-user-1", senderId:"patient-media-cfg", receiverId:"self-user-1",
      senderName:"资料患者", msgUniqueIdentifier:"qiwe-media-config-" + Date.now(), msgData:{ mediaId:"img-cfg" }
    }] })).results[0] || {};
    const cfgMediaRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(cfgMedia.outboxId || 0);
    ok(cfgMedia.nonText === true && cfgMediaRow && /运营资料/.test(cfgMediaRow.text || ""),
      "运营配置闭环：QiWe 图片/文件等非文字兜底草稿优先使用 scripts.nonText 话术");

    // (a2) 真实企微常见：小助手自动欢迎被回调成群消息 → 解析新人姓名，只触发欢迎，不把小助手当患者回复。
    const joinHint = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"assistant-bot-1", receiverId:"self-user-1", fromRoomId:WR,
      senderName:"小助手(纪小娟)", msgUniqueIdentifier:"qiwe-join-hint-" + Date.now(),
      msgData:{ content:"一琳 您好，欢迎加入吕富靖主任消化健康群 👋\n⭐点击【医患联络表】提交基础信息。" }
    }] })).results[0] || {};
    const joinHintRow = db.prepare("SELECT * FROM outbound_queue WHERE source='welcome' AND target_name=? ORDER BY id DESC LIMIT 1").get(WR);
    const badAssistantOut = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=? AND text LIKE ?").get(WR, "%@小助手%").c;
    ok(joinHint.skipped === "member_join_hint_processed" && joinHint.memberName === "一琳"
      && joinHintRow && /^@一琳/.test(joinHintRow.text || "") && badAssistantOut === 0,
      "方案B：小助手欢迎语只解析新人一琳并 @新人，不再生成 @小助手 的患者回复");
    const wPayload = JSON.parse((joinHintRow && joinHintRow.payload) || "{}");
    ok(joinHintRow && joinHintRow.status === "sent" && joinHintRow.target_type === "qiwe_room"
      && /^@一琳/.test(joinHintRow.text || "")
      && /欢迎加入吕富靖主任建立的【院外公益健康群】/.test(joinHintRow.text || "")
      && /点击【医患联络表】/.test(joinHintRow.text || "")
      && /“1”/.test(joinHintRow.text || "")
      && /视频问候/.test(joinHintRow.text || "")
      && !/运营欢迎|姓名\+疾病|发送 101|发送 303|找医生确认|转人工|群名待甲方确认|黑便/.test(joinHintRow.text || ""),
      "明确入群提示：自动发固定入群欢迎（source=welcome/status=sent，@新人+联络表+发1菜单+医生视频问候，无旧运营长文）");
    ok(wPayload.qiwe && wPayload.qiwe.toId === WR, "明确入群提示：欢迎行 payload.qiwe.toId=roomId（autoSend 关时医助可在审核台确认发到群）");
    ok(wPayload.qiwe && Array.isArray(wPayload.qiwe.weappCodes) && wPayload.qiwe.weappCodes.join(",") === "联络表,808",
      "明确入群提示：欢迎行 payload 带两张小程序卡 code（联络表 + 808）供确认发送路径复用");
    ok(Array.isArray(wPayload.sentCards) && wPayload.sentCards.map(x=>x.code).join(",") === "联络表,808" && !wPayload.cardErrors,
      "明确入群提示：autoSend 开时固定欢迎语后已依次发送医患联络表卡 + 医生介绍卡");
    visitRow = db.prepare("SELECT * FROM outbound_queue WHERE source='member_visit' AND target_name=? ORDER BY id DESC LIMIT 1").get(WR);
    const vPayload = JSON.parse((visitRow && visitRow.payload) || "{}");
    ok(visitRow && visitRow.status === "pending" && /运营到访/.test(visitRow.text || "") && /新患者到访/.test(visitRow.text || ""),
      "明确入群提示：同时给医助一条「新患者到访」提醒（source=member_visit/status=pending，审核台/侧边栏可见）");
    ok(!(vPayload.qiwe && vPayload.qiwe.toId), "明确入群提示：到访提醒 payload 不含 qiwe.toId → 不可外发到任何人（护栏1）");
    const namedCountBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c;
    await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"1688857254811888", receiverId:"self-user-1", fromRoomId:WR,
      senderName:"一琳", msgUniqueIdentifier:"qiwe-join-hint-real-user-" + Date.now(), msgData:{ content:"1" }
    }] });
    const namedCountAfter = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c;
    ok(namedCountAfter === namedCountBefore,
      "方案B：小助手欢迎语已登记新人姓名，后续同名真实 userId 首次发言不重复欢迎");

    const realH = qiwe.sendHyperText, realT = qiwe.sendText, realW = qiwe.sendWeapp;
    let hCall = null, tCall = null, wCalls = [];
    qiwe.sendHyperText = async (toId, text, opts)=>{ hCall = { toId, text, opts }; return { code:0, msg:"ok" }; };
    qiwe.sendText = async (toId, text)=>{ tCall = { toId, text }; return { code:0, msg:"ok" }; };
    qiwe.sendWeapp = async (toId, tpl)=>{ wCalls.push({ toId, tpl }); return { code:0, msg:"ok" }; };
    try{
      await bridge.fireGroupWelcome({ fromRoomId:"room-direct-at", senderId:"1688857254811415", senderName:"新患者小周" }, qiwe.loadConfig(), active.id);
    }finally{
      qiwe.sendHyperText = realH;
      qiwe.sendText = realT;
      qiwe.sendWeapp = realW;
    }
    ok(hCall && hCall.toId === "room-direct-at" && hCall.opts && hCall.opts.atUserIds[0] === "1688857254811415" && !tCall
      && wCalls.map(x=>x.tpl && x.tpl.code).join(",") === "联络表,808",
      "方案B：首现欢迎拿到真实数字 userId 时用 sendHyperText @新入群成员，并连发联络表+医生介绍卡");

    // (b) 二次发言：同群同人继续不重复欢迎
    const wCountAfter1 = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c;
    await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"np-1", receiverId:"self-user-1", fromRoomId:WR,
      senderName:"新患者小李", msgUniqueIdentifier:"qiwe-welcome-second-" + Date.now(), msgData:{ content:"1" }
    }] });
    const wCountAfter2 = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='welcome' AND target_name=?").get(WR).c;
    ok(wCountAfter1 === wCountBefore + 1 && wCountAfter2 === wCountAfter1, "入群欢迎收口：只有明确入群提示新增 1 条欢迎；普通二次发言不重复欢迎");

    // (c) 红线不破（三档口径更新 2026-07-02）：普通群成员发高危病情 → 不触发欢迎；
    //     该消息按三档 high 自动发急诊/120 指引（不推 101 线上问诊），且会话仍 needs_human 进分诊台（自动发≠取消人工）。
    const med = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"np-2", receiverId:"self-user-1", fromRoomId:WR,
      senderName:"新患者小王", msgUniqueIdentifier:"qiwe-welcome-med-" + Date.now(), msgData:{ content:"我胸痛还呼吸困难" }
    }] })).results[0] || {};
    ok(med.sent === true && /120|急诊/.test(med.replyPreview || "") && !/「101」|发「101」/.test(med.replyPreview || "") && !/胸痛|呼吸困难/.test(med.replyPreview || ""),
      "入群欢迎收口红线（三档）：普通群成员急危病情 → 自动发急诊/120 指引（零线上问诊推销、零病情复述）");
    const npSess = db.prepare("SELECT status FROM triage_sessions WHERE patient_key=? ORDER BY id DESC LIMIT 1").get("qiwe:np-2");
    ok(npSess && npSess.status === "needs_human", "方案B红线（三档）：高危自动发后会话仍 needs_human 进分诊台（人工跟进不丢）");
    ok(db.prepare("SELECT COUNT(*) c FROM qiwe_room_member_seen WHERE room_id=? AND sender_id=?").get(WR, "np-2").c === 0,
      "入群欢迎收口：普通高危消息不登记首现、不触发欢迎");

    // (d) 单聊(dm)不触发首现欢迎（无「进群」语义）
    const vBeforeDm = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='member_visit'").get().c;
    qiwe.saveConfig({ allowGroup:false, testToId:"self-user-1" });
    await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"dm-new-1", receiverId:"self-user-1",
      senderName:"单聊新用户", msgUniqueIdentifier:"qiwe-welcome-dm-" + Date.now(), msgData:{ content:"101" }
    }] });
    const vAfterDm = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='member_visit'").get().c;
    ok(vAfterDm === vBeforeDm, "方案B：单聊首条消息不触发入群欢迎/到访提醒（只群内触发）");

    // (e) autoSend 关：明确入群提示的欢迎落 pending（医助确认发），不自动真发
    const WR2 = "room-welcome-2";
    qiwe.saveConfig({ enabled:true, autoSend:false, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1," + WR2 });
    await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"assistant-bot-2", receiverId:"self-user-1", fromRoomId:WR2,
      senderName:"小助手(纪小娟)", msgUniqueIdentifier:"qiwe-welcome-pending-" + Date.now(),
      msgData:{ content:"小张 您好，欢迎加入吕富靖主任消化健康群 👋" }
    }] });
    const welcomeRow2 = db.prepare("SELECT * FROM outbound_queue WHERE source='welcome' AND target_name=? ORDER BY id DESC LIMIT 1").get(WR2);
    ok(welcomeRow2 && welcomeRow2.status === "pending" && /^@小张/.test(welcomeRow2.text || ""), "明确入群提示：autoSend 关 → 欢迎落 pending（医助确认发，不自动真发）");
    const pendingPayload = JSON.parse((welcomeRow2 && welcomeRow2.payload) || "{}");
    ok(pendingPayload.qiwe && pendingPayload.qiwe.toId === WR2 && pendingPayload.qiwe.weappCodes.join(",") === "联络表,808",
      "明确入群提示：pending 欢迎 payload 同样带联络表+808，供医助确认发送时连发卡片");
    {
      const realText = qiwe.sendText, realWeapp = qiwe.sendWeapp;
      let sentText = null, sentWeapps = [];
      qiwe.sendText = async (toId, text)=>{ sentText = { toId, text }; return { code:0, msg:"ok" }; };
      qiwe.sendWeapp = async (toId, tpl)=>{ sentWeapps.push({ toId, tpl }); return { code:0, msg:"ok" }; };
      try{
        const deliveredWelcome = await bridge.deliverOutbox(welcomeRow2, qiwe.loadConfig());
        ok(deliveredWelcome.sent === true
          && sentText && sentText.toId === WR2
          && sentWeapps.map(x=>x.tpl && x.tpl.code).join(",") === "联络表,808"
          && (deliveredWelcome.sentParts || []).map(x=>x.code).filter(Boolean).join(",") === "联络表,808",
          "明确入群提示：医助确认 pending 欢迎时先发固定文本，再连发医患联络表卡 + 医生介绍卡");
      }finally{
        qiwe.sendText = realText;
        qiwe.sendWeapp = realWeapp;
      }
    }

    // (f) 到访提醒不可外发（护栏验证）：channel=qiwe 但无 toId → setOutboxStatus 落 V1 兜底仅标 sent，deliverOutbox 缺 toId 抛错
    let visitDeliverThrew = false;
    try{ await bridge.deliverOutbox(visitRow, qiwe.loadConfig()); }catch(e){ visitDeliverThrew = true; }
    ok(visitDeliverThrew, "方案B：到访提醒行经 deliverOutbox 因缺 toId 抛错 → 绝不真发（护栏2）");

    // (g) 越界群反例（codex 红线复核补）：testToId 只含本人(不含 roomId) → 群消息越界 → outside_test_scope 跳过，绝不触发欢迎/到访/真发
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, selfUserId:"self-user-1", testToId:"self-user-1" });
    const outScopeRes = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:2,
      userId:"self-user-1", senderId:"np-out", receiverId:"self-user-1", fromRoomId:"room-out",
      senderName:"越界群新患者", msgUniqueIdentifier:"qiwe-welcome-outscope-" + Date.now(), msgData:{ content:"101" }
    }] })).results[0] || {};
    ok(outScopeRes.skipped === "outside_test_scope", "方案B越界：testToId仅本人(不含roomId)→群消息 outside_test_scope 跳过（idAllowed群范围以roomId为准，本人在白名单也不放行越界群）");
    ok(db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE target_name=?").get("room-out").c === 0, "方案B越界：越界群不产生任何欢迎/到访行 → 绝不真发到未白名单群");
    ok(db.prepare("SELECT COUNT(*) c FROM qiwe_room_member_seen WHERE room_id=?").get("room-out").c === 0, "方案B越界：越界群不登记首现");

    // 收尾恢复默认
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  }

  // ===== 图片/文件/视频等非文字消息「降级兜底」：识别非文字→落 pending 转人工，绝不自动发；安全闸不漏 =====
  // 不碰 qiweapi 图片字段/媒体接口（未知不猜），粗粒度 !isText 兜底。msgType=3 = 非 0/2(文本)/16(语音)/78(卡片)，msgData 无 appId+pagePath → isWeapp=false。
  {
    // ① 非文字聊天消息（在白名单内，autoSend 开）→ pending 转人工草稿，absolutely 不自动发，患者话术零医学内容
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
    const nonText = (await bridge.handleCallbackBody({ data:[{
      guid:"test-guid-123456", cmd:15000, msgType:3,
      userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者",
      msgUniqueIdentifier:"qiwe-nontext-" + Date.now(), msgData:{ mediaId:"img-xyz" }
    }] })).results[0] || {};
    ok(nonText.reviewOnly === true && nonText.sent !== true && nonText.nonText === true && nonText.needsHuman === true && !!nonText.outboxId,
      "非文字消息（autoSend 开）→ reviewOnly 转人工草稿，绝不自动发（sent≠true，永远 pending）");
    const ntRow = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(nonText.outboxId);
    ok(ntRow && ntRow.channel_type === "qiwe" && ntRow.status === "pending" && ntRow.source === "qiwe_media" && ntRow.priority === "high" && ntRow.target_type === "qiwe_dm",
      "非文字草稿：channel_type='qiwe'/status='pending'/source='qiwe_media'/priority='high'/target_type='qiwe_dm'");
    ok(ntRow && /收到/.test(ntRow.text || "") && !/诊断|病情|用药|症状|检查报告|吃药|处方/.test(ntRow.text || ""),
      "非文字草稿：患者侧纯服务话术（收到+人工跟进），零医学内容（无诊断/病情/用药/症状/检查报告）");
    const ntPayload = JSON.parse((ntRow && ntRow.payload) || "{}");
    ok(ntPayload.qiwe && ntPayload.qiwe.toId === "patient-1" && ntPayload.source === "qiwe_media" && ntPayload.qiwe.needsHuman === true,
      "非文字草稿 payload：qiwe.toId=发件人（医助确认可发）+ source=qiwe_media + needsHuman");

    // ② 安全闸不漏（兜底没把 self/越界/群禁/重复 漏进 pending）
    // (a) 自发非文字 → self_message 跳过，不落草稿
    const ntSelf = (await bridge.handleCallbackBody({ data:[{
      cmd:15000, msgType:3, userId:"self-user-1", senderId:"self-user-1", receiverId:"patient-1",
      msgUniqueIdentifier:"qiwe-nontext-self-" + Date.now(), msgData:{ mediaId:"img-self" }
    }] })).results[0] || {};
    ok(ntSelf.skipped === "self_message" && !ntSelf.outboxId, "非文字兜底不漏：自发非文字消息 → self_message 跳过（不落草稿）");
    // (b) 越界（testToId 不含 sender/receiver）非文字 → outside_test_scope 跳过
    qiwe.saveConfig({ testToId:"someone-else" });
    const ntOut = (await bridge.handleCallbackBody({ data:[{
      cmd:15000, msgType:3, userId:"self-user-1", senderId:"patient-9", receiverId:"patient-8", senderName:"越界患者",
      msgUniqueIdentifier:"qiwe-nontext-out-" + Date.now(), msgData:{ mediaId:"img-out" }
    }] })).results[0] || {};
    ok(ntOut.skipped === "outside_test_scope" && !ntOut.outboxId, "非文字兜底不漏：越界（不在测试白名单）非文字消息 → outside_test_scope 跳过（不落草稿）");
    // (c) 重复非文字（同 msgUniqueIdentifier 两次）→ 第二次 duplicate，只一条草稿
    qiwe.saveConfig({ testToId:"self-user-1" });
    const ntDupId = "qiwe-nontext-dup-" + Date.now();
    const ntDupEvt = { data:[{ cmd:15000, msgType:3, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", senderName:"测试患者", msgUniqueIdentifier:ntDupId, msgData:{ mediaId:"img-dup" } }] };
    const ntBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_media'").get().c;
    const ntd1 = (await bridge.handleCallbackBody(ntDupEvt)).results[0] || {};
    const ntd2 = (await bridge.handleCallbackBody(ntDupEvt)).results[0] || {};
    const ntAfter = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_media'").get().c;
    ok(ntd1.reviewOnly === true && ntd2.skipped === "duplicate" && ntAfter === ntBefore + 1, "非文字兜底不漏：同一非文字消息重放 → 第二次 duplicate，只新增一条草稿（去重）");
    // (d) 群未放开非文字 → group_disabled 跳过
    qiwe.saveConfig({ allowGroup:false, testToId:"self-user-1,room-nt" });
    const ntGrp = (await bridge.handleCallbackBody({ data:[{
      cmd:15000, msgType:3, userId:"self-user-1", senderId:"patient-1", receiverId:"self-user-1", fromRoomId:"room-nt", senderName:"群患者",
      msgUniqueIdentifier:"qiwe-nontext-grp-" + Date.now(), msgData:{ mediaId:"img-grp" }
    }] })).results[0] || {};
    ok(ntGrp.skipped === "group_disabled" && !ntGrp.outboxId, "非文字兜底不漏：群未放开时非文字群消息 → group_disabled 跳过（不落草稿）");
    // (e) codex 红线反例——越界伪造：省略 userId + sender/receiver 均不在白名单 + testToId=selfUserId。
    //     loggedInUserId 回落 self-user-1(∈白名单) 会过 voiceSkipReason→idAllowed(松)，但转人工路径用 idAllowedStrict(去 loggedInUserId 自回落) 挡住 → outside_test_scope，绝不落草稿。
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
    const ntForgeBefore = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_media'").get().c;
    const ntForge = (await bridge.handleCallbackBody({ data:[{
      cmd:15000, msgType:3, senderId:"patient-9", receiverId:"patient-8", senderName:"越界伪造",
      msgUniqueIdentifier:"qiwe-nontext-forge-" + Date.now(), msgData:{ mediaId:"img-forge" }
    }] })).results[0] || {};   // 故意不带 userId → normalizeEvent loggedInUserId 回落 selfUserId
    const ntForgeAfter = db.prepare("SELECT COUNT(*) c FROM outbound_queue WHERE source='qiwe_media'").get().c;
    ok(ntForge.skipped === "outside_test_scope" && ntForgeAfter === ntForgeBefore,
      "非文字兜底不漏（codex 反例）：省略 userId 的越界伪造(loggedInUserId 回落 self∈白名单)→ idAllowedStrict 挡住 outside_test_scope，绝不落转人工草稿");
    // (f) 非文字缺 replyToId（sender/receiver 皆空）→ voiceSkipReason missing_reply_to 跳过，不落草稿
    const ntNoReply = (await bridge.handleCallbackBody({ data:[{
      cmd:15000, msgType:3, userId:"", senderId:"", receiverId:"", senderName:"无回执方",
      msgUniqueIdentifier:"qiwe-nontext-noreply-" + Date.now(), msgData:{ mediaId:"img-noreply" }
    }] })).results[0] || {};
    ok(ntNoReply.skipped === "missing_reply_to" && !ntNoReply.outboxId, "非文字兜底不漏：缺 replyToId（sender/receiver 皆空）→ missing_reply_to 跳过（不落草稿）");

    // 收尾恢复默认
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:false, selfUserId:"self-user-1", testToId:"self-user-1" });
  }

  // ==== 大整数 ID 保真（真实抓包实锤 2026-07-03·甲方真机）====
  //   真实 qiweapi 推送的 senderId/receiverId/fromRoomId 是数字；测试群 roomId 10730375163571533（17 位）超 JS 安全整数 →
  //   JSON.parse 丢精度变 …532 → 与白名单 "…533" 失配 → 真实群消息被 idAllowed→outside_test_scope 误挡。preserveBigIntIds 在 JSON.parse 前把 15+ 位数字值串化保精度。
  //   ⚠ 断言必须用【原始 JSON 字符串】构造，绝不能用 JS 数字字面量 10730375163571533（字面量本身就丢精度）。
  {
    // ① 纯函数：15+ 位数字值串化保真、10 位时间戳不受影响、字符串内容不受影响
    const RAW_BIG = '{"fromRoomId":10730375163571533,"senderId":1688857254811415,"msgData":{"content":"你好"},"timestamp":1783060192}';
    const parsedBig = JSON.parse(preserveBigIntIds(RAW_BIG));
    ok(parsedBig.fromRoomId === "10730375163571533", "大整数保真：17 位 fromRoomId 串化为 \"10730375163571533\"（精度不丢，超安全整数）");
    ok(parsedBig.senderId === "1688857254811415", "大整数保真：16 位 senderId 串化保真（\"1688857254811415\"）");
    ok(parsedBig.timestamp === 1783060192, "大整数保真：10 位时间戳不受影响（仍为数字 1783060192，15 位阈值不误伤秒级时间戳）");
    ok(parsedBig.msgData && parsedBig.msgData.content === "你好", "大整数保真：字符串内容不受影响（嵌套 msgData.content=你好）");
    // 对照：不经保真直接 JSON.parse → 丢精度（证明修复必要性）；用原始字符串，绝不用数字字面量
    const naive = JSON.parse(RAW_BIG);
    ok(String(naive.fromRoomId) !== "10730375163571533", "对照：不保真直接 JSON.parse → fromRoomId 丢精度（String 化≠原值，故白名单会失配）");

    // ①A 字符串感知（codex 反例A·2026-07-03）：患者文本内的身份证等长数字（含冒号+逗号）绝不被误伤——
    //   旧纯正则不知在字符串里 → 命中 content 内的 :110101199003074321, → 替换后 JSON 非法 → 兜底 {} → 真实消息丢失（18 位身份证在医疗消息极常见）。
    //   字符串感知单遍扫描：字符串内容原样保留、JSON 合法、值位置大整数照样保真。⚠ 必须用原始 JSON 字符串构造。
    const RAW_IDCARD = '{"msgData":{"content":"身份证:110101199003074321,请查"},"fromRoomId":10730375163571533}';
    const parsedId = JSON.parse(preserveBigIntIds(RAW_IDCARD));   // 不抛错 = JSON 合法（旧正则会在此产生非法 JSON）
    ok(parsedId.msgData.content === "身份证:110101199003074321,请查",
      "①A 字符串感知：患者文本内身份证(含冒号+逗号+18位)原样保留、JSON 合法（旧正则会误伤致消息丢失）");
    ok(parsedId.fromRoomId === "10730375163571533",
      "①A 字符串感知：字符串内数字不动的同时，值位置 17 位 fromRoomId 仍保真为字符串");
    // 转义引号嵌套：字符串内 \" 转义正确，内部 :123456789012345678 不误伤，值位置 roomId 保真
    const RAW_ESC = '{"content":"他说\\"我的号:123456789012345678\\"了","roomId":10730375163571533}';
    const parsedEsc = JSON.parse(preserveBigIntIds(RAW_ESC));
    ok(parsedEsc.content === '他说"我的号:123456789012345678"了' && parsedEsc.roomId === "10730375163571533",
      "①A 转义嵌套：字符串含 \\\" 转义时内部数字不误伤、JSON 合法、值位置 roomId 保真");
    // 小数/科学计数不误伤（非纯整数值 → 不是 ID）
    ok(JSON.parse(preserveBigIntIds('{"x":123456789012345.6}')).x === 123456789012345.6,
      "①A 边界：15+ 位小数不串化（后随小数点非 ,}] → 非纯整数 JSON 值，不误伤）");

    // ② 端到端：保真后的群消息事件走 normalizeEvent+idAllowed（cfg.testToId 含该大整数 roomId、allowGroup:true）→ 不再 outside_test_scope
    const BIG_ROOM = "10730375163571533";
    const bigCfg = qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:BIG_ROOM, enabled:true, autoSend:false, allowGroup:true });
    // 原始回调 body（数字 fromRoomId/senderId，群文本消息）→ preserveBigIntIds 保真 → JSON.parse
    const RAW_BODY = '{"data":[{"guid":"test-guid-123456","cmd":15000,"msgType":2,"fromRoomId":10730375163571533,"senderId":1688857254811999,"receiverId":1688857254811415,"senderName":"群患者","msgUniqueIdentifier":"qiwe-bigint-e2e-'+Date.now()+'","msgData":{"content":"你好医生"}}]}';
    const bodyBig = JSON.parse(preserveBigIntIds(RAW_BODY));
    const e2e = (await bridge.handleCallbackBody(bodyBig, bigCfg)).results[0] || {};
    ok(e2e.skipped !== "outside_test_scope", "端到端·保真：大整数 roomId 群消息经 preserveBigIntIds → idAllowed 通过白名单（不再 outside_test_scope 误挡）");
    // 反证：同一原始 body 不经保真直接 JSON.parse（丢精度）→ String 化后与白名单失配 → outside_test_scope
    const bodyNaive = JSON.parse(RAW_BODY);
    const e2eNaive = (await bridge.handleCallbackBody(bodyNaive, bigCfg)).results[0] || {};
    ok(e2eNaive.skipped === "outside_test_scope", "端到端·反证：不保真的大整数 roomId 群消息丢精度 → idAllowed 白名单失配 → outside_test_scope（证明保真必要）");
    // 收尾恢复默认
    qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });
  }

  // ===== 甲方 2026-07-06：h5_webview 四码（302〔旧414〕/919/808/联络表）优先 weapp、成功即抑制冗余兜底链接卡（codex 复核缺口补测）=====
  // 判据：这四码 seed 自带就绪 weapp 模板（qiwe_weapp_templates 行·封面三件套；414 经 2026-07-09 docx codes patch 迁 302），同规则又带 /?p=<key> 域名深链卡 + 外链问卷/官网卡。
  //   ① weapp 真发成功 → 该编号不再发兜底 link_card（去冗余）；② weapp 未就绪/发送失败 → 兜底 link_card 仍在（fail-closed 反证·链接永不丢）。
  {
    const H5CODES = ["302", "919", "808", "联络表"];
    const savedOriginW = process.env.PUBLIC_ORIGIN;
    process.env.PUBLIC_ORIGIN = "https://demo.example.com";   // 深链卡补全为绝对 https 才成卡（否则相对深链 fail-closed 跳过、无卡可测）
    const cfgW = qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });
    for(const c of H5CODES){
      const replyW = await require("./patient_reply.js").buildPatientReply({ doctorId:active.id, text:c, patientName:"网页咨询者", isGroup:true, suppressPatientName:true });
      const planW = bridge.prepareDelivery(active.id, replyW, "网页咨询者", { isGroup:true });
      // 前置断言：该码确实 weappReady 且带待抑制兜底卡（否则本用例无意义）
      ok(planW.weappReady === true && (planW.linkCards || []).length >= 1 && (planW.weappSuppressLinkUrls instanceof Set) && planW.weappSuppressLinkUrls.size >= 1,
        `h5_webview 前置：编号 ${c} weapp 就绪且带 ≥1 张待抑制兜底链接卡（weappSuppressLinkUrls 非空）`);
      // ① weapp 成功 → 发出 weapp、不再发该编号兜底 link_card；被抑制的卡记 link_card_suppressed
      const okRes = await bridge.deliverReplyToQiwe({ cfg:cfgW, doctorId:active.id, reply:replyW, toId:"self-user-1", patientName:"网页咨询者", isGroup:true });
      const sentWeapp = (okRes.sentParts || []).some(p=>p.type === "weapp");
      const sentLink = (okRes.sentParts || []).some(p=>p.type === "link_card");
      const suppressed = (okRes.results || []).filter(r=>r.type === "link_card_suppressed");
      ok(sentWeapp && !sentLink && suppressed.length >= 1,
        `①deliverReplyToQiwe：编号 ${c} weapp 成功 → 发 weapp、不再发兜底 link_card（去冗余，抑制 ${suppressed.length} 张）`);
      // ①(outbox) 医助确认发送路径同型：按 pending 草稿 payload（code + linkCards）走 deliverOutbox
      const payloadW = { qiwe:{ toId:"self-user-1", code:planW.code, mpFallbackText:"", atUserId:"", hasMiniProgram:planW.hasMiniProgram, weappReadyAtDraft:planW.weappReady, linkCards:planW.linkCards || [] }, source:replyW.source || "" };
      const okOut = await bridge.deliverOutbox({ doctor_id:active.id, text:planW.replyText || "", payload:JSON.stringify(payloadW) }, cfgW);
      const outWeapp = (okOut.sentParts || []).some(p=>p.type === "weapp");
      const outLink = (okOut.sentParts || []).some(p=>p.type === "link_card");
      ok(outWeapp && !outLink,
        `①deliverOutbox：编号 ${c} weapp 成功 → 发 weapp、不再发兜底 link_card（医助确认发送同型去冗余）`);
    }
    // ② fail-closed 反证：sendWeapp 失败 → 兜底 link_card 仍在（链接永不丢）。stub sendWeapp 抛错，测完恢复。
    const origSendWeapp = qiwe.sendWeapp;
    qiwe.sendWeapp = async ()=>{ throw new Error("stub weapp send failure"); };
    try{
      for(const c of H5CODES){
        const replyF = await require("./patient_reply.js").buildPatientReply({ doctorId:active.id, text:c, patientName:"网页咨询者", isGroup:true, suppressPatientName:true });
        const planF = bridge.prepareDelivery(active.id, replyF, "网页咨询者", { isGroup:true });
        const expectUrls = (planF.linkCards || []).map(x=>x.linkUrl);
        const failRes = await bridge.deliverReplyToQiwe({ cfg:cfgW, doctorId:active.id, reply:replyF, toId:"self-user-1", patientName:"网页咨询者", isGroup:true });
        const sentLinkUrls = (failRes.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
        const noSuppress = !(failRes.results || []).some(r=>r.type === "link_card_suppressed");
        const allLinksSent = expectUrls.length > 0 && expectUrls.every(u=>sentLinkUrls.includes(u));
        const noWeappPart = !(failRes.sentParts || []).some(p=>p.type === "weapp");
        ok(allLinksSent && noSuppress && noWeappPart,
          `②fail-closed(deliverReplyToQiwe)：编号 ${c} sendWeapp 失败 → ${expectUrls.length} 张兜底 link_card 全部照发、无抑制（链接永不丢）`);
        // ②(outbox) 同型反证
        const payloadF = { qiwe:{ toId:"self-user-1", code:planF.code, mpFallbackText:planF.weappFallbackText || "", atUserId:"", hasMiniProgram:planF.hasMiniProgram, weappReadyAtDraft:planF.weappReady, linkCards:planF.linkCards || [] }, source:replyF.source || "" };
        const failOut = await bridge.deliverOutbox({ doctor_id:active.id, text:planF.replyText || "", payload:JSON.stringify(payloadF) }, cfgW);
        const outLinkUrls = (failOut.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
        ok(expectUrls.every(u=>outLinkUrls.includes(u)),
          `②fail-closed(deliverOutbox)：编号 ${c} sendWeapp 失败 → 兜底 link_card 全部照发（医助确认发送路径链接永不丢）`);
      }
    } finally {
      qiwe.sendWeapp = origSendWeapp;   // 必恢复，勿污染后续
    }
    // ②b fail-closed 反证（codex 跨厂复核 2026-07-06·与「②抛错」不同的另一反例）：sendWeapp resolved 但回执 code:0/isSendSuccess:0
    //   （HTTP/API 成功、业务未发出）→ weapp 视为未真发（不记 weapp part、不抑制）→ 兜底 link_card 仍全部照发（链接永不丢）。
    const origSendWeapp0 = qiwe.sendWeapp;
    qiwe.sendWeapp = async ()=>({ code:0, msg:"ok", data:{ isSendSuccess:0 } });   // resolved 但业务未发
    try{
      for(const c of H5CODES){
        const reply0 = await require("./patient_reply.js").buildPatientReply({ doctorId:active.id, text:c, patientName:"网页咨询者", isGroup:true, suppressPatientName:true });
        const plan0 = bridge.prepareDelivery(active.id, reply0, "网页咨询者", { isGroup:true });
        const expectUrls0 = (plan0.linkCards || []).map(x=>x.linkUrl);
        const res0 = await bridge.deliverReplyToQiwe({ cfg:cfgW, doctorId:active.id, reply:reply0, toId:"self-user-1", patientName:"网页咨询者", isGroup:true });
        const sentLinkUrls0 = (res0.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
        const noSuppress0 = !(res0.results || []).some(r=>r.type === "link_card_suppressed");
        const noWeappPart0 = !(res0.sentParts || []).some(p=>p.type === "weapp");   // isSendSuccess 假 → 不记为已发 weapp（口径一致）
        const allSent0 = expectUrls0.length > 0 && expectUrls0.every(u=>sentLinkUrls0.includes(u));
        ok(allSent0 && noSuppress0 && noWeappPart0,
          `②b fail-closed(deliverReplyToQiwe)：编号 ${c} sendWeapp resolved 但 isSendSuccess:0 → 不记 weapp、不抑制、${expectUrls0.length} 张兜底 link_card 全照发（链接永不丢）`);
        // ②b(outbox) 同型反证
        const payload0 = { qiwe:{ toId:"self-user-1", code:plan0.code, mpFallbackText:plan0.weappFallbackText || "", atUserId:"", hasMiniProgram:plan0.hasMiniProgram, weappReadyAtDraft:plan0.weappReady, linkCards:plan0.linkCards || [] }, source:reply0.source || "" };
        const out0 = await bridge.deliverOutbox({ doctor_id:active.id, text:plan0.replyText || "", payload:JSON.stringify(payload0) }, cfgW);
        const outLinkUrls0 = (out0.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
        const outNoWeapp0 = !(out0.sentParts || []).some(p=>p.type === "weapp");
        ok(outNoWeapp0 && expectUrls0.every(u=>outLinkUrls0.includes(u)),
          `②b fail-closed(deliverOutbox)：编号 ${c} sendWeapp resolved 但 isSendSuccess:0 → 不记 weapp、兜底 link_card 全照发（医助确认发送路径链接永不丢）`);
      }
    } finally {
      qiwe.sendWeapp = origSendWeapp0;   // 必恢复，勿污染后续
    }
    // ②c fail-closed 反证（codex 第 3 轮硬化 2026-07-06）：isSendSuccess 字符串假值的大写/前后空白变体（"False" / " false "）
    //   须经 .trim().toLowerCase() 归一化后仍判「未真发」→ 不误抑制兜底卡（否则大写/空白漏判成"已发"→链接丢）。
    const origSendWeappStr = qiwe.sendWeapp;
    for(const variant of ["False", " false "]){
      qiwe.sendWeapp = async ()=>({ code:0, msg:"ok", data:{ isSendSuccess:variant } });   // resolved，假值大写/空白变体
      try{
        const c = "302";
        const replyS = await require("./patient_reply.js").buildPatientReply({ doctorId:active.id, text:c, patientName:"网页咨询者", isGroup:true, suppressPatientName:true });
        const planS = bridge.prepareDelivery(active.id, replyS, "网页咨询者", { isGroup:true });
        const expectUrlsS = (planS.linkCards || []).map(x=>x.linkUrl);
        const resS = await bridge.deliverReplyToQiwe({ cfg:cfgW, doctorId:active.id, reply:replyS, toId:"self-user-1", patientName:"网页咨询者", isGroup:true });
        const sentLinkUrlsS = (resS.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
        const noSuppressS = !(resS.results || []).some(r=>r.type === "link_card_suppressed");
        const noWeappS = !(resS.sentParts || []).some(p=>p.type === "weapp");
        const allSentS = expectUrlsS.length > 0 && expectUrlsS.every(u=>sentLinkUrlsS.includes(u));
        ok(allSentS && noSuppressS && noWeappS,
          `②c fail-closed：编号 ${c} isSendSuccess:"${variant}"（大写/空白假值）归一化后判未真发 → 不记 weapp、不抑制、${expectUrlsS.length} 张兜底 link_card 全照发（链接永不丢）`);
      } finally {
        qiwe.sendWeapp = origSendWeappStr;   // 必恢复，勿污染后续
      }
    }
    // ③ 精度反证（不误伤别的编号）：合并回复携带「就绪 weapp 那条规则的 mp」+「另一编号的 link 卡」→ weapp 成功只抑制本规则兜底，别的编号 link 卡照发。
    //   构造：302（旧414）的 mp（进 weapp 抑制集）+ 一张不属于 302 规则的独立外链卡（bfh.com.cn，不在 302 的 weappSuppressLinkUrls 内）。
    const mixedReply = { code:"302", source:"keyword_rule", responses:[
      { type:"mp", title:"住院预约", page:"admission", external:{ provider:"春雨医生", label:"住院预约问卷", service:"住院预约问卷", url:"https://www.chunyuyisheng.com/rec/j1dwloa3ht" } },
      { type:"link", title:"住院办理流程（他码外链）", external:{ provider:"北京友谊医院官网", url:"https://www.bfh.com.cn/Html/News/Articles/5419.html" } }
    ] };
    const mixedRes = await bridge.deliverReplyToQiwe({ cfg:cfgW, doctorId:active.id, reply:mixedReply, toId:"self-user-1", patientName:"测试患者" });
    const mixedSentLinks = (mixedRes.sentParts || []).filter(p=>p.type === "link_card").map(p=>p.linkUrl);
    const mixedSuppressed = (mixedRes.results || []).filter(r=>r.type === "link_card_suppressed").map(r=>r.linkUrl);
    ok((mixedRes.sentParts || []).some(p=>p.type === "weapp")
      && mixedSentLinks.some(u=>/bfh\.com\.cn/.test(u))                       // 别的编号外链卡照发
      && mixedSuppressed.some(u=>/chunyuyisheng\.com\/rec\/j1dwloa3ht/.test(u)) // 本规则 mp 兜底 url 被抑制
      && !mixedSentLinks.some(u=>/chunyuyisheng\.com\/rec\/j1dwloa3ht/.test(u)),
      "③精度：合并回复里 weapp 成功只抑制本规则兜底 url、不属于本规则的外链卡（bfh）照发（不误伤别的编号 attach 卡）");
    if(savedOriginW === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = savedOriginW;
    qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1", enabled:true, autoSend:true, allowGroup:false });
  }

  // ===== QiWe 分诊医生归属收口：只看当前 QiWe 医生 + 只看可见群 =====
  {
    const otherDoctor = db.prepare("SELECT id,name FROM doctors WHERE id<>? ORDER BY id LIMIT 1").get(active.id);
    ok(!!otherDoctor, "分诊收口前置：存在第二位医生用于隔离校验");
    ok(typeof qiweShared.currentQiweDoctorId === "function", "分诊收口：shared 导出 currentQiweDoctorId");
    ok(typeof qiweShared.resolveDirectDoctorId === "function", "分诊收口：shared 导出 resolveDirectDoctorId");
    ok(typeof messagesAdmin.buildQiweTriageScope === "function", "分诊收口：messages-admin 导出 buildQiweTriageScope");
    if(otherDoctor && typeof qiweShared.currentQiweDoctorId === "function" && typeof qiweShared.resolveDirectDoctorId === "function" && typeof messagesAdmin.buildQiweTriageScope === "function"){
      qiwe.saveConfig({ doctorId:active.id, token:"test-token-123456", guid:"test-guid-123456", selfUserId:"self-user-1", testToId:"self-user-1,room-triage-vis", enabled:true, autoSend:true, allowGroup:true });
      ok(qiweShared.currentQiweDoctorId(qiwe.loadConfig()) === active.id, "分诊收口：currentQiweDoctorId 取当前 QiWe 配置医生");
      ok(qiweShared.resolveDirectDoctorId({ isGroup:false }, qiwe.loadConfig()) === active.id, "分诊收口：QiWe 私聊只归当前配置医生，不回退别的医生");

      const visRoom = "room-triage-vis-" + Date.now();
      const hidRoom = "room-triage-hide-" + Date.now();
      db.prepare(`INSERT INTO community_groups(
        doctor_id,external_group_id,name,channel_type,status,is_business,data_source,qiwe_hidden,review_mode,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(active.id, visRoom, "可见企微群", "qiwe", "active", 1, "qiwe", 0, "human_review", new Date().toISOString(), new Date().toISOString());
      db.prepare(`INSERT INTO community_groups(
        doctor_id,external_group_id,name,channel_type,status,is_business,data_source,qiwe_hidden,review_mode,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(active.id, hidRoom, "隐藏企微群", "qiwe", "active", 1, "qiwe", 1, "human_review", new Date().toISOString(), new Date().toISOString());

      const insMsg = db.prepare(`INSERT INTO message_log(
        doctor_id,patient_id,patient_name,sender_id,channel,direction,text,level,level_label,action_taken,ai_draft,triage_session_id,group_id,reply_status,source_message_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      insMsg.run(active.id, null, "当前医生私聊患者", "patient-scope-a", "qiwe", "inbound", "当前医生私聊", 2, "L2", "needs_human", null, null, null, "pending", null, new Date().toISOString());
      insMsg.run(otherDoctor.id, null, "他医私聊患者", "patient-scope-b", "qiwe", "inbound", "他医私聊", 2, "L2", "needs_human", null, null, null, "pending", null, new Date().toISOString());
      insMsg.run(active.id, null, "当前医生可见群患者", "patient-scope-c", "qiwe", "inbound", "可见群消息", 2, "L2", "needs_human", null, null, visRoom, "pending", null, new Date().toISOString());
      insMsg.run(active.id, null, "当前医生隐藏群患者", "patient-scope-d", "qiwe", "inbound", "隐藏群消息", 2, "L2", "needs_human", null, null, hidRoom, "pending", null, new Date().toISOString());
      insMsg.run(otherDoctor.id, null, "他医可见群患者", "patient-scope-e", "qiwe", "inbound", "他医群消息", 2, "L2", "needs_human", null, null, visRoom, "pending", null, new Date().toISOString());

      const scope = messagesAdmin.buildQiweTriageScope(active.id);
      const scopedRows = db.prepare(`SELECT id,text FROM message_log WHERE doctor_id=? ${scope.sql} ORDER BY id`).all(active.id, ...scope.params);
      const scopedTexts = scopedRows.map(r=>r.text);
      ok(scopedTexts.includes("当前医生私聊"), "分诊收口：当前 QiWe 医生私聊仍可见");
      ok(scopedTexts.includes("可见群消息"), "分诊收口：当前 QiWe 医生的可见企微群消息仍可见");
      ok(!scopedTexts.includes("隐藏群消息"), "分诊收口：qiwe_hidden=1 的旧群消息不进分诊台");
      ok(!scopedTexts.includes("他医群消息"), "分诊收口：别的医生 QiWe 群消息不进当前分诊台");
    }
  }

  console.log("\n检查项: " + n + "  失败: " + fails.length);
  if(fails.length){ console.log("✗ 失败：\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("✓ QiWe 单聊桥离线自测通过");
})();
