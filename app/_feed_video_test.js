"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbPath = path.join(os.tmpdir(), `feed-video-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const repo = require("./modules/outbound/repo.js");
const { assetToResponse } = require("./modules/outbound/resolve.js");
let feedVideoModule = null;
try {
  feedVideoModule = require("./modules/outbound/feed-video.js");
} catch (e) {}

assert.ok(feedVideoModule, "feed-video module should exist");
const { normalizeFeedVideo, missingFeedVideoFields, prepareCapture, captureStatus, consumeCapture, cancelCapture } = feedVideoModule;

const doctor = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get();
const asset = repo.createAsset({ doctorId: doctor.id, type: "video", title: "肩周炎视频", payload: { url: "https://weixin.qq.com/sph/test" }, groupCode: "114" });
assert.equal(assetToResponse({ type: "video", title: asset.title, payload: JSON.stringify(asset.payload) }), null);
const raw = {
  msgData: {
    channelName: "骨科王云程",
    channelUrl: "https://channels.weixin.qq.com/web/pages/feed?eid=export-test",
    coverUrl: "https://example.com/cover.jpg",
    encodeData: "encoded-test",
    headImgUrl: "https://example.com/avatar.jpg",
    feedId: "feed-test",
    feedNo: "feed-no-test",
    username: "finder-user",
  },
};

const normalized = normalizeFeedVideo(raw);
assert.deepEqual(missingFeedVideoFields(normalized), []);
assert.equal(normalized.feedId, "feed-test");

prepareCapture(doctor.id, asset.id, "admin");
assert.ok(captureStatus(doctor.id, asset.id).pending);
const incomplete = consumeCapture(doctor.id, { msgData: { channelName: "骨科王云程" } });
assert.equal(incomplete.ready, false);
assert.ok(incomplete.asset.payload.feedVideoRaw);
assert.ok(captureStatus(doctor.id, asset.id).pending);
const captured = consumeCapture(doctor.id, raw);
assert.equal(captured.ready, true);
assert.equal(captured.asset.payload.feedVideo.feedNo, "feed-no-test");
assert.ok(captured.asset.payload.feedVideoRaw);
assert.equal(captureStatus(doctor.id, asset.id).pending, null);
assert.equal(captureStatus(doctor.id, asset.id).coverUrl, "https://example.com/cover.jpg");
assert.equal(captureStatus(doctor.id, asset.id).channelName, "骨科王云程");

const response = assetToResponse({ type: "video", title: captured.asset.title, payload: JSON.stringify(captured.asset.payload) });
assert.equal(response.type, "feed_video");
assert.equal(response.feedVideo.feedId, "feed-test");
assert.equal(response.linkUrl, undefined);

prepareCapture(doctor.id, asset.id, "admin");
assert.equal(cancelCapture(doctor.id, asset.id), 1);
assert.equal(captureStatus(doctor.id, asset.id).pending, null);

console.log("feed video capture PASS");
setTimeout(() => {
  db.close();
  [dbPath, dbPath + "-wal", dbPath + "-shm"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
}, 30);
