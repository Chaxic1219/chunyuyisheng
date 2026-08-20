<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { onHide, onShareAppMessage, onShow } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import type { ChatMessage } from "@chunyu/patient-design/types";
import AppIcon from "../../components/AppIcon.vue";
import {
  formatDoctorPrice,
  openChunyuDoctorPage,
  postChunyuConsultRecommend,
  postChunyuConsultReset,
  postChunyuConsultSend,
  type ChunyuRecommendDoctor,
} from "../../api/chunyuConsult";
import { ApiError, getMpToken } from "../../api/auth";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useConsultationStore } from "../../stores/consultation";
import { mpVisual } from "../../utils/mediaSrc";
import {
  clearMpAiTranscript,
  createMpAiSessionId,
  createMpAiIdentitySnapshot,
  ensureSessionId,
  hasMpAiConsent,
  isMpAiIdentitySnapshotCurrent,
  isOpaqueMpAiStorageScope,
  loadMpAiTranscript,
  persistSessionId,
  saveMpAiConsent,
  saveMpAiTranscript,
  type MpAiIdentitySnapshot,
} from "../../utils/mpAiSession";
import { createMpAiRuntimeIsolation } from "../../utils/mpAiRuntime";
import { ensureLogin } from "../../utils/ensureLogin";
import { failAiSendStage, markAiSendStage } from "../../utils/aiSendStage";
import { clearScopedStorage } from "../../utils/storageScope";
import { syncCustomTabBar } from "../../utils/syncTabBar";
import { createMpVoiceInput } from "../../utils/mpVoiceInput";
import type { AssistantRole } from "../../types/v32";

type ConsultCardType = "report-guide" | "report-actions" | "photo-guide" | "photo-actions";
type ConsultMessage = ChatMessage & {
  cardType?: ConsultCardType;
  showDisclaimer?: boolean;
};

const store = useAppStore();
const auth = useAuthStore();
const consultation = useConsultationStore();
const { role: assistantRole } = storeToRefs(consultation);
const text = ref("");
const sending = ref(false);
const failedPayload = ref<{
  payload: { text: string; role: AssistantRole; images?: string[] };
  snapshot: MpAiIdentitySnapshot;
} | null>(null);
/** 待发送图片（data URL，最多 3 张，单张 ≤4MB） */
const pendingImages = ref<string[]>([]);
const sessionId = ref("");
const messages = ref<ConsultMessage[]>([]);
const attachExpanded = ref(false);
const aiScope = computed(() => String(auth.storageScopeId || "").trim());
let sendSeq = 0;
let sendPending = false;
/** 隐藏/卸载/清空会话时递增，用于作废仍在 await 的 onSend */
let sendGate = 0;
const aiRuntime = createMpAiRuntimeIsolation(createMpAiSessionId);
const SEND_TIMEOUT_MS = 120000;
const CONSULT_RETURN_URL = "/pages/consult/index";
const lastMessageId = computed(() => {
  if (messages.value.length) return `m-${messages.value[messages.value.length - 1]?.id}`;
  return "scroll-spacer";
});
const canSend = computed(() => Boolean(text.value.trim()) || pendingImages.value.length > 0);
const recommendedDoctors = ref<ChunyuRecommendDoctor[]>([]);
const recommendLoading = ref(false);
const lastUserAsk = ref("");
const voiceRecording = ref(false);
const voicePartial = ref("");
const voiceInput = createMpVoiceInput({
  onStart: () => {
    voiceRecording.value = true;
    voicePartial.value = "";
  },
  onPartial: (partial) => {
    voicePartial.value = partial;
  },
  onResult: (result) => {
    voiceRecording.value = false;
    voicePartial.value = "";
    applyVoiceResult(result);
  },
  onError: (message) => {
    voiceRecording.value = false;
    voicePartial.value = "";
    uni.showToast({ title: message, icon: "none" });
  },
});

function bumpSendGate() {
  sendGate += 1;
  sendPending = false;
  sending.value = false;
}

function resetSendingState() {
  sendSeq += 1;
  aiRuntime.invalidateOperation();
  bumpSendGate();
}

function resetToWelcome() {
  typewriterToken += 1;
  messages.value = [];
  recommendedDoctors.value = [];
  lastUserAsk.value = "";
  attachExpanded.value = false;
}

const AI_DISCLAIMER = "AI生成仅供参考，不能代替医生诊断，如需治疗请咨询专业医生";
const ICON_SHIELD = mpVisual("consult-ui/shield.png");
const ICON_DOCTOR = mpVisual("consult-ui/doctor.png");
const TYPEWRITER_MS = 28;
let typewriterToken = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 助手气泡流式打字机；token 变化时中止（清空/换会话） */
async function typewriterSet(messageId: string, fullText: string) {
  const token = ++typewriterToken;
  const chars = Array.from(String(fullText || ""));
  const idx = messages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;
  messages.value[idx] = { ...messages.value[idx], text: "" };
  for (let i = 0; i < chars.length; i += 1) {
    if (token !== typewriterToken) return;
    const row = messages.value.findIndex((m) => m.id === messageId);
    if (row < 0) return;
    messages.value[row] = {
      ...messages.value[row],
      text: chars.slice(0, i + 1).join(""),
    };
    await sleep(TYPEWRITER_MS);
  }
  if (token === typewriterToken) persistCurrentTranscript();
}

function persistCurrentTranscript() {
  const scope = aiScope.value;
  if (!isOpaqueMpAiStorageScope(scope)) return;
  try {
    saveMpAiTranscript(scope, messages.value);
  } catch {
    /* 落盘失败不阻断对话 */
  }
}

function hydrateMessagesForScope(scope: string) {
  typewriterToken += 1;
  if (isOpaqueMpAiStorageScope(scope)) {
    const rows = loadMpAiTranscript(scope) as ConsultMessage[];
    if (rows.length) {
      messages.value = rows
        .filter((row) => row.id !== "welcome")
        .map((row) => ({
          id: row.id,
          role: row.role,
          text: row.text,
          attachments: row.attachments,
          cardType: row.cardType,
          showDisclaimer: row.showDisclaimer,
        }));
      return;
    }
  }
  messages.value = [];
}

async function appendAssistant(textValue: string) {
  const id = `a-${Date.now()}`;
  messages.value.push({
    id,
    role: "assistant",
    text: "",
  });
  await typewriterSet(id, textValue);
}

onMounted(() => {
  sessionId.value = aiScope.value ? ensureSessionId(aiScope.value) : createMpAiSessionId();
  sending.value = false;
  hydrateMessagesForScope(aiScope.value);
  void store.load().catch(() => {});
});

onShow(() => {
  syncCustomTabBar(1);
  if (sending.value) resetSendingState();
  void (async () => {
    if (getMpToken()) {
      try {
        await auth.refreshMe();
      } catch {
        /* 下面按当前 scope 尝试恢复 */
      }
    }
    const scope = aiScope.value;
    if (!isOpaqueMpAiStorageScope(scope) || sendPending || sending.value) return;
    const onlyEmpty = messages.value.length === 0;
    if (!onlyEmpty) return;
    const rows = loadMpAiTranscript(scope);
    if (rows.length) hydrateMessagesForScope(scope);
  })();
});

onShareAppMessage(() => ({
  title: "春雨健康患者端",
  path: store.buildSharePath("/pages/consult/index"),
}));

watch(aiScope, (next, prev) => {
  if (next === prev) return;
  // 空 → 首次绑定：登录/refresh 刚写入 scope。若正在发送，只轮换 session，不作废本次发送、不清空对话。
  const initialBindDuringSend = !prev && !!next && sendPending;
  aiRuntime.isolate({
    resetMemory(nextSessionId) {
      sendSeq += 1;
      sessionId.value = nextSessionId;
      failedPayload.value = null;
      if (initialBindDuringSend) return;
      bumpSendGate();
      text.value = "";
      consultation.reset();
      hydrateMessagesForScope(next || "");
    },
    storageEffects: [
      (nextSessionId) => {
        if (next) persistSessionId(next, nextSessionId);
      },
      () => clearScopedStorage(prev),
      () => {
        // 首次绑定时把内存中已产生的对话落到新 scope
        if (initialBindDuringSend && next) persistCurrentTranscript();
      },
    ],
  });
}, { flush: "sync" });

onHide(() => {
  voiceInput.cancel();
  resetSendingState();
});
onUnmounted(() => {
  typewriterToken += 1;
  voiceInput.cancel();
  resetSendingState();
});

function onClearChat() {
  uni.showModal({
    title: "清空对话",
    content: "确定清空所有聊天记录吗？清空后不可恢复。",
    success: (res) => {
      if (!res.confirm) return;
      const scope = aiScope.value;
      aiRuntime.isolate({
        resetMemory(nextSessionId) {
          sendSeq += 1;
          bumpSendGate();
          sessionId.value = nextSessionId;
          failedPayload.value = null;
          text.value = "";
          consultation.reset();
          resetToWelcome();
        },
        storageEffects: [
          (nextSessionId) => {
            if (scope) persistSessionId(scope, nextSessionId);
          },
          () => {
            if (scope) clearMpAiTranscript(scope);
          },
          () => {
            const token = getMpToken();
            if (token) void postChunyuConsultReset(token).catch(() => {});
          },
          () => {
            recommendedDoctors.value = [];
            lastUserAsk.value = "";
          },
        ],
      });
      uni.showToast({ title: "已清空", icon: "success" });
    },
  });
}

function currentAiSnapshot(operationId: number): MpAiIdentitySnapshot | null {
  return createMpAiIdentitySnapshot({
    scope: aiScope.value,
    authEpoch: Number(auth.authEpoch),
    operationId,
    doctorId: Number(store.doctor?.id),
    patientId: Number(auth.patientId),
    personId: Number(auth.personId),
    token: getMpToken(),
  });
}

function isCurrentAiSnapshot(snapshot: MpAiIdentitySnapshot): boolean {
  if (!aiRuntime.isOperationCurrent(snapshot.operationId)) return false;
  const current = currentAiSnapshot(aiRuntime.currentOperationId);
  return !!current && isMpAiIdentitySnapshotCurrent(snapshot, current);
}

function notifyAiIdentityChanged() {
  uni.showToast({ title: "账号或服务身份已变化，请重新操作", icon: "none" });
}

function requestAiConsentModal(): Promise<"confirm" | "cancel" | "fail"> {
  return new Promise((resolve) => {
    uni.showModal({
      title: "服务提示",
      content:
        "你的健康问题会发送至在线服务系统进行处理。请不要填写非必要的姓名、证件号、联系方式等身份信息。",
      // 微信 confirmText/cancelText 最多 4 个字符，超长会 fail 且不弹窗
      confirmText: "同意",
      cancelText: "暂不",
      success: (result) => {
        resolve(result.confirm ? "confirm" : "cancel");
      },
      fail: () => resolve("fail"),
    });
  });
}

/** 同意弹窗不绑定 operationId，避免登录/refresh 期间 isolate 误杀发送 */
async function ensureAiConsentByScope(
  scope: string,
  isAborted: () => boolean
): Promise<boolean> {
  if (!isOpaqueMpAiStorageScope(scope)) return false;
  if (hasMpAiConsent(scope)) return true;
  const decision = await requestAiConsentModal();
  if (decision !== "confirm") {
    if (decision === "fail") {
      failAiSendStage("consent_ready", "同意弹窗打开失败，请重试");
    } else {
      markAiSendStage("blocked", { reason: "consent_cancel" });
      uni.showToast({ title: "需同意后才能继续咨询", icon: "none" });
    }
    return false;
  }
  if (isAborted()) return false;
  if (String(auth.storageScopeId || "").trim() !== scope) {
    notifyAiIdentityChanged();
    return false;
  }
  try {
    saveMpAiConsent(scope);
    return true;
  } catch {
    failAiSendStage("consent_ready", "无法保存同意状态，请稍后重试");
    return false;
  }
}

function redirectToBind() {
  const url = `/pages/auth/bind?returnUrl=${encodeURIComponent(CONSULT_RETURN_URL)}`;
  uni.redirectTo({
    url,
    fail: () => uni.navigateTo({ url }),
  });
}

async function requestHealthReply(
  payload: { text: string; role: AssistantRole; images?: string[] },
  snapshot: MpAiIdentitySnapshot
) {
  if (!isCurrentAiSnapshot(snapshot)) {
    notifyAiIdentityChanged();
    return;
  }
  const seq = ++sendSeq;
  sending.value = true;
  failedPayload.value = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (seq !== sendSeq) return;
    sending.value = false;
    failedPayload.value = { payload, snapshot };
    uni.showToast({ title: "回复超时，请重试", icon: "none" });
  }, SEND_TIMEOUT_MS);

  try {
    if (!sessionId.value) sessionId.value = ensureSessionId(snapshot.scope);
    if (!isCurrentAiSnapshot(snapshot)) {
      notifyAiIdentityChanged();
      return;
    }
    const consultText = payload.text.trim();
    markAiSendStage("request_started", {
      role: payload.role,
      doctorId: snapshot.doctorId,
    });
    if (consultText) lastUserAsk.value = consultText;
    const { reply, pending, recommendations } = await postChunyuConsultSend({
      text: consultText,
      images: payload.images,
      authToken: snapshot.token,
    });
    if (recommendations?.length) recommendedDoctors.value = recommendations;
    markAiSendStage("request_done");
    if (seq !== sendSeq || !isCurrentAiSnapshot(snapshot)) return;
    const id = String(reply?.id || `a-${Date.now()}`);
    const fullText = String(reply?.text || "");
    if (pending && !fullText) {
      if (seq === sendSeq) sending.value = false;
      return;
    }
    messages.value.push({
      ...reply,
      id,
      role: "assistant",
      text: "",
    });
    if (seq === sendSeq) sending.value = false;
    await typewriterSet(id, fullText);
  } catch (err) {
    if (seq !== sendSeq) return;
    if (!isCurrentAiSnapshot(snapshot)) {
      notifyAiIdentityChanged();
      return;
    }
    if (err instanceof ApiError && err.status === 401) {
      failedPayload.value = null;
      auth.clear();
      uni.showToast({ title: "登录状态已失效，请重新绑定", icon: "none" });
      redirectToBind();
    } else if (err instanceof ApiError && err.status === 429) {
      failedPayload.value = null;
      uni.showToast({ title: "请求过于频繁，请稍后再试", icon: "none" });
    } else {
      failedPayload.value = { payload, snapshot };
      // 5xx 统一会显示“服务暂时不可用”，这里补上 code 方便定位（如 chunyu_upstream / chunyu_login_failed / chunyu_create_failed）。
      const msg = err instanceof ApiError ? `${err.message}(${err.code})` : "发送失败，请稍后重试";
      uni.showToast({ title: msg.slice(0, 40), icon: "none" });
    }
  } finally {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (seq === sendSeq) sending.value = false;
  }
}

async function requestReply(
  payload: { text: string; role: AssistantRole; images?: string[] },
  snapshot: MpAiIdentitySnapshot
) {
  if (sending.value) {
    uni.showToast({ title: "正在回复中，请稍候", icon: "none" });
    return;
  }
  if (!isCurrentAiSnapshot(snapshot)) {
    notifyAiIdentityChanged();
    return;
  }
  if (payload.role === "handoff") {
    await appendAssistant(
      "这个需求同时涉及健康相关和服务办理。我会先确认用药或风险边界，再请你确认是否共享必要信息以便继续办理。"
    );
    return;
  }
  await requestHealthReply(payload, snapshot);
}

async function onSend() {
  if (sending.value || sendPending) {
    uni.showToast({ title: "正在回复中，请稍候", icon: "none" });
    return;
  }
  const content = text.value.trim();
  const images = pendingImages.value;
  if (!content && !images.length) return;
  sendPending = true;
  const gate = sendGate;
  const isAborted = () => gate !== sendGate;
  const abortToast = () => {
    markAiSendStage("aborted");
    uni.showToast({ title: "账号状态已更新，请再点一次发送", icon: "none" });
  };
  try {
    markAiSendStage("bootstrap");
    if (!store.doctor?.id) {
      try {
        await store.load();
      } catch {
        /* 下面统一提示 */
      }
      if (isAborted()) {
        abortToast();
        return;
      }
    }
    // 先完成登录/同意等异步步骤，再 beginOperation。
    // 否则 ensureLogin 写入 storageScopeId 会触发 watch→isolate，把 operation 作废，表现为点了发送却发不出去。
    const loggedIn = await ensureLogin(CONSULT_RETURN_URL);
    if (!loggedIn) {
      markAiSendStage("blocked", { reason: "login" });
      return;
    }
    markAiSendStage("login_ready");
    if (isAborted()) {
      abortToast();
      return;
    }
    // AI 问答只需绑定手机号即可；不强制完善/上传个人档案
    if (!auth.phoneBound) {
      failAiSendStage("phone_ready", "请先绑定手机号后再发送");
      redirectToBind();
      return;
    }
    markAiSendStage("phone_ready");
    if (!auth.personId || !auth.patientId) {
      try {
        await auth.refreshMe();
      } catch {
        /* 下面统一处理 */
      }
      if (isAborted()) {
        abortToast();
        return;
      }
    }
    if (!auth.personId || !auth.patientId) {
      failAiSendStage("identity_ready", "账号未完成手机绑定，请先绑定");
      redirectToBind();
      return;
    }
    markAiSendStage("identity_ready");
    let scope = String(auth.storageScopeId || "").trim();
    if (!isOpaqueMpAiStorageScope(scope)) {
      try {
        await auth.refreshMe();
      } catch {
        /* 下面统一提示 */
      }
      if (isAborted()) {
        abortToast();
        return;
      }
      scope = String(auth.storageScopeId || "").trim();
    }
    if (!isOpaqueMpAiStorageScope(scope)) {
      failAiSendStage("scope_ready", "账号服务身份未就绪，请重新绑定手机号");
      redirectToBind();
      return;
    }
    markAiSendStage("scope_ready");
    if (!(await ensureAiConsentByScope(scope, isAborted))) {
      if (isAborted()) abortToast();
      else markAiSendStage("blocked", { reason: "consent" });
      return;
    }
    markAiSendStage("consent_ready");
    if (isAborted()) {
      abortToast();
      return;
    }

    const operationId = aiRuntime.beginOperation();
    const snapshot = currentAiSnapshot(operationId);
    if (!snapshot || !isCurrentAiSnapshot(snapshot)) {
      const missing = [
        !store.doctor?.id ? "医生服务" : "",
        !auth.patientId || !auth.personId ? "患者身份" : "",
        !getMpToken() ? "登录态" : "",
        !isOpaqueMpAiStorageScope(auth.storageScopeId) ? "存储身份" : "",
      ]
        .filter(Boolean)
        .join("/");
      failAiSendStage(
        "snapshot_ready",
        missing ? `账号信息不完整（${missing}）` : "服务身份未就绪，请稍后重试"
      );
      return;
    }
    markAiSendStage("snapshot_ready");
    if (consultation.role === "waiting") {
      consultation.selectRole(consultation.classifyIntent(content || "请查看我上传的图片资料"));
    }
    const payload = { text: content, role: assistantRole.value, images };
    messages.value.push({
      id: `u-${Date.now()}`,
      role: "user",
      text: content,
      attachments: images.length ? images : undefined,
    });
    text.value = "";
    pendingImages.value = [];
    persistCurrentTranscript();
    await requestReply(payload, snapshot);
  } finally {
    if (gate === sendGate) sendPending = false;
  }
}

function toggleAttachMenu() {
  attachExpanded.value = !attachExpanded.value;
}

function copyMessageText(value: string) {
  const t = String(value || "").trim();
  if (!t) return;
  uni.setClipboardData({ data: t });
}

function pushGuideCards(mode: "report" | "photo") {
  const stamp = Date.now();
  if (mode === "report") {
    messages.value.push({
      id: `card-rg-${stamp}`,
      role: "assistant",
      text: "",
      cardType: "report-guide",
    });
    messages.value.push({
      id: `card-ra-${stamp}`,
      role: "assistant",
      text: "",
      cardType: "report-actions",
    });
  } else {
    messages.value.push({
      id: `card-pg-${stamp}`,
      role: "assistant",
      text: "",
      cardType: "photo-guide",
    });
    messages.value.push({
      id: `card-pa-${stamp}`,
      role: "assistant",
      text: "",
      cardType: "photo-actions",
    });
  }
}

async function onQuickAction(kind: "report" | "recommend" | "photo") {
  if (sending.value) return;
  attachExpanded.value = false;
  const label = kind === "report" ? "报告解读" : kind === "recommend" ? "推荐医生" : "拍图诊断";
  messages.value.push({ id: `u-${Date.now()}`, role: "user", text: label });
  persistCurrentTranscript();
  if (kind === "report") {
    pushGuideCards("report");
    persistCurrentTranscript();
    return;
  }
  if (kind === "photo") {
    pushGuideCards("photo");
    persistCurrentTranscript();
    return;
  }
  messages.value.push({
    id: `a-${Date.now()}`,
    role: "assistant",
    text: "您好，我可以通过您描述病症、科室、城市等信息，为您推荐符合条件的医生。",
    showDisclaimer: true,
  });
  persistCurrentTranscript();
  lastUserAsk.value = "我想咨询健康问题，请推荐合适的医生";
  await refreshRecommendations();
}

function readImageFile(filePath: string, onOk: (dataUrl: string) => void) {
  try {
    const fs = uni.getFileSystemManager();
    fs.readFile({
      filePath,
      encoding: "base64",
      success: (readRes) => {
        const b64 = String(readRes.data || "");
        const bytes = Math.floor((b64.length * 3) / 4);
        if (bytes > 4 * 1024 * 1024) {
          uni.showToast({ title: "图片不能超过 4MB", icon: "none" });
          return;
        }
        const lower = String(filePath).toLowerCase();
        let mime = "image/jpeg";
        if (lower.endsWith(".png")) mime = "image/png";
        else if (lower.endsWith(".webp")) mime = "image/webp";
        onOk(`data:${mime};base64,${b64}`);
      },
      fail: () => uni.showToast({ title: "图片读取失败", icon: "none" }),
    });
  } catch {
    uni.showToast({ title: "图片读取失败", icon: "none" });
  }
}

function chooseConsultImage(sourceType: ("album" | "camera")[], autoSendText?: string) {
  if (pendingImages.value.length >= 3) {
    uni.showToast({ title: "最多上传 3 张图片", icon: "none" });
    return;
  }
  uni.chooseImage({
    count: 1,
    sizeType: ["compressed"],
    sourceType,
    success: (chooseRes) => {
      const filePath = chooseRes.tempFilePaths && chooseRes.tempFilePaths[0];
      if (!filePath) return;
      readImageFile(filePath, (dataUrl) => {
        pendingImages.value = [...pendingImages.value, dataUrl].slice(0, 3);
        if (autoSendText) {
          text.value = autoSendText;
          void onSend();
        }
      });
    },
  });
}

function onTakePhoto(intent: "report" | "photo" | "general") {
  attachExpanded.value = false;
  const hint =
    intent === "report"
      ? "请协助解读这份检查报告，并给出健康建议。"
      : intent === "photo"
        ? "请根据图片帮我分析症状，并给出就医建议。"
        : "";
  chooseConsultImage(["camera"], hint || undefined);
}

function onPickAlbum(intent: "report" | "photo" | "general") {
  attachExpanded.value = false;
  const hint =
    intent === "report"
      ? "请协助解读这份检查报告，并给出健康建议。"
      : intent === "photo"
        ? "请根据图片帮我分析症状，并给出就医建议。"
        : "";
  chooseConsultImage(["album"], hint || undefined);
}

function onUploadPdf() {
  attachExpanded.value = false;
  uni.chooseMessageFile({
    count: 1,
    type: "file",
    extension: ["pdf"],
    success: () => {
      uni.showToast({ title: "PDF 请转为清晰照片上传", icon: "none", duration: 2500 });
    },
    fail: () => {
      uni.showToast({ title: "暂未选择文件", icon: "none" });
    },
  });
}

function applyVoiceResult(result: string) {
  const chunk = String(result || "").trim();
  if (!chunk) {
    uni.showToast({ title: "未识别到内容，请重试", icon: "none" });
    return;
  }
  const base = text.value.trim();
  text.value = base ? `${base} ${chunk}` : chunk;
}

async function onVoiceToggle() {
  if (sending.value) return;
  if (voiceRecording.value || voiceInput.isActive()) {
    voiceInput.stop();
    return;
  }
  const ok = await voiceInput.start();
  if (ok) {
    voiceRecording.value = true;
    voicePartial.value = "";
  }
}

function onAttachTap() {
  toggleAttachMenu();
}

function removePendingImage(index: number) {
  pendingImages.value = pendingImages.value.filter((_, i) => i !== index);
}

function previewImage(current: string, all?: string[]) {
  try {
    uni.previewImage({
      current,
      urls: (all && all.length ? all : [current]) as string[],
    });
  } catch {
    /* 预览失败不阻断 */
  }
}

function retryFailed() {
  if (!failedPayload.value) return;
  if (!isCurrentAiSnapshot(failedPayload.value.snapshot)) {
    failedPayload.value = null;
    notifyAiIdentityChanged();
    return;
  }
  void requestReply(failedPayload.value.payload, failedPayload.value.snapshot);
}

async function refreshRecommendations() {
  const token = getMpToken();
  const ask = lastUserAsk.value.trim() || messages.value.find((m) => m.role === "user")?.text?.trim() || "";
  if (!token || !ask) {
    uni.showToast({ title: "请先发送一条咨询", icon: "none" });
    return;
  }
  recommendLoading.value = true;
  try {
    recommendedDoctors.value = await postChunyuConsultRecommend(token, ask);
    if (!recommendedDoctors.value.length) {
      uni.showToast({ title: "暂无匹配医生", icon: "none" });
    }
  } catch {
    uni.showToast({ title: "获取推荐失败", icon: "none" });
  } finally {
    recommendLoading.value = false;
  }
}

function onOpenRecommendDoctor(doctor: ChunyuRecommendDoctor) {
  if (!doctor?.id) return;
  void openChunyuDoctorPage(doctor.id);
}
</script>

<template>
  <view class="page huiwen" :class="{ elder: store.elderMode }">
    <view class="safety-bar">
      <image class="safety-bar__icon" :src="ICON_SHIELD" mode="aspectFit" />
      <text class="safety-bar__text">如有急症，请立即线下就医</text>
      <view class="safety-bar__clear pressable" aria-role="button" aria-label="清空咨询记录" @click="onClearChat">
        <text>清空</text>
      </view>
    </view>

    <scroll-view scroll-y class="conversation" :scroll-into-view="lastMessageId">
      <view
        v-for="message in messages"
        :id="`m-${message.id}`"
        :key="message.id"
        class="message-row"
        :class="[`message-row--${message.role}`]"
      >
        <view v-if="message.cardType === 'report-guide'" class="guide-card">
          <text class="guide-card__text">
            请上传单张边框完整、图文清晰的检查报告图片或10M以内的体检报告文件。我将提供专业的医学解读，并且给出针对性健康建议
          </text>
          <view class="guide-card__tips">
            <view class="guide-tip">
              <AppIcon name="health-record" :size="26" tone="muted" />
              <text class="guide-tip__title">平整放置</text>
            </view>
            <view class="guide-tip">
              <AppIcon name="camera" :size="26" tone="muted" />
              <text class="guide-tip__title">完整拍摄</text>
            </view>
          </view>
        </view>

        <view v-else-if="message.cardType === 'report-actions'" class="action-card">
          <text class="action-card__title">AI报告解读</text>
          <view class="action-row pressable" aria-role="button" @click="onTakePhoto('report')">
            <view class="action-row__left">
              <AppIcon name="camera" :size="20" tone="primary" />
              <text class="action-row__label">拍照</text>
            </view>
            <text class="action-row__btn">去拍照</text>
          </view>
          <view class="action-row pressable" aria-role="button" @click="onPickAlbum('report')">
            <view class="action-row__left">
              <AppIcon name="attachment" :size="20" tone="primary" />
              <text class="action-row__label">上传照片</text>
            </view>
            <text class="action-row__btn">去上传</text>
          </view>
          <view class="action-row pressable" aria-role="button" @click="onUploadPdf">
            <view class="action-row__left">
              <AppIcon name="upload-record" :size="20" tone="primary" />
              <text class="action-row__label">上传PDF文件</text>
            </view>
            <text class="action-row__btn">去上传</text>
          </view>
        </view>

        <view v-else-if="message.cardType === 'photo-guide'" class="guide-card">
          <text class="guide-card__text">
            请上传单张拍摄清晰的身体部位图片，如皮肤患处、舌苔照片等，拍摄时需关闭美颜，保证患处位于画面中央。我将辅助您定位问题，并给出针对性建议。
          </text>
          <view class="guide-card__tips">
            <view class="guide-tip">
              <AppIcon name="camera" :size="26" tone="muted" />
              <text class="guide-tip__title">清晰拍摄患处</text>
            </view>
            <view class="guide-tip">
              <AppIcon name="attachment" :size="26" tone="muted" />
              <text class="guide-tip__title">患处画面位于中央</text>
            </view>
          </view>
        </view>

        <view v-else-if="message.cardType === 'photo-actions'" class="action-card">
          <text class="action-card__title">拍图诊断</text>
          <view class="action-row pressable" aria-role="button" @click="onTakePhoto('photo')">
            <view class="action-row__left">
              <AppIcon name="camera" :size="20" tone="primary" />
              <text class="action-row__label">拍照</text>
            </view>
            <text class="action-row__btn">去拍照</text>
          </view>
          <view class="action-row pressable" aria-role="button" @click="onPickAlbum('photo')">
            <view class="action-row__left">
              <AppIcon name="attachment" :size="20" tone="primary" />
              <text class="action-row__label">上传照片</text>
            </view>
            <text class="action-row__btn">去上传</text>
          </view>
        </view>

        <template v-else>
          <view v-if="message.role !== 'user'" class="message-avatar">
            <image class="message-avatar__img" :src="ICON_DOCTOR" mode="aspectFill" />
          </view>
          <view class="message-bubble">
            <view class="message-bubble__content" :class="message.role === 'user' ? 'is-user' : 'is-assistant'">
              <view v-if="message.attachments?.length" class="message-bubble__images">
                <image
                  v-for="(img, idx) in message.attachments"
                  :key="idx"
                  class="message-bubble__img"
                  :src="img"
                  mode="aspectFill"
                  @tap="previewImage(img, message.attachments)"
                />
              </view>
              <text v-if="message.text" class="message-bubble__text">{{ message.text }}</text>
              <view v-if="message.showDisclaimer" class="message-bubble__footer">
                <text class="message-bubble__disclaimer">{{ AI_DISCLAIMER }}</text>
                <view class="message-bubble__tools">
                  <text class="tool-icon pressable" @tap="copyMessageText(message.text)">复制</text>
                </view>
              </view>
            </view>
          </view>
        </template>
      </view>

      <scroll-view v-if="recommendedDoctors.length" scroll-x class="doctor-scroll" enable-flex>
        <view
          v-for="doc in recommendedDoctors"
          :key="doc.id"
          class="doctor-card pressable"
          aria-role="button"
          @click="onOpenRecommendDoctor(doc)"
        >
          <image class="doctor-card__avatar" :src="doc.image || ICON_DOCTOR" mode="aspectFill" />
          <view class="doctor-card__body">
            <view class="doctor-card__name-row">
              <text class="doctor-card__name">{{ doc.name }}</text>
              <text v-if="doc.isActive" class="doctor-card__online">在线</text>
            </view>
            <text class="doctor-card__meta">{{ doc.title }} · {{ doc.clinic }}</text>
            <text class="doctor-card__hospital">{{ doc.hospitalGrade }} {{ doc.hospital }}</text>
            <text class="doctor-card__good">{{ doc.goodAt }}</text>
            <view class="doctor-card__foot">
              <text class="doctor-card__price">{{ formatDoctorPrice(doc.priceFen) }}</text>
              <text class="doctor-card__action">去春雨咨询</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <view v-if="sending" class="sending-state">
        <AppIcon name="status-loading" :size="14" tone="primary" state="loading" />
        <text>医生接诊中，请稍候…</text>
      </view>
      <view
        v-if="failedPayload"
        class="failed-state pressable"
        aria-role="button"
        @click="retryFailed"
      >
        <AppIcon name="status-error" :size="24" tone="danger" />
        <view>
          <text class="failed-state__title">发送失败</text>
          <text class="failed-state__sub">点击重试</text>
        </view>
        <AppIcon name="action-refresh" :size="18" tone="primary" />
      </view>
      <view id="scroll-spacer" class="scroll-spacer" />
    </scroll-view>

    <view class="bottom-bar">
      <view class="quick-bar">
        <view class="quick-pill pressable" aria-role="button" @click="onQuickAction('report')">
          <view class="quick-pill__icon">
            <AppIcon name="health-record" :size="22" tone="primary" />
          </view>
          <text class="quick-pill__text">报告解读</text>
        </view>
        <view class="quick-pill pressable" aria-role="button" @click="onQuickAction('recommend')">
          <view class="quick-pill__icon">
            <AppIcon name="consult-doctor" :size="22" tone="primary" />
          </view>
          <text class="quick-pill__text">{{ recommendLoading ? "加载中" : "推荐医生" }}</text>
        </view>
        <view class="quick-pill pressable" aria-role="button" @click="onQuickAction('photo')">
          <view class="quick-pill__icon">
            <AppIcon name="camera" :size="22" tone="primary" />
          </view>
          <text class="quick-pill__text">拍图诊断</text>
        </view>
      </view>

      <view v-if="attachExpanded" class="attach-grid">
        <view class="attach-item pressable" aria-role="button" @click="onTakePhoto('general')">
          <view class="attach-item__icon"><AppIcon name="camera" :size="28" tone="primary" /></view>
          <text>拍照</text>
        </view>
        <view class="attach-item pressable" aria-role="button" @click="onPickAlbum('general')">
          <view class="attach-item__icon"><AppIcon name="attachment" :size="28" tone="primary" /></view>
          <text>上传照片</text>
        </view>
        <view class="attach-item pressable" aria-role="button" @click="onUploadPdf">
          <view class="attach-item__icon"><AppIcon name="upload-record" :size="28" tone="primary" /></view>
          <text>上传文件</text>
        </view>
      </view>

      <view v-if="pendingImages.length" class="composer-previews">
        <view v-for="(img, idx) in pendingImages" :key="idx" class="composer-preview">
          <image class="composer-preview__img" :src="img" mode="aspectFill" @tap="previewImage(img, pendingImages)" />
          <view class="composer-preview__remove pressable" @click="removePendingImage(idx)">
            <AppIcon name="action-close" :size="14" tone="inverse" />
          </view>
        </view>
      </view>

      <view v-if="voiceRecording" class="voice-hint" aria-live="polite">
        <text>{{ voicePartial || "正在聆听，再次点击结束" }}</text>
      </view>

      <view class="input-bar">
        <view
          class="input-bar__voice pressable"
          :class="{ 'input-bar__voice--active': voiceRecording }"
          aria-role="button"
          @tap.stop="onVoiceToggle"
        >
          <view class="composer__mic" aria-hidden="true" />
        </view>
        <input
          v-model="text"
          class="input-bar__field"
          confirm-type="send"
          placeholder="请描述一下你想咨询的健康问题～"
          :disabled="sending"
          @confirm="onSend"
        />
        <view class="input-bar__plus pressable" aria-role="button" @tap.stop="onAttachTap">
          <AppIcon :name="attachExpanded ? 'action-close' : 'action-add'" :size="26" tone="primary" />
        </view>
        <view
          class="input-bar__send pressable"
          :class="{ 'input-bar__send--ready': canSend && !sending }"
          aria-role="button"
          @tap.stop="onSend"
        >
          <AppIcon name="action-send" :size="22" :tone="canSend && !sending ? 'inverse' : 'muted'" :state="sending ? 'loading' : 'idle'" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: calc(72px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.elder.page {
  bottom: calc(82px + env(safe-area-inset-bottom));
}
.page.huiwen {
  background: #f3f4f6;
}
.guide-card,
.action-card {
  width: 100%;
  background: #fff;
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
.guide-card__text {
  font-size: 14px;
  line-height: 1.65;
  color: #374151;
}
.guide-card__tips {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.guide-tip {
  flex: 1;
  min-height: 88px;
  border-radius: 10px;
  background: #f3f4f6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 8px;
}
.action-row__left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.guide-tip__title {
  font-size: 12px;
  color: #6b7280;
}
.action-card__title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 10px;
}
.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid #f0f0f0;
}
.action-row__label {
  font-size: 14px;
  color: #374151;
}
.action-row__btn {
  font-size: 13px;
  color: #fff;
  background: #2dbe8f;
  padding: 6px 14px;
  border-radius: 999px;
}
.message-bubble__content.is-user {
  background: #2dbe8f;
  color: #fff;
}
.message-bubble__footer {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.message-bubble__disclaimer {
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.5;
}
.message-bubble__tools {
  margin-top: 8px;
}
.tool-icon {
  font-size: 12px;
  color: #6b7280;
}
.bottom-bar {
  flex: 0 0 auto;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #f3f4f6;
}
.quick-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.quick-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  background: #fff;
  border-radius: 999px;
  padding: 0 12px;
  color: #374151;
}
.quick-pill__icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.quick-pill__text {
  font-size: 15px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.attach-grid {
  display: flex;
  gap: 12px;
  padding: 12px 8px;
  margin-bottom: 8px;
  background: #fff;
  border-radius: 14px;
}
.attach-item {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: #4b5563;
}
.attach-item__icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 6px;
  border-radius: 14px;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border-radius: 24px;
  padding: 6px 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.input-bar__voice {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #f3f4f6;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.input-bar__voice--active {
  background: #fff0f0;
}
.input-bar__voice--active .composer__mic,
.input-bar__voice--active .composer__mic::before,
.input-bar__voice--active .composer__mic::after {
  border-color: #d64545;
  background: #d64545;
}
.input-bar__field {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  height: 44px;
}
.input-bar__plus,
.input-bar__send {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.input-bar__send--ready {
  background: linear-gradient(145deg, #0a6843 0%, #0d7a4f 100%);
  box-shadow: 0 4px 10px rgba(10, 104, 67, 0.22);
}
.voice-hint {
  font-size: 12px;
  color: #6b7280;
  text-align: center;
  margin-bottom: 6px;
}
.message-row--user {
  justify-content: flex-end;
}
.message-row--user .message-bubble {
  max-width: 78%;
}
.message-row--user .message-bubble__content.is-user {
  border-radius: 16px 16px 4px 16px;
}
.elder.page {
  bottom: calc(82px + env(safe-area-inset-bottom));
}

.safety-bar {
  display: flex;
  flex: 0 0 auto;
  margin: 10px 14px 0;
  padding: 10px 12px;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  background: #e8f5ee;
}
.safety-bar__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.safety-bar__text {
  flex: 1;
  min-width: 0;
  color: #3d6b54;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
}
.safety-bar__clear {
  flex: 0 0 auto;
  padding: 2px 4px;
  color: #6a756f;
  font-size: 12px;
}
.ai-notice {
  margin: 8px 14px 0;
  padding: 8px 10px;
  border: 1px solid #f1dfb9;
  border-radius: 10px;
  background: #fff7e6;
}
.ai-notice__text {
  color: #9a6700;
  font-size: 12px;
  line-height: 1.45;
}

.conversation {
  flex: 1;
  height: 0;
  min-height: 0;
  padding: 14px 14px 0;
  box-sizing: border-box;
}

.consent-card {
  display: block;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #c7dceb;
  border-radius: 12px;
  background: #edf6fb;
}
.consent-card__title,
.consent-card__desc {
  display: block;
}
.consent-card__title {
  color: #2c638e;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.consent-card__desc {
  margin-top: 4px;
  color: #496a80;
  font-size: var(--font-caption, 14px);
}

.message-row {
  display: flex;
  margin-bottom: 14px;
  align-items: flex-start;
  gap: 10px;
}
.message-row--user {
  justify-content: flex-end;
}
.message-avatar {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e5f3ec;
  overflow: hidden;
}
.message-avatar__img {
  display: block;
  width: 24px;
  height: 24px;
}
.message-bubble {
  max-width: 78%;
}
.message-bubble__content {
  display: block;
  padding: 12px 14px;
  border-radius: 14px;
  background: #fff;
  color: #1a2420;
  box-shadow: 0 1px 2px rgba(23, 32, 28, 0.04);
}
.message-bubble__content.is-user {
  background: #176b52;
  color: #fff;
}
.message-bubble__text {
  display: block;
  font-size: var(--font-secondary, 16px);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.message-bubble__tag {
  display: inline-flex;
  margin-bottom: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e8f2ff;
  color: #2e5da8;
  font-size: 11px;
  line-height: 1.4;
}
.message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.message-bubble__img {
  width: 120px;
  height: 120px;
  border-radius: 10px;
  background: #eef2f1;
}

.quick-topics {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  margin: 2px 0 16px 50px;
}
.quick-topic {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 8px 10px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(23, 32, 28, 0.04);
}
.quick-topic__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.quick-topic__label {
  color: #2f5a45;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.sending-state {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 50px 16px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}
.failed-state {
  display: flex;
  min-height: var(--touch-target, 44px);
  margin: 4px 0 16px 50px;
  padding: 10px 12px;
  gap: 8px;
  border: 1px solid #f5c6bb;
  border-radius: 12px;
  background: #fff1ed;
}
.failed-state__title,
.failed-state__sub {
  display: block;
  font-size: var(--font-secondary, 16px);
}
.failed-state__title {
  color: #c2410c;
  font-weight: 800;
}
.failed-state__sub {
  margin-top: 2px;
  color: #9a3412;
}
.scroll-spacer {
  height: 12px;
}

.composer-wrap {
  position: relative;
  flex: 0 0 auto;
  z-index: 20;
  padding: 8px 14px 10px;
  background: #f5f7f6;
}
.service-panel {
  padding: 8px 14px 0;
  background: #f5f7f6;
}
.service-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.service-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: #2f3a45;
}
.service-panel__badge {
  font-size: 11px;
  color: #1a6b4a;
  background: #e8f5ee;
  padding: 2px 8px;
  border-radius: 999px;
}
.service-panel__chips {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.service-chip {
  flex: 1;
  text-align: center;
  font-size: 13px;
  line-height: 32px;
  border-radius: 16px;
  background: #eef6f2;
  color: #1a6b4a;
}
.service-chip--primary {
  background: #1a6b4a;
  color: #fff;
}
.service-panel__hint {
  padding: 8px 0 4px;
}
.service-panel__hint text {
  font-size: 12px;
  line-height: 1.5;
  color: #7a8699;
}
.doctor-scroll {
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding-bottom: 8px;
  white-space: nowrap;
}
.doctor-card {
  display: inline-flex;
  width: 248px;
  flex: 0 0 auto;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(26, 43, 58, 0.06);
}
.doctor-card__avatar {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  flex: 0 0 auto;
  background: #eef2f5;
}
.doctor-card__body {
  flex: 1;
  min-width: 0;
}
.doctor-card__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.doctor-card__name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2a37;
}
.doctor-card__online {
  font-size: 10px;
  color: #1a6b4a;
  background: #e8f5ee;
  padding: 1px 6px;
  border-radius: 999px;
}
.doctor-card__meta,
.doctor-card__hospital,
.doctor-card__good {
  display: block;
  font-size: 11px;
  color: #667085;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doctor-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}
.doctor-card__price {
  font-size: 14px;
  font-weight: 600;
  color: #d9480f;
}
.doctor-card__action {
  font-size: 11px;
  color: #1a6b4a;
}
.voice-recording {
  position: absolute;
  right: 14px;
  bottom: calc(100% - 2px);
  left: 14px;
  z-index: 30;
  pointer-events: none;
}
.voice-recording__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid rgba(10, 104, 67, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 10px 28px rgba(23, 32, 28, 0.12);
}
.voice-recording__pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d64545;
  animation: voice-pulse 1s ease-in-out infinite;
}
.voice-recording__title {
  color: #17201c;
  font-size: 16px;
  font-weight: 700;
}
.voice-recording__hint {
  color: #6f7a74;
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
}
@keyframes voice-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.35);
    opacity: 0.55;
  }
}
.composer-previews {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 6px rgba(23, 32, 28, 0.05);
  overflow-x: auto;
}
.composer-preview {
  position: relative;
  flex: 0 0 auto;
}
.composer-preview__img {
  display: block;
  width: 56px;
  height: 56px;
  border-radius: 10px;
  background: #eef2f1;
}
.composer-preview__remove {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(20, 30, 26, 0.72);
  color: #fff;
  font-size: 14px;
  line-height: 1;
}
.composer-previews__hint {
  flex: 0 0 auto;
  color: #8a958f;
  font-size: 12px;
}
.composer {
  display: flex;
  box-sizing: border-box;
  min-height: 54px;
  padding: 6px 6px 6px 16px;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(10, 104, 67, 0.06);
  border-radius: 28px;
  background: #fff;
  box-shadow: 0 4px 18px rgba(23, 32, 28, 0.06);
}
.composer__input {
  min-width: 0;
  flex: 1;
  height: 38px;
  padding: 0;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  background: transparent;
}
.composer__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}
.composer__action {
  display: flex;
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(10, 104, 67, 0.08);
  border-radius: 50%;
  background: #edf7ef;
  transition: background 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
}
.composer__action--recording {
  border-color: rgba(214, 69, 69, 0.28);
  background: #fff0f0;
  transform: scale(1.04);
}
.composer__action--recording .composer__mic,
.composer__action--recording .composer__mic::before,
.composer__action--recording .composer__mic::after {
  border-color: #d64545;
  background: #d64545;
}
.composer__mic {
  position: relative;
  width: 11px;
  height: 15px;
  box-sizing: border-box;
  border: 2px solid #0a6843;
  border-radius: 6px;
}
.composer__mic::before {
  position: absolute;
  bottom: -7px;
  left: 50%;
  width: 14px;
  height: 8px;
  box-sizing: border-box;
  border: 2px solid #0a6843;
  border-top: 0;
  border-radius: 0 0 10px 10px;
  transform: translateX(-50%);
  content: "";
}
.composer__mic::after {
  position: absolute;
  bottom: -10px;
  left: 50%;
  width: 2px;
  height: 4px;
  background: #0a6843;
  transform: translateX(-50%);
  content: "";
}
.composer__action--send {
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: none;
  background: #c8ddd2;
  line-height: 1;
  transition: background 160ms ease-out, transform 160ms ease-out, opacity 160ms ease-out;
}
.composer__action--send::after {
  border: none;
}
.composer__action--send-ready {
  background: linear-gradient(145deg, #0a6843 0%, #0d7a4f 100%);
  box-shadow: 0 6px 14px rgba(10, 104, 67, 0.24);
}
.composer__action--active {
  opacity: 0.82;
  transform: scale(0.96);
}
.composer__action--disabled {
  opacity: 0.55;
}
.composer-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 8px;
  gap: 4px;
}
.composer-hint__line {
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: #d5ddd8;
}
.composer-hint__text {
  color: #9aa49d;
  font-size: 12px;
}

.elder .message-bubble__text,
.elder .safety-bar__text,
.elder .consent-card {
  font-size: var(--font-subheading, 19px);
}
.elder .quick-topic__label {
  font-size: 15px;
}
.elder .composer__action {
  width: 42px;
  height: 42px;
}
.elder .composer__action--send {
  width: 46px;
  height: 46px;
}
</style>
