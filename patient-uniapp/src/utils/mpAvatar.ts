import { getMpToken, mpUpdateAvatar } from "../api/auth";
import { mpVisual } from "./mediaSrc";
import { scopedStorageKey } from "./storageScope";

export const MP_AVATAR_CACHE_KEY = "mpAvatarUrl";
export const MP_AVATAR_PENDING_KEY = "mpAvatarPending";
export const MP_AVATAR_FALLBACK = mpVisual("default-user-avatar.webp");

export function mpAvatarCacheKey(scope: string) {
  return scopedStorageKey(MP_AVATAR_CACHE_KEY, scope);
}

export function mpAvatarPendingKey(scope: string) {
  return scopedStorageKey(MP_AVATAR_PENDING_KEY, scope);
}

export function normalizeMpAvatarUrl(raw?: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("http://")) return `https://${value.slice("http://".length)}`;
  return value;
}

export function readMpAvatarCache(cacheKey: string): string {
  return normalizeMpAvatarUrl(String(uni.getStorageSync(cacheKey) || ""));
}

export function writeMpAvatarCache(cacheKey: string, url: string) {
  const value = normalizeMpAvatarUrl(url);
  if (!value) return;
  uni.setStorageSync(cacheKey, value);
}

export function resolveMpAvatarSrc(authUrl?: string, cached?: string): string {
  return normalizeMpAvatarUrl(authUrl) || normalizeMpAvatarUrl(cached);
}

export function resolveMpAvatarSrcOrFallback(authUrl?: string, cached?: string): string {
  return resolveMpAvatarSrc(authUrl, cached) || MP_AVATAR_FALLBACK;
}

function readFileAsDataUrl(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const fs = uni.getFileSystemManager();
      fs.readFile({
        filePath,
        encoding: "base64",
        success: (res) => {
          const base64 = String((res as { data?: string }).data || "").trim();
          if (!base64) return reject(new Error("empty_avatar_file"));
          resolve(`data:image/png;base64,${base64}`);
        },
        fail: reject,
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function persistChosenMpAvatar(opts: {
  filePath: string;
  cacheKey: string;
  pendingKey: string;
  applyMe: (data: unknown) => void;
}): Promise<"synced" | "local"> {
  const path = String(opts.filePath || "").trim();
  if (!path) throw new Error("empty_avatar_path");
  writeMpAvatarCache(opts.cacheKey, path);
  const dataUrl = await readFileAsDataUrl(path);
  uni.setStorageSync(opts.pendingKey, dataUrl);
  if (!getMpToken()) return "local";
  const data = await mpUpdateAvatar(dataUrl);
  opts.applyMe(data);
  const remote = normalizeMpAvatarUrl(
    (data as { avatarUrl?: string; profileSummary?: { avatarUrl?: string } })?.avatarUrl
    || (data as { profileSummary?: { avatarUrl?: string } })?.profileSummary?.avatarUrl
  );
  if (remote) writeMpAvatarCache(opts.cacheKey, remote);
  uni.removeStorageSync(opts.pendingKey);
  return "synced";
}

export async function syncPendingMpAvatar(opts: {
  cacheKey: string;
  pendingKey: string;
  applyMe: (data: unknown) => void;
}): Promise<boolean> {
  if (!getMpToken()) return false;
  const pending = String(uni.getStorageSync(opts.pendingKey) || "").trim();
  if (!pending) return false;
  const data = await mpUpdateAvatar(pending);
  opts.applyMe(data);
  const remote = normalizeMpAvatarUrl(
    (data as { avatarUrl?: string; profileSummary?: { avatarUrl?: string } })?.avatarUrl
    || (data as { profileSummary?: { avatarUrl?: string } })?.profileSummary?.avatarUrl
  );
  if (remote) writeMpAvatarCache(opts.cacheKey, remote);
  uni.removeStorageSync(opts.pendingKey);
  return true;
}
