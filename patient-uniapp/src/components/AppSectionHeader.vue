<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import AppIcon from "./AppIcon.vue";

withDefaults(
  defineProps<{
    title: string;
    action?: string;
    actionIcon?: string;
  }>(),
  {
    action: "",
    actionIcon: "nav-chevron-right",
  }
);

const emit = defineEmits<{ action: [] }>();
const store = useAppStore();
const actionClass = computed(() => [
  "app-section-header__action",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
]);
</script>

<template>
  <view class="app-section-header">
    <text class="app-section-header__title">{{ title }}</text>
    <view
      v-if="action"
      :class="actionClass"
      aria-role="button"
      :aria-label="action"
      @click="emit('action')"
    >
      <text class="app-section-header__action-text">{{ action }}</text>
      <AppIcon :name="actionIcon" :size="16" tone="muted" />
    </view>
  </view>
</template>

<style scoped>
.app-section-header {
  display: flex;
  margin-bottom: 10px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 0;
  padding: 0;
  background: transparent;
}

.app-section-header__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 900;
  line-height: 1.35;
}

.app-section-header__action {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  color: #176b52;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}

.app-section-header__action-text {
  color: inherit;
}
</style>
