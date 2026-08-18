#!/usr/bin/env node

/* 现网 M2：回填 person_id；跨医生合并按微信名称 */

const { db, mergePersons, resolvePatientWechatName } = require("./db.js");

const { createPersonApi, isRealQiweUserId } = require("./person.js");



const personApi = createPersonApi(db);

const patients = db.prepare("SELECT * FROM patients WHERE person_id IS NULL ORDER BY id").all();

let linked = 0;

for (const p of patients) {

  let qiweUserId = "";

  const idn = db.prepare(`SELECT external_id FROM patient_identities WHERE patient_id=?

    ORDER BY CASE channel WHEN 'qiwe' THEN 0 WHEN 'wecom' THEN 1 ELSE 2 END, id LIMIT 1`).get(p.id);

  if (idn && isRealQiweUserId(idn.external_id)) qiweUserId = String(idn.external_id).trim();

  const wechatName = resolvePatientWechatName(p.doctor_id, p.id, {

    displayName: p.display_name

  });

  const personId = personApi.resolvePerson({

    qiweUserId,

    wechatName,

    realName: p.real_name,

    gender: p.gender,

    birthDate: p.birth_date,

    phone: p.phone,

    phoneVerified: p.phone_verified === 1,

    unionid: p.unionid,

    avatarUrl: p.avatar_url

  });

  db.prepare("UPDATE patients SET person_id=? WHERE id=?").run(personId, p.id);

  linked++;

}

db.exec(`UPDATE patient_profile_fields SET person_id=(

  SELECT person_id FROM patients WHERE patients.id=patient_profile_fields.patient_id

) WHERE person_id IS NULL AND patient_id IS NOT NULL`);

db.exec(`UPDATE patient_health_records SET person_id=(

  SELECT person_id FROM patients WHERE patients.id=patient_health_records.patient_id

) WHERE person_id IS NULL AND patient_id IS NOT NULL`);



const dupes = db.prepare(`

  SELECT wechat_group_name, GROUP_CONCAT(id) AS ids, COUNT(*) c

  FROM persons WHERE wechat_group_name IS NOT NULL AND trim(wechat_group_name)!=''

  GROUP BY wechat_group_name HAVING c > 1`).all();

for (const d of dupes) {

  const ids = String(d.ids || "").split(",").map((x) => +x).filter((x) => x > 0);

  if (ids.length < 2) continue;

  mergePersons(ids[0], ids.slice(1), "migrate", "wechat_name");

}



console.log("migrate_person_ids: linked", linked, "patients; persons total", db.prepare("SELECT COUNT(*) c FROM persons").get().c);

