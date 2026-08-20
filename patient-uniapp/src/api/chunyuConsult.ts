import type { ChatMessage } from "@chunyu/patient-design/types";
import { createApiError, getMpToken } from "./auth";
import { API_BASE } from "./config";
import { CHUNYU_WX_APPID, resolveChunyuWxEnvVersion } from "./chunyuOpen";

export type ChunyuRecommendDoctor = {
  id: string;
  name: string;
  title: string;
  hospital: string;
  hospitalGrade: string;
  clinic: string;
  goodAt: string;
  image: string;
  priceFen: number;
  goodRate: string;
  isActive?: boolean;
  isFamous?: boolean;
};

type ConsultReply = {
  ok?: boolean;
  pending?: boolean;
  problemId?: number | string;
  status?: string;
  message?: string;
  error?: string;
  recommendations?: ChunyuRecommendDoctor[];
  reply?: ChatMessage & { doctorName?: string };
  doctor?: { id?: string; name?: string; title?: string; image?: string; hospital?: string };
  wxAppId?: string;
  wxPath?: string;
  wxEnvVersion?: "develop" | "trial" | "release";
  h5Url?: string;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function requestConsult(path: string, authToken: string, body?: Record<string, unknown>): Promise<ConsultReply> {
  const token = String(authToken || "").trim();
  if (!token) throw createApiError(401, "unauthorized");
  const res = await uni.request({
    url: `${API_BASE}${path}`,
    method: "POST",
    header: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    data: body || {},
    timeout: 120000,
  });
  const data = (res.data || {}) as ConsultReply;
  const code = Number(res.statusCode || 0);
  if (code >= 400) throw createApiError(code, data.error || data.message);
  if (data.error) throw createApiError(502, data.error);
  return data;
}

export function formatDoctorPrice(priceFen: number): string {
  const fen = Number(priceFen) || 0;
  if (fen <= 0) return "咨询";
  return `¥${(fen / 100).toFixed(fen % 100 === 0 ? 0 : 1)}`;
}

export async function postChunyuConsultReset(authToken: string) {
  return requestConsult("/api/mp/chunyu/consult/reset", authToken);
}

export async function postChunyuConsultPoll(authToken: string) {
  return requestConsult("/api/mp/chunyu/consult/poll", authToken);
}

export async function postChunyuConsultRecommend(authToken: string, ask: string) {
  const data = await requestConsult("/api/mp/chunyu/consult/recommend", authToken, { ask });
  return Array.isArray(data.recommendations) ? data.recommendations : [];
}

export async function openChunyuDoctorPage(doctorId: string) {
  const token = getMpToken();
  if (!token) {
    uni.showToast({ title: "请先登录", icon: "none" });
    return false;
  }
  uni.showLoading({ title: "正在打开医生主页", mask: true });
  try {
    const data = await requestConsult("/api/mp/chunyu/consult/doctor-page", token, { doctorId });
    const appId = String(data.wxAppId || CHUNYU_WX_APPID).trim();
    const wxPath = String(data.wxPath || "").trim();
    const envVersion = resolveChunyuWxEnvVersion(data);
    if (!appId || !wxPath) {
      uni.showToast({ title: "暂时无法打开医生主页", icon: "none" });
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      uni.navigateToMiniProgram({
        appId,
        path: wxPath,
        envVersion,
        success: () => resolve(true),
        fail: () => {
          uni.showToast({ title: "请稍后重试", icon: "none" });
          resolve(false);
        },
      });
    });
  } finally {
    uni.hideLoading();
  }
}

export async function postChunyuConsultSend(opts: {
  text: string;
  images?: string[];
  authToken: string;
}): Promise<{ reply: ChatMessage; pending?: boolean; recommendations?: ChunyuRecommendDoctor[] }> {
  const text = String(opts.text || "").trim();
  const images = Array.isArray(opts.images) ? opts.images.slice(0, 3) : [];
  if (!text && !images.length) throw createApiError(400, "empty_content");

  let data = await requestConsult("/api/mp/chunyu/consult/send", opts.authToken, { text, images });
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

  if (data.reply?.text) {
    return { reply: normalizeReply(data.reply), pending: false, recommendations };
  }
  if (!data.pending) {
    throw createApiError(502, "empty_doctor_reply");
  }

  for (let i = 0; i < 24; i += 1) {
    await sleep(3000);
    data = await postChunyuConsultPoll(opts.authToken);
    if (data.reply?.text) {
      return { reply: normalizeReply(data.reply), pending: false, recommendations };
    }
    if (!data.pending) break;
  }

  return {
    pending: true,
    recommendations,
    reply: {
      id: `wait-${Date.now()}`,
      role: "assistant",
      text: "医生正在接诊中，回复后会显示在这里。您也可以稍后再进入本页查看。",
    },
  };
}

function normalizeReply(raw: ChatMessage & { doctorName?: string }): ChatMessage {
  const text = String(raw.text || "").trim();
  const doctorName = String(raw.doctorName || "").trim();
  const prefix = doctorName ? `【${doctorName}】\n` : "";
  return {
    id: String(raw.id || `d-${Date.now()}`),
    role: "assistant",
    text: prefix + text,
  };
}
