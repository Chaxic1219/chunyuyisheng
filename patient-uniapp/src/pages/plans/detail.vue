<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import { completeTask } from "../../api/v32";
import { useConsultationStore } from "../../stores/consultation";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { useHomeStore } from "../../stores/home";
import { useAppStore } from "../../stores/app";
import { mpVisual } from "../../utils/mediaSrc";
import type { PlanDetailData } from "../../types/v32";

const healthAssets = useHealthAssetsStore();
const homeStore = useHomeStore();
const consultation = useConsultationStore();
const appStore = useAppStore();
const data = computed(() => healthAssets.plan);
const actingId = ref("");

const ICON_MED = mpVisual("service-ui/medication.png");
const ICON_CHECK = mpVisual("service-ui/checklist.png");
const ICON_WALK = mpVisual("service-ui/follow-up.png");
const ICON_TARGET = mpVisual("service-ui/plan.png");
const ICON_PILL = mpVisual("service-ui/pill.png");
const ICON_CHAT = mpVisual("service-ui/chat.png");

onMounted(async () => {
  await healthAssets.loadPlan();
});

function toast(title: string) {
  uni.showToast({ title, icon: "none" });
}

function consultPlan() {
  const planName = String(data.value?.title || "当前健康计划").trim();
  consultation.applyEntryContext(`来自健康计划：${planName}，优先围绕计划任务、用药和指标继续咨询。`, "health");
  uni.switchTab({ url: "/pages/consult/index" });
}

function parsePercent(value: string): number | null {
  const m = String(value || "").match(/(\d+)\s*%/);
  if (!m) return null;
  return Math.max(0, Math.min(100, Number(m[1])));
}

const progressPercent = computed(() => {
  const stats = data.value?.stats || [];
  for (const row of stats) {
    if (/进度|完成/.test(row.label)) {
      const p = parsePercent(row.value);
      if (p != null) return p;
    }
  }
  for (const row of stats) {
    const p = parsePercent(row.value);
    if (p != null) return p;
  }
  const tasks = data.value?.tasks || [];
  if (!tasks.length) return 0;
  const done = tasks.filter((t) => t.done).length;
  return Math.round((done / tasks.length) * 100);
});

const statusLine = computed(() => {
  const desc = String(data.value?.desc || "").trim();
  if (desc) return desc.replace(/\s+/g, " · ");
  return "执行中";
});

const weekFocus = computed(() => {
  const tasks = data.value?.tasks || [];
  const pending = tasks.find((t) => !t.done);
  if (pending?.title) return `重点完成：${pending.title}`;
  return "坚持完成本周计划任务";
});

function ringStyle(percent: number) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return {
    background: `conic-gradient(#176b52 ${p}%, #e5f3ec 0)`,
  };
}

function taskIconSrc(task: PlanDetailData["tasks"][number], index: number) {
  const name = String(task.icon || "").toLowerCase();
  if (name.includes("med") || name.includes("pill") || name.includes("check")) return ICON_MED;
  if (name.includes("metric") || name.includes("record") || name.includes("log")) return ICON_CHECK;
  if (name.includes("follow") || name.includes("walk") || name.includes("calendar")) return ICON_WALK;
  const fallback = [ICON_MED, ICON_CHECK, ICON_WALK];
  return fallback[index % fallback.length];
}

async function onCompleteTask(task: PlanDetailData["tasks"][number]) {
  if (task.done || actingId.value) return;
  const taskId = Number(task.id);
  if (!Number.isFinite(taskId)) {
    toast(task.toast || "当前任务暂不可完成");
    return;
  }
  actingId.value = task.id;
  try {
    await completeTask(taskId);
    await Promise.all([healthAssets.loadPlan(true), homeStore.load(true)]);
    toast("任务已完成");
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "完成任务失败";
    toast(message);
  } finally {
    actingId.value = "";
  }
}

function openMedication() {
  toast("用药管理即将开放");
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="!data" class="state-card">正在加载健康计划…</view>

    <template v-else>
      <view class="plan-card">
        <view class="plan-card__main">
          <text class="plan-card__title">{{ data.title }}</text>
          <text class="plan-card__status">{{ statusLine }}</text>
          <view class="plan-card__bar-track">
            <view class="plan-card__bar-fill" :style="{ width: `${progressPercent}%` }" />
          </view>
          <text class="plan-card__bar-label">总体进度 {{ progressPercent }}%</text>
        </view>
        <view class="progress-ring" :style="ringStyle(progressPercent)">
          <view class="progress-ring__inner">
            <text class="progress-ring__value">{{ progressPercent }}%</text>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section__title">今日任务</text>
        <view class="task-list">
          <view
            v-for="(task, index) in data.tasks"
            :key="task.id"
            class="task-row"
            :class="{ 'task-row--done': task.done }"
          >
            <view class="task-row__icon">
              <image class="task-row__icon-img" :src="taskIconSrc(task, index)" mode="aspectFit" />
            </view>
            <view class="task-row__copy">
              <text class="task-row__title">{{ task.title }}</text>
              <text class="task-row__desc">{{ task.desc }}</text>
            </view>
            <view class="task-row__aside">
              <view v-if="task.done" class="task-tag task-tag--done">
                <text>✓ 已完成</text>
              </view>
              <template v-else>
                <view class="task-tag">待完成</view>
                <view
                  v-if="task.action"
                  class="task-btn pressable"
                  :class="{ 'task-btn--busy': actingId === task.id }"
                  aria-role="button"
                  @click="onCompleteTask(task)"
                >
                  <text>{{ actingId === task.id ? "提交中" : task.action }}</text>
                </view>
              </template>
            </view>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section__title">本周重点</text>
        <view class="focus-card">
          <view class="focus-card__icon">
            <image class="focus-card__icon-img" :src="ICON_TARGET" mode="aspectFit" />
          </view>
          <text class="focus-card__text">{{ weekFocus }}</text>
        </view>
      </view>

      <view class="link-list">
        <view class="link-row pressable" aria-role="button" @click="openMedication">
          <image class="link-row__icon" :src="ICON_PILL" mode="aspectFit" />
          <text class="link-row__title">用药管理</text>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>
        <view class="link-row pressable" aria-role="button" @click="consultPlan">
          <image class="link-row__icon" :src="ICON_CHAT" mode="aspectFit" />
          <text class="link-row__title">咨询当前计划</text>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 14px 16px calc(24px + env(safe-area-inset-bottom));
  background: #f5f7f6;
}
.state-card {
  padding: 24px 14px;
  border-radius: 16px;
  background: #fff;
  color: #6a756f;
  text-align: center;
}
.plan-card {
  display: flex;
  margin-bottom: 18px;
  padding: 18px 16px;
  align-items: center;
  gap: 12px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 61, 46, 0.05);
}
.plan-card__main {
  min-width: 0;
  flex: 1;
}
.plan-card__title {
  display: block;
  color: #0f3d2e;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.35;
}
.plan-card__status {
  display: block;
  margin-top: 6px;
  color: #44524b;
  font-size: 13px;
}
.plan-card__bar-track {
  margin-top: 14px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e8eee9;
}
.plan-card__bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #176b52;
}
.plan-card__bar-label {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: 12px;
}
.progress-ring {
  display: flex;
  width: 92px;
  height: 92px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.progress-ring__inner {
  display: flex;
  width: 70px;
  height: 70px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #fff;
}
.progress-ring__value {
  color: #176b52;
  font-size: 22px;
  font-weight: 800;
}

.section {
  margin-bottom: 16px;
}
.section__title {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: 17px;
  font-weight: 800;
}
.task-list {
  padding: 4px 14px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.task-row {
  display: flex;
  min-height: 72px;
  padding: 14px 0;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #eef2ef;
}
.task-row:last-child {
  border-bottom: 0;
}
.task-row__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f5ee;
}
.task-row__icon-img {
  width: 22px;
  height: 22px;
}
.task-row__copy {
  min-width: 0;
  flex: 1;
}
.task-row__title {
  display: block;
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
}
.task-row__desc {
  display: block;
  margin-top: 3px;
  color: #8a938d;
  font-size: 12px;
  line-height: 1.4;
}
.task-row__aside {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.task-tag {
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef2ef;
  color: #6a756f;
  font-size: 12px;
  font-weight: 600;
}
.task-tag--done {
  background: #e8f5ee;
  color: #176b52;
}
.task-btn {
  padding: 6px 12px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.task-btn--busy {
  opacity: 0.6;
}

.focus-card {
  display: flex;
  padding: 14px;
  align-items: center;
  gap: 10px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.focus-card__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f5ee;
}
.focus-card__icon-img {
  width: 22px;
  height: 22px;
}
.focus-card__text {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.link-list {
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.link-row {
  display: flex;
  min-height: 54px;
  padding: 0 14px;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #eef2ef;
}
.link-row:last-child {
  border-bottom: 0;
}
.link-row__icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}
.link-row__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 15px;
  font-weight: 600;
}

.elder .plan-card__title,
.elder .section__title,
.elder .task-row__title,
.elder .link-row__title {
  font-size: 18px;
}
</style>
