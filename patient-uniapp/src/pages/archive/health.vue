<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { HealthCategory, HealthRecord } from "@chunyu/patient-design/types";
import { getMyHealthCategories, getMyHealthRecords } from "../../api/patient";
import { getMpToken } from "../../api/auth";
import {
  HEALTH_RECORD_EMPTY,
  HEALTH_RECORD_HERO,
  healthRecordCategoryBg,
  healthRecordCategoryIcon,
} from "../../constants/healthRecordCategories";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
const auth = useAuthStore();
const cats = ref<HealthCategory[]>([]);
const records = ref<HealthRecord[]>([]);
const active = ref<string | null>(null);
const loading = ref(true);
const error = ref("");

async function loadRecords() {
  loading.value = true;
  error.value = "";
  try {
    const [categoryRows, recordRows] = await Promise.all([
      getMyHealthCategories(),
      getMyHealthRecords(),
    ]);
    cats.value = categoryRows;
    records.value = recordRows;
  } catch (err) {
    error.value = "健康记录加载失败，请稍后重试";
    console.error(err);
  } finally {
    loading.value = false;
  }
}

onShow(async () => {
  if (getMpToken() && !auth.phoneBound) {
    try {
      await auth.refreshMe();
    } catch {
      /* token 失效 → 按未登录处理 */
    }
  }
  if (auth.phoneBound && getMpToken()) {
    void loadRecords();
  } else {
    cats.value = [];
    records.value = [];
    loading.value = false;
  }
});

const filtered = computed(() => {
  if (!active.value) return records.value;
  return records.value.filter((record) => record.category === active.value);
});

const activeMeta = computed(() => cats.value.find((category) => category.key === active.value) || null);
const recordsHeading = computed(() => (activeMeta.value ? activeMeta.value.label : "全部记录"));

function pick(key: string) {
  active.value = active.value === key ? null : key;
}

function showAll() {
  active.value = null;
}

function openRecord(record: HealthRecord) {
  if (!record?.id) return;
  uni.navigateTo({ url: `/pages/records/detail?id=${encodeURIComponent(String(record.id))}` });
}

async function addRecord() {
  const ok = await ensureLogin("/pages/archive/health");
  if (!ok) return;
  uni.navigateTo({ url: "/pages/records/add" });
}

function openArchiveHub() {
  uni.navigateTo({ url: "/pages/records/index" });
}
</script>

<template>
  <view class="health-page" :class="{ elder: store.elderMode }">
    <view v-if="loading" class="page-state">正在整理健康记录…</view>
    <view v-else-if="error" class="page-state">
      <AppIcon name="status-error" :size="29" tone="danger" />
      <text>{{ error }}</text>
      <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="loadRecords" />
    </view>

    <template v-else>
      <view class="intro-card">
        <view class="intro-card__copy">
          <view class="intro-card__eyebrow">
            <AppIcon name="health-log" :size="18" />
            <text>个人健康资料</text>
          </view>
          <text class="intro-card__title">快速查看健康记录</text>
          <text class="intro-card__sub">
            已收录 <text class="intro-card__count">{{ records.length }}</text> 份记录，资料仅用于为您提供服务
          </text>
        </view>
        <image class="intro-card__hero" :src="HEALTH_RECORD_HERO" mode="aspectFit" />
      </view>

      <view class="section-head">
        <view class="section-head__bar" />
        <text class="section-head__title">记录分类</text>
        <text v-if="active" class="section-head__action pressable" @tap="showAll">查看全部</text>
      </view>

      <view class="category-grid">
        <view
          v-for="category in cats"
          :key="category.key"
          class="category-card pressable"
          :class="{ 'category-card--active': active === category.key }"
          @tap="pick(category.key)"
        >
          <view
            class="category-card__icon"
            :style="{ background: healthRecordCategoryBg(category.key) }"
          >
            <image
              class="category-card__icon-img"
              :src="healthRecordCategoryIcon(category.key)"
              mode="aspectFit"
            />
          </view>
          <view class="category-card__copy">
            <text class="category-card__label">{{ category.label }}</text>
            <text class="category-card__hint">{{ category.hint }}</text>
          </view>
          <view class="category-card__badge">{{ category.count || 0 }}</view>
        </view>
      </view>

      <view class="section-head section-head--records">
        <view class="section-head__bar" />
        <text class="section-head__title">{{ recordsHeading }}</text>
        <text class="section-head__meta">{{ filtered.length }} 份</text>
      </view>

      <view v-if="filtered.length" class="record-list">
        <view
          v-for="record in filtered"
          :key="record.id"
          class="record-card pressable"
          @tap="openRecord(record)"
        >
          <view class="record-card__head">
            <AppIcon name="follow-up" :size="18" tone="muted" />
            <text class="record-card__date">{{ record.recordedAt }}</text>
          </view>
          <text class="record-card__title">{{ record.title }}</text>
          <text v-if="record.summary" class="record-card__summary">{{ record.summary }}</text>
          <view class="record-card__foot">
            <text>{{ record.categoryLabel }}</text>
            <AppIcon name="nav-chevron-right" :size="16" tone="muted" />
          </view>
        </view>
      </view>

      <view v-else class="empty-card">
        <image class="empty-card__visual" :src="HEALTH_RECORD_EMPTY" mode="aspectFit" />
        <view class="empty-card__copy">
          <text class="empty-card__title">该分类暂无记录</text>
          <text class="empty-card__text">您可以查看其他分类，或补充新的健康记录。</text>
          <view v-if="active" class="empty-card__btn pressable" @tap="showAll">
            <text>返回全部记录</text>
            <AppIcon name="nav-chevron-right" :size="16" />
          </view>
        </view>
      </view>
    </template>

    <view class="footer-bar">
      <view class="footer-bar__primary pressable" @tap="addRecord">
        <text class="footer-bar__plus">+</text>
        <text>补充健康记录</text>
      </view>
      <view class="footer-bar__secondary pressable" @tap="openArchiveHub">
        <AppIcon name="health-record" :size="18" />
        <text>查看我的健康档案</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.health-page {
  min-height: 100vh;
  padding: 16px 16px calc(96px + env(safe-area-inset-bottom));
  background: #f0f3f5;
  box-sizing: border-box;
}

.page-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 48px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}

.intro-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.06);
}

.intro-card__copy {
  min-width: 0;
  flex: 1;
}

.intro-card__eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}

.intro-card__title {
  display: block;
  margin-top: 8px;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
  line-height: 1.35;
}

.intro-card__sub {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}

.intro-card__count {
  color: #2f6b4f;
  font-weight: 800;
}

.intro-card__hero {
  width: 88px;
  height: 88px;
  flex: 0 0 auto;
  background: transparent;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 12px;
}

.section-head--records {
  margin-top: 24px;
}

.section-head__bar {
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: #2f6b4f;
}

.section-head__title {
  flex: 1;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.section-head__action,
.section-head__meta {
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}

.section-head__meta {
  color: #6a756f;
  font-weight: 500;
}

.category-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.category-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(50% - 5px);
  padding: 12px;
  border: 1px solid #e8eeea;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(16, 52, 40, 0.04);
  box-sizing: border-box;
}

.category-card--active {
  border-color: #2f6b4f;
  background: #f4fbf7;
}

.category-card__icon {
  display: flex;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}

.category-card__icon-img {
  width: 34px;
  height: 34px;
  background: transparent;
}

.category-card__copy {
  min-width: 0;
  flex: 1;
}

.category-card__label,
.category-card__hint {
  display: block;
}

.category-card__label {
  color: #17201c;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
  line-height: 1.35;
}

.category-card__hint {
  margin-top: 2px;
  color: #6a756f;
  font-size: 11px;
  line-height: 1.4;
}

.category-card__badge {
  display: flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #eef2f0;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-card {
  padding: 14px;
  border: 1px solid #e8eeea;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(16, 52, 40, 0.04);
}

.record-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}

.record-card__title,
.record-card__summary {
  display: block;
}

.record-card__title {
  margin-top: 8px;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: 1.4;
}

.record-card__summary {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}

.record-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #edf1ee;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}

.empty-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid #e8eeea;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(16, 52, 40, 0.04);
}

.empty-card__visual {
  width: 72px;
  height: 72px;
  flex: 0 0 auto;
}

.empty-card__copy {
  min-width: 0;
  flex: 1;
}

.empty-card__title,
.empty-card__text {
  display: block;
}

.empty-card__title {
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.empty-card__text {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}

.empty-card__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 6px 14px;
  border: 1px solid #2f6b4f;
  border-radius: 999px;
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}

.footer-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(240, 243, 245, 0) 0%, #f0f3f5 24%);
}

.footer-bar__primary,
.footer-bar__secondary {
  display: flex;
  min-height: 48px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 14px;
  font-size: var(--font-caption, 14px);
  font-weight: 800;
}

.footer-bar__primary {
  background: #0c4535;
  color: #fff;
  box-shadow: 0 8px 20px rgba(12, 69, 53, 0.24);
}

.footer-bar__plus {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.footer-bar__secondary {
  background: #e5f3ec;
  color: #0c4535;
}

.health-page.elder .category-card__hint {
  font-size: var(--font-caption, 14px);
}

.health-page.elder .intro-card__title {
  font-size: var(--font-heading, 24px);
}
</style>
