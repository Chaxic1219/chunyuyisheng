<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { FormConfig, FormField, SubmitPayload } from "@chunyu/patient-design/types";
import { fetchPatientSession, sendSmsCode, submitForm, submitInviteForm, uploadVoucher } from "../api/patient";
import { mpChunyuGreenChannel, openChunyuJump } from "../api/chunyuOpen";
import { ApiError, buildInviteReturnUrl, getMpToken } from "../api/auth";
import { allowsSmsVerification } from "../api/config";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";
import { ensureLogin } from "../utils/ensureLogin";
import AppIcon from "./AppIcon.vue";

export type FormInitialValue = string | { values: string[]; other?: string };

const props = withDefaults(
  defineProps<{
    config: FormConfig;
    type: string;
    /** contact=医患联络表（短信验证）；invite=邀请建档（无短信，同号合并确认） */
    archiveMode?: "contact" | "invite";
    inviteToken?: string;
    doctorId?: string | number | null;
    smsAvailable?: boolean;
    /** 服务端档案预填（绑手机后自动带入） */
    initialValues?: Record<string, FormInitialValue>;
    /** 提交成功后是否 navigateBack（档案页内切查看态时关） */
    navigateBackOnSuccess?: boolean;
    /** 隐藏顶部默认 intro，由页面自定义头图 */
    hideIntro?: boolean;
    /** 提交按钮文案（默认「提交申请」） */
    submitLabel?: string;
  }>(),
  {
    archiveMode: "contact",
    smsAvailable: false,
    hideIntro: false,
    submitLabel: "提交申请",
  }
);
const emit = defineEmits<{ (e: "submitted", payload: Record<string, string>): void }>();
const store = useAppStore();
const auth = useAuthStore();
const form = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const checkboxValues = reactive<Record<string, string[]>>({});
const checkboxOthers = reactive<Record<string, string>>({});
const voucherNames = reactive<Record<string, string>>({});
const uploading = reactive<Record<string, boolean>>({});
const agreed = ref(false);
const smsCode = ref("");
const smsCooldown = ref(0);
const sendingSms = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const submitError = ref("");
const verificationProof = ref("");
const webSessionPhoneBound = ref(false);
const sessionSmsAvailable = ref(false);
const prefillApplied = ref(false);
let successTimer: ReturnType<typeof setTimeout> | undefined;
let smsCooldownTimer: ReturnType<typeof setInterval> | undefined;

const smsAvailable = computed(() =>
  allowsSmsVerification(
    props.archiveMode === "invite"
      ? props.smsAvailable === true
      : sessionSmsAvailable.value === true
  )
);
const effectiveDoctorId = computed<string | number | null>(() => {
  if (props.archiveMode === "invite") {
    return props.doctorId == null || props.doctorId === ""
      ? null
      : props.doctorId;
  }
  return store.doctor?.id || null;
});

const needsSmsVerification = computed(
  () => smsAvailable.value && !auth.phoneBound && !webSessionPhoneBound.value
);
const phoneFieldLocked = computed(
  () => props.archiveMode === "contact" && auth.phoneBound
);
const sessionPhoneHint = computed(() => {
  if (props.archiveMode !== "contact") return "";
  if (auth.phoneBound) return "手机号已与微信账号绑定，无需修改。";
  if (webSessionPhoneBound.value) return "您在本浏览器已验证过手机号，无需再次输入验证码。";
  return "";
});

function isPhoneField(field: FormField) {
  return field.key === "phone" || field.type === "phone" || field.type === "tel";
}

function isFieldReadonly(field: FormField) {
  return phoneFieldLocked.value && isPhoneField(field);
}

function syncBoundPhone() {
  if (!phoneFieldLocked.value) return;
  const fromInitial = String(
    props.initialValues?.phone || props.initialValues?.["手机号"] || ""
  ).trim();
  if (fromInitial) {
    form.phone = fromInitial;
    return;
  }
  if (form.phone && validPhone(form.phone)) return;
}

onMounted(async () => {
  syncBoundPhone();
  if (props.archiveMode !== "contact" || !effectiveDoctorId.value) return;
  try {
    const sess = await fetchPatientSession(effectiveDoctorId.value);
    webSessionPhoneBound.value = !!sess.phoneBound;
    sessionSmsAvailable.value = sess.smsAvailable === true;
  } catch {
    webSessionPhoneBound.value = false;
    sessionSmsAvailable.value = false;
  }
});

watch(
  () => [auth.phoneBound, props.initialValues] as const,
  () => syncBoundPhone(),
  { deep: true, immediate: true }
);

watch(
  () => props.config,
  (config) => {
    config.fields.forEach((field) => {
      if (form[field.key] === undefined) form[field.key] = "";
      if (field.type === "checkboxGroup") {
        if (!checkboxValues[field.key]) checkboxValues[field.key] = [];
        if (checkboxOthers[field.key] === undefined) checkboxOthers[field.key] = "";
      }
    });
  },
  { immediate: true }
);

function applyInitialValues(values?: Record<string, FormInitialValue>) {
  if (!values || !props.config?.fields?.length || prefillApplied.value) return;
  let appliedAny = false;
  for (const field of props.config.fields) {
    const raw = values[field.key];
    if (raw == null || raw === "") continue;
    if (field.type === "checkboxGroup") {
      const obj =
        typeof raw === "object" && raw && !Array.isArray(raw)
          ? (raw as { values?: string[]; other?: string })
          : (() => {
              try {
                return JSON.parse(String(raw)) as { values?: string[]; other?: string };
              } catch {
                return { values: [], other: "" };
              }
            })();
      const vals = Array.isArray(obj.values) ? obj.values.map(String) : [];
      if (!vals.length && !(obj.other || "").trim()) continue;
      checkboxValues[field.key] = vals;
      checkboxOthers[field.key] = String(obj.other || "");
      syncCheckboxForm(field);
      appliedAny = true;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (!text.trim()) continue;
    /* 已有用户输入时不覆盖 */
    if (form[field.key] && String(form[field.key]).trim()) continue;
    form[field.key] = text;
    appliedAny = true;
  }
  if (appliedAny) prefillApplied.value = true;
}

watch(
  () => [props.initialValues, props.config] as const,
  () => applyInitialValues(props.initialValues),
  { immediate: true, deep: true }
);

function validPhone(phone: string) {
  return /^1\d{10}$/.test(phone.trim());
}

function clearError(key: string) {
  if (errors[key]) errors[key] = "";
  submitError.value = "";
}

function noneValueOf(field: FormField) {
  return field.noneValue != null ? String(field.noneValue) : "无";
}

function otherValueOf(field: FormField) {
  return field.otherValue != null ? String(field.otherValue) : "其他";
}

function syncCheckboxForm(field: FormField) {
  const values = checkboxValues[field.key] || [];
  const otherVal = otherValueOf(field);
  const other = values.includes(otherVal) ? (checkboxOthers[field.key] || "").trim() : "";
  form[field.key] = JSON.stringify({ values, other });
}

function isCheckboxChecked(key: string, opt: string) {
  return (checkboxValues[key] || []).includes(opt);
}

function showCheckboxOther(field: FormField) {
  return (checkboxValues[field.key] || []).includes(otherValueOf(field));
}

function onPick(key: string, options: string[], event: { detail: { value: number } }) {
  form[key] = options[event.detail.value] || "";
  clearError(key);
}

function onDatePick(key: string, event: { detail: { value: string } }) {
  form[key] = event.detail.value || "";
  clearError(key);
}

function openAgreement(kind: "user" | "privacy") {
  uni.navigateTo({
    url: `/pages/services/agreements?type=${kind}`,
    fail: () => uni.showToast({ title: "协议页暂不可用", icon: "none" }),
  });
}

function onConsentChange(event: { detail: { value: string[] } }) {
  agreed.value = event.detail.value.includes("agreed");
  clearError("consent");
}

function onCheckboxGroupChange(field: FormField, event: { detail: { value: string[] } }) {
  const noneVal = noneValueOf(field);
  const otherVal = otherValueOf(field);
  let values = [...(event.detail.value || [])];
  const prev = checkboxValues[field.key] || [];
  const newlyAdded = values.filter((v) => !prev.includes(v));

  if (newlyAdded.includes(noneVal)) {
    values = [noneVal];
  } else if (values.includes(noneVal) && values.length > 1) {
    values = values.filter((v) => v !== noneVal);
  }

  checkboxValues[field.key] = values;
  if (!values.includes(otherVal)) checkboxOthers[field.key] = "";
  syncCheckboxForm(field);
  clearError(field.key);
}

function onCheckboxOtherInput(field: FormField, event: unknown) {
  const detail = (event as { detail?: { value?: string } })?.detail;
  const value = detail?.value != null ? String(detail.value) : "";
  checkboxOthers[field.key] = value;
  syncCheckboxForm(field);
  clearError(field.key);
}

function mimeFromPath(filePath: string, fallback = "image/jpeg") {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return fallback;
}

function fileToDataUrl(filePath: string, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fs = uni.getFileSystemManager();
    fs.readFile({
      filePath,
      encoding: "base64",
      success: (res) => resolve(`data:${mime};base64,${res.data}`),
      fail: reject,
    });
  });
}

const VOUCHER_MAX_BYTES = 4 * 1024 * 1024;

function fileSizeBeforeRead(
  filePath: string,
  reportedSize?: number
): Promise<number> {
  if (Number.isFinite(reportedSize) && Number(reportedSize) >= 0) {
    return Promise.resolve(Number(reportedSize));
  }
  return new Promise((resolve, reject) => {
    const uniAny = uni as typeof uni & {
      getFileInfo?: (options: {
        filePath: string;
        success: (result: { size?: number }) => void;
        fail: (error: unknown) => void;
      }) => void;
    };
    const acceptSize = (size: unknown) => {
      const parsed = Number(size);
      if (Number.isFinite(parsed) && parsed >= 0) resolve(parsed);
      else reject(new Error("file_size_unavailable"));
    };
    const statFallback = () => {
      try {
        const fs = uni.getFileSystemManager() as ReturnType<typeof uni.getFileSystemManager> & {
          stat?: (options: {
            path: string;
            success: (result: { stats?: { size?: number } }) => void;
            fail: (error: unknown) => void;
          }) => void;
        };
        if (typeof fs.stat !== "function") {
          reject(new Error("file_size_unavailable"));
          return;
        }
        fs.stat({
          path: filePath,
          success: (result) => {
            const stats = result.stats as
              | { size?: number }
              | { size?: number }[];
            acceptSize(Array.isArray(stats) ? stats[0]?.size : stats?.size);
          },
          fail: reject,
        });
      } catch (error) {
        reject(error);
      }
    };
    if (typeof uniAny.getFileInfo !== "function") {
      statFallback();
      return;
    }
    uniAny.getFileInfo({
      filePath,
      success: (result) => acceptSize(result.size),
      fail: statFallback,
    });
  });
}

function formReturnUrl(): string {
  if (props.archiveMode === "invite") {
    return buildInviteReturnUrl(props.inviteToken);
  }
  const route = String(getCurrentPages().at(-1)?.route || "");
  return /^pages\/[a-z0-9_/-]+$/i.test(route)
    ? `/${route}`
    : "/pages/archive/profile";
}

async function uploadLocalFile(
  field: FormField,
  filePath: string,
  name: string,
  mimeHint?: string,
  reportedSize?: number
) {
  const doctorId = effectiveDoctorId.value;
  if (!doctorId) {
    uni.showToast({ title: "服务信息尚未加载", icon: "none" });
    return;
  }
  const mime = mimeHint || mimeFromPath(filePath);
  const accept = field.accept || ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const okType = accept.some((a) => a === mime || (a.startsWith("image/") && mime.startsWith("image/")));
  if (!okType && !/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(mime)) {
    uni.showToast({ title: "仅支持 JPG/PNG/WebP/PDF", icon: "none" });
    return;
  }

  uploading[field.key] = true;
  try {
    let fileSize: number;
    try {
      fileSize = await fileSizeBeforeRead(filePath, reportedSize);
    } catch {
      uni.showToast({ title: "无法确认文件大小，请重新选择", icon: "none" });
      return;
    }
    if (fileSize > VOUCHER_MAX_BYTES) {
      uni.showToast({ title: "文件过大（需 ≤4MB）", icon: "none" });
      return;
    }
    const returnUrl = formReturnUrl();
    if (!(await ensureLogin(returnUrl))) return;
    const dataUrl = await fileToDataUrl(filePath, mime);
    const b64 = dataUrl.split(",")[1] || "";
    if (Math.floor((b64.length * 3) / 4) > VOUCHER_MAX_BYTES) {
      uni.showToast({ title: "文件过大（需 ≤4MB）", icon: "none" });
      return;
    }
    const result = await uploadVoucher(
      String(doctorId),
      dataUrl,
      () => ensureLogin(returnUrl)
    );
    form[field.key] = result.url;
    voucherNames[field.key] = name || "凭证";
    clearError(field.key);
    uni.showToast({ title: "上传成功", icon: "success" });
  } catch (error) {
    const title =
      error instanceof ApiError && (error.status === 403 || error.status === 429)
        ? error.message
        : "上传失败，请重试";
    uni.showToast({ title, icon: "none" });
  } finally {
    uploading[field.key] = false;
  }
}

function pickImage(field: FormField) {
  uni.chooseImage({
    count: 1,
    sizeType: ["compressed"],
    sourceType: ["album", "camera"],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0];
      if (!path) return;
      const name = path.split(/[/\\]/).pop() || "image.jpg";
      const tempFiles = Array.isArray(res.tempFiles)
        ? res.tempFiles
        : res.tempFiles
          ? [res.tempFiles]
          : [];
      const size = (tempFiles[0] as { size?: number } | undefined)?.size;
      void uploadLocalFile(
        field,
        path,
        name,
        mimeFromPath(path, "image/jpeg"),
        size
      );
    },
  });
}

function pickPdf(field: FormField) {
  // 微信小程序等端支持 chooseMessageFile；H5 可能无此 API
  const uniAny = uni as typeof uni & {
    chooseMessageFile?: (opts: Record<string, unknown>) => void;
  };
  if (typeof uniAny.chooseMessageFile !== "function") {
    uni.showToast({ title: "当前端不支持选择 PDF，请上传图片", icon: "none" });
    return;
  }

  uniAny.chooseMessageFile({
    count: 1,
    type: "file",
    extension: ["pdf"],
    success: (res: { tempFiles?: { path: string; name?: string; size?: number }[] }) => {
      const file = (res.tempFiles || [])[0];
      if (!file?.path) return;
      void uploadLocalFile(
        field,
        file.path,
        file.name || "凭证.pdf",
        "application/pdf",
        file.size
      );
    },
    fail: () => {
      uni.showToast({ title: "未选择文件", icon: "none" });
    },
  });
}

function onUploadTap(field: FormField) {
  if (uploading[field.key] || submitting.value || submitted.value) return;
  const accept = field.accept || ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const allowPdf = accept.some((a) => /pdf/i.test(a));
  const itemList = allowPdf ? ["选择图片", "选择 PDF"] : ["选择图片"];

  uni.showActionSheet({
    itemList,
    success: (res) => {
      if (res.tapIndex === 0) pickImage(field);
      else if (res.tapIndex === 1 && allowPdf) pickPdf(field);
    },
  });
}

function formPhone() {
  return (form.phone || "").trim();
}

function isGreenChannelType(type: string) {
  return type === "加号" || type.includes("住院");
}

async function maybeOpenGreenChannel(result: { chunyu?: { h5Url?: string; kind?: string } }) {
  if (!isGreenChannelType(props.type) || props.navigateBackOnSuccess) return;
  try {
    if (getMpToken()) {
      const jump = await mpChunyuGreenChannel({
        serviceType: props.type.includes("住院") ? "住院" : "加号",
        desc: `${props.type}意向`,
      });
      if (jump.h5Url || jump.wxPath) {
        openChunyuJump(jump);
        return;
      }
    }
  } catch {
    /* 登录态绿通失败时回落到提交接口带回的签名链接 */
  }
  if (result.chunyu?.h5Url) {
    openChunyuJump({
      ok: true,
      kind: result.chunyu.kind || "expert",
      h5Url: result.chunyu.h5Url,
    });
  }
}

function startSmsCooldown(sec = 60) {
  smsCooldown.value = sec;
  if (smsCooldownTimer) clearInterval(smsCooldownTimer);
  smsCooldownTimer = setInterval(() => {
    smsCooldown.value -= 1;
    if (smsCooldown.value <= 0 && smsCooldownTimer) {
      clearInterval(smsCooldownTimer);
      smsCooldownTimer = undefined;
    }
  }, 1000);
}

async function onSendSms() {
  if (!smsAvailable.value) {
    uni.showToast({ title: "短信验证当前不可用，请使用微信绑定手机号", icon: "none" });
    return;
  }
  const phone = formPhone();
  if (!validPhone(phone)) {
    errors.phone = "请输入正确的 11 位手机号";
    uni.showToast({ title: errors.phone, icon: "none" });
    return;
  }
  if (smsCooldown.value > 0 || sendingSms.value || submitting.value) return;
  sendingSms.value = true;
  try {
    await sendSmsCode(phone, effectiveDoctorId.value || undefined);
    uni.showToast({ title: "验证码已发送", icon: "none" });
    startSmsCooldown(60);
  } catch (error) {
    uni.showToast({
      title: error instanceof ApiError ? error.message : "发送失败，请稍后重试",
      icon: "none",
    });
  } finally {
    sendingSms.value = false;
  }
}

function readCheckboxGroup(field: FormField) {
  const values = checkboxValues[field.key] || [];
  const otherVal = otherValueOf(field);
  const other = values.includes(otherVal) ? (checkboxOthers[field.key] || "").trim() : "";
  return { values, other };
}

function validate() {
  Object.keys(errors).forEach((key) => {
    errors[key] = "";
  });

  let firstError = "";
  for (const field of props.config.fields) {
    if (field.type === "checkboxGroup") {
      const group = readCheckboxGroup(field);
      syncCheckboxForm(field);
      if (field.required && !group.values.length) {
        errors[field.key] = field.err || `请选择${field.label}`;
      } else if (group.values.includes(otherValueOf(field)) && !group.other) {
        errors[field.key] = "请填写「其他」说明";
      }
    } else if (field.type === "file" || field.key === "outpatientVoucher") {
      const url = (form[field.key] || "").trim();
      if (field.required && !url) {
        errors[field.key] = field.err || `请上传${field.label}`;
      }
    } else {
      const value = (form[field.key] || "").trim();
      if (field.required && !value) {
        errors[field.key] = field.err || `请填写${field.label}`;
      } else if ((field.type === "phone" || field.type === "tel") && value && !validPhone(value)) {
        errors[field.key] = field.err || "请输入正确的 11 位手机号";
      } else if (value && field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            errors[field.key] = field.err || `请正确填写${field.label}`;
          }
        } catch {
          /* ignore invalid pattern */
        }
      }
    }
    if (!firstError && errors[field.key]) firstError = errors[field.key];
  }

  if (props.config.consent && !agreed.value) {
    errors.consent = "请阅读并勾选同意说明";
    if (!firstError) firstError = errors.consent;
  }

  if (needsSmsVerification.value) {
    if (!smsCode.value.trim()) {
      errors.smsCode = "请输入短信验证码";
      if (!firstError) firstError = errors.smsCode;
    }
  }

  if (firstError) {
    uni.showToast({ title: firstError, icon: "none" });
    return false;
  }
  return true;
}

function buildPayload() {
  const payload: Record<string, string> = {};
  let outpatientVoucherUrl = "";

  for (const field of props.config.fields) {
    if (field.type === "checkboxGroup") {
      const json = JSON.stringify(readCheckboxGroup(field));
      payload[field.key] = json;
      payload[field.label] = json;
    } else if (field.type === "file" || field.key === "outpatientVoucher") {
      const url = (form[field.key] || "").trim();
      payload[field.key] = url;
      payload[field.label] = url;
      if (field.key === "outpatientVoucher" || field.label === "请上传门诊凭证") {
        outpatientVoucherUrl = url;
      }
    } else {
      const value = (form[field.key] || "").trim();
      payload[field.key] = value;
      payload[field.label] = value;
    }
  }

  return { payload, outpatientVoucherUrl };
}

async function submitInvite(extra?: { confirmMergePatientId?: number; forceCreate?: boolean }) {
  if (!props.inviteToken) {
    submitError.value = "邀请链接无效";
    uni.showToast({ title: submitError.value, icon: "none" });
    return;
  }
  const doctorId = effectiveDoctorId.value;
  if (!doctorId) {
    verificationProof.value = "";
    submitError.value = "邀请医生不可用，请重新打开邀请链接";
    uni.showToast({ title: submitError.value, icon: "none" });
    return;
  }
  const proofForRequest = extra ? verificationProof.value : "";
  verificationProof.value = "";
  submitting.value = true;
  submitError.value = "";
  try {
    const { payload, outpatientVoucherUrl } = buildPayload();
    const phone = formPhone();
    const result = await submitInviteForm(props.inviteToken, {
      doctorId,
      phone,
      consent: true,
      payload,
      outpatientVoucherUrl: outpatientVoucherUrl || undefined,
      ...(needsSmsVerification.value ? { smsCode: smsCode.value.trim() } : {}),
      ...(proofForRequest ? { verificationProof: proofForRequest } : {}),
      ...extra,
    });
    if (result.needsMergeConfirm && result.candidates?.length) {
      verificationProof.value = result.verificationProof || "";
      submitting.value = false;
      const c = result.candidates[0];
      const hint = `${c.displayNameMasked} · ${c.phoneMasked}${c.nameHint ? "（姓名一致）" : ""}`;
      uni.showModal({
        title: "发现同号档案",
        content: `系统中已有同手机号档案：${hint}。是否并入已有档案？`,
        confirmText: "并入已有",
        cancelText: "新建档案",
        success: (res) => {
          if (res.confirm) {
            void submitInvite({ confirmMergePatientId: c.id });
          } else if (res.cancel) {
            void submitInvite({ forceCreate: true });
          } else {
            verificationProof.value = "";
          }
        },
        fail: () => {
          verificationProof.value = "";
        },
      });
      return;
    }
    if (!result.ok) {
      submitError.value = result.message || "提交失败，请稍后重试";
      uni.showToast({ title: submitError.value, icon: "none" });
      return;
    }
    submitted.value = true;
    emit("submitted", payload);
    uni.showToast({ title: result.message, icon: "success", duration: 1600 });
    if (props.navigateBackOnSuccess) {
      if (successTimer) clearTimeout(successTimer);
      successTimer = setTimeout(() => uni.navigateBack(), 1600);
    }
  } catch (error) {
    verificationProof.value = "";
    if (error instanceof ApiError && error.code === "phone_verification_required") {
      if (!smsAvailable.value) {
        const returnUrl = formReturnUrl();
        const bindUrl = `/pages/auth/bind?returnUrl=${encodeURIComponent(returnUrl)}`;
        uni.redirectTo({
          url: bindUrl,
          fail: () => uni.navigateTo({ url: bindUrl }),
        });
        return;
      }
      submitError.value = "请先获取并填写短信验证码";
    } else if (error instanceof ApiError && error.code === "phone_mismatch") {
      submitError.value = "填写的手机号必须与当前已验证账号一致";
    } else if (error instanceof ApiError) {
      submitError.value = error.message;
    } else {
      submitError.value = "提交失败，请检查网络后重试";
    }
    uni.showToast({ title: submitError.value, icon: "none" });
  } finally {
    if (!submitted.value) submitting.value = false;
  }
}

async function onSubmit() {
  if (submitting.value || submitted.value || !validate()) return;
  if (!effectiveDoctorId.value) {
    submitError.value = "服务信息尚未加载，请稍后重试";
    return;
  }

  submitting.value = true;
  submitError.value = "";
  try {
    if (props.archiveMode === "invite") {
      await submitInvite();
      return;
    }
    const { payload, outpatientVoucherUrl } = buildPayload();
    const phone = formPhone();
    const submitExtra: Partial<SubmitPayload> = {};
    if (props.archiveMode === "contact") {
      submitExtra.phone = phone;
      submitExtra.consent = true;
      if (needsSmsVerification.value) {
        submitExtra.code = smsCode.value.trim();
      }
    }
    const result = await submitForm({
      doctorId: String(effectiveDoctorId.value),
      type: props.type,
      payload,
      ...(outpatientVoucherUrl ? { outpatientVoucherUrl } : {}),
      ...submitExtra,
    });
    if (!result.ok) {
      submitError.value = result.message || "提交失败，请稍后重试";
      uni.showToast({ title: submitError.value, icon: "none" });
      return;
    }
    submitted.value = true;
    emit("submitted", payload);
    uni.showToast({ title: result.message, icon: "success", duration: 1600 });
    void maybeOpenGreenChannel(result);
    if (props.navigateBackOnSuccess) {
      if (successTimer) clearTimeout(successTimer);
      successTimer = setTimeout(() => uni.navigateBack(), 1600);
    }
  } catch (error) {
    submitError.value = "提交失败，请检查网络后重试";
    uni.showToast({ title: submitError.value, icon: "none" });
    console.error(error);
  } finally {
    if (!submitted.value) submitting.value = false;
  }
}

onUnmounted(() => {
  verificationProof.value = "";
  if (successTimer) clearTimeout(successTimer);
  if (smsCooldownTimer) clearInterval(smsCooldownTimer);
});
</script>

<template>
  <view class="patient-form">
    <view v-if="!hideIntro" class="patient-form__intro cu-card radius shadow">
      <view class="patient-form__intro-icon bg-blue light radius">
        <AppIcon name="record-edit" :size="29" />
      </view>
      <view class="patient-form__intro-copy">
        <text class="patient-form__eyebrow">春雨医患通服务申请</text>
        <text class="patient-form__title">{{ config.title }}</text>
        <text v-if="config.notes" class="patient-form__notes">{{ config.notes }}</text>
      </view>
    </view>

    <view class="patient-form__fields cu-list menu card-menu">
      <view v-for="field in config.fields" :key="field.key" class="field cu-form-group align-start">
        <text class="field__label title">
          {{ field.label }}
          <text v-if="field.required" class="field__required">*</text>
        </text>

        <picker
          v-if="field.type === 'select'"
          :range="field.options || []"
          @change="onPick(field.key, field.options || [], $event)"
        >
          <view class="field__control field__picker radius" :class="{ 'field__control--error': errors[field.key] }">
            <text :class="{ 'field__placeholder': !form[field.key] }">{{ form[field.key] || "请选择" }}</text>
            <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
          </view>
        </picker>

        <picker
          v-else-if="field.type === 'date'"
          mode="date"
          :value="form[field.key] || ''"
          @change="onDatePick(field.key, $event)"
        >
          <view class="field__control field__picker radius" :class="{ 'field__control--error': errors[field.key] }">
            <text :class="{ 'field__placeholder': !form[field.key] }">{{ form[field.key] || "请选择日期" }}</text>
            <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
          </view>
        </picker>

        <view v-else-if="field.type === 'checkboxGroup'" class="field__checkbox-wrap">
          <checkbox-group
            :key="`${field.key}-${(checkboxValues[field.key] || []).join('|')}`"
            class="field__checkbox-group"
            @change="onCheckboxGroupChange(field, $event)"
          >
            <label
              v-for="opt in field.options || []"
              :key="opt"
              class="field__check-item cu-tag radius"
            >
              <checkbox
                :value="opt"
                :checked="isCheckboxChecked(field.key, opt)"
                color="#456FD8"
              />
              <text>{{ opt }}</text>
            </label>
          </checkbox-group>
          <input
            v-if="showCheckboxOther(field)"
            class="field__control field__other radius"
            :class="{ 'field__control--error': errors[field.key] }"
            :value="checkboxOthers[field.key] || ''"
            placeholder="请说明其他项"
            @input="onCheckboxOtherInput(field, $event)"
          />
        </view>

        <view
          v-else-if="field.type === 'file' || field.key === 'outpatientVoucher'"
          class="field__upload radius bg-blue light"
          :class="{
            'field__control--error': errors[field.key],
            'field__upload--filled': !!form[field.key],
            'field__upload--busy': uploading[field.key],
          }"
          @click="onUploadTap(field)"
        >
          <AppIcon
            :name="form[field.key] ? 'status-success' : 'upload-record'"
            :size="18"
            tone="primary"
            :state="uploading[field.key] ? 'loading' : 'idle'"
          />
          <text v-if="uploading[field.key]">上传中…</text>
          <text v-else-if="form[field.key]">✓ 已上传 {{ voucherNames[field.key] || "凭证" }}</text>
          <text v-else>＋ 点击上传（图片或 PDF，≤4MB）</text>
        </view>

        <textarea
          v-else-if="field.type === 'textarea'"
          v-model="form[field.key]"
          class="field__control field__textarea radius"
          :class="{ 'field__control--error': errors[field.key] }"
          :placeholder="field.placeholder || `请输入${field.label}`"
          :maxlength="500"
          @input="clearError(field.key)"
        />

        <view
          v-else-if="isFieldReadonly(field)"
          class="field__control field__control--readonly radius"
        >
          <text>{{ form[field.key] || "—" }}</text>
        </view>

        <input
          v-else
          v-model="form[field.key]"
          class="field__control radius"
          :class="{ 'field__control--error': errors[field.key] }"
          :type="field.type === 'phone' || field.type === 'tel' ? 'number' : 'text'"
          :placeholder="field.placeholder || `请输入${field.label}`"
          @input="clearError(field.key)"
        />

        <text v-if="errors[field.key]" class="field-error">{{ errors[field.key] }}</text>
      </view>
    </view>

    <view v-if="sessionPhoneHint" class="field field--session-hint cu-form-group">
      <text class="field__hint">{{ sessionPhoneHint }}</text>
    </view>

    <view v-if="needsSmsVerification" class="field field--sms cu-form-group align-start">
      <text class="field__label title">
        短信验证码
        <text class="field__required">*</text>
      </text>
      <view class="field__sms-row">
        <input
          v-model="smsCode"
          class="field__control field__sms-input radius"
          :class="{ 'field__control--error': errors.smsCode }"
          type="number"
          maxlength="6"
          placeholder="请输入验证码"
          @input="clearError('smsCode')"
        />
        <button
          class="field__sms-btn cu-btn round bg-green light pressable"
          :disabled="smsCooldown > 0 || sendingSms || submitting"
          @click="onSendSms"
        >
          <AppIcon name="verification-code" :size="16" tone="primary" />
          <text>{{ smsCooldown > 0 ? smsCooldown + "s" : "获取验证码" }}</text>
        </button>
      </view>
      <text class="field__hint">
        手机号需短信验证后方可建档，验证码 5 分钟内有效。
      </text>
      <text v-if="errors.smsCode" class="field-error">{{ errors.smsCode }}</text>
    </view>

    <checkbox-group
      v-if="config.consent"
      class="patient-form__consent cu-form-group radius pressable"
      :class="{ 'patient-form__consent--error': errors.consent }"
      @change="onConsentChange"
    >
      <label class="patient-form__consent-label">
        <checkbox value="agreed" :checked="agreed" color="#456FD8" />
        <view class="patient-form__consent-copy">
          <text class="patient-form__consent-text">我已阅读并同意</text>
          <text class="patient-form__consent-link pressable" @click.stop="openAgreement('user')">《用户协议》</text>
          <text class="patient-form__consent-text">和</text>
          <text class="patient-form__consent-link pressable" @click.stop="openAgreement('privacy')">《隐私政策》</text>
          <text class="patient-form__consent-text">，并同意为建立档案与后续服务处理姓名、手机号、疾病及病历等信息</text>
          <text v-if="errors.consent" class="field-error">{{ errors.consent }}</text>
        </view>
      </label>
    </checkbox-group>

    <view v-if="submitError" class="patient-form__submit-error bg-red light radius">
      <AppIcon name="status-error" :size="24" tone="danger" />
      <text>{{ submitError }}</text>
    </view>

    <button
      class="patient-form__submit cu-btn round bg-green shadow pressable"
      :class="{ 'patient-form__submit--disabled': submitting }"
      :disabled="submitting"
      @click="onSubmit"
    >
      <AppIcon name="action-confirm" :size="18" tone="inverse" :state="submitting ? 'loading' : submitted ? 'success' : 'idle'" />
      <text>{{
        submitted
          ? props.navigateBackOnSuccess
            ? "提交成功，正在返回…"
            : "提交成功"
          : submitting
            ? "正在提交…"
            : props.submitLabel
      }}</text>
    </button>
    <view class="patient-form__privacy cu-tag round bg-grey light">
      <AppIcon name="account-security" :size="22" tone="primary" />
      <text>信息仅用于本次医疗服务申请与后续服务跟进</text>
    </view>
  </view>
</template>

<style scoped>
.patient-form {
  padding: var(--sp-4, 16px);
}

.patient-form__intro {
  display: flex;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #ffffff);
  box-shadow: var(--shadow-card);
  color: var(--text-strong, #2a3547);
}

.patient-form__intro-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--r-sm, 6px);
  background: var(--primary-soft, #ecf2ff);
}

.patient-form__intro-copy {
  min-width: 0;
  flex: 1;
}

.patient-form__eyebrow,
.patient-form__title,
.patient-form__notes {
  display: block;
}

.patient-form__eyebrow {
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
  font-weight: 500;
}

.patient-form__title {
  margin-top: 4px;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-subheading, 19px);
  font-weight: 600;
  line-height: 1.35;
}

.patient-form__notes {
  margin-top: 6px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}

.patient-form__fields {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #ffffff);
  box-shadow: var(--shadow-card);
}

.field + .field {
  margin-top: var(--sp-5, 24px);
}

.field.cu-form-group {
  display: block;
  padding: 0;
  background: transparent;
}

.field__label {
  display: block;
  margin-bottom: var(--sp-2, 8px);
  color: var(--text-strong, #14213b);
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: var(--line-compact, 1.35);
}

.field__required,
.field-error {
  color: var(--danger, #d92d20);
}

.field__required {
  margin-left: var(--sp-1, 4px);
}

.field__control {
  width: 100%;
  min-height: var(--touch-target, 44px);
  padding: var(--sp-3, 12px) var(--sp-4, 16px);
  border: 1px solid var(--line, #dce4f0);
  border-radius: var(--r-md, 12px);
  background: var(--surface-muted, #f7f9fd);
  color: var(--text-strong, #14213b);
  font-size: var(--font-body, 18px);
  line-height: 1.5;
}

.field__control:focus {
  border-color: var(--primary, #5d87ff);
  background: var(--surface, #ffffff);
}

.field__control--readonly {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: #f0f3f5;
  color: #52627a;
  border: 1px solid #dce3dd;
}

.field__control--error {
  border-color: var(--danger, #d92d20);
  background: #fff8f7;
}

.field__picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field__placeholder {
  color: var(--text-placeholder, #637188);
}

.field__textarea {
  min-height: 132px;
}

.field__checkbox-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2, 8px);
}

.field__check-item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2, 8px);
  color: var(--text-strong, #14213b);
  font-size: var(--font-body, 18px);
  font-weight: 400;
  line-height: 1.5;
}

.field__other {
  margin-top: var(--sp-3, 12px);
}

.field__upload {
  width: 100%;
  min-height: var(--touch-target, 44px);
  padding: var(--sp-3, 12px) var(--sp-4, 16px);
  border: 1px dashed var(--line, #dce4f0);
  border-radius: var(--r-md, 12px);
  background: var(--surface-muted, #f7f9fd);
  color: var(--text-placeholder, #637188);
  font-size: var(--font-body, 18px);
  line-height: 1.5;
  text-align: center;
}

.field__upload--filled {
  border-style: solid;
  border-color: var(--primary, #5d87ff);
  background: #f0f4ff;
  color: var(--primary-deep, #456fd8);
  font-weight: 600;
}

.field__upload--busy {
  opacity: 0.7;
}

.field-error {
  display: block;
  margin-top: var(--sp-2, 8px);
  font-size: var(--font-body, 18px);
  font-weight: 600;
  line-height: 1.45;
}

.patient-form__consent {
  margin-top: var(--sp-4, 16px);
  padding: var(--sp-4, 16px);
  border: 1px solid var(--line, #dce4f0);
  border-radius: var(--r-lg, 16px);
  background: var(--surface, #ffffff);
}

.patient-form__consent-label {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2, 8px);
  width: 100%;
}

.patient-form__consent--error {
  border-color: var(--danger, #d92d20);
}

.patient-form__consent-copy {
  min-width: 0;
  flex: 1;
  color: var(--text-secondary, #52627a);
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}

.patient-form__consent-text {
  color: var(--text-secondary, #52627a);
  font-size: var(--font-caption, 14px);
  font-weight: 400;
}

.patient-form__consent-link {
  color: var(--primary, #5d87ff);
  font-size: var(--font-caption, 14px);
  font-weight: 400;
}

.patient-form__submit-error {
  display: flex;
  align-items: center;
  gap: var(--sp-2, 8px);
  margin-top: var(--sp-4, 16px);
  padding: var(--sp-3, 12px) var(--sp-4, 16px);
  border: 1px solid rgba(217, 45, 32, 0.24);
  border-radius: var(--r-md, 12px);
  background: #fff8f7;
  color: var(--danger, #d92d20);
  font-size: var(--font-body, 18px);
  font-weight: 600;
}

.patient-form__submit {
  width: 100%;
  min-height: 40px;
  margin-top: 16px;
  border: 0;
  border-radius: var(--r-md, 8px);
  background: var(--primary, #5d87ff);
  color: #ffffff;
  font-size: var(--font-body, 18px);
  font-weight: 600;
  line-height: 40px;
}

.patient-form__submit--disabled {
  opacity: 0.58;
}

.patient-form__privacy {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: var(--sp-2, 8px);
  margin: var(--sp-3, 12px) var(--sp-2, 8px) 0;
  color: var(--text-secondary, #52627a);
  font-size: var(--font-body, 18px);
  line-height: 1.5;
  text-align: center;
}

.field--sms {
  margin: 0 var(--sp-4, 16px) var(--sp-4, 16px);
}

.field--session-hint {
  margin: 0 var(--sp-4, 16px) var(--sp-2, 8px);
}

.field__sms-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field__sms-input {
  flex: 1;
  min-width: 0;
}

.field__sms-btn {
  flex: 0 0 auto;
  min-width: 110px;
  min-height: 44px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-md, 8px);
  background: var(--primary-soft, #ecf2ff);
  color: var(--primary, #5d87ff);
  font-size: var(--font-secondary, 16px);
  font-weight: 600;
  line-height: 44px;
}

.field__sms-btn::after {
  border: 0;
}

.field__sms-btn[disabled] {
  opacity: 0.55;
}

.field__hint {
  display: block;
  margin-top: 6px;
  color: var(--text-secondary, #637188);
  font-size: var(--font-caption, 14px);
  line-height: 1.5;
}

.elder .patient-form__fields,
.elder .patient-form__intro {
  padding: var(--sp-5, 24px);
}
</style>
