export type LoginRecoveryResult = "ready" | "doctor_unavailable";

export interface LoginRecoveryDependencies {
  loadBootstrap: () => Promise<unknown>;
  getDoctorId: () => unknown;
  getSessionDoctorId?: () => unknown;
  hasToken: () => boolean;
  refreshMe: () => Promise<unknown>;
  silentLogin: (doctorId: number) => Promise<unknown>;
  clearSession: () => void;
  isUnauthorized: (error: unknown) => boolean;
  isStaleAuthResult?: (error: unknown) => boolean;
}

function validDoctorId(value: unknown): number | null {
  const doctorId = Number(value);
  return Number.isInteger(doctorId) && doctorId > 0 ? doctorId : null;
}

export async function runLoginRecovery(
  dependencies: LoginRecoveryDependencies
): Promise<LoginRecoveryResult> {
  let doctorId = validDoctorId(dependencies.getDoctorId());
  if (!doctorId) {
    await dependencies.loadBootstrap();
    doctorId = validDoctorId(dependencies.getDoctorId());
  }
  if (!doctorId) return "doctor_unavailable";

  const hadToken = dependencies.hasToken();
  const sessionDoctorId = validDoctorId(dependencies.getSessionDoctorId?.());
  if (hadToken && sessionDoctorId && sessionDoctorId !== doctorId) {
    dependencies.clearSession();
    await dependencies.silentLogin(doctorId);
    return "ready";
  }
  try {
    if (hadToken) await dependencies.refreshMe();
    else await dependencies.silentLogin(doctorId);
  } catch (error) {
    if (dependencies.isStaleAuthResult?.(error)) {
      if (dependencies.hasToken()) await dependencies.refreshMe();
      else await dependencies.silentLogin(doctorId);
    } else {
      if (!hadToken || !dependencies.isUnauthorized(error)) throw error;
      dependencies.clearSession();
      await dependencies.silentLogin(doctorId);
    }
  }
  const refreshedDoctorId = validDoctorId(dependencies.getSessionDoctorId?.());
  if (hadToken && refreshedDoctorId && refreshedDoctorId !== doctorId) {
    dependencies.clearSession();
    await dependencies.silentLogin(doctorId);
  }
  return "ready";
}
