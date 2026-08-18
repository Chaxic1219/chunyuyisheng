<script setup lang="ts">
/**
 * 复诊协助：独立落地页（与咨询 Tab / 服务包目录区分）
 * 提供备诊清单与资料准备，再按需进入咨询或档案。
 */
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { useConsultationStore } from "../../stores/consultation";

const appStore = useAppStore();
const consultation = useConsultationStore();

const checklist = [
  { title: "近期检查报告", desc: "血常规、影像或出院小结照片，便于说明病情变化。" },
  { title: "当前用药清单", desc: "药名、剂量与最近一次调整时间。" },
  { title: "症状与疑问", desc: "疼痛、肿胀、活动受限等变化，以及最想先问清的 1–2 个问题。" },
  { title: "期望复诊时间", desc: "方便到院的大概时段，方便安排加号或改期。" },
];

function goConsult() {
  consultation.applyEntryContext(
    "来自复诊协助：已准备报告/用药/症状，请协助安排复诊或解答备诊问题。",
    "life"
  );
  uni.switchTab({ url: "/pages/consult/index" });
}

function goRecords() {
  uni.navigateTo({ url: "/pages/records/index" });
}

function goCatalog() {
  uni.navigateTo({ url: "/pages/services/catalog" });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="hero">
      <text class="hero__kicker">诊后复诊</text>
      <text class="hero__title">复诊协助</text>
      <text class="hero__desc">
        按清单备齐资料，再发起咨询，医助可更快帮你整理复诊诉求与预约线索。
      </text>
    </view>

    <view class="section">
      <text class="section__title">备诊清单</text>
      <view v-for="(item, i) in checklist" :key="item.title" class="row">
        <view class="row__idx">{{ i + 1 }}</view>
        <view class="row__copy">
          <text class="row__title">{{ item.title }}</text>
          <text class="row__desc">{{ item.desc }}</text>
        </view>
      </view>
    </view>

    <view class="section tip">
      <AppIcon name="status-warning" :size="18" tone="primary" />
      <text class="tip__text">紧急不适、出血或高热请优先线下急诊，本页不替代面诊判断。</text>
    </view>

    <view class="actions">
      <AppButton class="actions__btn" label="去咨询复诊" icon="consult-doctor" variant="primary" @tap="goConsult" />
      <AppButton class="actions__btn" label="上传资料" icon="health-record" variant="soft" @tap="goRecords" />
    </view>
    <view class="link pressable" @click="goCatalog">
      <text>需要术后服务包？查看医生管家服务</text>
      <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  padding-bottom: calc(28px + env(safe-area-inset-bottom));
  background:
    radial-gradient(120% 60% at 10% -10%, rgba(46, 125, 90, 0.12), transparent 55%),
    linear-gradient(180deg, #f0f3f5 0%, #f0f3f5 42%, #f0f3f5 100%);
}
.hero {
  margin-bottom: 14px;
  padding: 18px 16px;
  border-radius: 18px;
  background: linear-gradient(145deg, #0f4031 0%, #176b52 100%);
  box-shadow: 0 12px 28px rgba(15, 64, 49, 0.2);
}
.hero__kicker,
.hero__title,
.hero__desc {
  display: block;
}
.hero__kicker {
  color: #b7d8c8;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.hero__title {
  margin-top: 6px;
  color: #ffffff;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
  line-height: 1.3;
}
.hero__desc {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.86);
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}
.section {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid #dce3dd;
  border-radius: 16px;
  background: #ffffff;
}
.section__title {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.row {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid #eef2ef;
}
.row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.row__idx {
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #e8f4ee;
  color: #176b52;
  font-size: 13px;
  font-weight: 800;
}
.row__copy {
  min-width: 0;
  flex: 1;
}
.row__title {
  display: block;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.row__desc {
  display: block;
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
.tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-color: #e8d9b8;
  background: #fffbf3;
}
.tip__text {
  flex: 1;
  color: #8a5a12;
  font-size: var(--font-caption, 14px);
  line-height: 1.5;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 10px;
}
.actions__btn {
  flex: 1;
  min-width: 0;
}
.link {
  display: flex;
  margin-top: 14px;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: #44514a;
  font-size: var(--font-caption, 14px);
}
</style>
