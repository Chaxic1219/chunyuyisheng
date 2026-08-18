/* 企业微信接入核心离线自测：加解密 / 签名 / URL 验证 / XML 解析 / DRY_RUN。
   不需要联网、不需要真实凭证、不需要起服务器。
   建议用独立库运行，避免动到 data.db：
     DB_PATH=./_wecomtest.db WECOM_DRY_RUN=1 node _wecomtest.js   */
const crypto = require("crypto");
const wecom = require("./wecom.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗", m); } else console.log("  ✓", m); };

(async () => {
  const aesKey = crypto.randomBytes(32).toString("base64").replace(/=+$/, ""); // 43 位 EncodingAESKey
  const token = "tok123", ts = "1700000000", nonce = "n0nce", receiveId = "ww1234567890";
  const cfg = { callbackToken: token, aesKey, corpId: "c", secret: "s" };

  console.log("== 加解密 / 签名 ==");
  const enc = wecom.encrypt(aesKey, "术后一周内避免剧烈运动", receiveId);
  const dec = wecom.decrypt(aesKey, enc);
  ok(dec.message === "术后一周内避免剧烈运动" && dec.receiveId === receiveId, "AES-256-CBC 加解密往返一致（中文 + receiveId）");
  const sig = wecom.signature(token, ts, nonce, enc);
  ok(typeof sig === "string" && sig.length === 40, "签名为 40 位 sha1");
  ok(wecom.signature(token, ts, nonce, enc) === sig, "签名可复现");

  console.log("== 回调验签（fail-closed） ==");
  const cb = wecom.decryptCallback(cfg, { msg_signature: sig, timestamp: ts, nonce }, enc);
  ok(cb.message === "术后一周内避免剧烈运动", "decryptCallback 验签通过并解出明文");
  let threw = false; try { wecom.decryptCallback(cfg, { msg_signature: "bad", timestamp: ts, nonce }, enc); } catch (e) { threw = true; }
  ok(threw, "错误签名 → 抛出（拒绝处理）");

  console.log("== URL 验证 ==");
  const echo = wecom.encrypt(aesKey, "echostr_plain_123", receiveId);
  const esig = wecom.signature(token, ts, nonce, echo);
  ok(wecom.verifyUrl(cfg, { msg_signature: esig, timestamp: ts, nonce, echostr: echo }) === "echostr_plain_123", "verifyUrl 校验并回显明文 echostr");

  console.log("== XML 解析 ==");
  const textXml = "<xml><ToUserName><![CDATA[ww1]]></ToUserName><FromUserName><![CDATA[woUser1]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[怎么挂号]]></Content><MsgId>123</MsgId></xml>";
  const p = wecom.parseInboundXml(textXml);
  ok(p.kind === "text" && p.input.text === "怎么挂号" && p.input.externalUserId === "woUser1" && p.input.channelType === "wecom", "parseInboundXml 解析文本消息");
  const kfXml = "<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[ENCTOKEN]]></Token><OpenKfId><![CDATA[wkkf1]]></OpenKfId></xml>";
  const pk = wecom.parseInboundXml(kfXml);
  ok(pk.kind === "kf_event" && pk.token === "ENCTOKEN" && pk.openKfid === "wkkf1", "parseInboundXml 识别微信客服事件");
  ok(wecom.extractEncrypt("<xml><Encrypt><![CDATA[" + enc + "]]></Encrypt></xml>") === enc, "extractEncrypt 取出密文");

  console.log("== DRY_RUN（不联网） ==");
  if(wecom.DRY_RUN){
    const r = await wecom.send({ channel: "wecom_kf", toUser: "u", openKfid: "k", text: "hi" });
    ok(r && r.dryRun === true, "DRY_RUN 下 send 不联网，返回 dryRun");
    ok((await wecom.getAccessToken(cfg)) === "DRYRUN_TOKEN", "DRY_RUN 下 getAccessToken 不联网");
  }else{
    console.log("  (跳过：未设 WECOM_DRY_RUN=1)");
  }

  console.log("\n检查项: " + n + "  失败: " + fails.length);
  if(fails.length){ console.log("✗ 失败：\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("✓ wecom 核心自测全部通过");
})();
