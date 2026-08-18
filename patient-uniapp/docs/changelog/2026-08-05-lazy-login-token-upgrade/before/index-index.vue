<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppActionTile from "../../components/AppActionTile.vue";
import AppButton from "../../components/AppButton.vue";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";
import AppSectionHeader from "../../components/AppSectionHeader.vue";
import AppServiceProductCard from "../../components/AppServiceProductCard.vue";
import { getMpToken } from "../../api/auth";
import { API_BASE } from "../../api/config";
import { getLocalProfile, type PatientProfile } from "../../api/patient";
import { V32_VISUAL_ASSETS } from "../../constants/v32Assets";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useHomeStore } from "../../stores/home";
import { ensureLogin, openArchiveProfile } from "../../utils/ensureLogin";
import { resolvePatientGreetingLabel } from "../../utils/displayName";
import { safeLocalImageSrc } from "../../utils/mediaSrc";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";
import type { QuickAction } from "../../types/v32";

const store = useAppStore();
const auth = useAuthStore();
const homeStore = useHomeStore();
const profile = ref<PatientProfile | null>(null);
const profileKey = computed(() =>
  scopedStorageKey(
    "patientProfile",
    buildStorageScope({
      doctorId: store.doctor?.id,
      patientId: auth.patientId,
      personId: auth.personId,
      token: getMpToken(),
    })
  )
);

const greetingLabel = computed(() =>
  resolvePatientGreetingLabel({
    phoneBound: auth.phoneBound,
    profileName: auth.profileName,
    localProfileName: profile.value?.name,
    phoneMasked: auth.phoneMasked,
  })
);
const showProfileBanner = computed(() => auth.phoneBound && !auth.hasProfile);

const feed = computed(() => homeStore.feed);
const apiBase = API_BASE;
const emptyStateVisual = computed(() => safeLocalImageSrc(V32_VISUAL_ASSETS.emptyNoPlan));

/** 图二 abnormal > 图一 task > 图三 empty */
const homeMode = computed<"abnormal" | "task" | "empty">(() => {
  if (!feed.value) return "empty";
  if (feed.value.alert) return "abnormal";
  if (feed.value.plan) return "task";
  return "empty";
});

const greetingTitle = computed(() => {
  const h = new Date().getHours();
  const hello = h < 11 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  return `${hello}，${greetingLabel.value}`;
});

const greetingSubtitle = computed(() => {
  if (feed.value?.subtitle) return feed.value.subtitle;
  if (homeMode.value === "abnormal") return "发现一项需要优先处理的健康情况";
  if (homeMode.value === "empty") return "建立第一份健康计划，从整理资料开始";
  return "今天最重要的健康事项已经整理好了";
});

const planProgressWidth = computed(() => {
  const p = feed.value?.plan?.completionPercent ?? 0;
  return `${Math.max(0, Math.min(100, p))}%`;
});

/** 自定义导航：内容从胶囊下方开始，避免与状态栏重叠 */
const headerPadTop = ref(64);
let initializePromise: Promise<void> | null = null;
let initialized = false;

function syncSafeHeader() {
  try {
    const sys = uni.getSystemInfoSync();
    const status = Number(sys.statusBarHeight || 20);
    const menu = typeof uni.getMenuButtonBoundingClientRect === "function"
      ? uni.getMenuButtonBoundingClientRect()
      : null;
    if (menu && menu.bottom > 0) {
      headerPadTop.value = Math.ceil(menu.bottom + 8);
      return;
    }
    headerPadTop.value = status + 44;
  } catch {
    headerPadTop.value = 64;
  }
}

async function refreshLocal() {
  profile.value = getLocalProfile(profileKey.value);
}

async function loadHome(force = false) {
  const ok = await ensureLogin("/pages/index/index");
  if (!ok) {
    homeStore.reset();
    homeStore.error = "请先登录并绑定手机号";
    return;
  }
  await homeStore.load(force);
}

function initializeHome(force = false): Promise<void> {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    syncSafeHeader();
    await store.load(force && !store.bootstrap);
    await loadHome(force);
    await refreshLocal();
    initialized = true;
  })().finally(() => {
    initializePromise = null;
  });
  return initializePromise;
}

onMounted(() => {
  void initializeHome();
});

onShow(() => {
  void initializeHome(initialized);
});

async function openArchiveUpload() {
  await go("/pages/records/index");
}

async function go(url: string, tab = false) {
  const ok = await ensureLogin(url);
  if (!ok) return;
  if (tab) {
    uni.switchTab({ url });
    return;
  }
  uni.navigateTo({ url });
}

function openToast(title: string) {
  uni.showToast({ title, icon: "none" });
}

function openQuick(action: QuickAction) {
  if (action.toast) {
    openToast(action.toast);
    return;
  }
  if (action.url) void go(action.url, action.tab);
}

function reload() {
  const err = store.error || homeStore.error || "";
  if (/登录|绑定/.test(err)) {
    void initializeHome(true);
    return;
  }
  void initializeHome(true);
}

function onNotify() {
  openToast("消息提醒即将开通");
}

function onNextTask() {
  const task = feed.value?.plan?.nextTask;
  if (task?.toast) openToast(task.toast);
  void go("/pages/plans/detail");
}
</script>

<template>
  <view class="page ambient-bg" :class="{ elder: store.elderMode }">
    <view
      v-if="(store.loading || homeStore.loading) && !feed"
      class="state-card"
      :style="{ paddingTop: `${headerPadTop}px` }"
      aria-label="正在加载"
    >正在加载…</view>
    <view
      v-else-if="store.error || homeStore.error"
      class="home-error"
      :style="{ paddingTop: `${headerPadTop}px` }"
    >
      <AppEmptyState
        :visual="emptyStateVisual"
        :title="store.error || homeStore.error || '首页加载失败'"
        text="未登录时请先绑定手机号；已登录仍失败再检查网络。不会展示本地假进度。"
        :action-label="(store.error || homeStore.error || '').includes('登录') ? '去登录' : '重新加载'"
        @action="reload"
      />
      <text class="api-debug">当前接口：{{ apiBase }}</text>
    </view>

    <scroll-view v-else-if="feed" scroll-y class="home-scroll">
      <view
        class="page-shell home-content"
        :style="{ paddingTop: `${headerPadTop}px` }"
      >
        <view class="greeting">
          <view class="greeting__copy">
            <text class="greeting__title">{{ greetingTitle }}</text>
            <text class="greeting__sub">{{ greetingSubtitle }}</text>
          </view>
          <view class="greeting__bell pressable" aria-role="button" @click="onNotify">
            <AppIcon name="clock" :size="20" color="#176B52" />
          </view>
        </view>

        <view v-if="showProfileBanner" class="profile-banner">
          <text class="profile-banner__text">建议完善健康档案，后续计划和咨询会更准确。</text>
          <AppButton label="去完善" variant="primary" size="sm" @tap="go('/pages/archive/profile')" />
        </view>

        <!-- 图二：高优异常 -->
        <view v-if="homeMode === 'abnormal' && feed.alert" class="alert-card">
          <view class="alert-card__label-row">
            <AppIcon name="help" :size="16" color="#FFFFFF" />
            <text class="alert-card__label">{{ feed.alert.label }}</text>
          </view>
          <text class="alert-card__title">{{ feed.alert.title }}</text>
          <text class="alert-card__desc">{{ feed.alert.desc }}</text>
          <view class="alert-card__actions">
            <text
              class="alert-card__btn alert-card__btn--primary pressable"
              aria-role="button"
              @click="go(feed.alert.primaryUrl, feed.alert.primaryUrl.includes('/consult/'))"
            >{{ feed.alert.primaryText }}</text>
            <text
              class="alert-card__btn alert-card__btn--ghost pressable"
              aria-role="button"
              @click="go(feed.alert.secondaryUrl)"
            >{{ feed.alert.secondaryText }}</text>
          </view>
        </view>

        <!-- 图一：轻提醒 -->
        <view
          v-else-if="homeMode === 'task' && feed.softNotice"
          class="soft-notice pressable"
          aria-role="button"
          @click="feed.softNotice.actionUrl && go(feed.softNotice.actionUrl)"
        >
          <AppIcon name="help" :size="16" color="#9A6418" />
          <text class="soft-notice__text">{{ feed.softNotice.text }}</text>
        </view>

        <!-- 图一 / 图二：深绿计划主卡 -->
        <view v-if="feed.plan" class="plan-hero">
          <view class="plan-hero__top">
            <text class="plan-hero__kicker">
              {{ homeMode === "abnormal" ? feed.plan.completionText : `健康计划 · ${feed.plan.completionText}` }}
            </text>
            <view class="plan-hero__tag">
              <AppIcon name="user" :size="12" color="#D8F0E4" />
              <text class="plan-hero__tag-text">{{ feed.plan.modeTag || "自主管理" }}</text>
            </view>
          </view>
          <text class="plan-hero__title">{{ feed.plan.title }}</text>
          <view class="plan-hero__task">
            <view class="plan-hero__task-icon">
              <AppIcon name="heart" :size="18" color="#176B52" />
            </view>
            <view class="plan-hero__task-copy">
              <text class="plan-hero__task-title">{{ feed.plan.nextTask.title }}</text>
              <text class="plan-hero__task-desc">{{ feed.plan.nextTask.desc }}</text>
            </view>
            <text class="plan-hero__task-btn pressable" aria-role="button" @click="onNextTask">
              {{ feed.plan.nextTask.actionText }}
            </text>
          </view>
          <view class="plan-hero__foot">
            <view class="plan-hero__progress">
              <text class="plan-hero__progress-label">{{ feed.plan.progressLabel || `本周完成率 ${feed.plan.completionPercent}%` }}</text>
              <view class="plan-hero__bar">
                <view class="plan-hero__bar-fill" :style="{ width: planProgressWidth }" />
              </view>
            </view>
            <text
              class="plan-hero__link pressable"
              aria-role="button"
              @click="go(feed.plan.actionUrl)"
            >{{ feed.plan.actionText }}</text>
          </view>
        </view>

        <!-- 图三 / HOME-001：无计划空态 -->
        <view v-else-if="homeMode === 'empty'" class="home-empty home-001">
          <view class="home-empty__icon">
            <AppIcon name="file" :size="22" color="#176B52" />
          </view>
          <text class="home-empty__title">还没有正在执行的健康计划</text>
          <text class="home-empty__desc">上传处方、检查报告或出院小结，确认识别信息后可以生成一份可执行的健康计划。</text>
          <view class="home-empty__actions">
            <AppButton label="上传档案" variant="primary" @tap="openArchiveUpload" />
            <AppButton label="手动创建" variant="soft" @tap="openArchiveProfile('/pages/index/index')" />
          </view>
        </view>

        <!-- 图一：待确认档案 -->
        <view v-if="homeMode === 'task' && feed.pendingRecord" class="home-block">
          <AppSectionHeader title="健康档案 · 1 份待确认" action="进入健康档案" @action="go(feed.pendingRecord.actionUrl)" />
          <view class="pending-record pressable" aria-role="button" @click="go(feed.pendingRecord.actionUrl)">
            <view class="pending-record__icon"><AppIcon name="file" :size="20" color="#B7791F" /></view>
            <view class="pending-record__copy">
              <text class="pending-record__title">{{ feed.pendingRecord.title }}</text>
              <text class="pending-record__desc">{{ feed.pendingRecord.desc }}</text>
            </view>
            <text class="pending-record__btn">{{ feed.pendingRecord.actionText || "继续确认" }}</text>
          </view>
        </view>

        <!-- 快捷操作 / 你还可以：task + empty；异常态不占主视线，仍保留底部入口可按需加 -->
        <view v-if="homeMode !== 'abnormal'" class="home-block">
          <AppSectionHeader :title="feed.quickActionsTitle || (homeMode === 'empty' ? '你还可以' : '快捷操作')" />
          <view class="quick-grid">
            <AppActionTile
              v-for="action in feed.quickActions"
              :key="action.key"
              :icon="action.icon"
              :title="action.label"
              compact
              @tap="openQuick(action)"
            />
          </view>
        </view>

        <!-- 进行中服务 / 共管服务 -->
        <view v-if="feed.serviceProgress && homeMode !== 'empty'" class="home-block">
          <AppSectionHeader
            :title="feed.serviceSectionTitle || '正在进行的服务'"
            :action="feed.serviceSectionAction || '查看全部'"
            @action="go(feed.serviceProgress.actionUrl)"
          />
          <view class="service-card pressable" aria-role="button" @click="go(feed.serviceProgress.actionUrl)">
            <view class="service-card__avatar">{{ feed.serviceProgress.providerShortName }}</view>
            <view class="service-card__copy">
              <text class="service-card__title">{{ feed.serviceProgress.title }}</text>
              <text class="service-card__desc">{{ feed.serviceProgress.desc }}</text>
              <text class="service-card__meta">{{ feed.serviceProgress.meta }}</text>
            </view>
            <view v-if="feed.serviceProgress.unreadCount" class="service-card__badge">
              {{ feed.serviceProgress.unreadCount > 99 ? "99+" : feed.serviceProgress.unreadCount }}
            </view>
          </view>
        </view>

        <!-- 异常说明条 -->
        <view v-if="homeMode === 'abnormal' && feed.notice" class="home-notice">
          <AppIcon name="help" :size="16" color="#9A6418" />
          <text class="home-notice__text">{{ feed.notice }}</text>
        </view>

        <!-- 推荐：异常态不展示 -->
        <view v-if="homeMode !== 'abnormal' && feed.recommendations?.length" class="recommend-section">
          <AppSectionHeader
            :title="feed.recommendationsTitle || (homeMode === 'empty' ? '常用健康服务' : '根据当前计划推荐')"
            action="全部服务"
            @action="go('/pages/services/index')"
          />
          <view class="recommend-row">
            <view
              v-for="item in feed.recommendations"
              :key="item.key"
              class="recommend-row__cell"
            >
              <AppServiceProductCard
                layout="tile"
                :icon="item.icon"
                :tone="item.tone"
                :reason="item.reason"
                :title="item.title"
                :desc="item.desc"
                @tap="go(item.actionUrl)"
              />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f3;
}
.home-scroll {
  height: 100vh;
}
.home-content {
  box-sizing: border-box;
  padding: 12px 16px calc(28px + env(safe-area-inset-bottom));
  background: #f3f6f3;
}
.greeting {
  display: flex;
  margin-bottom: 14px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.greeting__copy {
  min-width: 0;
  flex: 1;
}
.greeting__title,
.greeting__sub {
  display: block;
}
.greeting__title {
  color: #14352a;
  font-size: 24px;
  font-weight: 900;
  line-height: 1.3;
}
.greeting__sub {
  margin-top: 6px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.45;
}
.greeting__bell {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid #e4ebe6;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(16, 52, 40, 0.05);
}
.profile-banner {
  display: flex;
  margin-bottom: 12px;
  padding: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #cfe8dd;
  border-radius: 12px;
  background: #eaf6f0;
}
.profile-banner__text {
  flex: 1;
  color: #24463a;
  font-size: 13px;
  line-height: 1.5;
}
.soft-notice {
  display: flex;
  margin-bottom: 12px;
  padding: 12px 14px;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid #edd9a8;
  border-radius: 14px;
  background: #fff8e8;
}
.soft-notice__text {
  flex: 1;
  color: #8a5a12;
  font-size: 13px;
  line-height: 1.5;
  font-weight: 600;
}
.alert-card {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 18px;
  background: #8b3131;
  color: #fff;
  box-shadow: 0 10px 28px rgba(139, 49, 49, 0.22);
}
.alert-card__label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.alert-card__label {
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  font-weight: 700;
}
.alert-card__title,
.alert-card__desc {
  display: block;
}
.alert-card__title {
  margin-top: 10px;
  font-size: 20px;
  font-weight: 900;
  line-height: 1.35;
}
.alert-card__desc {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  line-height: 1.55;
}
.alert-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.alert-card__btn {
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}
.alert-card__btn--primary {
  background: #ffffff;
  color: #8b3131;
}
.alert-card__btn--ghost {
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}
.plan-hero {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 18px;
  background: #0f4031;
  box-shadow: 0 12px 28px rgba(15, 64, 49, 0.22);
}
.plan-hero__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.plan-hero__kicker {
  min-width: 0;
  flex: 1;
  color: #b7d8c8;
  font-size: 12px;
  font-weight: 700;
}
.plan-hero__tag {
  display: flex;
  flex-shrink: 0;
  padding: 4px 8px;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(216, 240, 228, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.plan-hero__tag-text {
  color: #d8f0e4;
  font-size: 11px;
  font-weight: 700;
}
.plan-hero__title {
  display: block;
  margin-top: 10px;
  color: #ffffff;
  font-size: 22px;
  font-weight: 900;
  line-height: 1.3;
}
.plan-hero__task {
  display: flex;
  margin-top: 14px;
  padding: 12px;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.1);
}
.plan-hero__task-icon {
  display: flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #ffffff;
}
.plan-hero__task-copy {
  min-width: 0;
  flex: 1;
}
.plan-hero__task-title,
.plan-hero__task-desc {
  display: block;
}
.plan-hero__task-title {
  color: #ffffff;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
}
.plan-hero__task-desc {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  line-height: 1.4;
}
.plan-hero__task-btn {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: #ffffff;
  color: #0f4031;
  font-size: 12px;
  font-weight: 800;
}
.plan-hero__foot {
  display: flex;
  margin-top: 14px;
  align-items: center;
  gap: 10px;
}
.plan-hero__progress {
  min-width: 0;
  flex: 1;
}
.plan-hero__progress-label {
  display: block;
  color: #c5e0d3;
  font-size: 12px;
  font-weight: 700;
}
.plan-hero__bar {
  margin-top: 6px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.22);
}
.plan-hero__bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #e8b65b;
}
.plan-hero__link {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  background: #ffffff;
  color: #0f4031;
  font-size: 12px;
  font-weight: 800;
}
.home-empty {
  margin-bottom: 16px;
  padding: 18px 16px;
  border: 1px solid #e4ebe6;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(16, 52, 40, 0.05);
}
.home-empty__icon {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #e5f3ec;
}
.home-empty__title,
.home-empty__desc {
  display: block;
}
.home-empty__title {
  margin-top: 12px;
  color: #17201c;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.35;
}
.home-empty__desc {
  margin-top: 8px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.55;
}
.home-empty__actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.home-block {
  margin-bottom: 16px;
}
.pending-record {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e8d9b8;
  border-radius: 14px;
  background: #fffbf3;
}
.pending-record__icon {
  display: flex;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #f5ebd4;
}
.pending-record__copy {
  min-width: 0;
  flex: 1;
}
.pending-record__title,
.pending-record__desc {
  display: block;
}
.pending-record__title {
  color: #17201c;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
}
.pending-record__desc {
  margin-top: 4px;
  color: #6a756f;
  font-size: 12px;
  line-height: 1.45;
}
.pending-record__btn {
  flex-shrink: 0;
  padding: 7px 10px;
  border-radius: 999px;
  background: #f6e7c8;
  color: #9a6418;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.service-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid #e4ebe6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(16, 52, 40, 0.04);
}
.service-card__avatar {
  display: flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #e5f3ec;
  color: #176b52;
  font-size: 16px;
  font-weight: 800;
}
.service-card__copy {
  min-width: 0;
  flex: 1;
}
.service-card__title,
.service-card__desc,
.service-card__meta {
  display: block;
}
.service-card__title {
  color: #17201c;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
}
.service-card__desc {
  margin-top: 4px;
  color: #6a756f;
  font-size: 12px;
  line-height: 1.45;
}
.service-card__meta {
  margin-top: 3px;
  color: #8a938d;
  font-size: 11px;
  line-height: 1.4;
}
.service-card__badge {
  display: flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #d6453d;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}
.home-notice {
  display: flex;
  margin-bottom: 16px;
  padding: 12px 14px;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid #edd9a8;
  border-radius: 14px;
  background: #fff8e8;
}
.home-notice__text {
  flex: 1;
  color: #8a5a12;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
}
.recommend-section {
  margin: 4px 0 14px;
}
.recommend-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.recommend-row__cell {
  width: 0;
  flex: 1 1 0;
  min-width: 0;
}
.recommend-row__cell :deep(.app-service-product) {
  width: 100%;
  height: 168px;
  box-sizing: border-box;
}
.home-error {
  padding: 14px;
}
.api-debug {
  display: block;
  margin-top: 10px;
  text-align: center;
  color: #6a756f;
  font-size: 11px;
  word-break: break-all;
}
.elder .greeting__title {
  font-size: 26px;
}
.elder .plan-hero__title,
.elder .alert-card__title {
  font-size: 24px;
}
.elder .pending-record__title,
.elder .service-card__title {
  font-size: 16px;
}
</style>
