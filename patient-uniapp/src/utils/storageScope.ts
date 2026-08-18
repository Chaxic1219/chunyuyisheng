const CACHE_PREFIXES = [
  "patientProfile:",
  "mpAvatarUrl:",
  "mpAvatarPending:",
  "mpAiChatHistory:",
  "mpAiChatTranscript:",
  "mpAiConsent:",
  "mpAiSession:",
  "mpAiSessionId:",
  "mpAiIdentity:",
] as const;

const LEGACY_SENSITIVE_KEYS = [
  "mpAiChatHistory",
  "consultMessages",
  "patientProfile",
  "mpAvatarPending",
  "mpAiIdentity",
  "mpAiConsent",
  "mpAiSession",
  "mpAiSessionId",
] as const;

const DELETE_ALL_SCOPED_PREFIXES = [
  "mpAiChatHistory:",
  "mpAvatarPending:",
  "mpAiIdentity:",
] as const;

const OPAQUE_ONLY_PREFIXES = [
  "mpAiConsent:",
  "mpAiSession:",
  "mpAiSessionId:",
  "mpAiChatTranscript:",
] as const;

export function isOpaqueStorageScopeId(scope: unknown): boolean {
  return /^mps_[A-Za-z0-9_-]{43}$/.test(String(scope || "").trim());
}

export function buildStorageScope(opts: {
  doctorId?: string | number | null;
  patientId?: string | number | null;
  personId?: string | number | null;
  token?: string | null;
}): string {
  const did = String(opts.doctorId || "nodoc");
  if (opts.patientId != null && String(opts.patientId) !== "") return `d${did}:p${opts.patientId}`;
  if (opts.personId != null && String(opts.personId) !== "") return `d${did}:ps${opts.personId}`;
  return `d${did}:guest`;
}

export function scopedStorageKey(baseKey: string, scope: string): string {
  return `${baseKey}:${scope}`;
}

function maskPhoneForCache(phone: unknown): string {
  const value = String(phone || "").trim();
  if (/^1\d{10}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`;
  if (/^1\d{2}\*{4}\d{4}$/.test(value)) return value;
  return "";
}

export function sanitizeStoredPatientProfile(raw: unknown): Record<string, string> | null {
  try {
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const profile = parsed as Record<string, unknown>;
    return {
      name: String(profile.name || "").trim(),
      phone: maskPhoneForCache(profile.phone),
      gender: "",
      birthDate: "",
      idNumber: "",
      disease: "",
      pregnancyStatus: "",
      foodContactAllergies: "",
      drugAllergies: "",
      diseaseHistory: "",
      updatedAt: String(profile.updatedAt || ""),
    };
  } catch {
    return null;
  }
}

function removeStorageKey(key: string): void {
  try {
    uni.removeStorageSync(key);
  } catch {
    // Storage corruption or quota errors must not block isolation of other keys.
  }
}

function storageKeys(): string[] {
  let keys: string[] = [];
  try {
    const info = uni.getStorageInfoSync();
    keys = Array.isArray(info?.keys) ? info.keys.map(String) : [];
  } catch {
    return [];
  }
  return keys;
}

function migrateEnumeratedStorage(keys: string[]): void {
  for (const key of keys) {
    if (DELETE_ALL_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      removeStorageKey(key);
      continue;
    }

    const opaquePrefix = OPAQUE_ONLY_PREFIXES.find((prefix) => key.startsWith(prefix));
    if (opaquePrefix) {
      const suffix = key.slice(opaquePrefix.length);
      if (!isOpaqueStorageScopeId(suffix)) removeStorageKey(key);
      continue;
    }

    if (!key.startsWith("patientProfile:")) continue;
    try {
      const safeProfile = sanitizeStoredPatientProfile(uni.getStorageSync(key));
      if (!safeProfile) {
        removeStorageKey(key);
        continue;
      }
      uni.setStorageSync(key, JSON.stringify(safeProfile));
    } catch {
      removeStorageKey(key);
    }
  }
}

export function migrateLegacyAiStorage(): void {
  for (const key of LEGACY_SENSITIVE_KEYS) removeStorageKey(key);
  migrateEnumeratedStorage(storageKeys());
}

export function clearScopedStorage(scope: string): void {
  migrateLegacyAiStorage();
  if (!String(scope || "").trim()) return;
  for (const prefix of CACHE_PREFIXES) removeStorageKey(`${prefix}${scope}`);
}
