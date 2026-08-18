function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_channel_accounts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER NOT NULL,
      platform_account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '',
      bind_method TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      group_scope TEXT NOT NULL DEFAULT 'all', group_ids TEXT NOT NULL DEFAULT '[]',
      sync_cursor TEXT NOT NULL DEFAULT '', initial_sync_completed_at TEXT,
      last_synced_at TEXT, last_sync_error TEXT, created_by TEXT, updated_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_video_channel_current_doctor
      ON video_channel_accounts(doctor_id) WHERE enabled=1;
    CREATE TABLE IF NOT EXISTS video_channel_videos(
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, doctor_id INTEGER NOT NULL,
      platform_video_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
      feed_video_payload TEXT NOT NULL DEFAULT '{}', discovery_kind TEXT NOT NULL,
      review_status TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(account_id, platform_video_id)
    );
    CREATE TABLE IF NOT EXISTS video_channel_schedules(
      id INTEGER PRIMARY KEY AUTOINCREMENT, video_id INTEGER NOT NULL, doctor_id INTEGER NOT NULL,
      execute_at TEXT NOT NULL, group_scope_snapshot TEXT NOT NULL,
      group_ids_snapshot TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
      fire_key TEXT NOT NULL UNIQUE, last_attempt_at TEXT, last_error TEXT,
      created_by TEXT, executed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_channel_review ON video_channel_videos(doctor_id, review_status, published_at);
    CREATE INDEX IF NOT EXISTS idx_video_channel_schedule_due ON video_channel_schedules(status, execute_at);
  `);
}

module.exports = { ensureSchema };
