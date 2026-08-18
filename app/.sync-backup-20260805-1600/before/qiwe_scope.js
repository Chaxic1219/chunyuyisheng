"use strict";

/**
 * QiWe 展示作用域（与 AI 分诊台同口径）：
 * - 所有入档医生自动生效，不依赖 qiwe_configs.doctorId 二次绑定
 * - 按所选医生过滤；企微群消息再要求当前账号可见（qiwe_hidden=0）
 * - 企微私聊：按消息所属医生显示
 */

function _alias(tableAlias){
  const a = String(tableAlias || "message_log").trim() || "message_log";
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) throw new Error("invalid table alias");
  return a;
}

/** 业务群闸：非业务群历史消息对分诊/看板隐藏（不删库）。 */
function msgLogVisibleInTriage(tableAlias){
  const t = _alias(tableAlias);
  return `
AND NOT EXISTS (
  SELECT 1 FROM community_messages cm
  INNER JOIN community_groups g ON g.id = cm.group_id
  WHERE cm.id = ${t}.source_message_id
    AND IFNULL(g.is_business, 0) = 0
)
AND NOT (
  (${t}.source_message_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM community_messages cm0 WHERE cm0.id = ${t}.source_message_id))
  AND ${t}.group_id IS NOT NULL AND trim(${t}.group_id) != ''
  AND EXISTS (
    SELECT 1 FROM community_groups g
    WHERE g.doctor_id = ${t}.doctor_id
      AND (g.external_group_id = ${t}.group_id OR CAST(g.id AS TEXT) = ${t}.group_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM community_groups g
    WHERE g.doctor_id = ${t}.doctor_id
      AND IFNULL(g.is_business, 0) = 1
      AND (g.external_group_id = ${t}.group_id OR CAST(g.id AS TEXT) = ${t}.group_id)
  )
)
`.replace(/\s+/g, " ").trim();
}

const MSGLOG_VISIBLE_IN_TRIAGE = msgLogVisibleInTriage("message_log");

/**
 * 企微可见作用域 SQL 片段。
 * doctorId 参数保留兼容；实现用消息表 doctor_id 自关联，无需额外绑定参数。
 */
function buildQiweTriageScope(_doctorId, tableAlias){
  const t = _alias(tableAlias || "message_log");
  const sql = `
AND (
  lower(IFNULL(${t}.channel,'')) NOT IN ('qiwe','wecom','wework','qiwei')
  OR (
    ${t}.group_id IS NULL
    OR trim(${t}.group_id) = ''
    OR EXISTS (
      SELECT 1 FROM community_groups g
      WHERE g.doctor_id = ${t}.doctor_id
        AND COALESCE(g.data_source,'') = 'qiwe'
        AND IFNULL(g.qiwe_hidden, 0) = 0
        AND (g.external_group_id = ${t}.group_id OR CAST(g.id AS TEXT) = ${t}.group_id)
    )
  )
)`.replace(/\s+/g, " ").trim();
  return { sql, params:[] };
}

/** message_log 展示完整闸（业务群 + 企微可见），拼在 WHERE doctor_id=? 之后。 */
function messageLogDisplayScope(doctorId, tableAlias){
  const t = _alias(tableAlias || "message_log");
  const qiwe = buildQiweTriageScope(doctorId, t);
  return {
    sql: msgLogVisibleInTriage(t) + " " + qiwe.sql,
    params: qiwe.params
  };
}

/** 群表可见：当前账号未加入的历史企微群不计入医生数据展示。 */
const GROUP_QIWE_VISIBLE = `IFNULL(qiwe_hidden, 0) = 0`;

/**
 * community_messages 排除隐藏企微群（保留非企微群与未关联群）。
 * msgAlias.group_id 为 community_groups.id。
 */
function communityMessagesVisibleSql(msgAlias){
  const m = _alias(msgAlias || "community_messages");
  return `
AND NOT EXISTS (
  SELECT 1 FROM community_groups g
  WHERE g.id = ${m}.group_id
    AND COALESCE(g.data_source,'') = 'qiwe'
    AND IFNULL(g.qiwe_hidden, 0) = 1
)`.replace(/\s+/g, " ").trim();
}

module.exports = {
  MSGLOG_VISIBLE_IN_TRIAGE,
  msgLogVisibleInTriage,
  buildQiweTriageScope,
  messageLogDisplayScope,
  GROUP_QIWE_VISIBLE,
  communityMessagesVisibleSql
};
