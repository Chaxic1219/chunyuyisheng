/* 多轮会话：内存缓存 + SQLite agent_sessions 持久化 */
const { db } = require("../db.js");
const { maskPIIStrict } = require("../pii.js");

const store = new Map();

// 会话保留策略（可环境变量覆盖）：
//   AGENT_SESSION_MEM_TTL_MS  内存 Map 保留时长，默认 24h
//   AGENT_SESSION_DB_TTL_DAYS SQLite 保留时长，默认 7 天
const MEM_TTL_MS = Math.max(+(process.env.AGENT_SESSION_MEM_TTL_MS || 24 * 3600 * 1000), 60_000);
const DB_TTL_DAYS = Math.max(+(process.env.AGENT_SESSION_DB_TTL_DAYS || 7), 1);

function keyOf(doctorId, patientKey){
  return String(doctorId) + "::" + String(patientKey || "anon");
}

function nowIso(){
  return new Date().toISOString();
}

function parseJson(s, fallback){
  try{
    const v = JSON.parse(s || "");
    return v == null ? fallback : v;
  }catch(e){
    return fallback;
  }
}

function chatPhaseFromSlots(slots){
  return slots && slots.__chatPhase != null ? slots.__chatPhase : null;
}

function rowToSession(row){
  if(!row) return null;
  const slots = parseJson(row.slots_json, {});
  return {
    id: row.id,
    doctorId: Number(row.doctor_id),
    patientKey: String(row.patient_key || "anon"),
    slots,
    chatPhase: chatPhaseFromSlots(slots),
    goal: row.goal || null,
    summary: row.summary || "",
    turns: parseJson(row.turns_json, []),
    updatedAt: row.updated_at ? Date.parse(row.updated_at) || Date.now() : Date.now(),
    _persisted: true
  };
}

function loadFromDb(doctorId, patientKey){
  try{
    const row = db.prepare("SELECT * FROM agent_sessions WHERE doctor_id=? AND patient_key=?").get(Number(doctorId), String(patientKey || "anon"));
    return rowToSession(row);
  }catch(e){
    return null;
  }
}

function persist(session){
  if(!session) return;
  const doctorId = Number(session.doctorId);
  const patientKey = String(session.patientKey || "anon");
  const slotsJson = JSON.stringify(session.slots || {});
  // 存储侧 PII 脱敏（低4）：summary/turns 落库前过 maskPIIStrict，防手机号/身份证明文入库。
  // slots 保留原样（健康对话靠槽位原值续轮，topicKey 等无 PII 形态风险）。
  let turnsJson = JSON.stringify(Array.isArray(session.turns) ? session.turns.slice(-12) : []);
  try{
    turnsJson = turnsJson.replace(/1[3-9]\d{9}/g, "***").replace(/\d{17}[\dXx]/g, "***");
  }catch(e){}
  const goal = session.goal == null ? null : String(session.goal).slice(0, 80);
  let summary = String(session.summary || "").slice(0, 800);
  try{ summary = maskPIIStrict(summary); }catch(e){}
  const ts = nowIso();
  try{
    const existing = db.prepare("SELECT id FROM agent_sessions WHERE doctor_id=? AND patient_key=?").get(doctorId, patientKey);
    if(existing){
      db.prepare(`UPDATE agent_sessions SET slots_json=?,goal=?,summary=?,turns_json=?,updated_at=? WHERE id=?`)
        .run(slotsJson, goal, summary, turnsJson, ts, existing.id);
      session.id = existing.id;
    }else{
      const r = db.prepare(`INSERT INTO agent_sessions(doctor_id,patient_key,slots_json,goal,summary,turns_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(doctorId, patientKey, slotsJson, goal, summary, turnsJson, ts, ts);
      session.id = r.lastInsertRowid;
    }
    session._persisted = true;
  }catch(e){
    // 持久化失败不阻断回话
  }
}

function getSession(doctorId, patientKey){
  const k = keyOf(doctorId, patientKey);
  let s = store.get(k);
  if(s) return s;
  s = loadFromDb(doctorId, patientKey);
  if(!s){
    s = {
      doctorId: Number(doctorId),
      patientKey: String(patientKey || "anon"),
      slots: {},
      chatPhase: null,
      goal: null,
      summary: "",
      turns: [],
      updatedAt: Date.now()
    };
  }
  store.set(k, s);
  return s;
}

function updateSession(session, patch){
  if(!session) return session;
  session.slots = session.slots || {};
  if(patch.chatPhase != null){
    session.slots.__chatPhase = patch.chatPhase;
  }
  if(patch.slots && typeof patch.slots === "object"){
    const savedPhase = session.slots.__chatPhase;
    session.slots = Object.assign({}, session.slots, patch.slots);
    if(patch.chatPhase == null && savedPhase != null){
      session.slots.__chatPhase = savedPhase;
    }
  }
  session.chatPhase = chatPhaseFromSlots(session.slots);
  if(patch.goal != null) session.goal = patch.goal;
  if(patch.summary != null) session.summary = String(patch.summary).slice(0, 800);
  if(patch.turn){
    session.turns = Array.isArray(session.turns) ? session.turns : [];
    session.turns.push(patch.turn);
    if(session.turns.length > 12) session.turns = session.turns.slice(-12);
  }
  session.updatedAt = Date.now();
  persist(session);
  store.set(keyOf(session.doctorId, session.patientKey), session);
  return session;
}

function resetSession(doctorId, patientKey){
  const k = keyOf(doctorId, patientKey);
  store.delete(k);
  try{
    db.prepare("DELETE FROM agent_sessions WHERE doctor_id=? AND patient_key=?").run(Number(doctorId), String(patientKey || "anon"));
  }catch(e){}
}

function _clearMemoryForTests(){
  store.clear();
}

function _clearAllForTests(){
  store.clear();
  try{ db.prepare("DELETE FROM agent_sessions").run(); }catch(e){}
}

/** 内存 Map 过期清理：删除超过 MEM_TTL_MS 未活跃的会话对象 */
function purgeMemory(){
  const now = Date.now();
  let removed = 0;
  for(const [key, s] of store){
    if(now - (s.updatedAt || 0) > MEM_TTL_MS){
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

/** SQLite 过期清理：删除超过 DB_TTL_DAYS 未活跃的会话行 */
function purgeDatabase(){
  try{
    const r = db.prepare("DELETE FROM agent_sessions WHERE updated_at < ?")
      .run(new Date(Date.now() - DB_TTL_DAYS * 24 * 3600 * 1000).toISOString());
    return r.changes || 0;
  }catch(e){
    return 0;
  }
}

module.exports = { getSession, updateSession, resetSession, _clearAllForTests, _clearMemoryForTests, persist, loadFromDb, purgeMemory, purgeDatabase };
