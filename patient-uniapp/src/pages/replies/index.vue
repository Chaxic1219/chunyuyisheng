<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { getRepliesMine, type ReplyItem } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";

const store = useAppStore();
const auth = useAuthStore();
const items = ref<ReplyItem[]>([]);
const loaded = ref(false);
const loading = ref(false);
const error = ref("");
let latestRequestId = 0;

async function load() {
  if (loading.value) return;
  const doctorId = store.doctor?.id;
  if (!doctorId) {
    error.value = "服务信息未加载，请稍后重试";
    return;
  }
  error.value = "";
  loading.value = true;
  loaded.value = false;
  const requestId = ++latestRequestId;
  try {
    const result = await getRepliesMine(Number(doctorId));
    if (requestId !== latestRequestId) return;
    items.value = result.items;
    loaded.value = true;
  } catch (err) {
    if (requestId !== latestRequestId) return;
    error.value = "回复记录查询失败，请稍后重试";
    console.error(err);
  } finally {
    if (requestId === latestRequestId) loading.value = false;
  }
}

onShow(() => {
  void (async () => {
    if (!auth.phoneBound) {
      const ok = await ensureLogin("/pages/replies/index");
      if (!ok) return;
    }
    if (!store.bootstrap) await store.load();
    await load();
  })();
});
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom replies-page" :class="{ elder: store.elderMode }">
    <view class="query-intro cu-card radius shadow">
      <view class="query-intro__icon radius bg-blue light"><AppIcon name="reply-record" :size="34" /></view>
      <view>
        <text class="query-intro__eyebrow">我的服务记录</text>
        <text class="query-intro__title">我的申请回复</text>
        <text class="query-intro__copy">已按当前登录手机号自动查询加号、联络表与随访进度。</text>
      </view>
    </view>

    <view v-if="loading" class="state-card result-state">正在核对服务记录…</view>
    <view v-else-if="error" class="state-card result-state result-state--error">
      <AppIcon name="help-center" :size="29" tone="danger" />
      <text>{{ error }}</text>
      <AppButton label="重新查询" icon="action-refresh" size="sm" @tap="load" />
    </view>

    <view v-else-if="loaded && items.length" class="results">
      <view class="section-bar">
        <text class="section-heading">查询结果</text>
        <text class="result-count">{{ auth.phoneMasked || "已绑定" }} · {{ items.length }} 条</text>
      </view>
      <view v-for="(item, index) in items" :key="index" class="result-card cu-card radius shadow">
        <view class="result-icon radius bg-green light"><AppIcon name="status-success" :size="27" /></view>
        <view class="result-copy">
          <text class="result-title">{{ item.title }}</text>
          <text class="result-status">{{ item.status }}</text>
          <view class="result-time">
            <AppIcon name="reminder" :size="22" tone="muted" />
            <text>{{ item.time }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="loaded" class="state-card result-state">
      <AppIcon name="health-record" :size="34" />
      <text class="empty-title">暂无提交记录</text>
      <text>提交加号或联络表后，进度将显示在这里。</text>
    </view>
  </view>
</template>

<style scoped>
.replies-page { padding: 16px; }
.query-intro { display: flex; gap: 12px; padding: 16px; background: var(--surface, #fff); color: var(--text-strong, #2a3547); }
.query-intro__icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 36px; height: 36px; }
.query-intro__eyebrow, .query-intro__title, .query-intro__copy { display: block; }
.query-intro__eyebrow { color: var(--text-secondary, #5a6a85); font-size: var(--font-caption, 14px); font-weight: 500; }
.query-intro__title { margin-top: 4px; font-size: var(--font-subheading, 19px); font-weight: 600; line-height: 1.35; }
.query-intro__copy { margin-top: 6px; color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.55; }
.result-state { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 12px; }
.result-state--error { color: var(--danger, #fa896b); }
.section-bar { display: flex; align-items: center; justify-content: space-between; margin: 20px 0 10px; }
.section-heading { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
.result-count { color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); }
.results { display: flex; flex-direction: column; gap: 10px; }
.result-card { display: flex; gap: 10px; padding: 14px; background: var(--surface, #fff); }
.result-icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32px; height: 32px; }
.result-copy { min-width: 0; flex: 1; }
.result-title, .result-status { display: block; }
.result-title { color: var(--text-strong, #2a3547); font-size: var(--font-secondary, 16px); font-weight: 600; }
.result-status { margin-top: 2px; color: var(--primary, #5d87ff); font-size: var(--font-secondary, 16px); font-weight: 500; }
.result-time { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--text-secondary, #5a6a85); font-size: var(--font-caption, 14px); }
.empty-title { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
</style>
