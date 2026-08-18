<script setup lang="ts">
/**
 * 服务包详情：真实字段 + 立即购买（登录门控）
 */
import { computed, ref } from "vue";
import { onLoad, onShareAppMessage } from "@dcloudio/uni-app";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useServiceAssetsStore } from "../../stores/serviceAssets";
import { useAppStore } from "../../stores/app";
import { useConsultationStore } from "../../stores/consultation";
import { addCartItem, getServiceProduct, type SaleSku, type ServiceProduct } from "../../api/servicePackage";
import { ensureLogin } from "../../utils/ensureLogin";
import { safeLocalImageSrc } from "../../utils/mediaSrc";
import { launchChunyu } from "../../api/chunyuOpen";

const serviceAssets = useServiceAssetsStore();
const appStore = useAppStore();
const consultation = useConsultationStore();
const productId = ref("");
const remote = ref<ServiceProduct | null>(null);
const selectedSku = ref<SaleSku | null>(null);
const loading = ref(false);
const favorited = ref(false);

const ICON_HEART = "/static/service-ui/health-heart.png";
const ICON_DOCTOR = "/static/service-ui/doctor.png";
const ICON_CHECK = "/static/service-ui/check.png";
const ICON_WARN = "/static/service-ui/warning.png";
const ICON_BELL = "/static/service-ui/bell.png";
const ICON_TREND = "/static/service-ui/trend.png";
const ICON_CART = "/static/service-ui/cart.png";
const ICON_CHECKLIST = "/static/service-ui/checklist.png";
const ICON_SHIELD = "/static/service-ui/shield.png";
const ICON_USER = "/static/service-ui/user-outline.png";
const ICON_REPORT = "/static/service-ui/report.png";
const ICON_BUTLER = "/static/service-ui/butler.png";

const PROCESS_STEPS = [
  { label: "购买", icon: ICON_CART },
  { label: "填写资料", icon: ICON_CHECKLIST },
  { label: "审核开通", icon: ICON_SHIELD },
  { label: "开始服务", icon: ICON_USER },
] as const;

onLoad(async (query) => {
  productId.value = String(query?.id || "");
  void serviceAssets.loadCenter();
  if (!productId.value) return;
  loading.value = true;
  try {
    remote.value = await getServiceProduct(productId.value);
    selectedSku.value = remote.value.skus?.[0] || null;
  } catch {
    remote.value = null;
  } finally {
    loading.value = false;
  }
});

const product = computed(() => {
  if (remote.value) return remote.value as Record<string, any>;
  const id = productId.value;
  if (!id) return null;
  return (
    serviceAssets.center?.products?.find(
      (p) => String((p as { key?: string; id?: string | number }).key ?? (p as { id?: string | number }).id ?? "") === id
    ) || null
  );
});

const detail = computed<Record<string, any>>(() => {
  const base = (product.value as any) || {};
  const sku = selectedSku.value;
  return sku ? { ...base, serviceDays: sku.cycleDays, totalAmount: sku.salePriceCents / 100 } : base;
});

onShareAppMessage(() => ({
  title: String(detail.value.title || "春雨健康服务"),
  path: appStore.buildSharePath(`/pages/services/detail?id=${encodeURIComponent(productId.value)}`),
}));

const doctorName = computed(() => detail.value.doctorName || appStore.doctor?.name || "");
const doctorHospital = computed(() => detail.value.doctorHospital || appStore.doctor?.hospital || "");
const coverSrc = computed(() => safeLocalImageSrc(detail.value.cover));
const canBuy = computed(() => !!product.value && !!selectedSku.value);

const categoryLabel = computed(() => {
  const raw = String(detail.value.category || detail.value.tone || "").trim();
  if (/慢病|chronic/i.test(raw)) return "慢病管理";
  if (/术后|康复|rehab|postop/i.test(raw)) return "术后康复";
  if (/用药|med/i.test(raw)) return "用药指导";
  if (/营养|nutrition/i.test(raw)) return "营养调理";
  return "健康服务";
});

const eligibleList = computed(() => formatList(detail.value.eligible));
const warnText = computed(() => {
  const ineligible = formatList(detail.value.ineligible);
  if (ineligible.length) return ineligible[0];
  return "急重症或不适加重时请立即线下就医，本服务不替代急诊诊疗。";
});

const includeRows = computed(() => {
  const componentRows = selectedSku.value?.componentSummary?.map((item) => ({
    title: item.name,
    meta: `${item.quantity} 项 · ${item.providerName || "服务方"}`,
    icon: item.type === "GOODS_SKU" ? ICON_CART : item.type === "BENEFIT_SKU" ? ICON_SHIELD : ICON_BUTLER,
  })) || [];
  if (componentRows.length) return componentRows;
  const contents = formatList(detail.value.contents);
  const assessments = formatList(detail.value.assessments);
  const icons = [ICON_BUTLER, ICON_BELL, ICON_TREND, ICON_WARN, ICON_CHECKLIST];
  const rows = [...contents, ...assessments].slice(0, 6).map((title, i) => ({
    title,
    meta: i === 0 ? "服务期内" : "按计划执行",
    icon: icons[i % icons.length],
  }));
  if (rows.length) return rows;
  return [
    { title: "医生随访", meta: "服务期内", icon: ICON_BUTLER },
    { title: "用药提醒", meta: "按医嘱", icon: ICON_BELL },
    { title: "健康记录", meta: "持续跟踪", icon: ICON_TREND },
    { title: "异常提醒", meta: "及时关注", icon: ICON_WARN },
  ];
});

const noticeSub = computed(() => {
  const days = Number(detail.value.serviceDays);
  const cycle = Number.isFinite(days) && days > 0 ? `服务周期 ${days} 天` : "服务周期以开通后起算";
  return `${cycle}，购买后需完成健康资料`;
});

function formatYuan(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function formatList(list: unknown): string[] {
  return Array.isArray(list) ? list.map((x) => String(x)).filter(Boolean) : [];
}

function openServices() {
  uni.navigateBack({ fail: () => uni.navigateTo({ url: "/pages/services/index" }) });
}

async function buy() {
  if (!productId.value || !selectedSku.value) return;
  const returnUrl = `/pages/services/checkout?id=${encodeURIComponent(productId.value)}&skuId=${selectedSku.value.skuId}`;
  const ok = await ensureLogin(returnUrl);
  if (!ok) return;
  uni.navigateTo({ url: returnUrl });
}

function selectSku(sku: SaleSku) {
  selectedSku.value = sku;
}

async function addToCart() {
  if (!selectedSku.value) return;
  const doctorId = Number(detail.value.doctorId || appStore.doctor?.id || appStore.sourceDoctorId);
  if (!doctorId) return uni.showToast({ title: "缺少医生信息", icon: "none" });
  const ok = await ensureLogin(`/pages/services/detail?id=${encodeURIComponent(productId.value)}`);
  if (!ok) return;
  await addCartItem({ skuId: selectedSku.value.skuId, doctorId, qty: 1 });
  uni.showToast({ title: "已加入购物车", icon: "success" });
}

function toggleFavorite() {
  favorited.value = !favorited.value;
  uni.showToast({ title: favorited.value ? "已收藏" : "已取消收藏", icon: "none" });
}

function openNotice() {
  const text = String(detail.value.refundPolicy || noticeSub.value);
  uni.showModal({
    title: "购买须知",
    content: text.slice(0, 500),
    showCancel: false,
  });
}

function consult() {
  const title = String(detail.value.title || "服务包");
  consultation.applyEntryContext(
    `来自服务包详情「${title}」：请协助了解适用人群、开通流程与售后规则。`,
    "life"
  );
  uni.switchTab({ url: "/pages/consult/index" });
}

async function openConsultDoctor() {
  const ok = await ensureLogin(`/pages/services/detail?id=${encodeURIComponent(productId.value)}`);
  if (!ok) return;
  await launchChunyu("graph", { text: `来自服务包「${detail.value.title || ""}」，需要执业医生问诊。` });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view v-if="loading && !product" class="state">加载中…</view>

    <AppEmptyState
      v-else-if="!product"
      :visual="''"
      title="服务包筹备中"
      text="该医生的服务包尚未上架，上线后可在本页查看详情。"
      action-label="返回健康服务"
      action-icon="nav-back"
      @action="openServices"
    />

    <template v-else>
      <scroll-view scroll-y class="scroll">
        <view class="hero-card">
          <view class="hero-card__main">
            <text class="hero-card__tag">{{ categoryLabel }}</text>
            <text class="hero-card__title">{{ detail.title }}</text>
            <text v-if="detail.desc || detail.subtitle" class="hero-card__desc">
              {{ detail.desc || detail.subtitle }}
            </text>
            <view class="hero-card__doctor">
              <image class="hero-card__doctor-icon" :src="ICON_DOCTOR" mode="aspectFit" />
              <text class="hero-card__doctor-text">
                {{ doctorName ? `${doctorName}医生` : "服务医生" }}{{ doctorHospital ? ` · ${doctorHospital}` : "" }}
              </text>
            </view>
            <view class="hero-card__price-row">
              <text class="hero-card__price">¥ {{ formatYuan(detail.totalAmount) }}</text>
              <text class="hero-card__price-hint pressable" aria-role="button" @click.stop="openConsultDoctor">服务费用，问诊费用另计 · 去问诊</text>
            </view>
          </view>
          <view class="hero-card__visual">
            <image
              v-if="coverSrc"
              class="hero-card__cover"
              :src="coverSrc"
              mode="aspectFill"
            />
            <image v-else class="hero-card__heart" :src="ICON_HEART" mode="aspectFit" />
          </view>
        </view>

        <view v-if="remote?.skus?.length" class="card">
          <text class="card__title">选择服务规格</text>
          <view class="sku-options">
            <view v-for="sku in remote.skus" :key="sku.skuId" class="sku-option" :class="{ 'sku-option--active': selectedSku?.skuId === sku.skuId }" @click="selectSku(sku)">
              <text class="sku-option__name">{{ sku.name }}</text>
              <text class="sku-option__meta">{{ sku.cycleDays }} 天 · ¥{{ formatYuan(sku.salePriceCents / 100) }}</text>
            </view>
          </view>
        </view>

        <view v-if="eligibleList.length" class="card">
          <text class="card__title">适合谁</text>
          <view v-for="(item, i) in eligibleList" :key="`e${i}`" class="eligible-row">
            <image class="eligible-row__icon" :src="ICON_CHECK" mode="aspectFit" />
            <text class="eligible-row__text">{{ item }}</text>
          </view>
          <view class="warn-box">
            <image class="warn-box__icon" :src="ICON_WARN" mode="aspectFit" />
            <text class="warn-box__text">{{ warnText }}</text>
          </view>
        </view>

        <view class="card">
          <text class="card__title">服务包含</text>
          <view v-for="(row, i) in includeRows" :key="`c${i}`" class="include-row">
            <image class="include-row__icon" :src="row.icon" mode="aspectFit" />
            <text class="include-row__title">{{ row.title }}</text>
            <text class="include-row__meta">{{ row.meta }}</text>
          </view>
        </view>

        <view class="card">
          <text class="card__title">服务流程</text>
          <view class="process">
            <view v-for="(step, i) in PROCESS_STEPS" :key="step.label" class="process__item">
              <view class="process__dot">
                <image class="process__icon" :src="step.icon" mode="aspectFit" />
              </view>
              <text class="process__label">{{ step.label }}</text>
              <view v-if="i < PROCESS_STEPS.length - 1" class="process__line" />
            </view>
          </view>
        </view>

        <view class="notice-card pressable" aria-role="button" @click="openNotice">
          <image class="notice-card__icon" :src="ICON_REPORT" mode="aspectFit" />
          <view class="notice-card__copy">
            <text class="notice-card__title">购买须知</text>
            <text class="notice-card__sub">{{ noticeSub }}</text>
          </view>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>

        <view class="consult-link pressable" aria-role="button" @click="openConsultDoctor">
          <text>问诊费用另计，点击连接春雨执业医生</text>
        </view>
        <view class="consult-link pressable" aria-role="button" @click="consult">
          <text>有疑问？问问健康助手</text>
        </view>
        <view class="scroll-spacer" />
      </scroll-view>

      <view class="footer">
        <view class="footer__fav pressable" aria-role="button" @click="toggleFavorite">
          <text class="footer__star">{{ favorited ? "★" : "☆" }}</text>
          <text class="footer__fav-text">收藏</text>
        </view>
        <text class="footer__price">¥ {{ formatYuan(detail.totalAmount) }}</text>
        <view class="footer__cart pressable" :class="{ 'footer__buy--disabled': !canBuy }" @click="canBuy && addToCart()">加入购物车</view>
        <view
          class="footer__buy pressable"
          :class="{ 'footer__buy--disabled': !canBuy }"
          aria-role="button"
          @click="canBuy ? buy() : openServices()"
        >
          <text>{{ canBuy ? "立即购买" : "返回服务" }}</text>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  background: #f5f7f6;
}
.state {
  padding: 48px 16px;
  color: #6a756f;
  text-align: center;
}
.sku-options{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.sku-option{min-width:132px;padding:12px;border:1px solid #dce5df;border-radius:10px;display:flex;flex-direction:column;gap:5px}.sku-option--active{border-color:#248b5a;background:#eef8f2}.sku-option__name{font-weight:600;color:#22332a}.sku-option__meta{font-size:12px;color:#68786f}
.scroll {
  height: calc(100vh - 72px - env(safe-area-inset-bottom));
  padding: 12px 16px 0;
  box-sizing: border-box;
}
.hero-card,
.card,
.notice-card {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.hero-card {
  display: flex;
  gap: 12px;
  align-items: stretch;
}
.hero-card__main {
  min-width: 0;
  flex: 1;
}
.hero-card__tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eef2ef;
  color: #6a756f;
  font-size: 12px;
  font-weight: 600;
}
.hero-card__title {
  display: block;
  margin-top: 10px;
  color: #0f3d2e;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.35;
}
.hero-card__desc {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: 13px;
  line-height: 1.5;
}
.hero-card__doctor {
  display: flex;
  margin-top: 12px;
  align-items: center;
  gap: 6px;
}
.hero-card__doctor-icon {
  width: 18px;
  height: 18px;
}
.hero-card__doctor-text {
  color: #44524b;
  font-size: 13px;
}
.hero-card__price-row {
  margin-top: 14px;
}
.hero-card__price {
  display: block;
  color: #176b52;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.1;
}
.hero-card__price-hint {
  display: block;
  margin-top: 4px;
  color: #9aa49d;
  font-size: 12px;
}
.hero-card__visual {
  display: flex;
  width: 96px;
  height: 96px;
  flex: 0 0 auto;
  align-self: center;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  background: #e8f5ee;
}
.hero-card__cover,
.hero-card__heart {
  width: 56px;
  height: 56px;
}
.hero-card__cover {
  width: 100%;
  height: 100%;
}
.card__title {
  display: block;
  margin-bottom: 12px;
  color: #0f3d2e;
  font-size: 17px;
  font-weight: 800;
}
.eligible-row {
  display: flex;
  margin-bottom: 10px;
  align-items: flex-start;
  gap: 8px;
}
.eligible-row__icon {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex: 0 0 auto;
}
.eligible-row__text {
  flex: 1;
  color: #17201c;
  font-size: 14px;
  line-height: 1.5;
}
.warn-box {
  display: flex;
  margin-top: 6px;
  padding: 10px 12px;
  align-items: flex-start;
  gap: 8px;
  border-radius: 10px;
  background: #fff4e8;
}
.warn-box__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-top: 1px;
}
.warn-box__text {
  flex: 1;
  color: #a35a1a;
  font-size: 13px;
  line-height: 1.45;
}
.include-row {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #eef2ef;
}
.include-row:last-child {
  border-bottom: 0;
}
.include-row__icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}
.include-row__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 14px;
  font-weight: 600;
}
.include-row__meta {
  color: #8a938d;
  font-size: 12px;
}
.process {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.process__item {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
}
.process__dot {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f5ee;
}
.process__icon {
  width: 22px;
  height: 22px;
}
.process__label {
  margin-top: 8px;
  color: #44524b;
  font-size: 12px;
  font-weight: 600;
}
.process__line {
  position: absolute;
  top: 22px;
  left: calc(50% + 26px);
  width: calc(100% - 52px);
  border-top: 1px dashed #c9d7cf;
}
.notice-card {
  display: flex;
  align-items: center;
  gap: 10px;
}
.notice-card__icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}
.notice-card__copy {
  min-width: 0;
  flex: 1;
}
.notice-card__title {
  display: block;
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
}
.notice-card__sub {
  display: block;
  margin-top: 3px;
  color: #8a938d;
  font-size: 12px;
  line-height: 1.4;
}
.consult-link {
  margin: 4px 0 8px;
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.scroll-spacer {
  height: 20px;
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
.footer__fav {
  display: flex;
  width: 40px;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.footer__star {
  color: #176b52;
  font-size: 20px;
  line-height: 1;
}
.footer__fav-text {
  color: #6a756f;
  font-size: 11px;
}
.footer__price {
  color: #176b52;
  font-size: 22px;
  font-weight: 800;
}
.footer__buy {
  margin-left: auto;
  min-width: 140px;
  padding: 12px 22px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
.footer__cart{margin-left:auto;padding:11px 14px;border:1px solid #176b52;border-radius:999px;color:#176b52;font-size:13px;font-weight:700}.footer__cart+.footer__buy{margin-left:0;min-width:88px}
.footer__buy--disabled {
  opacity: 0.55;
}
.elder .hero-card__title,
.elder .card__title {
  font-size: 20px;
}
</style>
