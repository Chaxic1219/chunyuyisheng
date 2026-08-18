const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data.db");
const rows = db
  .prepare(
    "SELECT id, display_name FROM patients WHERE doctor_id=1 ORDER BY id DESC LIMIT 40"
  )
  .all();
console.log(JSON.stringify(rows, null, 2));
const dup = db
  .prepare(
    `SELECT external_id, COUNT(DISTINCT patient_id) n, GROUP_CONCAT(DISTINCT patient_id) pids
     FROM patient_identities WHERE doctor_id=1
     GROUP BY external_id HAVING n>1`
  )
  .all();
console.log("dup eid", JSON.stringify(dup));
