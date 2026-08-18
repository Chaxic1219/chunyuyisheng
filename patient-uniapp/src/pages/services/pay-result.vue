<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import { getPaymentStatus, type ServiceOrder } from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
const orderId = ref(0);
const status = ref("");
const paid = ref(false);
const loading = ref(true);
const orderHint = ref("");

async function refresh() {
  if (!orderId.value) return;
  loading.value = true;
  try {
    const data = await getPaymentStatus(orderId.value);
    status.value = data.orderStatus;
    paid.value = !!data.paid;
    orderHint.value =
      data.orderStatus === "paid_pending_profile"
        ? "支付成功，请补充手术资料"
        : data.orderStatus === "pending_review"
          ? "资料已提交，等待运营审核"
          : data.orderStatus === "active"
            ? "服务已开通"
            : `当前状态：${data.orderStatus}`;
  } catch (e: any) {
    orderHint.value = e?.message || "查询失败";
  } finally {
    loading.value = false;
  }
}

onLoad((query) => {
  orderId.value = Number(query?.orderId || 0);
  void refresh();
});

function goOnboarding() {
  uni.redirectTo({ url: `/pages/services/onboarding?orderId=${orderId.value}` });
}

function goMine() {
  uni.redirectTo({ url: "/pages/services/mine-services" });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="card">
      <text class="title">{{ loading ? "查询支付结果…" : paid ? "支付成功" : "支付未完成" }}</text>
      <text class="sub">{{ orderHint }}</text>
    </view>
    <AppButton
      v-if="paid && status === 'paid_pending_profile'"
      label="去补充手术资料"
      icon="record-edit"
      variant="primary"
      size="md"
      @tap="goOnboarding"
    />
    <AppButton v-else-if="paid" label="查看我的服务" icon="service-center" variant="primary" size="md" @tap="goMine" />
    <AppButton label="刷新状态" icon="action-refresh" variant="soft" size="md" @tap="refresh" />
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  background: #f0f3f5;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  padding: 20px 16px;
  border-radius: 14px;
  background: #fff;
}
.title {
  display: block;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.sub {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: var(--font-body, 18px);
  line-height: 1.5;
}
</style>
