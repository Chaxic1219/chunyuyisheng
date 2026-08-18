<script setup lang="ts">
/**
 * 权益领取 H5 web-view 承载页（PRD §8.14）
 * 接收 query.url = 权益系统固定领取地址（redemptionUrl）
 */
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";

const url = ref("");
const failed = ref(false);

onLoad((query) => {
  const raw = String(query?.url || "").trim();
  const title = String(query?.title || "").trim();
  if (title) uni.setNavigationBarTitle({ title });
  if (!raw) {
    failed.value = true;
    return;
  }
  try {
    const decoded = decodeURIComponent(raw);
    // 仅允许 http(s) 外链，拒绝注入
    if (/^https?:\/\//i.test(decoded)) url.value = decoded;
    else failed.value = true;
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <view class="page">
    <web-view v-if="url" :src="url" />
    <view v-else-if="failed" class="state">
      <text class="state__title">领取地址无效</text>
      <text class="state__desc">请返回订单详情重试，或在权益页面输入领取码。</text>
    </view>
    <view v-else class="state">
      <text class="state__title">正在打开权益领取页…</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; background: #fff; }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 60vh; padding: 24px; color: #5a6a6a; }
.state__title { font-size: 18px; font-weight: 700; color: #1f2d3d; }
.state__desc { font-size: 14px; color: #7c8ba5; text-align: center; line-height: 1.6; }
</style>
