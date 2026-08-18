"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbPath = path.join(os.tmpdir(), `feed-video-delivery-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.TRIAGE_AI_DISABLED = "1";
process.env.QIWE_DRY_RUN = "1";

require("./db.js");
const qiwe = require("./qiwe.js");
const delivery = require("./modules/qiwe/delivery.js");
const callback = require("./modules/qiwe/callback.js");
const repo = require("./modules/outbound/repo.js");
const feedVideoCapture = require("./modules/outbound/feed-video.js");

const feedVideo = {
  channelName: "骨科王云程",
  channelUrl: "https://channels.weixin.qq.com/web/pages/feed?eid=export-test",
  coverUrl: "https://example.com/cover.jpg",
  encodeData: "encoded-test",
  headImgUrl: "https://example.com/avatar.jpg",
  feedId: "feed-test",
  feedNo: "feed-no-test",
  username: "finder-user",
};

const evt = qiwe.normalizeEvent({ cmd: 15000, msgType: 141, senderId: "self-1", msgData: feedVideo }, {
  selfUserId: "self-1",
});
assert.equal(evt.isFeedVideo, true);

const plan = delivery.prepareDelivery(1, { code: "114", responses: [{ type: "feed_video", feedVideo }] }, "患者", { isGroup: true });
assert.equal(plan.feedVideos.length, 1);
assert.equal(plan.linkCards.length, 0);
assert.equal(plan.replyText, "");

(async () => {
  const sent = await qiwe.sendFeedVideo("room-test", feedVideo, { token: "token", guid: "guid", apiUrl: qiwe.DEFAULT_API_URL });
  assert.equal(sent.data.dryRun, true);
  const { db } = require("./db.js");
  const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
  const asset = repo.createAsset({ doctorId: doctor.id, type: "video", title: "采样素材", payload: { url: "https://weixin.qq.com/sph/test" }, groupCode: "114" });
  feedVideoCapture.prepareCapture(doctor.id, asset.id, "admin");
  const captured = await callback.processEvent({
    cmd: 15000,
    msgType: 141,
    senderId: "self-1",
    receiverId: "self-1",
    msgUniqueIdentifier: "feed-video-capture-1",
    msgData: feedVideo,
  }, {
    enabled: true,
    autoSend: false,
    allowGroup: true,
    token: "token",
    guid: "guid",
    selfUserId: "self-1",
    doctorId: doctor.id,
    testToId: "self-1",
  });
  assert.equal(captured.skipped, "feed_video_template_saved");
  assert.equal(feedVideoCapture.captureStatus(doctor.id, asset.id).ready, true);
  const outboxResult = await delivery.deliverOutbox({
    doctor_id: doctor.id,
    text: "",
    payload: JSON.stringify({ qiwe: { toId: "room-test", code: "114", feedVideos: [feedVideo], linkCards: [] } }),
  }, { token: "token", guid: "guid", apiUrl: qiwe.DEFAULT_API_URL });
  assert.equal(outboxResult.sentParts[0].type, "feed_video");
  console.log("feed video delivery PASS");
  setTimeout(() => {
    try { require("./db.js").db.close(); } catch (e) {}
    [dbPath, dbPath + "-wal", dbPath + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
  }, 20);
})().catch((e) => { console.error(e); process.exit(1); });
