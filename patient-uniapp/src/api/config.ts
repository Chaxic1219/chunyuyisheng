/**
 * 小程序联调配置。
 * - 默认连接线上联调环境；本地全栈联调时在 `.env.local` 设 `VITE_API_BASE=http://127.0.0.1:3200`
 * - USE_MOCK=true：bootstrap / 表单走本地 mock（无需后端）
 * - CONSULT_USE_REAL=true：咨询发送永不回退本地假分诊
 */
export const USE_MOCK = false;
/** 仅本地显式打开时允许 V32 回退 mock；默认 false */
export const V32_ALLOW_MOCK_FALLBACK =
  String(import.meta.env.VITE_V32_ALLOW_MOCK_FALLBACK || "") === "1";
/** 生产/体验请用 HTTPS 域名；开发工具联调见 .env.development */
export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "https://yht.chunyutianxia.com";
export const CONSULT_USE_REAL = true;
/**
 * 绑手机方式：仅微信官方一键取号（getPhoneNumber）。
 * 已放弃短信验证码绑定。
 */
export type PhoneBindMode = "wechat";

export const PHONE_BIND_MODE: PhoneBindMode = "wechat";

export function allowsSmsVerification(_smsAvailable: unknown): boolean {
  return false;
}
