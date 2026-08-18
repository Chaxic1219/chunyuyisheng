import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AssistantRole } from "../types/v32";

export const useConsultationStore = defineStore("consultation-v32", () => {
  const role = ref<AssistantRole>("waiting");
  const entryContext = ref("");
  const quickTopics = [
    { label: "看报告", text: "帮我看看这份报告", iconSrc: "/static/consult-ui/calendar-alt.png" },
    { label: "问用药", text: "我的药快用完了，应该怎么办", iconSrc: "/static/consult-ui/medication.png" },
    { label: "安排复诊", text: "帮我安排复诊", iconSrc: "/static/consult-ui/follow-up.png" },
  ];

  const roleMeta = computed(() => {
    if (role.value === "life") {
      return {
        title: "生活管家",
        sub: "预约、订单、权益和服务进度",
        icon: "consult-doctor",
        color: "#936015",
        soft: "#FFF1D6",
      };
    }
    if (role.value === "handoff") {
      return {
        title: "协同处理中",
        sub: "先确认健康安全，再办理服务",
        icon: "service-package",
        color: "#2C638E",
        soft: "#E7F1F8",
      };
    }
    if (role.value === "health") {
      return {
        title: "健康助手",
        sub: "AI 辅助，不是医生",
        icon: "health-assistant",
        color: "#176B52",
        soft: "#E5F3EC",
      };
    }
    return {
      title: "咨询",
      sub: "等待你的需求",
      icon: "consult-doctor",
      color: "#456FD8",
      soft: "#ECF2FF",
    };
  });

  const contextLine = computed(() => {
    if (entryContext.value) return entryContext.value;
    if (role.value === "life") return "可带入：服务订单、预约需求、权益和售后问题";
    if (role.value === "handoff") return "本次会先确认用药安全，再请求你授权共享给生活管家";
    if (role.value === "health") return "可带入：健康计划、用药、检查报告和最近记录";
    return "直接描述问题，系统会自动匹配健康助手或生活管家";
  });

  function classifyIntent(value: string): AssistantRole {
    const v = value.toLowerCase();
    const healthWords = ["报告", "药", "症状", "不舒服", "血压", "血糖", "健康计划", "诊断", "检查", "复查"];
    const lifeWords = ["预约", "复诊", "续方", "购药", "服务", "订单", "退款", "发票", "配送", "物流", "价格", "权益"];
    const healthMatched = healthWords.some((word) => v.includes(word));
    const lifeMatched = lifeWords.some((word) => v.includes(word));
    if (healthMatched && lifeMatched) return "handoff";
    if (lifeMatched) return "life";
    if (healthMatched) return "health";
    return "waiting";
  }

  function selectRole(value: AssistantRole) {
    role.value = value === "waiting" ? "health" : value;
  }

  function applyEntryContext(value: string, roleHint: AssistantRole = "health") {
    const next = String(value || "").trim();
    if (next) entryContext.value = next;
    selectRole(roleHint);
  }

  function reset() {
    role.value = "waiting";
    entryContext.value = "";
  }

  return {
    role,
    roleMeta,
    contextLine,
    entryContext,
    quickTopics,
    classifyIntent,
    selectRole,
    applyEntryContext,
    reset,
  };
});
