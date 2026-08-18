"use strict";
/* QiWe 出站投递：prepareDelivery / deliverReplyToQiwe / deliverOutbox */
const S = require("./shared");
const cards = require("./cards");
const media = require("./media");
const {
  qiwe,
  responsesToQiweText, miniProgramResponses,
  splitReplyBubbles, resolveReplyBubbleConfig,
  sleep, delayTextBeforeRich,
  atMemberIdSendable, atBodySeparatorForSource
} = S;
const {
  replyCode, nativeWeappAllowedResponse, linkCards, enrichLinkCardsWithTemplateThumb, weappRuleLinkUrls, weappSendConfirmed,
  codeNativeWeappAllowed, templateNativeWeappAllowed, resolveWeappDelivery, resolveMultiWeappCodes,
  loadSendableWeappTemplate, shortLinkForWeappCode,
  WELCOME_WEAPP_CODES, loadWelcomeWeappTemplate,
  welcomeCodeFallbackLinkCards, welcomeCodeFallbackTexts
} = cards;
const { resolvePosterAsset, resolvePosterAssetByCode } = media;

function prepareDelivery(doctorId, reply, patientName, options){
  options = options || {};
  if(doctorId) qiwe.syncWeappTemplatesFromRules(doctorId);
  const primaryCode = replyCode(reply);
  const allMiniResponses = miniProgramResponses(reply);
  const miniResponses = allMiniResponses.filter(nativeWeappAllowedResponse);
  const articleLinkCards = enrichLinkCardsWithTemplateThumb(doctorId, primaryCode, linkCards(reply));
  // 缺陷一修（2026-07-03 夜）：主编号模板不就绪时从 native-allowed mp 响应反查就绪模板（见 resolveWeappDelivery），
  // code/template/weappReady 三者同源替换——101 等就绪真卡不再被首编号（饮食）拖成文本短链+扫码裸文案。
  const resolved = resolveWeappDelivery(doctorId, primaryCode, miniResponses);
  const code = resolved.code;
  const template = resolved.template;
  const multiWeappCodes = resolveMultiWeappCodes(doctorId, miniResponses);
  // multi weapp (e.g. 626 -> 626a/626b)
  let hasReadyTemplate = resolved.ready;
  let weappCodes = [];
  if(multiWeappCodes.length >= 2){
    weappCodes = multiWeappCodes.slice();
    const anyReady = weappCodes.some(c=>{
      try{ loadSendableWeappTemplate(doctorId, c); return true; }catch(e){ return false; }
    });
    if(anyReady) hasReadyTemplate = true;
  }else if(hasReadyTemplate && code){
    weappCodes = [code];
  }
  const textOptions = {
    omitMiniPrograms:hasReadyTemplate,
    omitQr:hasReadyTemplate,
    // 有卡片就不发文本链接（甲方 2026-07-03）：会真成链接卡片(articleLinkCards)的响应，文本里整条省略——同一链接不再既发卡又发文本行。
    // 与 articleLinkCards 同口径（willBecomeLinkCard↔linkCardFromResponse）：PUBLIC_ORIGIN 空→相对深链不成卡→文本行保留（不丢链接）。
    omitLinkCards:true,
    omitPatientName:!!options.isGroup
  };
  const replyText = responsesToQiweText(reply, patientName, textOptions);
  // omitLinkCards:true（codex 2026-07-03 同型核查·修）：weappFallbackText 是原生卡 sendWeapp 失败时的文本回落，取 allMiniResponses；
  //   若某 mp 响应带 external.url（既进 allMiniResponses → weappFallbackText，又被 linkCardFromResponse 认成卡 → articleLinkCards），
  //   原生卡失败回落发 weappFallbackText（含该 url 文本行）+ linkCards 循环又发同 url 卡 → 重复。与 mpFallbackText/draftText 同口径省略成卡响应。
  //   不成卡场景（PUBLIC_ORIGIN 空的相对深链等）照旧保留文本（willBecomeLinkCard=false，链接不丢·fail-closed 对齐）。
  const weappFallbackText = hasReadyTemplate
    ? responsesToQiweText({ responses:allMiniResponses }, patientName, { omitLinkCards:true, omitPatientName:!!options.isGroup })
    : "";
  // 兜底链接卡抑制清单（甲方 2026-07-06·h5_webview 四码优先 weapp、成功即不重发冗余兜底链接卡）：
  //   仅当模板就绪(hasReadyTemplate)时，收集「实发 weapp 那条规则(code)」会成卡的 linkUrl —— 这些是同编号指向同一服务的
  //   /?p=<key> 域名深链卡 + 外链问卷/官网卡，weapp 卡成功发出后即冗余。⚠️ 只在「sendWeapp 真发成功」的投递点用来跳过对应卡；
  //   weapp 未就绪 / 发送失败一律不用（linkCards 照发、链接永不丢·fail-closed，见 deliverReplyToQiwe/deliverOutbox）。
  //   低危 LLM 合并回复里别的编号(attach)的 link 卡不在本清单内 → 永不被压制（只压实发 weapp 那条规则的兜底）。
  const weappSuppressLinkUrls = hasReadyTemplate ? weappRuleLinkUrls(doctorId, code) : new Set();
  return {
    code,
    replyText,
    hasMiniProgram:allMiniResponses.length > 0,
    weappReady:hasReadyTemplate,
    weappTemplate:template,
    weappCodes,
    weappFallbackText,
    weappSuppressLinkUrls,
    weappPublic:template ? {
      code:template.code,
      title:template.title,
      ready:template.ready,
      missing:template.missing || [],
      updatedAt:template.updatedAt || ""
    } : null,
    linkCards:articleLinkCards
  };
}

async function sendPlainTextBubbles(toId, text, cfg, options){
  options = options || {};
  const bubbleCfg = options.bubbleCfg || {};
  const parts = splitReplyBubbles(text, bubbleCfg);
  const delayMs = Number.isFinite(bubbleCfg.delayMs) ? bubbleCfg.delayMs : 420;
  if(!parts.length) return { parts:[], results:[] };
  const results = [];
  for(let i = 0; i < parts.length; i++){
    if(i > 0) await sleep(delayMs);
    const part = parts[i];
    const r = await qiwe.sendText(toId, part, cfg);
    results.push({ part, result:r });
  }
  return { parts, results };
}

async function deliverReplyToQiwe(input){
  const cfg = input.cfg || qiwe.loadConfig();
  const bubbleCfg = resolveReplyBubbleConfig(input.doctorId);
  const plan = prepareDelivery(input.doctorId, input.reply, input.patientName, { isGroup:!!input.isGroup });
  const toId = input.toId;
  const sentParts = [];
  const results = [];
  const poster = qiwe.sendImageExperimentalOn() ? resolvePosterAsset(input.doctorId, input.reply) : null;
  let textRichDelayMs = 0;
  if(plan.replyText){
    // @指定成员（群回复@患者本人，input.atUserId）优先于 @所有人（广播）——患者回复场景只会有 atMember，二者互斥取其一（if/else-if 顺序保证）。
    // 各自需对应实验开关 ON 才真发 @；开关默认关 → atMember/needAt 恒 false → 走原 sendText（默认行为零变化）。sendHyperText 失败回落 sendText（@降级为文字）。
    // 缺陷二修：atUserId 须纯数字（atMemberIdSendable）才走 @，非数字 userId 会被 qiweapi 按 0=@所有人渲染（生产实拍）。
    const atMember = atMemberIdSendable(input.atUserId) && qiwe.atMemberExperimentalOn();
    const needAt = !!input.needAtAll && qiwe.atallExperimentalOn();
    const atBodySep = atBodySeparatorForSource((input.reply && input.reply.source) || input.source || "");
    if(atMember){
      try{
        const r = await qiwe.sendHyperText(toId, plan.replyText, { atUserIds:[input.atUserId], atBodySep }, cfg);
        sentParts.push({ type:"hypertext_atmember", preview:plan.replyText.slice(0, 80), atUserIds:[input.atUserId] });
        results.push({ type:"hypertext_atmember", result:r, atUserIds:[input.atUserId] });
      }catch(e){
        const r = await qiwe.sendText(toId, plan.replyText, cfg);
        sentParts.push({ type:"text_atmember_fallback", preview:plan.replyText.slice(0, 80), error:e.message });
        results.push({ type:"text_atmember_fallback", result:r, error:e.message });
      }
    }else if(needAt){
      try{
        const r = await qiwe.sendHyperText(toId, plan.replyText, { atAll:true, atBodySep }, cfg);
        sentParts.push({ type:"hypertext_atall", preview:plan.replyText.slice(0, 80) });
        results.push({ type:"hypertext_atall", result:r });
      }catch(e){
        const r = await qiwe.sendText(toId, plan.replyText, cfg);
        sentParts.push({ type:"text_atall_fallback", preview:plan.replyText.slice(0, 80), error:e.message });
        results.push({ type:"text_atall_fallback", result:r, error:e.message });
      }
    }else{
      const bubbles = splitReplyBubbles(plan.replyText, bubbleCfg);
      if(bubbles.length <= 1){
        const r = await qiwe.sendText(toId, plan.replyText, cfg);
        sentParts.push({ type:"text", preview:plan.replyText.slice(0, 80) });
        results.push({ type:"text", result:r });
      }else{
        const sent = await sendPlainTextBubbles(toId, plan.replyText, cfg, { bubbleCfg });
        sent.parts.forEach((part, idx)=>{
          sentParts.push({ type: idx === 0 ? "text" : "text_bubble", preview:part.slice(0, 80) });
          results.push({ type: idx === 0 ? "text" : "text_bubble", result:sent.results[idx] && sent.results[idx].result });
        });
      }
    }
  }
  textRichDelayMs = await delayTextBeforeRich(sentParts, !!plan.weappReady || (plan.linkCards || []).length > 0 || !!poster);
  // weapp 真发成功旗标（甲方 2026-07-06·h5_webview 四码优先 weapp、成功即抑制冗余兜底链接卡）：
  //   仅当 sendWeapp 真正成功才置 true → 下方 linkCards 循环据此跳过 plan.weappSuppressLinkUrls 里的兜底卡；
  //   weapp 未就绪 / sendWeapp 失败 → 恒 false → 兜底 linkCards 照发（链接永不丢·fail-closed，含既有反例3 失败回落路径）。
  let weappSent = false;
  const multiCodes = Array.isArray(plan.weappCodes) ? plan.weappCodes.filter(Boolean) : [];
  if(multiCodes.length >= 2){
    // 多卡连发（如 626）：逐张发；未就绪则回落该卡短链文本，不阻断其它卡。
    for(const c of multiCodes){
      try{
        const cardTpl = loadSendableWeappTemplate(input.doctorId, c);
        const r = await qiwe.sendWeapp(toId, cardTpl, cfg);
        if(!weappSendConfirmed(r)) throw new Error("weapp 回执未确认真发（isSendSuccess 假）");
        sentParts.push({ type:"weapp", code:cardTpl.code, title:cardTpl.title });
        results.push({ type:"weapp", result:r });
        weappSent = true;
      }catch(e){
        const tip = shortLinkForWeappCode((input.reply && input.reply.responses) || [], c)
          || String((qiwe.loadWeappTemplate(input.doctorId, c) || {}).sourceShortLink || "");
        if(tip){
          const r = await qiwe.sendText(toId, tip, cfg);
          sentParts.push({ type:"text_fallback", code:String(c), preview:tip.slice(0, 80), error:e.message });
          results.push({ type:"text_fallback", code:String(c), result:r, error:e.message });
        }else{
          console.error("[qiwe] multi weapp 发送失败：", c, "-", e.message);
          results.push({ type:"weapp_error", code:c, error:e.message });
        }
      }
    }
  }else if(plan.weappReady){
    try{
      const r = await qiwe.sendWeapp(toId, plan.weappTemplate, cfg);
      // codex 跨厂复核 fail-closed 反例修（2026-07-06）：promise 不抛错 ≠ 真发出——回执 code:0 却 isSendSuccess=0/false（业务未发）
      //   必须当失败处理，否则「记 weapp 成功 + 据此抑制兜底卡」→ 卡实际没发、链接也被跳过（破链接永不丢）。显式未发 → throw 进下方失败回落。
      //   「记为已发 weapp(sentParts)」与「据此抑制(weappSent)」同一判据 weappSendConfirmed，绝不错位。
      if(!weappSendConfirmed(r)) throw new Error("weapp 回执未确认真发（isSendSuccess 假）");
      sentParts.push({ type:"weapp", code:plan.code, title:plan.weappTemplate.title });
      results.push({ type:"weapp", result:r });
      weappSent = true;
    }catch(e){
      const fallback = plan.weappFallbackText || "";
      if(fallback){
        const r = await qiwe.sendText(toId, fallback, cfg);
        sentParts.push({ type:"text_fallback", preview:fallback.slice(0, 80), error:e.message });
        results.push({ type:"text_fallback", result:r, error:e.message });
      }else if(plan.linkCards && plan.linkCards.length){
        // codex 2026-07-03 反例3修：weappFallbackText 被 omitLinkCards 省略后为空（mp 会成卡时），旧 else 直接 throw → 后面 linkCards 循环不执行，
        //   URL 本应由链接卡承载却因抛错整条中断、卡不发。故有 linkCards 时不 throw：记 weapp 失败（results+console.error）、继续走 linkCards 循环由卡承载 URL。
        console.error("[qiwe] sendWeapp 失败，无 fallback 文本但有链接卡，转由链接卡承载：", plan.code, "-", e.message);
        results.push({ type:"weapp_error", code:plan.code, error:e.message });
      }else{
        throw e;   // 文本和卡都没有可发回落 → 保留原语义报错（完全无可发才 throw）
      }
    }
  }
  if(!textRichDelayMs){
    textRichDelayMs = await delayTextBeforeRich(sentParts, (plan.linkCards || []).length > 0 || !!poster);
  }
  // 抑制清单只在 weapp 真发成功时生效（fail-closed）：weappSent=false（未就绪/失败）→ 空集 → 所有兜底卡照发、链接永不丢。
  const suppress = weappSent && plan.weappSuppressLinkUrls instanceof Set ? plan.weappSuppressLinkUrls : new Set();
  for(const card of (plan.linkCards || [])){
    // 甲方 2026-07-06：weapp 已成功承载该规则服务 → 跳过其冗余兜底链接卡（同编号 /?p=<key> 深链卡 + 外链问卷/官网卡）。
    //   记 link_card_suppressed（不计入 sentParts）便于审计；别的编号(attach)的卡不在 suppress 集内、照发。
    if(card && suppress.has(card.linkUrl)){
      results.push({ type:"link_card_suppressed", code:plan.code, title:card.title, linkUrl:card.linkUrl });
      continue;
    }
    // 每张卡独立容错：/msg/sendLink 生产接口尚未真机验证（可能不存在/参数不符），单张抛错不得中断——
    // 否则已发的文本/weapp 回执丢失、后续卡片全不发、上层记整条失败。失败仅记 link_card_error（不计入 sentParts），继续下一张。
    try{
      const r = await qiwe.sendLink(toId, card, cfg);
      sentParts.push({ type:"link_card", title:card.title, linkUrl:card.linkUrl });
      results.push({ type:"link_card", result:r });
    }catch(e){
      console.error("[qiwe] sendLink 失败，跳过该链接卡片：", card.title, "-", e.message);
      results.push({ type:"link_card_error", title:card.title, error:e.message });
    }
  }
  // 818 海报真图（behind flag·关态零变化）：仅当 QIWE_SENDIMAGE_EXPERIMENTAL 开 且 image 响应解析到真实 /assets jpg 素材 →
  //   追加发一张真图；开关关（默认）→ 整条短路，image 响应不额外转成「【图片/海报】…」占位文本。
  //   独立容错（同 link_card）：单张失败不中断、不影响已发文本/卡片、不误标失败——SVG 生成海报无真实 jpg → resolvePosterAsset 返 null → 不发。
  if(qiwe.sendImageExperimentalOn()){
    if(poster){
      try{
        const r = await qiwe.sendImage(toId, { buffer:poster.buffer, filename:poster.filename, fileUrl:poster.fileUrl }, cfg);
        sentParts.push({ type:"image", filename:poster.filename });
        results.push({ type:"image", result:r });
      }catch(e){
        console.error("[qiwe] sendImage 失败，跳过海报图片：", poster.filename, "-", e.message);
        results.push({ type:"image_error", filename:poster.filename, error:e.message });
      }
    }
  }
  return {
    sent:sentParts.length > 0,
    sentParts,
    results,
    replyText:plan.replyText,
    weapp:plan.weappPublic,
    hasMiniProgram:plan.hasMiniProgram,
    textBeforeRichDelayMs:textRichDelayMs,
    linkCards:plan.linkCards || []
  };
}

/* 小程序卡片采集「信任闸」（H2 防投毒，红线#5）：
   除 enabled/configured/cmd/group 外，要求「严格真实自发」= 医助本人绑定账号(senderId===selfUserId)发的卡片才采集。
   ⚠️ 故意不用 idAllowed / loggedInUserId / isFromSelf 做采集判定 —— normalizeEvent 把缺省 userId 回落成 selfUserId
   (qiwe.js:500 loggedInUserId = raw.userId || cfg.selfUserId；qiwe.js:519 isFromSelf 含 senderId===loggedInUserId)，
   攻击者只要省略 userId、且 selfUserId∈testToId(常见配置)即可绕过 → 投毒 active 医生卡片。senderId 是真实发件人、不被该回落污染。
   selfUserId 未配 → 不采集(fail-closed)。
   口径 = V1 方案 A(医助自发)。若以后放宽到「患者也可分享官方卡片」(方案 B)，不能放松 sender 闸，需改走
   卡片 appId / 原始ID 白名单校验(校验是否春雨官方卡)——待甲方提供官方 appId/原始ID 再切。 */

function pickExternalMsgId(r){
  const d = (r && r.data) ? r.data : r;
  if(!d || typeof d !== "object") return null;
  const v = d.msgId || d.msgid || d.msgServerId || d.newMsgId || d.msg_id || d.clientMsgId || d.seq || "";
  return v ? String(v) : null;
}

/* H1：按 outbound_queue 行投递（医助在后台「确认发送」时由 community.setOutboxStatus 调用）。
   只吃持久化的 row（text + payload.qiwe.{toId,code,mpFallbackText}），不依赖活的 reply 对象，
   故与 deliverReplyToQiwe（autoSend / preview-reply 仍用）分开，不改后者。
   卡片按 code 重查 qiwe_weapp_templates：就绪→发原生卡片（失败回落文本）；未就绪→发小程序文本链接（链接不丢）。 */
async function deliverOutbox(row, cfg){
  cfg = cfg || qiwe.loadConfig();
  let payload = {};
  try{ payload = row && row.payload ? JSON.parse(row.payload) : {}; }catch(e){ payload = {}; }
  const q = (payload && payload.qiwe) || {};
  const toId = String(q.toId || "").trim();
  if(!toId) throw new Error("缺少企微接收方 ID（草稿未带 toId）");
  const doctorId = row.doctor_id;
  const bubbleCfg = resolveReplyBubbleConfig(doctorId);
  const code = String(q.code || "").trim();
  const outboxSource = String(payload.source || q.source || "");
  const weappCodes = Array.isArray(q.weappCodes)
    ? q.weappCodes.map(x=>{
        const c = String(x || "").trim();
        return c === "联络表" ? "979" : c;
      }).filter((x, i, arr)=>{
        if(!x || arr.indexOf(x) !== i) return false;
        if(outboxSource === "welcome") return WELCOME_WEAPP_CODES.includes(x);
        return true;
      })
    : [];
  const fallbackText = String(q.mpFallbackText || "");
  const text = String(row.text || "");
  const sentParts = [];
  const linkErrors = [];
  let externalMsgId = null;
  const cards = Array.isArray(q.linkCards) ? q.linkCards : [];
  // fail-closed（洞2）：草稿旗标 weappReadyAtDraft 之外，再按 code 当前规则响应重判 native-allowed（与 prepareDelivery 同源）——
  // 缺 weappReadyAtDraft 字段的旧行/手工 payload(===undefined) 不再默认放行；fallback_short_link 即便模板被同短链 hydrate 成 ready 也不发原生卡。
  const allowWeapp = (q.weappReadyAtDraft !== false) && codeNativeWeappAllowed(doctorId, code);
  const tplCandidate = allowWeapp && code ? qiwe.loadWeappTemplate(doctorId, code) : null;
  const tpl = templateNativeWeappAllowed(code, tplCandidate) ? tplCandidate : null;
  const poster = qiwe.sendImageExperimentalOn() ? resolvePosterAssetByCode(doctorId, code) : null;
  let textRichDelayMs = 0;
  if(text){
    // @指定成员（群回复@患者本人，payload.qiwe.atUserId）优先于 @所有人（广播，needAtAll）——患者回复场景只会有 atMember，二者互斥取其一（if/else-if 顺序保证）。
    // 各自需对应实验开关 ON 才真发 @；开关默认关 → atMember/needAt 恒 false → 走原 sendText（默认行为零变化）。sendHyperText 失败回落 sendText（@降级为文字）。
    // 缺陷二修：atUserId 须纯数字（atMemberIdSendable）才走 @，非数字 userId 会被 qiweapi 按 0=@所有人渲染（生产实拍，与 deliverReplyToQiwe 同修）。
    // @指定成员：实验开关 ON，或欢迎语草稿显式 forceAtMember（入群欢迎历史口径：数字 userId 必 @，不依赖实验开关）
    const atMember = atMemberIdSendable(q.atUserId) && (qiwe.atMemberExperimentalOn() || q.forceAtMember === true);
    const needAt = !!q.needAtAll && qiwe.atallExperimentalOn();
    const atBodySep = atBodySeparatorForSource((payload && payload.source) || q.source || "");
    if(atMember){
      try{
        const r = await qiwe.sendHyperText(toId, text, { atUserIds:[q.atUserId], atBodySep }, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"hypertext_atmember", preview:text.slice(0, 80), atUserIds:[q.atUserId] });
      }catch(e){
        const r = await qiwe.sendText(toId, text, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"text_atmember_fallback", preview:text.slice(0, 80), error:e.message });
      }
    }else if(needAt){
      try{
        const r = await qiwe.sendHyperText(toId, text, { atAll:true, atBodySep }, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"hypertext_atall", preview:text.slice(0, 80) });
      }catch(e){
        const r = await qiwe.sendText(toId, text, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"text_atall_fallback", preview:text.slice(0, 80), error:e.message });
      }
    }else{
      const bubbles = splitReplyBubbles(text, bubbleCfg);
      if(bubbles.length <= 1){
        const r = await qiwe.sendText(toId, text, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"text", preview:text.slice(0, 80) });
      }else{
        const sent = await sendPlainTextBubbles(toId, text, cfg, { bubbleCfg });
        sent.parts.forEach((part, idx)=>{
          if(idx === 0) externalMsgId = pickExternalMsgId(sent.results[0] && sent.results[0].result) || externalMsgId;
          sentParts.push({ type: idx === 0 ? "text" : "text_bubble", preview:part.slice(0, 80) });
        });
      }
    }
  }
  if(weappCodes.length){
    textRichDelayMs = await delayTextBeforeRich(sentParts, true);
    for(const c of weappCodes){
      try{
        const cardTpl = loadSendableWeappTemplate(doctorId, c);
        const r = await qiwe.sendWeapp(toId, cardTpl, cfg);
        if(!weappSendConfirmed(r)) throw new Error("weapp 回执未确认真发（isSendSuccess 假）");
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"weapp", code:cardTpl.code, title:cardTpl.title });
      }catch(e){
        console.error("[qiwe] deliverOutbox 欢迎卡发送失败：", c, "-", e.message);
        linkErrors.push({ type:"weapp_error", code:c, error:e.message });
        // 入群欢迎：小程序卡未就绪时改发规则链接卡；不再补发「请点击下方链接…」明文（链接由卡片承载）。
        const fallbackCards = welcomeCodeFallbackLinkCards(doctorId, c);
        let fallbackSent = false;
        for(const card of fallbackCards){
          try{
            const r = await qiwe.sendLink(toId, card, cfg);
            externalMsgId = pickExternalMsgId(r) || externalMsgId;
            sentParts.push({
              type:"link_card",
              code:String(c),
              title:String(card && card.title || "").slice(0, 80),
              linkUrl:String(card && card.linkUrl || "").slice(0, 160)
            });
            fallbackSent = true;
          }catch(le){
            console.error("[qiwe] deliverOutbox 欢迎卡 H5 兜底失败：", c, "-", le.message);
            linkErrors.push({ type:"link_card_error", code:c, title:String(card && card.title || ""), error:le.message });
          }
        }
        if(!fallbackSent && String(c) !== "979" && String(c) !== "联络表"){
          for(const tip of welcomeCodeFallbackTexts(doctorId, c)){
            try{
              const r = await qiwe.sendText(toId, tip, cfg);
              externalMsgId = pickExternalMsgId(r) || externalMsgId;
              sentParts.push({ type:"text_fallback", code:String(c), preview:tip.slice(0, 80) });
              fallbackSent = true;
            }catch(te){
              console.error("[qiwe] deliverOutbox 欢迎卡文本兜底失败：", c, "-", te.message);
              linkErrors.push({ type:"text_fallback_error", code:c, error:te.message });
            }
          }
        }
        if(!fallbackSent){
          const tip = String((qiwe.loadWeappTemplate(doctorId, c) || {}).sourceShortLink || "");
          if(tip){
            try{
              const r = await qiwe.sendText(toId, tip, cfg);
              externalMsgId = pickExternalMsgId(r) || externalMsgId;
              sentParts.push({ type:"text_fallback", code:String(c), preview:tip.slice(0, 80) });
              fallbackSent = true;
            }catch(te){
              linkErrors.push({ type:"text_fallback_error", code:c, error:te.message });
            }
          }
        }
      }
    }
    // 有 weappCodes 时旧逻辑直接 return，会丢掉同 payload 的 linkCards（如周/王入群视频页）。
    // 无附加 linkCards/海报时仍可早退；有卡则继续下方 sendLink 循环。
    if(!cards.length && !(qiwe.sendImageExperimentalOn() && poster)){
      return linkErrors.length
        ? { sent:sentParts.length > 0, sentParts, externalMsgId, textBeforeRichDelayMs:textRichDelayMs, linkErrors }
        : { sent:sentParts.length > 0, sentParts, externalMsgId, textBeforeRichDelayMs:textRichDelayMs };
    }
  }
  textRichDelayMs = await delayTextBeforeRich(sentParts, !!(tpl && tpl.ready) || cards.length > 0 || !!poster);
  // weapp 真发成功旗标（甲方 2026-07-06，与 deliverReplyToQiwe 同修）：仅 sendWeapp 真正成功才置 true →
  //   下方 q.linkCards 循环据此跳过该编号规则的冗余兜底链接卡；未就绪 / 失败 → 恒 false → 兜底卡照发（链接永不丢·fail-closed）。
  let weappSent = false;
  if(tpl && tpl.ready){
    try{
      const r = await qiwe.sendWeapp(toId, tpl, cfg);
      // codex 跨厂复核 fail-closed 反例修（2026-07-06，与 deliverReplyToQiwe 同修）：回执 code:0 却 isSendSuccess=0/false（业务未发）
      //   → throw 进下方失败回落，绝不「记 weapp 成功 + 据此抑制兜底卡」（否则卡没发、链接也被跳过·破链接永不丢）。同一判据 weappSendConfirmed。
      if(!weappSendConfirmed(r)) throw new Error("weapp 回执未确认真发（isSendSuccess 假）");
      externalMsgId = pickExternalMsgId(r) || externalMsgId;
      sentParts.push({ type:"weapp", code:tpl.code, title:tpl.title });
      weappSent = true;
    }catch(e){
      if(fallbackText){
        const r = await qiwe.sendText(toId, fallbackText, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"text_fallback", preview:fallbackText.slice(0, 80), error:e.message });
      }else if(Array.isArray(q.linkCards) && q.linkCards.length){
        // codex 2026-07-03 反例3修（同 deliverReplyToQiwe）：mpFallbackText 被 omitLinkCards 省略后为空时，旧 else 直接 throw → 后面 linkCards 循环不执行、卡不发、整条中断。
        //   故有 q.linkCards 时不 throw：记 weapp 失败（console.error）、继续走后面的 linkCards 循环由卡承载 URL。
        console.error("[qiwe] deliverOutbox sendWeapp 失败，无 fallback 文本但有链接卡，转由链接卡承载：", code, "-", e.message);
        linkErrors.push({ type:"weapp_error", code, error:e.message });
      }else{
        throw e;   // 文本和卡都没有可发回落 → 保留原语义报错
      }
    }
  }else if(fallbackText){
    const r = await qiwe.sendText(toId, fallbackText, cfg);
    externalMsgId = pickExternalMsgId(r) || externalMsgId;
    sentParts.push({ type:"text_fallback", preview:fallbackText.slice(0, 80) });
  }
  if(!textRichDelayMs){
    textRichDelayMs = await delayTextBeforeRich(sentParts, cards.length > 0 || !!poster);
  }
  // 抑制清单只在 weapp 真发成功时生效（fail-closed，与 deliverReplyToQiwe 同源）：weappSent=false（未就绪/失败）→ 空集 → 兜底卡照发、链接永不丢。
  //   deliverOutbox 只吃持久化行、无活 reply，故按持久化的实发编号 code 反查该规则会成卡的 linkUrl（weappRuleLinkUrls，与 prepareDelivery 同口径）。
  const suppress = weappSent ? weappRuleLinkUrls(doctorId, code) : new Set();
  for(const card of cards){
    // 甲方 2026-07-06（同 deliverReplyToQiwe）：weapp 已成功承载该编号服务 → 跳过其冗余兜底链接卡；别的编号(attach)的卡不在 suppress 集内、照发。
    //   仅审计 console.log、不塞 linkErrors（那是失败通道、只在有失败时改返回结构）：抑制是正常去重、非失败，无失败时返回结构零变化。
    if(card && suppress.has(String(card.linkUrl || ""))){
      console.log("[qiwe] deliverOutbox weapp 成功，抑制该规则冗余兜底链接卡：", code, "-", String(card && card.title || ""));
      continue;
    }
    // 每张卡独立容错（同 deliverReplyToQiwe）：/msg/sendLink 生产接口尚未真机验证，单张抛错不得中断——
    // 否则已发的文本/weapp 回执丢失、后续卡片不发、上层记整条失败。失败仅记 linkErrors（不计入 sentParts），继续下一张。
    try{
      const r = await qiwe.sendLink(toId, card, cfg);
      externalMsgId = pickExternalMsgId(r) || externalMsgId;
      sentParts.push({ type:"link_card", title:String(card && card.title || "").slice(0, 80), linkUrl:String(card && card.linkUrl || "").slice(0, 160) });
    }catch(e){
      console.error("[qiwe] deliverOutbox sendLink 失败，跳过该链接卡片：", String(card && card.title || ""), "-", e.message);
      linkErrors.push({ type:"link_card_error", title:String(card && card.title || "").slice(0, 80), error:e.message });
    }
  }
  // 818 海报真图（behind flag·关态零变化，与 deliverReplyToQiwe 同修）：仅当 QIWE_SENDIMAGE_EXPERIMENTAL 开 且
  //   按 code 反查该规则含海报 image 响应 + 解析到真实 /assets jpg → 追加发一张真图；开关关（默认）→ 整条短路（现状不变）。
  //   独立容错：单张失败不中断、记 image_error 不计入 sentParts（与 link_card 同口径）。SVG 生成海报无真实 jpg → resolvePosterAssetByCode 返 null → 不发。
  if(qiwe.sendImageExperimentalOn()){
    if(poster){
      try{
        const r = await qiwe.sendImage(toId, { buffer:poster.buffer, filename:poster.filename, fileUrl:poster.fileUrl }, cfg);
        externalMsgId = pickExternalMsgId(r) || externalMsgId;
        sentParts.push({ type:"image", filename:poster.filename });
      }catch(e){
        console.error("[qiwe] deliverOutbox sendImage 失败，跳过海报图片：", poster.filename, "-", e.message);
        linkErrors.push({ type:"image_error", filename:poster.filename, error:e.message });
      }
    }
  }
  // linkErrors 仅在有失败时附加，不改无失败时的返回结构；文本主体已发时 sent 判定不受卡片失败影响。
  return linkErrors.length
    ? { sent:sentParts.length > 0, sentParts, externalMsgId, textBeforeRichDelayMs:textRichDelayMs, linkErrors }
    : { sent:sentParts.length > 0, sentParts, externalMsgId, textBeforeRichDelayMs:textRichDelayMs };
}


module.exports = {
  prepareDelivery,
  sendPlainTextBubbles,
  deliverReplyToQiwe,
  deliverOutbox,
  pickExternalMsgId,
  textBeforeRichDelayMs: S.textBeforeRichDelayMs,
  delayTextBeforeRich,
  hasSentTextPart: S.hasSentTextPart
};
