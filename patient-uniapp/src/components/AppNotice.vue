<script setup lang="ts">
import { computed } from "vue";
import type { IconTone } from "../constants/iconRegistry";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
  defineProps<{
    icon?: string;
    title?: string;
    text: string;
    tone?: "green" | "amber" | "blue" | "danger";
  }>(),
  {
    icon: "service-package",
    title: "",
    tone: "green",
  }
);

const iconTone = computed<IconTone>(() => (props.tone === "danger" ? "danger" : "primary"));
</script>

<template>
  <view
    class="app-notice radius shadow"
    :class="[
      `app-notice--${tone}`,
      {
        'bg-green light': tone === 'green',
        'bg-orange light': tone === 'amber',
        'bg-blue light': tone === 'blue',
        'bg-red light': tone === 'danger',
      },
    ]"
  >
    <AppIcon :name="icon" :size="24" :tone="iconTone" />
    <view class="app-notice__copy">
      <text v-if="title" class="app-notice__title">{{ title }}</text>
      <text class="app-notice__text">{{ text }}</text>
    </view>
  </view>
</template>

<style scoped>
.app-notice {
  display: flex;
  box-sizing: border-box;
  margin-bottom: 12px;
  padding: 12px;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid #cfe8dd;
  border-radius: 10px;
  background: #f7fcf9;
}

.app-notice--amber {
  border-color: #f5dbab;
  background: #fff8eb;
}

.app-notice--blue {
  border-color: #c7dceb;
  background: #edf6fb;
}

.app-notice--danger {
  border-color: #f4c8b8;
  background: #fff5ed;
}

.app-notice__copy {
  min-width: 0;
  flex: 1;
}

.app-notice__title,
.app-notice__text {
  display: block;
}

.app-notice__title {
  margin-bottom: 2px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 900;
}

.app-notice__text {
  color: #44524b;
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
</style>
