<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { onHide, onShareAppMessage, onShow } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import type { ChatMessage } from "@chunyu/patient-design/types";
import AppIcon from "../../components/AppIcon.vue";
import { postMpAiChat } from "../../api/aiChat";
import { ApiError, getMpToken } from "../../api/auth";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { useConsultationStore } from "../../stores/consultation";
import {
  CONTEXT_TURNS,
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
import { launchChunyu } from "../../api/chunyuOpen";
import type { AssistantRole } from "../../types/v32";

const store = useAppStore();
const auth = useAuthStore();
const consultation = useConsultationStore();
const { role: assistantRole, contextLine } = storeToRefs(consultation);
const text = ref("");
const sending = ref(false);
const failedPayload = ref<{
  payload: { text: string; role: AssistantRole; images?: string[] };
  snapshot: MpAiIdentitySnapshot;
} | null>(null);
/** 待发送图片（data URL，最多 3 张，单张 ≤4MB） */
const pendingImages = ref<string[]>([]);
const sessionId = ref("");
const messages = ref<ChatMessage[]>([]);
const quickTopics = consultation.quickTopics;
const aiScope = computed(() => String(auth.storageScopeId || "").trim());
let sendSeq = 0;
let sendPending = false;
/** 隐藏/卸载/清空会话时递增，用于作废仍在 await 的 onSend */
let sendGate = 0;
const aiRuntime = createMpAiRuntimeIsolation(createMpAiSessionId);
const SEND_TIMEOUT_MS = 45000;
const CONSULT_RETURN_URL = "/pages/consult/index";
const lastMessageId = computed(() => `m-${messages.value[messages.value.length - 1]?.id || "welcome"}`);
const canSend = computed(() => Boolean(text.value.trim()) || pendingImages.value.length > 0);
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

function welcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text: "",
  };
}

const WELCOME_TEXT = "你好，我可以帮你梳理症状、报告和复诊安排。";
const ICON_SHIELD = "/static/consult-ui/shield.png";
const ICON_DOCTOR = "/static/consult-ui/doctor.png";
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
    const rows = loadMpAiTranscript(scope);
    if (rows.length) {
      messages.value = rows.map((row) => ({
        id: row.id,
        role: row.role,
        text: row.text,
      }));
      return;
    }
  }
  messages.value = [welcomeMessage()];
  void typewriterSet("welcome", WELCOME_TEXT);
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
    const onlyWelcome =
      messages.value.length === 0 ||
      (messages.value.length === 1 && messages.value[0]?.id === "welcome");
    if (!onlyWelcome) return;
    const rows = loadMpAiTranscript(scope);
    if (rows.length) hydrateMessagesForScope(scope);
  })();
});

onShareAppMessage(() => ({
  title: "春雨健康患者端",
  path: store.buildSharePath("/pages/consult/index"),
}));

function resetToWelcome() {
  typewriterToken += 1;
  messages.value = [welcomeMessage()];
  void typewriterSet("welcome", WELCOME_TEXT);
}

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
      title: "AI 服务提示",
      content:
        "你的健康问题会发送至当前配置的 AI 服务进行处理。请不要填写非必要的姓名、证件号、联系方式等身份信息。",
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
      uni.showToast({ title: "需同意后才能使用 AI 咨询", icon: "none" });
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

function buildHistoryForApi(excludeText?: string) {
  const rows = messages.value
    .filter((m) => m.id !== "welcome" && m.text && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      text: String(m.text).slice(0, 500),
    }));
  const trimmed = excludeText
    ? rows.filter((r, idx) => !(idx === rows.length - 1 && r.role === "user" && r.text === excludeText))
    : rows;
  return trimmed.slice(-CONTEXT_TURNS);
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
    markAiSendStage("request_started", {
      role: payload.role,
      doctorId: snapshot.doctorId,
    });
    const { reply } = await postMpAiChat({
      doctorId: String(snapshot.doctorId),
      text: payload.text,
      images: payload.images,
      sessionId: sessionId.value,
      history: buildHistoryForApi(payload.text),
      assistantRole: payload.role === "life" ? "life" : "health",
      pageContext: contextLine.value || undefined,
      authToken: snapshot.token,
    });
    markAiSendStage("request_done");
    if (seq !== sendSeq || !isCurrentAiSnapshot(snapshot)) return;
    const id = String(reply?.id || `a-${Date.now()}`);
    const fullText = String(reply?.text || "");
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
      const msg = err instanceof ApiError ? err.message : "发送失败，请稍后重试";
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
      "这个需求同时包含健康判断和服务办理。我会先由健康助手确认用药或风险边界，再请你确认是否把必要信息共享给生活管家继续办理。"
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

function sendQuickTopic(topic: string) {
  if (sending.value) return;
  text.value = topic;
  void onSend();
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
  uni.showActionSheet({
    itemList: ["上传检查报告", "上传用药照片", "打开健康档案"],
    success: (res) => {
      if (res.tapIndex === 2) {
        uni.navigateTo({ url: "/pages/records/index" });
        return;
      }
      if (pendingImages.value.length >= 3) {
        uni.showToast({ title: "最多上传 3 张图片", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: 1,
        sizeType: ["compressed"],
        success: (chooseRes) => {
          const filePath = chooseRes.tempFilePaths && chooseRes.tempFilePaths[0];
          if (!filePath) return;
          // 读取为 base64 data URL，前端校验大小与格式
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
                else if (lower.endsWith(".gif")) mime = "image/gif";
                pendingImages.value = [...pendingImages.value, `data:${mime};base64,${b64}`].slice(0, 3);
                uni.showToast({ title: "图片已添加，可继续描述或直接发送", icon: "none" });
              },
              fail: () => {
                uni.showToast({ title: "图片读取失败，请重试", icon: "none" });
              },
            });
          } catch (e) {
            uni.showToast({ title: "图片读取失败，请重试", icon: "none" });
          }
        },
      });
    },
  });
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

async function openRealDoctor(kind: "graph" | "video" | "phone") {
  const ok = await ensureLogin(CONSULT_RETURN_URL);
  if (!ok) return;
  await launchChunyu(kind, {
    text: text.value.trim() || undefined,
  });
}
</script>

<template>
  <view class="page" :class="{ elder: store.elderMode }">
    <view class="safety-bar">
      <image class="safety-bar__icon" :src="ICON_SHIELD" mode="aspectFit" />
      <text class="safety-bar__text">如有急症，请立即线下就医</text>
      <view class="safety-bar__clear pressable" aria-role="button" aria-label="清空咨询记录" @click="onClearChat">
        <text>清空</text>
      </view>
    </view>

    <scroll-view scroll-y class="conversation" :scroll-into-view="lastMessageId">
      <view v-if="assistantRole === 'handoff'" class="consent-card">
        <text class="consent-card__title">需要共享必要上下文</text>
        <text class="consent-card__desc">例如药品名称、当前用法、剩余数量和服务需求。共享前会再次确认。</text>
      </view>

      <view
        v-for="message in messages"
        :id="`m-${message.id}`"
        :key="message.id"
        class="message-row"
        :class="[`message-row--${message.role}`]"
      >
        <view v-if="message.role !== 'user'" class="message-avatar">
          <image class="message-avatar__img" :src="ICON_DOCTOR" mode="aspectFit" />
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
          </view>
        </view>
      </view>

      <view v-if="messages.length <= 1" class="quick-topics">
        <view
          v-for="topic in quickTopics"
          :key="topic.label"
          class="quick-topic pressable"
          aria-role="button"
          @click="sendQuickTopic(topic.text)"
        >
          <image class="quick-topic__icon" :src="topic.iconSrc" mode="aspectFit" />
          <text class="quick-topic__label">{{ topic.label }}</text>
        </view>
      </view>

      <view v-if="sending" class="sending-state">
        <text class="sending-state__dot">●</text>
        <text> 正在等待健康助手回复…</text>
      </view>
      <view
        v-if="failedPayload"
        class="failed-state"
        aria-role="button"
        aria-label="发送失败，点击重试"
        @click="retryFailed"
      >
        <AppIcon name="status-error" :size="24" tone="danger" />
        <view>
          <text class="failed-state__title">回复请求发送失败</text>
          <text class="failed-state__sub">您的消息已保留，点击这里重试</text>
        </view>
        <AppIcon name="action-refresh" :size="18" tone="primary" />
      </view>
      <view class="scroll-spacer" />
    </scroll-view>

      <view class="real-doctor">
        <text class="real-doctor__label">需要执业医生接诊</text>
        <view class="real-doctor__row">
          <view class="real-doctor__btn pressable" aria-role="button" @click="openRealDoctor('graph')">图文问诊</view>
          <view class="real-doctor__btn pressable" aria-role="button" @click="openRealDoctor('video')">视频问诊</view>
          <view class="real-doctor__btn pressable" aria-role="button" @click="openRealDoctor('phone')">电话问诊</view>
        </view>
      </view>

      <view class="composer-wrap">
      <view v-if="voiceRecording" class="voice-recording" aria-live="polite">
        <view class="voice-recording__panel">
          <view class="voice-recording__pulse" aria-hidden="true" />
          <text class="voice-recording__title">正在聆听</text>
          <text class="voice-recording__hint">{{ voicePartial || "再次点击麦克风结束，识别结果将填入输入框" }}</text>
        </view>
      </view>
      <view v-if="pendingImages.length" class="composer-previews">
        <view v-for="(img, idx) in pendingImages" :key="idx" class="composer-preview">
          <image class="composer-preview__img" :src="img" mode="aspectFill" @tap="previewImage(img, pendingImages)" />
          <view class="composer-preview__remove pressable" aria-role="button" aria-label="移除图片" @click="removePendingImage(idx)">
            <text>×</text>
          </view>
        </view>
        <text class="composer-previews__hint">发送后将随消息提交给 AI 识别</text>
      </view>
      <view class="composer">
        <input
          v-model="text"
          class="composer__input"
          confirm-type="send"
          placeholder="描述你的健康问题"
          aria-label="描述你的健康问题"
          :disabled="sending"
          @confirm="onSend"
        />
        <view class="composer__actions">
          <view
            class="composer__action pressable"
            :class="{ 'composer__action--recording': voiceRecording }"
            aria-role="button"
            :aria-label="voiceRecording ? '结束录音' : '开始语音输入'"
            @tap.stop="onVoiceToggle"
          >
            <view class="composer__mic" aria-hidden="true" />
          </view>
          <view
            class="composer__action pressable"
            aria-role="button"
            aria-label="上传资料"
            @click="onAttachTap"
          >
            <AppIcon name="attachment" :size="20" tone="primary" />
          </view>
          <button
            class="composer__action composer__action--send pressable"
            :class="{
              'composer__action--send-ready': canSend,
              'composer__action--disabled': sending,
            }"
            :disabled="sending"
            hover-class="composer__action--active"
            aria-label="发送消息"
            @tap.stop="onSend"
          >
            <AppIcon name="action-send" :size="18" tone="inverse" :state="sending ? 'loading' : 'idle'" />
          </button>
        </view>
      </view>
      <view class="composer-hint">
        <view class="composer-hint__line" />
        <text class="composer-hint__text">点击麦克风开始/结束录音；上拉可查看更多资料上传方式</text>
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
  background: #f5f7f6;
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
  margin: 4px 50px 16px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}
.sending-state__dot {
  color: #176b52;
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
.real-doctor {
  padding: 8px 14px 0;
  background: #f5f7f6;
}
.real-doctor__label {
  display: block;
  font-size: 12px;
  color: #7a8699;
  margin-bottom: 6px;
}
.real-doctor__row {
  display: flex;
  gap: 8px;
}
.real-doctor__btn {
  flex: 1;
  text-align: center;
  font-size: 13px;
  line-height: 32px;
  border-radius: 16px;
  background: #eef6f2;
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
