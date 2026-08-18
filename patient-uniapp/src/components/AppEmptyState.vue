<script setup lang="ts">
import AppButton from "./AppButton.vue";

withDefaults(
  defineProps<{
    visual: string;
    title: string;
    text: string;
    actionLabel?: string;
    actionIcon?: string;
  }>(),
  {
    actionLabel: "",
    actionIcon: "action-refresh",
  }
);

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <view class="app-empty cu-card radius shadow">
    <image v-if="visual" class="app-empty__image" :src="visual" mode="aspectFit" />
    <text class="app-empty__title">{{ title }}</text>
    <text class="app-empty__text">{{ text }}</text>
    <AppButton
      v-if="actionLabel"
      class="app-empty__action"
      :label="actionLabel"
      :icon="actionIcon"
      variant="primary"
      @tap="emit('action')"
    />
  </view>
</template>

<style scoped>
.app-empty {
  display: flex;
  box-sizing: border-box;
  padding: 16px;
  flex-direction: column;
  align-items: center;
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #fff);
  box-shadow: var(--shadow-card);
  text-align: center;
}

.app-empty__image {
  width: 100%;
  height: 180px;
}

.app-empty__title,
.app-empty__text {
  display: block;
}

.app-empty__title {
  margin-top: 10px;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-body, 18px);
  font-weight: 600;
}

.app-empty__text {
  margin-top: 6px;
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}

.app-empty__action {
  margin-top: 14px;
}
</style>
