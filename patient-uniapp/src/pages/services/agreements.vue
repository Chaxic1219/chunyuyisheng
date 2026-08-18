<script setup lang="ts">
/** 服务协议：静态可读正文（版本可随商品协议升级） */
import AppButton from "../../components/AppButton.vue";
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();

const paragraphs = [
  "本协议适用于春雨医患通小程序内医生服务包的浏览、下单、支付、开通与售后。下单时勾选即视为已阅读并同意当前版本。",
  "服务内容以商品详情页载明的服务天数、评估节点、实物内容及问诊说明为准。问诊若需在春雨 APP 另行支付，将在详情中单独提示。",
  "支付成功后，请按指引补充术后资料；资料经审核通过后服务正式开通。审核不通过将按规则原路退款。",
  "开通后已交付的内容（含实物发货、已完成的评估节点）退款时将按实际交付情况人工核算。",
  "您的健康信息仅用于履约与客服沟通，未经授权不会用于与服务无关的用途。详细隐私说明可在设置中查看。",
  "协议版本：svc-agreement-v1 · 隐私版本：svc-privacy-v1 · 退款规则版本：svc-refund-v1",
];

function goBack() {
  uni.navigateBack({
    fail: () => uni.switchTab({ url: "/pages/mine/index" }),
  });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="card">
      <text class="title">服务协议与退款规则</text>
      <text v-for="(p, i) in paragraphs" :key="i" class="body">{{ p }}</text>
    </view>
    <AppButton label="我知道了" icon="action-confirm" variant="primary" block @tap="goBack" />
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.card {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 14px;
  background: #fff;
}
.title {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
}
.body {
  display: block;
  margin-top: 10px;
  color: #44514a;
  font-size: var(--font-caption, 14px);
  line-height: 1.65;
}
</style>
