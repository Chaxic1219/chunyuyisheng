import { useAppStore } from "../stores/app";

const DEFAULT_SHARE_TITLE = "春雨医服";

type CurrentPage = {
  route?: string;
  options?: Record<string, string | undefined>;
};

/** 基于当前页面 route + query，并合并来源 doctorId/groupId/channel。 */
export function buildCurrentPageSharePath(): string {
  const store = useAppStore();
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1] as CurrentPage | undefined;
  const route = cur?.route ? `/${cur.route}` : "/pages/index/index";
  const params = new URLSearchParams();

  for (const [key, raw] of Object.entries(cur?.options || {})) {
    const v = String(raw ?? "").trim();
    if (v) params.set(key, v);
  }
  if (store.sourceDoctorId && !params.has("doctorId")) {
    params.set("doctorId", store.sourceDoctorId);
  }
  if (store.sourceGroupId && !params.has("groupId")) {
    params.set("groupId", store.sourceGroupId);
  }
  if (store.sourceChannel && !params.has("channel")) {
    params.set("channel", store.sourceChannel);
  }

  const qs = params.toString();
  return qs ? `${route}?${qs}` : route;
}

export function defaultShareAppMessagePayload() {
  return {
    title: DEFAULT_SHARE_TITLE,
    path: buildCurrentPageSharePath(),
  };
}

export function defaultShareTimelinePayload() {
  const path = buildCurrentPageSharePath();
  const query = path.includes("?") ? path.split("?").slice(1).join("?") : "";
  return {
    title: DEFAULT_SHARE_TITLE,
    query,
  };
}
