import type {
  BootstrapData,
  ChatMessage,
  HealthCategory,
  HealthRecord,
  InviteSubmitPayload,
  InviteSubmitResult,
  PatientArchive,
  PatientSessionInfo,
  SubmitPayload,
  FormField,
} from "@chunyu/patient-design/types";
import {
  createApiError,
  getMpToken,
  runAuthenticatedRequest,
} from "./auth";
import { API_BASE, CONSULT_USE_REAL, USE_MOCK } from "./config";
import { mockBootstrap } from "./mock/bootstrap";
import { mockArchive, mockHealthCategories, mockHealthRecords } from "./mock/archive";

export interface HealthRecordDetail extends HealthRecord {
  sourceDoctorName?: string;
  attachments?: Array<{ type?: string; name?: string; mime?: string; dataUrl?: string; url?: string }>;
  extra?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export function parseHealthRecordRef(ref: string | number): number {
  if (typeof ref === "number" && ref > 0) return ref;
  const s = String(ref || "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function mapHealthRecordDetail(row: Record<string, unknown>): HealthRecordDetail {
  return {
    id: Number(row.id) || 0,
    category: String(row.category || ""),
    categoryLabel: String(row.categoryLabel || row.category || ""),
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    recordedAt: String(row.recordedAt || ""),
    sourceDoctorName: String(row.sourceDoctorName || ""),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    extra: row.extra && typeof row.extra === "object" ? (row.extra as Record<string, unknown>) : {},
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    createdBy: String(row.createdBy || ""),
  };
}

function delay(ms = 280) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 小程序面向平台通用助手：擦除 bootstrap 中的医生展示名与「某某医生团队」话术 */
function scrubMpBootstrap(data: BootstrapData): BootstrapData {
  const clone = JSON.parse(JSON.stringify(data)) as BootstrapData;
  const doctorName = String(clone.doctor?.name || "").trim();

  const scrubText = (input: unknown): unknown => {
    if (typeof input !== "string") return input;
    let s = input;
    if (doctorName) {
      s = s.split(`${doctorName}医生团队`).join("春雨医患通");
      s = s.split(`${doctorName}医生`).join("春雨医患通");
      s = s.split(doctorName).join("春雨医患通");
    }
    s = s.split("仅医生团队可见").join("仅用于为您提供服务");
    s = s.split("医生团队跟进").join("服务跟进");
    s = s.split("医生团队").join("服务团队");
    return s;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return scrubText(node);
  };

  const scrubbed = walk(clone) as BootstrapData;
  if (scrubbed.doctor) {
    scrubbed.doctor = {
      ...scrubbed.doctor,
      name: "",
      title: "",
      dept: "",
      hospital: "",
      hospitalPhone: "",
    };
  }
  return scrubbed;
}

function mapRiskLevel(risk?: string): "low" | "medium" | "high" {
  const v = String(risk || "").toLowerCase();
  if (v === "high" || v === "emergency" || v === "1" || v === "l1") return "high";
  if (v === "medium" || v === "2" || v === "3" || v === "l2" || v === "l3") return "medium";
  return "low";
}

type ServerMessageResponse = {
  reply?: string;
  error?: string;
  responses?: { type?: string; text?: string }[];
  triage?: {
    riskLevel?: string;
    level?: number | string;
    urgency?: { label?: string; timeframe?: string };
    reasoningSummary?: string;
    summary?: string;
  };
};

function replyFromServer(data: ServerMessageResponse): ChatMessage {
  const texts = (data.responses || [])
    .filter((r) => (r.type || "text") === "text" && r.text)
    .map((r) => String(r.text).trim())
    .filter(Boolean);
  const text =
    texts.join("\n\n") ||
    (typeof data.reply === "string" ? data.reply.trim() : "") ||
    "我已收到您的问题，服务人员会尽快跟进。";
  const t = data.triage;
  const summary = t?.urgency?.label || t?.reasoningSummary || t?.summary || "";
  return {
    id: `a-${Date.now()}`,
    role: "assistant",
    text,
    triage: t
      ? {
          level: mapRiskLevel(t.riskLevel || String(t.level || "")),
          summary: summary || text.slice(0, 80),
        }
      : undefined,
  };
}

function readLocalFileAsDataUrl(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fs = uni.getFileSystemManager();
      fs.readFile({
        filePath,
        encoding: "base64",
        success: (res) => {
          const lower = filePath.toLowerCase();
          const mime = lower.endsWith(".png")
            ? "image/png"
            : lower.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
          resolve(`data:${mime};base64,${res.data}`);
        },
        fail: () => resolve(null),
      });
    } catch {
      resolve(null);
    }
  });
}

async function buildAttachments(paths?: string[]) {
  const list = paths || [];
  const out: { type: string; name: string; mime: string; dataUrl: string }[] = [];
  for (let i = 0; i < list.length; i++) {
    const filePath = list[i];
    const dataUrl = await readLocalFileAsDataUrl(filePath);
    if (!dataUrl) continue;
    const mime = dataUrl.startsWith("data:image/png")
      ? "image/png"
      : dataUrl.startsWith("data:image/webp")
        ? "image/webp"
        : "image/jpeg";
    out.push({
      type: "image",
      name: `attach-${i + 1}.${mime === "image/png" ? "png" : "jpg"}`,
      mime,
      dataUrl,
    });
  }
  return out;
}

export async function getBootstrap(doctorId?: string | number): Promise<BootstrapData> {
  if (USE_MOCK) {
    await delay();
    return scrubMpBootstrap(JSON.parse(JSON.stringify(mockBootstrap)));
  }
  const res = await uni.request({
    url: doctorId == null || doctorId === ""
      ? `${API_BASE}/api/bootstrap`
      : `${API_BASE}/api/bootstrap?doctorId=${encodeURIComponent(String(doctorId))}`,
    method: "GET",
    timeout: 15000,
  });
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error((res.data as { error?: string })?.error || "bootstrap 失败");
  }
  const data = res.data as BootstrapData;
  if (!data?.doctor?.id) throw new Error("bootstrap 无医生数据");
  return scrubMpBootstrap(data);
}

export async function sendMessage(opts: {
  doctorId: string;
  text: string;
  patientKey: string;
  attachments?: string[];
  history?: { role: "user" | "assistant"; text: string }[];
  channel?: string;
}): Promise<{ reply: ChatMessage }> {
  // 咨询强制真接口：与 H5/后台同一 buildPatientReply + 分诊人设
  if (USE_MOCK && !CONSULT_USE_REAL) {
    await delay(500);
    return {
      reply: {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: "当前在线服务暂不可用，请稍后重试。",
      },
    };
  }

  const attachments = await buildAttachments(opts.attachments);
  const header: Record<string, string> = { "Content-Type": "application/json" };
  const mpToken = getMpToken();
  if (mpToken) header.Authorization = `Bearer ${mpToken}`;
  const res = await uni.request({
    url: `${API_BASE}/api/message`,
    method: "POST",
    header,
    timeout: 60000,
    data: {
      doctorId: String(opts.doctorId),
      text: opts.text,
      attachments,
      patientName: "小程序咨询者",
      patientKey: opts.patientKey,
      channel: opts.channel || "mp",
      history: Array.isArray(opts.history) ? opts.history.slice(-16) : [],
    },
  });

  const data = (res.data || {}) as ServerMessageResponse;
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(data.error || `发送失败（${res.statusCode}）`);
  }
  if (data.error) throw new Error(data.error);
  return { reply: replyFromServer(data) };
}

/** 发送短信验证码（联络表 / 绑手机共用） */
export async function sendSmsCode(phone: string, doctorId?: string | number): Promise<{ ok: boolean; message?: string }> {
  if (USE_MOCK) {
    await delay(300);
    return { ok: false, message: "短信服务未启用" };
  }
  const body: Record<string, unknown> = { phone: String(phone).trim() };
  if (doctorId != null && doctorId !== "") body.doctorId = doctorId;
  const res = await uni.request({
    url: `${API_BASE}/api/sms/send`,
    method: "POST",
    header: { "Content-Type": "application/json" },
    data: body,
    timeout: 15000,
  });
  const data = res.data as { ok?: boolean; error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw createApiError(res.statusCode || 0, data.error);
  }
  return { ok: true };
}

/** 查询当前会话是否已验证手机（网页 psid / 小程序 Bearer） */
export async function fetchPatientSession(doctorId: string | number): Promise<PatientSessionInfo> {
  if (USE_MOCK) {
    await delay(100);
    return { phoneBound: false };
  }
  const headers: Record<string, string> = {};
  const token = getMpToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await uni.request({
    url: `${API_BASE}/api/patient/session?doctorId=${encodeURIComponent(String(doctorId))}`,
    method: "GET",
    header: headers,
    withCredentials: true,
    timeout: 15000,
  });
  const data = (res.data || {}) as PatientSessionInfo & { error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) return { phoneBound: false };
  return {
    phoneBound: !!data.phoneBound,
    smsAvailable: data.smsAvailable === true,
    phoneMasked: data.phoneMasked ?? null,
    patientId: data.patientId ?? null,
    personId: data.personId ?? null,
    source: data.source,
  };
}

export async function fetchInviteMeta(token: string) {
  if (USE_MOCK) {
    await delay(200);
    return { ok: true, doctorId: 1, doctorName: "签约医生", fields: [] as FormField[] };
  }
  const res = await uni.request({
    url: `${API_BASE}/api/invite/${encodeURIComponent(token)}`,
    method: "GET",
    timeout: 15000,
  });
  const data = res.data as Record<string, unknown>;
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(String(data.error || "邀请链接无效"));
  }
  return data;
}

export async function submitInviteForm(
  token: string,
  body: InviteSubmitPayload
): Promise<InviteSubmitResult> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, message: "建档成功" };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const mpToken = getMpToken();
  if (mpToken) headers.Authorization = `Bearer ${mpToken}`;
  const res = await uni.request({
    url: `${API_BASE}/api/invite/${encodeURIComponent(token)}/submit`,
    method: "POST",
    header: headers,
    withCredentials: true,
    data: body,
    timeout: 30000,
  });
  const data = res.data as InviteSubmitResult & {
    error?: string;
    needsMergeConfirm?: boolean;
    candidates?: InviteSubmitResult["candidates"];
  };
  if (data.needsMergeConfirm) {
    return {
      ok: false,
      needsMergeConfirm: true,
      message: String(data.message || "发现同号档案，请确认是否合并"),
      candidates: data.candidates || [],
      verificationProof:
        typeof data.verificationProof === "string"
          ? data.verificationProof
          : undefined,
    };
  }
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw createApiError(res.statusCode || 0, data.error);
  }
  return {
    ok: !!data.ok,
    message: String(data.message || (data.merged ? "已更新已有档案" : "建档成功")),
    merged: !!data.merged,
    patientId: data.patientId,
  };
}

export async function submitForm(body: SubmitPayload): Promise<{
  ok: boolean;
  message: string;
  chunyu?: { h5Url?: string; kind?: string };
}> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, message: "提交成功（Demo mock，未写入服务器）" };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getMpToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await uni.request({
    url: `${API_BASE}/api/submit`,
    method: "POST",
    header: headers,
    withCredentials: true,
    data: body,
  });
  const data = res.data as {
    ok?: boolean;
    message?: string;
    error?: string;
    chunyu?: { h5Url?: string; kind?: string };
  };
  if (data.error) return { ok: false, message: data.error };
  return {
    ok: !!data.ok,
    message: data.message || (data.ok ? "提交成功" : "提交失败"),
    chunyu: data.chunyu,
  };
}

/** 门诊凭证：POST /api/patient/voucher-upload { doctorId, dataUrl } */
export async function uploadVoucher(
  doctorId: string,
  dataUrl: string,
  recoverAuth: () => Promise<boolean>
): Promise<{ ok: true; url: string }> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, url: `mock://voucher/${Date.now()}` };
  }
  return runAuthenticatedRequest(async (token) => {
    const res = await uni.request({
      url: `${API_BASE}/api/patient/voucher-upload`,
      method: "POST",
      header: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: { doctorId, dataUrl },
      timeout: 30000,
    });
    const data = (res.data || {}) as { ok?: boolean; url?: string; error?: string };
    if ((res.statusCode || 0) >= 400 || data.error) {
      throw createApiError(res.statusCode || 0, data.error);
    }
    if (!data.ok || !data.url) {
      throw createApiError(502, "invalid_upload_response");
    }
    return { ok: true as const, url: data.url };
  }, recoverAuth);
}

export type ReplyItem = { title: string; status: string; time: string; at?: string };

const REPLY_DONE = new Set([
  "已完成",
  "已取消",
  "已关闭",
  "completed",
  "cancelled",
  "closed",
]);

function formatAllergy(v: unknown): string {
  if (!v) return "无";
  if (typeof v === "string") return v || "无";
  const o = v as { values?: string[]; other?: string };
  const values = Array.isArray(o.values) ? [...o.values] : [];
  const other = (o.other || "").trim();
  if (other) {
    const idx = values.indexOf("其他");
    if (idx >= 0) values[idx] = `其他（${other}）`;
  }
  return values.length ? values.join("、") : "无";
}

function parseRequestData(raw: unknown): any {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { error: raw };
    }
  }
  return raw ?? {};
}

/** 已绑号会话：Bearer + doctorId；服务端用会话手机号，忽略客户端 phone/code */
export async function getRepliesMine(
  doctorId: number
): Promise<{ items: ReplyItem[]; raw: { replies: any[]; followups: any[] } }> {
  if (USE_MOCK) {
    await delay();
    const items = [
      { title: "门诊加号", status: "助理处理中", time: "今天 09:20", at: "今天 09:20" },
      { title: "医患联络表", status: "已建档", time: "昨天 16:05", at: "昨天 16:05" },
    ];
    return { items, raw: { replies: items, followups: [] } };
  }
  const header: Record<string, string> = { "Content-Type": "application/json" };
  const t = getMpToken();
  if (t) header.Authorization = `Bearer ${t}`;
  const res = await uni.request({
    url: `${API_BASE}/api/replies/mine`,
    method: "POST",
    header,
    data: { doctorId },
  });
  const data = parseRequestData(res.data);
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `查询失败（${res.statusCode || 0}）`);
  }
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const followups = Array.isArray(data.followups) ? data.followups : [];
  const items: ReplyItem[] = [
    ...replies.map((r: any) => ({
      title: String(r.type || "提交"),
      status: String(r.status || ""),
      time: String(r.at || ""),
      at: String(r.at || ""),
    })),
    ...followups.map((f: any) => ({
      title: String(f.title || f.planName || "随访"),
      status: String(f.status || ""),
      time: String(f.updatedAt || f.at || ""),
      at: String(f.updatedAt || f.at || ""),
    })),
  ];
  return { items, raw: { replies, followups } };
}

/** 患者本人填写的建档资料（字段与网页邀请建档问卷 /?p=invite 一致，提交后本地保存一份用于展示） */
export interface PatientProfile {
  name: string;
  phone: string;
  gender: string;
  birthDate: string;
  idNumber: string;
  disease: string;
  pregnancyStatus: string;
  foodContactAllergies: string;
  drugAllergies: string;
  diseaseHistory: string;
  bloodType?: string;
  heightCm?: string;
  weightKg?: string;
  healthNotes?: string;
  updatedAt: string;
}

const PROFILE_KEY = "patientProfile";

function checkboxSummary(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { values?: string[]; other?: string };
    const values = Array.isArray(parsed.values) ? [...parsed.values] : [];
    const other = (parsed.other || "").trim();
    if (other) {
      const idx = values.indexOf("其他");
      if (idx >= 0) values[idx] = `其他（${other}）`;
    }
    return values.join("、");
  } catch {
    return raw;
  }
}

export function getLocalProfile(profileKey = PROFILE_KEY): PatientProfile | null {
  const raw = uni.getStorageSync(profileKey) as string;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PatientProfile>;
    const safe = displaySafeProfile(parsed.name, parsed.phone, parsed.updatedAt);
    const safeRaw = JSON.stringify(safe);
    if (safeRaw !== raw) uni.setStorageSync(profileKey, safeRaw);
    return safe;
  } catch {
    return null;
  }
}

export type FollowupSummary = {
  state: "success" | "empty" | "error";
  pendingCount: number;
  latestTitle: string;
};

/** 首页「待跟进」摘要：与查看回复同源 */
export async function getFollowupSummary(doctorId?: number): Promise<FollowupSummary> {
  if (!getMpToken() || !doctorId) return { state: "empty", pendingCount: 0, latestTitle: "" };
  if (USE_MOCK) {
    await delay(120);
    const local = getLocalProfile();
    if (!local) return { state: "empty", pendingCount: 0, latestTitle: "" };
    return { state: "success", pendingCount: 1, latestTitle: "门诊加号 · 助理处理中" };
  }
  try {
    const { items, raw } = await getRepliesMine(doctorId);
    const pendingReplies = raw.replies.filter(
      (r: any) => !REPLY_DONE.has(String(r.status || ""))
    );
    const pendingFu = raw.followups.filter((f: any) => {
      const st = String(f.status || "");
      return !REPLY_DONE.has(st) && st !== "completed";
    });
    const pendingCount = pendingReplies.length + pendingFu.length;
    const sorted = [...items].sort((a, b) =>
      String(b.at || b.time).localeCompare(String(a.at || a.time))
    );
    const latest = sorted[0];
    if (pendingCount <= 0) return { state: "empty", pendingCount: 0, latestTitle: "" };
    return {
      state: "success",
      pendingCount,
      latestTitle: latest ? `${latest.title} · ${latest.status}` : "",
    };
  } catch {
    return { state: "error", pendingCount: 0, latestTitle: "" };
  }
}

function displaySafeProfile(
  name: unknown,
  phone: unknown,
  updatedAt = new Date().toISOString().slice(0, 10)
): PatientProfile {
  return {
    name: String(name || "").trim(),
    phone: maskPhoneForCache(String(phone || "")),
    gender: "",
    birthDate: "",
    idNumber: "",
    disease: "",
    pregnancyStatus: "",
    foodContactAllergies: "",
    drugAllergies: "",
    diseaseHistory: "",
    updatedAt: String(updatedAt || ""),
  };
}

function maskPhoneForCache(phone: string): string {
  const value = String(phone || "").trim();
  if (/^1\d{10}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`;
  if (/^1\d{2}\*{4}\d{4}$/.test(value)) return value;
  return "";
}

/** 建档后只缓存首页展示所需摘要，完整档案以服务端为准。 */
export function saveLocalProfileFromPayload(payload: Record<string, string>, profileKey = PROFILE_KEY) {
  const profile = displaySafeProfile(
    payload["姓名"] || payload.name,
    payload["手机号"] || payload.phone
  );
  uni.setStorageSync(profileKey, JSON.stringify(profile));
}

function emptyArchive(): PatientArchive {
  return {
    id: 0,
    displayName: "",
    phone: "",
    disease: "",
    archived: false,
    contactSummary: undefined,
  };
}

function archiveFromPrefill(prefill: ArchiveFormPrefill, patient?: { name?: string; phoneMasked?: string }): PatientArchive {
  const name = String(prefill.name || patient?.name || "").trim();
  const phone = String(prefill.phone || patient?.phoneMasked || "").trim();
  const hasData = !!(name || phone || prefill.disease);
  return {
    id: 0,
    displayName: name,
    phone: patient?.phoneMasked || (phone ? maskPhoneDisplay(phone) : ""),
    disease: String(prefill.disease || ""),
    archived: false,
    contactSummary: hasData
      ? {
          姓名: name || "未填写",
          性别: String(prefill.gender || "未填写"),
          出生日期: String(prefill.birthDate || "未填写"),
          手机号: phone || "未填写",
          血型: String(prefill.bloodType || "未填写"),
          身高: prefill.heightCm ? `${prefill.heightCm} cm` : "未填写",
          体重: prefill.weightKg ? `${prefill.weightKg} kg` : "未填写",
          健康备注: String(prefill.healthNotes || "未填写"),
          所患疾病: String(prefill.disease || "未填写"),
          是否妊娠哺乳: String(prefill.pregnancyStatus || "未填写"),
          食物接触物过敏: checkboxSummary(allergyToFormJson(prefill.foodContactAllergies)),
          药物过敏: checkboxSummary(allergyToFormJson(prefill.drugAllergies)),
          疾病史: checkboxSummary(allergyToFormJson(prefill.diseaseHistory)),
        }
      : undefined,
  };
}

function maskPhoneDisplay(phone: string): string {
  const p = String(phone || "").trim();
  if (/^1\d{10}$/.test(p)) return `${p.slice(0, 3)}****${p.slice(-4)}`;
  return p;
}

/** 患者侧档案真读：GET /api/mp/archive；已登录只信服务端，不用本地 mock 假数据 */
export async function getMyArchive(profileKey = PROFILE_KEY): Promise<PatientArchive> {
  if (USE_MOCK) {
    await delay();
    const local = getLocalProfile(profileKey);
    if (!local) return emptyArchive();
    return {
      ...emptyArchive(),
      displayName: local.name,
      phone: maskPhoneDisplay(local.phone),
      disease: local.disease,
      archived: true,
      contactSummary: {
        姓名: local.name,
        性别: local.gender || "未填写",
        出生日期: local.birthDate || "未填写",
        手机号: local.phone,
        血型: local.bloodType || "未填写",
        身高: local.heightCm || "未填写",
        体重: local.weightKg || "未填写",
        健康备注: local.healthNotes || "未填写",
        所患疾病: local.disease || "未填写",
        是否妊娠哺乳: local.pregnancyStatus || "未填写",
        食物接触物过敏: local.foodContactAllergies || "无",
        药物过敏: local.drugAllergies || "无",
        疾病史: local.diseaseHistory || "无",
      },
    };
  }
  const t = getMpToken();
  if (!t) return emptyArchive();
  const res = await uni.request({
    url: `${API_BASE}/api/mp/archive`,
    method: "GET",
    header: { Authorization: `Bearer ${t}` },
  });
  const data = parseRequestData(res.data);
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `加载失败（${res.statusCode || 0}）`);
  }
  if (data.formPrefill) {
    saveLocalProfileFromPrefill(data.formPrefill, profileKey);
  }
  if (!data.linked) {
    return emptyArchive();
  }
  if (!data.hasProfile) {
    const prefill = (data.formPrefill || {}) as ArchiveFormPrefill;
    return archiveFromPrefill(prefill, data.patient);
  }
  const p = data.patient || {};
  const profile = data.profile || {};
  return {
    id: Number(p.id) || 0,
    displayName: String(p.name || ""),
    phone: String(p.phoneMasked || ""),
    disease: String(profile.disease || ""),
    archived: true,
    contactSummary: {
      姓名: String(p.name || ""),
      性别: String(p.gender || "未填写"),
      出生日期: String(p.birthDate || "未填写"),
      手机号: String(p.phoneMasked || ""),
      血型: String(profile.bloodType || "未填写"),
      身高: profile.heightCm ? `${profile.heightCm} cm` : "未填写",
      体重: profile.weightKg ? `${profile.weightKg} kg` : "未填写",
      BMI: String(profile.bmi || "未填写"),
      健康备注: String(profile.healthNotes || "未填写"),
      所患疾病: String(profile.disease || "未填写"),
      是否妊娠哺乳: String(profile.pregnancyStatus || "未填写"),
      食物接触物过敏: formatAllergy(profile.foodContactAllergies),
      药物过敏: formatAllergy(profile.drugAllergies),
      疾病史: formatAllergy(profile.diseaseHistory),
    },
  };
}

export type ArchiveFormPrefill = {
  name?: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  idNumber?: string;
  disease?: string;
  pregnancyStatus?: string;
  foodContactAllergies?: { values: string[]; other?: string };
  drugAllergies?: { values: string[]; other?: string };
  diseaseHistory?: { values: string[]; other?: string };
  bloodType?: string;
  heightCm?: string;
  weightKg?: string;
  healthNotes?: string;
};

export type FormInitialValue = string | { values: string[]; other?: string };

function allergyToFormJson(v?: { values?: string[]; other?: string }): string {
  const values = Array.isArray(v?.values) ? v!.values : [];
  const other = String(v?.other || "");
  return JSON.stringify({ values, other });
}

/** 把服务端 formPrefill 压缩为无敏感正文的本地展示摘要。 */
export function saveLocalProfileFromPrefill(prefill: ArchiveFormPrefill, profileKey = PROFILE_KEY) {
  if (!prefill?.name && !prefill?.phone) return;
  const profile = displaySafeProfile(prefill.name, prefill.phone);
  uni.setStorageSync(profileKey, JSON.stringify(profile));
}

/** 拉取建档问卷预填值（已绑手机会话） */
export async function fetchArchiveFormPrefill(): Promise<Record<string, FormInitialValue> | null> {
  if (USE_MOCK) return null;
  const t = getMpToken();
  if (!t) return null;
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/mp/archive`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error || !data.formPrefill) return null;
    const p = data.formPrefill as ArchiveFormPrefill;
    const out: Record<string, FormInitialValue> = {};
    if (p.name) out.name = String(p.name);
    if (p.gender) out.gender = String(p.gender);
    if (p.birthDate) out.birthDate = String(p.birthDate);
    if (p.phone) out.phone = String(p.phone);
    if (p.disease) out.disease = String(p.disease);
    if (p.pregnancyStatus) out.pregnancyStatus = String(p.pregnancyStatus);
    if (p.foodContactAllergies) out.foodContactAllergies = p.foodContactAllergies;
    if (p.drugAllergies) out.drugAllergies = p.drugAllergies;
    if (p.diseaseHistory) out.diseaseHistory = p.diseaseHistory;
    if (p.bloodType) out.bloodType = String(p.bloodType);
    if (p.heightCm) out.heightCm = String(p.heightCm);
    if (p.weightKg) out.weightKg = String(p.weightKg);
    if (p.healthNotes) out.healthNotes = String(p.healthNotes);
    /* 联络表中文 key 兼容 */
    if (out.name) out["姓名"] = out.name;
    if (out.gender) out["性别"] = out.gender;
    if (out.birthDate) out["出生日期"] = out.birthDate;
    if (out.phone) out["手机号"] = out.phone;
    if (out.disease) out["您所患的疾病"] = out.disease;
    if (out.pregnancyStatus) out["是否妊娠哺乳"] = out.pregnancyStatus;
    if (out.foodContactAllergies) out["食物、接触物过敏"] = out.foodContactAllergies;
    if (out.drugAllergies) out["药物过敏"] = out.drugAllergies;
    if (out.diseaseHistory) out["疾病史"] = out.diseaseHistory;
    if (out.bloodType) out["血型"] = out.bloodType;
    if (out.heightCm) out["身高"] = out.heightCm;
    if (out.weightKg) out["体重"] = out.weightKg;
    if (out.healthNotes) out["健康备注"] = out.healthNotes;
    return out;
  } catch {
    return null;
  }
}

export type ConsultingDoctor = {
  doctorId: number;
  doctorName: string;
  title: string;
  dept: string;
  hospital: string;
  avatarUrl: string;
  patientId: number;
  msgCount: number;
  lastAt: string;
};

export type SettledDoctor = {
  doctorId: number;
  doctorName: string;
  title: string;
  dept: string;
  hospital: string;
};

/** 入驻医生库（首次选医生） */
export async function getSettledDoctors(): Promise<SettledDoctor[]> {
  if (USE_MOCK) {
    await delay(200);
    return [];
  }
  const t = getMpToken();
  if (!t) return [];
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/mp/settled-doctors`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
      timeout: 10000,
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error) return [];
    return Array.isArray(data.doctors) ? data.doctors : [];
  } catch {
    return [];
  }
}

/** 患者本人咨询过的所有医生（跨医生咨询记录，通过 person_id 关联） */
export async function getMyDoctors(): Promise<ConsultingDoctor[]> {
  if (USE_MOCK) {
    await delay(200);
    return [];
  }
  const t = getMpToken();
  if (!t) return [];
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/mp/my-doctors`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
      timeout: 10000,
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error) return [];
    return Array.isArray(data.doctors) ? data.doctors : [];
  } catch {
    return [];
  }
}

export async function getMyHealthCategories(): Promise<HealthCategory[]> {
  if (USE_MOCK) {
    await delay();
    return JSON.parse(JSON.stringify(mockHealthCategories));
  }
  const t = getMpToken();
  if (!t) return [];
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/mp/health-records`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error) {
      throw new Error(data.error || `加载失败（${res.statusCode || 0}）`);
    }
    return Array.isArray(data.categories) ? data.categories : [];
  } catch {
    return [];
  }
}

export async function getMyHealthRecords(category?: string): Promise<HealthRecord[]> {
  if (USE_MOCK) {
    await delay();
    const rows = mockHealthRecords.filter((r) => !category || r.category === category);
    return JSON.parse(JSON.stringify(rows));
  }
  const t = getMpToken();
  if (!t) return [];
  try {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    const res = await uni.request({
      url: `${API_BASE}/api/mp/health-records${qs}`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error) {
      throw new Error(data.error || `加载失败（${res.statusCode || 0}）`);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((r: any) => ({
      id: Number(r.id) || 0,
      category: String(r.category || ""),
      categoryLabel: String(r.categoryLabel || r.category || ""),
      title: String(r.title || ""),
      summary: String(r.summary || ""),
      recordedAt: String(r.recordedAt || ""),
    }));
  } catch {
    return [];
  }
}

export async function getMyHealthRecord(ref: string | number): Promise<HealthRecordDetail | null> {
  const recordId = parseHealthRecordRef(ref);
  if (!recordId) return null;
  if (USE_MOCK) {
    await delay();
    const row = mockHealthRecords.find((r) => r.id === recordId);
    return row
      ? {
          ...row,
          sourceDoctorName: "春雨医生团队",
          attachments: [],
          extra: { status: "confirmed" },
        }
      : null;
  }
  const t = getMpToken();
  if (!t) return null;
  try {
    const res = await uni.request({
      url: `${API_BASE}/api/mp/health-records/${encodeURIComponent(String(ref))}`,
      method: "GET",
      header: { Authorization: `Bearer ${t}` },
    });
    const data = parseRequestData(res.data);
    if ((res.statusCode || 0) >= 400 || data.error) {
      throw new Error(data.error || `加载失败（${res.statusCode || 0}）`);
    }
    const item = data.item && typeof data.item === "object" ? data.item : null;
    return item ? mapHealthRecordDetail(item as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function createMyHealthRecord(payload: {
  category: string;
  title: string;
  summary?: string;
  recordedAt?: string;
  imagePaths?: string[];
}): Promise<HealthRecordDetail> {
  if (USE_MOCK) {
    await delay();
    const meta = mockHealthCategories.find((c) => c.key === payload.category);
    const nextId = Math.max(0, ...mockHealthRecords.map((r) => r.id)) + 1;
    const row: HealthRecordDetail = {
      id: nextId,
      category: payload.category,
      categoryLabel: meta?.label || payload.category,
      title: payload.title,
      summary: payload.summary || "",
      recordedAt: payload.recordedAt || new Date().toISOString().slice(0, 10),
      extra: { status: "pending", origin: "manual" },
      attachments: [],
    };
    mockHealthRecords.unshift(row);
    return row;
  }
  const t = getMpToken();
  if (!t) throw new Error("请先登录");
  const attachments = await buildAttachments(payload.imagePaths);
  const res = await uni.request({
    url: `${API_BASE}/api/mp/health-records`,
    method: "POST",
    header: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    data: {
      category: payload.category,
      title: payload.title,
      summary: payload.summary || "",
      recordedAt: payload.recordedAt || "",
      attachments,
      extra: { origin: "manual", status: "pending" },
    },
  });
  const data = parseRequestData(res.data);
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `提交失败（${res.statusCode || 0}）`);
  }
  const item = data.item && typeof data.item === "object" ? data.item : null;
  if (!item) throw new Error("提交失败");
  return mapHealthRecordDetail(item as Record<string, unknown>);
}
