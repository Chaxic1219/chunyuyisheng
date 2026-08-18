<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

withDefaults(
  defineProps<{
    label: string | number;
    tone?: "green" | "amber" | "blue" | "danger" | "dark";
    icon?: string;
    compact?: boolean;
  }>(),
  {
    tone: "green",
    icon: "",
    compact: false,
  }
);
</script>

<template>
  <view
    class="app-status-badge cu-tag round"
    :class="[
      `app-status-badge--${tone}`,
      {
        'app-status-badge--compact badge': compact,
        'bg-green light': tone === 'green',
        'bg-orange light': tone === 'amber',
        'bg-blue light': tone === 'blue',
        'bg-red light': tone === 'danger',
        'bg-black': tone === 'dark',
      },
    ]"
  >
    <AppIcon v-if="icon" :name="icon" :size="compact ? 17 : 19" />
    <text class="app-status-badge__label">{{ label }}</text>
  </view>
</template>

<style scoped>
.app-status-badge {
  display: inline-flex;
  box-sizing: border-box;
  min-height: 26px;
  max-width: 100%;
  padding: 0 8px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 8px;
  background: #e5f3ec;
  color: #176b52;
  font-size: var(--font-caption, 14px);
  font-weight: 900;
}

.app-status-badge--compact {
  min-width: 22px;
  min-height: 22px;
  padding: 0 6px;
  border-radius: 11px;
}

.app-status-badge--amber {
  background: #fff1d6;
  color: #936015;
}

.app-status-badge--blue {
  background: #e7f1f8;
  color: #2c638e;
}

.app-status-badge--danger {
  background: #fbe8e5;
  color: #a33c33;
}

.app-status-badge--dark {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #ddefe7;
}

.app-status-badge__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
