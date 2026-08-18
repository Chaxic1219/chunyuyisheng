const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data.db");
const docs = db.prepare("SELECT id,name FROM doctors").all();
console.log(docs);
for (const d of docs) {
  const n = db.prepare("SELECT COUNT(*) c FROM patients WHERE doctor_id=?").get(d.id).c;
  console.log("doctor", d.id, d.name, "patients", n);
  const dup = db
    .prepare(
      `SELECT external_id, COUNT(DISTINCT patient_id) n, GROUP_CONCAT(DISTINCT patient_id) pids
       FROM patient_identities WHERE doctor_id=? AND external_id IS NOT NULL AND trim(external_id)!=''
       GROUP BY external_id HAVING n>1`
    )
    .all(d.id);
  console.log("dup eid", dup.length, JSON.stringify(dup.slice(0, 10)));
  const names = db
    .prepare(
      `SELECT display_name, COUNT(*) c, GROUP_CONCAT(id) ids FROM patients WHERE doctor_id=? GROUP BY display_name HAVING c>1`
    )
    .all(d.id);
  console.log("dup names", names.length, JSON.stringify(names.slice(0, 15)));
}
