const { normalizeFeedVideo, missingFeedVideoFields } = require('../outbound/feed-video.js');

function unavailable() {
  const error = new Error('微信视频号官方接口尚未配置');
  error.code = 'VIDEO_CHANNEL_PROVIDER_UNAVAILABLE';
  throw error;
}

function normalizeAccount(raw) {
  const item = raw || {};
  return {
    accountId: String(item.accountId || item.id || '').trim(),
    name: String(item.name || '').trim(),
    avatarUrl: String(item.avatarUrl || '').trim(),
    cursor: String(item.cursor || '').trim()
  };
}

function normalizeVideo(raw) {
  const item = raw || {};
  const feedVideo = normalizeFeedVideo(item.feedVideo || item);
  return {
    videoId: String(item.videoId || item.id || '').trim(),
    title: String(item.title || '').trim(),
    description: String(item.description || '').trim(),
    coverUrl: String(item.coverUrl || feedVideo.coverUrl || '').trim(),
    publishedAt: String(item.publishedAt || '').trim(),
    feedVideo,
    complete: missingFeedVideoFields(feedVideo).length === 0
  };
}

module.exports = { official: { bind: unavailable, listVideos: unavailable }, normalizeAccount, normalizeVideo };
