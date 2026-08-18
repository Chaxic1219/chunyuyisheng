"use strict";

/**
 * 一次性：rules + ops scripts → outbound_assets / triggers / steps
 * patch: outbound_v1_migrate_from_rules_scripts
 */
const PATCH_ID = "outbound_v1_migrate_from_rules_scripts";
const ZHOU_MENU_TEXT = [
  "群功能菜单",
  "101 在线咨询医生",
  "102 视频问诊",
  "103 查看医院相关电话",
  "105 查看医生回复",
  "201 挂号及门诊时间",
  "301 预约加号",
  "302 预约住院",
  "616 住院及手术知识",
  "626 就医常见问题",
  "818 把医生介绍给亲友",
  "909 感谢医生",
  "919 评价医生",
  "979 医患联络表",
].join("\n");

function getDb(database) {
  return database || require("../../db.js").db;
}

function getRepo() {
  return require("./repo.js");
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text || "");
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function cleanText(v, max) {
  return String(v == null ? "" : v)
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, max || 2400);
}

function patchApplied(db, id) {
  return !!db.prepare("SELECT 1 FROM schema_patches WHERE patch_id=?").get(id);
}

function markPatchApplied(db, id) {
  db.prepare("INSERT OR IGNORE INTO schema_patches(patch_id,applied_at) VALUES(?,?)").run(
    id,
    new Date().toISOString()
  );
}

function responseToAssetInput(doctorId, code, response, sort) {
  const r = response || {};
  const type = String(r.type || "").toLowerCase();
  const groupCode = String(code || "");

  if (type === "text") {
    const text = cleanText(r.text, 2400);
    return {
      doctorId,
      type: "text",
      title: cleanText(r.title || text.slice(0, 40), 80),
      payload: { text },
      groupCode,
      sort,
      enabled: true,
    };
  }

  if (type === "mp") {
    const ext = r.external && typeof r.external === "object" ? r.external : {};
    const shortLink = cleanText(ext.shortLink || r.shortLink || "", 500);
    const title = cleanText(r.title || "", 180);
    const weappCode = cleanText(r.weappCode || r.templateCode || code, 40);
    const templateCode = cleanText(r.templateCode || r.weappCode || code, 40);
    return {
      doctorId,
      type: "mp",
      title: title || weappCode || code,
      payload: { shortLink, title, weappCode, templateCode },
      groupCode,
      sort,
      enabled: true,
    };
  }

  if (type === "link") {
    const ext = r.external && typeof r.external === "object" ? r.external : {};
    const url = cleanText(r.linkUrl || r.url || ext.url || ext.urlLink || ext.linkUrl || "", 1000);
    const title = cleanText(r.title || "", 180);
    return {
      doctorId,
      type: "link",
      title: title || "链接",
      payload: {
        title,
        desc: cleanText(r.desc || "", 240),
        url,
        linkUrl: url,
        iconUrl: cleanText(r.iconUrl || ext.iconUrl || "", 500),
        source: cleanText(r.source || "", 120),
        page: cleanText(r.page || "", 120),
      },
      groupCode,
      sort,
      enabled: true,
    };
  }

  console.warn(
    "[outbound.migrate] skip unsupported response type",
    type || "(empty)",
    "code=" + code,
    "doctorId=" + doctorId
  );
  return null;
}

function loadOpsScripts(doctorId) {
  try {
    const opsConfig = require("../../ops_config.js");
    return {
      scripts: opsConfig.scripts(doctorId) || {},
      scriptValue: (cfg, key) => opsConfig.scriptValue(cfg, key),
      render: (tpl, vars) => opsConfig.render(tpl, vars || {}),
    };
  } catch (e) {
    console.warn("[outbound.migrate] ops_config unavailable:", e && e.message);
    return null;
  }
}

function renderedCodeScript(ops, code) {
  if (!ops) return "";
  const raw = ops.scriptValue(ops.scripts, "code" + String(code || ""));
  return cleanText(
    ops.render(raw, { patient: "", group: "", doctor: "", dept: "", hospital: "" }),
    2400
  );
}

function loadWelcomeWeappCodes() {
  try {
    const cards = require("../qiwe/cards.js");
    if (typeof cards.welcomeWeappPayload === "function") {
      const codes = cards.welcomeWeappPayload();
      return Array.isArray(codes) ? codes.map((c) => String(c)).filter(Boolean) : [];
    }
  } catch (e) {
    console.warn("[outbound.migrate] welcomeWeappPayload unavailable:", e && e.message);
  }
  return [];
}

function createMpFromTemplate(db, repo, doctorId, code, groupCode, sort) {
  const tpl = db
    .prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?")
    .get(+doctorId, String(code));
  if (!tpl) {
    console.warn(
      "[outbound.migrate] skip welcome mp, no template code=" + code + " doctorId=" + doctorId
    );
    return null;
  }
  return repo.createAsset({
    doctorId,
    type: "mp",
    title: cleanText(tpl.title || code, 180) || String(code),
    payload: {
      shortLink: cleanText(tpl.source_short_link || "", 500),
      title: cleanText(tpl.title || "", 180),
      weappCode: String(code),
      templateCode: String(code),
    },
    groupCode,
    sort,
    enabled: true,
  });
}

/** 与 fireGroupWelcome 未迁移分支同口径：content.welcomeVideo → 入群链接卡素材 */
function createWelcomeVideoLinkAsset(repo, doctorId, sort) {
  try {
    const cards = require("../qiwe/cards.js");
    if (typeof cards.welcomeVideoLinkCard !== "function") return null;
    const card = cards.welcomeVideoLinkCard(doctorId);
    if (!card || !card.linkUrl) return null;
    return repo.createAsset({
      doctorId,
      type: "link",
      title: cleanText(card.title || "医生视频问候", 180),
      payload: {
        title: cleanText(card.title || "", 180),
        desc: cleanText(card.desc || "点击观看", 240),
        url: card.linkUrl,
        linkUrl: card.linkUrl,
        iconUrl: cleanText(card.iconUrl || "", 500),
      },
      groupCode: "welcome",
      sort,
      enabled: true,
    });
  } catch (e) {
    console.warn(
      "[outbound.migrate] welcomeVideo link unavailable doctorId=" + doctorId + ":",
      e && e.message
    );
    return null;
  }
}

/**
 * 入群步骤：文案 +（有 welcomeVideo → 979 + 视频链接卡；否则 979+808）
 * 对齐 legacy fireGroupWelcome：videoCard ? weapp=["979"]+linkCards=[video] : welcomeWeappPayload()
 */
function buildJoinSteps(db, repo, doctorId, ops) {
  const steps = [];
  let assetCount = 0;
  let sort = 0;

  let welcomeText = "";
  if (ops) {
    welcomeText = cleanText(
      ops.render(ops.scriptValue(ops.scripts, "groupWelcome"), {
        patient: "",
        group: "",
        doctor: "",
        dept: "",
        hospital: "",
      }),
      2400
    );
  }

  if (welcomeText) {
    const textAsset = repo.createAsset({
      doctorId,
      type: "text",
      title: "入群欢迎",
      payload: { text: welcomeText },
      groupCode: "welcome",
      sort,
      enabled: true,
    });
    assetCount++;
    steps.push({ assetId: textAsset.id, sort, enabled: true });
    sort++;
  }

  let videoLink = null;
  try {
    const cards = require("../qiwe/cards.js");
    if (typeof cards.welcomeVideoLinkCard === "function") {
      const card = cards.welcomeVideoLinkCard(doctorId);
      if (card && card.linkUrl) videoLink = card;
    }
  } catch (e) {
    videoLink = null;
  }

  if (videoLink) {
    const mp = createMpFromTemplate(db, repo, doctorId, "979", "welcome", sort);
    if (mp) {
      assetCount++;
      steps.push({ assetId: mp.id, sort, enabled: true });
      sort++;
    }
    const linkAsset = createWelcomeVideoLinkAsset(repo, doctorId, sort);
    if (linkAsset) {
      assetCount++;
      steps.push({ assetId: linkAsset.id, sort, enabled: true });
      sort++;
    }
  } else {
    for (const code of loadWelcomeWeappCodes()) {
      const mp = createMpFromTemplate(db, repo, doctorId, code, "welcome", sort);
      if (!mp) continue;
      assetCount++;
      steps.push({ assetId: mp.id, sort, enabled: true });
      sort++;
    }
  }

  return { steps, assetCount };
}

function migrateCodeRules(db, repo, doctorId, ops, txOpts) {
  const rules = db
    .prepare(
      `SELECT * FROM rules WHERE doctor_id=? AND enabled=1 ORDER BY sort, id`
    )
    .all(+doctorId);

  let triggerCount = 0;
  let assetCount = 0;
  const codeTriggers = new Map();

  for (const row of rules) {
    const code = String(row.code || "");
    const aliases = parseJson(row.aliases, []);

    const responses = parseJson(row.responses, []);
    const steps = [];
    let sort = 0;
    if (Array.isArray(responses)) {
      for (const resp of responses) {
        const input = responseToAssetInput(doctorId, code, resp, sort);
        if (!input) continue;
        const asset = repo.createAsset(input);
        assetCount++;
        steps.push({ assetId: asset.id, sort, enabled: true });
        sort++;
      }
    }

    const scriptText = renderedCodeScript(ops, code);
    if (scriptText) {
      const firstId = steps[0] && steps[0].assetId;
      let firstText = "";
      if (firstId) {
        const rowA = db.prepare("SELECT * FROM outbound_assets WHERE id=?").get(firstId);
        if (rowA && rowA.type === "text") {
          firstText = cleanText(parseJson(rowA.payload, {}).text, 2400);
        }
      }
      if (firstText !== scriptText) {
        const textAsset = repo.createAsset({
          doctorId,
          type: "text",
          title: cleanText(scriptText.slice(0, 40), 80) || "code" + code,
          payload: { text: scriptText },
          groupCode: code,
          sort: 0,
          enabled: true,
        });
        assetCount++;
        steps.unshift({ assetId: textAsset.id, sort: 0, enabled: true });
        steps.forEach((s, i) => {
          s.sort = i;
        });
      }
    }

    if (!steps.length) {
      continue;
    }

    const trigger = repo.createTrigger({
      doctorId,
      kind: "code",
      code,
      aliases: Array.isArray(aliases) ? aliases : [],
      matchType: row.match_type || "exact",
      enabled: !!row.enabled,
      sort: row.sort != null ? +row.sort : 0,
    });
    triggerCount++;
    repo.replaceSteps(doctorId, trigger.id, steps, txOpts);
    codeTriggers.set(code, trigger);
  }

  return { triggerCount, assetCount, codeTriggers };
}

function migrateJoin(db, repo, doctorId, ops, txOpts) {
  const { steps, assetCount } = buildJoinSteps(db, repo, doctorId, ops);

  const trigger = repo.createTrigger({
    doctorId,
    kind: "join",
    code: "",
    aliases: [],
    matchType: "exact",
    enabled: true,
    sort: 9999,
  });

  if (steps.length) {
    repo.replaceSteps(doctorId, trigger.id, steps, txOpts);
  }

  return { triggerCount: 1, assetCount };
}

/**
 * 强制重建某医生入群编排（对齐正式群聊：文案 + 979 + 视频卡 / 或 979+808）
 * 用于修正误迁入的 808 主页卡。
 */
function repairJoinDoctor(doctorId, database) {
  const db = getDb(database);
  const did = +doctorId;
  if (!did) return { repaired: false, skipped: true, reason: "invalid_doctor" };

  const exists = db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did);
  if (!exists) return { repaired: false, skipped: true, reason: "doctor_not_found" };

  db.exec("BEGIN IMMEDIATE");
  try {
    const repo = getRepo();
    const ops = loadOpsScripts(did);
    const txOpts = { noTransaction: true };

    let trigger = db
      .prepare("SELECT * FROM outbound_triggers WHERE doctor_id=? AND kind='join' LIMIT 1")
      .get(did);
    const oldAssetIds = [];
    if (trigger) {
      const oldSteps = db
        .prepare("SELECT asset_id FROM outbound_trigger_steps WHERE trigger_id=?")
        .all(trigger.id);
      for (const s of oldSteps) oldAssetIds.push(+s.asset_id);
    } else {
      trigger = repo.createTrigger({
        doctorId: did,
        kind: "join",
        code: "",
        aliases: [],
        matchType: "exact",
        enabled: true,
        sort: 9999,
      });
    }

    const { steps, assetCount } = buildJoinSteps(db, repo, did, ops);
    const newIds = new Set(steps.map((s) => +s.assetId));
    repo.replaceSteps(did, trigger.id, steps, txOpts);

    let deleted = 0;
    for (const aid of oldAssetIds) {
      if (newIds.has(aid)) continue;
      try {
        repo.deleteAsset(did, aid);
        deleted++;
      } catch (e) {
        /* 仍被其他触发引用则保留 */
      }
    }

    db.exec("COMMIT");
    return {
      repaired: true,
      doctorId: did,
      triggerId: trigger.id,
      steps: steps.length,
      assets: assetCount,
      deletedOldAssets: deleted,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackErr) {
      /* ignore */
    }
    return {
      repaired: false,
      doctorId: did,
      error: (e && e.message) || String(e),
    };
  }
}

const REPAIR_JOIN_PATCH_ID = "outbound_v1_repair_join_welcome_video";

function repairAllJoinWelcomes(database) {
  const db = getDb(database);
  if (patchApplied(db, REPAIR_JOIN_PATCH_ID)) {
    return { skipped: true, reason: "patch_applied", patchId: REPAIR_JOIN_PATCH_ID };
  }

  const doctors = db.prepare("SELECT id FROM doctors ORDER BY id").all();
  const results = [];
  let hasError = false;
  for (const d of doctors) {
    try {
      const r = repairJoinDoctor(d.id, db);
      results.push(r);
      if (r && r.error) hasError = true;
    } catch (e) {
      console.warn("[outbound.repairJoin] doctor failed", d.id, e && e.message);
      results.push({ repaired: false, doctorId: d.id, error: (e && e.message) || String(e) });
      hasError = true;
    }
  }

  if (hasError) {
    console.warn(
      "[outbound.repairJoin] patch NOT applied due to doctor errors; retry will re-attempt"
    );
  } else {
    markPatchApplied(db, REPAIR_JOIN_PATCH_ID);
  }

  return {
    skipped: false,
    patchId: REPAIR_JOIN_PATCH_ID,
    patchApplied: !hasError,
    doctors: results.length,
    repaired: results.filter((r) => r.repaired).length,
    results,
  };
}

/**
 * 迁移单个医生。已有任意 outbound_triggers 则跳过（幂等）。
 * 不检查全局 patch（patch 仅在 migrateAllDoctors）。
 */
function migrateDoctor(doctorId, database) {
  const db = getDb(database);
  const did = +doctorId;
  if (!did) return { migrated: false, skipped: true, reason: "invalid_doctor" };

  const exists = db.prepare("SELECT 1 FROM doctors WHERE id=?").get(did);
  if (!exists) return { migrated: false, skipped: true, reason: "doctor_not_found" };

  const has = db.prepare("SELECT 1 FROM outbound_triggers WHERE doctor_id=? LIMIT 1").get(did);
  if (has) return { migrated: false, skipped: true, reason: "already_has_triggers" };

  db.exec("BEGIN IMMEDIATE");
  try {
    const repo = getRepo();
    const ops = loadOpsScripts(did);
    const txOpts = { noTransaction: true };

    const codeResult = migrateCodeRules(db, repo, did, ops, txOpts);
    const joinResult = migrateJoin(db, repo, did, ops, txOpts);

    db.exec("COMMIT");
    return {
      migrated: true,
      doctorId: did,
      triggers: codeResult.triggerCount + joinResult.triggerCount,
      assets: codeResult.assetCount + joinResult.assetCount,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackErr) {
      /* ignore nested rollback failure */
    }
    throw e;
  }
}

function migrateAllDoctors(database) {
  const db = getDb(database);
  if (patchApplied(db, PATCH_ID)) {
    return { skipped: true, reason: "patch_applied" };
  }

  const doctors = db.prepare("SELECT id FROM doctors ORDER BY id").all();
  const results = [];
  let hasError = false;
  for (const d of doctors) {
    try {
      const r = migrateDoctor(d.id, db);
      results.push(r);
      if (r && r.error) hasError = true;
    } catch (e) {
      console.warn("[outbound.migrate] doctor failed", d.id, e && e.message);
      results.push({ migrated: false, doctorId: d.id, error: (e && e.message) || String(e) });
      hasError = true;
    }
  }

  if (hasError) {
    console.warn(
      "[outbound.migrate] patch NOT applied due to doctor errors; retry will re-attempt failed doctors"
    );
  } else {
    markPatchApplied(db, PATCH_ID);
  }

  return {
    skipped: false,
    patchId: PATCH_ID,
    patchApplied: !hasError,
    doctors: results.length,
    migrated: results.filter((r) => r.migrated).length,
    results,
  };
}

function ensureZhouMenuTrigger(database) {
  const db = getDb(database);
  const doctor = db.prepare("SELECT id FROM doctors WHERE slug='zhouyuchun'").get();
  if (!doctor) return { skipped: true, reason: "doctor_not_found" };

  const existing = db
    .prepare("SELECT id FROM outbound_triggers WHERE doctor_id=? AND kind='code' AND code='1' LIMIT 1")
    .get(doctor.id);
  if (existing) return { skipped: true, reason: "trigger_exists", triggerId: existing.id };

  db.exec("BEGIN IMMEDIATE");
  try {
    const repo = getRepo();
    const asset = repo.createAsset({
      doctorId: doctor.id,
      type: "text",
      title: "群功能菜单",
      payload: { text: ZHOU_MENU_TEXT },
      groupCode: "1",
      sort: 0,
      enabled: true,
    });
    const trigger = repo.createTrigger({
      doctorId: doctor.id,
      kind: "code",
      code: "1",
      aliases: ["菜单", "功能", "全部功能"],
      matchType: "exact",
      enabled: true,
      sort: 0,
    });
    repo.replaceSteps(
      doctor.id,
      trigger.id,
      [{ assetId: asset.id, sort: 0, enabled: true }],
      { noTransaction: true }
    );
    db.exec("COMMIT");
    return { created: true, doctorId: doctor.id, triggerId: trigger.id, assetId: asset.id };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

module.exports = {
  PATCH_ID,
  REPAIR_JOIN_PATCH_ID,
  migrateDoctor,
  migrateAllDoctors,
  repairJoinDoctor,
  repairAllJoinWelcomes,
  ensureZhouMenuTrigger,
  responseToAssetInput,
  buildJoinSteps,
};
