<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import {
  getServiceInstance,
  listInstanceEntitlements,
  type ServiceInstance,
  type ServiceOrder,
  type ServiceEntitlement,
  type PackageInstance,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { useConsultationStore } from "../../stores/consultation";

const appStore = useAppStore();
const consultation = useConsultationStore();
const instance = ref<ServiceInstance | null>(null);
const order = ref<ServiceOrder | null>(null);
const entitlements = ref<ServiceEntitlement[]>([]);
const packageInstance = ref<PackageInstance | null>(null);

onLoad(async (query) => {
  const id = Number(query?.id || 0);
  if (!id) return;
  try {
    const data = await getServiceInstance(id);
    instance.value = data.instance;
    order.value = data.order;
    packageInstance.value = data.packageInstance || null;
    // 并行加载权益
    const entData = await listInstanceEntitlements(id);
    entitlements.value = Array.isArray(entData.entitlements) ? entData.entitlements : [];
  } catch (e: any) {
    uni.showToast({ title: e?.message || "加载失败", icon: "none" });
  }
});

function openPlan() {
  uni.navigateTo({ url: "/pages/plans/detail" });
}

function consultButler() {
  const title = String(instance.value?.title || "当前服务").trim();
  const instanceId = instance.value?.id;
  const orderId = instance.value?.orderId || order.value?.id;
  const bits = [`来自服务实例：${title}`];
  if (instanceId) bits.push(`实例ID ${instanceId}`);
  if (orderId) bits.push(`订单ID ${orderId}`);
  consultation.applyEntryContext(`${bits.join("，")}。请协助处理服务进度与权益问题。`, "life");
  uni.switchTab({ url: "/pages/consult/index" });
}

function goBack() {
  uni.navigateBack();
}

function openEntitlement(entitlement: ServiceEntitlement) {
  uni.navigateTo({ url: `/pages/services/entitlement?id=${entitlement.id}` });
}

function quotaLabel(ent: ServiceEntitlement) {
  if (ent.totalQuota == null) return "服务期内可用";
  return `剩余 ${ent.remainingQuota ?? ent.totalQuota - ent.usedQuota} / ${ent.totalQuota} ${ent.unit || "次"}`;
}

function statusLabel(status: string) {
  if (status === "active") return "可用";
  if (status === "exhausted") return "已用完";
  if (status === "expired") return "已过期";
  return status;
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="instance" class="card">
      <text class="title">{{ instance.title }}</text>
      <text class="sub">服务周期 {{ instance.serviceStartDate }} ~ {{ instance.serviceEndDate }}</text>
      <text class="sub">状态：{{ instance.status === "active" ? "服务中" : instance.status }}</text>
      <text v-if="instance.summary?.nextTask" class="next">下一步：{{ instance.summary.nextTask }}</text>
    </view>

    <!-- 权益卡片 -->
    <view v-if="entitlements.length" class="section">
      <text class="section-title">服务权益</text>
      <view
        v-for="ent in entitlements"
        :key="ent.id"
        class="entitlement-card pressable"
        aria-role="button"
        @click="openEntitlement(ent)"
      >
        <view class="entitlement-card__top">
          <text class="entitlement-card__name">{{ ent.name }}</text>
          <text class="entitlement-card__status">{{ statusLabel(ent.status) }}</text>
        </view>
        <text class="entitlement-card__quota">{{ quotaLabel(ent) }}</text>
        <view class="entitlement-card__footer">
          <text class="entitlement-card__period">{{ ent.validFrom }} ~ {{ ent.validTo }}</text>
          <view v-if="ent.actionLabel" class="entitlement-card__action pressable">
            <text>{{ ent.actionLabel }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="packageInstance?.components.some((item) => item.type === 'OPS_SERVICE_TEMPLATE')" class="section">
      <text class="section-title">运营服务计划</text>
      <view v-for="component in packageInstance.components.filter((item) => item.type === 'OPS_SERVICE_TEMPLATE')" :key="component.id" class="entitlement-card">
        <view v-for="task in component.tasks || []" :key="task.id" class="service-row">
          <text>{{ task.title }}</text><text>{{ task.status === 'pending' ? '待执行' : task.status }}</text>
        </view>
      </view>
    </view>

    <view v-if="packageInstance?.components.some((item) => item.type === 'GOODS_SKU')" class="section">
      <text class="section-title">实物配送</text>
      <view v-for="component in packageInstance.components.filter((item) => item.type === 'GOODS_SKU')" :key="component.id" class="entitlement-card">
        <view class="service-row"><text>配送状态</text><text>{{ component.fulfillment?.status === 'pending_shipment' ? '待发货' : component.fulfillment?.status }}</text></view>
        <view v-if="component.fulfillment?.trackingNo" class="service-row"><text>{{ component.fulfillment.carrier }}</text><text>{{ component.fulfillment.trackingNo }}</text></view>
      </view>
    </view>

    <view v-if="packageInstance?.status === 'partial_failure'" class="partial-note">部分服务激活中，已记录处理</view>

    <AppButton label="咨询管家" icon="consult-doctor" variant="primary" size="md" @tap="consultButler" />
    <AppButton label="查看康复计划/今日任务" icon="health-plan" variant="soft" size="md" @tap="openPlan" />
    <AppButton label="返回我的服务" icon="nav-back" variant="soft" size="md" @tap="goBack" />
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
  padding: 16px;
  border-radius: 14px;
  background: #fff;
}
.title {
  display: block;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.sub,
.next {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: var(--font-body, 18px);
  line-height: 1.5;
}
.next {
  color: #176b52;
  font-weight: 700;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.entitlement-card {
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.entitlement-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.entitlement-card__name {
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 700;
}
.entitlement-card__status {
  color: #176b52;
  font-size: 14px;
  font-weight: 600;
}
.entitlement-card__quota {
  display: block;
  margin-top: 6px;
  color: #176b52;
  font-size: 16px;
  font-weight: 800;
}
.entitlement-card__footer {
  display: flex;
  margin-top: 8px;
  align-items: center;
  justify-content: space-between;
}
.entitlement-card__period {
  color: #8a938d;
  font-size: 13px;
}
.entitlement-card__action {
  padding: 4px 12px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.service-row{display:flex;justify-content:space-between;padding:8px 0;color:#44534b;font-size:15px}.service-row+ .service-row{border-top:1px solid #edf1ee}.partial-note{padding:12px 14px;border-radius:10px;background:#fff7e6;color:#8b5a00}
</style>
