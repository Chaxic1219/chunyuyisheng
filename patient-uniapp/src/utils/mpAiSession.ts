import { isOpaqueStorageScopeId } from "./storageScope";

const SESSION_KEY = "mpAiSessionId";
const CONSENT_KEY = "mpAiConsent";
const TRANSCRIPT_KEY = "mpAiChatTranscript";
const CONTEXT_TURNS = 10;
const TRANSCRIPT_MAX_MESSAGES = 50;
const TRANSCRIPT_MAX_TEXT = 2000;
export const AI_CONSENT_VERSION = "2026-07-31";

export type MpAiTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export function isOpaqueMpAiStorageScope(scope: unknown): boolean {
  return isOpaqueStorageScopeId(scope);
}

function requireOpaqueScope(scope: string): string {
  const value = String(scope || "").trim();
  if (!isOpaqueMpAiStorageScope(value)) throw new Error("invalid_ai_storage_scope");
  return value;
}

export interface MpAiIdentitySnapshot {
  readonly scope: string;
  readonly authEpoch: number;
  readonly operationId: number;
  readonly doctorId: number;
  readonly patientId: number;
  readonly personId: number;
  readonly token: string;
}

export function createMpAiIdentitySnapshot(
  value: MpAiIdentitySnapshot
): Readonly<MpAiIdentitySnapshot> | null {
  const snapshot = {
    scope: String(value.scope || "").trim(),
    authEpoch: Number(value.authEpoch),
    operationId: Number(value.operationId),
    doctorId: Number(value.doctorId),
    patientId: Number(value.patientId),
    personId: Number(value.personId),
    token: String(value.token || "").trim(),
  };
  if (
    !isOpaqueMpAiStorageScope(snapshot.scope) ||
    !snapshot.token ||
    !Number.isInteger(snapshot.authEpoch) ||
    !Number.isInteger(snapshot.operationId) ||
    snapshot.operationId <= 0 ||
    !Number.isInteger(snapshot.doctorId) ||
    snapshot.doctorId <= 0 ||
    !Number.isInteger(snapshot.patientId) ||
    snapshot.patientId <= 0 ||
    !Number.isInteger(snapshot.personId) ||
    snapshot.personId <= 0
  ) {
    return null;
  }
  return Object.freeze(snapshot);
}

export function isMpAiIdentitySnapshotCurrent(
  snapshot: MpAiIdentitySnapshot,
  current: MpAiIdentitySnapshot
): boolean {
  return (
    snapshot.scope === current.scope &&
    snapshot.authEpoch === current.authEpoch &&
    snapshot.operationId === current.operationId &&
    snapshot.doctorId === current.doctorId &&
    snapshot.patientId === current.patientId &&
    snapshot.personId === current.personId &&
    snapshot.token === current.token
  );
}

export function createMpAiSessionId(): string {
  return `mpai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sessionKey(scope: string) {
  return `${SESSION_KEY}:${requireOpaqueScope(scope)}`;
}

function consentKey(scope: string) {
  return `${CONSENT_KEY}:${requireOpaqueScope(scope)}`;
}

export function ensureSessionId(scope: string): string {
  const cur = String(uni.getStorageSync(sessionKey(scope)) || "").trim();
  if (cur) return cur;
  const id = createMpAiSessionId();
  uni.setStorageSync(sessionKey(scope), id);
  return id;
}

export function persistSessionId(scope: string, sessionId: string): void {
  uni.setStorageSync(sessionKey(scope), sessionId);
}

function transcriptKey(scope: string) {
  return `${TRANSCRIPT_KEY}:${requireOpaqueScope(scope)}`;
}

function sanitizeTranscriptMessage(raw: unknown): MpAiTranscriptMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const role = String(row.role || "").trim();
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  const id = String(row.id || "").trim().slice(0, 80);
  const text = String(row.text || "").trim().slice(0, TRANSCRIPT_MAX_TEXT);
  if (!id || !text) return null;
  return { id, role, text };
}

export function loadMpAiTranscript(scope: string): MpAiTranscriptMessage[] {
  if (!isOpaqueMpAiStorageScope(scope)) return [];
  try {
    const raw = uni.getStorageSync(transcriptKey(scope));
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeTranscriptMessage)
      .filter((item): item is MpAiTranscriptMessage => !!item)
      .slice(-TRANSCRIPT_MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function clearMpAiTranscript(scope: string): void {
  if (!isOpaqueMpAiStorageScope(scope)) return;
  try {
    uni.removeStorageSync(transcriptKey(scope));
  } catch {
    /* ignore */
  }
}

export function saveMpAiTranscript(
  scope: string,
  messages: Array<{ id?: unknown; role?: unknown; text?: unknown }>
): void {
  if (!isOpaqueMpAiStorageScope(scope)) return;
  const rows = (Array.isArray(messages) ? messages : [])
    .map(sanitizeTranscriptMessage)
    .filter((item): item is MpAiTranscriptMessage => !!item)
    .slice(-TRANSCRIPT_MAX_MESSAGES);
  if (!rows.length) return;
  uni.setStorageSync(transcriptKey(scope), JSON.stringify(rows));
}

export function hasMpAiConsent(scope: string): boolean {
  if (!isOpaqueMpAiStorageScope(scope)) return false;
  return uni.getStorageSync(consentKey(scope)) === AI_CONSENT_VERSION;
}

export function saveMpAiConsent(scope: string): void {
  uni.setStorageSync(consentKey(scope), AI_CONSENT_VERSION);
}

export { CONSENT_KEY, SESSION_KEY, TRANSCRIPT_KEY, CONTEXT_TURNS, TRANSCRIPT_MAX_MESSAGES };
