"use strict";

/**
 * 编号与推送（outbound）管理台：素材 / 触发编排 CRUD。
 */
const fs = require("fs");
const path = require("path");
const repo = require("../modules/outbound/repo.js");
const feedVideo = require("../modules/outbound/feed-video.js");

const RULES_ACTION = "rules.manage";
const IMAGE_MAX_BODY = 6 * 1024 * 1024; // 图片素材 base64 可能略超 1MB，放宽到与咨询附件同级

function conflictOrError(res, json, e) {
  if (e && (e.code === "ASSET_IN_USE" || e.code === "ASSET_DOCTOR_MISMATCH")) {
    return json(res, 409, { error: e.message || e.code, code: e.code });
  }
  return json(res, 400, { error: (e && e.message) || "请求失败" });
}

function registerOutboundAdminRoutes(route, ctx) {
  const { parseBody, json, gate, rowDoctorId, requireAdminAction } = ctx;

  route("GET", /^\/api\/admin\/outbound\/assets$/, (req, res, m, q) => {
    const did = +q.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    const opts = {};
    if (q.groupCode != null && String(q.groupCode) !== "") opts.groupCode = q.groupCode;
    json(res, 200, { ok: true, items: repo.listAssets(did, opts) });
  });

  // 图片素材上传：base64 → 落盘 public/uploads/outbound-assets/ → 返回相对 URL（存进素材 payload.url）
  route("POST", /^\/api\/admin\/outbound\/assets\/upload$/, async (req, res) => {
    const b = await parseBody(req, IMAGE_MAX_BODY);
    if (b.__oversize) return json(res, 413, { error: "图片过大（上限 6MB）" });
    const did = +b.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站素材维护权限")) return;
    const raw = String(b.imageDataUrl || b.dataUrl || "").trim();
    const m = raw.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) return json(res, 400, { error: "图片格式仅支持 JPEG/PNG/WebP/GIF" });
    const mime = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (!buf.length) return json(res, 400, { error: "图片内容为空" });
    if (buf.length > 5 * 1024 * 1024) return json(res, 400, { error: "图片过大（≤5MB）" });
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
    const dir = path.join(__dirname, "..", "public", "uploads", "outbound-assets");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const fileName = `asset-${did}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const abs = path.join(dir, fileName);
    try {
      fs.writeFileSync(abs, buf);
    } catch (e) {
      return json(res, 500, { error: "图片保存失败：" + ((e && e.message) || "") });
    }
    json(res, 200, { ok: true, url: `/uploads/outbound-assets/${fileName}` });
  });

  route("POST", /^\/api\/admin\/outbound\/assets$/, async (req, res) => {
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    const did = +b.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站素材维护权限")) return;
    if (!b.type) return json(res, 400, { error: "type 必填" });
    try {
      const item = repo.createAsset({
        doctorId: did,
        type: b.type,
        title: b.title,
        payload: b.payload,
        groupCode: b.groupCode,
        enabled: b.enabled,
        sort: b.sort,
      });
      json(res, 200, { ok: true, item });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("PUT", /^\/api\/admin\/outbound\/assets\/(\d+)$/, async (req, res, m) => {
    const did = rowDoctorId("outbound_assets", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null) return json(res, 404, { error: "素材不存在" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站素材维护权限")) return;
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    try {
      const item = repo.updateAsset(did, +m[1], b);
      if (!item) return json(res, 404, { error: "素材不存在" });
      json(res, 200, { ok: true, item });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("DELETE", /^\/api\/admin\/outbound\/assets\/(\d+)$/, (req, res, m) => {
    const did = rowDoctorId("outbound_assets", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null) return json(res, 404, { error: "素材不存在" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站素材维护权限")) return;
    try {
      repo.deleteAsset(did, +m[1]);
      json(res, 200, { ok: true });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("GET", /^\/api\/admin\/outbound\/assets\/(\d+)\/feed-video-capture\/status$/, (req, res, m, q) => {
    const did = rowDoctorId("outbound_assets", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null || +q.doctorId !== did) return json(res, 404, { error: "素材不存在" });
    try { json(res, 200, { ok: true, ...feedVideo.captureStatus(did, +m[1]) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  });

  route("POST", /^\/api\/admin\/outbound\/assets\/(\d+)\/feed-video-capture\/(prepare|cancel)$/, async (req, res, m) => {
    const did = rowDoctorId("outbound_assets", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null) return json(res, 404, { error: "素材不存在" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无视频号素材维护权限")) return;
    const b = await parseBody(req);
    if (+b.doctorId !== did) return json(res, 404, { error: "素材不存在" });
    try {
      if (m[2] === "cancel") {
        return json(res, 200, { ok: true, cancelled: feedVideo.cancelCapture(did, +m[1]) });
      }
      json(res, 200, { ok: true, ...feedVideo.prepareCapture(did, +m[1], s.username || s.name || "admin") });
    } catch (e) { json(res, 400, { error: e.message }); }
  });

  route("POST", /^\/api\/admin\/outbound\/codes$/, async (req, res) => {
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    const did = +b.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站编号维护权限")) return;
    const code = b.code != null ? String(b.code).trim() : "";
    if (!code) return json(res, 400, { error: "code 必填" });
    try {
      const item = repo.createCodeBundle(did, code);
      json(res, 200, { ok: true, item });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("GET", /^\/api\/admin\/outbound\/triggers$/, (req, res, m, q) => {
    const did = +q.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    const items = repo.listTriggers(did).map((t) => repo.getTrigger(did, t.id));
    json(res, 200, { ok: true, items });
  });

  route("POST", /^\/api\/admin\/outbound\/triggers$/, async (req, res) => {
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    const did = +b.doctorId;
    const s = gate(req, res, did);
    if (!s) return;
    if (!Number.isInteger(did) || did <= 0) return json(res, 400, { error: "缺少 doctorId" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站触发维护权限")) return;
    if (!b.kind) return json(res, 400, { error: "kind 必填" });
    try {
      const created = repo.createTrigger({
        doctorId: did,
        kind: b.kind,
        code: b.code,
        aliases: b.aliases,
        matchType: b.matchType || b.match,
        enabled: b.enabled,
        sort: b.sort,
      });
      if (Array.isArray(b.steps)) {
        repo.replaceSteps(did, created.id, b.steps);
      }
      json(res, 200, { ok: true, item: repo.getTrigger(did, created.id) });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("PUT", /^\/api\/admin\/outbound\/triggers\/(\d+)$/, async (req, res, m) => {
    const did = rowDoctorId("outbound_triggers", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null) return json(res, 404, { error: "触发不存在" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站触发维护权限")) return;
    const b = await parseBody(req);
    if (b.__oversize) return json(res, 413, { error: "请求体过大（上限 1MB）" });
    try {
      const patch = {
        kind: b.kind,
        code: b.code,
        aliases: b.aliases,
        matchType: b.matchType != null ? b.matchType : b.match,
        enabled: b.enabled,
        sort: b.sort,
      };
      if (Object.prototype.hasOwnProperty.call(b, "steps")) patch.steps = b.steps;
      const item = repo.updateTrigger(did, +m[1], patch);
      if (!item) return json(res, 404, { error: "触发不存在" });
      json(res, 200, { ok: true, item });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });

  route("DELETE", /^\/api\/admin\/outbound\/triggers\/(\d+)$/, (req, res, m) => {
    const did = rowDoctorId("outbound_triggers", +m[1]);
    const s = gate(req, res, did);
    if (!s) return;
    if (did == null) return json(res, 404, { error: "触发不存在" });
    if (!requireAdminAction(req, res, s, RULES_ACTION, { doctorId: did }, "无出站触发维护权限")) return;
    try {
      const ok = repo.deleteTrigger(did, +m[1]);
      if (!ok) return json(res, 404, { error: "触发不存在" });
      json(res, 200, { ok: true });
    } catch (e) {
      conflictOrError(res, json, e);
    }
  });
}

module.exports = { registerOutboundAdminRoutes };
