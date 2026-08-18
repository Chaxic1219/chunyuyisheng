import { ApiError, getMpToken } from "../api/auth";
import { getSettledDoctors, getMyDoctors } from "../api/patient";
import { useAuthStore } from "../stores/auth";
import { useAppStore } from "../stores/app";

export type DoctorAffiliationResult = "ready" | "need_select" | "failed";

function openSelectDoctorPage(returnUrl: string) {
  const url = `/pages/auth/select-doctor?returnUrl=${encodeURIComponent(returnUrl)}`;
  uni.redirectTo({
    url,
    fail: () => {
      uni.navigateTo({ url });
    },
  });
}

function sourceDoctorId(app: ReturnType<typeof useAppStore>): number | null {
  const n = Number(app.sourceDoctorId || "");
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function adoptDoctor(
  auth: ReturnType<typeof useAuthStore>,
  app: ReturnType<typeof useAppStore>,
  doctorId: number
): Promise<boolean> {
  try {
    app.rememberDoctorId(doctorId);
    await auth.silentLogin(doctorId, { claimDoctor: true });
    await app.load(true, doctorId).catch(() => undefined);
    return Number(auth.sessionDoctorId) === doctorId && !auth.needsDoctorSelection;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/**
 * 绑手机之后的医生归属闸门。
 * @returns ready=可继续业务；need_select=已跳转选医生页；failed=中断
 */
export async function resolveDoctorAffiliation(
  returnUrl: string
): Promise<DoctorAffiliationResult> {
  const auth = useAuthStore();
  const app = useAppStore();
  if (!auth.phoneBound) return "failed";

  if (getMpToken()) {
    try {
      await auth.refreshMe();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        /* 刷新失败不阻断，继续用本地会话判断 */
      }
    }
  }

  if (!auth.needsDoctorSelection && Number(auth.sessionDoctorId) > 0) {
    app.rememberDoctorId(auth.sessionDoctorId);
    return "ready";
  }

  const fromSource = sourceDoctorId(app);
  if (fromSource) {
    const ok = await adoptDoctor(auth, app, fromSource);
    if (ok) return "ready";
  }

  try {
    const mine = await getMyDoctors();
    const first = mine.find((d) => Number(d.doctorId) > 0);
    if (first) {
      const ok = await adoptDoctor(auth, app, Number(first.doctorId));
      if (ok) return "ready";
    }
  } catch {
    /* 查询失败：宁可进选医生页，不误绑 */
  }

  try {
    const settled = await getSettledDoctors();
    if (!settled.length) {
      uni.showToast({ title: "暂无可选医生，请稍后再试", icon: "none" });
      return "failed";
    }
  } catch {
    /* 列表失败仍进选医生页，由页面自行展示错误 */
  }

  openSelectDoctorPage(returnUrl);
  return "need_select";
}
