<script setup lang="ts">
import { useAppStore } from "../../stores/app";
import AppIcon from "../../components/AppIcon.vue";

const store = useAppStore();

function goConsult() {
  uni.switchTab({ url: "/pages/consult/index" });
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom success-page" :class="{ elder: store.elderMode }">
    <view class="success-card">
      <AppIcon name="status-success" :size="43" tone="primary" />
      <text class="success-card__title">建档成功</text>
      <text class="success-card__desc">资料已保存（Demo）。可用左上角返回上一页，或前往在线咨询。</text>
      <view class="success-card__cta pressable" @click="goConsult">去咨询</view>
    </view>
  </view>
</template>

<style scoped>
.success-page { padding: 48px 16px 0; }
.success-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #fff);
  box-shadow: var(--shadow-card);
  text-align: center;
}
.success-card__title {
  display: block;
  margin-top: 12px;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-heading, 24px);
  font-weight: 600;
}
.success-card__desc {
  display: block;
  margin-top: 8px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
.success-card__cta {
  display: flex;
  min-height: 40px;
  width: 100%;
  margin-top: 20px;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-md, 8px);
  background: var(--primary, #5d87ff);
  color: #fff;
  font-size: var(--font-body, 18px);
  font-weight: 600;
}
.success-card__link {
  display: flex;
  min-height: 40px;
  margin-top: 4px;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  font-weight: 500;
}
.elder .success-card__title { font-size: var(--font-heading, 24px); }
.elder .success-card__desc,
.elder .success-card__cta,
.elder .success-card__link { font-size: var(--font-subheading, 19px); }
</style>
