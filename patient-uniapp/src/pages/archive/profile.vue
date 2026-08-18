<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import type { FormConfig, PatientArchive } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import PatientForm from "../../components/PatientForm.vue";
import {
  fetchArchiveFormPrefill,
  getMyArchive,
  getMyDoctors,
  saveLocalProfileFromPayload,
  type ConsultingDoctor,
  type FormInitialValue,
} from "../../api/patient";
import { getMpToken } from "../../api/auth";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";

type PageMode = "view" | "edit";

const store = useAppStore();
const auth = useAuthStore();
const mode = ref<PageMode>("edit");
const loadingArchive = ref(true);
const archive = ref<PatientArchive | null>(null);
const myDoctors = ref<ConsultingDoctor[]>([]);
const initialValues = ref<Record<string, FormInitialValue> | null>(null);
const formEpoch = ref(0);
/** 进入编辑前是否已有档（用于更新文案 / 门诊凭证是否必填） */
const editingExisting = ref(false);
const returnUrl = ref("");

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

const summaryRows = computed(() => {
  const s = archive.value?.contactSummary || {};
  const order = [
    "姓名",
    "性别",
    "出生日期",
    "手机号",
    "所患疾病",
    "是否妊娠哺乳",
    "食物接触物过敏",
    "药物过敏",
    "疾病史",
  ];
  return order
    .filter((k) => s[k] != null && String(s[k]).trim() !== "")
    .map((k) => ({ label: k, value: String(s[k]) }));
});

const FOOD_CONTACT_OPTIONS = ["无", "黄瓜", "化妆品", "芒果", "花粉", "牛奶", "油漆", "坚果", "动物皮毛", "海鲜", "其他"];
const DRUG_ALLERGY_OPTIONS = ["无", "普鲁卡因", "维生素B1", "青霉素", "破伤风抗毒素", "地卡因", "磺胺类药物", "泛影葡胺", "阿司匹林", "其他"];
const DISEASE_HISTORY_OPTIONS = ["无", "高血压", "过敏性疾病", "哮喘", "糖尿病", "白癜风", "心脏病", "癫痫", "其他"];
const PREGNANCY_OPTIONS = ["否", "备孕中", "怀孕中", "哺乳中"];

const config = computed<FormConfig | null>(() => {
  if (!store.doctor) return null;
  const isUpdate = editingExisting.value;
  return {
    title: isUpdate ? "更新档案" : "完善档案",
    notes: isUpdate
      ? "修改后将同步到您的健康档案，仅用于为您提供服务。"
      : "以下信息用于完善您的健康档案，仅用于为您提供服务。已绑手机用户可直接提交；未绑手机需短信验证。",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true, err: "请填写姓名" },
      { key: "gender", label: "性别", type: "select", required: true, options: ["男", "女"], err: "请选择性别" },
      { key: "birthDate", label: "出生日期", type: "date", required: true, err: "请填写出生日期" },
      { key: "phone", label: "手机号", type: "tel", required: true, pattern: "^1[3-9]\\d{9}$", err: "请输入正确手机号" },
      { key: "disease", label: "您所患的疾病", type: "text", required: true, placeholder: "请填写所患疾病", err: "请填写所患疾病" },
      { key: "pregnancyStatus", label: "是否妊娠哺乳", type: "select", required: false, options: PREGNANCY_OPTIONS },
      { key: "foodContactAllergies", label: "食物、接触物过敏", type: "checkboxGroup", required: false, options: FOOD_CONTACT_OPTIONS, noneValue: "无", otherValue: "其他" },
      { key: "drugAllergies", label: "药物过敏", type: "checkboxGroup", required: false, options: DRUG_ALLERGY_OPTIONS, noneValue: "无", otherValue: "其他" },
      { key: "diseaseHistory", label: "疾病史", type: "checkboxGroup", required: false, options: DISEASE_HISTORY_OPTIONS, noneValue: "无", otherValue: "其他" },
      {
        key: "outpatientVoucher",
        label: "门诊凭证（选填）",
        type: "file",
        required: false,
        accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        err: "请上传门诊凭证",
      },
    ],
    consent: "1",
  };
});

async function refreshArchiveState() {
  loadingArchive.value = true;
  try {
    if (getMpToken()) {
      await auth.refreshMe().catch(() => {});
    }
    if (!auth.phoneBound) {
      archive.value = null;
      initialValues.value = null;
      myDoctors.value = [];
      mode.value = "edit";
      editingExisting.value = false;
      return;
    }
    archive.value = await getMyArchive(profileCacheKey.value);
    initialValues.value = await fetchArchiveFormPrefill();
    myDoctors.value = await getMyDoctors().catch(() => []);
    const has = !!(auth.hasProfile || archive.value?.archived);
    mode.value = has ? "view" : "edit";
    editingExisting.value = has;
  } finally {
    loadingArchive.value = false;
  }
}

function enterEdit() {
  editingExisting.value = true;
  formEpoch.value += 1;
  mode.value = "edit";
}

function cancelEdit() {
  if (!editingExisting.value && !auth.hasProfile) return;
  mode.value = "view";
}

async function onSubmitted(payload: Record<string, string>) {
  saveLocalProfileFromPayload(payload, profileCacheKey.value);
  await auth.refreshMe().catch(() => {});
  archive.value = await getMyArchive(profileCacheKey.value);
  editingExisting.value = true;
  mode.value = "view";
  uni.showToast({ title: "档案已同步", icon: "success" });
  const back = returnUrl.value;
  if (back && back.startsWith("/pages/") && !back.includes("/pages/archive/profile")) {
    setTimeout(() => {
      uni.redirectTo({
        url: back,
        fail: () => uni.navigateBack(),
      });
    }, 700);
  }
}

onLoad((query) => {
  const raw = query?.returnUrl ? decodeURIComponent(String(query.returnUrl)) : "";
  if (raw.startsWith("/pages/")) returnUrl.value = raw;
});

onMounted(async () => {
  await store.load();
  const ok = await ensureLogin("/pages/archive/profile");
  if (!ok) return;
  await refreshArchiveState();
});
onShow(async () => {
  if (!auth.phoneBound) {
    const ok = await ensureLogin("/pages/archive/profile");
    if (!ok) return;
  }
  /* 编辑中勿打断；从绑号页返回时刷新 */
  if (mode.value === "view" || !editingExisting.value) {
    await refreshArchiveState();
  }
});
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom profile-page" :class="{ elder: store.elderMode }">
    <view v-if="loadingArchive" class="state-card form-state">正在加载档案…</view>

    <template v-else-if="mode === 'view'">
      <view class="service-note radius bg-blue light">
        <AppIcon name="account-security" :size="27" tone="muted" />
        <text>以下为您的档案摘要，仅用于为您提供服务。如需修改请点击下方「更新档案」。</text>
      </view>

      <view class="view-card cu-card radius shadow">
        <view class="view-card__head">
          <view class="view-card__icon radius bg-blue light"><AppIcon name="record-edit" :size="31" tone="primary" /></view>
          <view class="view-card__titles">
            <text class="view-card__eyebrow">我的档案</text>
            <text class="view-card__name">{{ archive?.displayName || auth.profileName || "已建档" }}</text>
            <text class="view-card__sub">档案已建立 · 可随时更新</text>
          </view>
        </view>

        <view v-if="summaryRows.length" class="summary-list">
          <view v-for="row in summaryRows" :key="row.label" class="summary-row">
            <text class="summary-row__label">{{ row.label }}</text>
            <text class="summary-row__value">{{ row.value }}</text>
          </view>
        </view>
        <view v-else class="summary-empty">暂无详细字段，可点击更新档案补充。</view>
      </view>

      <view v-if="myDoctors.length > 0" class="doctor-card-block cu-card radius shadow">
        <view class="doctor-card-block__head">
          <text class="doctor-card-block__title">已咨询医生</text>
          <text class="doctor-card-block__count">共 {{ myDoctors.length }} 位</text>
        </view>
        <view class="doctor-list">
          <view v-for="doc in myDoctors" :key="doc.doctorId" class="doctor-row">
            <view class="doctor-row__avatar-wrap">
              <image
                v-if="doc.avatarUrl"
                class="doctor-row__avatar"
                :src="doc.avatarUrl"
                mode="aspectFill"
              />
              <view v-else class="doctor-row__avatar-placeholder bg-blue light">
                <text class="doctor-row__avatar-text">医</text>
              </view>
            </view>
            <view class="doctor-row__info">
              <text class="doctor-row__name">{{ doc.doctorName || '服务医生' }}</text>
              <text v-if="doc.dept || doc.hospital" class="doctor-row__sub">
                {{ [doc.dept, doc.hospital].filter(Boolean).join(' · ') }}
              </text>
              <text v-if="doc.msgCount > 0" class="doctor-row__stat">共 {{ doc.msgCount }} 条问诊记录</text>
            </view>
            <view class="doctor-row__badge cu-tag round bg-green light">
              <text class="doctor-row__badge-text">已咨询</text>
            </view>
          </view>
        </view>
      </view>

      <view class="view-actions safe-bottom">
        <AppButton class="view-actions__primary" label="更新档案" icon="action-update" block @tap="enterEdit" />
      </view>
    </template>

    <template v-else>
      <view class="service-note radius bg-blue light">
        <AppIcon name="account-security" :size="27" tone="primary" />
        <text v-if="editingExisting">修改内容将同步到您的健康档案。</text>
        <text v-else>首次完善档案后，可在本页查看摘要并随时更新。</text>
      </view>

      <view v-if="editingExisting && auth.hasProfile" class="edit-toolbar">
        <AppButton class="edit-toolbar__back" label="返回查看" icon="nav-back" variant="ghost" size="sm" @tap="cancelEdit" />
      </view>

      <PatientForm
        v-if="config"
        :key="formEpoch"
        :config="config"
        type="联络表"
        archive-mode="contact"
        :initial-values="initialValues || undefined"
        :navigate-back-on-success="false"
        :submit-label="editingExisting ? '保存更新' : '提交建档'"
        @submitted="onSubmitted"
      />
      <view v-else-if="store.loading" class="state-card form-state">正在加载问卷…</view>
      <view v-else-if="store.error" class="state-card form-state">
        <text>{{ store.error }}</text>
        <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="store.load" />
      </view>
      <view v-else class="state-card form-state">
        <AppIcon name="record-edit" :size="34" />
        <text class="unavailable-title">档案服务暂不可用</text>
        <text>当前服务信息暂不可用，请稍后再试。</text>
      </view>
    </template>
  </view>
</template>

<style scoped>
.profile-page { padding-top: 16px; padding-bottom: 88px; }
.service-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 16px 12px;
  padding: 12px;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-md, 8px);
  background: var(--surface-muted, #f5f7fa);
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
.view-card {
  margin: 0 16px;
  padding: 16px;
  background: var(--surface, #fff);
}
.view-card__head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
.view-card__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.view-card__eyebrow {
  display: block;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
}
.view-card__name {
  display: block;
  margin-top: 2px;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-heading, 24px);
  font-weight: 600;
}
.view-card__sub {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
}
.summary-list { display: flex; flex-direction: column; gap: 0; }
.summary-row {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--line, #e5eaf2);
}
.summary-row__label {
  flex: 0 0 108px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  line-height: 1.45;
}
.summary-row__value {
  flex: 1;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-secondary, 16px);
  line-height: 1.45;
  word-break: break-all;
}
.summary-empty {
  padding: 8px 0 4px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
}

.doctor-card-block {
  margin: 12px 16px 0;
  padding: 16px;
  background: var(--surface, #fff);
}
.doctor-card-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.doctor-card-block__title {
  color: var(--text-strong, #2a3547);
  font-size: var(--font-body, 18px);
  font-weight: 600;
}
.doctor-card-block__count {
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
}
.doctor-list { display: flex; flex-direction: column; gap: 10px; }
.doctor-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--line, #e5eaf2);
}
.doctor-row:first-child { border-top: 0; padding-top: 0; }
.doctor-row__avatar-wrap {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--primary-soft, #ecf2ff);
  border: 1px solid var(--line, #e5eaf2);
}
.doctor-row__avatar { width: 100%; height: 100%; display: block; }
.doctor-row__avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.doctor-row__avatar-text {
  color: var(--primary, #5d87ff);
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.doctor-row__info { flex: 1; min-width: 0; }
.doctor-row__name {
  display: block;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-secondary, 16px);
  font-weight: 600;
}
.doctor-row__sub,
.doctor-row__stat {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
}
.doctor-row__stat { color: var(--text-placeholder, #7c8ba5); font-size: var(--font-caption, 14px); }
.doctor-row__badge {
  flex-shrink: 0;
}
.doctor-row__badge-text {
  color: var(--success, #13a452);
  font-size: var(--font-caption, 14px);
  font-weight: 600;
}

.view-actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(250, 251, 252, 0), var(--page-bg, #f0f3f5) 28%);
}
.view-actions__primary {
  font-size: var(--font-subheading, 19px);
}
.edit-toolbar {
  margin: 0 16px 8px;
}
.edit-toolbar__back {
  font-size: var(--font-secondary, 16px);
}
</style>
