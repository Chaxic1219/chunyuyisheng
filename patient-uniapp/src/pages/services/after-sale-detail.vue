<script setup lang="ts">
/** 售后工单详情：基础信息 + 申请内容 + 修改/撤销 */
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import {
  cancelAfterSale,
  getAfterSale,
  type AfterSaleTicket,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import { safeLocalImageSrc } from "../../utils/mediaSrc";

const TYPE_LABEL: Record<string, string> = {
  cancel_unpaid: "取消订单",
  refund_paid: "退款申请",
  refund_active: "开通后售后",
};

const STATUS_LABEL: Record<string, string> = {
  open: "处理中",
  approved: "已同意",
  rejected: "已拒绝",
  closed: "已关闭",
};

const appStore = useAppStore();
const ticketId = ref(0);
const loading = ref(true);
const acting = ref(false);
const ticket = ref<AfterSaleTicket | null>(null);
const errorMsg = ref("");

const isOpen = computed(() => ticket.value?.status === "open");

const typeLabel = computed(() => {
  const t = ticket.value?.type;
  return (t && TYPE_LABEL[t]) || t || "售后申请";
});

const statusLabel = computed(() => {
  const s = ticket.value?.status;
  return (s && STATUS_LABEL[s]) || s || "—";
});

const productTitle = computed(
  () =>
    (ticket.value?.productTitle || "").trim() ||
    (ticket.value ? `订单 ${ticket.value.orderId}` : "—")
);

const productCover = computed(() => safeLocalImageSrc(ticket.value?.productCover));

const orderRef = computed(() => {
  const no = (ticket.value?.orderNo || "").trim();
  if (no) return no;
  return ticket.value ? String(ticket.value.orderId) : "—";
});

function formatCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(Number(cents))) return "—";
  const yuan = Number(cents) / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function formatDate(raw?: string | null) {
  if (!raw) return "—";
  return raw.slice(0, 16).replace("T", " ") || raw;
}

async function load() {
  if (!ticketId.value) {
    errorMsg.value = "缺少工单号";
    loading.value = false;
    return;
  }
  const ok = await ensureLogin(`/pages/services/after-sale-detail?id=${ticketId.value}`);
  if (!ok) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    const data = await getAfterSale(ticketId.value);
    ticket.value = data.ticket;
  } catch (e: unknown) {
    ticket.value = null;
    errorMsg.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

onLoad((query) => {
  ticketId.value = Number(query?.id || 0);
});

onShow(() => {
  void load();
});

function goEdit() {
  if (!ticket.value) return;
  uni.navigateTo({
    url: `/pages/services/refund-apply?ticketId=${ticket.value.id}&orderId=${ticket.value.orderId}`,
  });
}

function confirmCancel() {
  if (!ticket.value || acting.value) return;
  uni.showModal({
    title: "撤销申请",
    content: "确认撤销本次退款申请？撤销后可从订单再次发起。",
    confirmText: "确认撤销",
    confirmColor: "#a33c33",
    success: (res) => {
      if (res.confirm) void doCancel();
    },
  });
}

async function doCancel() {
  if (!ticket.value || acting.value) return;
  acting.value = true;
  try {
    const data = await cancelAfterSale(ticket.value.id);
    ticket.value = data.ticket;
    uni.showToast({ title: "已撤销", icon: "success" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "撤销失败";
    uni.showToast({ title: msg, icon: "none" });
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading" class="state">加载中…</view>
    <view v-else-if="errorMsg && !ticket" class="state">{{ errorMsg }}</view>

    <template v-else-if="ticket">
      <view class="card">
        <view class="card__head">
          <text class="card__title">基础信息</text>
          <text
            class="badge"
            :class="{
              'badge--open': ticket.status === 'open',
              'badge--ok': ticket.status === 'approved',
              'badge--no': ticket.status === 'rejected' || ticket.status === 'closed',
            }"
          >
            {{ statusLabel }}
          </text>
        </view>

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
            <text class="product__sub">{{ typeLabel }} · {{ formatCents(ticket.amountCents) }}</text>
          </view>
        </view>

        <view class="kv">
          <text class="kv__k">订单号</text>
          <text class="kv__v">{{ orderRef }}</text>
        </view>
        <view class="kv">
          <text class="kv__k">工单号</text>
          <text class="kv__v">#{{ ticket.id }}</text>
        </view>
        <view class="kv">
          <text class="kv__k">提交时间</text>
          <text class="kv__v">{{ formatDate(ticket.createdAt) }}</text>
        </view>
        <view v-if="ticket.qty && ticket.qty > 1" class="kv">
          <text class="kv__k">数量</text>
          <text class="kv__v">x{{ ticket.qty }}</text>
        </view>
      </view>

      <view class="card">
        <text class="card__title">我填写的内容</text>
        <text class="reason">{{ ticket.reason || "未填写原因" }}</text>
        <text v-if="ticket.adminNote" class="note">处理备注：{{ ticket.adminNote }}</text>
      </view>

      <view v-if="isOpen" class="actions">
        <AppButton
          class="actions__btn"
          label="修改申请"
          icon="asset-data"
          variant="soft"
          :disabled="acting"
          @tap="goEdit"
        />
        <AppButton
          class="actions__btn"
          label="撤销申请"
          icon="asset-data"
          variant="primary"
          :disabled="acting"
          @tap="confirmCancel"
        />
      </view>
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
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.card__title {
  display: block;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.badge {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef2ef;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.badge--open {
  background: #fff4e5;
  color: #a35a1a;
}
.badge--ok {
  background: #e8f3ee;
  color: #176b52;
}
.badge--no {
  background: #f0f3f5;
  color: #6a756f;
}
.product {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8eee9;
}
.product__cover {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
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
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: 1.35;
}
.product__sub {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.kv {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.kv__k {
  flex-shrink: 0;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.kv__v {
  flex: 1;
  text-align: right;
  color: #17201c;
  font-size: var(--font-caption, 14px);
  font-weight: 600;
  word-break: break-all;
}
.reason {
  display: block;
  margin-top: 10px;
  color: #17201c;
  font-size: var(--font-body, 18px);
  line-height: 1.55;
  white-space: pre-wrap;
}
.note {
  display: block;
  margin-top: 10px;
  color: #a35a1a;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.actions__btn {
  flex: 1;
  min-width: 0;
}
.elder .card__title,
.elder .product__title,
.elder .reason {
  font-size: var(--font-heading, 22px);
}
.elder .kv__k,
.elder .kv__v,
.elder .product__sub {
  font-size: var(--font-secondary, 16px);
}
.elder .product__cover {
  width: 80px;
  height: 80px;
}
</style>
