<script setup lang="ts">
/**
 * 优惠权益：可领取模板 / 可用券 / 已用与过期；领取后可去服务包下单抵扣。
 */
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import AppEmptyState from "../../components/AppEmptyState.vue";
import {
  claimCoupon,
  listClaimableTemplates,
  listMyCoupons,
  redeemCouponCode,
  type Coupon,
  type CouponTemplate,
} from "../../api/servicePackage";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";

const TABS = [
  { key: "claimable", label: "可领取" },
  { key: "available", label: "可用" },
  { key: "history", label: "已用/过期" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const appStore = useAppStore();
const loading = ref(false);
const claimingId = ref(0);
const redeeming = ref(false);
const redeemCode = ref("");
const activeTab = ref<TabKey>("claimable");
const templates = ref<CouponTemplate[]>([]);
const coupons = ref<Coupon[]>([]);

const doctorId = computed(() => {
  const fromApp = Number(appStore.doctor?.id);
  if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
  const fromSource = Number(appStore.sourceDoctorId);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  return 0;
});

function isExpired(coupon: Coupon) {
  if (!coupon.expiresAt) return false;
  return String(coupon.expiresAt) < new Date().toISOString();
}

const availableCoupons = computed(() =>
  coupons.value.filter((c) => {
    if (c.status === "locked") return true;
    if (c.status !== "available") return false;
    return !isExpired(c);
  })
);

const historyCoupons = computed(() =>
  coupons.value.filter((c) => {
    if (c.status === "used" || c.status === "void") return true;
    if (c.status === "available" && isExpired(c)) return true;
    return false;
  })
);

function formatCents(cents: unknown) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  const yuan = n / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
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

function couponStatusLabel(coupon: Coupon) {
  if (coupon.status === "locked") return "下单锁定中";
  if (coupon.status === "used") return "已使用";
  if (coupon.status === "void") return "已作废";
  if (coupon.status === "available" && isExpired(coupon)) return "已过期";
  return "可用";
}

function formatExpire(expiresAt?: string | null) {
  if (!expiresAt) return "长期有效";
  const d = String(expiresAt).slice(0, 10);
  return d ? `有效期至 ${d}` : "长期有效";
}

function selectTab(key: TabKey) {
  if (activeTab.value === key) return;
  activeTab.value = key;
}

async function ensureDoctor() {
  if (!appStore.doctor && appStore.sourceDoctorId) {
    try {
      await appStore.load(false, appStore.sourceDoctorId);
    } catch {
      /* ignore */
    }
  } else if (!appStore.doctor) {
    try {
      await appStore.load(false);
    } catch {
      /* ignore */
    }
  }
}

async function load() {
  const ok = await ensureLogin("/pages/services/rights");
  if (!ok) return;

  await ensureDoctor();

  loading.value = true;
  try {
    const id = doctorId.value;
    const [mineRes, tplRes] = await Promise.all([
      listMyCoupons(),
      id
        ? listClaimableTemplates(id).catch(() => ({ templates: [] as CouponTemplate[] }))
        : Promise.resolve({ templates: [] as CouponTemplate[] }),
    ]);
    coupons.value = mineRes.coupons || [];
    templates.value = tplRes.templates || [];
  } catch (e) {
    coupons.value = [];
    templates.value = [];
    uni.showToast({ title: "加载失败", icon: "none" });
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function onClaim(tpl: CouponTemplate) {
  if (claimingId.value) return;
  claimingId.value = tpl.id;
  try {
    await claimCoupon(tpl.id);
    uni.showToast({ title: "领取成功", icon: "success" });
    activeTab.value = "available";
    await load();
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : "领取失败";
    uni.showToast({ title: msg, icon: "none" });
  } finally {
    claimingId.value = 0;
  }
}

async function onRedeem() {
  if (redeeming.value) return;
  const code = redeemCode.value.trim();
  if (!code) {
    uni.showToast({ title: "请输入兑换码", icon: "none" });
    return;
  }
  const ok = await ensureLogin("/pages/services/rights");
  if (!ok) return;
  redeeming.value = true;
  try {
    await redeemCouponCode(code);
    redeemCode.value = "";
    uni.showToast({ title: "兑换成功", icon: "success" });
    activeTab.value = "available";
    await load();
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : "兑换失败";
    uni.showToast({ title: msg, icon: "none" });
  } finally {
    redeeming.value = false;
  }
}

function goCatalog() {
  uni.navigateTo({ url: "/pages/services/catalog" });
}

onShow(() => {
  void load();
});
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="redeem">
      <text class="redeem__title">兑换码激活</text>
      <view class="redeem__row">
        <input
          v-model="redeemCode"
          class="redeem__input"
          type="text"
          maxlength="32"
          placeholder="请输入优惠券兑换码"
          placeholder-class="redeem__ph"
          :disabled="redeeming"
          :adjust-position="true"
        />
        <AppButton
          class="redeem__btn"
          :label="redeeming ? '兑换中…' : '兑换'"
          variant="primary"
          :disabled="redeeming"
          @tap="onRedeem"
        />
      </view>
    </view>

    <scroll-view class="chips" scroll-x :show-scrollbar="false">
      <view class="chips__inner">
        <view
          v-for="tab in TABS"
          :key="tab.key"
          class="chip pressable"
          :class="{ 'chip--on': activeTab === tab.key }"
          aria-role="button"
          :aria-label="tab.label"
          @click="selectTab(tab.key)"
        >
          <text class="chip__label">{{ tab.label }}</text>
        </view>
      </view>
    </scroll-view>

    <view v-if="loading" class="state">加载中…</view>

    <template v-else-if="activeTab === 'claimable'">
      <AppEmptyState
        v-if="!doctorId"
        :visual="''"
        title="请先选择服务医生"
        text="进入医生服务场景后，可在此领取该医生发放的优惠券。"
        action-label="查看服务包"
        action-icon="service-package"
        @action="goCatalog"
      />
      <AppEmptyState
        v-else-if="!templates.length"
        :visual="''"
        title="暂无可领优惠券"
        text="当前医生暂无可领取优惠券。您仍可浏览服务包并完成购买。"
        action-label="查看服务包"
        action-icon="service-package"
        @action="goCatalog"
      />
      <view v-else class="list">
        <view v-for="tpl in templates" :key="tpl.id" class="card">
          <view class="card__row">
            <view class="card__main">
              <text class="title">{{ tpl.title }}</text>
              <text class="benefit">{{ templateBenefit(tpl) }}</text>
              <text class="sub">{{ formatExpire(tpl.endsAt) }}</text>
            </view>
            <AppButton
              class="claim-btn"
              label="领取"
              variant="primary"
              :disabled="claimingId === tpl.id"
              @tap="onClaim(tpl)"
            />
          </view>
        </view>
      </view>
    </template>

    <template v-else-if="activeTab === 'available'">
      <AppEmptyState
        v-if="!availableCoupons.length"
        :visual="''"
        title="暂无可用优惠券"
        text="权益到账后会出现在本页，可在下单时抵扣。可先领取或浏览服务包。"
        action-label="查看服务包"
        action-icon="service-package"
        @action="goCatalog"
      />
      <view v-else class="list">
        <view v-for="coupon in availableCoupons" :key="coupon.id" class="card">
          <view class="card__row">
            <view class="card__main">
              <text class="title">{{ couponTitle(coupon) }}</text>
              <text class="benefit">{{ templateBenefit(coupon.template) }}</text>
              <text class="sub">{{ couponStatusLabel(coupon) }} · {{ formatExpire(coupon.expiresAt) }}</text>
            </view>
            <text class="badge badge--ok">可用</text>
          </view>
        </view>
        <view class="hint-card">
          <text class="hint">下单结算时可选择优惠券抵扣；仅限对应医生已上架服务包。</text>
          <AppButton
            class="hint-btn"
            label="去服务包"
            icon="service-package"
            variant="soft"
            @tap="goCatalog"
          />
        </view>
      </view>
    </template>

    <template v-else>
      <AppEmptyState
        v-if="!historyCoupons.length"
        :visual="''"
        title="暂无已用或过期券"
        text="使用或过期后的优惠券会显示在这里。"
        action-label="查看服务包"
        action-icon="service-package"
        @action="goCatalog"
      />
      <view v-else class="list">
        <view v-for="coupon in historyCoupons" :key="coupon.id" class="card card--muted">
          <view class="card__row">
            <view class="card__main">
              <text class="title">{{ couponTitle(coupon) }}</text>
              <text class="benefit">{{ templateBenefit(coupon.template) }}</text>
              <text class="sub">{{ couponStatusLabel(coupon) }} · {{ formatExpire(coupon.expiresAt) }}</text>
            </view>
            <text class="badge">{{ couponStatusLabel(coupon) }}</text>
          </view>
        </view>
      </view>
    </template>

    <view class="rules">
      <text class="rules__title">使用说明</text>
      <text class="rules__item">1. 可输入兑换码激活优惠券，或领取医生已上架的可领券。</text>
      <text class="rules__item">2. 优惠券仅可用于对应医生已上架的服务包。</text>
      <text class="rules__item">3. 下单结算页将展示可用券；退款时未核销权益按订单规则处理。</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px 16px calc(28px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.redeem {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
}
.redeem__title {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.redeem__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.redeem__input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid #dce3dd;
  border-radius: 10px;
  background: #fafcfa;
  color: #17201c;
  font-size: 16px;
  line-height: 44px;
}
.redeem__ph {
  color: #9aa69e;
  font-size: 15px;
  line-height: 1.4;
}
.redeem__btn {
  flex-shrink: 0;
  min-width: 76px;
}
.chips {
  margin-bottom: 8px;
  white-space: nowrap;
}
.chips__inner {
  display: inline-flex;
  gap: 8px;
  padding: 2px 0 6px;
}
.chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 7px 14px;
  border: 1px solid #dce3dd;
  border-radius: 999px;
  background: #ffffff;
}
.chip--on {
  border-color: #176b52;
  background: #176b52;
}
.chip__label {
  color: #2a3547;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
  line-height: 1.3;
}
.chip--on .chip__label {
  color: #ffffff;
}
.state {
  padding: 24px;
  color: #6a756f;
  text-align: center;
  font-size: var(--font-body, 18px);
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
}
.card--muted {
  opacity: 0.85;
}
.card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.card__main {
  flex: 1;
  min-width: 0;
}
.title {
  display: block;
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
  line-height: 1.35;
}
.benefit {
  display: block;
  margin-top: 4px;
  color: #176b52;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.sub {
  display: block;
  margin-top: 6px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
.claim-btn {
  flex-shrink: 0;
  min-width: 72px;
}
.badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: #e8ece9;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.badge--ok {
  background: #e7f5ef;
  color: #176b52;
}
.hint-card {
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
}
.hint {
  display: block;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}
.hint-btn {
  margin-top: 10px;
}
.rules {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
}
.rules__title {
  display: block;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 800;
}
.rules__item {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.55;
}
.elder .title,
.elder .benefit {
  font-size: var(--font-subheading, 19px);
}
</style>
