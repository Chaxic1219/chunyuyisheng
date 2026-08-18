<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import { resolveIconSrc } from "../utils/mediaSrc";
import AppButton from "./AppButton.vue";
import AppIcon from "./AppIcon.vue";
import AppStatusBadge from "./AppStatusBadge.vue";

const props = withDefaults(
  defineProps<{
    icon: string;
    title: string;
    desc?: string;
    tone?: "green" | "amber";
    reason?: string;
    badgeLabel?: string;
    actionLabel?: string;
    actionIcon?: string;
    layout?: "tile" | "row";
  }>(),
  {
    desc: "",
    tone: "green",
    reason: "",
    badgeLabel: "",
    actionLabel: "",
    actionIcon: "shield",
    layout: "tile",
  }
);

const emit = defineEmits<{
  (event: "tap"): void;
  (event: "action"): void;
}>();

const store = useAppStore();
const iconColor = computed(() => (props.tone === "amber" ? "#936015" : "#176B52"));
const buttonVariant = computed(() => (props.tone === "amber" ? "amber" : "soft"));
const iconSrc = computed(() => resolveIconSrc(props.icon, iconColor.value));
const rootClass = computed(() => [
  "app-service-product",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
  `app-service-product--${props.tone}`,
  `app-service-product--${props.layout}`,
]);
</script>

<template>
  <view :class="rootClass" aria-role="button" :aria-label="title" @click="emit('tap')">
    <view v-if="layout === 'tile'" class="app-service-product__glow" aria-hidden="true" />

    <template v-if="layout === 'tile'">
      <view v-if="reason" class="app-service-product__top">
        <view class="app-service-product__reason">
          <text class="app-service-product__reason-text">{{ reason }}</text>
        </view>
      </view>
      <view class="app-service-product__body" :class="{ 'app-service-product__body--solo': !reason && !desc }">
        <image class="app-service-product__icon-img" :src="iconSrc" mode="aspectFit" />
        <text class="app-service-product__title">{{ title }}</text>
        <text v-if="desc" class="app-service-product__desc">{{ desc }}</text>
      </view>
    </template>

    <template v-else>
      <view class="app-service-product__icon">
        <image class="app-service-product__icon-img" :src="iconSrc" mode="aspectFit" />
      </view>
      <view class="app-service-product__copy">
        <AppStatusBadge v-if="badgeLabel" :label="badgeLabel" :tone="tone" />
        <text v-if="reason" class="app-service-product__reason-inline">{{ reason }}</text>
        <text class="app-service-product__title">{{ title }}</text>
        <text v-if="desc" class="app-service-product__desc">{{ desc }}</text>
      </view>
      <AppButton
        v-if="actionLabel"
        :label="actionLabel"
        :icon="actionIcon"
        :variant="buttonVariant"
        size="sm"
        @tap.stop="emit('action')"
      />
      <view v-else class="app-service-product__chevron" aria-hidden="true">
        <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
      </view>
    </template>
  </view>
</template>

<style scoped>
.app-service-product {
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
}

.app-service-product--tile {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 148px;
  padding: 16px 14px;
  flex-direction: column;
  border: 1px solid #e5ebe7;
  border-radius: 18px;
  background: #ffffff;
}
.app-service-product--tile.app-service-product--amber {
  border-color: #efe3d2;
}
.app-service-product__glow {
  position: absolute;
  right: -30px;
  bottom: -40px;
  width: 110px;
  height: 110px;
  border-radius: 999px;
  background: rgba(39, 174, 96, 0.14);
  pointer-events: none;
  z-index: 0;
}
.app-service-product--amber .app-service-product__glow {
  background: rgba(243, 156, 60, 0.2);
}
.app-service-product__top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.app-service-product--tile .app-service-product__icon-img {
  display: block;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  margin: 0 auto 10px;
}
.elder .app-service-product--tile .app-service-product__icon-img {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
}
.app-service-product__reason {
  min-width: 0;
  flex: 1;
  padding: 5px 8px;
  border-radius: 999px;
  background: #e8f6ef;
}
.app-service-product__reason-text {
  display: block;
  overflow: hidden;
  color: #176b52;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.app-service-product__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.app-service-product__body--solo {
  justify-content: center;
}
.app-service-product--tile .app-service-product__title {
  display: block;
  width: 100%;
  color: #1a1f1c;
  font-size: var(--font-subheading, 19px);
  font-weight: 900;
  line-height: 1.3;
  text-align: center;
}
.app-service-product--tile .app-service-product__desc {
  display: -webkit-box;
  width: 100%;
  margin-top: 8px;
  overflow: hidden;
  color: #8a938d;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
  text-align: center;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.app-service-product--row {
  display: flex;
  min-height: 88px;
  align-items: center;
  gap: 14px;
  padding: 16px 14px;
  border: 1px solid #e4ebe6;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(16, 52, 40, 0.04);
}
.app-service-product--row .app-service-product__icon {
  position: relative;
  display: block;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 14px;
  background: #e5f3ec;
  overflow: hidden;
}
.app-service-product--row.app-service-product--amber .app-service-product__icon {
  background: #fff1d6;
}
.app-service-product--row .app-service-product__icon-img {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  width: 34px;
  height: 34px;
  margin: 0;
  transform: translate(-50%, -50%);
}
.app-service-product__copy {
  min-width: 0;
  flex: 1;
}
.app-service-product__reason-inline,
.app-service-product--row .app-service-product__desc {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  color: #5f6b64;
  font-size: var(--font-secondary, 16px);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.app-service-product--row .app-service-product__title {
  display: block;
  margin-top: 0;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
  line-height: 1.35;
}
.app-service-product__chevron {
  display: flex;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
}
</style>
