const STORAGE_KEY = "mpExplicitSignedOut";

export function isExplicitSignedOut(): boolean {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    return raw === "1" || raw === 1 || raw === true;
  } catch {
    return false;
  }
}

export function setExplicitSignedOut(value: boolean): void {
  try {
    if (value) {
      uni.setStorageSync(STORAGE_KEY, "1");
      return;
    }
    uni.removeStorageSync(STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
}

export function clearExplicitSignedOut(): void {
  setExplicitSignedOut(false);
}
