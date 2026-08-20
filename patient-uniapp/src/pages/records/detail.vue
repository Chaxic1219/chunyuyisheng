<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { getMyHealthRecord, type HealthRecordDetail } from "../../api/patient";
import { useAppStore } from "../../stores/app";

const store = useAppStore();
const recordRef = ref("");
const record = ref<HealthRecordDetail | null>(null);
const loading = ref(true);
const error = ref("");

const statusLabel = computed(() => {
  const status = String(record.value?.extra?.status || "");
  if (status === "pending") return "待确认";
  if (status === "confirmed") return "已确认";
  return "已归档";
});

const attachmentUrls = computed(() => {
  const list = record.value?.attachments || [];
  return list
    .map((item) => String(item.dataUrl || item.url || "").trim())
    .filter(Boolean);
});

onLoad(async (query) => {
  recordRef.value = String(query?.id || "").trim();
  await loadDetail();
});

function goBack() {
  uni.navigateBack();
}

async function loadDetail() {
  if (!recordRef.value) {
    error.value = "记录不存在";
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    record.value = await getMyHealthRecord(recordRef.value);
    if (!record.value) error.value = "未找到该健康记录";
  } catch {
    error.value = "加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function previewImage(current: string) {
  const urls = attachmentUrls.value;
  if (!urls.length) return;
  uni.previewImage({ current, urls });
}

function openArchive() {
  uni.navigateTo({ url: "/pages/records/index" });
}
</script>

<template>
  <view class="page" :class="{ elder: store.elderMode }">
    <view v-if="loading" class="state-card">正在加载记录详情…</view>
    <view v-else-if="error" class="state-card">
      <AppIcon name="status-error" :size="29" tone="danger" />
      <text>{{ error }}</text>
      <AppButton label="返回" icon="nav-chevron-right" size="sm" variant="soft" @tap="goBack" />
    </view>

    <template v-else-if="record">
      <view class="hero-card">
        <text class="hero-card__eyebrow">{{ record.categoryLabel }}</text>
        <text class="hero-card__title">{{ record.title }}</text>
        <text class="hero-card__meta">{{ record.recordedAt || "日期待补充" }} · {{ statusLabel }}</text>
      </view>

      <view class="section">
        <text class="section__label">记录摘要</text>
        <text class="section__body">{{ record.summary || "暂无摘要" }}</text>
      </view>

      <view v-if="record.sourceDoctorName" class="section">
        <text class="section__label">来源</text>
        <text class="section__body">{{ record.sourceDoctorName }}</text>
      </view>

      <view v-if="attachmentUrls.length" class="section">
        <text class="section__label">附件</text>
        <view class="attachment-grid">
          <image
            v-for="(url, idx) in attachmentUrls"
            :key="`${url}-${idx}`"
            class="attachment-grid__img"
            :src="url"
            mode="aspectFill"
            @tap="previewImage(url)"
          />
        </view>
      </view>

      <view class="footer-actions">
        <AppButton label="查看健康档案" icon="health-record" variant="soft" @tap="openArchive" />
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px 14px calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 48px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}
.hero-card,
.section {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
}
.hero-card__eyebrow,
.hero-card__title,
.hero-card__meta,
.section__label,
.section__body {
  display: block;
}
.hero-card__eyebrow {
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.hero-card__title {
  margin-top: 8px;
  color: #17201c;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
  line-height: 1.35;
}
.hero-card__meta {
  margin-top: 8px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.section__label {
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.section__body {
  margin-top: 8px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
  white-space: pre-wrap;
}
.attachment-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.attachment-grid__img {
  width: 96px;
  height: 96px;
  border-radius: 8px;
  background: #edf1ee;
}
.footer-actions {
  margin-top: 8px;
}
</style>
