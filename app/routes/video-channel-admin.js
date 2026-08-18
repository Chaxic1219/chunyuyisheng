function registerVideoChannelAdminRoutes(route, ctx) {
  const { parseBody, json, gate, requireAdminAction } = ctx;
  const service = require('../modules/video-channel/index.js').service;
  const auth = (req, res, action, doctorId) => {
    const session = gate(req, res);
    return session && requireAdminAction(req, res, session, action, { doctorId: +doctorId }, '无视频号运营权限') ? session : null;
  };
  const attempt = async (res, work) => { try { json(res, 200, { ok: true, ...(await work()) }); } catch (error) { json(res, 400, { error: error.message }); } };
  const doctorId = req => new URL(req.url, 'http://x').searchParams.get('doctorId');

  route('GET', /^\/api\/admin\/video-channels$/, (req, res) => {
    const id = doctorId(req); if (!auth(req, res, 'dashboard.doctor.read', id)) return;
    json(res, 200, { ok: true, accounts: service.listAccounts(id) });
  });
  route('GET', /^\/api\/admin\/video-channel-videos$/, (req, res) => {
    const id = doctorId(req); if (!auth(req, res, 'dashboard.doctor.read', id)) return;
    json(res, 200, { ok: true, ...service.listVideos(id) });
  });
  route('GET', /^\/api\/admin\/video-channel-schedules$/, (req, res) => {
    const id = doctorId(req); if (!auth(req, res, 'dashboard.doctor.read', id)) return;
    json(res, 200, { ok: true, items: service.listSchedules(id) });
  });
  route('POST', /^\/api\/admin\/video-channels\/bind$/, async (req, res) => {
    const body = await parseBody(req); const session = auth(req, res, 'ops.strategy.manage', body.doctorId); if (!session) return;
    await attempt(res, async () => ({ account: await service.bindAccount(body, session.username) }));
  });
  route('POST', /^\/api\/admin\/video-channels\/(\d+)\/sync$/, async (req, res, match) => {
    const session = auth(req, res, 'ops.strategy.manage', service.accountDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ account: await service.syncAccount(match[1]) }));
  });
  route('POST', /^\/api\/admin\/video-channel-videos\/(\d+)\/approve$/, async (req, res, match) => {
    const session = auth(req, res, 'community.outbox.send', service.videoDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ result: await service.approveVideo(match[1], session.username) }));
  });
  route('POST', /^\/api\/admin\/video-channel-videos\/(\d+)\/reject$/, async (req, res, match) => {
    const body = await parseBody(req); const session = auth(req, res, 'community.outbox.send', service.videoDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ video: service.rejectVideo(match[1], body.reason, session.username) }));
  });
  route('POST', /^\/api\/admin\/video-channel-videos\/(\d+)\/forward$/, async (req, res, match) => {
    const body = await parseBody(req); const session = auth(req, res, 'community.outbox.send', service.videoDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ result: await service.forwardNow({ ...body, videoId: +match[1] }, session.username) }));
  });
  route('POST', /^\/api\/admin\/video-channel-schedules$/, async (req, res) => {
    const body = await parseBody(req); const session = auth(req, res, 'community.outbox.send', service.videoDoctorId(body.videoId)); if (!session) return;
    await attempt(res, async () => ({ item: service.createSchedule(body, session.username) }));
  });
  route('POST', /^\/api\/admin\/video-channel-schedules\/(\d+)\/cancel$/, async (req, res, match) => {
    const session = auth(req, res, 'community.outbox.send', service.scheduleDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ item: service.cancelSchedule(match[1]) }));
  });
  route('POST', /^\/api\/admin\/video-channel-schedules\/(\d+)\/retry$/, async (req, res, match) => {
    const session = auth(req, res, 'community.outbox.send', service.scheduleDoctorId(match[1])); if (!session) return;
    await attempt(res, async () => ({ item: await service.retrySchedule(match[1]) }));
  });
}
module.exports = { registerVideoChannelAdminRoutes };
