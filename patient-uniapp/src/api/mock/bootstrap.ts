import type { BootstrapData } from "@chunyu/patient-design/types";

export const mockBootstrap: BootstrapData = {
  doctor: {
    id: "doc-default-1",
    name: "张明远",
    title: "主任医师",
    dept: "骨科",
    hospital: "示例大学附属医院",
    hospitalPhone: "010-88886666",
    slug: "zhang",
  },
  content: {
    addNumber: {
      title: "门诊加号",
      notes: "现场没号时可提交，助理评估后回电。",
      fields: [
        { key: "name", label: "患者姓名", type: "text", required: true },
        { key: "phone", label: "手机号", type: "phone", required: true },
        { key: "date", label: "希望就诊日期", type: "text", required: true, placeholder: "如 2026-07-20" },
        { key: "reason", label: "病情简述", type: "textarea", required: true },
      ],
      consent: "我已阅读并同意将信息仅用于后续服务跟进。",
    },
    admission: {
      title: "住院预约",
      notes: "需手术/住院时提交，助理评估排期。",
      fields: [
        { key: "name", label: "患者姓名", type: "text", required: true },
        { key: "phone", label: "手机号", type: "phone", required: true },
        { key: "diagnosis", label: "初步诊断/病种", type: "text", required: true },
        { key: "note", label: "补充说明", type: "textarea" },
      ],
      consent: "我已阅读并同意将信息仅用于后续服务跟进。",
    },
    contactForm: {
      title: "医患联络表",
      notes: "提交基础信息建档，资料仅用于为您提供服务。",
      fields: [
        { key: "name", label: "患者姓名", type: "text", required: true },
        { key: "phone", label: "手机号", type: "phone", required: true },
        { key: "relation", label: "与患者关系", type: "select", required: true, options: ["本人", "家属", "其他"] },
        { key: "address", label: "所在城市", type: "text" },
        { key: "note", label: "想了解的问题", type: "textarea" },
      ],
      consent: "我同意服务人员通过手机号联系我。",
    },
    clinicArticle: {
      title: "门诊时间",
      body: "周一上午、周三下午出诊。\n地址：门诊楼 3 层骨科诊区。\n挂号：可通过医院公众号或现场挂号。\n\n具体出诊信息以医院最新安排为准。",
    },
    dietArticle: {
      title: "术后饮食",
      body: "术后 1–3 天以清淡流质/半流质为主，逐步过渡到普食。忌辛辣与酒精。具体遵医嘱。",
    },
    surgeryArticle: {
      title: "住院手术须知",
      body: "入院前完善检查，按通知时间办理住院。禁食水时间以病房通知为准。家属陪护请遵守病区规定。",
    },
    replyCenter: { title: "查看回复" },
    servicePackages: [
      { id: "pkg1", title: "膝关节置换随访包", desc: "术后复查提醒与康复指导" },
      { id: "pkg2", title: "腰突保守治疗包", desc: "复诊计划与注意事项" },
    ],
    doctorProfile: {
      intro: "从事骨科临床工作二十余年，擅长关节置换与脊柱微创。",
      skills: "膝关节置换、腰椎间盘突出、骨折创伤",
    },
  },
  faq: [
    { q: "加号多久有回复？", a: "工作日一般 24 小时内助理回电；急诊请直接医院急诊科。" },
    { q: "咨询是真人医生吗？", a: "在线咨询由医生团队医助提供初步解答，必要时可转人工服务跟进。" },
    { q: "信息安全吗？", a: "提交内容仅用于为您提供服务与就诊跟进，不作公开展示。" },
  ],
};
