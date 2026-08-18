"use strict";

const HERO = {
  kicker: "今日健康管理",
  signedTitle: "现在先完成这一步",
  unsignedTitle: "建立第一份健康计划",
  signedDesc: "系统已整理档案、计划和服务进度，首页只保留当前最重要的行动。",
  unsignedDesc: "上传处方、检查报告或出院小结，确认后生成可执行的健康计划。",
  signedAction: "查看健康计划",
  unsignedAction: "完善健康档案",
  visual: "/static/visual/report-upload-guide.png",
};

const QUICK_ACTIONS = [
  { key: "upload", icon: "upload", label: "健康档案", url: "/pages/records/index" },
  { key: "plan", icon: "heart", label: "健康计划", url: "/pages/plans/detail" },
  { key: "service", icon: "replies", label: "健康服务", url: "/pages/services/index" },
];

const KIND_ICON = {
  medication: { icon: "check", iconColor: "#176B52" },
  metric: { icon: "heart", iconColor: "#176B52" },
  followup: { icon: "calendar", iconColor: "#936015", amber: true },
  review: { icon: "archive", iconColor: "#2c638e" },
};

function modeLabel(mode) {
  if (!mode || mode === "self" || mode === "none") {
    return "自主管理 · 不依赖医生持续查看";
  }
  if (mode === "copilot" || mode === "pro") {
    return "医生共管";
  }
  return String(mode);
}

function confirmationKeys(confirmations) {
  return new Set((confirmations || []).map((c) => String(c.source_key || "")));
}

function categoryKind(row) {
  const blob = `${row && row.category ? row.category : ""} ${row && row.title ? row.title : ""}`;
  if (/处方|用药|药品|medication|med\b/i.test(blob)) return "med";
  if (/血压|血糖|指标|metric|化验|检验/i.test(blob)) return "metric";
  if (/复诊|复查|随访|follow/i.test(blob)) return "follow";
  return "record";
}

function recordSourceKey(row) {
  if (!row) return "";
  if (row.source_key) return String(row.source_key);
  if (row.id == null) return "";
  return `${categoryKind(row)}-${row.id}`;
}

function findPendingRecord(healthRecords, confirmations) {
  const confirmed = confirmationKeys(confirmations);
  const records = Array.isArray(healthRecords) ? healthRecords : [];
  for (const r of records) {
    const key = recordSourceKey(r);
    if (!key) continue;
    if (confirmed.has(key) || confirmed.has(`record-${key}`)) continue;
    return r;
  }
  return null;
}

function buildPendingRecordSummary(healthRecords, confirmations) {
  const pending = findPendingRecord(healthRecords, confirmations);
  if (!pending) return null;
  const title = pending.title || "待确认健康资料";
  const desc =
    pending.summary ||
    (pending.category ? `识别出${pending.category}相关信息，确认后可生成任务` : "识别信息待确认");
  return {
    title,
    desc,
    actionText: "继续确认",
    actionUrl: "/pages/records/index",
  };
}

function taskProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, percent };
}

function nextPendingTask(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.find((t) => t.status !== "done") || null;
}

function buildPlanSummary(plan, tasks) {
  if (!plan) return null;
  const { total, done, percent } = taskProgress(tasks);
  const next = nextPendingTask(tasks);
  return {
    title: plan.title || "健康计划",
    mode: modeLabel(plan.mode),
    completionText: total > 0 ? `今日 ${done}/${total} 已完成` : "今日暂无任务",
    completionPercent: percent,
    actionText: "查看健康计划",
    actionUrl: "/pages/plans/detail",
    nextTask: next
      ? {
          title: next.title,
          desc: next.kind === "metric" ? "完成后自动回写计划。" : "完成后自动回写计划。",
          actionText: "去完成",
          toast: "",
        }
      : {
          title: "今日任务已完成",
          desc: "可查看计划详情或继续完善档案。",
          actionText: "查看计划",
          toast: "",
        },
  };
}

function defaultRecommendations() {
  return [
    {
      key: "copilot",
      icon: "shield",
      tone: "green",
      reason: "",
      title: "医生管家",
      desc: "",
      actionUrl: "/pages/services/catalog",
    },
    {
      key: "followup",
      icon: "calendar",
      tone: "amber",
      reason: "",
      title: "复诊协助",
      desc: "",
      actionUrl: "/pages/services/followup",
    },
  ];
}

function filterRecommendations(personId, repo, recommendations) {
  const list = Array.isArray(recommendations) ? recommendations : defaultRecommendations();
  let dismissed = new Set();
  try {
    if (repo && typeof repo.listDismissals === "function" && personId != null) {
      dismissed = new Set(
        (repo.listDismissals(personId) || []).map((r) => String(r.card_key || r))
      );
    }
  } catch (e) {
    dismissed = new Set();
  }
  return list.filter((r) => !dismissed.has(String(r.key)));
}

function buildHomeFeed(ctx) {
  ctx = ctx || {};
  const plan = ctx.plan || null;
  const tasks = ctx.tasks || [];
  const confirmations = ctx.confirmations || [];
  const healthRecords = ctx.healthRecords || [];
  const hasActivePlan = !!(plan && (plan.status === "active" || plan.status === "paused"));

  return {
    hero: {
      ...HERO,
      visual: hasActivePlan
        ? "/static/visual/home-hero-action.png"
        : "/static/visual/empty-no-plan.png",
    },
    plan: hasActivePlan ? buildPlanSummary(plan, tasks) : null,
    pendingRecord: buildPendingRecordSummary(healthRecords, confirmations),
    quickActions: QUICK_ACTIONS.slice(),
    serviceProgress: null,
    recommendations: filterRecommendations(ctx.personId, ctx.repo, ctx.recommendations),
  };
}

function buildMineAssets(ctx) {
  ctx = ctx || {};
  const repo = ctx.repo;
  const personId = ctx.personId;
  const healthRecords = ctx.healthRecords || [];
  const confirmations = ctx.confirmations || [];
  const plan = ctx.plan || null;
  const family = ctx.family || (repo && personId != null ? repo.listFamily(personId) : []) || [];

  const recordCount = healthRecords.length;
  const pending = findPendingRecord(healthRecords, confirmations);
  const pendingText = pending ? " · 1 项待确认" : "";
  const planCount =
    ctx.planCount != null
      ? ctx.planCount
      : repo && personId != null && typeof repo.countPlans === "function"
        ? repo.countPlans(personId)
        : plan
          ? 1
          : 0;
  const planSub = plan
    ? `${planCount || 1} 个计划 · 当前${plan.status === "active" ? "执行中" : plan.status === "paused" ? "已暂停" : "草稿"}`
    : planCount
      ? `${planCount} 个计划`
      : "暂无健康计划";

  return {
    metrics: [
      { value: String(recordCount || 0), label: "健康资料" },
      { value: String(planCount || 0), label: "健康计划" },
      { value: "0", label: "进行中服务" },
    ],
    healthEntries: [
      {
        key: "records",
        icon: "archive",
        title: "健康档案",
        sub: `${recordCount} 份资料${pendingText}`,
        url: "/pages/records/index",
        tone: "green",
      },
      {
        key: "plans",
        icon: "health",
        title: "健康计划",
        sub: planSub,
        url: "/pages/plans/detail",
        tone: "green",
      },
      {
        key: "health-log",
        icon: "heart",
        title: "健康记录",
        sub: "血压、用药、症状记录",
        url: "/pages/archive/health",
        tone: "green",
      },
      {
        key: "family",
        icon: "team",
        title: "家属管理",
        sub: family.length ? `${family.length} 位家属` : "授权代记录和代咨询",
        url: "/pages/family/index",
        tone: "green",
      },
    ],
    serviceEntries: [
      {
        key: "services",
        icon: "replies",
        title: "我的服务",
        sub: "本期暂无进行中服务",
        url: "/pages/services/mine-services",
        tone: "amber",
      },
      {
        key: "rights",
        icon: "shield",
        title: "优惠权益",
        sub: "暂无可用权益",
        url: "/pages/services/rights",
        tone: "amber",
      },
      {
        key: "agreements",
        icon: "lock",
        title: "服务协议",
        sub: "协议与退款规则",
        url: "/pages/services/agreements",
        tone: "amber",
      },
      {
        key: "after-sales",
        icon: "form",
        title: "发票售后",
        sub: "开票与售后申请",
        url: "/pages/services/after-sales",
        tone: "amber",
      },
    ],
    settingEntries: [
      { key: "elder", icon: "az", title: "长辈模式", sub: "放大字号与触控区域", tone: "blue" },
      {
        key: "notifications",
        icon: "clock",
        title: "消息与提醒",
        sub: "用药、复诊和服务进度提醒",
        tone: "blue",
      },
      {
        key: "privacy",
        icon: "lock",
        title: "隐私与数据授权",
        sub: "医生、助手和家属授权范围",
        tone: "blue",
      },
      {
        key: "delete",
        icon: "help",
        title: "数据导出或删除",
        sub: "申请导出或删除健康数据",
        tone: "danger",
        danger: true,
      },
    ],
  };
}

function recordIcon(row) {
  const cat = String((row && row.category) || "").toLowerCase();
  if (/lab|检查|化验|血脂|肝肾/.test(cat) || /检查|化验/.test(String((row && row.title) || ""))) {
    return { icon: "heart", iconColor: "#176B52" };
  }
  if (/discharge|出院|住院/.test(cat) || /出院|住院/.test(String((row && row.title) || ""))) {
    return { icon: "archive", iconColor: "#936015" };
  }
  return { icon: "file", iconColor: "#456FD8" };
}

function formatRecordDate(row) {
  const raw = (row && (row.recorded_at || row.updated_at || row.created_at)) || "";
  if (!raw) return "";
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw).slice(0, 10);
}

function buildRecordList(ctx) {
  ctx = ctx || {};
  const profile = ctx.profile || {};
  const name = profile.name || profile.displayName || "我";
  const healthRecords = Array.isArray(ctx.healthRecords) ? ctx.healthRecords : [];
  const confirmations = ctx.confirmations || [];
  const pendingRow = findPendingRecord(healthRecords, confirmations);
  const latest = healthRecords[0];
  const latestDate = latest ? formatRecordDate(latest) : "";

  return {
    summary: {
      owner: `${name}的健康档案`,
      title: `${healthRecords.length} 份资料`,
      desc: latestDate
        ? `最近更新于 ${latestDate}，诊断、用药和复诊信息均保留原始来源。`
        : "上传处方或检查报告后，可确认抽取项并生成健康计划。",
    },
    pending: pendingRow
      ? {
          title: pendingRow.title ? `${pendingRow.title}待确认` : "存在待确认资料",
          desc:
            pendingRow.summary ||
            "系统识别信息待确认，确认前不会据此生成任务。",
          sourceKey: recordSourceKey(pendingRow),
        }
      : {
          title: healthRecords.length ? "暂无待确认项" : "暂无健康资料",
          desc: healthRecords.length
            ? "已确认的资料可用于生成健康计划。"
            : "上传处方、检查报告或出院小结后开始建档。",
        },
    records: healthRecords.map((r) => {
      const ic = recordIcon(r);
      const date = formatRecordDate(r);
      const key = recordSourceKey(r);
      const isConfirmed = key && (confirmed.has(key) || confirmed.has(`record-${key}`));
      return {
        id: key || String(r.id || ""),
        icon: ic.icon,
        iconColor: ic.iconColor,
        title: r.title || r.category || "健康资料",
        desc: [date, isConfirmed ? "已由用户确认" : "待确认", r.summary]
          .filter(Boolean)
          .join(" · "),
        toast: `已打开 ${r.title || "健康资料"}`,
      };
    }),
  };
}

function daysSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const ms = Date.now() - t;
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

function buildPlanDetail(ctx) {
  ctx = ctx || {};
  const plan = ctx.plan;
  const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
  if (!plan) {
    return {
      title: "暂无健康计划",
      desc: "确认用药、指标或复诊信息后，可生成可执行的健康计划。",
      visual: "/static/visual/health-plan-service-hero.png",
      stats: [
        { value: "0", label: "执行天数" },
        { value: "0%", label: "今日完成" },
        { value: "0", label: "今日任务" },
      ],
      tasks: [],
    };
  }

  const { total, done, percent } = taskProgress(tasks);
  const execDays = daysSince(plan.created_at || plan.updated_at);

  return {
    title: plan.title || "健康计划",
    desc:
      plan.status === "draft"
        ? "计划草稿待启用。启用后将按日生成任务。"
        : "规律用药、持续记录指标，按时完成复诊。计划属于用户，医生共管是可选服务。",
    visual: "/static/visual/health-plan-service-hero.png",
    stats: [
      { value: String(execDays), label: "执行天数" },
      { value: `${percent}%`, label: "今日完成" },
      { value: String(total), label: "今日任务" },
    ],
    tasks: tasks.map((t) => {
      const meta = KIND_ICON[t.kind] || { icon: "check", iconColor: "#176B52" };
      const doneFlag = t.status === "done";
      return {
        id: String(t.id),
        icon: meta.icon,
        iconColor: meta.iconColor,
        title: t.title,
        desc: doneFlag ? "已记录" : t.kind === "metric" ? "建议按时测量" : "待完成",
        action: doneFlag ? "已完成" : t.kind === "metric" ? "去记录" : "去完成",
        done: doneFlag || undefined,
        amber: meta.amber || undefined,
        toast: doneFlag ? undefined : "",
      };
    }),
  };
}

function memberLabel(row) {
  if (!row) return "";
  const name = row.name || "家属";
  const relation = row.relation ? ` · ${row.relation}` : "";
  return `${name}${relation}`;
}

function toFamilyMemberCard(row, kind) {
  if (!row) return null;
  const name = String(row.name || "").trim() || "家属";
  const initial = name.slice(0, 1);
  if (kind === "managed") {
    return {
      id: Number(row.id) || 0,
      name: memberLabel(row),
      initial,
      desc: "可代管档案与健康计划",
      permissions: ["可代上传档案", "可代记录指标", "可代咨询"],
      role: String(row.role || "managed"),
    };
  }
  return {
    id: Number(row.id) || 0,
    name: memberLabel(row),
    initial,
    desc: "授权有效 · 可协助记录",
    permissions: ["查看健康计划", "代记录指标", "代咨询前确认"],
    role: String(row.role || "helper"),
  };
}

function buildFamilyData(ctx) {
  ctx = ctx || {};
  const family = (
    ctx.family ||
    (ctx.repo && ctx.personId != null ? ctx.repo.listFamily(ctx.personId) : []) ||
    []
  ).filter(Boolean);

  const managedRows = family.filter((f) =>
    /managed|care|被照护/i.test(String(f.role || ""))
  );
  const helperRows = family.filter((f) => !managedRows.includes(f));

  return {
    // 无成员时返回 null / []，不再塞「暂未添加…」演示文案
    managed: managedRows.length ? toFamilyMemberCard(managedRows[0], "managed") : null,
    helpers: helperRows.map((row) => toFamilyMemberCard(row, "helper")).filter(Boolean),
    count: family.length,
  };
}

module.exports = {
  buildHomeFeed,
  buildMineAssets,
  buildRecordList,
  buildPlanDetail,
  buildFamilyData,
};
