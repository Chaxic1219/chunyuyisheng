<script setup lang="ts">
import { computed } from "vue";
import type { IconTone } from "../constants/iconRegistry";
import { useAppStore } from "../stores/app";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
  defineProps<{
    label?: string;
    icon?: string;
    ariaLabel?: string;
    variant?: "primary" | "soft" | "amber" | "ghost" | "danger";
    size?: "sm" | "md";
    block?: boolean;
    disabled?: boolean;
    state?: "idle" | "loading" | "success" | "error";
  }>(),
  {
    label: "",
    icon: "",
    ariaLabel: "",
    variant: "primary",
    size: "md",
    block: false,
    disabled: false,
    state: "idle",
  }
);

const emit = defineEmits<{ tap: [] }>();
const store = useAppStore();

const isLocked = computed(
  () => props.disabled || props.state === "loading" || props.state === "success"
);

const iconTone = computed<IconTone>(() => {
  if (props.variant === "primary") return "inverse";
  if (props.variant === "danger") return "danger";
  return "primary";
});

/** 旧 PNG 无独立 inverse 时用色值；v2 资料卡图标仍可通过 #FFFFFF → inverse */
const iconColor = computed(() => {
  if (props.variant === "primary") return "#FFFFFF";
  if (props.variant === "amber") return "#936015";
  if (props.variant === "danger") return "#A33C33";
  return "#176B52";
});

const rootClass = computed(() => [
  "app-button",
  "pressable",
  { "pressable--motion": !store.reducedMotion },
  `app-button--${props.variant}`,
  `app-button--${props.size}`,
  {
    "app-button--block": props.block,
    "app-button--disabled": isLocked.value,
    "app-button--icon-only": !!props.icon && !props.label,
  },
]);

function onTap() {
  if (isLocked.value) return;
  emit("tap");
}
</script>

<template>
  <view
    :class="rootClass"
    aria-role="button"
    :aria-label="ariaLabel || label"
    :aria-disabled="isLocked ? 'true' : 'false'"
    @click="onTap"
  >
    <AppIcon
      v-if="icon"
      :name="icon"
      :size="size === 'sm' ? 22 : 25"
      :tone="iconTone"
      :color="iconColor"
      :state="state"
    />
    <text v-if="label" class="app-button__label">{{ label }}</text>
  </view>
</template>

<style scoped>
.app-button,
.app-button::before,
.app-button::after {
  border: 0 !important;
  box-shadow: none;
}

.app-button::before,
.app-button::after {
  display: none !important;
  content: none !important;
}

.app-button {
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  overflow: hidden;
  border-radius: 10px;
  font-weight: 800;
  line-height: 1.2;
  vertical-align: middle;
  text-align: center;
}

.app-button--sm {
  height: var(--btn-height-sm, 40px);
  min-height: var(--btn-height-sm, 40px);
  padding: 0 14px;
  font-size: var(--font-secondary, 16px);
}

.app-button--md {
  height: var(--btn-height-md, 48px);
  min-height: var(--btn-height-md, 48px);
  padding: 0 16px;
  font-size: var(--font-body, 18px);
}

.app-button--block {
  width: 100%;
}

.app-button--icon-only {
  width: var(--btn-height-md, 48px);
  padding: 0;
}

.app-button--primary {
  background: #176b52;
  color: #ffffff;
}

.app-button--soft {
  background: #e5f3ec;
  color: #176b52;
}

.app-button--amber {
  background: #fff1d6;
  color: #936015;
}

.app-button--ghost {
  border: 1px solid #dce3dd !important;
  background: #ffffff;
  color: #176b52;
}

.app-button--danger {
  background: #fbe8e5;
  color: #a33c33;
}

.app-button--disabled {
  opacity: 0.5;
}

.app-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
</style>
