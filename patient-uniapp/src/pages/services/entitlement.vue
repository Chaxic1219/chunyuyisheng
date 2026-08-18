<script setup lang="ts">
import { ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import {
  cancelEntitlementUsage,
  getEntitlement,
  requestEntitlementUsage,
  type EntitlementUsage,
  type ServiceEntitlement,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
const entitlement = ref<ServiceEntitlement | null>(null);
const loading = ref(true);
const requesting = ref(false);
const cancelling = ref(false);

onLoad(async (query) => {
  const id = Number(query?.id || 0);
  if (!id) return;
  try {
    const data = await getEntitlement(id);
    entitlement.value = data.entitlement;
  } catch (e: any) {
    uni.showToast({ title: e?.message || "加载失败", icon: "none" });
  } finally {
    loading.value = false;
  }
});

function quotaLabel(ent: ServiceEntitlement) {
  if (ent.totalQuota == null) return "服务期内可用";
  const remaining = ent.remainingQuota ?? ent.totalQuota - ent.usedQuota;
  return `剩余 ${remaining} / ${ent.totalQuota} ${ent.unit || "次"}`;
}

function statusLabel(status: string) {
  if (status === "active") return "可用";
  if (status === "exhausted") return "已用完";
  if (status === "expired") return "已过期";
  return status;
}

const isActive = () => {
  const ent = entitlement.value;
  if (!ent) return false;
  return ent.status === "active";
};

const hasRemaining = () => {
  const ent = entitlement.value;
  if (!ent) return false;
  if (ent.totalQuota == null) return true; // unlimited
  const remaining = ent.remainingQuota ?? ent.totalQuota - ent.usedQuota;
  return remaining > 0;
};

const isRequestDisabled = () => {
  if (!isActive() || !hasRemaining()) return true;
  const usage = entitlement.value?.latestUsage;
  if (!usage) return false;
  // 有进行中的请求则禁用
  return usage.status === "REQUESTED" || usage.status === "ACCEPTED" || usage.status === "IN_PROGRESS";
};

const canCancelLatest = () => {
  const usage = entitlement.value?.latestUsage;
  if (!usage) return false;
  return usage.status === "REQUESTED";
};

async function doRequest() {
  const ent = entitlement.value;
  if (!ent || requesting.value || isRequestDisabled()) return;

  requesting.value = true;
  try {
    const idempotencyKey = `mp-entitlement-${ent.id}-${Date.now()}`;
    const result = await requestEntitlementUsage(ent.id, {
      qty: 1,
      idempotencyKey,
    });
    // 刷新最新使用记录
    if (entitlement.value) {
      entitlement.value = {
        ...entitlement.value,
        latestUsage: result.usage,
      };
    }
    uni.showToast({ title: "权益申请已提交", icon: "success" });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "申请失败", icon: "none" });
  } finally {
    requesting.value = false;
  }
}

async function doCancel() {
  const usage = entitlement.value?.latestUsage;
  if (!usage || cancelling.value) return;

  cancelling.value = true;
  try {
    await cancelEntitlementUsage(usage.id);
    if (entitlement.value) {
      entitlement.value = {
        ...entitlement.value,
        latestUsage: null,
      };
    }
    uni.showToast({ title: "已取消申请", icon: "success" });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "取消失败", icon: "none" });
  } finally {
    cancelling.value = false;
  }
}

function goBack() {
  uni.navigateBack();
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading" class="card">
      <text class="muted">加载中…</text>
    </view>

    <template v-else-if="entitlement">
      <!-- 权益信息卡片 -->
      <view class="card">
        <text class="title">{{ entitlement.name }}</text>
        <text class="sub">{{ entitlement.type }} · {{ statusLabel(entitlement.status) }}</text>
        <view class="balance-box">
          <text class="balance-label">剩余额度</text>
          <text class="balance-value">{{ quotaLabel(entitlement) }}</text>
        </view>
        <text class="sub">有效期 {{ entitlement.validFrom }} ~ {{ entitlement.validTo }}</text>
      </view>

      <!-- 最近使用 -->
      <view v-if="entitlement.latestUsage" class="card">
        <text class="card-title">最近申请</text>
        <view class="usage-row">
          <text class="usage-status">{{ entitlement.latestUsage.status }}</text>
          <text class="usage-qty">申请 {{ entitlement.latestUsage.requestedQty }} 次 · 消耗 {{ entitlement.latestUsage.consumedQty }} 次</text>
          <text class="usage-time">{{ entitlement.latestUsage.requestedAt }}</text>
        </view>
      </view>

      <!-- 操作区 -->
      <view class="actions">
        <AppButton
          v-if="isActive() && hasRemaining()"
          :label="requesting ? '提交中…' : (entitlement.actionLabel || '申请使用')"
          icon="service-package"
          variant="primary"
          size="md"
          block
          :disabled="isRequestDisabled()"
          @tap="doRequest"
        />
        <AppButton
          v-if="canCancelLatest()"
          :label="cancelling ? '取消中…' : '取消申请'"
          icon="nav-close"
          variant="danger"
          size="md"
          block
          @tap="doCancel"
        />
        <AppButton
          label="返回服务进度"
          icon="nav-back"
          variant="soft"
          size="md"
          block
          @tap="goBack"
        />
      </view>

      <!-- 提示：未来扩展 -->
      <view v-if="entitlement.actionKey" class="hint">
        <text>该权益对应的 {{ entitlement.actionKey }} 功能将在后续版本上线</text>
      </view>
    </template>

    <view v-else class="card">
      <text class="muted">未找到权益信息</text>
    </view>
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
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.title {
  display: block;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.sub {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-body, 18px);
  line-height: 1.5;
}
.muted {
  color: #8a938d;
  font-size: 15px;
}
.card-title {
  display: block;
  margin-bottom: 8px;
  color: #17201c;
  font-size: 15px;
  font-weight: 800;
}
.balance-box {
  margin: 14px 0;
  padding: 14px;
  border-radius: 12px;
  background: #e8f5ee;
}
.balance-label {
  display: block;
  color: #6a756f;
  font-size: 14px;
}
.balance-value {
  display: block;
  margin-top: 4px;
  color: #176b52;
  font-size: 22px;
  font-weight: 800;
}
.usage-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage-status {
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}
.usage-qty {
  color: #6a756f;
  font-size: 13px;
}
.usage-time {
  color: #8a938d;
  font-size: 12px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  margin-top: 4px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #eef2ef;
  color: #44524b;
  font-size: 13px;
  line-height: 1.4;
}
</style>
