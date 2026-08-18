"use strict";

const { db } = require("../../db.js");
const repo = require("./repo.js");

const FIELDS = [
  "channelName", "channelUrl", "coverUrl", "encodeData",
  "headImgUrl", "feedId", "feedNo", "username",
];

function normalizeFeedVideo(raw) {
  const source = raw || {};
  const data = source.msgData || source.msg_data || source.data || source;
  const out = {};
  for (const key of FIELDS) out[key] = String(data[key] || source[key] || "").trim();
  return out;
}

function missingFeedVideoFields(value) {
  const item = value || {};
  return FIELDS.filter((key) => !String(item[key] || "").trim());
}

function assetFor(doctorId, assetId) {
  return repo.listAssets(+doctorId).find((item) => item.id === +assetId) || null;
}

function prepareCapture(doctorId, assetId, startedBy) {
  const asset = assetFor(doctorId, assetId);
  if (!asset || asset.type !== "video") throw new Error("视频号素材不存在");
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 10 * 60 * 1000);
  db.prepare(`INSERT INTO qiwe_feed_video_captures(doctor_id,asset_id,started_at,expires_at,started_by)
    VALUES(?,?,?,?,?) ON CONFLICT(doctor_id) DO UPDATE SET
    asset_id=excluded.asset_id,started_at=excluded.started_at,expires_at=excluded.expires_at,started_by=excluded.started_by`)
    .run(+doctorId, +assetId, startedAt.toISOString(), expiresAt.toISOString(), String(startedBy || ""));
  return captureStatus(doctorId, assetId);
}

function pendingCapture(doctorId) {
  const row = db.prepare("SELECT * FROM qiwe_feed_video_captures WHERE doctor_id=?").get(+doctorId);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM qiwe_feed_video_captures WHERE doctor_id=?").run(+doctorId);
    return null;
  }
  return row;
}

function captureStatus(doctorId, assetId) {
  const asset = assetFor(doctorId, assetId);
  if (!asset) throw new Error("素材不存在");
  const pending = pendingCapture(doctorId);
  const feedVideo = normalizeFeedVideo((asset.payload || {}).feedVideo || {});
  const missing = missingFeedVideoFields(feedVideo);
  return {
    ready: missing.length === 0,
    missing,
    capturedAt: (asset.payload || {}).feedVideoCapturedAt || "",
    channelName: feedVideo.channelName,
    coverUrl: feedVideo.coverUrl,
    pending: pending && +pending.asset_id === +assetId ? {
      startedAt: pending.started_at,
      expiresAt: pending.expires_at,
      startedBy: pending.started_by,
    } : null,
  };
}

function consumeCapture(doctorId, raw) {
  const pending = pendingCapture(doctorId);
  if (!pending) return { captured: false, reason: "no_pending_capture" };
  const feedVideo = normalizeFeedVideo(raw);
  const missing = missingFeedVideoFields(feedVideo);
  const asset = assetFor(doctorId, pending.asset_id);
  if (!asset || asset.type !== "video") return { captured: false, reason: "asset_not_found" };
  if (missing.length) {
    const payload = Object.assign({}, asset.payload || {}, {
      feedVideo,
      feedVideoRaw: raw,
      feedVideoSampledAt: new Date().toISOString(),
    });
    return {
      captured: false,
      ready: false,
      missing,
      reason: "missing_fields",
      asset: repo.updateAsset(doctorId, asset.id, { payload }),
    };
  }
  const payload = Object.assign({}, asset.payload || {}, {
    url: feedVideo.channelUrl,
    iconUrl: feedVideo.coverUrl,
    feedVideo,
    feedVideoRaw: raw,
    feedVideoCapturedAt: new Date().toISOString(),
  });
  const saved = repo.updateAsset(doctorId, asset.id, { payload });
  db.prepare("DELETE FROM qiwe_feed_video_captures WHERE doctor_id=?").run(+doctorId);
  return { captured: true, ready: true, missing: [], asset: saved };
}

function cancelCapture(doctorId, assetId) {
  return Number(db.prepare("DELETE FROM qiwe_feed_video_captures WHERE doctor_id=? AND asset_id=?").run(+doctorId, +assetId).changes || 0);
}

module.exports = {
  FIELDS,
  normalizeFeedVideo,
  missingFeedVideoFields,
  prepareCapture,
  captureStatus,
  consumeCapture,
  cancelCapture,
};
