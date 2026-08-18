"use strict";

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS science_reminder_plans(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    cadence TEXT NOT NULL,
    weekday INTEGER,
    hour INTEGER NOT NULL DEFAULT 9,
    minute INTEGER NOT NULL DEFAULT 0,
    topic TEXT,
    mode TEXT NOT NULL DEFAULT 'template',
    audience TEXT,
    notes TEXT,
    knowledge_id INTEGER,
    knowledge_mode TEXT NOT NULL DEFAULT 'none',
    knowledge_ids TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fire_key TEXT,
    last_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY(group_id) REFERENCES community_groups(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_science_plans_doctor
    ON science_reminder_plans(doctor_id, enabled)`);

  const columns = new Set(
    db.prepare("PRAGMA table_info(science_reminder_plans)").all().map((x) => x.name)
  );
  const additions = [
    ["minute", "INTEGER NOT NULL DEFAULT 0"],
    ["audience", "TEXT"],
    ["notes", "TEXT"],
    ["knowledge_mode", "TEXT NOT NULL DEFAULT 'none'"],
    ["knowledge_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["last_attempt_at", "TEXT"],
    ["last_error", "TEXT"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE science_reminder_plans ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`UPDATE science_reminder_plans
    SET knowledge_mode=CASE WHEN mode='ops_candidate' THEN 'auto' ELSE COALESCE(knowledge_mode,'none') END,
        mode=CASE WHEN mode='ops_candidate' THEN 'template' ELSE mode END
    WHERE mode='ops_candidate' OR knowledge_mode IS NULL`);
}

module.exports = { ensureSchema };
