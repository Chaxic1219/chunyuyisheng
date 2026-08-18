import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { BootstrapData } from "@chunyu/patient-design/types";
import { getBootstrap } from "../api/patient";
import { createLatestRequestCoordinator } from "../utils/latestRequestCoordinator";

const ELDER_KEY = "elderMode";
const REDUCED_MOTION_KEY = "reducedMotion";
const PKEY = "patientKey";
/** 最近使用的医生（邀请进入或手动切换后写入；冷启动默认用） */
const LAST_DOCTOR_KEY = "lastDoctorId";
/** 开启长辈模式会立刻放大字号/触控区，易导致同一次点击再次命中而连触关闭 */
const ELDER_TOGGLE_LOCK_MS = 700;

function ensurePatientKey() {
  let k = uni.getStorageSync(PKEY) as string;
  if (!k) {
    k = `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    uni.setStorageSync(PKEY, k);
  }
  return k;
}

function readBooleanStorage(key: string): boolean {
  try {
    return uni.getStorageSync(key) === "1";
  } catch {
    return false;
  }
}

function readElderModeFromStorage(): boolean {
  return readBooleanStorage(ELDER_KEY);
}

function readLastDoctorId(): string {
  try {
    const v = String(uni.getStorageSync(LAST_DOCTOR_KEY) || "").trim();
    return /^\d+$/.test(v) ? v : "";
  } catch {
    return "";
  }
}

function writeLastDoctorId(doctorId: string | number | null | undefined) {
  const v = String(doctorId ?? "").trim();
  if (!/^\d+$/.test(v) || v === "0") return;
  try {
    uni.setStorageSync(LAST_DOCTOR_KEY, v);
  } catch {
    /* ignore */
  }
}

export const useAppStore = defineStore("app", () => {
  const loadCoordinator = createLatestRequestCoordinator();
  const bootstrap = ref<BootstrapData | null>(null);
  const loading = ref(false);
  const error = ref("");
  const elderMode = ref(readElderModeFromStorage());
  const reducedMotion = ref(readBooleanStorage(REDUCED_MOTION_KEY));
  const patientKey = ref(ensurePatientKey());
  /** 来源归因（B3，2026-08-05）：群卡片/分享/线下二维码进入小程序的来源参数 */
  const sourceDoctorId = ref<string>("");
  const sourceGroupId = ref<string>("");
  const sourceChannel = ref<string>("");
  let elderToggleLockUntil = 0;

  /** 解析 launchOptions.query / 分享参数中的来源，忽略非法值（不泄露其他医生/群数据） */
  function setSourceFromQuery(query?: Record<string, unknown> | null) {
    if (!query || typeof query !== "object") return;
    const pick = (key: string): string => {
      const raw = query[key];
      const v = String(raw ?? "").trim();
      return /^\d+$/.test(v) ? v : "";
    };
    const doctorId = pick("doctorId");
    const groupId = pick("groupId");
    const channelRaw = String(query.channel ?? "").trim();
    const channel = /^[A-Za-z0-9_-]{1,32}$/.test(channelRaw) ? channelRaw : "";
    sourceDoctorId.value = doctorId;
    sourceGroupId.value = groupId;
    sourceChannel.value = channel;
    if (doctorId) writeLastDoctorId(doctorId);
  }

  function rememberDoctorId(doctorId: string | number | null | undefined) {
    writeLastDoctorId(doctorId);
    const v = String(doctorId ?? "").trim();
    if (/^\d+$/.test(v) && v !== "0") sourceDoctorId.value = v;
  }

  /** 构建分享路径：携带来源参数（B4），不含任何患者信息 */
  function buildSharePath(path: string): string {
    const params: string[] = [];
    if (sourceDoctorId.value) params.push(`doctorId=${sourceDoctorId.value}`);
    if (sourceGroupId.value) params.push(`groupId=${sourceGroupId.value}`);
    if (sourceChannel.value) params.push(`channel=${sourceChannel.value}`);
    const base = path.split("?")[0] || path;
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${base}${qs}`;
  }

  const doctor = computed(() => bootstrap.value?.doctor);
  const content = computed(() => bootstrap.value?.content);
  const faq = computed(() => bootstrap.value?.faq || []);

  function preferredDoctorId(explicit?: string | number): string {
    if (explicit != null && String(explicit).trim() !== "") {
      const v = String(explicit).trim();
      return /^\d+$/.test(v) ? v : "";
    }
    if (sourceDoctorId.value) return sourceDoctorId.value;
    return readLastDoctorId();
  }

  function load(force = false, doctorId?: string | number): Promise<void> {
    const requestedDoctorId = preferredDoctorId(doctorId);
    if (
      bootstrap.value &&
      !force &&
      !loading.value &&
      (!requestedDoctorId ||
        String(bootstrap.value.doctor?.id || "") === requestedDoctorId)
    ) {
      loading.value = false;
      return Promise.resolve();
    }
    return loadCoordinator.run<BootstrapData>({
      force,
      request: async () => {
        const data = await getBootstrap(requestedDoctorId || undefined);
        if (
          requestedDoctorId &&
          String(data.doctor?.id || "") !== requestedDoctorId
        ) {
          throw new Error("doctor_unavailable");
        }
        return data;
      },
      onStart: () => {
        loading.value = true;
        error.value = "";
      },
      onSuccess: (data) => {
        bootstrap.value = data;
        const id = data?.doctor?.id;
        if (id != null) rememberDoctorId(id);
      },
      onError: (failure) => {
        error.value = "加载失败，请重试";
        console.error(failure);
      },
      onSettled: () => {
        loading.value = false;
      },
    });
  }

  function syncPreferencesToTabBar() {
    try {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1] as {
        getTabBar?: () => { setData?: (data: Record<string, unknown>) => void } | null;
      };
      const bar = typeof page?.getTabBar === "function" ? page.getTabBar() : null;
      bar?.setData?.({ elder: elderMode.value, reducedMotion: reducedMotion.value });
    } catch {
      /* 非 tab 页忽略 */
    }
  }

  function setElderMode(next: boolean): boolean {
    const enabled = !!next;
    if (elderMode.value === enabled) {
      syncPreferencesToTabBar();
      return false;
    }
    elderMode.value = enabled;
    try {
      uni.setStorageSync(ELDER_KEY, enabled ? "1" : "0");
    } catch {
      /* 本地持久化失败时仍保持内存态，避免界面与操作反馈不一致 */
    }
    syncPreferencesToTabBar();
    return true;
  }

  function setReducedMotion(next: boolean): boolean {
    const enabled = !!next;
    if (reducedMotion.value === enabled) return false;
    reducedMotion.value = enabled;
    try {
      uni.setStorageSync(REDUCED_MOTION_KEY, enabled ? "1" : "0");
    } catch {
      /* 写入失败时保留内存状态 */
    }
    syncPreferencesToTabBar();
    return true;
  }

  function hydrateReducedMotion() {
    reducedMotion.value = readBooleanStorage(REDUCED_MOTION_KEY);
    syncPreferencesToTabBar();
  }

  function toggleElder(): boolean {
    const now = Date.now();
    if (now < elderToggleLockUntil) return false;
    elderToggleLockUntil = now + ELDER_TOGGLE_LOCK_MS;
    return setElderMode(!elderMode.value);
  }

  /** 冷启动或存储被外部改写后，从本地恢复长辈模式 */
  function hydrateElderMode() {
    const stored = readElderModeFromStorage();
    if (elderMode.value !== stored) elderMode.value = stored;
    syncPreferencesToTabBar();
  }

  return {
    bootstrap,
    loading,
    error,
    elderMode,
    reducedMotion,
    patientKey,
    doctor,
    content,
    faq,
    sourceDoctorId,
    sourceGroupId,
    sourceChannel,
    setSourceFromQuery,
    rememberDoctorId,
    buildSharePath,
    load,
    setElderMode,
    setReducedMotion,
    toggleElder,
    hydrateElderMode,
    hydrateReducedMotion,
  };
});
