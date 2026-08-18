<script setup lang="ts">
import AppIconButton from "./AppIconButton.vue";
import AppStatusBadge from "./AppStatusBadge.vue";

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    actionIcon?: string;
    actionLabel?: string;
    actionTone?: "primary" | "soft" | "amber" | "ghost" | "danger";
    statusLabel?: string;
    statusIcon?: string;
    statusTone?: "green" | "amber" | "blue" | "danger" | "dark";
    statusCompact?: boolean;
  }>(),
  {
    subtitle: "",
    actionIcon: "",
    actionLabel: "",
    actionTone: "soft",
    statusLabel: "",
    statusIcon: "",
    statusTone: "green",
    statusCompact: false,
  }
);

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <view class="app-page-header cu-bar bg-white">
    <view class="app-page-header__copy action">
      <text class="app-page-header__title">{{ title }}</text>
      <text v-if="subtitle" class="app-page-header__subtitle">{{ subtitle }}</text>
    </view>
    <AppIconButton
      v-if="actionIcon"
      :icon="actionIcon"
      :ariaLabel="actionLabel || title"
      :variant="actionTone"
      @tap="emit('action')"
    />
    <AppStatusBadge
      v-else-if="statusLabel"
      :label="statusLabel"
      :icon="statusIcon"
      :tone="statusTone"
      :compact="statusCompact"
    />
  </view>
</template>

<style scoped>
.app-page-header {
  display: flex;
  margin-bottom: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.app-page-header__copy {
  min-width: 0;
  flex: 1;
}

.app-page-header__title,
.app-page-header__subtitle {
  display: block;
}

.app-page-header__title {
  color: #17201c;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
  line-height: 1.25;
}

.app-page-header__subtitle {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  line-height: 1.45;
}
</style>
