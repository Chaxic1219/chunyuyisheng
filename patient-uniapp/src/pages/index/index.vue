<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShareAppMessage, onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { getMpToken } from "../../api/auth";
import { getLocalProfile, type PatientProfile } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useConsultationStore } from "../../stores/consultation";
import { useHomeStore } from "../../stores/home";
import { ensureLogin } from "../../utils/ensureLogin";
import { resolvePatientGreetingLabel } from "../../utils/displayName";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";
import { syncCustomTabBar } from "../../utils/syncTabBar";
import { safeLocalImageSrc } from "../../utils/mediaSrc";

const app = useAppStore();
const auth = useAuthStore();
const home = useHomeStore();
const consultation = useConsultationStore();
const profile = ref<PatientProfile | null>(null);
const headerPadTop = ref(72);
let initializePromise: Promise<void> | null = null;

const profileKey = computed(() =>
  scopedStorageKey(
    "patientProfile",
    buildStorageScope({
      doctorId: app.doctor?.id,
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

const greetingTitle = computed(() => {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "上午好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  return `${greeting}，${greetingLabel.value}`;
});

const taskTitle = computed(() =>
  home.feed?.pendingRecord?.title || home.feed?.plan?.nextTask?.title || "完善健康档案"
);

const taskDescription = computed(() =>
  home.feed?.pendingRecord?.desc || home.feed?.plan?.nextTask?.desc || "上传检查报告，生成专属健康计划"
);

const taskAction = computed(() =>
  home.feed?.pendingRecord?.actionText || home.feed?.plan?.nextTask?.actionText || "继续完善"
);

const taskUrl = computed(() =>
  home.feed?.pendingRecord?.actionUrl || home.feed?.plan?.actionUrl || "/pages/records/index"
);

const healthEntries = [
  { key: "archive", icon: "home-health-record", label: "健康档案", url: "/pages/records/index" },
  { key: "service", icon: "service-package", label: "健康服务", url: "/pages/services/index" },
  { key: "log", icon: "health-log", label: "健康记录", url: "/pages/archive/health" },
] as const;

function syncSafeHeader() {
  try {
    const system = uni.getSystemInfoSync();
    const statusBar = Number(system.statusBarHeight || 20);
    const menu = typeof uni.getMenuButtonBoundingClientRect === "function"
      ? uni.getMenuButtonBoundingClientRect()
      : null;
    headerPadTop.value = menu?.bottom ? Math.ceil(menu.bottom + 18) : statusBar + 52;
  } catch {
    headerPadTop.value = 72;
  }
}

async function initialize(force = false) {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    syncSafeHeader();
    await app.load(force && !app.bootstrap).catch(() => undefined);
    if (getMpToken()) await home.load(force).catch(() => undefined);
    profile.value = getLocalProfile(profileKey.value);
  })().finally(() => {
    initializePromise = null;
  });
  return initializePromise;
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

const posterIndex = ref(0);

const homePosters = [
  {
    key: "joint-health",
    src: safeLocalImageSrc("/uploads/mp-visual/home-poster-joint-health.webp"),
    label: "骨关节健康管理",
    url: "/pages/services/index",
  },
  {
    key: "complete-archive",
    src: safeLocalImageSrc("/uploads/mp-visual/home-poster-complete-archive.webp"),
    label: "完善健康档案",
    url: "/pages/records/index",
  },
] as const;

function onPosterChange(event: { detail: { current: number } }) {
  posterIndex.value = event.detail.current;
}

function openPoster(poster: (typeof homePosters)[number]) {
  void go(poster.url);
}

function openAssistant() {
  consultation.applyEntryContext("来自首页：请协助解答我的健康问题。", "health");
  void go("/pages/consult/index", true);
}

function openDoctorManager() {
  void go("/pages/services/catalog");
}

onMounted(() => {
  void initialize();
});

onShow(() => {
  syncCustomTabBar(0);
  void initialize(true);
});

onShareAppMessage(() => ({
  title: "春雨健康患者端",
  path: app.buildSharePath("/pages/index/index"),
}));
</script>

<template>
  <view class="home-page" :class="{ elder: app.elderMode }">
    <scroll-view scroll-y class="home-scroll">
      <view class="home-shell" :style="{ paddingTop: `${headerPadTop}px` }">
        <text class="greeting-title">{{ greetingTitle }}</text>

        <view class="poster-card">
          <swiper
            class="poster-card__swiper"
            style="height: 205px"
            circular
            autoplay
            :interval="5000"
            :duration="420"
            :current="posterIndex"
            @change="onPosterChange"
          >
            <swiper-item
              v-for="poster in homePosters"
              :key="poster.key"
              class="poster-card__slide"
            >
              <image
                class="poster-card__image pressable"
                :src="poster.src"
                mode="aspectFill"
                :lazy-load="false"
                :aria-label="poster.label"
                @tap="openPoster(poster)"
              />
            </swiper-item>
          </swiper>
          <view class="poster-card__dots" aria-hidden="true">
            <view
              v-for="(poster, index) in homePosters"
              :key="poster.key"
              class="poster-card__dot"
              :class="{ 'is-active': posterIndex === index }"
            />
          </view>
        </view>

        <view class="section-card task-section">
          <text class="section-title">今天需要完成</text>
          <view class="task-card pressable" aria-role="button" @click="go(taskUrl)">
            <view class="task-card__icon icon-disc">
              <AppIcon name="health-record" :size="40" tone="primary" />
            </view>
            <view class="task-card__copy">
              <text class="task-card__title">{{ taskTitle }}</text>
              <text class="task-card__subtitle">{{ taskDescription }}</text>
            </view>
            <view class="task-card__right">
              <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
              <view class="task-card__button">
                <text>{{ taskAction }}</text>
              </view>
            </view>
          </view>
        </view>

        <view class="section-card health-section">
          <text class="section-title">我的健康</text>
          <view class="health-grid">
            <view
              v-for="(item, index) in healthEntries"
              :key="item.key"
              class="health-entry pressable"
              :class="{ 'health-entry--divided': index > 0 }"
              aria-role="button"
              :aria-label="item.label"
              @click="go(item.url)"
            >
              <view class="health-entry__icon icon-disc">
                <AppIcon :name="item.icon" :size="40" tone="primary" />
              </view>
              <view class="health-entry__label-row">
                <text class="health-entry__label">{{ item.label }}</text>
                <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
              </view>
            </view>
          </view>
        </view>

        <view class="service-section">
          <text class="section-title service-section__title">常用服务</text>
          <view class="service-list">
            <view class="service-card pressable" aria-role="button" @click="openAssistant">
              <view class="service-card__icon icon-disc">
                <AppIcon name="health-assistant" :size="40" tone="primary" />
              </view>
              <view class="service-card__copy">
                <text class="service-card__title">问助手</text>
                <text class="service-card__subtitle">健康问题，快速解答</text>
              </view>
              <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
            </view>
            <view class="service-card pressable" aria-role="button" @click="openDoctorManager">
              <view class="service-card__icon icon-disc">
                <AppIcon name="home-doctor-manager" :size="40" tone="primary" />
              </view>
              <view class="service-card__copy">
                <text class="service-card__title">医生管家</text>
                <text class="service-card__subtitle">专属医生服务与健康管理</text>
              </view>
              <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.home-page {
  --home-green: #0a6843;
  --home-green-deep: #075238;
  --home-ink: #111a15;
  --home-muted: #626b67;
  --home-soft: #edf6ee;
  min-height: 100vh;
  background: #f5faf6;
  color: var(--home-ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.home-scroll {
  height: 100vh;
}

.home-shell {
  box-sizing: border-box;
  padding-right: 16px;
  padding-bottom: calc(94px + env(safe-area-inset-bottom));
  padding-left: 16px;
}

.greeting-title {
  display: block;
  margin: 0 8px 22px;
  color: var(--home-green-deep);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.25;
}

.poster-card {
  position: relative;
  overflow: hidden;
  height: 205px;
  border-radius: 26px;
  background: #e8f0df;
  box-shadow: 0 12px 34px rgba(55, 93, 72, 0.08);
}

.poster-card__swiper {
  width: 100%;
  height: 205px;
}

.poster-card__slide,
.poster-card__image {
  display: block;
  width: 100%;
  height: 205px;
}

.poster-card__dots {
  position: absolute;
  right: 0;
  bottom: 10px;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

.poster-card__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 3px rgba(20, 45, 31, 0.12);
}

.poster-card__dot.is-active {
  background: var(--home-green);
}

.section-card {
  margin-top: 18px;
  padding: 17px 14px 15px;
  border: 1px solid rgba(11, 68, 45, 0.035);
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 14px 34px rgba(45, 87, 65, 0.075);
}

.section-title {
  display: block;
  color: #111713;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.3;
}

.task-section {
  padding-top: 18px;
  padding-bottom: 15px;
}

.task-section .section-title {
  margin: 0 2px 14px;
}

.task-card {
  display: flex;
  box-sizing: border-box;
  min-height: 94px;
  align-items: center;
  gap: 12px;
  padding: 13px 12px;
  border: 1px solid #dfeae1;
  border-radius: 20px;
  background: #f7fbf7;
}

.icon-disc {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--home-soft);
}

.task-card__icon {
  width: 58px;
  height: 58px;
}

.task-card__copy {
  min-width: 0;
  flex: 1;
}

.task-card__title,
.task-card__subtitle {
  display: block;
}

.task-card__title {
  color: #111713;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
}

.task-card__subtitle {
  overflow: hidden;
  margin-top: 5px;
  color: var(--home-muted);
  font-size: 13px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card__right {
  display: flex;
  flex: 0 0 auto;
  align-self: stretch;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
}

.task-card__button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0 11px;
  border-radius: 12px;
  background: var(--home-green);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.health-section .section-title {
  margin: 0 1px 16px;
}

.health-grid {
  display: flex;
}

.health-entry {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1px 5px 0;
}

.health-entry--divided::before {
  position: absolute;
  top: 4px;
  bottom: 1px;
  left: 0;
  width: 1px;
  background: #e5ece7;
  content: "";
}

.health-entry__icon {
  width: 58px;
  height: 58px;
}

.health-entry__label-row {
  display: flex;
  margin-top: 11px;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.health-entry__label {
  color: #171d19;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.35;
  white-space: nowrap;
}

.service-section {
  margin-top: 21px;
}

.service-section__title {
  margin: 0 8px 11px;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.service-card {
  display: flex;
  min-height: 82px;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(11, 68, 45, 0.035);
  border-radius: 25px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 14px 34px rgba(45, 87, 65, 0.075);
}

.service-card__icon {
  width: 58px;
  height: 58px;
}

.service-card__copy {
  min-width: 0;
  flex: 1;
}

.service-card__title,
.service-card__subtitle {
  display: block;
}

.service-card__title {
  color: #111713;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
}

.service-card__subtitle {
  margin-top: 4px;
  color: var(--home-muted);
  font-size: 14px;
  line-height: 1.4;
}

.pressable {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}

.pressable:active {
  opacity: 0.88;
  transform: scale(0.992);
}

.elder .greeting-title {
  font-size: 32px;
}

.elder .section-title {
  font-size: 23px;
}

.elder .task-card__title,
.elder .service-card__title {
  font-size: 20px;
}

.elder .task-card__subtitle,
.elder .service-card__subtitle,
.elder .health-entry__label {
  font-size: 17px;
}
</style>
