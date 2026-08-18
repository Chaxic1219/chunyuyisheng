"use strict";

/**
 * outbound 触发匹配 → 展开 steps → responses[]
 */
const { db } = require("../../db.js");
const { scanRisk } = require("../../triage.js");

function norm(s) {
  return (s || "").trim().toLowerCase();
}

function assetToResponse(asset) {
  const payload =
    typeof asset.payload === "string" ? JSON.parse(asset.payload || "{}") : asset.payload || {};
  if (asset.type === "text") return { type: "text", text: String(payload.text || "") };
  if (asset.type === "mp")
    return {
      type: "mp",
      text: payload.title || asset.title || "",
      title: payload.title || "",
      external: { shortLink: payload.shortLink || "" },
      weappCode: payload.weappCode || payload.templateCode || "",
      templateCode: payload.templateCode || payload.weappCode || "",
    };
  if (asset.type === "link") {
    const url = payload.url || payload.linkUrl || "";
    return {
      type: "link",
      title: payload.title || asset.title || "",
      desc: payload.desc || "",
      iconUrl: payload.iconUrl || "",
      linkUrl: url,
      url,
      external: { url, iconUrl: payload.iconUrl || "" },
      source: payload.source || "",
      page: payload.page || "",
    };
  }
  if (asset.type === "video") {
    if (payload.feedVideo) {
      return {
        type: "feed_video",
        title: payload.title || asset.title || "视频号",
        feedVideo: payload.feedVideo,
      };
    }
    return null;
  }
  if (asset.type === "image") {
    const url = payload.url || payload.imageUrl || "";
    return {
      type: "image",
      url,
      imageUrl: url,
    };
  }
  return null;
}

function expandTrigger(triggerId) {
  const steps = db
    .prepare(
      `SELECT s.*, a.type, a.title, a.payload, a.enabled AS asset_enabled
       FROM outbound_trigger_steps s
       JOIN outbound_assets a ON a.id=s.asset_id
       WHERE s.trigger_id=? AND s.enabled=1
       ORDER BY s.sort, s.id`
    )
    .all(+triggerId);
  const responses = [];
  for (const s of steps) {
    if (!s.asset_enabled) {
      console.warn("[outbound] skip disabled asset", s.asset_id);
      continue;
    }
    const r = assetToResponse(s);
    if (r) responses.push(r);
  }
  return responses;
}

function parseAliases(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function matchCode(doctorId, text) {
  const t = norm(text);
  if (!t) return null;

  const rows = db
    .prepare(
      `SELECT * FROM outbound_triggers
       WHERE doctor_id=? AND kind='code' AND enabled=1
       ORDER BY sort, id`
    )
    .all(+doctorId);
  const rules = rows.map((r) => ({
    id: r.id,
    code: r.code,
    aliases: parseAliases(r.aliases),
    match: r.match_type,
  }));

  for (const r of rules) {
    if (r.match !== "includes") {
      if (norm(r.code) === t || r.aliases.some((a) => norm(a) === t)) {
        return {
          code: r.code,
          bot: "小宝医助",
          responses: expandTrigger(r.id),
          source: "outbound",
        };
      }
    }
  }
  for (const r of rules) {
    if (r.match === "includes") {
      if (t.indexOf(norm(r.code)) >= 0 || r.aliases.some((a) => t.indexOf(norm(a)) >= 0)) {
        const rk = scanRisk(text);
        if (rk.riskLevel !== "low" || rk.sentinel) return null;
        return {
          code: r.code,
          bot: "小宝医助",
          responses: expandTrigger(r.id),
          source: "outbound",
        };
      }
    }
  }
  return null;
}

function matchJoin(doctorId) {
  const t = db
    .prepare(
      `SELECT * FROM outbound_triggers
       WHERE doctor_id=? AND kind='join' AND enabled=1
       ORDER BY sort, id LIMIT 1`
    )
    .get(+doctorId);
  if (!t) return null;
  return {
    kind: "join",
    responses: expandTrigger(t.id),
    source: "outbound",
    triggerId: t.id,
  };
}

function hasOutboundConfig(doctorId) {
  return !!db.prepare("SELECT 1 FROM outbound_triggers WHERE doctor_id=? LIMIT 1").get(+doctorId);
}

function hasCodeTrigger(doctorId, code) {
  return !!db
    .prepare("SELECT 1 FROM outbound_triggers WHERE doctor_id=? AND kind='code' AND code=? LIMIT 1")
    .get(+doctorId, String(code));
}

module.exports = {
  assetToResponse,
  expandTrigger,
  matchCode,
  matchJoin,
  hasOutboundConfig,
  hasCodeTrigger,
};
