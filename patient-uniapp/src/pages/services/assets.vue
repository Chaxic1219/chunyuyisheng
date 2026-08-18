<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";

/** 兼容旧入口：统一跳转到「我的服务」进行中 */
onLoad(() => {
  uni.redirectTo({
    url: "/pages/services/mine-services?tab=active",
    fail: () => {
      uni.navigateTo({ url: "/pages/services/mine-services?tab=active" });
    },
  });
});
</script>

<template>
  <view class="page">正在跳转…</view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 40px 16px;
  color: #6a756f;
  text-align: center;
  background: #f0f3f5;
}
</style>
