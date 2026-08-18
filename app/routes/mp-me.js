"use strict";
/**
 * 患者侧「我的」API（2026-08-05 P0：档案/健康记录/待跟进 真接）。
 * 全部基于 mp session 鉴权（Bearer mpToken），只允许患者读写「自己的」档案。
 * 复用 profileStore（patient_profile_fields）+ mp_auth（session 校验）。
 */
const mpAuth = require("../mp_auth.js");
const { db } = require("../db.js");
const phr = require("../patient_health_records.js");

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function requireMpSession(req, res, json) {
  const token = bearerToken(req);
  if (!token) return json(res, 401, { error: "unauthorized" });
  try {
    const sess = mpAuth.requireSession(token);
    return sess;
  } catch (e) {
    return json(res, 401, { error: "unauthorized" });
  }
}

/** 从 session 定位 person + patient（患者仅能读自己的数据） */
function resolveOwn(sess) {
  const personId = sess && +sess.person_id;
  const patientId = sess && +sess.patient_id;
  const doctorId = sess && +sess.doctor_id;
  return { personId, patientId, doctorId };
}

function registerMpMeRoutes(route, ctx) {
  const { parseBody, json, MESSAGE_MAX_BODY, profileStore, patientProfile } = ctx;

  /** GET /api/mp/me/archive — 读取患者真实档案（person 主档 + 扩展字段 + 当前医生 patient） */
  route("GET", /^\/api\/mp\/me\/archive$/, (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { personId, patientId, doctorId } = resolveOwn(sess);
    if (!personId) return json(res, 400, { error: "请先绑定手机号" });

    let person = null;
    let patient = null;
    let fields = {};
    try { person = db.prepare("SELECT * FROM persons WHERE id=?").get(+personId); } catch (e) {}
    if (patientId) {
      try {
        patient = db.prepare("SELECT * FROM patients WHERE id=? AND doctor_id=?").get(+patientId, +doctorId);
      } catch (e) {}
    }
    try { fields = profileStore.readPersonFields(personId); } catch (e) {}

    const archive = {
      name: (person && person.real_name) || (patient && patient.real_name) || "",
      gender: (person && person.gender) || (patient && patient.gender) || "",
      birthDate: (person && person.birth_date) || (patient && patient.birth_date) || "",
      phone: (person && person.phone) || "",
      phoneMasked: mpAuth.maskPhone((person && person.phone) || ""),
      disease: fields.disease || "",
      pregnancyStatus: fields.pregnancyStatus || "",
      foodContactAllergies: fields.foodContactAllergies || "",
      drugAllergies: fields.drugAllergies || "",
      diseaseHistory: fields.diseaseHistory || "",
      tags: patient ? (patient.tags ? (() => { try { return JSON.parse(patient.tags); } catch (e) { return []; } })() : []) : [],
      followStage: (patient && patient.follow_stage) || "",
      archived: true,
      source: "db"
    };
    json(res, 200, archive);
  });

  /** PUT /api/mp/me/archive — 档案回写：person 主档 + patient_profile_fields 扩展 */
  route("PUT", /^\/api\/mp\/me\/archive$/, async (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { personId, patientId, doctorId } = resolveOwn(sess);
    if (!personId) return json(res, 400, { error: "请先绑定手机号" });
    if (!doctorId) return json(res, 400, { error: "doctor_required" });

    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const now = new Date().toISOString();

    // 1) person 主档（全局）：姓名/性别/出生日期（有值才覆盖空）
    const name = String(b.name || "").trim().slice(0, 40);
    const gender = String(b.gender || "").trim().slice(0, 10);
    const birthDate = String(b.birthDate || "").trim().slice(0, 20);
    if (name || gender || birthDate) {
      db.prepare(`UPDATE persons SET
        real_name=COALESCE(NULLIF(?,''), real_name),
        gender=COALESCE(NULLIF(?,''), gender),
        birth_date=COALESCE(NULLIF(?,''), birth_date),
        updated_at=? WHERE id=?`)
        .run(name, gender, birthDate, now, +personId);
    }

    // 2) 当前医生 patient 行：同步姓名/性别/出生日期（供医助后台展示）
    if (patientId) {
      db.prepare(`UPDATE patients SET
        real_name=COALESCE(NULLIF(?,''), real_name),
        display_name=COALESCE(NULLIF(?,''), display_name),
        gender=COALESCE(NULLIF(?,''), gender),
        birth_date=COALESCE(NULLIF(?,''), birth_date),
        updated_at=? WHERE id=? AND doctor_id=?`)
        .run(name, name, gender, birthDate, now, +patientId, +doctorId);
    }

    // 3) 扩展档案字段（疾病/过敏/疾病史/妊娠）→ patient_profile_fields（身份证号已下线）
    const fieldPayload = {};
    for (const k of ["disease", "pregnancyStatus", "foodContactAllergies", "drugAllergies", "diseaseHistory"]) {
      if (Object.prototype.hasOwnProperty.call(b, k)) fieldPayload[k] = b[k];
    }
    if (Object.keys(fieldPayload).length) {
      try {
        profileStore.upsertPersonFields(personId, fieldPayload, "patient", "mp-patient");
      } catch (e) {
        return json(res, 500, { error: "档案保存失败：" + ((e && e.message) || "") });
      }
    }

    json(res, 200, { ok: true });
  });

  /** GET /api/mp/me/health-records — 读取患者真实健康记录（按 person 或 patient 维度） */
  route("GET", /^\/api\/mp\/me\/health-records$/, (req, res, m, q) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { personId, patientId, doctorId } = resolveOwn(sess);
    const catFilter = String(q.category || "").trim();
    let rows = [];
    if (personId) {
      if (catFilter) {
        if (!phr.HEALTH_RECORD_CATEGORY_KEYS.has(catFilter)) return json(res, 400, { error: "category 非法" });
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.person_id=? AND phr.category=? ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`)
          .all(+personId, catFilter);
      } else {
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.person_id=? ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`).all(+personId);
      }
    } else if (patientId && doctorId) {
      if (catFilter) {
        if (!phr.HEALTH_RECORD_CATEGORY_KEYS.has(catFilter)) return json(res, 400, { error: "category 非法" });
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.doctor_id=? AND phr.patient_id=? AND phr.category=? ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`)
          .all(+doctorId, +patientId, catFilter);
      } else {
        rows = db.prepare(`SELECT phr.*, d.name AS source_doctor_name FROM patient_health_records phr
          LEFT JOIN doctors d ON d.id = phr.doctor_id
          WHERE phr.doctor_id=? AND phr.patient_id=? ORDER BY COALESCE(phr.recorded_at,'') DESC, phr.id DESC`)
          .all(+doctorId, +patientId);
      }
    }
    const counts = {};
    for (const c of phr.HEALTH_RECORD_CATEGORIES) counts[c.key] = 0;
    const countRows = personId
      ? db.prepare("SELECT category, COUNT(*) AS c FROM patient_health_records WHERE person_id=? GROUP BY category").all(+personId)
      : (patientId && doctorId
          ? db.prepare("SELECT category, COUNT(*) AS c FROM patient_health_records WHERE doctor_id=? AND patient_id=? GROUP BY category").all(+doctorId, +patientId)
          : []);
    for (const r of countRows) counts[r.category] = r.c || 0;
    json(res, 200, {
      categories: phr.HEALTH_RECORD_CATEGORIES.map(c => ({ ...c, count: counts[c.key] || 0 })),
      items: rows.map(phr.mapHealthRecordRow),
      total: rows.length
    });
  });

  /** GET /api/mp/me/followup — 待跟进摘要（近期待跟进提交 + 随访） */
  route("GET", /^\/api\/mp\/me\/followup$/, (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { personId, patientId, doctorId } = resolveOwn(sess);

    let submissions = [];
    let followups = [];
    try {
      if (patientId) {
        submissions = db.prepare(
          `SELECT id, type, status, created_at FROM submissions
           WHERE patient_id=? AND doctor_id=? ORDER BY id DESC LIMIT 20`
        ).all(+patientId, +doctorId);
      }
    } catch (e) {}
    try {
      if (patientId) {
        followups = db.prepare(
          `SELECT id, plan_name, status, created_at FROM followups
           WHERE patient_id=? AND doctor_id=? ORDER BY id DESC LIMIT 20`
        ).all(+patientId, +doctorId);
      }
    } catch (e) {}

    const pendingSubs = submissions.filter(s => ["待跟进", "待联系", "待验证"].includes(String(s.status || "")));
    const pendingFollows = followups.filter(f => ["active", "pending", "待跟进"].includes(String(f.status || "")));
    const latest = pendingSubs[0] || pendingFollows[0] || null;
    json(res, 200, {
      pendingCount: pendingSubs.length + pendingFollows.length,
      latestTitle: latest ? (latest.plan_name || latest.type || "") : "",
      latestStatus: latest ? (latest.status || "") : "",
      items: [
        ...pendingSubs.slice(0, 10).map(s => ({ type: s.type, status: s.status, time: s.created_at || "" })),
        ...pendingFollows.slice(0, 10).map(f => ({ type: "随访", status: f.status || "", time: f.created_at || "", plan: f.plan_name || "" }))
      ]
    });
  });

  /** GET /api/mp/me/stories — 口碑墙（已认证患者评价） */
  route("GET", /^\/api\/mp\/me\/stories$/, (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    try {
      const rows = db.prepare(
        `SELECT id, type, payload, status, created_at FROM submissions
         WHERE type='口碑' AND status='已认证' ORDER BY id DESC LIMIT 50`
      ).all();
      const items = rows.map(r => {
        let payload = {};
        try { payload = JSON.parse(r.payload || "{}"); } catch (e) {}
        return { id: r.id, text: payload.text || payload.content || "", name: payload.name || "患者", time: r.created_at || "" };
      });
      json(res, 200, { items });
    } catch (e) {
      json(res, 200, { items: [] });
    }
  });

  /** POST /api/mp/me/thanks — 送心意/感谢 */
  route("POST", /^\/api\/mp\/me\/thanks$/, async (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { patientId, doctorId } = resolveOwn(sess);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO submissions(doctor_id, patient_id, type, status, payload, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(
        +doctorId, patientId || null, "感谢", "待跟进",
        JSON.stringify({ text: String(b.text || "").trim().slice(0, 500) }),
        now, now
      );
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: "提交失败" });
    }
  });

  /** POST /api/mp/me/waitlist — 候补登记 */
  route("POST", /^\/api\/mp\/me\/waitlist$/, async (req, res) => {
    const sess = requireMpSession(req, res, json);
    if (!sess) return;
    const { patientId, doctorId } = resolveOwn(sess);
    const b = await parseBody(req, MESSAGE_MAX_BODY || 1e6);
    const now = new Date().toISOString();
    try {
      const info = db.prepare(`INSERT INTO waitlist(doctor_id, patient_id, type, payload, status, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(
        +doctorId, patientId || null, String(b.type || "加号").slice(0, 20),
        JSON.stringify({ note: String(b.note || "").trim().slice(0, 200) }),
        "waiting", now, now
      );
      json(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
    } catch (e) {
      json(res, 500, { error: "提交失败" });
    }
  });
}

module.exports = { registerMpMeRoutes };
