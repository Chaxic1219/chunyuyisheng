<script setup lang="ts">
/**
 * 服务包购物车：按当前服务医生隔离；改数量、删除、去结算。
 */
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";
import {
  getCart,
  removeCartItem,
  updateCartItem,
  type CartItem,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import { safeLocalImageSrc } from "../../utils/mediaSrc";

const MAX_QTY = 5;

const appStore = useAppStore();
const queryDoctorId = ref(0);
const loading = ref(false);
const mutating = ref(false);
const items = ref<CartItem[]>([]);
const totalAmountCents = ref(0);

const doctorId = computed(() => {
  if (queryDoctorId.value > 0) return queryDoctorId.value;
  const fromApp = Number(appStore.doctor?.id);
  if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
  const fromSource = Number(appStore.sourceDoctorId);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  return 0;
});

const availableCount = computed(
  () => items.value.filter((it) => !it.unavailable).length
);

const totalLabel = computed(() => formatCents(totalAmountCents.value));

const returnUrl = computed(() => {
  const id = doctorId.value;
  return id
    ? `/pages/services/cart?doctorId=${encodeURIComponent(String(id))}`
    : "/pages/services/cart";
});

onLoad((query) => {
  const id = Number(query?.doctorId);
  queryDoctorId.value = Number.isFinite(id) && id > 0 ? id : 0;
});

onShow(() => {
  void load();
});

function formatCents(cents: unknown) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  const yuan = n / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function coverSrc(item: CartItem) {
  return safeLocalImageSrc(item.cover);
}

function applyCart(data: { items?: CartItem[]; totalAmountCents?: number }) {
  items.value = Array.isArray(data.items) ? data.items : [];
  totalAmountCents.value = Number(data.totalAmountCents) || 0;
}

async function load() {
  const ok = await ensureLogin(returnUrl.value);
  if (!ok) return;

  if (!appStore.doctor && appStore.sourceDoctorId) {
    try {
      await appStore.load(false, appStore.sourceDoctorId);
    } catch {
      /* 继续按已有 doctorId 拉车 */
    }
  } else if (!appStore.doctor) {
    try {
      await appStore.load(false);
    } catch {
      /* ignore */
    }
  }

  if (!doctorId.value) {
    items.value = [];
    totalAmountCents.value = 0;
    uni.showToast({ title: "请先选择服务医生", icon: "none" });
    return;
  }

  loading.value = true;
  try {
    const data = await getCart(doctorId.value);
    applyCart(data);
  } catch (e) {
    items.value = [];
    totalAmountCents.value = 0;
    uni.showToast({ title: "购物车加载失败", icon: "none" });
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function changeQty(item: CartItem, next: number) {
  if (mutating.value || item.unavailable) return;
  const qty = Math.floor(Number(next));
  if (!Number.isFinite(qty)) return;
  if (qty < 1) {
    await removeItem(item);
    return;
  }
  if (qty > MAX_QTY || qty === item.qty) return;

  mutating.value = true;
  try {
    const data = await updateCartItem(item.id, qty);
    applyCart(data);
  } catch (e: any) {
    uni.showToast({ title: e?.message || "修改失败", icon: "none" });
  } finally {
    mutating.value = false;
  }
}

async function removeItem(item: CartItem) {
  if (mutating.value) return;
  mutating.value = true;
  try {
    const data = await removeCartItem(item.id);
    applyCart(data);
  } catch (e: any) {
    uni.showToast({ title: e?.message || "删除失败", icon: "none" });
  } finally {
    mutating.value = false;
  }
}

function confirmRemove(item: CartItem) {
  uni.showModal({
    title: "删除商品",
    content: `确定从购物车移除「${item.title || "该服务包"}」？`,
    success: (res) => {
      if (res.confirm) void removeItem(item);
    },
  });
}

function goCatalog() {
  const id = doctorId.value;
  uni.navigateTo({
    url: id
      ? `/pages/services/catalog?doctorId=${encodeURIComponent(String(id))}`
      : "/pages/services/catalog",
  });
}

function goCheckout() {
  if (!doctorId.value) {
    uni.showToast({ title: "请先选择服务医生", icon: "none" });
    return;
  }
  if (!availableCount.value) {
    uni.showToast({ title: "暂无可结算商品", icon: "none" });
    return;
  }
  const unavailable = items.value.some((it) => it.unavailable);
  if (unavailable) {
    uni.showToast({ title: "已下架商品将不计入结算", icon: "none" });
  }
  uni.navigateTo({
    url: `/pages/services/checkout?from=cart&doctorId=${encodeURIComponent(String(doctorId.value))}`,
  });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="head">
      <text class="head__kicker">医生管家</text>
      <text class="head__title">购物车</text>
      <text class="head__sub">同一位服务医生的服务包可一起结算</text>
    </view>

    <view v-if="loading" class="state">正在加载购物车…</view>

    <AppEmptyState
      v-else-if="!items.length"
      :visual="''"
      title="购物车是空的"
      text="去服务包目录选购后，可在这里改数量并一起结算。"
      action-label="去服务包目录"
      action-icon="service-package"
      @action="goCatalog"
    />

    <template v-else>
      <view class="list">
        <view
          v-for="item in items"
          :key="item.id"
          class="row"
          :class="{ 'row--unavailable': item.unavailable }"
        >
          <view class="row__thumb">
            <image
              v-if="coverSrc(item)"
              class="row__cover"
              :src="coverSrc(item)"
              mode="aspectFill"
            />
            <AppIcon v-else name="service-package" :size="24" tone="primary" />
          </view>

          <view class="row__body">
            <view class="row__title-row">
              <text class="row__title">{{ item.title || "服务包" }}</text>
              <text v-if="item.unavailable" class="row__badge">已下架</text>
            </view>
            <text class="row__price">
              {{ item.unavailable ? "不可结算" : formatCents(item.unitTotalCents) }}
            </text>

            <view class="row__actions">
              <view v-if="!item.unavailable" class="stepper">
                <view
                  class="stepper__btn pressable"
                  aria-role="button"
                  aria-label="减少数量"
                  @click="changeQty(item, item.qty - 1)"
                >
                  <text class="stepper__glyph">−</text>
                </view>
                <text class="stepper__qty">{{ item.qty }}</text>
                <view
                  class="stepper__btn pressable"
                  :class="{ 'stepper__btn--disabled': item.qty >= MAX_QTY }"
                  aria-role="button"
                  aria-label="增加数量"
                  @click="changeQty(item, item.qty + 1)"
                >
                  <text class="stepper__glyph">+</text>
                </view>
              </view>
              <view v-else class="row__hint">
                <text class="row__hint-text">请删除后继续结算其他商品</text>
              </view>

              <view
                class="row__delete pressable"
                aria-role="button"
                aria-label="删除"
                @click="confirmRemove(item)"
              >
                <AppIcon name="action-clear" :size="18" tone="muted" />
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="footer">
        <view class="footer__sum">
          <text class="footer__label">合计</text>
          <text class="footer__total">{{ totalLabel }}</text>
        </view>
        <AppButton
          label="去结算"
          icon="goods-order"
          variant="primary"
          :disabled="!availableCount || mutating"
          @tap="goCheckout"
        />
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px 16px calc(100px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.head {
  margin-bottom: 12px;
}
.head__kicker {
  display: block;
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.head__title {
  display: block;
  margin-top: 4px;
  color: #17201c;
  font-size: var(--font-heading, 22px);
  font-weight: 800;
  line-height: 1.3;
}
.head__sub {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  line-height: 1.4;
}
.state {
  margin-top: 8px;
  padding: 16px 14px;
  border: 1px solid #dce3dd;
  border-radius: 14px;
  background: #fff;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
  text-align: center;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  gap: 10px;
  padding: 12px;
  border: 1px solid #dce3dd;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(16, 52, 40, 0.04);
}
.row--unavailable {
  opacity: 0.72;
  background: #f7f8f7;
}
.row__thumb {
  display: flex;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  background: #eef5f0;
}
.row__cover {
  display: block;
  width: 100%;
  height: 100%;
}
.row__body {
  min-width: 0;
  flex: 1;
}
.row__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row__title {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.row__badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3e4e2;
  color: #9b3b2e;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.row__price {
  display: block;
  margin-top: 4px;
  color: #176b52;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.row--unavailable .row__price {
  color: #8a938d;
  font-weight: 600;
}
.row__actions {
  display: flex;
  margin-top: 10px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid #dce3dd;
  border-radius: 10px;
  background: #f7faf7;
  overflow: hidden;
}
.stepper__btn {
  display: flex;
  width: 36px;
  height: 32px;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}
.stepper__btn:active {
  background: #eef5f0;
}
.stepper__btn--disabled {
  opacity: 0.4;
  pointer-events: none;
}
.stepper__glyph {
  color: #176b52;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}
.stepper__qty {
  min-width: 36px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
  text-align: center;
}
.row__hint {
  min-width: 0;
  flex: 1;
}
.row__hint-text {
  color: #8a938d;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
}
.row__delete {
  display: flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #f0f3f5;
}
.footer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid #dce3dd;
  background: #ffffff;
  box-shadow: 0 -4px 16px rgba(16, 52, 40, 0.06);
}
.footer__sum {
  min-width: 0;
  flex: 1;
}
.footer__label {
  display: block;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.footer__total {
  display: block;
  margin-top: 2px;
  color: #176b52;
  font-size: var(--font-subheading, 19px);
  font-weight: 800;
}
.elder .head__title,
.elder .row__title,
.elder .footer__total {
  font-size: var(--font-subheading, 19px);
}
.elder .head__sub,
.elder .row__price,
.elder .stepper__qty,
.elder .state {
  font-size: var(--font-secondary, 16px);
}
</style>
