const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const router = read('../admin-ui/src/router/modules/chunyu.ts');
const api = read('../admin-ui/src/api/chunyu/index.ts');
const view = read('../admin-ui/src/views/chunyu/ops/video-channels/index.vue');
const routes = read('routes/video-channel-admin.js');
for (const token of ['/ops/video-channels', 'OpsVideoChannels', '/chunyu/ops/video-channels/index']) assert.ok(router.includes(token), `router missing ${token}`);
assert.match(router, /title:\s*'视频号运营'[^\n]*isHide:\s*true/, 'video channel page must remain hidden until official access is configured');
for (const token of ["'accounts'", "'videos'", "'review'", "'tasks'", '同意并发送', '立即转发', '定时转发', '重试失败群']) assert.ok(view.includes(token), `view missing ${token}`);
for (const token of ['VideoChannelAccount', 'VideoChannelVideo', 'VideoChannelSchedule']) assert.ok(api.includes(token), `api missing ${token}`);
for (const token of ['dashboard.doctor.read', 'ops.strategy.manage', 'community.outbox.send']) assert.ok(routes.includes(token), `route missing ${token}`);
console.log('video channel ui ok');
