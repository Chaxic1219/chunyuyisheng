export interface ApiErrorDetails {
  status: number;
  code: string;
  message: string;
}

const SAFE_MESSAGES: Record<string, string> = {
  phone_verification_required: "请先验证当前手机号",
  phone_mismatch: "填写的手机号必须与当前已验证账号一致",
  forbidden: "当前账号无权执行此操作",
  unauthorized: "登录状态已失效，请重新登录",
  invalid_session: "登录状态已失效，请重新登录",
  session_expired: "登录状态已失效，请重新登录",
  session_revoked: "登录状态已失效，请重新登录",
  rate_limited: "请求过于频繁，请稍后再试",
  too_many_requests: "请求过于频繁，请稍后再试",
  network_error: "网络连接失败，请检查网络后重试",
  doctor_required: "服务信息尚未加载",
  doctor_unavailable: "当前服务暂不可用",
  sms_unavailable: "短信服务当前不可用，请稍后再试",
  sms_send_failed: "短信发送失败，请稍后再试",
  sms_provider_error: "短信发送失败，请稍后再试",
  sms_rate_limited: "发送过于频繁，请稍后再试",
};

function stableCode(status: number, rawCode: unknown): string {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (/^[a-z][a-z0-9_]{0,63}$/.test(code)) return code;
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "request_failed";
}

export function resolveApiError(status: number, rawCode: unknown): ApiErrorDetails {
  const safeStatus = Number.isInteger(status) && status >= 0 ? status : 0;
  const code = stableCode(safeStatus, rawCode);
  let message = SAFE_MESSAGES[code];
  if (!message) {
    if (safeStatus >= 500) message = "服务暂时不可用，请稍后再试";
    else if (safeStatus === 403) message = "当前账号无权执行此操作";
    else if (safeStatus === 400) message = "请求信息有误，请检查后重试";
    else message = "请求失败，请稍后再试";
  }
  return { status: safeStatus, code, message };
}
