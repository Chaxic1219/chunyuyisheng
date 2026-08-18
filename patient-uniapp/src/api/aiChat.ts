import type { ChatMessage } from "@chunyu/patient-design/types";
import { createApiError } from "./auth";
import { API_BASE } from "./config";
import { AI_CONSENT_VERSION } from "../utils/mpAiSession";

export type MpAiHistoryItem = { role: "user" | "assistant"; text: string };

type ServerReply = {
  reply?: ChatMessage;
  error?: string;
  sessionId?: string;
};

function requestOnce(opts: {
  url: string;
  header: Record<string, string>;
  data: Record<string, unknown>;
  timeout: number;
}): Promise<UniApp.RequestSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try {
          const t = task as { abort?: () => void };
          if (t && typeof t.abort === "function") t.abort();
        } catch {
          /* ignore */
        }
        reject(createApiError(0, "request_timeout"));
      });
    }, opts.timeout);

    const task = uni.request({
      url: opts.url,
      method: "POST",
      header: opts.header,
      timeout: opts.timeout,
      data: opts.data,
      success: (res) => finish(() => resolve(res)),
      fail: (err) =>
        finish(() =>
          reject(createApiError(0, "network_error"))
        ),
    });
  });
}

export async function postMpAiChat(opts: {
  doctorId: string;
  text: string;
  images?: string[];
  sessionId: string;
  history?: MpAiHistoryItem[];
  assistantRole?: string;
  pageContext?: string;
  authToken: string;
}): Promise<{ reply: ChatMessage }> {
  const header: Record<string, string> = { "Content-Type": "application/json" };
  const authToken = String(opts.authToken || "").trim();
  if (!authToken) throw createApiError(401, "unauthorized");
  header.Authorization = `Bearer ${authToken}`;

  const body: Record<string, unknown> = {
    doctorId: String(opts.doctorId || ""),
    text: opts.text,
    sessionId: opts.sessionId,
    history: Array.isArray(opts.history) ? opts.history.slice(-10) : [],
    sensitiveDataConsent: true,
    consentVersion: AI_CONSENT_VERSION,
  };
  if (opts.assistantRole) body.assistantRole = opts.assistantRole;
  if (opts.pageContext) body.pageContext = opts.pageContext;
  if (Array.isArray(opts.images) && opts.images.length) body.images = opts.images.slice(0, 3);

  const res = await requestOnce({
    url: `${API_BASE}/api/mp/ai-chat`,
    header,
    timeout: 40000,
    data: body,
  });

  const data = (res.data || {}) as ServerReply;
  const code = Number(res.statusCode || 0);
  if (code >= 400) {
    throw createApiError(code, data.error);
  }
  if (data.error) throw createApiError(502, data.error);
  if (!data.reply || !data.reply.text) throw createApiError(502, "empty_ai_reply");
  return {
    reply: {
      id: data.reply.id || `a-${Date.now()}`,
      role: "assistant",
      text: String(data.reply.text),
    },
  };
}
