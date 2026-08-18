import { ApiError, getMpToken } from "../api/auth";
import { useAuthStore } from "../stores/auth";
import { useAppStore } from "../stores/app";
import { runLoginRecovery } from "./loginRecovery";
import { isStaleAuthResult } from "./authRefresh";
import { isExplicitSignedOut } from "./signedOut";
import { resolveDoctorAffiliation } from "./doctorAffiliation";

export const ARCHIVE_PROFILE_URL = "/pages/archive/profile";

function openBindPage(returnUrl: string) {
  const url = `/pages/auth/bind?returnUrl=${encodeURIComponent(returnUrl)}`;
  uni.redirectTo({
    url,
    fail: () => {
      uni.navigateTo({ url });
    },
  });
}

async function performLoginRecovery(
  auth: ReturnType<typeof useAuthStore>,
  app: ReturnType<typeof useAppStore>,
  expectedDoctorId: number
): Promise<boolean> {
  try {
    const result = await runLoginRecovery({
      loadBootstrap: () => app.load(),
      getDoctorId: () => Number(app.doctor?.id),
      getSessionDoctorId: () => auth.sessionDoctorId,
      hasToken: () => !!getMpToken(),
      refreshMe: () => auth.refreshMe(),
      silentLogin: (id) => auth.silentLogin(id),
      clearSession: () => auth.clear(),
      isUnauthorized: (error) => error instanceof ApiError && error.status === 401,
      isStaleAuthResult,
    });
    if (result === "doctor_unavailable") {
      uni.showToast({ title: "服务信息尚未加载", icon: "none" });
      return false;
    }
    return Number(app.doctor?.id) === expectedDoctorId;
  } catch (error) {
    const title =
      error instanceof ApiError && error.status === 429
        ? error.message
        : "登录失败，请重试";
    uni.showToast({ title, icon: "none" });
    return false;
  }
}

/** @returns true if phone-bound session ready with doctor; false if redirected */
export async function ensureLogin(returnUrl: string): Promise<boolean> {
  const auth = useAuthStore();
  const app = useAppStore();
  if (!app.doctor?.id) await app.load().catch(() => undefined);

  if (isExplicitSignedOut()) {
    if (getMpToken()) auth.clear();
    openBindPage(returnUrl);
    return false;
  }

  // 已有 token：先 refresh，避免用 bootstrap 默认医生 silentLogin 误建档
  if (getMpToken()) {
    try {
      await auth.refreshMe();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        auth.clear();
      } else if (!(error instanceof ApiError && error.status === 429)) {
        // 非鉴权失败时若本地已认为绑过手机，仍走归属闸门
        if (!auth.phoneBound) {
          uni.showToast({ title: "登录失败，请重试", icon: "none" });
          return false;
        }
      } else {
        uni.showToast({ title: error.message, icon: "none" });
        return false;
      }
    }
  }

  if (auth.phoneBound && getMpToken()) {
    const affiliation = await resolveDoctorAffiliation(returnUrl);
    return affiliation === "ready";
  }

  const doctorId = Number(app.doctor?.id);
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    uni.showToast({ title: "服务信息尚未加载", icon: "none" });
    return false;
  }

  const ready = await auth.runRecovery(
    doctorId,
    () => performLoginRecovery(auth, app, doctorId)
  );
  if (!ready) return false;
  if (!auth.phoneBound) {
    openBindPage(returnUrl);
    return false;
  }
  const affiliation = await resolveDoctorAffiliation(returnUrl);
  return affiliation === "ready";
}

/** 上传/完善档案：必须先绑手机号，再进入建档页 */
export async function openArchiveProfile(returnUrl = ARCHIVE_PROFILE_URL): Promise<boolean> {
  const ok = await ensureLogin(returnUrl);
  if (!ok) return false;
  uni.navigateTo({
    url: ARCHIVE_PROFILE_URL,
    fail: () => {
      uni.redirectTo({ url: ARCHIVE_PROFILE_URL });
    },
  });
  return true;
}
