<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { HealthCategory, HealthRecord } from "@chunyu/patient-design/types";
import { getMyHealthCategories, getMyHealthRecords } from "../../api/patient";
import { V32_VISUAL_ASSETS } from "../../constants/v32Assets";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import AppBackNav from "../../components/AppBackNav.vue";
import AppButton from "../../components/AppButton.vue";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";

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

onMounted(loadRecords);
onShow(() => {
  if (!auth.phoneBound) {
    void ensureLogin("/pages/archive/health");
  } else {
    void loadRecords();
  }
});

const filtered = computed(() => {
  if (!active.value) return records.value;
  return records.value.filter((record) => record.category === active.value);
});

const activeMeta = computed(() => cats.value.find((category) => category.key === active.value) || null);

function pick(key: string) {
  active.value = active.value === key ? null : key;
}

function showAll() {
  active.value = null;
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom health-page" :class="{ elder: store.elderMode }">
    <AppBackNav fallback-tab="/pages/mine/index" />
    <view v-if="loading" class="state-card page-state">正在整理健康记录…</view>
    <view v-else-if="error" class="state-card page-state">
      <AppIcon name="help" :size="24" color="#D92D20" />
      <text>{{ error }}</text>
      <AppButton label="重新加载" size="sm" @tap="loadRecords" />
    </view>

    <template v-else>
      <view class="intro-card cu-card radius shadow">
        <view class="intro-icon radius bg-blue light"><AppIcon name="health" :size="28" /></view>
        <view class="intro-copy">
          <text class="intro-eyebrow">个人健康资料</text>
          <text class="intro-title">按类型快速查找记录</text>
          <text class="intro-sub">已收录 {{ records.length }} 份记录，资料仅用于为您提供服务</text>
        </view>
      </view>

      <view class="section-bar">
        <text class="section-heading">记录分类</text>
        <AppButton v-if="active" label="查看全部" variant="ghost" size="sm" @tap="showAll" />
      </view>

      <view class="category-grid">
        <view
          v-for="category in cats"
          :key="category.key"
          class="category-card cu-card radius shadow pressable"
          :class="{ 'category-card--active': active === category.key }"
          aria-role="button"
          :aria-label="`${category.label}，${category.count || 0} 份记录`"
          @click="pick(category.key)"
        >
          <view class="category-top">
            <view class="category-icon radius bg-blue light"><AppIcon name="file" :size="22" /></view>
            <text class="category-count">{{ category.count || 0 }}</text>
          </view>
          <text class="category-label">{{ category.label }}</text>
          <text class="category-hint">{{ category.hint }}</text>
          <view class="category-accent" :style="{ background: category.color }" />
        </view>
      </view>

      <view class="section-bar records-heading">
        <text class="section-heading">{{ activeMeta ? activeMeta.label : "全部记录" }}</text>
        <text class="section-count">{{ filtered.length }} 份</text>
      </view>

      <view v-if="filtered.length" class="record-list">
        <view v-for="record in filtered" :key="record.id" class="record-card cu-card radius shadow">
          <view class="record-date">
            <AppIcon name="calendar" :size="18" color="#52627A" />
            <text>{{ record.recordedAt }}</text>
          </view>
          <text class="record-title">{{ record.title }}</text>
          <text class="record-summary">{{ record.summary }}</text>
          <view class="record-meta">
            <text>{{ record.categoryLabel }}</text>
            <AppIcon name="chevron" :size="18" color="#637188" />
          </view>
        </view>
      </view>

      <AppEmptyState
        v-else
        :visual="V32_VISUAL_ASSETS.healthRecordEmpty"
        title="该分类暂无记录"
        text="您可以查看其他分类，后续检查资料会持续归档在这里。"
        action-label="返回全部记录"
        @action="showAll"
      />
    </template>
  </view>
</template>

<style scoped>
.health-page { padding: 16px; }
.page-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 32px; }
.intro-card { display: flex; gap: 12px; padding: 16px; background: var(--surface, #fff); color: var(--text-strong, #2a3547); }
.intro-icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 36px; height: 36px; }
.intro-copy { min-width: 0; }
.intro-eyebrow, .intro-title, .intro-sub { display: block; }
.intro-eyebrow { color: var(--text-secondary, #5a6a85); font-size: 12px; font-weight: 500; }
.intro-title { margin-top: 4px; font-size: 16px; font-weight: 600; line-height: 1.35; color: var(--text-strong, #2a3547); }
.intro-sub { margin-top: 6px; color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.section-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 20px 0 10px; }
.category-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.category-card { position: relative; width: calc(50% - 5px); min-height: 108px; overflow: hidden; padding: 12px; background: var(--surface, #fff); }
.category-card--active { border-color: var(--primary, #5d87ff); background: var(--primary-soft, #ecf2ff); }
.category-top { display: flex; align-items: center; justify-content: space-between; }
.category-icon { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; }
.category-count { color: var(--primary, #5d87ff); font-size: 16px; font-weight: 600; }
.category-label, .category-hint { display: block; }
.category-label { margin-top: 10px; color: var(--text-strong, #2a3547); font-size: 14px; font-weight: 600; line-height: 1.4; }
.category-hint { margin-top: 2px; color: var(--text-secondary, #5a6a85); font-size: 12px; line-height: 1.45; }
.category-accent { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; opacity: .85; }
.records-heading { margin-top: 24px; }
.section-count { color: var(--text-secondary, #5a6a85); font-size: 13px; }
.record-list { display: flex; flex-direction: column; gap: 10px; }
.record-card { padding: 14px; background: var(--surface, #fff); }
.record-date, .record-meta { display: flex; align-items: center; gap: 8px; color: var(--text-secondary, #5a6a85); font-size: 12px; }
.record-title, .record-summary { display: block; }
.record-title { margin-top: 8px; color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; line-height: 1.4; }
.record-summary { margin-top: 4px; color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.record-meta { justify-content: space-between; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line-soft, #eef2f6); }
</style>
