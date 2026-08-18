/** 患者端 bootstrap / 表单 / 消息类型（对齐现网 API 形状） */

export interface Doctor {
  id: string;
  name: string;
  title: string;
  dept: string;
  hospital: string;
  hospitalPhone?: string;
  slug?: string;
}

export interface FormField {
  key: string;
  label: string;
  type?: "text" | "phone" | "tel" | "textarea" | "select" | "date" | "checkboxGroup" | "file";
  required?: boolean;
  placeholder?: string;
  options?: string[];
  noneValue?: string;
  otherValue?: string;
  accept?: string[];
  pattern?: string;
  err?: string;
  sensitive?: boolean;
}

export interface FormConfig {
  title: string;
  fields: FormField[];
  notes?: string;
  consent?: string;
}

export interface ArticleSection {
  h: string;
  p: string;
}

export interface ArticleConfig {
  title: string;
  /** 后端多为 [{h,p}]；部分 mock/旧数据为纯文本 */
  body: string | ArticleSection[];
  source?: string;
  tip?: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface BootstrapContent {
  addNumber?: FormConfig;
  admission?: FormConfig;
  contactForm?: FormConfig;
  clinicArticle?: ArticleConfig;
  dietArticle?: ArticleConfig;
  surgeryArticle?: ArticleConfig;
  replyCenter?: { title?: string };
  thankDoctor?: { title?: string };
  followupPlans?: unknown[];
  servicePackages?: { id: string; title: string; desc: string }[];
  doctorProfile?: { intro?: string; skills?: string };
  videoConsult?: unknown;
  doctorVideo?: unknown;
}

export interface BootstrapData {
  doctor: Doctor;
  content: BootstrapContent;
  faq: FaqItem[];
  capabilities?: {
    smsAvailable?: boolean;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: string[];
  triage?: {
    level: "low" | "medium" | "high";
    summary: string;
  };
}

export interface SubmitPayload {
  doctorId: string;
  type: string;
  payload: Record<string, string>;
  /** 门诊凭证上传后的 URL（与 H5 /api/submit 对齐） */
  outpatientVoucherUrl?: string;
  /** 联络表：顶层手机号（与 payload 内手机号一致，供短信验证） */
  phone?: string;
  /** 联络表：短信验证码 */
  code?: string;
  /** 联络表：敏感信息单独同意 */
  consent?: boolean;
}

export interface PatientSessionInfo {
  phoneBound: boolean;
  smsAvailable?: boolean;
  phoneMasked?: string | null;
  patientId?: number | null;
  personId?: number | null;
  source?: string;
}

export interface InviteMergeCandidate {
  id: number;
  displayNameMasked: string;
  phoneMasked: string;
  nameHint?: boolean;
}

export interface InviteSubmitPayload {
  doctorId: string | number;
  phone: string;
  consent: boolean;
  payload: Record<string, string>;
  outpatientVoucherUrl?: string;
  smsCode?: string;
  verificationProof?: string;
  confirmMergePatientId?: number;
  forceCreate?: boolean;
}

export interface InviteSubmitResult {
  ok: boolean;
  message: string;
  needsMergeConfirm?: boolean;
  candidates?: InviteMergeCandidate[];
  verificationProof?: string;
  merged?: boolean;
  patientId?: number;
}

export interface HealthCategory {
  key: string;
  label: string;
  hint: string;
  color: string;
  count?: number;
}

export interface HealthRecord {
  id: number;
  category: string;
  categoryLabel: string;
  title: string;
  summary: string;
  recordedAt: string;
}

export interface PatientArchive {
  id: number;
  displayName: string;
  phone: string;
  disease?: string;
  city?: string;
  followStage?: string;
  archived: boolean;
  familyDoctorEnrolled?: boolean;
  stats?: { messages: number; pending: number; healthRecords: number };
  contactSummary?: Record<string, string>;
}
