"use strict";

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbound_assets(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      group_code TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbound_triggers(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      match_type TEXT NOT NULL DEFAULT 'exact',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbound_trigger_steps(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS qiwe_feed_video_captures(
      doctor_id INTEGER PRIMARY KEY,
      asset_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      started_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_outbound_assets_doctor ON outbound_assets(doctor_id, group_code);
    CREATE INDEX IF NOT EXISTS idx_outbound_triggers_doctor ON outbound_triggers(doctor_id, kind, code);
    CREATE INDEX IF NOT EXISTS idx_outbound_steps_trigger ON outbound_trigger_steps(trigger_id, sort);
    CREATE INDEX IF NOT EXISTS idx_feed_video_capture_asset ON qiwe_feed_video_captures(asset_id);
  `);
}

module.exports = { ensureSchema };
