import { getMpToken } from "./auth";
import { API_BASE } from "./config";

export type ChunyuKind = "graph" | "video" | "phone" | "expert" | "orders" | "report";

export interface ChunyuJump {
  ok: boolean;
  kind: string;
  configured?: boolean;
  h5Url?: string;
  wxAppId?: string;
  wxPath?: string;
  wxEnv?: string;
  wxEnvVersion?: "develop" | "trial" | "release";
  problemId?: number | string | null;
  serviceId?: number | string | null;
  orderId?: number | null;
  note?: string;
  error?: string;
  message?: string;
}

async function request(path: string, body?: Record<string, unknown>): Promise<ChunyuJump> {
  const token = getMpToken();
  const res = await uni.request({
    url: `${API_BASE}${path}`,
    method: body ? "POST" : "GET",
    header: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body,
    timeout: 20000,
  });
  return (res.data || {}) as ChunyuJump;
}

export function mpChunyuJump(kind: ChunyuKind, extra?: Record<string, unknown>) {
  return request("/api/mp/chunyu/jump", { kind, ...(extra || {}) });
}

export function mpChunyuGreenChannel(body?: Record<string, unknown>) {
  return request("/api/mp/chunyu/green-channel", body || {});
}

export async function launchChunyu(kind: ChunyuKind, extra?: Record<string, unknown>) {
  uni.showLoading({ title: "正在连接春雨医生", mask: true });
  try {
    const jump = await mpChunyuJump(kind, extra);
    if (!jump.ok && jump.error) {
      uni.showToast({ title: jump.message || "暂时无法打开春雨入口", icon: "none" });
      return false;
    }
    openChunyuJump(jump);
    return true;
  } catch {
    uni.showToast({ title: "暂时无法打开春雨入口", icon: "none" });
    return false;
  } finally {
    uni.hideLoading();
  }
}

export function resolveChunyuWxEnvVersion(jump: ChunyuJump): "develop" | "trial" | "release" {
  const fromApi = String(jump.wxEnvVersion || "").trim();
  if (fromApi === "develop" || fromApi === "trial" || fromApi === "release") return fromApi;
  return "release";
}

const CHUNYU_WX_APPID = "wx214b7e2bcde837d6";

const CHUNYU_WEBVIEW = "/pages/services/benefit-webview";

const CHUNYU_KIND_TITLE: Record<string, string> = {
  graph: "图文问诊",
  report: "报告解读",
  expert: "专家问诊",
  orders: "我的问诊",
  video: "视频问诊",
  phone: "电话问诊",
};

function isH5WrapPath(path: string): boolean {
  return /^pages\/index\/index\?url=/i.test(String(path || "").trim());
}

function chunyuTitle(kind?: string): string {
  return CHUNYU_KIND_TITLE[String(kind || "").trim()] || "春雨医生";
}

function openH5WebView(h5Url: string, kind?: string) {
  const url = String(h5Url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    uni.showToast({ title: "春雨入口暂不可用", icon: "none" });
    return false;
  }
  const title = chunyuTitle(kind);
  uni.navigateTo({
    url: `${CHUNYU_WEBVIEW}?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
    fail: () => copyFallback({ ok: true, kind: kind || "", h5Url: url }),
  });
  return true;
}

function openMiniProgram(jump: ChunyuJump, appId: string, path: string, h5Url: string) {
  const envVersion = resolveChunyuWxEnvVersion(jump);
  uni.navigateToMiniProgram({
    appId,
    path,
    extraData: {},
    envVersion,
    success: () => {},
    fail: () => {
      if (h5Url) openH5WebView(h5Url, jump.kind);
      else copyFallback(jump);
    },
  });
}

export function openChunyuJump(jump: ChunyuJump) {
  const h5Url = String(jump.h5Url || "").trim();
  const wxPath = String(jump.wxPath || "").trim();
  const appId = String(jump.wxAppId || CHUNYU_WX_APPID).trim();

  if (wxPath && !isH5WrapPath(wxPath) && appId) {
    openMiniProgram(jump, appId, wxPath, h5Url);
    return;
  }

  if (h5Url) {
    openH5WebView(h5Url, jump.kind);
    return;
  }

  copyFallback(jump);
}

function copyFallback(jump: ChunyuJump) {
  const url = String(jump.h5Url || "").trim();
  if (!url) {
    uni.showToast({ title: jump.message || "春雨入口暂不可用", icon: "none" });
    return;
  }
  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: "已复制春雨入口，请在微信打开", icon: "none", duration: 2500 }),
  });
}
