<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";

onLoad(() => {
  uni.switchTab({ url: "/pages/mine/index" });
});
</script>

<template>
  <view class="redirect">正在前往「我的」…</view>
</template>

<style scoped>
.redirect {
  padding: 48px 24px;
  color: var(--text-secondary, #52627a);
  font-size: var(--font-subheading, 19px);
  text-align: center;
}
</style>
