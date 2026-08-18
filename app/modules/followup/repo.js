"use strict";

/**
 * followups 表 SQL（本表归属 followup 模块）。
 * plans 配置暂从 doctors.content 只读查询（跨模块 Query）。
 */
const { db } = require("../../db.js");

function nowIso(){
  return new Date().toISOString();
}

function parseJson(text, fallback){
  try{
    const v = JSON.parse(text || "");
    return v == null ? fallback : v;
  }catch(e){
    return fallback;
  }
}

function doctorContent(doctorId){
  const row = db.prepare("SELECT content FROM doctors WHERE id=?").get(doctorId);
  return row ? parseJson(row.content, {}) : {};
}

function insertEnroll({ doctorId, patientName, patientPhone, planKey, planName, enrolledAt, nodesJson, status }){
  const ts = nowIso();
  const r = db.prepare(`INSERT INTO followups(
    doctor_id,patient_name,patient_phone,plan_key,plan_name,enrolled_at,nodes,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    doctorId, patientName, patientPhone, planKey, planName, enrolledAt,
    nodesJson, status || "active", ts, ts
  );
  return getById(r.lastInsertRowid);
}

function getById(id){
  return db.prepare("SELECT * FROM followups WHERE id=?").get(+id) || null;
}

function listByPhone(doctorId, phone){
  return db.prepare("SELECT * FROM followups WHERE doctor_id=? AND patient_phone=? ORDER BY id DESC")
    .all(+doctorId, phone);
}

function listByDoctor(doctorId, limit){
  const lim = Number(limit) > 0 ? Number(limit) : 100;
  return db.prepare("SELECT * FROM followups WHERE doctor_id=? ORDER BY updated_at DESC, id DESC LIMIT ?")
    .all(+doctorId, lim);
}

function updateNodes(id, nodesJson, status){
  db.prepare("UPDATE followups SET nodes=?,status=?,updated_at=? WHERE id=?")
    .run(nodesJson, status, nowIso(), +id);
}

module.exports = {
  nowIso,
  parseJson,
  doctorContent,
  insertEnroll,
  getById,
  listByPhone,
  listByDoctor,
  updateNodes
};
