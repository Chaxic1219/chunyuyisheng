/**
 * 服务地址：云端 CRUD + 本地缓存（结算页同步读取）。
 */
import {
  createAddress,
  deleteAddress,
  fetchAddresses,
  setDefaultAddressApi,
  updateAddress,
} from "../api/addresses";
import { getMpToken } from "../api/auth";
import { buildStorageScope, scopedStorageKey } from "./storageScope";

export type ServiceAddress = {
  id: string;
  name: string;
  phone: string;
  /** 省市区一行，如「广东省 深圳市 南山区」 */
  region: string;
  /** 详细地址 */
  detail: string;
  isDefault?: boolean;
  updatedAt: string;
};

const KEY = "svcAddresses";
const SELECTED_KEY = "svcAddressSelectedId";
const LEGACY_KEY_PREFIX = "svcAddresses::";

function scopeOpts(doctorId?: number | string | null) {
  return buildStorageScope({
    doctorId: doctorId || undefined,
    token: getMpToken(),
  });
}

function listKey(doctorId?: number | string | null) {
  return scopedStorageKey(KEY, scopeOpts(doctorId));
}

function selectedKey(doctorId?: number | string | null) {
  return scopedStorageKey(SELECTED_KEY, scopeOpts(doctorId));
}

export function formatAddressLine(addr: ServiceAddress) {
  return [addr.region, addr.detail].filter(Boolean).join(" ").trim();
}

export function isAddressComplete(addr: Partial<ServiceAddress> | null | undefined) {
  if (!addr) return false;
  return !!(
    String(addr.name || "").trim() &&
    String(addr.phone || "").trim() &&
    String(addr.region || "").trim() &&
    String(addr.detail || "").trim()
  );
}

export function listAddresses(doctorId?: number | string | null): ServiceAddress[] {
  try {
    const raw = uni.getStorageSync(listKey(doctorId));
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as ServiceAddress[]) : [];
  } catch {
    return [];
  }
}

function saveAll(rows: ServiceAddress[], doctorId?: number | string | null) {
  uni.setStorageSync(listKey(doctorId), JSON.stringify(rows));
}

function normalizeAddress(input: Partial<ServiceAddress> | null | undefined): ServiceAddress | null {
  if (!input) return null;
  const row: ServiceAddress = {
    id: String(input.id || `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    name: String(input.name || "").trim(),
    phone: String(input.phone || "").trim(),
    region: String(input.region || "").trim(),
    detail: String(input.detail || "").trim(),
    isDefault: !!input.isDefault,
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
  return isAddressComplete(row) ? row : null;
}

function collectLegacyLocalAddresses(doctorId?: number | string | null): ServiceAddress[] {
  const out: ServiceAddress[] = [];
  const seen = new Set<string>();
  const add = (row: Partial<ServiceAddress> | null | undefined) => {
    const normalized = normalizeAddress(row);
    if (!normalized) return;
    const sig = `${normalized.name}|${normalized.phone}|${normalized.region}|${normalized.detail}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(normalized);
  };

  listAddresses(doctorId).forEach(add);

  try {
    const info = uni.getStorageInfoSync();
    const keys = Array.isArray(info?.keys) ? info.keys : [];
    for (const k of keys) {
      if (k === KEY || String(k).startsWith(LEGACY_KEY_PREFIX)) {
        const raw = uni.getStorageSync(k);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) parsed.forEach(add);
      }
    }
  } catch {
    // 忽略老缓存读取失败，保持主流程可用
  }
  return out;
}

async function migrateLegacyToCloudIfNeeded(
  rows: ServiceAddress[],
  doctorId?: number | string | null
): Promise<ServiceAddress[]> {
  if (rows.length) return rows;
  const legacyRows = collectLegacyLocalAddresses(doctorId);
  if (!legacyRows.length) return rows;

  let hasDefault = false;
  for (const row of legacyRows) {
    const shouldDefault = row.isDefault && !hasDefault;
    try {
      await createAddress({
        name: row.name,
        phone: row.phone,
        region: row.region,
        detail: row.detail,
        isDefault: shouldDefault,
      });
      if (shouldDefault) hasDefault = true;
    } catch {
      // 单条失败不阻断整体迁移
    }
  }
  const refetched = await fetchAddresses();
  return Array.isArray(refetched?.addresses) ? refetched.addresses : [];
}

export function getAddress(id: string, doctorId?: number | string | null) {
  return listAddresses(doctorId).find((a) => a.id === id) || null;
}

export function getDefaultAddress(doctorId?: number | string | null) {
  const rows = listAddresses(doctorId);
  if (!rows.length) return null;
  return rows.find((a) => a.isDefault) || rows[0] || null;
}

export function getSelectedAddressId(doctorId?: number | string | null) {
  return String(uni.getStorageSync(selectedKey(doctorId)) || "").trim();
}

export function setSelectedAddressId(id: string, doctorId?: number | string | null) {
  uni.setStorageSync(selectedKey(doctorId), id);
}

export function getCheckoutAddress(doctorId?: number | string | null) {
  const selectedId = getSelectedAddressId(doctorId);
  if (selectedId) {
    const found = getAddress(selectedId, doctorId);
    if (found && isAddressComplete(found)) return found;
  }
  return getDefaultAddress(doctorId);
}

/** 从云端拉取并写入本地缓存 */
export async function syncAddresses(doctorId?: number | string | null) {
  const data = await fetchAddresses();
  const cloudRows = Array.isArray(data?.addresses) ? data.addresses : [];
  const rows = await migrateLegacyToCloudIfNeeded(cloudRows, doctorId);
  saveAll(rows, doctorId);
  const selected = getSelectedAddressId(doctorId);
  if (selected && !rows.some((a) => a.id === selected)) {
    const def = rows.find((a) => a.isDefault) || rows[0];
    setSelectedAddressId(def?.id || "", doctorId);
  } else if (!selected && rows.length) {
    const def = rows.find((a) => a.isDefault) || rows[0];
    if (def) setSelectedAddressId(def.id, doctorId);
  }
  return rows;
}

export async function upsertAddress(
  input: Omit<ServiceAddress, "id" | "updatedAt"> & { id?: string },
  doctorId?: number | string | null
) {
  const payload = {
    name: String(input.name || "").trim(),
    phone: String(input.phone || "").trim(),
    region: String(input.region || "").trim(),
    detail: String(input.detail || "").trim(),
    isDefault: !!input.isDefault,
  };
  if (!isAddressComplete(payload)) {
    throw new Error("请填写完整地址信息");
  }
  let address: ServiceAddress;
  if (input.id) {
    const res = await updateAddress(input.id, payload);
    address = res.address;
  } else {
    const res = await createAddress(payload);
    address = res.address;
  }
  await syncAddresses(doctorId);
  setSelectedAddressId(address.id, doctorId);
  return address;
}

export async function removeAddress(id: string, doctorId?: number | string | null) {
  await deleteAddress(id);
  await syncAddresses(doctorId);
}

export async function setDefaultAddress(id: string, doctorId?: number | string | null) {
  await setDefaultAddressApi(id);
  await syncAddresses(doctorId);
  setSelectedAddressId(id, doctorId);
}
