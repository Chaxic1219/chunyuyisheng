<script setup lang="ts">
import AppButton from "./AppButton.vue";

withDefaults(
  defineProps<{
    icon: string;
    ariaLabel: string;
    variant?: "primary" | "soft" | "amber" | "ghost" | "danger";
    disabled?: boolean;
  }>(),
  { variant: "ghost", disabled: false }
);

const emit = defineEmits<{ tap: [] }>();
</script>

<template>
  <AppButton
    :icon="icon"
    :aria-label="ariaLabel"
    :variant="variant"
    :disabled="disabled"
    @tap="emit('tap')"
  />
</template>
