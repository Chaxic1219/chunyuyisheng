const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('./modules/video-channel/schema.js');
const { createService } = require('./modules/video-channel/service.js');

const db = new DatabaseSync(':memory:');
ensureSchema(db);
db.exec(`CREATE TABLE community_groups(id INTEGER PRIMARY KEY,doctor_id INTEGER,name TEXT,status TEXT,channel_type TEXT,external_group_id TEXT);
  INSERT INTO community_groups VALUES(11,1,'骨科康复群','active','qiwe','room-11');
  INSERT INTO community_groups VALUES(12,1,'关节健康群','active','qiwe','room-12');`);
const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
for (const [table, expected] of Object.entries({
  video_channel_accounts: ['doctor_id','platform_account_id','group_scope','group_ids','sync_cursor','initial_sync_completed_at','last_sync_error'],
  video_channel_videos: ['platform_video_id','feed_video_payload','discovery_kind','review_status','review_note'],
  video_channel_schedules: ['execute_at','group_scope_snapshot','group_ids_snapshot','status','fire_key','last_error']
})) {
  const actual = columns(table);
  for (const name of expected) assert.ok(actual.includes(name), `${table} missing ${name}`);
}
console.log('video channel schema ok');

function feed(id) {
  const feedVideo = Object.fromEntries([
    'channelName','channelUrl','coverUrl','encodeData','headImgUrl','feedId','feedNo','username'
  ].map(key => [key, `${key}-${id}`]));
  return { videoId: id, title: `视频${id}`, description: '', coverUrl: `cover-${id}`,
    publishedAt: `2026-08-1${id.slice(-1)}T08:00:00.000Z`, feedVideo };
}

const fake = {
  async bind() { return { accountId: 'wx-a', name: '王医生视频号', avatarUrl: 'a.jpg', cursor: '' }; },
  async listVideos(_, cursor) {
    if (!cursor) return { items: [feed('v2'), feed('v1')], nextCursor: 'c1', hasMore: false };
    return { items: [feed('v3')], nextCursor: 'c2', hasMore: false };
  }
};

(async () => {
  const sent = [];
  const delivered = [];
  const outbox = {
    async enqueue(row) { sent.push(row); return { id: sent.length, status: 'pending' }; },
    async setOutboxStatus(id, status, username, options) { delivered.push({ id, status, username, options }); }
  };
  const service = createService({ db, provider: fake, outbox });
  const account = await service.bindAccount({ doctorId: 1, bindMethod: 'account_info', groupScope: 'all' }, 'ops');
  let videos = service.listVideos(1).items;
  assert.equal(videos.length, 2);
  assert.ok(videos.every(item => item.reviewStatus === 'not_required'));
  await service.syncAccount(account.id);
  await service.syncAccount(account.id);
  videos = service.listVideos(1).items;
  assert.equal(videos.length, 3);
  assert.equal(videos.filter(item => item.reviewStatus === 'pending').length, 1);
  const pending = videos.find(item => item.reviewStatus === 'pending');
  assert.equal((await service.approveVideo(pending.id, 'ops')).queued, 2);
  assert.equal((await service.approveVideo(pending.id, 'ops')).queued, 0);
  assert.equal(sent.length, 2);
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every(item => item.status === 'sent' && item.options.requireRealSend));
  assert.ok(sent.every(row => row.payload.responses[0].type === 'feed_video'));
  const manual = await service.forwardNow({ videoId: pending.id, groupScope: 'selected', groupIds: [11] }, 'ops');
  assert.equal(manual.queued, 1);
  await assert.rejects(() => service.forwardNow({ videoId: pending.id, groupScope: 'selected', groupIds: [999] }, 'ops'), /目标群/);
  assert.throws(() => service.rejectVideo(pending.id, '', 'ops'), /拒绝原因/);
  const schedule = service.createSchedule({ videoId: pending.id, executeAt: '2026-08-14T10:00:00.000Z', groupScope: 'selected', groupIds: [12] }, 'ops');
  await service.runDueSchedules(new Date('2026-08-14T10:01:00.000Z'));
  await service.runDueSchedules(new Date('2026-08-14T10:02:00.000Z'));
  assert.equal(sent.filter(row => row.payload.videoChannel.scheduleId === schedule.id).length, 1);
  assert.equal((await service.retrySchedule(schedule.id)).status, 'completed');
  console.log('video channel sync ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
