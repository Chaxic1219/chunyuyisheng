<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { PatientArchive } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import AppListRow from "../../components/AppListRow.vue";
import AppNotice from "../../components/AppNotice.vue";
import AppSectionHeader from "../../components/AppSectionHeader.vue";
import { getMpToken } from "../../api/auth";
import { getMyArchive } from "../../api/patient";
import { launchChunyu } from "../../api/chunyuOpen";
import { getServiceAssets, type ServiceInstance } from "../../api/servicePackage";
import { ARCHIVE_HUB_ASSETS, ageFromBirthDate } from "../../constants/archiveHub";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { ensureLogin, openArchiveProfile } from "../../utils/ensureLogin";
import { mpAvatarCacheKey, readMpAvatarCache, resolveMpAvatarSrcOrFallback } from "../../utils/mpAvatar";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";

const store = useAppStore();
const auth = useAuthStore();
const healthAssets = useHealthAssetsStore();
const data = computed(() => healthAssets.records);
const acting = ref(false);
const archive = ref<PatientArchive | null>(null);
const activeServices = ref<ServiceInstance[]>([]);
const localAvatar = ref("");

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

const profileRows = computed(() => {
  const s = archive.value?.contactSummary || {};
  const order = [
    "姓名",
    "性别",
    "出生日期",
    "血型",
    "身高",
    "体重",
    "BMI",
    "健康备注",
    "手机号",
    "所患疾病",
    "疾病史",
    "药物过敏",
    "是否妊娠哺乳",
    "食物接触物过敏",
  ];
  return order
    .filter((k) => s[k] != null && String(s[k]).trim() !== "" && String(s[k]) !== "未填写")
    .map((k) => ({ label: k, value: String(s[k]) }));
});

const displayName = computed(() => archive.value?.displayName || auth.profileName || "未完善档案");
const genderText = computed(() => archive.value?.contactSummary?.["性别"] || "");
const bloodText = computed(() => {
  const v = archive.value?.contactSummary?.["血型"] || "";
  return v && v !== "未填写" ? v : "";
});
const ageText = computed(() => {
  const birth = archive.value?.contactSummary?.["出生日期"] || "";
  const age = ageFromBirthDate(birth);
  return age ? `${age}岁` : "";
});
const profileMeta = computed(() =>
  [genderText.value, ageText.value, bloodText.value].filter((v) => v && v !== "未填写").join("  |  ")
);
const pendingCount = computed(() => (data.value?.pending?.sourceKey ? 1 : 0));
const planCount = computed(() => {
  const title = String(healthAssets.plan?.title || "");
  return title && !/暂无/.test(title) ? 1 : 0;
});

const hasProfile = computed(() => !!(auth.hasProfile || archive.value?.archived || profileRows.value.length));
const recordCount = computed(() => data.value?.records?.length || 0);
const recordsAction = computed(() => (recordCount.value ? `全部 ${recordCount.value} 份` : "暂无资料"));
const pageReady = ref(false);
const showActiveServices = computed(() => activeServices.value.length > 0);
const hubAssets = ARCHIVE_HUB_ASSETS;
const avatarScope = computed(() =>
  buildStorageScope({
    doctorId: store.doctor?.id,
    patientId: auth.patientId,
    personId: auth.personId,
    token: getMpToken(),
  })
);
const avatarSrc = computed(() => resolveMpAvatarSrcOrFallback(auth.avatarUrl, localAvatar.value));

async function loadActiveServices() {
  if (!auth.phoneBound || !getMpToken()) {
    activeServices.value = [];
    return;
  }
  try {
    const assets = await getServiceAssets();
    const rows = (assets.instances || []).filter((row) => row.status === "active");
    activeServices.value = rows.slice(0, 3);
  } catch {
    activeServices.value = [];
  }
}

async function loadPageData() {
  localAvatar.value = readMpAvatarCache(mpAvatarCacheKey(avatarScope.value));
  if (getMpToken()) {
    await auth.refreshMe().catch(() => {});
    localAvatar.value = readMpAvatarCache(mpAvatarCacheKey(avatarScope.value)) || localAvatar.value;
  }
  if (!auth.phoneBound) {
    archive.value = null;
    activeServices.value = [];
    return;
  }
  await Promise.all([
    healthAssets.loadRecords(true),
    healthAssets.loadPlan(true),
    getMyArchive(profileKey.value)
      .then((row) => {
        archive.value = row;
      })
      .catch(() => {
        archive.value = null;
      }),
    loadActiveServices(),
  ]);
}

onShow(async () => {
  pageReady.value = true;
  await loadPageData();
});

function openRecord(record: { id: string }) {
  if (!record?.id) return;
  uni.navigateTo({ url: `/pages/records/detail?id=${encodeURIComponent(record.id)}` });
}

function openToast(title: string) {
  uni.showToast({ title, icon: "none" });
}

async function openPending() {
  if (data.value?.pending?.sourceKey) {
    await onConfirmPending();
    return;
  }
  openToast("暂无待确认资料");
}

function openKnowledge() {
  uni.navigateTo({ url: "/pages/faq/index" });
}

function openPlan() {
  uni.navigateTo({ url: "/pages/plans/detail" });
}

async function openUpload() {
  const ok = await ensureLogin("/pages/archive/health");
  if (!ok) return;
  uni.navigateTo({ url: "/pages/archive/health" });
}

async function openReportInterpret() {
  const ok = await ensureLogin("/pages/records/index");
  if (!ok) return;
  await launchChunyu("report");
}

async function openProfile() {
  await openArchiveProfile("/pages/records/index");
}

function openActiveService(inst: ServiceInstance) {
  if (inst?.id) {
    uni.navigateTo({ url: `/pages/services/instance?id=${inst.id}` });
    return;
  }
  uni.navigateTo({ url: "/pages/services/mine-services?tab=active" });
}

function openAllActiveServices() {
  uni.navigateTo({ url: "/pages/services/mine-services?tab=active" });
}

function toastError(err: unknown, fallback: string) {
  const message = err instanceof Error && err.message ? err.message : fallback;
  uni.showToast({ title: message, icon: "none" });
}

function resolvePendingSourceKey() {
  const list = data.value;
  if (!list) return "";
  if (list.pending?.sourceKey) return list.pending.sourceKey;
  const pendingRow = list.records.find((row) => String(row.desc || "").includes("待确认"));
  return pendingRow?.id || list.records[0]?.id || "";
}

async function onConfirmPending() {
  const sourceKey = resolvePendingSourceKey();
  if (!sourceKey) {
    openToast("暂无待确认项");
    return;
  }
  if (acting.value) return;
  acting.value = true;
  try {
    await healthAssets.confirmPendingRecord(sourceKey);
    openToast("已确认");
  } catch (err) {
    toastError(err, "确认失败");
  } finally {
    acting.value = false;
  }
}

async function onGeneratePlan() {
  if (acting.value) return;
  acting.value = true;
  try {
    const result = await healthAssets.generateAndActivatePlan();
    const planId = result?.plan?.id;
    if (planId == null) {
      openToast("未生成计划");
      return;
    }
    uni.navigateTo({ url: "/pages/plans/detail" });
  } catch (err) {
    toastError(err, "生成健康计划失败");
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <view class="hub-page" :class="{ elder: store.elderMode }">
    <view class="hero">
      <view class="hero__copy">
        <text class="hero__title">我的健康档案</text>
        <text class="hero__sub">一份档案，全家健康有据可循</text>
      </view>
      <image class="hero__art" :src="hubAssets.hero" mode="aspectFit" />
    </view>

    <view v-if="!pageReady || (auth.phoneBound && !data)" class="sheet">
      <view class="state-card">正在整理健康档案…</view>
    </view>

    <view v-else-if="!auth.phoneBound" class="sheet">
      <view class="person-card">
        <image class="person-card__avatar" :src="avatarSrc" mode="aspectFill" />
        <view class="person-card__copy">
          <text class="person-card__name">尚未绑定手机号</text>
          <text class="person-card__meta">绑定后即可查看并完善健康档案</text>
        </view>
      </view>
      <AppButton label="去绑定" icon="record-bind" variant="primary" block @tap="openProfile" />
    </view>

    <view v-else class="sheet">
      <view class="person-card pressable" @tap="openProfile">
        <image class="person-card__avatar" :src="avatarSrc" mode="aspectFill" />
        <view class="person-card__copy">
          <view class="person-card__name-row">
            <text class="person-card__name">{{ displayName }}</text>
            <text v-if="hasProfile" class="person-card__tag">本人</text>
          </view>
          <text class="person-card__meta">{{ profileMeta || "完善档案后显示性别、年龄与血型" }}</text>
        </view>
        <view class="person-card__edit">
          <text>编辑</text>
          <AppIcon name="nav-chevron-right" :size="16" tone="muted" />
        </view>
      </view>

      <view class="stats">
        <view class="stats__cell">
          <text class="stats__num">{{ recordCount }}</text>
          <text class="stats__label">健康记录</text>
        </view>
        <view class="stats__cell">
          <text class="stats__num">{{ pendingCount }}</text>
          <text class="stats__label">待确认资料</text>
        </view>
        <view class="stats__cell">
          <text class="stats__num">{{ planCount }}</text>
          <text class="stats__label">健康计划</text>
        </view>
      </view>

      <view class="section-head">
        <view class="section-head__bar" />
        <text class="section-head__title">档案服务</text>
      </view>

      <view class="service-grid">
        <view class="service-card pressable" @tap="openUpload">
          <view class="service-card__icon" style="background: #e7f1ff">
            <image class="service-card__img" :src="hubAssets.records" mode="aspectFit" />
          </view>
          <view class="service-card__copy">
            <text class="service-card__title">健康记录</text>
            <text class="service-card__hint">查询全部健康资料</text>
          </view>
        </view>
        <view class="service-card pressable" @tap="openPending">
          <view class="service-card__icon" style="background: #fff1e6">
            <image class="service-card__img" :src="hubAssets.pending" mode="aspectFit" />
            <text v-if="pendingCount" class="service-card__badge">{{ pendingCount }}</text>
          </view>
          <view class="service-card__copy">
            <text class="service-card__title">待确认资料</text>
            <text class="service-card__hint">确认后纳入档案</text>
          </view>
        </view>
        <view class="service-card pressable" @tap="openPlan">
          <view class="service-card__icon" style="background: #f3eaff">
            <image class="service-card__img" :src="hubAssets.plan" mode="aspectFit" />
          </view>
          <view class="service-card__copy">
            <text class="service-card__title">健康计划</text>
            <text class="service-card__hint">专属健康管理方案</text>
          </view>
        </view>
        <view class="service-card pressable" @tap="openKnowledge">
          <view class="service-card__icon" style="background: #e7f7ee">
            <image class="service-card__img" :src="hubAssets.knowledge" mode="aspectFit" />
          </view>
          <view class="service-card__copy">
            <text class="service-card__title">健康知识</text>
            <text class="service-card__hint">科学守护全家健康</text>
          </view>
        </view>
      </view>

      <view class="improve-banner pressable" @tap="openProfile">
        <image class="improve-banner__art" :src="hubAssets.shield" mode="aspectFit" />
        <view class="improve-banner__copy">
          <text class="improve-banner__title">完善健康档案，享受更精准的健康服务</text>
          <text class="improve-banner__sub">让健康管理更简单、更高效</text>
        </view>
        <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
      </view>

      <view v-if="showActiveServices" class="active-services">
        <view class="active-services__head">
          <text class="active-services__label">进行中的服务</text>
          <text class="active-services__more pressable" @click="openAllActiveServices">全部</text>
        </view>
        <view
          v-for="inst in activeServices"
          :key="inst.id"
          class="active-services__row pressable"
          @click="openActiveService(inst)"
        >
          <view class="active-services__copy">
            <text class="active-services__title">{{ inst.title }}</text>
            <text class="active-services__meta">
              {{ inst.serviceStartDate }} ~ {{ inst.serviceEndDate }}
              <text v-if="inst.summary?.nextTask"> · {{ inst.summary.nextTask }}</text>
            </text>
          </view>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>
      </view>

      <view class="extra-actions">
        <AppButton label="报告解读" icon="health-record" variant="primary" size="sm" @tap="openReportInterpret" />
        <AppButton label="生成健康计划" icon="plan-create" variant="ghost" size="sm" @tap="onGeneratePlan" />
        <AppButton :label="hasProfile ? '更新档案' : '完善基础档案'" icon="record-edit" variant="soft" size="sm" @tap="openProfile" />
      </view>

      <view class="section">
        <AppSectionHeader title="已保存的患者信息" :action="hasProfile ? '去修改' : '去完善'" action-icon="profile-edit" @action="openProfile" />
        <view v-if="hasProfile" class="profile-box">
          <text class="profile-box__name">{{ displayName }}</text>
          <view v-for="row in profileRows" :key="row.label" class="profile-box__row">
            <text class="profile-box__label">{{ row.label }}</text>
            <text class="profile-box__value">{{ row.value }}</text>
          </view>
        </view>
        <view v-else class="empty-inline">
          <text class="empty-inline__text">尚未同步基础档案。完善姓名、疾病与过敏信息后会显示在这里。</text>
          <AppButton label="去完善档案" icon="profile-edit" variant="primary" size="sm" @tap="openProfile" />
        </view>
      </view>

      <view v-if="data" class="section">
        <AppSectionHeader title="需要你确认" action="识别说明" action-icon="nav-chevron-right" @action="openToast('识别说明整理中，请先按提示确认关键条目')" />
        <view class="pending-card">
          <view class="pending-card__icon"><AppIcon name="status-error" :size="27" tone="danger" /></view>
          <view class="pending-card__copy">
            <text class="pending-card__title">{{ data.pending.title }}</text>
            <text class="pending-card__desc">{{ data.pending.desc }}</text>
          </view>
          <AppButton
            v-if="data.pending.sourceKey"
            label="确认此项"
            icon="action-confirm"
            variant="danger"
            size="sm"
            @tap="onConfirmPending"
          />
        </view>
      </view>

      <view v-if="data" class="section">
        <AppSectionHeader title="最近档案" :action="recordsAction" action-icon="nav-chevron-right" @action="openUpload" />
        <AppListRow
          v-for="record in data.records"
          :key="record.id"
          layout="stack"
          :icon="record.icon"
          :icon-color="record.iconColor"
          :title="record.title"
          :desc="record.desc"
          @tap="openRecord(record)"
        />
        <view v-if="!recordCount" class="empty-inline">
          <text class="empty-inline__text">暂无归档的健康记录。可先完善基础档案，或把检查报告交给春雨医生解读。</text>
          <view class="empty-inline__actions">
            <AppButton label="查看健康记录" icon="health-record" variant="soft" size="sm" @tap="openUpload" />
            <AppButton label="报告解读" icon="health-record" variant="primary" size="sm" @tap="openReportInterpret" />
          </view>
        </view>
      </view>

      <AppNotice text="识别结果需要用户确认；高风险和冲突信息不会自动进入健康计划。" />
    </view>
  </view>
</template>

<style scoped>
.hub-page {
  min-height: 100vh;
  background: #e8f5f1;
  box-sizing: border-box;
}

.hero {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 36px;
}

.hero__copy {
  min-width: 0;
  flex: 1;
}

.hero__title {
  display: block;
  color: #14352c;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.3;
}

.hero__sub {
  display: block;
  margin-top: 6px;
  color: #4f7468;
  font-size: 13px;
  line-height: 1.5;
}

.hero__art {
  width: 108px;
  height: 108px;
  flex: 0 0 auto;
}

.sheet {
  margin-top: -18px;
  padding: 0 16px calc(28px + env(safe-area-inset-bottom));
}

.state-card {
  padding: 28px 16px;
  border-radius: 18px;
  background: #fff;
  color: #6a756f;
  text-align: center;
  font-size: var(--font-secondary, 16px);
}

.person-card,
.stats,
.section,
.active-services,
.extra-actions {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.05);
}

.person-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.person-card__avatar {
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: #eef7f3;
}

.person-card__copy {
  min-width: 0;
  flex: 1;
}

.person-card__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.person-card__name {
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.person-card__tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: #e4f6ee;
  color: #1f8a64;
  font-size: 11px;
  font-weight: 700;
}

.person-card__meta {
  display: block;
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
}

.person-card__edit {
  display: flex;
  align-items: center;
  color: #2f6b4f;
  font-size: 13px;
  font-weight: 700;
}

.stats {
  display: flex;
  padding: 10px 4px;
}

.stats__cell {
  flex: 1;
  text-align: center;
}

.stats__num {
  display: block;
  color: #17201c;
  font-size: 22px;
  font-weight: 800;
}

.stats__label {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 4px 12px;
}

.section-head__bar {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: #2aa876;
}

.section-head__title {
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.service-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.service-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(50% - 5px);
  padding: 12px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.05);
  box-sizing: border-box;
}

.service-card__icon {
  position: relative;
  display: flex;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}

.service-card__img {
  width: 32px;
  height: 32px;
}

.service-card__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.service-card__copy {
  min-width: 0;
  flex: 1;
}

.service-card__title,
.service-card__hint {
  display: block;
}

.service-card__title {
  color: #17201c;
  font-size: 14px;
  font-weight: 800;
}

.service-card__hint {
  margin-top: 2px;
  color: #6a756f;
  font-size: 11px;
  line-height: 1.4;
}

.improve-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: #d9f3ea;
}

.improve-banner__art {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
}

.improve-banner__copy {
  min-width: 0;
  flex: 1;
}

.improve-banner__title,
.improve-banner__sub {
  display: block;
}

.improve-banner__title {
  color: #14352c;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.45;
}

.improve-banner__sub {
  margin-top: 2px;
  color: #4f7468;
  font-size: 11px;
}

.extra-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.active-services__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.active-services__label {
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.active-services__more {
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}

.active-services__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid #edf1ee;
}

.active-services__row:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.active-services__copy {
  min-width: 0;
  flex: 1;
}

.active-services__title {
  display: block;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
  line-height: 1.35;
}

.active-services__meta {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
}

.profile-box {
  padding: 4px 0;
}

.profile-box__name {
  display: block;
  margin-bottom: 8px;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 900;
}

.profile-box__row {
  display: flex;
  padding: 8px 0;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid #edf1ee;
}

.profile-box__row:last-child {
  border-bottom: 0;
}

.profile-box__label {
  width: 72px;
  flex: 0 0 auto;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}

.profile-box__value {
  flex: 1;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
  line-height: 1.45;
}

.pending-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: #fff5ed;
}

.pending-card__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #fbe8e5;
}

.pending-card__copy {
  min-width: 0;
  flex: 1;
}

.pending-card__title,
.pending-card__desc,
.empty-inline__text {
  display: block;
}

.pending-card__title {
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 900;
}

.pending-card__desc {
  margin-top: 3px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}

.empty-inline {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 2px;
}

.empty-inline__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.empty-inline__text {
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
</style>
