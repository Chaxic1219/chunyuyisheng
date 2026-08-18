const providerTools = require('./provider.js');
const { createRepo } = require('./repo.js');
const crypto = require('node:crypto');

function createService({ db, provider, outbox }) {
  const repo = createRepo(db);
  const source = provider || providerTools.official;
  const queue = outbox || require('../outbox/index.js');

  function groups(doctorId, scope, ids) {
    const wanted = scope === 'selected' ? new Set((ids || []).map(Number)) : null;
    const found = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? AND status='active' ORDER BY id").all(+doctorId)
      .filter(group => !wanted || wanted.has(group.id));
    if (wanted && found.length !== wanted.size) throw new Error('目标群不存在或不属于当前医生');
    if (!found.length) throw new Error('没有可发送的目标群');
    return found;
  }

  async function enqueueVideoBatch({ video, targetGroups, sourceName, batchKey, username, scheduleId }) {
    let queued = 0, sent = 0, skipped = 0;
    const errors = [];
    for (const group of targetGroups) {
      const payload = { responses: [{ type: 'feed_video', title: video.title || '视频号', feedVideo: video.feedVideo }],
        videoChannel: { videoId: video.id, accountId: video.accountId, batchKey, ...(scheduleId ? { scheduleId } : {}) },
        reviewerRequired: false };
      let queuedRow = null;
      try {
        queuedRow = db.prepare("SELECT id,status FROM outbound_queue WHERE doctor_id=? AND group_id=? AND source=? AND payload LIKE ? ORDER BY id DESC LIMIT 1")
          .get(video.doctorId, group.id, sourceName, `%\"batchKey\":\"${batchKey}\"%`) || null;
      } catch (_) {}
      if (queuedRow?.status === 'sent') { skipped++; continue; }
      if (!queuedRow) {
        queuedRow = await queue.enqueue({ doctorId: video.doctorId, group, targetName: group.name, text: '', payload,
          status: 'pending', source: sourceName, username });
        queued++;
      }
      try {
        await queue.setOutboxStatus(queuedRow.id, 'sent', username, { requireRealSend: true });
        sent++;
      } catch (error) {
        errors.push({ groupId: group.id, groupName: group.name, error: String(error.message || error).slice(0, 500) });
      }
    }
    return { queued, sent, skipped, failed: errors.length, errors };
  }

  async function pull(account, initial) {
    let cursor = initial ? '' : account.sync_cursor;
    do {
      const page = await source.listVideos(account.platform_account_id, cursor);
      for (const raw of page.items || []) repo.insertVideo(account, providerTools.normalizeVideo(raw), initial ? 'initial' : 'incremental');
      cursor = String(page.nextCursor || '');
      if (!page.hasMore) break;
    } while (true);
    return repo.markSynced(account.id, cursor, initial);
  }

  return {
    async bindAccount(input, username) {
      const accountInfo = providerTools.normalizeAccount(await source.bind(input));
      if (!accountInfo.accountId) throw new Error('无法读取视频号账号');
      const account = repo.createAccount({ ...input, ...accountInfo, groupIds: input.groupIds || [] }, username);
      await pull(repo.accountRow(account.id), true);
      return repo.account(account.id);
    },
    async syncAccount(id) {
      const account = repo.accountRow(id);
      if (!account) throw new Error('视频号账号不存在');
      return pull(account, !account.initial_sync_completed_at);
    },
    listAccounts(doctorId) { return repo.listAccounts(doctorId); },
    listVideos(doctorId) { return { items: repo.listVideos(doctorId) }; },
    accountDoctorId(id) { return repo.account(id)?.doctorId || null; },
    videoDoctorId(id) { return repo.video(id)?.doctorId || null; },
    scheduleDoctorId(id) { return repo.schedule(id)?.doctorId || null; },
    async approveVideo(id, username) {
      const approved = repo.claimApproval(id);
      if (!approved.changed) return { queued: 0 };
      const account = repo.account(approved.video.accountId);
      try {
        const result = await enqueueVideoBatch({ video: approved.video,
          targetGroups: groups(approved.video.doctorId, account.groupScope, account.groupIds),
          sourceName: 'video_channel_review', batchKey: `video-review:${approved.video.id}`, username });
        repo.finishApproval(id, username, result.failed ? result.errors.map(item => `${item.groupName}:${item.error}`).join(';').slice(0, 500) : '');
        return result;
      } catch (error) {
        repo.finishApproval(id, username, String(error.message || error).slice(0, 500));
        throw error;
      }
    },
    rejectVideo(id, reason, username) {
      if (!String(reason || '').trim()) throw new Error('请填写拒绝原因');
      return repo.rejectVideo(id, reason, username);
    },
    async forwardNow(input, username) {
      const video = repo.video(input.videoId);
      if (!video || video.reviewStatus === 'incomplete') throw new Error('视频不可转发');
      return enqueueVideoBatch({ video, targetGroups: groups(video.doctorId, input.groupScope, input.groupIds),
        sourceName: 'video_channel_manual', batchKey: `video-manual:${crypto.randomUUID()}`, username });
    },
    createSchedule(input, username) {
      const video = repo.video(input.videoId);
      if (!video) throw new Error('视频不存在');
      if (Date.parse(input.executeAt) <= Date.now()) throw new Error('执行时间必须在未来');
      return repo.createSchedule({ ...input, doctorId: video.doctorId, fireKey: crypto.randomUUID() }, username);
    },
    listSchedules(doctorId) { return repo.listSchedules(doctorId); },
    cancelSchedule(id) { return repo.cancelSchedule(id); },
    async retrySchedule(id) {
      const schedule = repo.schedule(id);
      if (!schedule || schedule.status !== 'failed') return schedule;
      await this.runDueSchedules(new Date());
      return repo.schedule(id);
    },
    async runDueSchedules(nowDate) {
      for (const due of repo.dueSchedules(nowDate.toISOString())) {
        if (!repo.claimSchedule(due.id)) continue;
        const schedule = repo.schedule(due.id);
        const video = repo.video(schedule.videoId);
        try {
          const result = await enqueueVideoBatch({ video, targetGroups: groups(schedule.doctorId, schedule.groupScope, schedule.groupIds),
            sourceName: 'video_channel_schedule', batchKey: `video-schedule:${schedule.id}`, scheduleId: schedule.id, username: 'scheduler' });
          repo.finishSchedule(schedule.id, result.failed ? result.errors.map(item => `${item.groupName}:${item.error}`).join(';').slice(0, 500) : '');
        } catch (error) { repo.finishSchedule(schedule.id, String(error.message || error).slice(0, 500)); }
      }
    }
  };
}

module.exports = { createService };
