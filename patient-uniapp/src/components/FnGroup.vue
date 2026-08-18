<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

export interface FnItem {
  key: string;
  title: string;
  sub: string;
}

defineProps<{ title: string; items: FnItem[] }>();
const emit = defineEmits<{ (e: "open", key: string): void }>();

const iconMap: Record<string, string> = {
  clinic: "follow-up",
  packages: "service-package",
  tel: "phone-bind",
  prof: "doctor-profile",
  diet: "nutrition",
  surgery: "postop-assessment",
  contact: "record-edit",
  replies: "reply-record",
  faq: "help-center",
  archive: "health-record",
  health: "health-log",
  elder: "elder-mode",
  profile: "record-edit",
  add: "action-add",
  adm: "inpatient-service",
  invite: "invite-patient",
};
</script>

<template>
  <view class="function-group">
    <view class="function-group__heading">{{ title }}</view>
    <view class="function-group__list">
      <view
        v-for="it in items"
        :key="it.key"
        class="function-row pressable"
        hover-class="function-row--pressed"
        aria-role="button"
        :aria-label="`${it.title}，${it.sub}`"
        @click="emit('open', it.key)"
      >
        <view class="function-row__icon">
          <AppIcon :name="iconMap[it.key] || 'action-unknown'" :size="24" tone="primary" />
        </view>
        <view class="function-row__copy">
          <text class="function-row__title">{{ it.title }}</text>
          <text class="function-row__desc">{{ it.sub }}</text>
        </view>
        <view class="function-row__arrow">
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.function-group {
  margin-top: 16px;
}

.function-group__heading {
  margin-bottom: 8px;
  padding: 0 2px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
  font-weight: 500;
  line-height: 1.4;
}

.function-group__list {
  overflow: hidden;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #ffffff);
  box-shadow: var(--shadow-card);
}

.function-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft, #eef2f6);
}

.function-row:last-child {
  border-bottom: 0;
}

.function-row--pressed {
  background: var(--surface-muted, #f5f7fa);
}

.function-row__icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm, 6px);
  background: var(--primary-soft, #ecf2ff);
}

.function-row__copy {
  min-width: 0;
  flex: 1;
}

.function-row__title,
.function-row__desc {
  display: block;
}

.function-row__title {
  color: var(--text-strong, #2a3547);
  font-size: var(--font-secondary, 16px);
  font-weight: 600;
  line-height: 1.35;
}

.function-row__desc {
  margin-top: 2px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}

.function-row__arrow {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}
</style>
