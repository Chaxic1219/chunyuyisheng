"use strict";

/**
 * 运营配置领域服务：已发布只读 + 配置中心写入（ops_configs 自管）。
 */
const eventBus = require("../../shared/eventBus.js");
const repo = require("./repo.js");
const rules = require("./rules.js");

function published(domain, doctorId){
  const ownerId = rules.ownerIdForDomain(domain, doctorId);
  if(ownerId == null) return {};
  return repo.getPublishedJson(ownerId, rules.cleanText(domain, 60));
}

function prompts(doctorId){
  return published("prompts", doctorId);
}

function promptValue(cfg, key){
  if(!cfg || typeof cfg !== "object") return "";
  return rules.cleanText(cfg[rules.cleanText(key, 80)], 4000);
}

function safety(doctorId){
  return published("safety", doctorId);
}

function safetyHits(text, key, doctorId){
  const cfg = safety(doctorId);
  return rules.listValues(cfg && cfg[key], 120, 80).filter(term => rules.textHasTerm(text, term));
}

function safetyRedFlagHits(text, doctorId){
  return safetyHits(text, "redFlags", doctorId);
}

function safetyHumanTriggerHits(text, doctorId){
  return safetyHits(text, "humanTriggers", doctorId);
}

function withDoctorScriptDefaults(cfg, doctorId){
  return rules.withDoctorScriptDefaults(cfg, repo.doctorIdentity(doctorId));
}

function scripts(doctorId){
  return withDoctorScriptDefaults(published("scripts", doctorId), doctorId);
}

function scriptValue(cfg, codeOrKey){
  return rules.scriptValue(cfg, codeOrKey);
}

function render(template, vars){
  return rules.render(template, vars);
}

function hasCodeScript(doctorId, code, cfg){
  return !!rules.cleanText(
    render(scriptValue(cfg || scripts(doctorId), "code" + rules.cleanText(code, 40)), {
      patient:"", group:"", doctor:"", dept:"", hospital:""
    }),
    2400
  );
}

function emitPublished(payload){
  try{ eventBus.emit("ops.config.published", payload || {}); }catch(e){}
}

function emitRolledBack(payload){
  try{ eventBus.emit("ops.config.rolled_back", payload || {}); }catch(e){}
}

function recordAudit({ configId, doctorId, domain, action, actor, snapshot, result, createdAt }){
  repo.insertAudit({
    configId,
    doctorId,
    domain,
    action,
    actor,
    snapshotJson: rules.stableJson(snapshot),
    resultJson: rules.stableJson(result),
    createdAt: createdAt || new Date().toISOString()
  });
}

/**
 * ensure：若无行则 seed；upgradeDefaults 由调用方注入（默认文案仍在 server）。
 * @param {{ domain, doctorId, nowIso, getDefault, upgradeDefaults }} opts
 */
function ensure(opts){
  const domain = String(opts.domain || "");
  const meta = rules.configMeta(domain);
  if(!meta) return null;
  const ownerId = rules.ownerIdForDomain(domain, opts.doctorId);
  let row = repo.getByOwnerDomain(ownerId, domain);
  if(!row){
    const def = typeof opts.getDefault === "function" ? opts.getDefault(domain, opts.doctorId) : {};
    row = repo.insertSeed({
      ownerId,
      domain,
      title: meta.title,
      scope: meta.scope,
      draftJson: rules.stableJson(def),
      publishedJson: rules.stableJson(def),
      nowIso: opts.nowIso
    });
    if(typeof opts.onSeeded === "function") opts.onSeeded(row, def);
  }
  if(typeof opts.upgradeDefaults === "function"){
    row = opts.upgradeDefaults(row, opts.doctorId) || row;
  }
  return row;
}

function saveDraft({ id, domain, cfg, actor, updatedAt }){
  const check = rules.validateOpsConfig(domain, cfg);
  if(!check.ok) return { ok:false, check };
  repo.updateDraft(id, rules.stableJson(cfg), actor, updatedAt);
  return { ok:true, check };
}

function publish({ row, cfg, actor, publishedAt }){
  const check = rules.validateOpsConfig(row.domain, cfg);
  if(!check.ok) return { ok:false, check };
  const version = (row.published_version || 0) + 1;
  repo.updatePublished(row.id, rules.stableJson(cfg), version, actor, publishedAt);
  emitPublished({
    configId: row.id,
    doctorId: row.doctor_id,
    domain: row.domain,
    version,
    publishedBy: actor,
    publishedAt
  });
  return { ok:true, check, version, publishedAt };
}

function rollback({ row, actor, publishedAt }){
  const prev = repo.prevPublishSnapshot(row.id);
  const cfg = rules.parseConfigJson(
    prev && prev.snapshot_json,
    rules.parseConfigJson(row.published_json, {})
  );
  const check = rules.validateOpsConfig(row.domain, cfg);
  if(!check.ok) return { ok:false, check, cfg, prev: !!prev };
  const version = (row.published_version || 0) + 1;
  repo.updateRolledBack(row.id, rules.stableJson(cfg), version, actor, publishedAt);
  emitRolledBack({
    configId: row.id,
    doctorId: row.doctor_id,
    domain: row.domain,
    version,
    publishedBy: actor,
    publishedAt,
    restoredPrevious: !!prev
  });
  return { ok:true, check, cfg, version, prev: !!prev, publishedAt };
}

function applyUpgradedDefaults(row, draftCfg, pubCfg, nowIso){
  return repo.updateUpgradedDefaults(
    row.id,
    rules.stableJson(draftCfg),
    rules.stableJson(pubCfg),
    nowIso
  );
}

module.exports = {
  published,
  prompts,
  promptValue,
  safety,
  safetyRedFlagHits,
  safetyHumanTriggerHits,
  scripts,
  scriptValue,
  hasCodeScript,
  render,
  withDoctorScriptDefaults,
  LV_DOCX_SCRIPTS: rules.LV_DOCX_SCRIPTS,
  emitPublished,
  emitRolledBack,
  recordAudit,
  ensure,
  saveDraft,
  publish,
  rollback,
  applyUpgradedDefaults,
  getById: repo.getById,
  listAuditRows: repo.listAuditRows,
  getScriptsJson: repo.getScriptsJson,
  configMeta: rules.configMeta,
  CONFIG_DOMAIN_ORDER: rules.CONFIG_DOMAIN_ORDER,
  validateOpsConfig: rules.validateOpsConfig,
  parseConfigJson: rules.parseConfigJson,
  stableJson: rules.stableJson,
  ownerIdForDomain: rules.ownerIdForDomain
};
