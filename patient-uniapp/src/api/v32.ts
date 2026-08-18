import type {
  FamilyData,
  HomeFeed,
  MineAssets,
  PlanDetailData,
  RecordListData,
  ServiceCenterData,
} from "../types/v32";
import { getMpToken } from "./auth";
import { API_BASE, V32_ALLOW_MOCK_FALLBACK } from "./config";
import {
  mockFamilyData,
  mockHomeFeed,
  mockMineAssets,
  mockPlanDetail,
  mockRecordList,
  mockServiceCenter,
} from "./mock/v32";
import {
  normalizeHomeFeedLabels,
  normalizeMineAssetsLabels,
  normalizeServiceCenterLabels,
  renameCopilotLabel,
} from "../utils/renameCopilotLabels";

function delay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function requestV32<T>(
  path: string,
  fallback: T,
  opts?: { method?: "GET" | "POST" | "DELETE"; data?: Record<string, unknown> | unknown[] | string }
): Promise<T> {
  const method = opts?.method || "GET";

  // V32 只认 V32_ALLOW_MOCK_FALLBACK；显式开启时直接走 mock（不静默回退）
  if (V32_ALLOW_MOCK_FALLBACK) {
    await delay();
    return clone(fallback);
  }

  const header: Record<string, string> = {};
  const token = getMpToken();
  if (token) header.Authorization = `Bearer ${token}`;
  if (method === "POST") header["Content-Type"] = "application/json";

  const res = await uni.request({
    url: `${API_BASE}/api/mp/v32${path}`,
    method,
    header,
    data: opts?.data,
    timeout: 12000,
  });
  const data = (res.data || {}) as { data?: T; error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `v32 request failed: ${res.statusCode}`);
  }
  return (data.data != null ? data.data : (data as unknown as T)) as T;
}

export async function getHomeFeed(): Promise<HomeFeed> {
  const feed = await requestV32("/home-feed", mockHomeFeed);
  return normalizeHomeFeedLabels(feed);
}

export async function getMineAssets(): Promise<MineAssets> {
  const assets = await requestV32("/mine-assets", mockMineAssets);
  return normalizeMineAssetsLabels(assets);
}

export async function getRecordList(): Promise<RecordListData> {
  return requestV32("/records", mockRecordList);
}

export async function getPlanDetail(): Promise<PlanDetailData> {
  const plan = await requestV32("/plans/current", mockPlanDetail);
  if (!plan || typeof plan !== "object") return plan;
  return {
    ...plan,
    title: renameCopilotLabel(plan.title),
    desc: renameCopilotLabel(plan.desc),
  };
}

export async function getServiceCenter(doctorId?: string | number): Promise<ServiceCenterData> {
  const q =
    doctorId == null || doctorId === ""
      ? "/services"
      : `/services?doctorId=${encodeURIComponent(String(doctorId))}`;
  const center = await requestV32(q, mockServiceCenter);
  return normalizeServiceCenterLabels(center);
}

export async function getFamilyData(): Promise<FamilyData> {
  const data = await requestV32("/family", mockFamilyData);
  return normalizeFamilyData(data);
}

function normalizeFamilyData(raw: unknown): FamilyData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<FamilyData> & {
    helpers?: unknown;
    managed?: unknown;
  };
  const isPlaceholderName = (name?: string) =>
    !!name && /暂未添加/.test(String(name));

  let managed =
    data.managed && typeof data.managed === "object" && !Array.isArray(data.managed)
      ? (data.managed as FamilyData["managed"])
      : null;
  if (managed && isPlaceholderName(managed.name)) managed = null;

  // 兼容旧接口：helpers 曾是单对象
  let helpers: FamilyData["helpers"] = [];
  if (Array.isArray(data.helpers)) {
    helpers = (data.helpers as FamilyData["helpers"]).filter(
      (row) => row && !isPlaceholderName(row.name)
    );
  } else if (data.helpers && typeof data.helpers === "object") {
    const legacy = data.helpers as { id?: number; name?: string };
    if (legacy.id || (legacy.name && !isPlaceholderName(legacy.name))) {
      helpers = [data.helpers as FamilyData["helpers"][number]];
    }
  }
  const count = (managed ? 1 : 0) + helpers.length;
  return { managed, helpers, count };
}

export async function addFamilyMember(payload: {
  name: string;
  relation?: string;
  phone?: string;
  role?: string;
}) {
  return requestV32(
    "/family",
    { member: null },
    {
      method: "POST",
      data: {
        name: payload.name,
        relation: payload.relation || "",
        phone: payload.phone || "",
        role: payload.role || "helper",
      },
    }
  );
}

export async function removeFamilyMember(memberId: number) {
  return requestV32(
    `/family/${Number(memberId)}`,
    { ok: true, removed: 0, family: mockFamilyData },
    { method: "DELETE" }
  );
}

export async function confirmRecord(sourceKey: string, payload?: Record<string, unknown>) {
  return requestV32(
    `/records/${encodeURIComponent(sourceKey)}/confirmations`,
    { confirmations: [] },
    { method: "POST", data: { payload } }
  );
}

export type PlanMutationResult = {
  plan: { id?: number; [key: string]: unknown } | null;
};

export async function generatePlan(): Promise<PlanMutationResult> {
  return requestV32("/plans/generate", { plan: null }, { method: "POST", data: {} });
}

export async function activatePlan(planId: number): Promise<PlanMutationResult> {
  return requestV32(`/plans/${planId}/activate`, { plan: null }, { method: "POST", data: {} });
}

export async function completeTask(taskId: number, payload?: Record<string, unknown>) {
  return requestV32(`/tasks/${taskId}/complete`, { task: null }, {
    method: "POST",
    data: payload || {},
  });
}
