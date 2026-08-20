<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import type { FormConfig, PatientArchive } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import PatientForm, { type FormAccordionSection } from "../../components/PatientForm.vue";
import {
  fetchArchiveFormPrefill,
  getMyArchive,
  getMyDoctors,
  saveLocalProfileFromPayload,
  type ConsultingDoctor,
  type FormInitialValue,
} from "../../api/patient";
import { getMpToken } from "../../api/auth";
import {
  ARCHIVE_HUB_ASSETS,
  BLOOD_TYPE_OPTIONS,
  ageFromBirthDate,
  bmiLabel,
  computeBmi,
} from "../../constants/archiveHub";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { ensureLogin } from "../../utils/ensureLogin";
import {
  mpAvatarCacheKey,
  mpAvatarPendingKey,
  persistChosenMpAvatar,
  readMpAvatarCache,
  resolveMpAvatarSrc,
  resolveMpAvatarSrcOrFallback,
} from "../../utils/mpAvatar";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";

type PageMode = "view" | "edit";
type ViewTab = "archive" | "family";

const store = useAppStore();
const auth = useAuthStore();
const healthAssets = useHealthAssetsStore();
const mode = ref<PageMode>("edit");
const viewTab = ref<ViewTab>("archive");
const loadingArchive = ref(true);
const archive = ref<PatientArchive | null>(null);
const myDoctors = ref<ConsultingDoctor[]>([]);
const initialValues = ref<Record<string, FormInitialValue> | null>(null);
const formEpoch = ref(0);
/** 进入编辑前是否已有档（用于更新文案 / 门诊凭证是否必填） */
const editingExisting = ref(false);
const returnUrl = ref("");
const hubAssets = ARCHIVE_HUB_ASSETS;
const localAvatar = ref("");

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
const avatarScope = computed(() =>
  buildStorageScope({
    doctorId: store.doctor?.id,
    patientId: auth.patientId,
    personId: auth.personId,
    token: getMpToken(),
  })
);
const avatarCacheKey = computed(() => mpAvatarCacheKey(avatarScope.value));
const avatarPendingKey = computed(() => mpAvatarPendingKey(avatarScope.value));
const avatarSrc = computed(() => resolveMpAvatarSrcOrFallback(auth.avatarUrl, localAvatar.value));

const summaryRows = computed(() => {
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
    "是否妊娠哺乳",
    "食物接触物过敏",
    "药物过敏",
    "疾病史",
  ];
  return order
    .filter((k) => s[k] != null && String(s[k]).trim() !== "")
    .map((k) => ({ label: k, value: String(s[k]) }));
});

const displayName = computed(() => archive.value?.displayName || auth.profileName || "已建档");
const genderText = computed(() => {
  const v = archive.value?.contactSummary?.["性别"] || "";
  return v && v !== "未填写" ? v : "";
});
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
  [genderText.value, ageText.value, bloodText.value].filter(Boolean).join("  |  ")
);
const recordCount = computed(() => healthAssets.records?.records?.length || 0);
const pendingCount = computed(() => (healthAssets.records?.pending?.sourceKey ? 1 : 0));
const planCount = computed(() => {
  const title = String(healthAssets.plan?.title || "");
  return title && !/暂无/.test(title) ? 1 : 0;
});
const previewAge = computed(() => {
  const birth = String(initialValues.value?.birthDate || initialValues.value?.["出生日期"] || "");
  const age = ageFromBirthDate(birth);
  return age ? `${age}岁` : "";
});
const previewBmi = computed(() =>
  computeBmi(String(initialValues.value?.heightCm || ""), String(initialValues.value?.weightKg || ""))
);
const previewBmiTag = computed(() => bmiLabel(previewBmi.value));
const allergySummary = computed(() => archive.value?.contactSummary?.["药物过敏"] || "暂无用药与过敏记录");
const navTitle = computed(() => {
  if (mode.value === "view") return "我的档案";
  return editingExisting.value ? "更新档案" : "完善档案";
});

const FOOD_CONTACT_OPTIONS = ["无", "黄瓜", "化妆品", "芒果", "花粉", "牛奶", "油漆", "坚果", "动物皮毛", "海鲜", "其他"];
const DRUG_ALLERGY_OPTIONS = ["无", "普鲁卡因", "维生素B1", "青霉素", "破伤风抗毒素", "地卡因", "磺胺类药物", "泛影葡胺", "阿司匹林", "其他"];
const DISEASE_HISTORY_OPTIONS = ["无", "高血压", "过敏性疾病", "哮喘", "糖尿病", "白癜风", "心脏病", "癫痫", "其他"];
const PREGNANCY_OPTIONS = ["否", "备孕中", "怀孕中", "哺乳中"];

const WIZARD_STEPS = [
  { title: "基本信息", keys: ["name", "gender", "birthDate", "phone"] },
  { title: "体征信息", keys: ["bloodType", "heightCm", "weightKg", "healthNotes"] },
  {
    title: "健康档案",
    keys: [
      "disease",
      "pregnancyStatus",
      "foodContactAllergies",
      "drugAllergies",
      "diseaseHistory",
      "outpatientVoucher",
    ],
  },
] as const;

const HEALTH_ACCORDION: FormAccordionSection[] = [
  { id: "condition", title: "当前病情", fieldKeys: ["disease", "pregnancyStatus"], defaultOpen: true },
  { id: "allergy", title: "过敏信息", fieldKeys: ["foodContactAllergies", "drugAllergies"] },
  { id: "history", title: "疾病史", fieldKeys: ["diseaseHistory"] },
];

const editStep = ref(1);
const stepBusy = ref(false);
const formRef = ref<InstanceType<typeof PatientForm> | null>(null);

const currentStepKeys = computed(() => [...WIZARD_STEPS[editStep.value - 1].keys]);
const wizardDisplayName = computed(() => {
  const fromInitial = String(initialValues.value?.name || initialValues.value?.["姓名"] || "").trim();
  if (fromInitial) return fromInitial;
  return archive.value?.displayName || auth.profileName || "未填写姓名";
});

const wizardMetricsText = computed(() => {
  const parts: string[] = [];
  if (previewAge.value) parts.push(`年龄 ${previewAge.value}`);
  if (previewBmi.value) {
    parts.push(`BMI ${previewBmi.value}${previewBmiTag.value ? ` ${previewBmiTag.value}` : ""}`);
  }
  return parts.join(" · ");
});

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
      { key: "bloodType", label: "血型", type: "select", required: false, options: BLOOD_TYPE_OPTIONS },
      { key: "heightCm", label: "身高(cm)", type: "text", required: false, placeholder: "例如 168" },
      { key: "weightKg", label: "体重(kg)", type: "text", required: false, placeholder: "例如 55.0" },
      {
        key: "healthNotes",
        label: "健康备注",
        type: "textarea",
        required: false,
        placeholder: "可填写既往病史、慢性疾病或其他健康信息...",
      },
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

watch(navTitle, (title) => {
  uni.setNavigationBarTitle({ title });
}, { immediate: true });

async function refreshArchiveState() {
  loadingArchive.value = true;
  localAvatar.value = readMpAvatarCache(avatarCacheKey.value);
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
    await Promise.all([healthAssets.loadRecords(), healthAssets.loadPlan()]).catch(() => {});
    const has = !!(auth.hasProfile || archive.value?.archived);
    mode.value = has ? "view" : "edit";
    editingExisting.value = has;
  } finally {
    loadingArchive.value = false;
  }
}

function enterEdit() {
  editingExisting.value = true;
  editStep.value = 1;
  formEpoch.value += 1;
  mode.value = "edit";
}

function cancelEdit() {
  if (!editingExisting.value && !auth.hasProfile) return;
  editStep.value = 1;
  mode.value = "view";
}

function goWizardStep(target: number) {
  if (stepBusy.value) return;
  const next = Math.min(WIZARD_STEPS.length, Math.max(1, target));
  if (next === editStep.value) return;
  stepBusy.value = true;
  editStep.value = next;
  setTimeout(() => {
    stepBusy.value = false;
  }, 320);
}

function prevWizardStep() {
  if (editStep.value <= 1) return;
  goWizardStep(editStep.value - 1);
}

function nextWizardStep() {
  if (stepBusy.value) return;
  const keys = [...WIZARD_STEPS[editStep.value - 1].keys];
  if (!formRef.value?.validate({ fieldKeys: keys })) return;
  if (editStep.value >= WIZARD_STEPS.length) return;
  goWizardStep(editStep.value + 1);
}

async function submitWizard() {
  const keys = [...WIZARD_STEPS[2].keys];
  if (!formRef.value?.validate({ fieldKeys: keys, requireConsent: true })) return;
  await formRef.value.submit();
}

async function onChooseAvatar(ev: { detail?: { avatarUrl?: string } }) {
  const rawPath = ev?.detail?.avatarUrl || "";
  if (!rawPath) {
    uni.showToast({ title: "未获取到头像", icon: "none" });
    return;
  }
  localAvatar.value = rawPath;
  try {
    await persistChosenMpAvatar({
      filePath: rawPath,
      cacheKey: avatarCacheKey.value,
      pendingKey: avatarPendingKey.value,
      applyMe: auth.applyMe,
    });
    localAvatar.value = resolveMpAvatarSrc(auth.avatarUrl, rawPath);
    uni.showToast({ title: "头像已更新", icon: "none" });
  } catch (e) {
    console.warn("[archive] avatar sync failed", e);
    uni.showToast({ title: "已本地更新，稍后自动同步", icon: "none" });
  }
}

function openHealthRecords() {
  uni.navigateTo({ url: "/pages/archive/health" });
}

function openPlan() {
  uni.navigateTo({ url: "/pages/plans/detail" });
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
  <view class="profile-page" :class="{ elder: store.elderMode }">
    <view v-if="loadingArchive" class="state-card">正在加载档案…</view>

    <template v-else-if="mode === 'view'">
      <view class="person-card">
        <image class="person-card__avatar" :src="avatarSrc" mode="aspectFill" />
        <view class="person-card__copy">
          <view class="person-card__name-row">
            <text class="person-card__name">{{ displayName }}</text>
            <text class="person-card__tag">本人</text>
          </view>
          <text class="person-card__meta">{{ profileMeta || "档案已建立，可随时更新" }}</text>
        </view>
        <view class="person-card__edit pressable" @tap="enterEdit">编辑档案</view>
      </view>

      <view class="tabs">
        <view class="tabs__item" :class="{ 'is-on': viewTab === 'archive' }" @tap="viewTab = 'archive'">我的档案</view>
        <view class="tabs__item" :class="{ 'is-on': viewTab === 'family' }" @tap="viewTab = 'family'">家庭成员</view>
      </view>

      <view v-if="viewTab === 'family'" class="empty-card">
        <text>家庭成员即将开放，当前仅展示本人档案。</text>
      </view>

      <template v-else>
        <view class="overview">
          <view class="overview__card overview__card--blue" @tap="openHealthRecords">
            <text class="overview__num">{{ recordCount }}</text>
            <text class="overview__label">健康记录</text>
          </view>
          <view class="overview__card overview__card--orange">
            <text class="overview__num">{{ pendingCount }}</text>
            <text class="overview__label">待确认资料</text>
          </view>
          <view class="overview__card overview__card--purple" @tap="openPlan">
            <text class="overview__num">{{ planCount }}</text>
            <text class="overview__label">健康计划</text>
          </view>
        </view>

        <view class="info-card">
          <text class="info-card__title">档案信息</text>
          <view v-for="row in summaryRows" :key="row.label" class="summary-row">
            <text class="summary-row__label">{{ row.label }}</text>
            <text class="summary-row__value">{{ row.value }}</text>
          </view>
          <view v-if="!summaryRows.length" class="summary-empty">暂无详细字段，可点击更新档案补充。</view>
        </view>

        <view class="nav-card pressable" @tap="openHealthRecords">
          <view class="nav-card__icon" style="background: #e7f1ff">
            <image class="nav-card__img" :src="hubAssets.records" mode="aspectFit" />
          </view>
          <view class="nav-card__copy">
            <text class="nav-card__title">健康记录</text>
            <text class="nav-card__hint">体检报告、处方与检查资料</text>
          </view>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>

        <view class="nav-card pressable" @tap="openPlan">
          <view class="nav-card__icon" style="background: #f3eaff">
            <image class="nav-card__img" :src="hubAssets.plan" mode="aspectFit" />
          </view>
          <view class="nav-card__copy">
            <text class="nav-card__title">健康计划</text>
            <text class="nav-card__hint">专属健康管理方案</text>
          </view>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>

        <view class="nav-card">
          <view class="nav-card__icon" style="background: #fff1e6">
            <image class="nav-card__img" :src="hubAssets.pending" mode="aspectFit" />
          </view>
          <view class="nav-card__copy">
            <text class="nav-card__title">用药信息</text>
            <text class="nav-card__hint">{{ allergySummary }}</text>
          </view>
        </view>

        <view v-if="myDoctors.length > 0" class="doctor-card">
          <view class="doctor-card__head">
            <text class="doctor-card__title">医生与机构</text>
            <text class="doctor-card__count">共 {{ myDoctors.length }} 位</text>
          </view>
          <view v-for="doc in myDoctors" :key="doc.doctorId" class="doctor-row">
            <view class="doctor-row__avatar-wrap">
              <image v-if="doc.avatarUrl" class="doctor-row__avatar" :src="doc.avatarUrl" mode="aspectFill" />
              <view v-else class="doctor-row__avatar-placeholder">
                <text>医</text>
              </view>
            </view>
            <view class="doctor-row__info">
              <text class="doctor-row__name">{{ doc.doctorName || "服务医生" }}</text>
              <text v-if="doc.dept || doc.hospital" class="doctor-row__sub">
                {{ [doc.dept, doc.hospital].filter(Boolean).join(" · ") }}
              </text>
              <text v-if="doc.msgCount > 0" class="doctor-row__stat">共 {{ doc.msgCount }} 条问诊记录</text>
            </view>
            <view class="doctor-row__badge">已咨询</view>
          </view>
        </view>

        <view class="foot-note">
          <image class="foot-note__art" :src="hubAssets.shield" mode="aspectFit" />
          <text>完善档案，守护健康</text>
        </view>
      </template>

      <view class="view-actions">
        <AppButton class="view-actions__primary" label="更新档案" icon="action-update" block @tap="enterEdit" />
      </view>
    </template>

    <template v-else>
      <view class="wizard-head">
        <view class="wizard-head__row">
          <view v-if="editingExisting && auth.hasProfile" class="wizard-head__back pressable" @tap="cancelEdit">
            返回查看
          </view>
          <text class="wizard-head__badge">第 {{ editStep }} 步 / 共 {{ WIZARD_STEPS.length }} 步</text>
        </view>
        <view class="wizard-progress">
          <view
            v-for="(step, idx) in WIZARD_STEPS"
            :key="step.title"
            class="wizard-progress__seg"
            :class="{ 'is-done': editStep > idx + 1, 'is-active': editStep === idx + 1 }"
          />
        </view>
        <text class="wizard-head__title">{{ WIZARD_STEPS[editStep - 1].title }}</text>
        <text v-if="editStep === 1" class="wizard-head__hint">填写基本信息，用于建立您的健康档案</text>
        <text v-else-if="editStep === 2" class="wizard-head__hint">补充体征数据，便于计算 BMI 与年龄</text>
        <text v-else class="wizard-head__hint">完善健康信息，可按需上传门诊凭证</text>
      </view>

      <view class="wizard-card" :class="`wizard-card--step-${editStep}`">
        <view v-if="editStep === 1" class="wizard-profile">
          <view class="wizard-profile__avatar-wrap">
            <image class="wizard-profile__avatar" :src="avatarSrc" mode="aspectFill" />
            <button
              class="wizard-profile__avatar-btn"
              open-type="chooseAvatar"
              aria-role="button"
              aria-label="更换头像"
              @chooseavatar="onChooseAvatar"
            />
          </view>
          <view class="wizard-profile__copy">
            <text class="wizard-profile__name">{{ wizardDisplayName }}</text>
            <text class="wizard-profile__hint pressable" @tap.stop>点击头像可更换</text>
          </view>
        </view>

        <view v-if="editStep === 2" class="wizard-metrics">
          <text>{{ wizardMetricsText || "填写身高体重后自动计算 BMI" }}</text>
          <text v-if="wizardMetricsText" class="wizard-metrics__hint">由出生日期与身高体重自动计算</text>
        </view>

        <PatientForm
          v-if="config"
          ref="formRef"
          :key="formEpoch"
          :config="config"
          type="联络表"
          archive-mode="contact"
          hide-intro
          compact
          hide-submit
          hide-privacy
          :hide-consent="editStep !== 3"
          :fields-render-key="editStep"
          :visible-field-keys="editStep < 3 ? currentStepKeys : []"
          :accordion-sections="editStep === 3 ? HEALTH_ACCORDION : []"
          :trailing-field-keys="editStep === 3 ? ['outpatientVoucher'] : []"
          :checkbox-variant="editStep === 3 ? 'chip' : 'list'"
          :field-layout="editStep === 1 ? 'row' : 'stack'"
          :initial-values="initialValues || undefined"
          :navigate-back-on-success="false"
          :submit-label="editingExisting ? '保存更新' : '提交建档'"
          @submitted="onSubmitted"
        />
        <view v-else-if="store.loading" class="state-card">正在加载问卷…</view>
        <view v-else-if="store.error" class="state-card">
          <text>{{ store.error }}</text>
          <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="store.load" />
        </view>
        <view v-else class="state-card">
          <AppIcon name="record-edit" :size="34" />
          <text class="unavailable-title">档案服务暂不可用</text>
          <text>当前服务信息暂不可用，请稍后再试。</text>
        </view>
      </view>

      <view class="wizard-footer">
        <AppButton
          v-if="editStep > 1"
          class="wizard-footer__btn"
          label="上一步"
          variant="ghost"
          block
          :disabled="stepBusy"
          @tap.stop="prevWizardStep"
        />
        <AppButton
          v-if="editStep < WIZARD_STEPS.length"
          class="wizard-footer__btn"
          label="下一步"
          icon="nav-chevron-right"
          block
          :disabled="stepBusy"
          @tap.stop="nextWizardStep"
        />
        <AppButton
          v-else
          class="wizard-footer__btn"
          :label="editingExisting ? '保存更新' : '提交建档'"
          icon="action-confirm"
          block
          @tap.stop="submitWizard"
        />
      </view>
    </template>
  </view>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  padding: 12px 16px calc(120px + env(safe-area-inset-bottom));
  background: #f3f7f5;
  box-sizing: border-box;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  text-align: center;
}

.person-card,
.info-card,
.nav-card,
.doctor-card,
.empty-card,
.computed-card {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.05);
}

.person-card,
.nav-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.person-card__avatar,
.avatar-block__img {
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 50%;
  background: #eef7f3;
}

.person-card__copy,
.nav-card__copy {
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
  font-size: 18px;
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
  font-size: 13px;
}

.person-card__edit {
  padding: 6px 10px;
  border: 1px solid #cfe6dc;
  border-radius: 999px;
  color: #2f6b4f;
  font-size: 12px;
  font-weight: 700;
}

.tabs {
  display: flex;
  margin-bottom: 12px;
  border-bottom: 1px solid #e4ece8;
}

.tabs__item {
  flex: 1;
  padding: 10px 0 12px;
  color: #6a756f;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}

.tabs__item.is-on {
  color: #1f8a64;
  box-shadow: inset 0 -2px 0 #2aa876;
}

.overview {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.overview__card {
  flex: 1;
  padding: 12px 8px;
  border-radius: 14px;
  text-align: center;
}

.overview__card--blue { background: #e7f1ff; }
.overview__card--orange { background: #fff1e6; }
.overview__card--purple { background: #f3eaff; }

.overview__num {
  display: block;
  color: #17201c;
  font-size: 20px;
  font-weight: 800;
}

.overview__label {
  display: block;
  margin-top: 2px;
  color: #5f716b;
  font-size: 11px;
}

.info-card__title {
  display: block;
  margin-bottom: 8px;
  color: #17201c;
  font-size: 16px;
  font-weight: 800;
}

.summary-row {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #edf1ee;
}

.summary-row__label {
  flex: 0 0 108px;
  color: #6a756f;
  font-size: 14px;
}

.summary-row__value {
  flex: 1;
  color: #17201c;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-all;
}

.summary-empty,
.empty-card {
  color: #6a756f;
  font-size: 14px;
  line-height: 1.55;
}

.nav-card__icon {
  display: flex;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}

.nav-card__img {
  width: 30px;
  height: 30px;
}

.nav-card__title,
.nav-card__hint {
  display: block;
}

.nav-card__title {
  color: #17201c;
  font-size: 15px;
  font-weight: 800;
}

.nav-card__hint {
  margin-top: 2px;
  color: #6a756f;
  font-size: 12px;
}

.doctor-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.doctor-card__title {
  color: #17201c;
  font-size: 16px;
  font-weight: 800;
}

.doctor-card__count {
  color: #6a756f;
  font-size: 12px;
}

.doctor-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #edf1ee;
}

.doctor-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.doctor-row__avatar-wrap {
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: 50%;
  background: #ecf2ff;
}

.doctor-row__avatar,
.doctor-row__avatar-placeholder {
  width: 100%;
  height: 100%;
}

.doctor-row__avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5d87ff;
  font-weight: 700;
}

.doctor-row__info {
  min-width: 0;
  flex: 1;
}

.doctor-row__name {
  display: block;
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
}

.doctor-row__sub,
.doctor-row__stat {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: 12px;
}

.doctor-row__badge {
  color: #1f8a64;
  font-size: 12px;
  font-weight: 700;
}

.foot-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 8px 0 16px;
  color: #6a756f;
  font-size: 12px;
}

.foot-note__art {
  width: 64px;
  height: 64px;
}

.view-actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(243, 247, 245, 0), #f3f7f5 28%);
}

.edit-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #e4f6ee;
  color: #2f6b4f;
  font-size: 13px;
  line-height: 1.45;
}

.wizard-head {
  margin-bottom: 12px;
}

.wizard-head__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.wizard-head__back {
  color: #2f6b4f;
  font-size: 13px;
  font-weight: 700;
}

.wizard-head__badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #e4f6ee;
  color: #1f8a64;
  font-size: 12px;
  font-weight: 800;
}

.wizard-progress {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.wizard-progress__seg {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: #e4ece8;
  transition: background 0.2s ease;
}

.wizard-progress__seg.is-done,
.wizard-progress__seg.is-active {
  background: #2aa876;
}

.wizard-head__title {
  display: block;
  color: #17201c;
  font-size: 20px;
  font-weight: 800;
}

.wizard-head__hint {
  display: block;
  margin-top: 4px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.45;
}

.wizard-card {
  margin-bottom: 12px;
  padding: 14px 16px 10px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(16, 52, 40, 0.06);
}

.wizard-card :deep(.patient-form) {
  padding: 0;
}

.wizard-card :deep(.patient-form__fields) {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.wizard-profile {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef2f0;
}

.wizard-profile__avatar-wrap {
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
}

.wizard-profile__avatar {
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 2px solid #2aa876;
  border-radius: 50%;
  background: #eef7f3;
}

.wizard-profile__avatar-btn {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
}

.wizard-profile__avatar-btn::after {
  border: 0;
}

.wizard-profile__copy {
  min-width: 0;
  flex: 1;
}

.wizard-profile__name {
  display: block;
  color: #17201c;
  font-size: 18px;
  font-weight: 800;
}

.wizard-profile__hint {
  display: block;
  margin-top: 4px;
  color: #1f8a64;
  font-size: 12px;
  font-weight: 600;
}

.wizard-metrics {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #e8f7f0;
  color: #1f8a64;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.wizard-metrics__hint {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: 11px;
  font-weight: 400;
}

.wizard-card--step-2 :deep(.field__label) {
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}

.wizard-card--step-2 :deep(.field__control) {
  border-color: #dce8e2;
  background: #f8fbf9;
}

.wizard-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(243, 247, 245, 0), #f3f7f5 24%);
}

.wizard-footer__btn {
  flex: 1;
}

.edit-tip__icon {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}

.avatar-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 16px;
}

.avatar-block__wrap {
  position: relative;
  width: 72px;
  height: 72px;
}

.avatar-block__img {
  width: 72px;
  height: 72px;
  border: 2px solid #2aa876;
}

.avatar-block__camera {
  position: absolute;
  right: -2px;
  bottom: -2px;
  z-index: 1;
  width: 28px;
  height: 28px;
  pointer-events: none;
}

.avatar-block__btn {
  position: absolute;
  inset: 0;
  z-index: 2;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
}

.avatar-block__btn::after {
  border: 0;
}

.avatar-block__label {
  margin-top: 8px;
  color: #2f6b4f;
  font-size: 13px;
  font-weight: 700;
}

.computed-card__row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}

.computed-card__label {
  color: #6a756f;
  font-size: 14px;
}

.computed-card__value {
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}

.computed-card__tag {
  margin-left: 6px;
  color: #1f8a64;
  font-weight: 700;
}

.computed-card__hint {
  display: block;
  margin-top: 6px;
  color: #8a9691;
  font-size: 12px;
  line-height: 1.45;
}

.edit-toolbar {
  margin-bottom: 8px;
}

.unavailable-title {
  color: #17201c;
  font-size: 18px;
  font-weight: 700;
}
</style>
