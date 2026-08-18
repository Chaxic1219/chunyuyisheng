<script setup lang="ts">
import { computed } from "vue";
import AppButton from "./AppButton.vue";
import { safeLocalImageSrc } from "../utils/mediaSrc";

const props = withDefaults(
  defineProps<{
    title: string;
    label?: string;
    desc?: string;
    visual?: string;
    actionLabel?: string;
    actionIcon?: string;
    /** 默认不展示右侧插画，避免白块遮挡与可读性变差 */
    showVisual?: boolean;
  }>(),
  {
    label: "",
    desc: "",
    visual: "",
    actionLabel: "",
    actionIcon: "action-confirm",
    showVisual: false,
  }
);

const emit = defineEmits<{
  (event: "action"): void;
}>();

const visualSrc = computed(() => (props.showVisual ? safeLocalImageSrc(props.visual) : ""));
</script>

<template>
  <view class="app-hero-panel">
    <view class="app-hero-panel__copy" :class="{ 'app-hero-panel__copy--full': !visualSrc }">
      <text v-if="label" class="app-hero-panel__label">{{ label }}</text>
      <text class="app-hero-panel__title">{{ title }}</text>
      <text v-if="desc" class="app-hero-panel__desc">{{ desc }}</text>
      <AppButton
        v-if="actionLabel"
        class="app-hero-panel__button"
        :label="actionLabel"
        :icon="actionIcon"
        variant="ghost"
        @tap="emit('action')"
      />
    </view>
    <image v-if="visualSrc" class="app-hero-panel__visual" :src="visualSrc" mode="aspectFill" />
    <slot />
  </view>
</template>

<style scoped>
.app-hero-panel {
  position: relative;
  overflow: hidden;
  margin-bottom: 18px;
  padding: 16px;
  border-radius: 18px;
  background: #0f4031;
  box-shadow: 0 12px 28px rgba(15, 64, 49, 0.2);
}
.app-hero-panel__copy {
  position: relative;
  z-index: 2;
  width: 100%;
}
.app-hero-panel__copy:not(.app-hero-panel__copy--full) {
  width: 72%;
}
.app-hero-panel__label,
.app-hero-panel__title,
.app-hero-panel__desc {
  display: block;
}
.app-hero-panel__label {
  color: #c5e0d3;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.app-hero-panel__title {
  margin-top: 8px;
  color: #fff;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
  line-height: 1.3;
}
.app-hero-panel__desc {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.86);
  font-size: var(--font-secondary, 16px);
  line-height: 1.55;
}
.app-hero-panel__button {
  margin-top: 14px;
}
.app-hero-panel__button :deep(.app-button--ghost) {
  border-color: transparent !important;
  background: #f7fcf9;
  color: #0c4535;
}
.app-hero-panel__visual {
  position: absolute;
  right: -12px;
  top: 16px;
  width: 96px;
  height: 96px;
  border-radius: 12px;
  opacity: 0.75;
}
</style>
