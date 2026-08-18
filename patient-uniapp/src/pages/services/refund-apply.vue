<script setup lang="ts">
/** 申请/修改售后：展示商品基础信息 + 填写原因 */
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import {
  createAfterSale,
  getAfterSale,
  getServiceOrder,
  updateAfterSale,
  type AfterSaleTicket,
  type ServiceOrder,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import { safeLocalImageSrc } from "../../utils/mediaSrc";

const appStore = useAppStore();
const orderId = ref(0);
const ticketId = ref(0);
const reason = ref("");
const submitting = ref(false);
const loading = ref(true);
const errorMsg = ref("");
const order = ref<ServiceOrder | null>(null);
const existing = ref<AfterSaleTicket | null>(null);

const isEdit = computed(() => ticketId.value > 0);

const productTitle = computed(() => {
  if (existing.value?.productTitle) return existing.value.productTitle.trim();
  const lines = order.value?.lines || [];
  const titles = lines.map((l) => String(l.title || "").trim()).filter(Boolean);
  if (titles.length > 1) return `${titles[0]} 等${titles.length}件`;
  if (titles.length === 1) return titles[0];
  const snap = order.value?.snapshot as { title?: string } | undefined;
  return (snap?.title || "").trim() || (orderId.value ? `订单 ${orderId.value}` : "—");
});

const productCover = computed(() => {
  if (existing.value?.productCover) return safeLocalImageSrc(existing.value.productCover);
  const line = order.value?.lines?.[0] as { snapshot?: { cover?: string } } | undefined;
  const snap = order.value?.snapshot as { cover?: string } | undefined;
  return safeLocalImageSrc(line?.snapshot?.cover || snap?.cover || "");
});

const orderRef = computed(() => {
  if (existing.value?.orderNo) return existing.value.orderNo;
  return order.value?.orderNo || (orderId.value ? String(orderId.value) : "—");
});

const amountLabel = computed(() => {
  const cents =
    existing.value?.amountCents ??
    order.value?.payableAmountCents ??
    order.value?.totalAmountCents;
  if (cents == null || !Number.isFinite(Number(cents))) return "";
  const yuan = Number(cents) / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
});

function returnPath() {
  if (ticketId.value) {
    return `/pages/services/refund-apply?ticketId=${ticketId.value}&orderId=${orderId.value || ""}`;
  }
  return `/pages/services/refund-apply?orderId=${orderId.value || ""}`;
}

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const ok = await ensureLogin(returnPath());
    if (!ok) return;

    if (ticketId.value) {
      const data = await getAfterSale(ticketId.value);
      existing.value = data.ticket;
      orderId.value = data.ticket.orderId;
      reason.value = data.ticket.reason || "";
      if (data.ticket.status !== "open") {
        errorMsg.value = "该工单已结束，无法修改";
      }
    } else if (orderId.value) {
      const data = await getServiceOrder(orderId.value);
      order.value = data.order;
    } else {
      errorMsg.value = "缺少订单号，请从订单详情进入";
    }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

onLoad((query) => {
  orderId.value = Number(query?.orderId || 0);
  ticketId.value = Number(query?.ticketId || 0);
  void load();
});

function goDetail(id: number) {
  uni.redirectTo({ url: `/pages/services/after-sale-detail?id=${id}` });
}

async function submit() {
  if (submitting.value || loading.value) return;
  const text = reason.value.trim();
  if (!text) {
    uni.showToast({ title: "请填写申请原因", icon: "none" });
    return;
  }
  if (isEdit.value && existing.value?.status !== "open") {
    uni.showToast({ title: "该工单无法修改", icon: "none" });
    return;
  }
  if (!isEdit.value && !orderId.value) {
    uni.showToast({ title: "缺少订单号", icon: "none" });
    return;
  }

  const ok = await ensureLogin(returnPath());
  if (!ok) return;

  submitting.value = true;
  errorMsg.value = "";
  try {
    if (isEdit.value) {
      const data = await updateAfterSale(ticketId.value, { reason: text });
      uni.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => goDetail(data.ticket.id), 400);
    } else {
      const data = await createAfterSale(orderId.value, { reason: text });
      uni.showToast({ title: "已提交", icon: "success" });
      setTimeout(() => goDetail(data.ticket.id), 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "提交失败";
    errorMsg.value = msg;
    uni.showToast({ title: msg, icon: "none" });
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading" class="state">加载中…</view>

    <template v-else>
      <view class="card">
        <text class="title">{{ isEdit ? "修改售后申请" : "申请售后 / 退款" }}</text>
        <view class="product">
          <image
            v-if="productCover"
            class="product__cover"
            :src="productCover"
            mode="aspectFill"
          />
          <view v-else class="product__cover product__cover--empty">
            <text class="product__cover-text">服务</text>
          </view>
          <view class="product__main">
            <text class="product__title">{{ productTitle }}</text>
            <text class="product__sub">
              订单 {{ orderRef }}{{ amountLabel ? ` · ${amountLabel}` : "" }}
            </text>
          </view>
        </view>
        <text class="hint">请说明取消或退款原因，提交后由客服审核处理。</text>
      </view>

      <view class="card">
        <text class="label">申请原因</text>
        <textarea
          v-model="reason"
          class="textarea"
          maxlength="200"
          placeholder="例如：暂不需要服务 / 资料有误需退款"
          :disabled="submitting || !!errorMsg && isEdit && existing?.status !== 'open'"
        />
        <text class="count">{{ reason.length }}/200</text>
      </view>

      <text v-if="errorMsg" class="error">{{ errorMsg }}</text>

      <AppButton
        :label="isEdit ? '保存修改' : '提交申请'"
        icon="asset-data"
        variant="primary"
        :disabled="
          submitting ||
          (!isEdit && !orderId) ||
          (isEdit && existing?.status !== 'open')
        "
        @tap="submit"
      />
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.state {
  padding: 24px;
  color: #6a756f;
  text-align: center;
  font-size: var(--font-body, 18px);
}
.card {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 14px;
  background: #fff;
}
.title {
  display: block;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
}
.product {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
}
.product__cover {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  background: #eef2ef;
}
.product__cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.product__cover-text {
  color: #9aa69e;
  font-size: 12px;
  font-weight: 700;
}
.product__main {
  flex: 1;
  min-width: 0;
}
.product__title {
  display: block;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
  line-height: 1.35;
}
.product__sub,
.hint,
.label,
.count,
.error {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}
.label {
  margin-top: 0;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.textarea {
  width: 100%;
  min-height: 120px;
  margin-top: 10px;
  padding: 12px;
  box-sizing: border-box;
  border-radius: 12px;
  background: #f0f3f5;
  color: #17201c;
  font-size: var(--font-caption, 14px);
  line-height: 1.5;
}
.count {
  text-align: right;
}
.error {
  margin-bottom: 12px;
  color: #b42318;
}
.elder .title,
.elder .product__title {
  font-size: var(--font-heading, 22px);
}
.elder .textarea,
.elder .hint,
.elder .product__sub {
  font-size: var(--font-secondary, 16px);
}
</style>
