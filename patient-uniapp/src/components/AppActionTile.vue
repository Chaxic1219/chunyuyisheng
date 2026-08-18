<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import { resolveIconSrc } from "../utils/mediaSrc";

const props = withDefaults(
  defineProps<{
    icon: string;
    title: string;
    desc?: string;
    tone?: "green" | "amber" | "blue" | "danger";
    compact?: boolean;
  }>(),
  {
    desc: "",
    tone: "green",
    compact: false,
  }
);

const emit = defineEmits<{
  (event: "tap"): void;
}>();

const store = useAppStore();

const iconColor = computed(() => {
  if (props.tone === "amber") return "#936015";
  if (props.tone === "blue") return "#456FD8";
  if (props.tone === "danger") return "#A33C33";
  return "#176B52";
});

const iconSrc = computed(() => resolveIconSrc(props.icon, iconColor.value));
const useQuickLayout = computed(() => props.compact);
const rootClass = computed(() => [
  "app-action-tile",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
  `app-action-tile--${props.tone}`,
  {
    "app-action-tile--compact": props.compact,
    "app-action-tile--quick": useQuickLayout.value,
  },
]);
</script>

<template>
  <view :class="rootClass" aria-role="button" :aria-label="title" @click="emit('tap')">
    <template v-if="compact">
      <view class="app-action-tile__box">
        <image class="app-action-tile__icon-img" :src="iconSrc" mode="aspectFit" />
      </view>
      <text class="app-action-tile__title">{{ title }}</text>
    </template>
    <template v-else>
      <view class="app-action-tile__icon">
        <image class="app-action-tile__icon-img" :src="iconSrc" mode="aspectFit" />
      </view>
      <text class="app-action-tile__title">{{ title }}</text>
      <text v-if="desc" class="app-action-tile__desc">{{ desc }}</text>
    </template>
  </view>
</template>

<style scoped>
.app-action-tile {
  display: flex;
  box-sizing: border-box;
  min-width: 0;
  min-height: 112px;
  padding: 12px;
  flex-direction: column;
  justify-content: center;
  border: 1px solid #e6ebe7;
  border-radius: 14px;
  background: #ffffff;
}
.app-action-tile--compact {
  min-height: 0;
  padding: 0;
  align-items: center;
  justify-content: flex-start;
  text-align: center;
  border: none;
  border-radius: 0;
  background: transparent;
}
.app-action-tile__box {
  position: relative;
  display: block;
  width: 100%;
  height: 56px;
  border: 1px solid #e4ebe6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(16, 52, 40, 0.04);
  overflow: hidden;
}
.app-action-tile--quick .app-action-tile__box {
  height: 76px;
  border-radius: 14px;
  border-color: #e6ebe7;
  box-shadow: none;
}
.elder .app-action-tile--quick .app-action-tile__box {
  height: 88px;
}
.app-action-tile__icon {
  position: relative;
  display: block;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: #e5f3ec;
  overflow: hidden;
}
.app-action-tile__icon-img {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  width: 32px;
  height: 32px;
  transform: translate(-50%, -50%);
}
.app-action-tile--compact .app-action-tile__icon-img {
  width: 32px;
  height: 32px;
}
.app-action-tile--quick .app-action-tile__icon-img {
  width: 56px;
  height: 56px;
}
.elder .app-action-tile--quick .app-action-tile__icon-img {
  width: 64px;
  height: 64px;
}
.app-action-tile--amber .app-action-tile__icon {
  background: #fff1d6;
}
.app-action-tile--blue .app-action-tile__icon {
  background: #e8eefc;
}
.app-action-tile--danger .app-action-tile__icon {
  background: #fde9e6;
}
.app-action-tile__title,
.app-action-tile__desc {
  display: block;
}
.app-action-tile__title {
  margin-top: 9px;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
}
.app-action-tile--compact .app-action-tile__title {
  margin-top: 8px;
  color: #3a433e;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
  line-height: 1.3;
}
.app-action-tile--quick .app-action-tile__title {
  margin-top: 10px;
  color: #2a3547;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
  line-height: 1.25;
}
.elder .app-action-tile--quick .app-action-tile__title {
  font-size: var(--font-body, 18px);
}
.app-action-tile__desc {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
</style>
