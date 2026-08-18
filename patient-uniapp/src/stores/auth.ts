import { defineStore } from "pinia";
import { ref } from "vue";
import {
  ApiError,
  forceClearMpToken,
  getMpToken,
  mpLogin,
  mpLogout,
  mpMe,
  setMpToken,
} from "../api/auth";
import { useAppStore } from "./app";
import { buildStorageScope, clearScopedStorage } from "../utils/storageScope";
import { createAuthStateCoordinator } from "../utils/authStateCoordinator";
import { guardedAuthRefresh } from "../utils/authRefresh";
import {
  AuthRecoveryError,
  recoverAfterStorageFailure,
} from "../utils/authRecovery";
import { createSerialLatestExecutor } from "../utils/serialLatestExecutor";
import { createKeyedSingleFlight } from "../utils/singleFlight";
import { TokenStorageError } from "../utils/tokenStorage";
import { clearExplicitSignedOut, setExplicitSignedOut } from "../utils/signedOut";

export const useAuthStore = defineStore("auth", () => {
  const authState = createAuthStateCoordinator();
  const recoveryFlights = createKeyedSingleFlight<boolean>();
  const authEpoch = ref(0);
  const sessionDoctorId = ref<number | null>(null);
  const phoneBound = ref(false);
  const needsDoctorSelection = ref(false);
  const hasProfile = ref(false);
  const phoneMasked = ref("");
  const profileName = ref("");
  const avatarUrl = ref("");
  const patientId = ref<number | null>(null);
  const personId = ref<number | null>(null);
  const storageScopeId = ref("");
  let latestDesiredDoctorId: number | null = null;
  let recoveryOperationId = 0;

  function syncAuthContext() {
    authEpoch.value = authState.epoch;
    sessionDoctorId.value = authState.doctorId;
  }

  function applyProfile(data: any) {
    phoneBound.value = !!data?.phoneBound;
    needsDoctorSelection.value = !!data?.needsDoctorSelection;
    hasProfile.value = !!data?.hasProfile;
    phoneMasked.value = data?.phoneMasked || "";
    profileName.value = data?.profileSummary?.name || "";
    avatarUrl.value = data?.profileSummary?.avatarUrl || data?.avatarUrl || "";
    patientId.value = data?.patientId ?? null;
    personId.value = data?.personId ?? null;
    const candidateScope = String(data?.storageScopeId || "").trim();
    storageScopeId.value = /^mps_[A-Za-z0-9_-]{43}$/.test(candidateScope)
      ? candidateScope
      : "";
  }

  function applyMe(data: any) {
    authState.rememberDoctor(data?.doctorId);
    syncAuthContext();
    applyProfile(data);
  }

  function captureCurrentScopes(scopeToken = getMpToken()) {
    const app = useAppStore();
    const doctorId = sessionDoctorId.value || app.doctor?.id;
    return {
      scope: buildStorageScope({
        doctorId,
        patientId: patientId.value,
        personId: personId.value,
        token: scopeToken,
      }),
      aiScope: storageScopeId.value,
    };
  }

  function clearCapturedScopes(scopes: { scope: string; aiScope: string }) {
    try {
      clearScopedStorage(scopes.aiScope);
    } catch {
      // AI 身份缓存清理失败不阻断通用旧缓存清理。
    }
    try {
      clearScopedStorage(scopes.scope);
    } catch {
      // 新会话已提交，旧通用缓存清理失败不应回滚认证状态。
    }
  }

  function commitSession(data: any) {
    const token = typeof data?.mpToken === "string" ? data.mpToken.trim() : "";
    const rawDoctorId = data?.doctorId;
    const doctorId =
      rawDoctorId == null || rawDoctorId === ""
        ? null
        : Number(rawDoctorId);
    if (!token) throw new ApiError(502, "missing_mp_token", "登录响应无效，请重试");
    const phoneBoundNow = !!data?.phoneBound;
    const needsSelect = !!data?.needsDoctorSelection;
    if (
      doctorId != null &&
      (!Number.isInteger(doctorId) || doctorId <= 0)
    ) {
      throw new ApiError(502, "invalid_session_doctor", "登录响应无效，请重试");
    }
    if (!needsSelect && phoneBoundNow && !(Number.isInteger(doctorId) && doctorId! > 0)) {
      // 已绑手机且服务端未要求选医生时，必须有合法 doctorId
      throw new ApiError(502, "invalid_session_doctor", "登录响应无效，请重试");
    }
    if (!phoneBoundNow && !(Number.isInteger(doctorId) && doctorId! > 0)) {
      throw new ApiError(502, "invalid_session_doctor", "登录响应无效，请重试");
    }
    const previousToken = getMpToken();
    const previousScopes = captureCurrentScopes(previousToken);
    try {
      setMpToken(token);
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw new ApiError(0, error.code, error.message);
      }
      throw new ApiError(0, "token_storage_failed", "登录状态保存失败");
    }
    authState.transition(doctorId);
    syncAuthContext();
    applyProfile(data);
    clearExplicitSignedOut();
    const currentScopes = captureCurrentScopes(token);
    if (
      previousScopes.aiScope !== currentScopes.aiScope ||
      previousScopes.scope !== currentScopes.scope
    ) {
      clearCapturedScopes(previousScopes);
    }
  }

  async function performSilentLogin(
    doctorId: number,
    options?: { claimDoctor?: boolean }
  ) {
    // uni.login returns different shapes in mp-weixin
    const loginRes: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("wx_login_timeout")), 10000);
      uni.login({
        provider: "weixin",
        success: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        fail: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
    const code = loginRes.code || loginRes?.authResult?.code;
    if (!code) throw new Error("wx_login_no_code");
    return mpLogin(String(code), doctorId, options);
  }

  const loginExecutor = createSerialLatestExecutor<
    { doctorId: number; claimDoctor?: boolean },
    any
  >({
    key: (req) => `${req.doctorId}:${req.claimDoctor ? 1 : 0}`,
    execute: (req) =>
      performSilentLogin(req.doctorId, { claimDoctor: req.claimDoctor }),
    accept: (_req, data) => commitSession(data),
  });

  function silentLogin(doctorId?: number, options?: { claimDoctor?: boolean }) {
    const id = Number(doctorId);
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new ApiError(400, "doctor_required", "服务信息尚未加载"));
    }
    latestDesiredDoctorId = id;
    return loginExecutor.request({ doctorId: id, claimDoctor: !!options?.claimDoctor });
  }

  function runRecovery(doctorId: number, task: () => Promise<boolean>) {
    return recoveryFlights.run(authState.contextKey(doctorId), task);
  }

  async function refreshMe() {
    const token = getMpToken();
    if (!token) throw new Error("no_token");
    const snapshot = authState.capture(token);
    return guardedAuthRefresh({
      snapshot,
      request: mpMe,
      isCurrent: (captured) => authState.isCurrent(captured, getMpToken()),
      apply: applyMe,
      clearOnUnauthorized: () => clear(),
      isUnauthorized: (error) =>
        error instanceof ApiError &&
        (error.status === 401 ||
          (error.status === 403 &&
            (error.code === "account_not_bound" || error.code === "identity_mismatch"))),
    });
  }

  function invalidateLocalSession(scopeToken = getMpToken()) {
    const scopes = captureCurrentScopes(scopeToken);
    forceClearMpToken();
    authState.transition(null);
    syncAuthContext();
    phoneBound.value = false;
    needsDoctorSelection.value = false;
    hasProfile.value = false;
    phoneMasked.value = "";
    profileName.value = "";
    avatarUrl.value = "";
    patientId.value = null;
    personId.value = null;
    storageScopeId.value = "";
    clearCapturedScopes(scopes);
  }

  function clear(scopeToken = getMpToken()) {
    invalidateLocalSession(scopeToken);
  }

  async function commitSessionWithRecovery(data: any) {
    const doctorId = Number(data?.doctorId);
    try {
      commitSession(data);
      return data;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "token_storage_failed") {
        throw error;
      }
    }

    const operationId = ++recoveryOperationId;
    latestDesiredDoctorId = doctorId;
    try {
      return await recoverAfterStorageFailure({
        invalidate: () => forceClearMpToken(),
        captureContext: () => ({
          doctorId,
          epoch: authState.epoch,
          operationId,
        }),
        isContextCurrent: (context) =>
          context.operationId === recoveryOperationId &&
          context.doctorId === latestDesiredDoctorId &&
          (
            context.epoch === authState.epoch ||
            context.doctorId === sessionDoctorId.value
          ),
        currentResult: () => {
          const mpToken = getMpToken();
          const currentDoctorId = sessionDoctorId.value;
          if (!mpToken || !currentDoctorId) return null;
          return {
            mpToken,
            doctorId: currentDoctorId,
          };
        },
        login: () => silentLogin(doctorId),
        isReady: () =>
          !!getMpToken() &&
          sessionDoctorId.value === doctorId,
      });
    } catch (error) {
      if (error instanceof AuthRecoveryError) {
        throw new ApiError(0, error.code, error.message);
      }
      throw new ApiError(0, "auth_recovery_failed", "登录状态恢复失败，请重新进入页面");
    }
  }

  async function logout() {
    const scopeToken = getMpToken();
    try {
      await mpLogout();
    } finally {
      clear(scopeToken);
      // 主动退出后禁止 ensureLogin 静默用 openid 恢复同一账号
      setExplicitSignedOut(true);
    }
  }

  return {
    authEpoch,
    sessionDoctorId,
    phoneBound,
    needsDoctorSelection,
    hasProfile,
    phoneMasked,
    profileName,
    avatarUrl,
    patientId,
    personId,
    storageScopeId,
    applyMe,
    commitSession,
    commitSessionWithRecovery,
    silentLogin,
    runRecovery,
    refreshMe,
    clear,
    logout,
  };
});
