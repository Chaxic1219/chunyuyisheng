<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { IconMotion, IconTone } from "../constants/iconRegistry";
import { resolveIconMotion } from "../constants/iconRegistry";
import { useAppStore } from "../stores/app";
import { resolveIconSrc, safeLocalImageSrc } from "../utils/mediaSrc";

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    tone?: IconTone;
    /** 旧色值兼容；与 tone 二选一 */
    color?: string;
    motion?: IconMotion | "auto";
    state?: "idle" | "loading" | "success" | "error";
  }>(),
  { size: 29, color: "", motion: "auto", state: "idle" }
);

const store = useAppStore();
const failed = ref(false);

const effectiveName = computed(() => {
  if (props.state === "loading") return "status-loading";
  if (props.state === "success") return "status-success";
  if (props.state === "error") return "status-error";
  return failed.value ? "help" : props.name;
});

const effectiveMotion = computed(() =>
  store.reducedMotion
    ? "none"
    : props.motion === "auto"
      ? resolveIconMotion(effectiveName.value)
      : props.motion
);

const iconSrc = computed(() =>
  safeLocalImageSrc(
    resolveIconSrc(effectiveName.value, props.color || props.tone || "primary"),
    "/static/icons/help.png"
  )
);

const rootClass = computed(() => [
  "app-icon",
  `app-icon--motion-${effectiveMotion.value}`,
  `app-icon--state-${props.state}`,
]);

const boxStyle = computed(() => {
  const base = Number(props.size) || 29;
  const scaled = store.elderMode ? Math.round(base * (25 / 18)) : base;
  const px = `${scaled}px`;
  return { width: px, height: px };
});

watch(
  () => [props.name, props.state] as const,
  () => {
    failed.value = false;
  }
);

function onIconError() {
  failed.value = true;
}
</script>

<template>
  <view :class="rootClass" :style="boxStyle">
    <image
      v-if="iconSrc"
      class="app-icon__image"
      :src="iconSrc"
      mode="aspectFit"
      @error="onIconError"
    />
  </view>
</template>

<style scoped>
.app-icon {
  position: relative;
  display: block;
  flex: 0 0 auto;
  overflow: hidden;
  transition: transform 140ms ease-out, opacity 140ms ease-out;
}

.app-icon__image {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  width: 100%;
  height: 100%;
  transform: translate(-50%, -50%);
}
</style>
