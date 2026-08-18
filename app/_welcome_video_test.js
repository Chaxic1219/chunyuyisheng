"use strict";
/**
 * 入群欢迎：
 * - 有 outbound join 编排：weappCodes/linkCards 来自 join steps（prepareDelivery），不写死 979/808/视频卡
 * - 无 join：legacy = 文案 + welcomeWeappPayload / welcomeVideoLinkCard
 * Run: node _welcome_video_test.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chunyu-welcome-video-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.PUBLIC_ORIGIN = "https://yht.chunyutianxia.com";
process.env.QIWE_AT_MEMBER_EXPERIMENTAL = "0";

const { db } = require("./db.js");
const qiwe = require("./qiwe.js");
const bridge = require("./qiwe_bridge.js");
const cards = require("./modules/qiwe/cards.js");
const outbound = require("./modules/outbound/resolve.js");
const delivery = require("./modules/qiwe/delivery.js");
const { prepareDelivery } = delivery;

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  OK", msg);
  else { console.log("  FAIL", msg); failed++; }
}

function doctorBySlug(slug){
  return db.prepare("SELECT id, name, slug, content FROM doctors WHERE slug=?").get(slug);
}

function ensureWelcomeVideo(row, pagePath, cardTitle){
  const content = JSON.parse(row.content || "{}");
  content.welcomeVideo = {
    pagePath,
    cardTitle,
    cardDesc: "点击观看",
    iconUrl: ""
  };
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), row.id);
}

/** 与 fireGroupWelcome outbound 分支同口径：joinHit → prepareDelivery 期望的 codes/cards + 素材库 text */
function expectedFromJoin(doctorId, patientName){
  const joinHit = outbound.matchJoin(doctorId);
  if(!joinHit || !joinHit.responses || !joinHit.responses.length) return null;
  const firstMp = joinHit.responses.find(r =>
    r && (r.type === "mp" || r.type === "mini_program") && (r.weappCode || r.templateCode)
  );
  const reply = {
    code: firstMp ? String(firstMp.weappCode || firstMp.templateCode) : "welcome",
    responses: joinHit.responses,
    source: "outbound"
  };
  const plan = prepareDelivery(doctorId, reply, patientName, { isGroup: true });
  let weappCodes = Array.isArray(plan.weappCodes) ? plan.weappCodes.slice() : [];
  if(!weappCodes.length){
    weappCodes = cards.resolveMultiWeappCodes(doctorId, cards.nativeWeappResponses(reply));
  }
  weappCodes = cards.filterSendableWeappCodes(doctorId, weappCodes);
  const welcomeText = delivery.joinWelcomeTextFromResponses(joinHit.responses, patientName);
  return {
    joinHit,
    weappCodes,
    linkCards: Array.isArray(plan.linkCards) ? plan.linkCards : [],
    replyText: String(welcomeText || "").trim(),
    planReplyText: String(plan.replyText || "").trim()
  };
}

(async ()=>{
  try{
    const zhou = doctorBySlug("zhouyuchun");
    const wang = doctorBySlug("wangyuncheng");
    const lv = doctorBySlug("lvfujing") || db.prepare("SELECT id, name, slug, content FROM doctors ORDER BY id LIMIT 1").get();
    ok(!!zhou && !!wang && !!lv, "seed 含周/王/吕");
    ok(typeof cards.filterSendableWeappCodes === "function", "filterSendableWeappCodes 已导出");
    const zhou979 = cards.filterSendableWeappCodes(zhou.id, ["979"]);
    const zhouTpl = qiwe.loadWeappTemplate(zhou.id, "979");
    ok(!(zhou979.includes("979") && !(zhouTpl && zhouTpl.ready)), "未就绪 979 不得进入可发送列表");

    if(zhou) ensureWelcomeVideo(zhou, "/welcome-video/zhou.html", "周玉春主任视频问候");
    if(wang) ensureWelcomeVideo(wang, "/welcome-video/wang.html", "王云程主任视频问候");

    const zCard = cards.welcomeVideoLinkCard(zhou.id);
    ok(zCard && zCard.linkUrl === "https://yht.chunyutianxia.com/welcome-video/zhou.html"
      && zCard.title === "周玉春主任视频问候", "周 welcomeVideoLinkCard 拼绝对 URL");
    const wCard = cards.welcomeVideoLinkCard(wang.id);
    ok(wCard && wCard.linkUrl === "https://yht.chunyutianxia.com/welcome-video/wang.html", "王 welcomeVideoLinkCard");
    ok(!cards.welcomeVideoLinkCard(lv.id), "吕无 welcomeVideo → null");

    qiwe.saveConfig({
      enabled:true, autoSend:false, allowGroup:true,
      token:"tok", guid:"guid-wv",
      selfUserId:"self-1", testToId:"self-1,room-wv"
    });

    // --- 迁移后医生：join 编排决定 payload（非写死 979/视频）---
    const expZhou = expectedFromJoin(zhou.id, "新患者周测");
    ok(!!expZhou && !!expZhou.joinHit, "周：存在 outbound join 触发");
    const rZhou = await bridge.fireGroupWelcome(
      { fromRoomId:"room-zhou", senderId:"1688857254811415", senderName:"新患者周测" },
      qiwe.loadConfig(), zhou.id
    );
    const rowZhou = db.prepare("SELECT payload, text FROM outbound_queue WHERE id=?").get(rZhou.welcomeOutboxId);
    const pZhou = JSON.parse(rowZhou.payload || "{}");
    const tZhou = rowZhou.text || "";
    ok(Array.isArray(pZhou.qiwe.weappCodes)
      && pZhou.qiwe.weappCodes.join(",") === expZhou.weappCodes.join(","),
      "周：weappCodes 来自 join/prepareDelivery（" + expZhou.weappCodes.join(",") + "）");
    ok(JSON.stringify(pZhou.qiwe.linkCards || []) === JSON.stringify(expZhou.linkCards),
      "周：linkCards 来自 join（无 join 视频步则无欢迎视频卡）");
    ok(!!tZhou && /新患者周测/.test(tZhou), "周：欢迎语含 @姓名");
    if(expZhou.replyText){
      ok(tZhou.indexOf(expZhou.replyText) >= 0, "周：欢迎语与素材库 text 一致（不含 mp 标题行）");
      if(expZhou.planReplyText && expZhou.planReplyText !== expZhou.replyText){
        ok(/【医患联络表】\s*$/.test(expZhou.planReplyText), "周：prepareDelivery 在模板未就绪时会拼 mp 标题（已隔离）");
      }
    }

    const expWang = expectedFromJoin(wang.id, "新患者王测");
    ok(!!expWang && !!expWang.joinHit, "王：存在 outbound join 触发");
    const rWang = await bridge.fireGroupWelcome(
      { fromRoomId:"room-wang", senderId:"1688857254811416", senderName:"新患者王测" },
      qiwe.loadConfig(), wang.id
    );
    const pWang = JSON.parse((db.prepare("SELECT payload FROM outbound_queue WHERE id=?").get(rWang.welcomeOutboxId).payload) || "{}");
    ok(pWang.qiwe.weappCodes.join(",") === expWang.weappCodes.join(",")
      && JSON.stringify(pWang.qiwe.linkCards || []) === JSON.stringify(expWang.linkCards),
      "王：weappCodes/linkCards 来自 join/prepareDelivery");

    // deliverOutbox：按 join 编排实发（联络表 weapp 或 H5 兜底；视频仅当 join 含 link 步）
    const realW = qiwe.sendWeapp, realL = qiwe.sendLink, realH = qiwe.sendHyperText, realT = qiwe.sendText;
    const sent = { weapp:[], link:[] };
    qiwe.saveConfig({ enabled:true, autoSend:true, allowGroup:true, token:"tok", guid:"guid-wv", selfUserId:"self-1", testToId:"self-1,room-zhou-send" });
    qiwe.sendHyperText = async ()=>({ code:0, msg:"ok", data:{ msgId:"h1" } });
    qiwe.sendText = async ()=>({ code:0 });
    qiwe.sendWeapp = async (toId, tpl)=>{ sent.weapp.push(tpl && tpl.code); return { code:0, data:{ isSendSuccess:1 } }; };
    qiwe.sendLink = async (toId, card)=>{ sent.link.push(String(card && card.linkUrl || "")); return { code:0 }; };
    try{
      const rSend = await bridge.fireGroupWelcome(
        { fromRoomId:"room-zhou-send", senderId:"1688857254811415", senderName:"实发测" },
        qiwe.loadConfig(), zhou.id
      );
      ok(rSend.welcomeSent === true, "周 autoSend 欢迎已发");
      const expSend = expectedFromJoin(zhou.id, "实发测");
      if(expSend && expSend.weappCodes.includes("979")){
        const hasLiaison = sent.weapp.includes("979") || sent.weapp.includes("联络表")
          || sent.link.some(u=>/\/i\/|联络|contact/i.test(u) && !/welcome-video/.test(u));
        ok(hasLiaison, "实发：含医患联络表（weapp 或 H5 卡）");
      }else{
        ok(true, "实发：join 无 979，跳过联络表断言");
      }
      const expectVideo = (expSend.linkCards || []).some(c=>/welcome-video\/zhou\.html/.test(String(c.linkUrl || "")));
      if(expectVideo){
        ok(sent.link.some(u=>/welcome-video\/zhou\.html/.test(u)), "实发：join 含视频 link → 发出");
      }else{
        ok(!sent.link.some(u=>/welcome-video\/zhou\.html/.test(u)), "实发：join 无视频步 → 不发欢迎视频卡");
      }
    }finally{
      qiwe.sendWeapp = realW; qiwe.sendLink = realL; qiwe.sendHyperText = realH; qiwe.sendText = realT;
    }

    try{
      const lc = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(lv.id).content) || "{}");
      delete lc.welcomeVideo;
      db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(lc), lv.id);
    }catch(e){}
    qiwe.saveConfig({ enabled:true, autoSend:false, allowGroup:true, token:"tok", guid:"guid-wv", selfUserId:"self-1", testToId:"self-1,room-lv" });
    const expLv = expectedFromJoin(lv.id, "新患者吕测");
    ok(!!expLv && !!expLv.joinHit, "吕：存在 outbound join 触发");
    const rLv = await bridge.fireGroupWelcome(
      { fromRoomId:"room-lv", senderId:"1688857254811417", senderName:"新患者吕测" },
      qiwe.loadConfig(), lv.id
    );
    const pLv = JSON.parse((db.prepare("SELECT payload FROM outbound_queue WHERE id=?").get(rLv.welcomeOutboxId).payload) || "{}");
    ok(Array.isArray(pLv.qiwe.weappCodes)
      && pLv.qiwe.weappCodes.join(",") === expLv.weappCodes.join(",")
      && JSON.stringify(pLv.qiwe.linkCards || []) === JSON.stringify(expLv.linkCards),
      "吕：weappCodes/linkCards 来自 join（迁移后非硬编码 979,808）");

    // --- 未迁移医生：legacy welcomeVideo 路径 ---
    const legacyInfo = db.prepare("INSERT INTO doctors(slug,name,active,content) VALUES(?,?,1,?)").run(
      "welcome-legacy-" + Date.now(),
      "未迁移欢迎视频医生",
      JSON.stringify({
        welcomeVideo: {
          pagePath: "/welcome-video/legacy.html",
          cardTitle: "遗留视频问候",
          cardDesc: "点击观看",
          iconUrl: ""
        }
      })
    );
    const legacyId = legacyInfo.lastInsertRowid;
    // 无 outbound_triggers → matchJoin null → legacy
    ok(!outbound.matchJoin(legacyId), "legacy 医生无 join 触发");
    const legacyCard = cards.welcomeVideoLinkCard(legacyId);
    ok(!!legacyCard && /welcome-video\/legacy\.html/.test(legacyCard.linkUrl), "legacy welcomeVideoLinkCard 可用");
    // 欢迎文案依赖 ops；无 scripts 时仍有硬编码兜底
    qiwe.saveConfig({ enabled:true, autoSend:false, allowGroup:true, token:"tok", guid:"guid-wv", selfUserId:"self-1", testToId:"self-1,room-legacy" });
    const rLeg = await bridge.fireGroupWelcome(
      { fromRoomId:"room-legacy", senderId:"1688857254811499", senderName:"遗留测" },
      qiwe.loadConfig(), legacyId
    );
    ok(!!rLeg.welcomeOutboxId, "legacy 欢迎已入队");
    const pLeg = JSON.parse((db.prepare("SELECT payload FROM outbound_queue WHERE id=?").get(rLeg.welcomeOutboxId).payload) || "{}");
    const legacySendable = cards.filterSendableWeappCodes(legacyId, ["979"]);
    ok(Array.isArray(pLeg.qiwe.weappCodes) && pLeg.qiwe.weappCodes.join(",") === legacySendable.join(","),
      "legacy+welcomeVideo：weappCodes 仅含已就绪模板（" + legacySendable.join(",") + "）");
    ok(Array.isArray(pLeg.qiwe.linkCards) && pLeg.qiwe.linkCards.length === 1
      && /welcome-video\/legacy\.html/.test(pLeg.qiwe.linkCards[0].linkUrl),
      "legacy+welcomeVideo：linkCards 含视频页");

    const savedOrigin = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    ok(!cards.welcomeVideoLinkCard(zhou.id), "PUBLIC_ORIGIN 空 → welcomeVideoLinkCard null");
    process.env.PUBLIC_ORIGIN = savedOrigin;
  }catch(e){
    console.error(e);
    failed++;
  }finally{
    try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
    console.log(failed ? `\nFAILED ${failed}` : "\nALL PASSED");
    process.exit(failed ? 1 : 0);
  }
})();
