/** 患者健康记录分类（两图取舍：保留临床+文书核心，去掉保险理赔） */
const HEALTH_RECORD_CATEGORIES = [
  { key: "discharge_summary", label: "出院摘要", hint: "住院出院小结", color: "#1a6b8a" },
  { key: "health_checkup", label: "健康检查报告", hint: "体检与复查报告", color: "#1f9a7a" },
  { key: "endoscopy", label: "内视镜检查报告", hint: "胃镜/肠镜等", color: "#5b7cfa" },
  { key: "imaging", label: "影像结果", hint: "CT / MRI / X 光", color: "#3aa0d9" },
  { key: "lab", label: "化验结果", hint: "血检 / 尿检等", color: "#2f7fd1" },
  { key: "prescription", label: "处方记录", hint: "用药处方", color: "#0d8a7b" },
  { key: "drug_allergy", label: "药物过敏记录", hint: "已知过敏与反应", color: "#3cb371" },
  { key: "medical_certificate", label: "医生证明书", hint: "诊断证明 / 休假证明", color: "#7b6fd1" },
  { key: "referral_letter", label: "转介信", hint: "转诊 / 会诊转介", color: "#8b6bb8" },
  { key: "general_letter", label: "一般信件", hint: "其它医疗文书往来", color: "#4a7fa8" }
];

const HEALTH_RECORD_CATEGORY_KEYS = new Set(HEALTH_RECORD_CATEGORIES.map((c) => c.key));

function healthRecordCategoryMeta(key) {
  return HEALTH_RECORD_CATEGORIES.find((c) => c.key === key) || null;
}

function mapHealthRecordRow(r) {
  let extra = {};
  let attachments = [];
  try {
    extra = JSON.parse(r.extra || "{}") || {};
  } catch (e) {
    extra = {};
  }
  try {
    attachments = JSON.parse(r.attachments || "[]") || [];
  } catch (e) {
    attachments = [];
  }
  const meta = healthRecordCategoryMeta(r.category);
  return {
    id: r.id,
    doctorId: r.doctor_id,
    patientId: r.patient_id,
    personId: r.person_id || null,
    sourceDoctorName: r.source_doctor_name || "",
    category: r.category,
    categoryLabel: meta ? meta.label : r.category,
    title: r.title || "",
    summary: r.summary || "",
    recordedAt: r.recorded_at || "",
    extra,
    attachments,
    createdBy: r.created_by || "",
    createdAt: r.created_at || "",
    updatedAt: r.updated_at || ""
  };
}

module.exports = {
  HEALTH_RECORD_CATEGORIES,
  HEALTH_RECORD_CATEGORY_KEYS,
  healthRecordCategoryMeta,
  mapHealthRecordRow
};
