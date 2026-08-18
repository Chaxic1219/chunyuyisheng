const { ensureSchema } = require('./schema.js');

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function createRepo(db) {
  ensureSchema(db);
  const now = () => new Date().toISOString();
  const publicAccount = row => row && ({ id: row.id, doctorId: row.doctor_id, accountId: row.platform_account_id,
    name: row.account_name, avatarUrl: row.avatar_url, bindMethod: row.bind_method, enabled: !!row.enabled,
    groupScope: row.group_scope, groupIds: parseJson(row.group_ids, []), syncCursor: row.sync_cursor,
    initialSyncCompletedAt: row.initial_sync_completed_at || '', lastSyncedAt: row.last_synced_at || '',
    lastSyncError: row.last_sync_error || '' });
  const publicVideo = row => row && ({ id: row.id, accountId: row.account_id, doctorId: row.doctor_id,
    platformVideoId: row.platform_video_id, title: row.title, description: row.description,
    coverUrl: row.cover_url, publishedAt: row.published_at, feedVideo: parseJson(row.feed_video_payload, {}),
    discoveryKind: row.discovery_kind, reviewStatus: row.review_status, reviewNote: row.review_note || '' });
  return {
    createAccount(input, username) {
      const ts = now();
      const result = db.prepare(`INSERT INTO video_channel_accounts
        (doctor_id,platform_account_id,account_name,avatar_url,bind_method,group_scope,group_ids,sync_cursor,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.doctorId, input.accountId, input.name, input.avatarUrl,
          input.bindMethod, input.groupScope, JSON.stringify(input.groupIds || []), input.cursor || '', username, username, ts, ts);
      return publicAccount(db.prepare('SELECT * FROM video_channel_accounts WHERE id=?').get(Number(result.lastInsertRowid)));
    },
    account(id) { return publicAccount(db.prepare('SELECT * FROM video_channel_accounts WHERE id=?').get(+id)); },
    accountRow(id) { return db.prepare('SELECT * FROM video_channel_accounts WHERE id=?').get(+id) || null; },
    listAccounts(doctorId) { return db.prepare('SELECT * FROM video_channel_accounts WHERE doctor_id=? ORDER BY id DESC').all(+doctorId).map(publicAccount); },
    insertVideo(account, video, discoveryKind) {
      const ts = now();
      const status = video.complete ? (discoveryKind === 'initial' ? 'not_required' : 'pending') : 'incomplete';
      db.prepare(`INSERT INTO video_channel_videos(account_id,doctor_id,platform_video_id,title,description,cover_url,published_at,
        feed_video_payload,discovery_kind,review_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account_id,platform_video_id) DO NOTHING`).run(account.id, account.doctor_id, video.videoId,
          video.title, video.description, video.coverUrl, video.publishedAt, JSON.stringify(video.feedVideo), discoveryKind, status, ts, ts);
    },
    listVideos(doctorId) { return db.prepare('SELECT * FROM video_channel_videos WHERE doctor_id=? ORDER BY published_at DESC,id DESC').all(+doctorId).map(publicVideo); },
    video(id) { return publicVideo(db.prepare('SELECT * FROM video_channel_videos WHERE id=?').get(+id)); },
    claimApproval(id) {
      const ts = now();
      const result = db.prepare("UPDATE video_channel_videos SET review_status='sending',updated_at=? WHERE id=? AND review_status='pending'").run(ts, +id);
      return { changed: result.changes === 1, video: this.video(id) };
    },
    finishApproval(id, username, error) {
      const ts = now();
      db.prepare(`UPDATE video_channel_videos SET review_status=?,review_note=?,reviewed_by=?,reviewed_at=?,updated_at=?
        WHERE id=? AND review_status='sending'`).run(error ? 'pending' : 'approved', error || '', username, error ? null : ts, ts, +id);
      return this.video(id);
    },
    rejectVideo(id, reason, username) {
      const ts = now();
      db.prepare("UPDATE video_channel_videos SET review_status='rejected',review_note=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND review_status='pending'")
        .run(String(reason || '').slice(0, 500), username, ts, ts, +id);
      return this.video(id);
    },
    createSchedule(input, username) {
      const ts = now();
      const result = db.prepare(`INSERT INTO video_channel_schedules(video_id,doctor_id,execute_at,group_scope_snapshot,
        group_ids_snapshot,fire_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(input.videoId,
          input.doctorId, input.executeAt, input.groupScope, JSON.stringify(input.groupIds || []), input.fireKey, username, ts, ts);
      return this.schedule(Number(result.lastInsertRowid));
    },
    schedule(id) {
      const row = db.prepare('SELECT * FROM video_channel_schedules WHERE id=?').get(+id);
      return row && { id: row.id, videoId: row.video_id, doctorId: row.doctor_id, executeAt: row.execute_at,
        groupScope: row.group_scope_snapshot, groupIds: parseJson(row.group_ids_snapshot, []), status: row.status,
        fireKey: row.fire_key, lastError: row.last_error || '' };
    },
    dueSchedules(nowIso) { return db.prepare("SELECT id FROM video_channel_schedules WHERE status IN ('pending','failed') AND execute_at<=? ORDER BY execute_at,id").all(nowIso); },
    listSchedules(doctorId) { return db.prepare('SELECT id FROM video_channel_schedules WHERE doctor_id=? ORDER BY execute_at DESC,id DESC').all(+doctorId).map(row => this.schedule(row.id)); },
    cancelSchedule(id) { db.prepare("UPDATE video_channel_schedules SET status='cancelled',updated_at=? WHERE id=? AND status='pending'").run(now(), +id); return this.schedule(id); },
    claimSchedule(id) { return db.prepare("UPDATE video_channel_schedules SET status='running',last_attempt_at=?,updated_at=? WHERE id=? AND status IN ('pending','failed')").run(now(), now(), +id).changes === 1; },
    finishSchedule(id, error) { db.prepare("UPDATE video_channel_schedules SET status=?,last_error=?,updated_at=? WHERE id=?").run(error ? 'failed' : 'completed', error || '', now(), +id); },
    markSynced(id, cursor, initial) {
      const ts = now();
      db.prepare(`UPDATE video_channel_accounts SET sync_cursor=?,initial_sync_completed_at=COALESCE(initial_sync_completed_at,?),
        last_synced_at=?,last_sync_error='',updated_at=? WHERE id=?`).run(cursor || '', initial ? ts : null, ts, ts, +id);
      return this.account(id);
    }
  };
}

module.exports = { createRepo };
