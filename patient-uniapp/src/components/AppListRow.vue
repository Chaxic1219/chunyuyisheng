<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import { resolveIconSrc } from "../utils/mediaSrc";

const props = withDefaults(
  defineProps<{
    icon: string;
    title: string;
    desc?: string;
    meta?: string;
    metaTone?: "muted" | "amber" | "danger";
    iconColor?: string;
    iconTone?: "green" | "amber" | "blue" | "danger" | "plain";
    danger?: boolean;
    statusLabel?: string;
    statusTone?: "green" | "amber" | "blue" | "danger" | "dark";
    chevron?: boolean;
    layout?: "menu" | "stack";
  }>(),
  {
    desc: "",
    meta: "",
    metaTone: "muted",
    iconColor: "#176B52",
    iconTone: "green",
    danger: false,
    statusLabel: "",
    statusTone: "green",
    chevron: true,
    layout: "menu",
  }
);

const emit = defineEmits<{ tap: [] }>();
const store = useAppStore();
const iconSrc = computed(() => resolveIconSrc(props.icon, props.iconColor));
const chevronSrc = computed(() => resolveIconSrc("chevron", "#B0B8B3"));
const isStack = computed(() => props.layout === "stack");
const rootClass = computed(() => [
  "app-list-row",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
  { "app-list-row--danger": props.danger, "app-list-row--stack": isStack.value },
]);
</script>

<template>
  <view :class="rootClass" aria-role="button" :aria-label="title" @tap.stop="emit('tap')">
    <view class="app-list-row__icon" :class="`app-list-row__icon--${iconTone}`">
      <image class="app-list-row__icon-img" :src="iconSrc" mode="aspectFit" />
    </view>

    <view v-if="isStack" class="app-list-row__copy">
      <text class="app-list-row__title">{{ title }}</text>
      <text v-if="desc" class="app-list-row__desc">{{ desc }}</text>
    </view>
    <text v-else class="app-list-row__title">{{ title }}</text>

    <view class="app-list-row__trailing">
      <text
        v-if="!isStack && (meta || statusLabel)"
        class="app-list-row__meta"
        :class="`app-list-row__meta--${metaTone}`"
      >{{ meta || statusLabel }}</text>
      <text
        v-else-if="isStack && statusLabel"
        class="app-list-row__meta"
        :class="`app-list-row__meta--${metaTone}`"
      >{{ statusLabel }}</text>
      <image v-if="chevron" class="app-list-row__chevron" :src="chevronSrc" mode="aspectFit" />
    </view>
  </view>
</template>

<style scoped>
.app-list-row {
  display: flex;
  min-height: 54px;
  padding: 14px 0;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #edf1ee;
  background: transparent;
}

.app-list-row:last-child {
  border-bottom: 0;
}

.app-list-row__icon {
  position: relative;
  display: block;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: transparent;
  overflow: hidden;
}

.app-list-row--stack .app-list-row__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #e5f3ec;
}

.app-list-row--stack .app-list-row__icon--amber {
  background: #fff1d6;
}

.app-list-row--stack .app-list-row__icon--blue {
  background: #e7f1f8;
}

.app-list-row--stack .app-list-row__icon--danger {
  background: #fbe8e5;
}

.app-list-row__icon-img {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  width: 28px;
  height: 28px;
  transform: translate(-50%, -50%);
}

.app-list-row__chevron {
  display: block;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin: 0;
  opacity: 0.55;
}

.app-list-row__copy {
  min-width: 0;
  flex: 1;
}

.app-list-row__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: 1.35;
}

.app-list-row--stack .app-list-row__title {
  display: block;
  flex: none;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}

.app-list-row__desc {
  display: block;
  margin-top: 3px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}

.app-list-row__trailing {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.app-list-row__meta {
  max-width: 120px;
  overflow: hidden;
  color: #8a938d;
  font-size: var(--font-secondary, 16px);
  font-weight: 600;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-list-row__meta--amber {
  color: #b7791f;
}

.app-list-row__meta--danger {
  color: #a33c33;
}

.app-list-row--danger .app-list-row__title {
  color: #a33c33;
}
</style>
