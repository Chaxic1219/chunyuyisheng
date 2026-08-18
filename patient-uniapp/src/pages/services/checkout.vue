<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import {
  clearCart,
  createServiceOrder,
  getCart,
  getServiceProduct,
  listMyCoupons,
  quoteCoupon,
  type CartItem,
  type Coupon,
  type CouponTemplate,
  type SaleSku,
  type ServiceProduct,
} from "../../api/servicePackage";
import { ensureLogin } from "../../utils/ensureLogin";
import { runServiceOrderPay } from "../../utils/servicePayFlow";
import {
  formatAddressLine,
  getCheckoutAddress,
  isAddressComplete,
  syncAddresses,
  type ServiceAddress,
} from "../../utils/serviceAddress";

const appStore = useAppStore();
const auth = useAuthStore();
const productId = ref("");
const product = ref<ServiceProduct | null>(null);
const selectedSkuId = ref(0);
const fromCart = ref(false);
const cartDoctorId = ref(0);
const cartItems = ref<CartItem[]>([]);
const cartTotalCents = ref(0);
const cartLoading = ref(false);
const submitting = ref(false);
const selectedAddress = ref<ServiceAddress | null>(null);
const addressPrompted = ref(false);
/** 本页会话级幂等键：连点/重入共用同一 key，避免 Date.now() 导致重复下单 */
const checkoutIdempotencyKey = ref(
  `mp-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const coupons = ref<Coupon[]>([]);
const couponsLoading = ref(false);
const selectedCouponId = ref<number | null>(null);
const discountCents = ref(0);
const payableCents = ref(0);
const quoting = ref(false);

const form = ref({
  contactPhone: "",
  receiverName: "",
  receiverPhone: "",
  receiverAddress: "",
  agreementAccepted: false,
  privacyAccepted: false,
});

const availableCartItems = computed(() => cartItems.value.filter((it) => !it.unavailable));

const availableCartTotalCents = computed(() =>
  availableCartItems.value.reduce((sum, it) => sum + (Number(it.lineTotalCents) || 0), 0)
);
const selectedSku = computed<SaleSku | null>(() =>
  product.value?.skus?.find((item) => item.skuId === selectedSkuId.value) || product.value?.skus?.[0] || null
);
const requiresAddress = computed(() => {
  if (fromCart.value) return availableCartItems.value.some((item) => item.components?.some((c) => c.type === "GOODS_SKU"));
  return !!selectedSku.value?.componentSummary?.some((item) => item.type === "GOODS_SKU");
});

const checkoutDoctorId = computed(() => {
  if (fromCart.value && cartDoctorId.value > 0) return cartDoctorId.value;
  const fromProduct = Number(product.value?.doctorId);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return fromProduct;
  const fromApp = Number(appStore.doctor?.id);
  if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
  const fromSource = Number(appStore.sourceDoctorId);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  return 0;
});

function currentCheckoutPath() {
  if (fromCart.value) {
    const id = cartDoctorId.value;
    return id
      ? `/pages/services/checkout?from=cart&doctorId=${encodeURIComponent(String(id))}`
      : "/pages/services/checkout?from=cart";
  }
  if (productId.value) {
    return `/pages/services/checkout?id=${encodeURIComponent(productId.value)}&skuId=${selectedSkuId.value}`;
  }
  return "/pages/services/checkout";
}

function applyAddress(addr: ServiceAddress | null) {
  selectedAddress.value = addr;
  if (!addr || !isAddressComplete(addr)) {
    form.value.receiverName = "";
    form.value.receiverPhone = "";
    form.value.receiverAddress = "";
    return;
  }
  form.value.receiverName = addr.name;
  form.value.receiverPhone = addr.phone;
  form.value.receiverAddress = formatAddressLine(addr);
  if (!form.value.contactPhone) form.value.contactPhone = addr.phone;
}

async function loadAddressFromStore() {
  try {
    await syncAddresses(checkoutDoctorId.value);
  } catch {
    /* 缓存兜底 */
  }
  applyAddress(getCheckoutAddress(checkoutDoctorId.value));
}

function goAddressManage(force = false) {
  const ret = encodeURIComponent(currentCheckoutPath());
  const url = `/pages/address/index?from=checkout&returnUrl=${ret}`;
  if (force) {
    uni.redirectTo({
      url,
      fail: () => uni.navigateTo({ url }),
    });
    return;
  }
  uni.navigateTo({ url });
}

async function ensureAddressOrGuide() {
  await loadAddressFromStore();
  if (isAddressComplete(selectedAddress.value)) return true;
  if (addressPrompted.value) return false;
  addressPrompted.value = true;
  uni.showModal({
    title: "请先完善服务地址",
    content: "下单前需要填写个人地址，完善后将返回确认订单。",
    confirmText: "去填写",
    showCancel: false,
    success: () => goAddressManage(true),
  });
  return false;
}

/** 商品/购物车小计（分），展示与 quote/下单共用 */
const subtotalCents = computed(() => {
  if (fromCart.value) {
    return availableCartTotalCents.value > 0
      ? availableCartTotalCents.value
      : cartTotalCents.value;
  }
  if (selectedSku.value) return Number(selectedSku.value.salePriceCents) || 0;
  return 0;
});

onLoad(async (query) => {
  productId.value = String(query?.id || "");
  selectedSkuId.value = Number(query?.skuId) || 0;
  fromCart.value = String(query?.from || "") === "cart";
  const did = Number(query?.doctorId);
  cartDoctorId.value = Number.isFinite(did) && did > 0 ? did : 0;

  const masked = String(auth.phoneMasked || "");
  if (/^1\d{10}$/.test(masked)) {
    form.value.contactPhone = masked;
  }

  if (fromCart.value) {
    await loadCartCheckout();
    syncPayableToSubtotal();
    await loadCoupons();
    if (requiresAddress.value) await ensureAddressOrGuide();
    return;
  }

  if (!productId.value) return;
  const ok = await ensureLogin(currentCheckoutPath());
  if (!ok) return;
  try {
    product.value = await getServiceProduct(productId.value);
    if (!selectedSkuId.value) selectedSkuId.value = product.value.skus?.[0]?.skuId || 0;
  } catch (e) {
    uni.showToast({ title: "商品加载失败", icon: "none" });
  }
  syncPayableToSubtotal();
  await loadCoupons();
  if (requiresAddress.value) await ensureAddressOrGuide();
});

onShow(async () => {
  await loadAddressFromStore();
  if (!isAddressComplete(selectedAddress.value) && (product.value || fromCart.value)) {
    // 从地址页返回且仍无地址时，允许再次引导
    addressPrompted.value = false;
  }
});

function syncPayableToSubtotal() {
  discountCents.value = 0;
  payableCents.value = subtotalCents.value;
  selectedCouponId.value = null;
}

async function loadCartCheckout() {
  const doctorId = cartDoctorId.value;
  const returnUrl = doctorId
    ? `/pages/services/checkout?from=cart&doctorId=${encodeURIComponent(String(doctorId))}`
    : "/pages/services/checkout?from=cart";
  const ok = await ensureLogin(returnUrl);
  if (!ok) return;

  if (!doctorId) {
    uni.showToast({ title: "缺少医生信息", icon: "none" });
    return;
  }

  cartLoading.value = true;
  try {
    const data = await getCart(doctorId);
    cartItems.value = Array.isArray(data.items) ? data.items : [];
    cartTotalCents.value = Number(data.totalAmountCents) || 0;
    if (!availableCartItems.value.length) {
      uni.showToast({ title: "购物车暂无可结算商品", icon: "none" });
    }
  } catch (e) {
    cartItems.value = [];
    cartTotalCents.value = 0;
    uni.showToast({ title: "购物车加载失败", icon: "none" });
  } finally {
    cartLoading.value = false;
  }
}

function isExpired(coupon: Coupon) {
  if (!coupon.expiresAt) return false;
  return String(coupon.expiresAt) < new Date().toISOString();
}

async function loadCoupons() {
  const doctorId = checkoutDoctorId.value;
  if (!doctorId || subtotalCents.value <= 0) {
    coupons.value = [];
    return;
  }

  couponsLoading.value = true;
  try {
    const res = await listMyCoupons({ status: "available" });
    const list = Array.isArray(res.coupons) ? res.coupons : [];
    coupons.value = list.filter(
      (c) => Number(c.doctorId) === doctorId && c.status === "available" && !isExpired(c)
    );
  } catch {
    /* 未登录或接口失败：无券路径仍可下单 */
    coupons.value = [];
  } finally {
    couponsLoading.value = false;
  }
}

function templateBenefit(tpl: CouponTemplate | null | undefined) {
  if (!tpl) return "优惠券";
  if (tpl.type === "fixed") {
    const thr = Number(tpl.thresholdCents || 0);
    const off = formatCents(tpl.discountCents);
    return thr > 0 ? `满${formatCents(thr)}减${off}` : `立减${off}`;
  }
  if (tpl.type === "percent") {
    const pct = Number(tpl.percentOff || 0);
    const max = Number(tpl.maxDiscountCents || 0);
    const base = pct > 0 ? `减${pct}%` : "折扣券";
    return max > 0 ? `${base}（最高减${formatCents(max)}）` : base;
  }
  return tpl.title || "优惠券";
}

function couponTitle(coupon: Coupon) {
  return coupon.template?.title || `优惠券 #${coupon.id}`;
}

async function selectCoupon(couponId: number | null) {
  if (quoting.value) return;
  const doctorId = checkoutDoctorId.value;
  const sub = subtotalCents.value;

  if (couponId == null) {
    selectedCouponId.value = null;
    discountCents.value = 0;
    payableCents.value = sub;
    return;
  }

  if (!doctorId || sub <= 0) {
    uni.showToast({ title: "暂无法使用优惠券", icon: "none" });
    return;
  }

  quoting.value = true;
  try {
    const quote = await quoteCoupon({
      doctorId,
      subtotalCents: sub,
      couponId,
    });
    if (!quote.usable) {
      uni.showToast({ title: "该券当前不可用", icon: "none" });
      selectedCouponId.value = null;
      discountCents.value = 0;
      payableCents.value = sub;
      return;
    }
    selectedCouponId.value = couponId;
    discountCents.value = Number(quote.discountCents) || 0;
    payableCents.value =
      quote.payableCents != null && Number.isFinite(Number(quote.payableCents))
        ? Number(quote.payableCents)
        : Math.max(0, sub - discountCents.value);
  } catch (e: any) {
    uni.showToast({ title: e?.message || "优惠券试算失败", icon: "none" });
    selectedCouponId.value = null;
    discountCents.value = 0;
    payableCents.value = sub;
  } finally {
    quoting.value = false;
  }
}

function yuan(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function formatCents(cents: unknown) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  const y = n / 100;
  return Number.isInteger(y) ? `¥${y}` : `¥${y.toFixed(2)}`;
}

const ICON_HEART = "/static/service-ui/health-heart.png";
const ICON_USER = "/static/service-ui/user-outline.png";
const ICON_HELP = "/static/service-ui/help.png";
const ICON_WECHAT = "/static/service-ui/wechat.png";

const subtotalLabel = computed(() => formatCents(subtotalCents.value));

const payableLabel = computed(() => formatCents(payableCents.value));

const priceBreakdown = computed(() => {
  if (fromCart.value) {
    const n = availableCartItems.value.length;
    return n ? `合计 ${subtotalLabel.value}（共 ${n} 项）` : "暂无可结算商品";
  }
  if (!product.value) return "";
  return `合计 ${subtotalLabel.value}（服务 ¥${yuan(product.value.serviceAmount)} · 实物 ¥${yuan(product.value.goodsAmount)}）`;
});

const orderTitle = computed(() => {
  if (fromCart.value) {
    const first = availableCartItems.value[0];
    if (!first) return "购物车结算";
    if (availableCartItems.value.length === 1) return first.title;
    return `${first.title} 等 ${availableCartItems.value.length} 项`;
  }
  return product.value?.title || "服务订单";
});

const orderMeta = computed(() => {
  if (fromCart.value) {
    return `${availableCartItems.value.length || 0} 项服务`;
  }
  const days = Number(selectedSku.value?.cycleDays);
  const doctor = product.value?.doctorName || appStore.doctor?.name || "";
  const bits = [
    Number.isFinite(days) && days > 0 ? `${days}天` : "",
    doctor ? `${doctor}医生` : "",
  ].filter(Boolean);
  return bits.join(" · ") || "健康服务";
});

const serviceFeeLabel = computed(() => {
  if (fromCart.value) return formatCents(subtotalCents.value);
  return formatCents(selectedSku.value?.salePriceCents || 0);
});

const goodsFeeLabel = computed(() => {
  if (fromCart.value) return "¥0";
  return requiresAddress.value ? "已包含" : "¥0";
});

const contactDisplayName = computed(() => {
  if (selectedAddress.value?.name) return selectedAddress.value.name;
  return "未填写联系人";
});

const contactDisplayPhone = computed(() => {
  const phone = String(selectedAddress.value?.phone || form.value.contactPhone || "").trim();
  if (/^1\d{10}$/.test(phone)) return `${phone.slice(0, 3)} **** ${phone.slice(7)}`;
  return phone || "未填写手机号";
});

const agreementsOk = computed(() => form.value.agreementAccepted && form.value.privacyAccepted);

function toggleAgreements() {
  const next = !agreementsOk.value;
  form.value.agreementAccepted = next;
  form.value.privacyAccepted = next;
}

function openAgreements() {
  uni.navigateTo({
    url: "/pages/services/agreements",
    fail: () => uni.showToast({ title: "可在我的服务中查看协议", icon: "none" }),
  });
}

function openProfileHint() {
  uni.showToast({ title: "支付后将引导补充健康资料", icon: "none" });
}

const canSubmit = computed(() => {
  if (fromCart.value) return availableCartItems.value.length > 0;
  return !!product.value && !!selectedSku.value;
});

async function runPayFlow(orderId: number) {
  await runServiceOrderPay(orderId);
  uni.redirectTo({ url: `/pages/services/pay-result?orderId=${orderId}` });
}

async function submit() {
  if (submitting.value) return;
  if (!canSubmit.value) return;
  if (!form.value.agreementAccepted || !form.value.privacyAccepted) {
    uni.showToast({ title: "请先勾选协议", icon: "none" });
    return;
  }
  await loadAddressFromStore();
  if (requiresAddress.value && !isAddressComplete(selectedAddress.value)) {
    uni.showModal({
      title: "请先完善服务地址",
      content: "尚未填写个人地址，请先到地址管理新增后再确认订单。",
      confirmText: "去填写",
      success: (res) => {
        if (res.confirm) goAddressManage(false);
      },
    });
    return;
  }
  applyAddress(selectedAddress.value);
  submitting.value = true;
  try {
    const couponPayload =
      selectedCouponId.value != null ? { couponId: selectedCouponId.value } : {};

    if (fromCart.value) {
      const items = availableCartItems.value.map((it) => ({
        skuId: it.skuId,
        qty: it.qty,
      }));
      const { order } = await createServiceOrder({
        items,
        serviceFor: "self",
        contactPhone: form.value.contactPhone || form.value.receiverPhone,
        receiverName: form.value.receiverName,
        receiverPhone: form.value.receiverPhone,
        receiverAddress: form.value.receiverAddress,
        agreementAccepted: true,
        privacyAccepted: true,
        idempotencyKey: checkoutIdempotencyKey.value,
        sourceDoctorId: appStore.sourceDoctorId || cartDoctorId.value || undefined,
        sourceGroupId: appStore.sourceGroupId || undefined,
        sourceChannel: appStore.sourceChannel || undefined,
        ...couponPayload,
      });
      try {
        await clearCart(cartDoctorId.value);
      } catch {
        /* 下单已成功，清空失败不阻断支付 */
      }
      await runPayFlow(order.id);
      return;
    }

    if (!product.value || !selectedSku.value) return;
    const { order } = await createServiceOrder({
      items: [{ skuId: selectedSku.value.skuId, qty: 1 }],
      serviceFor: "self",
      contactPhone: form.value.contactPhone || form.value.receiverPhone,
      receiverName: form.value.receiverName,
      receiverPhone: form.value.receiverPhone,
      receiverAddress: form.value.receiverAddress,
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: checkoutIdempotencyKey.value,
      sourceDoctorId: appStore.sourceDoctorId || undefined,
      sourceGroupId: appStore.sourceGroupId || undefined,
      sourceChannel: appStore.sourceChannel || undefined,
      ...couponPayload,
    });
    await runPayFlow(order.id);
  } catch (e: any) {
    uni.showToast({ title: e?.message || "下单失败", icon: "none" });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <scroll-view scroll-y class="scroll">
      <view v-if="fromCart && cartLoading" class="card">
        <text class="muted">正在加载购物车…</text>
      </view>

      <view v-else class="card order-card">
        <view class="order-card__top">
          <view class="order-card__thumb">
            <image class="order-card__thumb-img" src="/static/service-ui/health-heart.png" mode="aspectFit" />
          </view>
          <view class="order-card__main">
            <view class="order-card__title-row">
              <text class="order-card__title">{{ orderTitle }}</text>
              <text class="order-card__price">{{ payableLabel }}</text>
            </view>
            <text class="order-card__meta">{{ orderMeta }}</text>
          </view>
        </view>
        <view class="order-card__lines">
          <view class="order-card__line"><text>服务费用</text><text>{{ serviceFeeLabel }}</text></view>
          <view class="order-card__line"><text>实物及运费</text><text>{{ goodsFeeLabel }}</text></view>
          <view class="order-card__line order-card__line--total">
            <text>应付</text>
            <text class="em">{{ payableLabel }}</text>
          </view>
        </view>
        <text v-if="discountCents > 0" class="order-card__discount">已优惠 {{ formatCents(discountCents) }}</text>
      </view>

      <view class="card contact-card pressable" aria-role="button" @click="goAddressManage(false)">
        <text class="card__label">服务联系人</text>
        <view class="contact-card__row">
          <image class="contact-card__icon" :src="ICON_USER" mode="aspectFit" />
          <view class="contact-card__copy">
            <text class="contact-card__name">{{ contactDisplayName }} · {{ contactDisplayPhone }}</text>
            <text v-if="selectedAddress && isAddressComplete(selectedAddress)" class="contact-card__addr">
              {{ formatAddressLine(selectedAddress) }}
            </text>
            <text v-else class="contact-card__addr">点击完善服务地址与联系方式</text>
          </view>
          <text class="contact-card__action">修改</text>
          <AppIcon name="nav-chevron-right" :size="14" tone="muted" />
        </view>
      </view>

      <view class="hint-card pressable" aria-role="button" @click="openProfileHint">
        <image class="hint-card__icon" :src="ICON_HELP" mode="aspectFit" />
        <text class="hint-card__text">支付后需补充健康资料，审核通过后开始服务</text>
        <AppIcon name="nav-chevron-right" :size="14" tone="muted" />
      </view>

      <view v-if="canSubmit" class="card">
        <text class="card__label">优惠券</text>
        <text v-if="couponsLoading" class="muted">加载优惠券…</text>
        <template v-else>
          <view class="coupon" :class="{ 'coupon--on': selectedCouponId === null }" @click="selectCoupon(null)">
            <text class="coupon__title">不使用优惠券</text>
            <text class="coupon__hint">按原价支付</text>
          </view>
          <view
            v-for="coupon in coupons"
            :key="coupon.id"
            class="coupon"
            :class="{ 'coupon--on': selectedCouponId === coupon.id, 'coupon--busy': quoting }"
            @click="selectCoupon(coupon.id)"
          >
            <text class="coupon__title">{{ couponTitle(coupon) }}</text>
            <text class="coupon__hint">{{ templateBenefit(coupon.template) }}</text>
          </view>
          <text v-if="!coupons.length" class="muted">暂无可用优惠券</text>
        </template>
      </view>

      <view class="card">
        <text class="card__label">支付方式</text>
        <view class="pay-row">
          <image class="pay-row__icon" :src="ICON_WECHAT" mode="aspectFit" />
          <text class="pay-row__title">微信支付</text>
          <view class="pay-row__radio" />
        </view>
      </view>

      <view class="card agree-card">
        <view class="agree-card__row pressable" @click="toggleAgreements">
          <view class="agree-card__box" :class="{ 'agree-card__box--on': agreementsOk }">
            <text v-if="agreementsOk">✓</text>
          </view>
          <text class="agree-card__text">我已阅读并同意</text>
          <text class="agree-card__link" @click.stop="openAgreements">《服务协议》</text>
          <text class="agree-card__text">与</text>
          <text class="agree-card__link" @click.stop="openAgreements">《退款规则》</text>
        </view>
        <text class="agree-card__note">健康服务不替代急诊或线下诊疗</text>
      </view>
      <view class="scroll-spacer" />
    </scroll-view>

    <view class="footer">
      <view class="footer__price">
        <text class="footer__label">应付</text>
        <text class="footer__amount">{{ payableLabel }}</text>
      </view>
      <view
        class="footer__btn pressable"
        :class="{ 'footer__btn--disabled': submitting || !canSubmit || quoting }"
        aria-role="button"
        @click="submit"
      >
        <text>{{ submitting ? "提交中…" : "确认支付" }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  background: #f5f7f6;
}
.scroll {
  height: calc(100vh - 72px - env(safe-area-inset-bottom));
  padding: 12px 16px 0;
  box-sizing: border-box;
}
.card {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.card__label {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: 15px;
  font-weight: 800;
}
.muted {
  color: #8a938d;
  font-size: 13px;
}
.order-card__top {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.order-card__thumb {
  display: flex;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #e8f5ee;
}
.order-card__thumb-img {
  width: 30px;
  height: 30px;
}
.order-card__main {
  min-width: 0;
  flex: 1;
}
.order-card__title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.order-card__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
}
.order-card__price {
  color: #176b52;
  font-size: 16px;
  font-weight: 800;
}
.order-card__meta {
  display: block;
  margin-top: 4px;
  color: #8a938d;
  font-size: 12px;
}
.order-card__lines {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #eef2ef;
}
.order-card__line {
  display: flex;
  padding: 4px 0;
  align-items: center;
  justify-content: space-between;
  color: #6a756f;
  font-size: 13px;
}
.order-card__line--total {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid #eef2ef;
  color: #17201c;
  font-weight: 700;
}
.em {
  color: #176b52;
  font-size: 18px;
  font-weight: 800;
}
.order-card__discount {
  display: block;
  margin-top: 6px;
  color: #a35a1a;
  font-size: 12px;
  text-align: right;
}
.contact-card__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.contact-card__icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}
.contact-card__copy {
  min-width: 0;
  flex: 1;
}
.contact-card__name {
  display: block;
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}
.contact-card__addr {
  display: block;
  margin-top: 2px;
  color: #8a938d;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.contact-card__action {
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
}
.hint-card {
  display: flex;
  margin-bottom: 12px;
  padding: 12px 14px;
  align-items: center;
  gap: 8px;
  border-radius: 14px;
  background: #eef2ef;
}
.hint-card__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.hint-card__text {
  min-width: 0;
  flex: 1;
  color: #44524b;
  font-size: 13px;
  line-height: 1.4;
}
.coupon {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fafcfa;
}
.coupon--on {
  border-color: #176b52;
  background: #e8f3ee;
}
.coupon--busy {
  opacity: 0.7;
}
.coupon__title {
  display: block;
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}
.coupon__hint {
  display: block;
  margin-top: 3px;
  color: #8a938d;
  font-size: 12px;
}
.pay-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pay-row__icon {
  width: 24px;
  height: 24px;
}
.pay-row__title {
  flex: 1;
  color: #17201c;
  font-size: 15px;
  font-weight: 600;
}
.pay-row__radio {
  width: 18px;
  height: 18px;
  border: 5px solid #176b52;
  border-radius: 50%;
  box-sizing: border-box;
}
.agree-card__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.agree-card__box {
  display: flex;
  width: 18px;
  height: 18px;
  margin-right: 4px;
  align-items: center;
  justify-content: center;
  border: 1px solid #176b52;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  line-height: 1;
}
.agree-card__box--on {
  background: #176b52;
}
.agree-card__text {
  color: #44524b;
  font-size: 13px;
}
.agree-card__link {
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
}
.agree-card__note {
  display: block;
  margin-top: 8px;
  color: #9aa49d;
  font-size: 12px;
}
.scroll-spacer {
  height: 16px;
}
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  align-items: center;
  gap: 12px;
  background: #fff;
  box-shadow: 0 -4px 16px rgba(15, 61, 46, 0.06);
}
.footer__price {
  min-width: 0;
  flex: 1;
}
.footer__label {
  display: block;
  color: #8a938d;
  font-size: 12px;
}
.footer__amount {
  display: block;
  color: #176b52;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
}
.footer__btn {
  min-width: 140px;
  padding: 12px 22px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
.footer__btn--disabled {
  opacity: 0.5;
}
.elder .order-card__title {
  font-size: 18px;
}
</style>
