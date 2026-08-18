<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(defineProps<{ fallbackTab?: string; label?: string }>(), {
  fallbackTab: "/pages/mine/index",
  label: "返回",
});

const store = useAppStore();
const pressableClass = computed(() => [
  "app-back-nav__btn",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
]);

function onBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: props.fallbackTab });
    },
  });
}
</script>

<template>
  <view class="app-back-nav">
    <view :class="pressableClass" aria-role="button" :aria-label="label" @click="onBack">
      <AppIcon name="nav-back" :size="20" tone="primary" />
      <text class="app-back-nav__label">{{ label }}</text>
    </view>
  </view>
</template>

<style scoped>
.app-back-nav {
  margin-bottom: 10px;
}
.app-back-nav__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid #dce3dd;
  border-radius: 999px;
  background: #ffffff;
  color: #3a433e;
}
.app-back-nav__label {
  font-size: var(--font-secondary, 16px);
  line-height: 1;
}
</style>
