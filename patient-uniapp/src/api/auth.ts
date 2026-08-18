import { API_BASE } from "./config";
import { resolveApiError } from "./apiError";
import { createResilientTokenStorage } from "../utils/tokenStorage";

const TOKEN_KEY = "mpToken";
const mpTokenStorage = createResilientTokenStorage({
  read: () => uni.getStorageSync(TOKEN_KEY),
  write: (value) => uni.setStorageSync(TOKEN_KEY, value),
  remove: () => uni.removeStorageSync(TOKEN_KEY),
});

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getMpToken() {
  return mpTokenStorage.get();
}

export function setMpToken(t: string) {
  mpTokenStorage.set(t);
}

export function forceClearMpToken() {
  mpTokenStorage.forceClear();
}

function headers(auth: boolean) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const t = getMpToken();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

function parseData(raw: unknown): any {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { error: raw };
    }
  }
  return raw ?? {};
}

export function createApiError(status: number, rawCode: unknown): ApiError {
  const details = resolveApiError(status, rawCode);
  return new ApiError(details.status, details.code, details.message);
}

async function request(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  auth = false
): Promise<any> {
  let res;
  try {
    res = await uni.request({
      url: `${API_BASE}${path}`,
      method,
      header: headers(auth),
      timeout: 15000,
      data: body,
    });
  } catch {
    throw createApiError(0, "network_error");
  }
  const data = parseData(res.data);
  const status = res.statusCode || 0;
  if (status >= 400 || data.error) {
    throw createApiError(status, data.error);
  }
  return data;
}

async function post(path: string, body?: Record<string, unknown>, auth = false) {
  return request("POST", path, body, auth);
}

async function get(path: string, auth = false) {
  return request("GET", path, undefined, auth);
}

export async function mpLogin(
  code: string,
  doctorId?: number,
  options?: { claimDoctor?: boolean }
) {
  const body: Record<string, unknown> = { code, doctorId };
  if (options?.claimDoctor) body.claimDoctor = true;
  return post("/api/mp/login", body);
}

export async function mpBindPhone(body: {
  phoneCode?: string;
  phone?: string;
  smsCode?: string;
  doctorId?: number;
}) {
  return post("/api/mp/bind-phone", body as Record<string, unknown>, true);
}

export async function mpMe() {
  return get("/api/mp/me", true);
}

export async function mpUpdateAvatar(avatarDataUrl: string) {
  return post("/api/mp/avatar", { avatarDataUrl }, true);
}

export async function mpLogout() {
  try {
    await post("/api/mp/logout", {}, true);
  } finally {
    setMpToken("");
  }
}

export async function mpUnbindPhone() {
  try {
    await post("/api/mp/unbind-phone", {}, true);
  } finally {
    setMpToken("");
  }
}

export async function runAuthenticatedRequest<T>(
  send: (token: string) => Promise<T>,
  recover: () => Promise<boolean>
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = getMpToken();
    if (!token) {
      if (attempt === 0 && (await recover())) continue;
      throw createApiError(401, "unauthorized");
    }
    try {
      return await send(token);
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof ApiError &&
        error.status === 401 &&
        (await recover())
      ) {
        continue;
      }
      throw error;
    }
  }
  throw createApiError(401, "unauthorized");
}

export function buildInviteReturnUrl(inviteToken: unknown): string {
  const token = String(inviteToken || "").trim();
  return token
    ? `/pages/invite/form?t=${encodeURIComponent(token.slice(0, 512))}`
    : "/pages/invite/form";
}

export type MpDataRequestType = "export" | "delete";
export type MpDataRequestStatus = "pending" | "processing" | "completed" | "rejected";

export interface MpDataRequest {
  id: number;
  requestType: MpDataRequestType;
  status: MpDataRequestStatus;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface MpDataRequestResponse {
  ok: boolean;
  request: MpDataRequest;
}

export interface MpDataRequestListResponse {
  ok: boolean;
  items: MpDataRequest[];
}

export async function createMpDataRequest(
  requestType: MpDataRequestType
): Promise<MpDataRequestResponse> {
  if (requestType !== "export" && requestType !== "delete") {
    throw createApiError(400, "invalid_request_type");
  }
  return post("/api/mp/data-requests", { requestType }, true);
}

export async function getMyMpDataRequests(): Promise<MpDataRequestListResponse> {
  return get("/api/mp/data-requests/mine", true);
}
