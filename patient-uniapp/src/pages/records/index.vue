<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { PatientArchive } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import AppListRow from "../../components/AppListRow.vue";
import AppNotice from "../../components/AppNotice.vue";
import AppPageHeader from "../../components/AppPageHeader.vue";
import AppSectionHeader from "../../components/AppSectionHeader.vue";
import { getMpToken } from "../../api/auth";
import { getMyArchive } from "../../api/patient";
import { launchChunyu } from "../../api/chunyuOpen";
import { getServiceAssets, type ServiceInstance } from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { ensureLogin, openArchiveProfile } from "../../utils/ensureLogin";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";

const store = useAppStore();
const auth = useAuthStore();
const healthAssets = useHealthAssetsStore();
const data = computed(() => healthAssets.records);
const acting = ref(false);
const archive = ref<PatientArchive | null>(null);
const activeServices = ref<ServiceInstance[]>([]);

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
  const order = ["姓名", "性别", "出生日期", "手机号", "所患疾病", "疾病史", "药物过敏"];
  return order
    .filter((k) => s[k] != null && String(s[k]).trim() !== "" && String(s[k]) !== "未填写")
    .map((k) => ({ label: k, value: String(s[k]) }));
});

const hasProfile = computed(() => !!(auth.hasProfile || archive.value?.archived || profileRows.value.length));
const recordCount = computed(() => data.value?.records?.length || 0);
const recordsAction = computed(() => (recordCount.value ? `全部 ${recordCount.value} 份` : "暂无资料"));
const pageReady = ref(false);
const showActiveServices = computed(() => activeServices.value.length > 0);

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
  if (!auth.phoneBound) {
    archive.value = null;
    activeServices.value = [];
    return;
  }
  await Promise.all([
    healthAssets.loadRecords(true),
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

onMounted(async () => {
  pageReady.value = true;
  await loadPageData();
});

onShow(async () => {
  pageReady.value = true;
  await loadPageData();
});

function openToast(title: string) {
  uni.showToast({ title, icon: "none" });
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
  <view class="page" :class="{ elder: store.elderMode }">
    <AppPageHeader title="健康档案" />

    <view v-if="!pageReady" class="summary-card">
      <text class="summary-card__title">请先绑定手机号后查看健康档案</text>
      <AppButton label="去绑定" icon="record-bind" variant="primary" size="sm" @tap="openProfile" />
    </view>

    <view v-else-if="!data" class="summary-card">
      <text class="summary-card__title">正在加载健康档案…</text>
    </view>

    <view v-else>
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

      <view class="summary-card">
        <text class="summary-card__label">{{ data.summary.owner }}</text>
        <text class="summary-card__title">{{ data.summary.title }}</text>
        <text class="summary-card__desc">{{ data.summary.desc }}</text>
        <view class="summary-card__actions">
          <AppButton label="报告解读" icon="health-record" variant="primary" size="sm" @tap="openReportInterpret" />
          <AppButton label="生成健康计划" icon="plan-create" variant="ghost" size="sm" @tap="onGeneratePlan" />
          <AppButton label="完善基础档案" icon="record-edit" variant="soft" size="sm" @tap="openProfile" />
        </view>
      </view>

      <view class="section">
        <AppSectionHeader title="已保存的患者信息" :action="hasProfile ? '去修改' : '去完善'" action-icon="profile-edit" @action="openProfile" />
        <view v-if="hasProfile" class="profile-box">
          <text class="profile-box__name">{{ archive?.displayName || auth.profileName || "已建档患者" }}</text>
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

      <view class="section">
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

      <view class="section">
        <AppSectionHeader title="最近档案" :action="recordsAction" action-icon="nav-chevron-right" />
        <AppListRow
          v-for="record in data.records"
          :key="record.id"
          layout="stack"
          :icon="record.icon"
          :icon-color="record.iconColor"
          :title="record.title"
          :desc="record.desc"
          @tap="openToast(record.toast)"
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
.page {
  min-height: 100vh;
  padding: 16px 14px calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.active-services {
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(16, 52, 40, 0.04);
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
.summary-card,
.section {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.06);
}
.summary-card {
  border-color: #0a3a2d;
  background: #0c4535;
}
.summary-card__label,
.summary-card__title,
.summary-card__desc,
.pending-card__title,
.pending-card__desc,
.profile-box__name,
.profile-box__label,
.profile-box__value,
.empty-inline__text {
  display: block;
}
.summary-card__label {
  color: #cfe8dd;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.summary-card__title {
  margin-top: 8px;
  color: #fff;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
}
.summary-card__desc {
  margin-top: 8px;
  color: #ddefe7;
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
.summary-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.summary-card__actions :deep(.app-button--ghost) {
  border-color: transparent !important;
  background: #f7fcf9;
  color: #0c4535;
}
.profile-box {
  padding: 4px 0;
}
.profile-box__name {
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
