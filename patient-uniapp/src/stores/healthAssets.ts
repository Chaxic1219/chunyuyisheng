import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getMpToken } from "../api/auth";
import {
  addFamilyMember,
  completeTask,
  confirmRecord,
  generatePlan,
  activatePlan,
  getFamilyData,
  getMineAssets,
  getPlanDetail,
  getRecordList,
  removeFamilyMember,
} from "../api/v32";
import type { FamilyData, MineAssets, MineEntry, PlanDetailData, RecordListData } from "../types/v32";
import { MINE_DEFAULTS, MINE_SETTING_ENTRIES } from "../constants/mineDefaults";

function withLocalIcons(entries: MineEntry[] | undefined, fallback: MineEntry[]): MineEntry[] {
  const source = entries?.length ? entries : fallback;
  const iconByKey = new Map(fallback.map((row) => [row.key, row.icon]));
  return source.map((row) => ({
    ...row,
    icon: iconByKey.get(row.key) || row.icon,
  }));
}

export const useHealthAssetsStore = defineStore("health-assets-v32", () => {
  const mineAssets = ref<MineAssets | null>(null);
  const records = ref<RecordListData | null>(null);
  const plan = ref<PlanDetailData | null>(null);
  const family = ref<FamilyData | null>(null);
  const loading = ref(false);
  const error = ref("");
  const refreshedAt = ref("");

  const healthEntries = computed(() =>
    withLocalIcons(mineAssets.value?.healthEntries, MINE_DEFAULTS.healthEntries)
  );
  const serviceEntries = computed(() => {
    // 以规范化后的 mineAssets 为准；未登录时用本地默认（一键一页）
    return withLocalIcons(mineAssets.value?.serviceEntries, MINE_DEFAULTS.serviceEntries);
  });
  /** 我的页设置入口以本地白名单为准，避免线上旧接口带回多余项 */
  const settingEntries = computed(() => MINE_SETTING_ENTRIES);

  async function withLoading(task: () => Promise<void>) {
    loading.value = true;
    error.value = "";
    try {
      await task();
      refreshedAt.value = new Date().toISOString();
    } catch (e) {
      error.value = "健康资产加载失败，请稍后重试";
      console.error(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadMine(force = false) {
    // 懒登录门控（对齐首页 loadHome，2026-08-05 修复 unauthorized 噪音）：
    // 未登录不请求受保护接口，避免后端 401 被 console.error 打印
    if (!getMpToken()) return;
    if (mineAssets.value && !force) return;
    await withLoading(async () => {
      mineAssets.value = await getMineAssets();
    });
  }

  async function loadRecords(force = false) {
    if (!getMpToken()) return;
    if (records.value && !force) return;
    await withLoading(async () => {
      records.value = await getRecordList();
    });
  }

  async function loadPlan(force = false) {
    if (!getMpToken()) return;
    if (plan.value && !force) return;
    await withLoading(async () => {
      plan.value = await getPlanDetail();
    });
  }

  async function loadFamily(force = false) {
    if (!getMpToken()) return;
    if (family.value && !force) return;
    await withLoading(async () => {
      family.value = await getFamilyData();
    });
  }

  async function confirmPendingRecord(sourceKey: string, payload?: Record<string, unknown>) {
    const pending = records.value?.pending;
    const matched = records.value?.records.find((row) => row.id === sourceKey);
    const enriched = {
      title: matched?.title || pending?.title || "",
      category: sourceKey,
      summary: matched?.desc || pending?.desc || "",
      ...payload,
    };
    await confirmRecord(sourceKey, enriched);
    await loadRecords(true);
  }

  async function generateAndActivatePlan() {
    const result = await generatePlan();
    const planId = result?.plan?.id;
    if (planId != null) {
      await activatePlan(Number(planId));
    }
    await loadPlan(true);
    return result;
  }

  async function completePlanTask(taskId: number, payload?: Record<string, unknown>) {
    await completeTask(taskId, payload);
    await loadPlan(true);
  }

  async function inviteFamilyMember(payload: {
    name: string;
    relation?: string;
    phone?: string;
    role?: string;
  }) {
    await addFamilyMember(payload);
    await loadFamily(true);
  }

  async function revokeFamilyMember(memberId: number) {
    const result = (await removeFamilyMember(memberId)) as {
      family?: FamilyData;
    };
    if (result?.family) {
      family.value = result.family;
    } else {
      await loadFamily(true);
    }
  }

  return {
    mineAssets,
    records,
    plan,
    family,
    loading,
    error,
    refreshedAt,
    healthEntries,
    serviceEntries,
    settingEntries,
    loadMine,
    loadRecords,
    loadPlan,
    loadFamily,
    confirmPendingRecord,
    generateAndActivatePlan,
    completePlanTask,
    inviteFamilyMember,
    revokeFamilyMember,
  };
});
