import type { HealthCategory, HealthRecord, PatientArchive } from "@chunyu/patient-design/types";

export const mockArchive: PatientArchive = {
  id: 1001,
  displayName: "王小华",
  phone: "13800138000",
  disease: "膝关节骨关节炎",
  city: "北京",
  followStage: "随访中",
  archived: true,
  familyDoctorEnrolled: true,
  stats: { messages: 12, pending: 1, healthRecords: 4 },
  contactSummary: {
    姓名: "王小华",
    手机号: "13800138000",
    主要疾病: "膝关节骨关节炎",
    所在城市: "北京",
    与患者关系: "本人",
  },
};

export const mockHealthCategories: HealthCategory[] = [
  { key: "discharge_summary", label: "出院摘要", hint: "住院出院小结", color: "#1a6b8a", count: 1 },
  { key: "health_checkup", label: "健康检查报告", hint: "体检与复查报告", color: "#1f9a7a", count: 1 },
  { key: "imaging", label: "影像结果", hint: "CT / MRI / X 光", color: "#3aa0d9", count: 1 },
  { key: "lab", label: "化验结果", hint: "血检 / 尿检等", color: "#2f7fd1", count: 1 },
  { key: "prescription", label: "处方记录", hint: "用药处方", color: "#0d8a7b", count: 0 },
  { key: "drug_allergy", label: "药物过敏记录", hint: "已知过敏与反应", color: "#3cb371", count: 0 },
  { key: "endoscopy", label: "内视镜检查报告", hint: "胃镜/肠镜等", color: "#5b7cfa", count: 0 },
  { key: "medical_certificate", label: "医生证明书", hint: "诊断证明", color: "#7b6fd1", count: 0 },
  { key: "referral_letter", label: "转介信", hint: "转诊 / 会诊", color: "#8b6bb8", count: 0 },
  { key: "general_letter", label: "一般信件", hint: "其它文书", color: "#4a7fa8", count: 0 },
];

export const mockHealthRecords: HealthRecord[] = [
  {
    id: 1,
    category: "discharge_summary",
    categoryLabel: "出院摘要",
    title: "右膝置换术后出院小结",
    summary: "术后恢复良好，建议按时康复训练与复查。",
    recordedAt: "2026-06-12",
  },
  {
    id: 2,
    category: "health_checkup",
    categoryLabel: "健康检查报告",
    title: "术后 6 周门诊复查",
    summary: "切口愈合良好，关节活动度改善。",
    recordedAt: "2026-07-01",
  },
  {
    id: 3,
    category: "imaging",
    categoryLabel: "影像结果",
    title: "膝关节正侧位 X 光",
    summary: "假体位置良好，未见明显松动。",
    recordedAt: "2026-07-01",
  },
  {
    id: 4,
    category: "lab",
    categoryLabel: "化验结果",
    title: "血常规 + CRP",
    summary: "炎症指标正常范围内。",
    recordedAt: "2026-06-28",
  },
];
