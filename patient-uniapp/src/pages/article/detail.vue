<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { useAppStore } from "../../stores/app";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";

type Section = { heading: string; paragraph: string };

const store = useAppStore();
const pageKey = ref("clinic");
const sections = ref<Section[]>([]);
const titleText = ref("");
const sourceText = ref("");
const tipText = ref("");

onLoad((query) => {
  pageKey.value = (query?.key as string) || "clinic";
});

async function ensureData() {
  await store.load(true);
  applyArticle();
}

function pickArticle() {
  const content = store.content;
  if (pageKey.value === "diet") return content?.dietArticle as any;
  if (pageKey.value === "surgery") return content?.surgeryArticle as any;
  return content?.clinicArticle as any;
}

/** 兼容：真数组 / JSON 字符串 / 类数组对象；字段兼容 h|heading、p|paragraph|text */
function normalizeSections(body: unknown): Section[] {
  let data: unknown = body;
  if (typeof data === "string") {
    const raw = data.trim();
    if (!raw) return [];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        data = JSON.parse(raw);
      } catch {
        return [{ heading: "", paragraph: raw }];
      }
    } else {
      return [{ heading: "", paragraph: raw }];
    }
  }
  if (data == null) return [];

  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length) list = keys.map((k) => obj[k]);
  }

  const out: Section[] = [];
  for (const item of list) {
    if (item == null) continue;
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ heading: "", paragraph: t });
      continue;
    }
    if (typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const heading = String(row.heading ?? row.h ?? row.title ?? "").trim();
    const paragraph = String(row.paragraph ?? row.p ?? row.text ?? row.content ?? "").trim();
    if (!heading && !paragraph) continue;
    // 若整段被误塞进 heading 且像 JSON，再拆一次
    if (!paragraph && heading.startsWith("[")) {
      const nested = normalizeSections(heading);
      if (nested.length) {
        out.push(...nested);
        continue;
      }
    }
    out.push({ heading, paragraph });
  }
  return out;
}

function applyArticle() {
  const article = pickArticle();
  if (!article) {
    titleText.value = "";
    sourceText.value = "";
    tipText.value = "";
    sections.value = [];
    return;
  }
  titleText.value = typeof article.title === "string" ? article.title : "";
  sourceText.value = typeof article.source === "string" ? article.source : "";
  tipText.value = typeof article.tip === "string" ? article.tip : "";
  sections.value = normalizeSections(article.body);
}

onMounted(() => {
  void ensureData();
});
onShow(() => {
  if (store.bootstrap) applyArticle();
});
watch(
  () => store.content,
  () => applyArticle()
);

const reviewLabel = computed(() => "春雨医患通内容审核");

const hasSections = computed(() => sections.value.length > 0);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom article-page" :class="{ elder: store.elderMode }">
    <view v-if="store.loading && !titleText" class="article-skeleton" aria-label="健康指引加载中">
      <view class="skeleton skeleton-cover" />
      <view class="skeleton skeleton-line skeleton-line--wide" />
      <view class="skeleton skeleton-line" />
    </view>
    <view v-else-if="store.error" class="state-card article-state">
      <text>{{ store.error }}</text>
      <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="ensureData" />
    </view>

    <view v-else-if="titleText || hasSections" class="article-card cu-card radius shadow">
      <view class="article-content">
        <view class="review-badge cu-tag round bg-blue light">
          <AppIcon name="privacy" :size="24" />
          <text>{{ reviewLabel }}</text>
        </view>
        <text class="article-title">{{ titleText }}</text>
        <view class="article-meta">
          <text>健康指引</text>
          <text v-if="sourceText">· {{ sourceText }}</text>
        </view>

        <view v-if="hasSections" class="article-sections">
          <view v-for="(sec, idx) in sections" :key="idx" class="article-section">
            <text v-if="sec.heading" class="article-section__h">{{ sec.heading }}</text>
            <text v-if="sec.paragraph" class="article-section__p">{{ sec.paragraph }}</text>
          </view>
        </view>
        <text v-else class="article-body">暂无正文</text>

        <view v-if="tipText" class="article-tip radius bg-blue light">
          <text class="article-tip__label">提示</text>
          <text class="article-tip__text">{{ tipText }}</text>
        </view>
      </view>
    </view>
    <view v-else class="state-card article-state">
      <AppIcon name="health-record" :size="34" />
      <text class="unavailable-title">暂无健康指引</text>
      <text>当前内容暂不可用，请稍后再试。</text>
    </view>

    <view v-if="titleText || hasSections" class="safety-card radius bg-green light">
      <view class="safety-icon radius bg-white"><AppIcon name="help-center" :size="27" /></view>
      <view>
        <text class="safety-title">医疗安全提示</text>
        <text class="safety-copy">内容用于日常健康管理，不能替代面诊与处方。如有明显不适，请及时就医。</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.article-page { padding: 16px; }
.article-card { overflow: hidden; background: var(--surface, #fff); }
.article-content { padding: 16px; }
.review-badge { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; color: var(--primary, #5d87ff); font-size: var(--font-caption, 14px); font-weight: 600; }
.article-title, .article-body, .safety-title, .safety-copy, .article-section__h, .article-section__p, .article-tip__label, .article-tip__text { display: block; }
.article-title { margin-top: 12px; color: var(--text-strong, #2a3547); font-size: var(--font-heading, 24px); font-weight: 600; line-height: 1.35; }
.article-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; color: var(--text-secondary, #5a6a85); font-size: var(--font-caption, 14px); }
.article-sections { margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }
.article-section__h { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; line-height: 1.4; }
.article-section__p { margin-top: 6px; color: var(--text-strong, #2a3547); font-size: var(--font-secondary, 16px); line-height: 1.7; white-space: pre-wrap; }
.article-body { margin-top: 16px; color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.7; }
.article-tip { margin-top: 16px; padding: 12px; }
.article-tip__label { color: var(--primary, #5d87ff); font-size: var(--font-caption, 14px); font-weight: 600; }
.article-tip__text { margin-top: 4px; color: var(--text-strong, #2a3547); font-size: var(--font-secondary, 16px); line-height: 1.55; }
.safety-card { display: flex; gap: 10px; margin-top: 14px; padding: 12px; }
.safety-icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32px; height: 32px; }
.safety-title { color: var(--text-strong, #2a3547); font-size: var(--font-secondary, 16px); font-weight: 600; }
.safety-copy { margin-top: 2px; color: var(--text-secondary, #5a6a85); font-size: var(--font-caption, 14px); line-height: 1.55; }
.article-state { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 32px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
.article-skeleton { padding: 16px; border: 1px solid var(--line, #e5eaf2); border-radius: var(--r-lg, 12px); background: #fff; }
.skeleton { border-radius: var(--r-md, 8px); background: #e8edf5; animation: pulse 1.4s ease-in-out infinite; }
.skeleton-cover { height: 120px; }
.skeleton-line { height: 16px; margin-top: 10px; }
.skeleton-line--wide { width: 76%; margin-top: 16px; }
@keyframes pulse { 50% { opacity: .5; } }
</style>
