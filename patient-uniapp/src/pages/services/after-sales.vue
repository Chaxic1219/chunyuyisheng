<script setup lang="ts">
/** 发票与售后：工单列表 */
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { listAfterSales, type AfterSaleTicket } from "../../api/servicePackage";
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
const loading = ref(false);
const tickets = ref<AfterSaleTicket[]>([]);

const openTickets = computed(() => tickets.value.filter((t) => t.status === "open"));
const recentTickets = computed(() =>
  tickets.value.filter((t) => t.status !== "open").slice(0, 8)
);

async function load() {
  const ok = await ensureLogin("/pages/services/after-sales");
  if (!ok) return;
  loading.value = true;
  try {
    const data = await listAfterSales({ limit: 20 });
    tickets.value = data.tickets || [];
  } catch {
    tickets.value = [];
    uni.showToast({ title: "加载失败", icon: "none" });
  } finally {
    loading.value = false;
  }
}

onShow(() => {
  void load();
});

function ticketTypeLabel(t: AfterSaleTicket) {
  return TYPE_LABEL[t.type] || t.type || "售后申请";
}

function ticketStatusLabel(t: AfterSaleTicket) {
  return STATUS_LABEL[t.status] || t.status || "—";
}

function productTitle(t: AfterSaleTicket) {
  return (t.productTitle || "").trim() || `订单 ${t.orderId}`;
}

function productCover(t: AfterSaleTicket) {
  return safeLocalImageSrc(t.productCover);
}

function orderRef(t: AfterSaleTicket) {
  const no = (t.orderNo || "").trim();
  return no ? `订单 ${no}` : `订单 ${t.orderId}`;
}

function formatCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(Number(cents))) return "";
  const yuan = Number(cents) / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function formatDate(raw?: string | null) {
  if (!raw) return "";
  const d = raw.slice(0, 10);
  return d || raw;
}

function goDetail(id: number) {
  uni.navigateTo({ url: `/pages/services/after-sale-detail?id=${id}` });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading" class="state">加载中…</view>

    <template v-else>
      <view v-if="!openTickets.length && !recentTickets.length" class="state">
        暂无售后工单。可从「我的订单」发起退款申请。
      </view>

      <view v-if="openTickets.length" class="section">
        <text class="heading">进行中的售后（{{ openTickets.length }}）</text>
        <view
          v-for="t in openTickets"
          :key="t.id"
          class="ticket pressable"
          @click="goDetail(t.id)"
        >
          <view class="ticket__row">
            <image
              v-if="productCover(t)"
              class="ticket__cover"
              :src="productCover(t)"
              mode="aspectFill"
            />
            <view v-else class="ticket__cover ticket__cover--empty">
              <text class="ticket__cover-text">服务</text>
            </view>
            <view class="ticket__main">
              <view class="ticket__head">
                <text class="ticket__title">{{ productTitle(t) }}</text>
                <text class="ticket__badge ticket__badge--open">{{ ticketStatusLabel(t) }}</text>
              </view>
              <text class="ticket__sub">
                {{ ticketTypeLabel(t) }} · {{ orderRef(t)
                }}{{ t.qty && t.qty > 1 ? ` · x${t.qty}` : ""
                }}{{ formatCents(t.amountCents) ? ` · ${formatCents(t.amountCents)}` : "" }}
              </text>
              <text class="ticket__reason">{{ t.reason || "未填写原因" }}</text>
              <text v-if="t.createdAt" class="ticket__date">提交于 {{ formatDate(t.createdAt) }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="recentTickets.length" class="section">
        <text class="heading">近期记录</text>
        <view
          v-for="t in recentTickets"
          :key="t.id"
          class="ticket pressable"
          @click="goDetail(t.id)"
        >
          <view class="ticket__row">
            <image
              v-if="productCover(t)"
              class="ticket__cover"
              :src="productCover(t)"
              mode="aspectFill"
            />
            <view v-else class="ticket__cover ticket__cover--empty">
              <text class="ticket__cover-text">服务</text>
            </view>
            <view class="ticket__main">
              <view class="ticket__head">
                <text class="ticket__title">{{ productTitle(t) }}</text>
                <text
                  class="ticket__badge"
                  :class="{
                    'ticket__badge--ok': t.status === 'approved',
                    'ticket__badge--no': t.status === 'rejected' || t.status === 'closed',
                  }"
                >
                  {{ ticketStatusLabel(t) }}
                </text>
              </view>
              <text class="ticket__sub">{{ ticketTypeLabel(t) }} · {{ orderRef(t) }}</text>
              <text class="ticket__reason">{{ t.reason || "—" }}</text>
              <text v-if="t.adminNote" class="ticket__note">备注：{{ t.adminNote }}</text>
            </view>
          </view>
        </view>
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
.section {
  margin-bottom: 12px;
}
.heading {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.ticket {
  margin-bottom: 10px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
}
.ticket__row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.ticket__cover {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  background: #eef2ef;
}
.ticket__cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ticket__cover-text {
  color: #9aa69e;
  font-size: 12px;
  font-weight: 700;
}
.ticket__main {
  flex: 1;
  min-width: 0;
}
.ticket__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.ticket__title {
  flex: 1;
  min-width: 0;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: 1.35;
}
.ticket__badge {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef2ef;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.ticket__badge--open {
  background: #fff4e5;
  color: #a35a1a;
}
.ticket__badge--ok {
  background: #e8f3ee;
  color: #176b52;
}
.ticket__badge--no {
  background: #f0f3f5;
  color: #6a756f;
}
.ticket__sub,
.ticket__reason,
.ticket__date,
.ticket__note {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
.ticket__note {
  color: #a35a1a;
}
.elder .heading,
.elder .ticket__title {
  font-size: var(--font-heading, 22px);
}
.elder .ticket__sub,
.elder .ticket__reason {
  font-size: var(--font-secondary, 16px);
}
.elder .ticket__cover {
  width: 72px;
  height: 72px;
}
</style>
