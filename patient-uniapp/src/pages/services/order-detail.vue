<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import {
  cancelServiceOrder,
  claimServiceOrderBenefit,
  getServiceAssets,
  getServiceOrder,
  type AfterSaleTicket,
  type ServiceOrder,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { useConsultationStore } from "../../stores/consultation";
import { ensureLogin } from "../../utils/ensureLogin";
import { runServiceOrderPay } from "../../utils/servicePayFlow";

const PROGRESS_STEPS = ["待支付", "已支付", "已填资料", "审核中", "已开通"] as const;

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

const STATUS_HINT: Record<string, string> = {
  pending_payment: "请尽快完成支付，超时未付订单将自动关闭。",
  paid_pending_profile: "支付已完成，请补充术后/康复资料以便医生审核开通。",
  pending_review: "资料已提交，医护运营正在审核，请耐心等待。",
  active: "服务包已开通，可在「进行中」查看服务进度。",
  completed: "服务已结束，如有疑问可联系咨询管家。",
  refunding: "售后处理中，请留意退款进度。",
  refunded: "订单已退款。",
  closed_timeout: "订单已关闭。",
};

const appStore = useAppStore();
const consultation = useConsultationStore();
const orderId = ref(0);
const order = ref<ServiceOrder | null>(null);
const profile = ref<Record<string, unknown> | null>(null);
const openTicket = ref<AfterSaleTicket | null>(null);
const loading = ref(true);
const paying = ref(false);
const claimingBenefit = ref(false);
const benefitClaimState = ref<{
  status: string;
  claim?: { claimNo?: string; benefitCode?: string; redemptionUrl?: string; status?: string };
  error?: string | null;
} | null>(null);

/** 可领取权益：已开通 / 已支付待补资料 / 审核中 */
const canClaimBenefit = computed(() => {
  const s = order.value?.status;
  return (
    s === "active" ||
    s === "paid_pending_profile" ||
    s === "pending_review"
  );
});

async function openClaimBenefit() {
  if (!order.value || claimingBenefit.value) return;
  const ok = await ensureLogin(`/pages/services/order-detail?id=${order.value.id}`);
  if (!ok) return;
  claimingBenefit.value = true;
  benefitClaimState.value = null;
  try {
    const result = await claimServiceOrderBenefit(order.value.id);
    benefitClaimState.value = {
      status: result.status,
      claim: result.claim,
      error: null,
    };
    const claim = result.claim;
    if (claim?.redemptionUrl) {
      uni.showModal({
        title: "权益领取成功",
        content: "请点击「去领取」在权益页面完成权益激活与使用。",
        confirmText: "去领取",
        cancelText: "稍后再说",
        success: (res) => {
          if (res.confirm && claim.redemptionUrl) {
            // #ifdef MP-WEIXIN
            uni.navigateTo({ url: `/pages/services/benefit-webview?url=${encodeURIComponent(claim.redemptionUrl)}` });
            // #endif
            // #ifndef MP-WEIXIN
            uni.setClipboardData({ data: claim.redemptionUrl });
            // #endif
          }
        },
      });
    } else if (claim?.benefitCode) {
      uni.setClipboardData({
        data: claim.benefitCode,
        success: () => uni.showToast({ title: "领取码已复制，请打开权益页面领取", icon: "none" }),
      });
    } else {
      uni.showToast({ title: "权益已生成，可在「我的服务」查看", icon: "none" });
    }
  } catch (e: any) {
    const code = e?.code || e?.message || "";
    if (/not_configured|不可用|暂时不可用/.test(code)) {
      benefitClaimState.value = { status: "unavailable", error: e?.message || "权益领取暂未开放" };
      uni.showToast({ title: e?.message || "权益领取暂未开放", icon: "none" });
    } else {
      benefitClaimState.value = { status: "failed", error: e?.message || "领取失败，请稍后重试" };
      uni.showToast({ title: e?.message || "领取失败，请稍后重试", icon: "none" });
    }
  } finally {
    claimingBenefit.value = false;
  }
}

const progressIndex = computed(() => {
  const s = order.value?.status;
  if (!s) return 0;
  if (s === "pending_payment") return 0;
  if (s === "paid_pending_profile") return 2;
  if (s === "pending_review") return 3;
  if (s === "active" || s === "completed") return 4;
  return -1;
});

const isTerminal = computed(() => {
  const s = order.value?.status;
  return s === "refunding" || s === "refunded" || s === "closed_timeout";
});

const hasOpenAfterSale = computed(() => openTicket.value?.status === "open");

const statusLabel = computed(() => {
  const o = order.value;
  if (!o) return "—";
  if (o.status === "refunded") return STATUS_LABEL.refunded;
  if (hasOpenAfterSale.value || o.status === "refunding") return "售后中";
  return STATUS_LABEL[o.status] || o.status;
});

const statusHint = computed(() => {
  const o = order.value;
  if (!o) return "";
  if (hasOpenAfterSale.value || o.status === "refunding") {
    return "售后申请处理中，可在工单详情查看进度、修改或撤销。";
  }
  return STATUS_HINT[o.status] || "";
});

const canApplyAfterSale = computed(() => {
  const s = order.value?.status;
  return (
    s === "pending_payment" ||
    s === "paid_pending_profile" ||
    s === "pending_review" ||
    s === "active" ||
    hasOpenAfterSale.value
  );
});

const snap = computed(() => (order.value?.snapshot || {}) as Record<string, unknown>);

const doctorLine = computed(() => {
  const name = String(snap.value.doctorName || "");
  const hospital = String(snap.value.doctorHospital || "");
  if (!name && !hospital) {
    if (appStore.doctor?.name) {
      return [appStore.doctor.name + "医生", appStore.doctor.hospital].filter(Boolean).join(" · ");
    }
    return "";
  }
  return [name ? `${name}医生` : "", hospital].filter(Boolean).join(" · ");
});

function orderTitle(o: ServiceOrder) {
  if (o.lines?.length) return o.lines[0]?.title || o.orderNo;
  return String(snap.value.title || o.orderNo);
}

function lineAmount(line: { totalAmount?: number; totalAmountCents?: number }) {
  if (line.totalAmount != null && Number.isFinite(Number(line.totalAmount))) {
    return formatAmount(line.totalAmount);
  }
  if (line.totalAmountCents != null && Number.isFinite(Number(line.totalAmountCents))) {
    return formatAmount(Number(line.totalAmountCents) / 100);
  }
  return "—";
}

function formatAmount(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? `¥${v}` : `¥${v.toFixed(2)}`;
}

function formatCents(cents: unknown) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  const yuan = n / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stepState(i: number): "done" | "current" | "todo" | "off" {
  if (isTerminal.value) return "off";
  const cur = progressIndex.value;
  if (i < cur) return "done";
  if (i === cur) return "current";
  return "todo";
}

async function load() {
  if (!orderId.value) return;
  const ok = await ensureLogin(`/pages/services/order-detail?id=${orderId.value}`);
  if (!ok) return;
  loading.value = true;
  try {
    const data = await getServiceOrder(orderId.value);
    order.value = data.order;
    profile.value = (data.profile as Record<string, unknown>) || null;
    try {
      const assets = await getServiceAssets();
      openTicket.value =
        (assets.openTickets || []).find(
          (t) => t.status === "open" && Number(t.orderId) === Number(orderId.value)
        ) || null;
    } catch {
      openTicket.value = null;
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || "加载失败", icon: "none" });
  } finally {
    loading.value = false;
  }
}

onLoad((query) => {
  orderId.value = Number(query?.id || 0);
});

onShow(() => {
  void load();
});

async function goPay() {
  if (!order.value || paying.value) return;
  paying.value = true;
  try {
    await runServiceOrderPay(order.value.id);
    uni.navigateTo({ url: `/pages/services/pay-result?orderId=${order.value.id}` });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "支付失败", icon: "none" });
  } finally {
    paying.value = false;
  }
}

function goOnboarding() {
  if (!order.value) return;
  uni.navigateTo({ url: `/pages/services/onboarding?orderId=${order.value.id}` });
}

function goInstance() {
  if (!order.value?.instanceId) return;
  uni.navigateTo({ url: `/pages/services/instance?id=${order.value.instanceId}` });
}

function goRefundApply() {
  if (!order.value) return;
  if (openTicket.value?.id) {
    uni.navigateTo({ url: `/pages/services/after-sale-detail?id=${openTicket.value.id}` });
    return;
  }
  uni.navigateTo({ url: `/pages/services/refund-apply?orderId=${order.value.id}` });
}

function cancelOrder() {
  if (!order.value) return;
  uni.showModal({
    title: "取消服务包订单",
    content: "确定取消该待付款订单吗？",
    success: async (res) => {
      if (!res.confirm || !order.value) return;
      try {
        await cancelServiceOrder(order.value.id, "用户取消");
        uni.showToast({ title: "已取消", icon: "success" });
        void load();
      } catch (e: any) {
        uni.showToast({ title: e?.message || "取消失败", icon: "none" });
      }
    },
  });
}

function consult() {
  if (!order.value) return;
  consultation.applyEntryContext(
    `来自服务包订单详情 ${order.value.orderNo}（${statusLabel.value}）：请协助处理。`,
    "life"
  );
  uni.switchTab({ url: "/pages/consult/index" });
}

function copyOrderNo() {
  if (!order.value?.orderNo) return;
  uni.setClipboardData({
    data: order.value.orderNo,
    success: () => uni.showToast({ title: "已复制服务单号", icon: "none" }),
  });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading" class="state">加载中…</view>

    <template v-else-if="order">
      <view class="hero">
        <text class="hero__status">{{ statusLabel }}</text>
        <text class="hero__hint">{{ statusHint || "如有疑问请联系咨询管家。" }}</text>
        <view class="hero__no pressable" @click="copyOrderNo">
          <text class="hero__no-text">服务单号 {{ order.orderNo }}</text>
          <text class="hero__copy">复制</text>
        </view>
      </view>

      <view class="card">
        <text class="heading">服务开通进度</text>
        <view class="steps">
          <view v-for="(label, i) in PROGRESS_STEPS" :key="label" class="step">
            <view
              class="step__dot"
              :class="{
                'step__dot--done': stepState(i) === 'done',
                'step__dot--current': stepState(i) === 'current',
                'step__dot--off': stepState(i) === 'off',
              }"
            />
            <text
              class="step__label"
              :class="{
                'step__label--on': stepState(i) === 'done' || stepState(i) === 'current',
                'step__label--off': stepState(i) === 'off',
              }"
            >
              {{ label }}
            </text>
            <view
              v-if="i < PROGRESS_STEPS.length - 1"
              class="step__line"
              :class="{ 'step__line--on': stepState(i) === 'done' }"
            />
          </view>
        </view>
      </view>

      <view class="card">
        <text class="heading">服务信息</text>
        <view v-if="order.lines?.length">
          <view v-for="(line, idx) in order.lines" :key="line.id ?? idx" class="oline">
            <view class="oline__icon">
              <AppIcon name="service-package" :size="22" tone="primary" />
            </view>
            <view class="oline__main">
              <text class="oline__title">{{ line.title || "服务包" }}</text>
              <text class="oline__qty">数量 ×{{ line.qty }}</text>
              <text v-if="line.componentSnapshot?.length" class="oline__qty">
                {{ line.componentSnapshot.map((item) => `${item.name} ×${item.quantity}`).join(" · ") }}
              </text>
            </view>
            <text class="oline__amount">{{ lineAmount(line) }}</text>
          </view>
        </view>
        <view v-else class="oline">
          <view class="oline__icon">
            <AppIcon name="service-package" :size="22" tone="primary" />
          </view>
          <view class="oline__main">
            <text class="oline__title">{{ orderTitle(order) }}</text>
          </view>
        </view>
        <view v-if="doctorLine" class="kv">
          <text class="kv__k">服务医生</text>
          <text class="kv__v">{{ doctorLine }}</text>
        </view>
        <view v-if="order.serviceStartDate" class="kv">
          <text class="kv__k">服务起始</text>
          <text class="kv__v">{{ order.serviceStartDate }}</text>
        </view>
        <view class="kv">
          <text class="kv__k">下单时间</text>
          <text class="kv__v">{{ formatTime(order.createdAt) }}</text>
        </view>
      </view>

      <view class="card">
        <text class="heading">资料与审核</text>
        <view class="kv">
          <text class="kv__k">支付时间</text>
          <text class="kv__v">{{ formatTime(order.paidAt) }}</text>
        </view>
        <view class="kv">
          <text class="kv__k">资料提交</text>
          <text class="kv__v">{{ formatTime(order.profileSubmittedAt) }}</text>
        </view>
        <view v-if="profile?.surgeryType" class="kv">
          <text class="kv__k">诊断/说明</text>
          <text class="kv__v">{{ profile.surgeryType }}</text>
        </view>
        <view v-if="profile?.surgeryDate" class="kv">
          <text class="kv__k">相关日期</text>
          <text class="kv__v">{{ profile.surgeryDate }}</text>
        </view>
        <view v-if="profile?.laterality" class="kv">
          <text class="kv__k">当前症状</text>
          <text class="kv__v">{{ profile.laterality }}</text>
        </view>
        <view v-if="profile?.recoveryStage" class="kv">
          <text class="kv__k">当前阶段</text>
          <text class="kv__v">{{ profile.recoveryStage }}</text>
        </view>
        <text v-if="order.reviewNote" class="note">审核备注：{{ order.reviewNote }}</text>
        <text v-else-if="order.status === 'paid_pending_profile'" class="hint">
          尚未提交资料，请尽快补充以便开通服务。
        </text>
        <text v-else-if="order.status === 'pending_review'" class="hint">
          资料审核中，通过后将自动开通服务实例。
        </text>
      </view>

      <view class="card">
        <text class="heading">费用明细</text>
        <view class="kv">
          <text class="kv__k">服务金额</text>
          <text class="kv__v">{{ formatCents(order.totalAmountCents) }}</text>
        </view>
        <view
          v-if="order.discountAmountCents != null && Number(order.discountAmountCents) > 0"
          class="kv"
        >
          <text class="kv__k">优惠减免</text>
          <text class="kv__v kv__v--accent">-{{ formatCents(order.discountAmountCents) }}</text>
        </view>
        <view class="kv kv--total">
          <text class="kv__k">应付总额</text>
          <text class="kv__v kv__v--money">{{
            order.payableAmountCents != null
              ? formatCents(order.payableAmountCents)
              : formatAmount(order.totalAmount)
          }}</text>
        </view>
      </view>

      <view class="spacer" />

      <view class="bar">
        <view class="bar__consult pressable" aria-role="button" @click="consult">
          <AppIcon name="consult-doctor" :size="20" tone="primary" />
          <text class="bar__consult-text">咨询</text>
        </view>
        <view class="bar__actions">
          <view
            v-if="order.status === 'pending_payment'"
            class="bar__btn pressable"
            @click="cancelOrder"
          >
            <text class="bar__btn-text">取消</text>
          </view>
          <view
            v-if="canApplyAfterSale && order.status !== 'pending_payment'"
            class="bar__btn pressable"
            @click="goRefundApply"
          >
            <text class="bar__btn-text">{{ hasOpenAfterSale ? "查看售后" : "售后" }}</text>
          </view>
          <view
            v-if="canClaimBenefit"
            class="bar__btn pressable"
            @click="openClaimBenefit"
          >
            <text class="bar__btn-text">{{ claimingBenefit ? "领取中…" : "领取权益" }}</text>
          </view>
          <view
            v-if="order.status === 'pending_payment'"
            class="bar__btn bar__btn--primary pressable"
            @click="goPay"
          >
            <text class="bar__btn-text bar__btn-text--on">{{ paying ? "支付中…" : "去付款" }}</text>
          </view>
          <view
            v-else-if="order.status === 'paid_pending_profile'"
            class="bar__btn bar__btn--primary pressable"
            @click="goOnboarding"
          >
            <text class="bar__btn-text bar__btn-text--on">去补资料</text>
          </view>
          <view
            v-else-if="order.status === 'active' && order.instanceId"
            class="bar__btn bar__btn--primary pressable"
            @click="goInstance"
          >
            <text class="bar__btn-text bar__btn-text--on">服务进度</text>
          </view>
        </view>
      </view>
    </template>

    <view v-else class="state">订单不存在或无权查看</view>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px 16px calc(88px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.state {
  padding: 24px;
  color: #6a756f;
  text-align: center;
}
.hero {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(145deg, #1f6b52 0%, #2f8a68 100%);
  color: #fff;
}
.hero__status {
  display: block;
  font-size: 22px;
  font-weight: 800;
}
.hero__hint {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0.92;
}
.hero__no {
  display: flex;
  margin-top: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
}
.hero__no-text {
  font-size: 12px;
  opacity: 0.9;
}
.hero__copy {
  font-size: 12px;
  font-weight: 700;
}
.card {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e4ebe6;
}
.heading {
  display: block;
  margin-bottom: 12px;
  color: #17201c;
  font-size: 16px;
  font-weight: 800;
}
.steps {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.step {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
}
.step__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #dce3dd;
  z-index: 1;
}
.step__dot--done,
.step__dot--current {
  background: #176b52;
}
.step__dot--current {
  box-shadow: 0 0 0 4px rgba(23, 107, 82, 0.2);
}
.step__dot--off {
  background: #c5ccc6;
}
.step__label {
  margin-top: 8px;
  color: #9aa39d;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}
.step__label--on {
  color: #17201c;
}
.step__line {
  position: absolute;
  top: 5px;
  left: calc(50% + 8px);
  width: calc(100% - 16px);
  height: 2px;
  background: #dce3dd;
}
.step__line--on {
  background: #176b52;
}
.oline {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid #eef2ef;
}
.oline:first-of-type {
  border-top: none;
  padding-top: 0;
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
}
.oline__qty {
  display: block;
  margin-top: 2px;
  color: #6a756f;
  font-size: 12px;
}
.oline__amount {
  color: #176b52;
  font-size: 15px;
  font-weight: 800;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #f1f4f2;
}
.kv:first-of-type {
  border-top: none;
}
.kv--total {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #e4ebe6;
}
.kv__k {
  color: #6a756f;
  font-size: 13px;
}
.kv__v {
  color: #17201c;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
}
.kv__v--accent {
  color: #a35a1a;
}
.kv__v--money {
  color: #176b52;
  font-size: 18px;
  font-weight: 800;
}
.note {
  display: block;
  margin-top: 8px;
  color: #a33c33;
  font-size: 13px;
  line-height: 1.45;
}
.hint {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.45;
}
.spacer {
  height: 8px;
}
.bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #e4ebe6;
  box-shadow: 0 -4px 16px rgba(16, 52, 40, 0.06);
}
.bar__consult {
  display: flex;
  width: 48px;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.bar__consult-text {
  color: #44514a;
  font-size: 11px;
  font-weight: 700;
}
.bar__actions {
  display: flex;
  flex: 1;
  justify-content: flex-end;
  gap: 8px;
}
.bar__btn {
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid #d0d8d2;
  background: #fff;
}
.bar__btn--primary {
  border-color: #2f6b4f;
  background: #2f6b4f;
}
.bar__btn-text {
  color: #44514a;
  font-size: 14px;
  font-weight: 750;
}
.bar__btn-text--on {
  color: #fff;
}
.elder .hero__status,
.elder .oline__title {
  font-size: 24px;
}
</style>
