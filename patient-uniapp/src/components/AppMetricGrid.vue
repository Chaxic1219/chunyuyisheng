<script setup lang="ts">
withDefaults(
  defineProps<{
    items: Array<{ value: string | number; label: string }>;
    tone?: "surface" | "dark";
  }>(),
  {
    tone: "surface",
  }
);
</script>

<template>
  <view class="app-metric-grid" :class="`app-metric-grid--${tone}`">
    <view v-for="item in items" :key="item.label" class="app-metric-grid__item radius" :class="tone === 'dark' ? 'bg-white' : 'bg-green light'">
      <text class="app-metric-grid__value">{{ item.value }}</text>
      <text class="app-metric-grid__label">{{ item.label }}</text>
    </view>
  </view>
</template>

<style scoped>
.app-metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.app-metric-grid__item {
  box-sizing: border-box;
  min-width: 0;
  padding: 10px 6px;
  border-radius: 10px;
  background: #f8faf7;
  text-align: center;
}

.app-metric-grid--dark .app-metric-grid__item {
  background: rgba(255, 255, 255, 0.1);
}

.app-metric-grid__value,
.app-metric-grid__label {
  display: block;
}

.app-metric-grid__value {
  color: #176b52;
  font-size: var(--font-heading, 24px);
  font-weight: 900;
}

.app-metric-grid__label {
  margin-top: 3px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}

.app-metric-grid--dark .app-metric-grid__value {
  color: #ffffff;
}

.app-metric-grid--dark .app-metric-grid__label {
  color: #cfe8dd;
}
</style>
