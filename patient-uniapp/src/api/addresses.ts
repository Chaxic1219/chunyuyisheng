import { getMpToken } from "./auth";
import { API_BASE } from "./config";
import type { ServiceAddress } from "../utils/serviceAddress";

async function requestAddresses<T>(
  path: string,
  opts?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    data?: Record<string, unknown>;
  }
): Promise<T> {
  const method = opts?.method || "GET";
  const header: Record<string, string> = {};
  const token = getMpToken();
  if (token) header.Authorization = `Bearer ${token}`;
  if (method === "POST" || method === "PATCH") header["Content-Type"] = "application/json";

  const res = await uni.request({
    url: `${API_BASE}/api/mp${path}`,
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    header,
    data: opts?.data,
    timeout: 15000,
  });
  const data = (res.data || {}) as { data?: T; error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `request failed: ${res.statusCode}`);
  }
  return (data.data != null ? data.data : (data as unknown as T)) as T;
}

export function fetchAddresses() {
  return requestAddresses<{ addresses: ServiceAddress[] }>("/addresses");
}

export function createAddress(body: {
  name: string;
  phone: string;
  region: string;
  detail: string;
  isDefault?: boolean;
}) {
  return requestAddresses<{ address: ServiceAddress }>("/addresses", {
    method: "POST",
    data: body,
  });
}

export function updateAddress(
  id: string | number,
  body: Partial<{
    name: string;
    phone: string;
    region: string;
    detail: string;
    isDefault: boolean;
  }>
) {
  return requestAddresses<{ address: ServiceAddress }>(`/addresses/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    data: body,
  });
}

export function deleteAddress(id: string | number) {
  return requestAddresses<{ ok: boolean }>(`/addresses/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
}

export function setDefaultAddressApi(id: string | number) {
  return requestAddresses<{ address: ServiceAddress }>(
    `/addresses/${encodeURIComponent(String(id))}/default`,
    { method: "POST" }
  );
}
