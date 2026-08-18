<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

export interface CoreItem {
  key: string;
  title: string;
  sub: string;
  tone?: "primary" | "add" | "bed";
}

defineProps<{ items: CoreItem[] }>();
const emit = defineEmits<{ (e: "open", key: string): void }>();

function iconName(item: CoreItem) {
  if (item.key === "consult") return "consult-doctor";
  if (item.key === "add") return "action-add";
  if (item.key === "adm") return "inpatient-service";
  if (item.key === "archive") return "health-record";
  return "action-unknown";
}
</script>

<template>
  <view class="core-grid">
    <view
      v-for="it in items"
      :key="it.key"
      class="core-card pressable"
      hover-class="core-card--pressed"
      aria-role="button"
      :aria-label="`${it.title}，${it.sub}`"
      @click="emit('open', it.key)"
    >
      <view class="core-card__topline">
        <view class="core-card__icon">
          <AppIcon :name="iconName(it)" :size="24" tone="primary" />
        </view>
        <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
      </view>
      <text class="core-card__title">{{ it.title }}</text>
      <text class="core-card__desc">{{ it.sub }}</text>
    </view>
  </view>
</template>

<style scoped>
.core-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.core-card {
  display: flex;
  flex: 0 0 calc(50% - 5px);
  min-width: 0;
  min-height: 112px;
  padding: 12px;
  flex-direction: column;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #ffffff);
  box-shadow: var(--shadow-card);
}
.core-card--pressed {
  background: var(--surface-muted, #f5f7fa);
}
.core-card__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.core-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm, 6px);
  background: var(--primary-soft, #ecf2ff);
}
.core-card__title {
  display: block;
  margin-top: 10px;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-secondary, 16px);
  font-weight: 600;
  line-height: 1.35;
}
.core-card__desc {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
</style>
