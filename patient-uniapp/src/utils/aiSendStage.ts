const STORAGE_KEY = "mpAiSendLastStage";

export type AiSendStage =
  | "idle"
  | "bootstrap"
  | "login_ready"
  | "phone_ready"
  | "identity_ready"
  | "scope_ready"
  | "consent_ready"
  | "snapshot_ready"
  | "request_started"
  | "request_done"
  | "aborted"
  | "blocked";

export function markAiSendStage(
  stage: AiSendStage | string,
  detail?: Record<string, unknown>
): void {
  const payload = {
    stage: String(stage || ""),
    at: Date.now(),
    detail: detail || null,
  };
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  try {
    console.info("[mp-ai-send]", payload.stage, detail || "");
  } catch {
    /* ignore */
  }
}

/** 失败时带阶段码 toast，便于对照 Nginx / mp_ai_audit 排查 */
export function failAiSendStage(
  stage: AiSendStage | string,
  title: string,
  detail?: Record<string, unknown>
): void {
  markAiSendStage(stage, { ...(detail || {}), failed: true, title });
  const message = `${String(title || "发送未完成").slice(0, 28)}（${String(stage)}）`;
  uni.showToast({ title: message.slice(0, 40), icon: "none" });
}
