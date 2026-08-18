<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";
import {
  cancelServiceOrder,
  getServiceAssets,
  listMyOrders,
  listMyServices,
  type AfterSaleTicket,
  type ServiceInstance,
  type ServiceOrder,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { useConsultationStore } from "../../stores/consultation";
import { ensureLogin } from "../../utils/ensureLogin";
import { runServiceOrderPay } from "../../utils/servicePayFlow";

const MAIN_TABS = [
  { key: "active", label: "进行中" },
  { key: "orders", label: "订单" },
] as const;

type MainTab = (typeof MAIN_TABS)[number]["key"];

/** 对齐商城 order-list：全部 + 四态（医疗语义） */
const ORDER_TABS = [
  { key: "all", label: "全部" },
  { key: "pending_payment", label: "待付款" },
  { key: "paid_pending_profile", label: "待资料" },
  { key: "pending_review", label: "审核中" },
  { key: "active", label: "已开通" },
] as const;

type OrderTab = (typeof ORDER_TABS)[number]["key"];

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "待付款",
  paid_pending_profile: "待补充资料",
  pending_review: "审核中",
  active: "已开通",
  completed: "已完成",
  refunding: "退款中",
  refunded: "已退款",
  closed_timeout: "已关闭",
};

const appStore = useAppStore();
const consultation = useConsultationStore();
const loading = ref(false);
const payingId = ref(0);
const mainTab = ref<MainTab>("active");
const orderTab = ref<OrderTab>("all");
const instances = ref<ServiceInstance[]>([]);
const orders = ref<ServiceOrder[]>([]);
const couponAvailableCount = ref(0);
const openTicketCount = ref(0);
const openTickets = ref<AfterSaleTicket[]>([]);
const badges = ref<Record<string, number>>({
  pending_payment: 0,
  paid_pending_profile: 0,
  pending_review: 0,
  active: 0,
});

const openTicketOrderIds = computed(() => {
  const ids = new Set<number>();
  for (const t of openTickets.value) {
    if (t.status === "open" && t.orderId) ids.add(Number(t.orderId));
  }
  return ids;
});

const activeInstances = computed(() =>
  instances.value.filter((row) => row.status === "active" || row.status === "pending_review")
);

function orderTitle(order: ServiceOrder) {
  if (order.lines?.length) {
    const first = order.lines[0]?.title;
    if (first) {
      return order.lines.length > 1 ? `${first} 等${order.lines.length}项服务` : first;
    }
  }
  const snap = order.snapshot as { title?: string } | undefined;
  return snap?.title || order.orderNo;
}

function orderDoctor(order: ServiceOrder) {
  const snap = order.snapshot as {
    doctorName?: string;
    doctorHospital?: string;
    doctorTitle?: string;
  } | undefined;
  const name = snap?.doctorName || (order.doctorId && appStore.doctor?.id === order.doctorId
    ? appStore.doctor?.name
    : "");
  if (!name) return "";
  const bits = [name + "医生"];
  if (snap?.doctorHospital) bits.push(snap.doctorHospital);
  return bits.join(" · ");
}

function orderLines(order: ServiceOrder) {
  if (order.lines?.length) return order.lines;
  const snap = order.snapshot as { title?: string } | undefined;
  return [{ title: snap?.title || "服务包", qty: 1 }];
}

function formatAmount(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? `¥${v}` : `¥${v.toFixed(2)}`;
}

function formatPayable(order: ServiceOrder) {
  if (order.payableAmountCents != null && Number.isFinite(Number(order.payableAmountCents))) {
    const yuan = Number(order.payableAmountCents) / 100;
    return formatAmount(yuan);
  }
  return formatAmount(order.totalAmount);
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function badgeFor(key: string) {
  return Number(badges.value[key] || 0);
}

onLoad((query) => {
  const tab = String(query?.tab || "").trim();
  if (tab === "orders" || tab === "order") {
    mainTab.value = "orders";
  } else if (tab === "active" || tab === "instances") {
    mainTab.value = "active";
  }
  const status = String(query?.status || query?.type || "").trim();
  if (status === "all" || status === "9999") {
    mainTab.value = "orders";
    orderTab.value = "all";
  } else if (status && ORDER_TABS.some((t) => t.key === status)) {
    mainTab.value = "orders";
    orderTab.value = status as OrderTab;
  } else if (status === "refund_closed") {
    mainTab.value = "orders";
    orderTab.value = "all";
  }
});

async function loadSummary() {
  try {
    const assets = await getServiceAssets();
    couponAvailableCount.value = Number(assets.couponAvailableCount) || 0;
    openTickets.value = assets.openTickets || [];
    openTicketCount.value = openTickets.value.length;
    if (!instances.value.length && assets.instances?.length) {
      instances.value = assets.instances;
    }
  } catch {
    /* 摘要失败不阻断主列表 */
  }
}

async function loadActive() {
  const data = await listMyServices();
  instances.value = data.instances || [];
}

async function refreshBadges() {
  try {
    const data = await listMyOrders({ limit: 100 });
    const rows = data.orders || [];
    const next = {
      pending_payment: 0,
      paid_pending_profile: 0,
      pending_review: 0,
      active: 0,
    };
    for (const row of rows) {
      if (row.status in next) {
        next[row.status as keyof typeof next] += 1;
      }
    }
    badges.value = next;
  } catch {
    /* ignore */
  }
}

async function loadOrders() {
  if (orderTab.value === "all") {
    const data = await listMyOrders({ limit: 50 });
    orders.value = data.orders || [];
  } else {
    const data = await listMyOrders({ status: orderTab.value, limit: 50 });
    orders.value = data.orders || [];
  }
  await refreshBadges();
}

async function load() {
  const ok = await ensureLogin("/pages/services/mine-services");
  if (!ok) return;
  loading.value = true;
  try {
    await Promise.all([
      mainTab.value === "active" ? loadActive() : loadOrders(),
      loadSummary(),
    ]);
  } catch {
    if (mainTab.value === "active") instances.value = [];
    else orders.value = [];
    uni.showToast({ title: "加载失败", icon: "none" });
  } finally {
    loading.value = false;
  }
}

onShow(() => {
  void load();
});

function selectMain(key: MainTab) {
  if (mainTab.value === key) return;
  mainTab.value = key;
  void load();
}

function selectOrderTab(key: OrderTab) {
  if (orderTab.value === key) return;
  orderTab.value = key;
  void load();
}

function openInstance(inst: ServiceInstance) {
  uni.navigateTo({ url: `/pages/services/instance?id=${inst.id}` });
}

function openOrder(order: ServiceOrder) {
  uni.navigateTo({ url: `/pages/services/order-detail?id=${order.id}` });
}

function goCatalog() {
  uni.navigateTo({ url: "/pages/services/catalog" });
}

function go(url: string) {
  uni.navigateTo({ url });
}

function consultButler(inst?: ServiceInstance) {
  const target =
    inst ||
    activeInstances.value[0] ||
    instances.value.find((row) => row.status === "active") ||
    instances.value[0];
  if (target) {
    const bits = [`来自进行中的服务：${target.title || "当前服务"}`];
    if (target.id) bits.push(`实例ID ${target.id}`);
    if (target.orderId) bits.push(`订单ID ${target.orderId}`);
    consultation.applyEntryContext(`${bits.join("，")}。请协助处理服务进度与权益问题。`, "life");
  } else {
    consultation.applyEntryContext("来自我的服务：请协助查询服务进度与权益。", "life");
  }
  uni.switchTab({ url: "/pages/consult/index" });
}

function consultOrder(order: ServiceOrder) {
  consultation.applyEntryContext(
    `来自服务包订单 ${order.orderNo}（${orderStatusLabel(order)}）：请协助处理付款、资料或开通问题。`,
    "life"
  );
  uni.switchTab({ url: "/pages/consult/index" });
}

function goOnboarding(order: ServiceOrder) {
  uni.navigateTo({ url: `/pages/services/onboarding?orderId=${order.id}` });
}

function hasOpenAfterSale(order: ServiceOrder) {
  return openTicketOrderIds.value.has(Number(order.id));
}

function openTicketForOrder(order: ServiceOrder) {
  return openTickets.value.find((t) => t.status === "open" && Number(t.orderId) === Number(order.id));
}

function orderStatusLabel(order: ServiceOrder) {
  if (order.status === "refunded") return STATUS_LABEL.refunded;
  if (hasOpenAfterSale(order) || order.status === "refunding") return "售后中";
  return STATUS_LABEL[order.status] || order.status;
}

function goRefund(order: ServiceOrder) {
  const ticket = openTicketForOrder(order);
  if (ticket) {
    uni.navigateTo({ url: `/pages/services/after-sale-detail?id=${ticket.id}` });
    return;
  }
  uni.navigateTo({ url: `/pages/services/refund-apply?orderId=${order.id}` });
}

function canCancel(order: ServiceOrder) {
  return order.status === "pending_payment";
}

function canPay(order: ServiceOrder) {
  return order.status === "pending_payment";
}

function canProfile(order: ServiceOrder) {
  return order.status === "paid_pending_profile";
}

function canAfterSale(order: ServiceOrder) {
  return (
    order.status === "pending_payment" ||
    order.status === "paid_pending_profile" ||
    order.status === "pending_review" ||
    order.status === "active"
  );
}

function cancelOrder(order: ServiceOrder) {
  uni.showModal({
    title: "取消服务包订单",
    content: "确定取消该待付款订单吗？优惠券将自动解锁。",
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await cancelServiceOrder(order.id, "用户取消");
        uni.showToast({ title: "已取消", icon: "success" });
        void load();
      } catch (e: any) {
        uni.showToast({ title: e?.message || "取消失败", icon: "none" });
      }
    },
  });
}

async function payOrder(order: ServiceOrder) {
  if (payingId.value) {
    uni.showToast({ title: "请稍候…", icon: "none" });
    return;
  }
  payingId.value = order.id;
  try {
    await runServiceOrderPay(order.id);
    uni.navigateTo({ url: `/pages/services/pay-result?orderId=${order.id}` });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "支付失败", icon: "none" });
  } finally {
    payingId.value = 0;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="quick">
      <view class="quick__item pressable" aria-role="button" @click="go('/pages/services/rights')">
        <AppIcon name="service-rights" :size="20" tone="primary" />
        <text class="quick__title">优惠券</text>
        <text v-if="couponAvailableCount" class="quick__badge">{{ couponAvailableCount }}</text>
      </view>
      <view class="quick__item pressable" aria-role="button" @click="go('/pages/services/after-sales')">
        <AppIcon name="asset-data" :size="20" tone="primary" />
        <text class="quick__title">售后</text>
        <text v-if="openTicketCount" class="quick__badge">{{ openTicketCount }}</text>
      </view>
      <view class="quick__item pressable" aria-role="button" @click="go('/pages/services/agreements')">
        <AppIcon name="asset-privacy" :size="20" tone="primary" />
        <text class="quick__title">协议</text>
      </view>
      <view class="quick__item pressable" aria-role="button" @click="consultButler()">
        <AppIcon name="consult-doctor" :size="20" tone="primary" />
        <text class="quick__title">去咨询</text>
      </view>
    </view>

    <view class="main-tabs">
      <view
        v-for="tab in MAIN_TABS"
        :key="tab.key"
        class="main-tab pressable"
        :class="{ 'main-tab--on': mainTab === tab.key }"
        aria-role="button"
        @click="selectMain(tab.key)"
      >
        <text class="main-tab__label">{{ tab.label }}</text>
      </view>
    </view>

    <scroll-view v-if="mainTab === 'orders'" class="chips" scroll-x :show-scrollbar="false">
      <view class="chips__inner">
        <view
          v-for="tab in ORDER_TABS"
          :key="tab.key"
          class="chip pressable"
          :class="{ 'chip--on': orderTab === tab.key }"
          aria-role="button"
          @click="selectOrderTab(tab.key)"
        >
          <text class="chip__label">{{ tab.label }}</text>
          <text
            v-if="tab.key !== 'all' && badgeFor(tab.key)"
            class="chip__badge"
          >{{ badgeFor(tab.key) > 99 ? "99+" : badgeFor(tab.key) }}</text>
        </view>
      </view>
    </scroll-view>

    <view v-if="loading" class="state">加载中…</view>

    <template v-else-if="mainTab === 'active'">
      <AppEmptyState
        v-if="!activeInstances.length && !instances.length"
        :visual="''"
        title="暂无进行中的服务"
        text="购买服务包并开通后，进度会出现在这里。"
        action-label="去服务包目录"
        action-icon="service-package"
        @action="goCatalog"
      />
      <view v-else class="list">
        <view
          v-for="inst in instances"
          :key="inst.id"
          class="card pressable"
          @click="openInstance(inst)"
        >
          <view class="card__head">
            <text class="card__title">{{ inst.title }}</text>
            <text class="card__status">{{ STATUS_LABEL[inst.status] || inst.status }}</text>
          </view>
          <text class="card__sub">
            {{ inst.serviceStartDate || "—" }} ~ {{ inst.serviceEndDate || "—" }}
          </text>
          <text v-if="inst.summary?.nextTask" class="card__next">下一步：{{ inst.summary.nextTask }}</text>
          <view
            v-if="inst.status === 'active'"
            class="card__cta pressable"
            @click.stop="consultButler(inst)"
          >
            <text class="card__cta-text">咨询管家</text>
          </view>
        </view>
      </view>
    </template>

    <template v-else>
      <AppEmptyState
        v-if="!orders.length"
        :visual="''"
        title="暂无服务包订单"
        text="该状态下还没有订单，可去服务包目录选购康复指导等服务。"
        action-label="去服务包目录"
        action-icon="service-package"
        @action="goCatalog"
      />
      <view v-else class="list">
        <view v-for="order in orders" :key="order.id" class="ocard">
          <view class="ocard__top pressable" @click="openOrder(order)">
            <view class="ocard__meta">
              <text class="ocard__no">服务单号 {{ order.orderNo }}</text>
              <text class="ocard__time">{{ formatTime(order.createdAt) }}</text>
            </view>
            <text class="ocard__status">{{ orderStatusLabel(order) }}</text>
          </view>

          <view class="ocard__body pressable" @click="openOrder(order)">
            <view v-for="(line, idx) in orderLines(order)" :key="idx" class="oline">
              <view class="oline__icon">
                <AppIcon name="service-package" :size="22" tone="primary" />
              </view>
              <view class="oline__main">
                <text class="oline__title">{{ line.title || "服务包" }}</text>
                <text class="oline__qty">数量 ×{{ line.qty || 1 }}</text>
              </view>
            </view>
            <text v-if="orderDoctor(order)" class="ocard__doctor">服务医生 {{ orderDoctor(order) }}</text>
          </view>

          <view class="ocard__foot">
            <text class="ocard__sum">
              共{{ orderLines(order).reduce((n, l) => n + (Number(l.qty) || 1), 0) }}项服务 · 应付
              <text class="ocard__money">{{ formatPayable(order) }}</text>
            </text>
            <view class="ocard__actions">
              <view
                v-if="canCancel(order)"
                class="obtn pressable"
                @click.stop="cancelOrder(order)"
              >
                <text class="obtn__text">取消订单</text>
              </view>
              <view
                v-if="canPay(order)"
                class="obtn obtn--primary pressable"
                @click.stop="payOrder(order)"
              >
                <text class="obtn__text obtn__text--on">
                  {{ payingId === order.id ? "支付中…" : "去付款" }}
                </text>
              </view>
              <view
                v-if="canProfile(order)"
                class="obtn obtn--primary pressable"
                @click.stop="goOnboarding(order)"
              >
                <text class="obtn__text obtn__text--on">去补资料</text>
              </view>
              <view
                v-if="(canAfterSale(order) || hasOpenAfterSale(order)) && order.status !== 'pending_payment'"
                class="obtn pressable"
                @click.stop="goRefund(order)"
              >
                <text class="obtn__text">{{ hasOpenAfterSale(order) ? "查看售后" : "申请售后" }}</text>
              </view>
              <view class="obtn pressable" @click.stop="consultOrder(order)">
                <text class="obtn__text">咨询</text>
              </view>
              <view class="obtn pressable" @click.stop="openOrder(order)">
                <text class="obtn__text">详情</text>
              </view>
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
  padding: 12px 16px calc(28px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.quick {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.quick__item {
  position: relative;
  display: flex;
  min-height: 64px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 4px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e4ebe6;
}
.quick__title {
  color: #44514a;
  font-size: 13px;
  font-weight: 700;
}
.quick__badge {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #2f6b4f;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  line-height: 16px;
}
.main-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  padding: 4px;
  border-radius: 14px;
  background: #e8eee9;
}
.main-tab {
  flex: 1;
  padding: 10px 0;
  border-radius: 11px;
  text-align: center;
}
.main-tab--on {
  background: #fff;
  box-shadow: 0 2px 8px rgba(16, 52, 40, 0.06);
}
.main-tab__label {
  color: #5f6b64;
  font-size: 16px;
  font-weight: 700;
}
.main-tab--on .main-tab__label {
  color: #17201c;
}
.chips {
  margin-bottom: 12px;
  white-space: nowrap;
}
.chips__inner {
  display: inline-flex;
  gap: 8px;
  padding-bottom: 2px;
}
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #dce3dd;
}
.chip--on {
  background: #2f6b4f;
  border-color: #2f6b4f;
}
.chip__label {
  color: #44514a;
  font-size: 14px;
  font-weight: 700;
}
.chip--on .chip__label {
  color: #fff;
}
.chip__badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #c45c26;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.chip--on .chip__badge {
  background: #fff;
  color: #2f6b4f;
}
.state {
  padding: 24px;
  color: #6a756f;
  text-align: center;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e4ebe6;
}
.card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.card__title {
  flex: 1;
  color: #17201c;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.35;
}
.card__status {
  flex-shrink: 0;
  color: #2f6b4f;
  font-size: 13px;
  font-weight: 700;
}
.card__sub,
.card__next {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.45;
}
.card__cta {
  margin-top: 12px;
  padding: 8px 0;
  border-radius: 10px;
  background: #e8f4ee;
  text-align: center;
}
.card__cta-text {
  color: #2f6b4f;
  font-size: 14px;
  font-weight: 800;
}
.ocard {
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e4ebe6;
  overflow: hidden;
}
.ocard__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 0;
}
.ocard__meta {
  min-width: 0;
  flex: 1;
}
.ocard__no {
  display: block;
  color: #44514a;
  font-size: 12px;
  font-weight: 600;
}
.ocard__time {
  display: block;
  margin-top: 2px;
  color: #8a938d;
  font-size: 12px;
}
.ocard__status {
  color: #2f6b4f;
  font-size: 13px;
  font-weight: 800;
}
.ocard__body {
  padding: 10px 14px;
}
.oline {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}
.oline__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #e8f4ee;
}
.oline__main {
  min-width: 0;
  flex: 1;
}
.oline__title {
  display: block;
  color: #17201c;
  font-size: 15px;
  font-weight: 750;
  line-height: 1.35;
}
.oline__qty {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: 12px;
}
.ocard__doctor {
  display: block;
  margin-top: 4px;
  color: #44514a;
  font-size: 12px;
  font-weight: 600;
}
.ocard__foot {
  padding: 10px 14px 12px;
  border-top: 1px solid #eef2ef;
}
.ocard__sum {
  display: block;
  color: #5f6b64;
  font-size: 13px;
  text-align: right;
}
.ocard__money {
  color: #176b52;
  font-size: 16px;
  font-weight: 800;
}
.ocard__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.obtn {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #d0d8d2;
  background: #fff;
}
.obtn--primary {
  border-color: #2f6b4f;
  background: #2f6b4f;
}
.obtn__text {
  color: #44514a;
  font-size: 13px;
  font-weight: 700;
}
.obtn__text--on {
  color: #fff;
}
.elder .card__title,
.elder .main-tab__label,
.elder .oline__title {
  font-size: 20px;
}
</style>
