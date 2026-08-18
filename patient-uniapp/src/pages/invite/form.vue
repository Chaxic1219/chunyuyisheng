<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import type { FormConfig } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import PatientForm from "../../components/PatientForm.vue";
import { fetchInviteMeta, saveLocalProfileFromPayload } from "../../api/patient";
import { buildInviteReturnUrl, getMpToken } from "../../api/auth";
import { allowsSmsVerification } from "../../api/config";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import { buildStorageScope, scopedStorageKey } from "../../utils/storageScope";

const store = useAppStore();
const auth = useAuthStore();
const inviteToken = ref("");
const inviteDoctorId = ref<number | null>(null);
const loadingMeta = ref(false);
const metaError = ref("");
const inviteMetaLoaded = ref(false);
const smsAvailable = ref(false);
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

const doctorName = computed(() => String(store.doctor?.name || "医生").trim() || "医生");
const doctorMetaLine = computed(() => {
  const hospital = String(store.doctor?.hospital || "").trim();
  const title = String(store.doctor?.title || "").trim();
  const name = doctorName.value;
  const docPart = title ? `${name} · ${title}` : name;
  return [hospital, docPart].filter(Boolean).join(" · ");
});

const introLines = computed(() => [
  "您所填信息只有医生可见，群内其他成员看不到，请放心填写。",
  `${doctorName.value}医生团队将根据您的健康状况，提供针对性的就医及康复指导，请务必填写准确信息。`,
]);

onLoad((query) => {
  const t = String(query?.t || query?.token || "").trim();
  if (t) inviteToken.value = t;
});

const config = computed<FormConfig | null>(() => {
  if (
    !store.doctor ||
    !inviteToken.value ||
    !inviteDoctorId.value ||
    String(store.doctor.id) !== String(inviteDoctorId.value)
  ) {
    return null;
  }
  return {
    title: "医患联络表",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true, err: "请填写姓名" },
      { key: "gender", label: "性别", type: "select", required: true, options: ["男", "女"], err: "请选择性别" },
      { key: "birthDate", label: "出生日期", type: "date", required: true, err: "请填写出生日期" },
      { key: "phone", label: "手机号", type: "tel", required: true, pattern: "^1[3-9]\\d{9}$", err: "请输入正确手机号" },
      { key: "disease", label: "您所患的疾病", type: "text", required: true, placeholder: "请填写所患疾病", err: "请填写所患疾病" },
      { key: "pregnancyStatus", label: "是否妊娠哺乳", type: "select", required: false, options: ["否", "备孕中", "怀孕中", "哺乳中"] },
      { key: "foodContactAllergies", label: "食物、接触物过敏", type: "checkboxGroup", required: false, options: ["无", "黄瓜", "化妆品", "芒果", "花粉", "牛奶", "油漆", "坚果", "动物皮毛", "海鲜", "其他"], noneValue: "无", otherValue: "其他" },
      { key: "drugAllergies", label: "药物过敏", type: "checkboxGroup", required: false, options: ["无", "普鲁卡因", "维生素B1", "青霉素", "破伤风抗毒素", "地卡因", "磺胺类药物", "泛影葡胺", "阿司匹林", "其他"], noneValue: "无", otherValue: "其他" },
      { key: "diseaseHistory", label: "疾病史", type: "checkboxGroup", required: false, options: ["无", "高血压", "过敏性疾病", "哮喘", "糖尿病", "白癜风", "心脏病", "癫痫", "其他"], noneValue: "无", otherValue: "其他" },
      {
        key: "outpatientVoucher", label: "门诊凭证（选填）", type: "file", required: false,
        accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        err: "请上传门诊凭证",
      },
    ],
    consent: "1",
  };
});

async function loadInviteMeta() {
  if (!inviteToken.value) return;
  loadingMeta.value = true;
  inviteMetaLoaded.value = false;
  inviteDoctorId.value = null;
  metaError.value = "";
  try {
    const meta = await fetchInviteMeta(inviteToken.value);
    const doctorId = Number(meta.doctorId);
    if (!Number.isSafeInteger(doctorId) || doctorId <= 0) {
      throw new Error("邀请医生不可用");
    }
    await store.load(true, doctorId);
    if (String(store.doctor?.id || "") !== String(doctorId)) {
      throw new Error("邀请医生不可用");
    }
    store.rememberDoctorId(doctorId);
    inviteDoctorId.value = doctorId;
    smsAvailable.value = meta.smsAvailable === true;
    inviteMetaLoaded.value = true;
    if (!allowsSmsVerification(smsAvailable.value)) {
      void ensureLogin(buildInviteReturnUrl(inviteToken.value));
    }
  } catch (e: any) {
    metaError.value = e?.message || "邀请链接无效或已过期";
  } finally {
    loadingMeta.value = false;
  }
}

onShow(() => {
  if (inviteMetaLoaded.value && !allowsSmsVerification(smsAvailable.value)) {
    void ensureLogin(buildInviteReturnUrl(inviteToken.value));
  }
});

onMounted(async () => {
  await loadInviteMeta();
});

function onSubmitted(payload: Record<string, string>) {
  saveLocalProfileFromPayload(payload, profileCacheKey.value);
  void auth.refreshMe().catch(() => {});
  uni.redirectTo({ url: "/pages/invite/success" });
}

function reloadInviteForm() {
  void loadInviteMeta();
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom invite-page" :class="{ elder: store.elderMode }">
    <template v-if="config && inviteToken && !metaError">
      <view class="invite-hero">
        <text class="invite-kicker">春雨医服</text>
        <text class="invite-title">医患联络表</text>
        <text v-for="(line, i) in introLines" :key="i" class="invite-lead">{{ line }}</text>
        <text v-if="doctorMetaLine" class="invite-doc">{{ doctorMetaLine }}</text>
      </view>
      <view class="invite-soft">
        <AppIcon name="account-security" :size="20" tone="primary" />
        <text>请填写真实信息。手机号仅做格式校验，无需短信验证码；若发现同号档案，将请您确认是否合并。</text>
      </view>
      <PatientForm
        :config="config"
        type="邀请建档"
        archive-mode="invite"
        :invite-token="inviteToken"
        :doctor-id="inviteDoctorId"
        :sms-available="smsAvailable"
        hide-intro
        submit-label="提交联络表"
        @submitted="onSubmitted"
      />
    </template>
    <view v-else-if="!inviteToken" class="state-card form-state">
      <AppIcon name="record-edit" :size="34" />
      <text class="unavailable-title">缺少邀请令牌</text>
      <text>请使用完整邀请链接打开，或向医助索取建档链接。</text>
    </view>
    <view v-else-if="loadingMeta || store.loading" class="state-card form-state">正在加载建档问卷…</view>
    <view v-else-if="metaError || store.error" class="state-card form-state">
      <text>{{ metaError || store.error }}</text>
      <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="reloadInviteForm" />
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="record-edit" :size="34" />
      <text class="unavailable-title">建档服务暂不可用</text>
    </view>
  </view>
</template>

<style scoped>
.invite-page { padding-top: 12px; }
.invite-hero {
  margin: 0 16px 12px;
  padding: 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 61, 46, 0.06);
}
.invite-kicker {
  display: block;
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
}
.invite-title {
  display: block;
  margin-top: 6px;
  color: #17201c;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.35;
}
.invite-lead {
  display: block;
  margin-top: 10px;
  color: #5f6b64;
  font-size: 15px;
  line-height: 1.65;
}
.invite-doc {
  display: block;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #eef2ef;
  color: #176b52;
  font-size: 13px;
  font-weight: 500;
}
.invite-soft {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 16px 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #e8f5ee;
  color: #44524b;
  font-size: 14px;
  line-height: 1.55;
}
.form-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 16px;
  text-align: center;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
}
.unavailable-title {
  color: var(--text-strong, #2a3547);
  font-size: var(--font-body, 18px);
  font-weight: 600;
}
</style>
