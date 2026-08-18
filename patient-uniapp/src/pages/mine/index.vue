<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShareAppMessage, onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { getMpToken, mpUpdateAvatar } from "../../api/auth";
import { getLocalProfile, getMyArchive, type PatientProfile } from "../../api/patient";
import { getServiceAssets } from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { ensureLogin, openArchiveProfile } from "../../utils/ensureLogin";
import { resolvePatientDisplayName } from "../../utils/displayName";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";
import { syncCustomTabBar } from "../../utils/syncTabBar";

const store = useAppStore();
const auth = useAuthStore();
const healthAssets = useHealthAssetsStore();
const profile = ref<PatientProfile | null>(null);
const archiveName = ref("");
const localAvatar = ref("");
const AVATAR_CACHE_KEY = "mpAvatarUrl";
const AVATAR_PENDING_KEY = "mpAvatarPending";
const syncingAvatar = ref(false);
const headerPadTop = ref(12);
const couponCount = ref(0);
const activeServiceCount = ref(0);

const profileCacheKey = computed(() =>
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
const avatarCacheKey = computed(() =>
  scopedStorageKey(
    AVATAR_CACHE_KEY,
    buildStorageScope({
      doctorId: store.doctor?.id,
      patientId: auth.patientId,
      personId: auth.personId,
      token: getMpToken(),
    })
  )
);
const avatarPendingKey = computed(() =>
  scopedStorageKey(
    AVATAR_PENDING_KEY,
    buildStorageScope({
      doctorId: store.doctor?.id,
      patientId: auth.patientId,
      personId: auth.personId,
      token: getMpToken(),
    })
  )
);

const displayName = computed(() =>
  resolvePatientDisplayName({
    phoneBound: auth.phoneBound,
    profileName: auth.profileName,
    archiveName: archiveName.value,
    localProfileName: profile.value?.name,
    phoneMasked: auth.phoneMasked,
  })
);
const profileCardLabel = computed(() => displayName.value || "微信用户");
const phoneStatus = computed(() => (auth.phoneBound ? "已绑定手机号" : "请绑定手机号"));
const avatarSrc = computed(() => {
  const raw = auth.avatarUrl || localAvatar.value || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("http://")) return `https://${value.slice("http://".length)}`;
  return value;
});

const familyCount = computed(() => {
  const family = healthAssets.family as null | {
    count?: number;
    managed?: unknown;
    helpers?: unknown[];
  };
  if (!family) return 0;
  if (typeof family.count === "number") return Math.max(0, family.count);
  return (family.managed ? 1 : 0) + (Array.isArray(family.helpers) ? family.helpers.length : 0);
});

const stats = computed(() => [
  { key: "family", value: String(familyCount.value), label: "家庭成员", url: "/pages/family/index" },
  {
    key: "services",
    value: String(activeServiceCount.value),
    label: "进行中",
    url: "/pages/services/mine-services?tab=active",
  },
  { key: "coupon", value: String(couponCount.value), label: "优惠券", url: "/pages/services/rights" },
]);

const menuGroups = [
  {
    title: "我的健康",
    items: [
      {
        key: "health-record",
        iconSrc: "/static/icons/v2/health-record.png",
        title: "健康档案",
        url: "/pages/records/index",
      },
      {
        key: "health-plan",
        iconSrc: "/static/icons/v2/health-plan.png",
        title: "健康计划",
        url: "/pages/plans/detail",
      },
      {
        key: "health-log",
        iconSrc: "/static/icons/v2/health-log.png",
        title: "健康记录",
        url: "/pages/archive/health",
      },
    ],
  },
  {
    title: "服务与订单",
    items: [
      {
        key: "service-center",
        iconSrc: "/static/icons/v2/service-center.png",
        title: "我的服务",
        url: "/pages/services/mine-services?tab=active",
      },
      {
        key: "order",
        iconSrc: "/static/icons/v2/order.png",
        title: "我的订单",
        url: "/pages/services/mine-services?tab=orders",
      },
      {
        key: "service-rights",
        iconSrc: "/static/icons/v2/service-rights.png",
        title: "优惠权益",
        url: "/pages/services/rights",
      },
    ],
  },
  {
    title: "家庭与工具",
    items: [
      {
        key: "member-record",
        iconSrc: "/static/icons/v2/member-record.png",
        title: "家庭成员",
        url: "/pages/family/index",
      },
      {
        key: "location",
        iconSrc: "/static/icons/v2/location.png",
        title: "地址管理",
        url: "/pages/address/index",
      },
      {
        key: "settings",
        iconSrc: "/static/icons/v2/settings.png",
        title: "设置与授权",
        url: "/pages/settings/index",
      },
    ],
  },
] as const;

function syncSafeHeader() {
  try {
    const sys = uni.getSystemInfoSync();
    const status = Number(sys.statusBarHeight || 20);
    const menu =
      typeof uni.getMenuButtonBoundingClientRect === "function"
        ? uni.getMenuButtonBoundingClientRect()
        : null;
    if (menu && menu.bottom > 0) {
      headerPadTop.value = Math.ceil(menu.bottom + 8);
      return;
    }
    headerPadTop.value = status + 12;
  } catch {
    headerPadTop.value = 12;
  }
}

async function loadServiceSummary() {
  if (!getMpToken()) {
    couponCount.value = 0;
    activeServiceCount.value = 0;
    return;
  }
  try {
    const data = await getServiceAssets();
    couponCount.value = Number(data.couponAvailableCount) || 0;
    activeServiceCount.value = (data.instances || []).filter((item) => item.status === "active").length;
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  syncSafeHeader();
  void store.load();
  void healthAssets.loadFamily();
});

onShow(async () => {
  syncCustomTabBar(2);
  syncSafeHeader();
  void healthAssets.loadFamily();
  void loadServiceSummary();
  profile.value = getLocalProfile(profileCacheKey.value);
  localAvatar.value = String(uni.getStorageSync(avatarCacheKey.value) || "");
  if (!getMpToken()) {
    archiveName.value = "";
    return;
  }
  try {
    await auth.refreshMe();
  } catch {
    /* ignore */
  }
  void syncPendingAvatar();
  if (auth.phoneBound) {
    try {
      const archive = await getMyArchive(profileCacheKey.value);
      archiveName.value = archive.displayName || "";
      profile.value = getLocalProfile(profileCacheKey.value);
    } catch {
      archiveName.value = "";
    }
  } else {
    archiveName.value = "";
  }
});

onShareAppMessage(() => ({
  title: "春雨健康患者端",
  path: store.buildSharePath("/pages/mine/index"),
}));

async function goWithLogin(url: string) {
  const ok = await ensureLogin(url);
  if (!ok) return;
  uni.navigateTo({ url });
}

async function openProfile() {
  await openArchiveProfile("/pages/mine/index");
}

function openMenu(url: string) {
  void goWithLogin(url);
}

function readFileAsDataUrl(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const fs = uni.getFileSystemManager();
      fs.readFile({
        filePath,
        encoding: "base64",
        success: (res) => {
          const base64 = String((res as any).data || "").trim();
          if (!base64) return reject(new Error("empty_avatar_file"));
          resolve(`data:image/png;base64,${base64}`);
        },
        fail: reject,
      });
    } catch (e) {
      reject(e);
    }
  });
}

function loadPendingAvatarData(): string {
  return String(uni.getStorageSync(avatarPendingKey.value) || "").trim();
}

function savePendingAvatarData(dataUrl: string) {
  uni.setStorageSync(avatarPendingKey.value, dataUrl);
}

function clearPendingAvatarData() {
  uni.removeStorageSync(avatarPendingKey.value);
}

async function syncAvatarData(avatarDataUrl: string) {
  const data = await mpUpdateAvatar(avatarDataUrl);
  auth.applyMe(data);
  if (auth.avatarUrl) {
    localAvatar.value = auth.avatarUrl;
    uni.setStorageSync(avatarCacheKey.value, auth.avatarUrl);
  }
  clearPendingAvatarData();
}

async function syncPendingAvatar() {
  if (syncingAvatar.value || !getMpToken()) return;
  const pending = loadPendingAvatarData();
  if (!pending) return;
  syncingAvatar.value = true;
  try {
    await syncAvatarData(pending);
  } catch (e) {
    console.warn("[mine] pending avatar sync failed", e);
  } finally {
    syncingAvatar.value = false;
  }
}

async function onChooseAvatar(ev: any) {
  const rawPath = ev?.detail?.avatarUrl || "";
  if (!rawPath) {
    uni.showToast({ title: "未获取到头像", icon: "none" });
    return;
  }
  localAvatar.value = rawPath;
  uni.setStorageSync(avatarCacheKey.value, rawPath);
  try {
    const avatarDataUrl = await readFileAsDataUrl(rawPath);
    savePendingAvatarData(avatarDataUrl);
    await syncAvatarData(avatarDataUrl);
    uni.showToast({ title: "头像已更新", icon: "none" });
  } catch (e) {
    console.warn("[mine] avatar sync failed", e);
    uni.showToast({ title: "已本地更新，稍后自动同步", icon: "none" });
  }
}
</script>

<template>
  <view class="page" :class="{ elder: store.elderMode }">
    <image
      class="mine-bg"
      src="/static/visual/mine-leaf-bg.webp"
      mode="aspectFill"
      :lazy-load="false"
    />
    <scroll-view scroll-y class="mine-scroll">
      <view class="shell" :style="{ paddingTop: `${headerPadTop}px` }">
        <view class="profile">
          <view class="profile__avatar-wrap">
            <view class="profile__avatar">
              <image v-if="avatarSrc" class="profile__avatar-img" :src="avatarSrc" mode="aspectFill" />
              <AppIcon v-else name="nav-profile" :size="48" tone="primary" />
            </view>
            <button
              class="profile__avatar-btn"
              open-type="chooseAvatar"
              aria-role="button"
              aria-label="更换头像"
              @chooseavatar="onChooseAvatar"
              @click.stop
            />
          </view>
          <view class="profile__meta pressable" aria-role="button" aria-label="查看个人档案" @click="openProfile">
            <text class="profile__name">{{ profileCardLabel }}</text>
            <text class="profile__status">{{ phoneStatus }}</text>
          </view>
          <view
            class="profile__settings pressable"
            aria-role="button"
            aria-label="打开设置"
            @click="openMenu('/pages/settings/index')"
          >
            <image class="menu-icon__image" src="/static/icons/v2/settings.png" mode="aspectFit" />
            <text class="profile__settings-text">设置</text>
          </view>
        </view>

        <view class="stats card-shadow">
          <view
            v-for="stat in stats"
            :key="stat.key"
            class="stats__item pressable"
            aria-role="button"
            :aria-label="`查看${stat.label}`"
            @click="openMenu(stat.url)"
          >
            <text class="stats__value">{{ stat.value }}</text>
            <text class="stats__label">{{ stat.label }}</text>
          </view>
        </view>

        <view v-for="group in menuGroups" :key="group.title" class="menu-card card-shadow">
          <text class="menu-card__title">{{ group.title }}</text>
          <view
            v-for="item in group.items"
            :key="item.key"
            class="menu-row pressable"
            aria-role="button"
            :aria-label="`打开${item.title}`"
            @click="openMenu(item.url)"
          >
            <view class="menu-row__icon">
              <image class="menu-icon__image" :src="item.iconSrc" mode="aspectFit" />
            </view>
            <view class="menu-row__content">
              <text class="menu-row__label">{{ item.title }}</text>
              <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  background: #f5faf3;
  --font-caption: 15px;
  --font-secondary: 17px;
  --font-body: 18px;
  --font-subheading: 21px;
  --font-heading: 28px;
  font-size: var(--font-body);
}
.mine-bg {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  display: block;
  width: 100%;
  height: 320px;
}
.mine-scroll {
  position: relative;
  z-index: 1;
  height: 100vh;
}
.shell {
  box-sizing: border-box;
  padding: 8px 16px calc(96px + env(safe-area-inset-bottom));
}
.profile {
  display: flex;
  min-height: 126px;
  align-items: center;
  gap: 14px;
}
.profile__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.profile__avatar {
  display: flex;
  width: 72px;
  height: 72px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgba(10, 104, 67, 0.06);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
}
.profile__avatar-img {
  width: 100%;
  height: 100%;
}
.profile__avatar-btn {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
}
.profile__avatar-btn::after {
  border: 0;
}
.profile__meta {
  min-width: 0;
  flex: 1;
}
.profile__name {
  display: block;
  overflow: hidden;
  color: #151b18;
  font-size: var(--font-heading);
  font-weight: 800;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile__status {
  display: block;
  margin-top: 6px;
  color: #69756f;
  font-size: var(--font-secondary);
}
.profile__settings {
  display: flex;
  box-sizing: border-box;
  min-width: 78px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
}
.profile__settings-text {
  color: #24302a;
  font-size: 17px;
  white-space: nowrap;
}
.card-shadow {
  box-shadow: 0 8px 24px rgba(29, 91, 59, 0.045);
}
.stats {
  display: flex;
  margin-bottom: 20px;
  padding: 19px 0;
  border: 1px solid rgba(10, 104, 67, 0.035);
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.9);
}
.stats__item {
  position: relative;
  min-width: 0;
  flex: 1;
  text-align: center;
}
.stats__item + .stats__item::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 1px;
  background: #e6ece7;
  content: "";
}
.stats__value {
  display: block;
  color: #0a6843;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.15;
}
.stats__label {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: #38423d;
  font-size: var(--font-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-card {
  margin-bottom: 16px;
  padding: 20px 16px 4px;
  border: 1px solid rgba(10, 104, 67, 0.03);
  border-radius: 26px;
  background: #fff;
}
.menu-card__title {
  display: block;
  margin: 0 4px 9px;
  color: #151b18;
  font-size: var(--font-subheading);
  font-weight: 800;
  line-height: 1.35;
}
.menu-row {
  display: flex;
  min-height: 70px;
  align-items: center;
  gap: 14px;
}
.menu-row__icon {
  display: flex;
  width: 58px;
  height: 58px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #edf7ef;
}
.menu-row__icon .menu-icon__image {
  width: 40px;
  height: 40px;
}
.menu-icon__image {
  width: 28px;
  height: 28px;
}
.menu-row__content {
  display: flex;
  min-width: 0;
  min-height: 70px;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #edf1ee;
}
.menu-row:last-child .menu-row__content {
  border-bottom: 0;
}
.menu-row__label {
  overflow: hidden;
  color: #18201c;
  font-size: var(--font-body);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pressable:active {
  opacity: 0.68;
}
.elder .profile__name {
  font-size: calc(var(--font-heading) + 2px);
}
.elder .menu-card__title,
.elder .stats__value {
  font-size: 24px;
}
.elder .profile__status,
.elder .profile__settings-text,
.elder .menu-row__label,
.elder .stats__label {
  font-size: 20px;
}
.elder .menu-row__icon {
  width: 64px;
  height: 64px;
}
.elder .menu-row__icon .menu-icon__image {
  width: 44px;
  height: 44px;
}
@media (max-width: 350px) {
  .profile {
    gap: 10px;
  }
  .profile__avatar {
    width: 66px;
    height: 66px;
  }
  .profile__settings {
    min-width: 70px;
    padding: 0 9px;
  }
}
</style>
