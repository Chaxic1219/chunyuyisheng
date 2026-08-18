<script setup lang="ts">
/**
 * 医生服务包目录：当前接诊医生下全部上架服务包。
 */
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { listServiceProducts, type ServiceProduct } from "../../api/servicePackage";
import { getMpToken } from "../../api/auth";
import { getMyDoctors, type ConsultingDoctor } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import { safeLocalImageSrc } from "../../utils/mediaSrc";

type DoctorOption = {
  doctorId: number;
  doctorName: string;
  title: string;
  dept: string;
  hospital: string;
};

const CATEGORIES = [
  { key: "", label: "全部" },
  { key: "rehab", label: "康复管理" },
  { key: "followup", label: "复诊随访" },
  { key: "other", label: "其他" },
] as const;

const FEATURES = ["医生团队服务", "进度可追踪", "随时问助手"] as const;
const ICON_DOCTOR = "/static/service-ui/doctor.png";
const ICON_EMPTY = "/static/service-ui/butler.png";

const appStore = useAppStore();
const auth = useAuthStore();
const loading = ref(false);
const switching = ref(false);
const error = ref("");
const products = ref<ServiceProduct[]>([]);
const activeCategory = ref("");
const doctorOptions = ref<DoctorOption[]>([]);
const profileFallback = ref<DoctorOption | null>(null);
const catalogDoctor = ref<DoctorOption | null>(null);
const pickerOpen = ref(false);

const selectedDoctorId = computed(() => {
  const fromApp = Number(appStore.doctor?.id);
  if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
  const fromSession = Number(auth.sessionDoctorId);
  if (Number.isFinite(fromSession) && fromSession > 0) return fromSession;
  const fromSource = Number(appStore.sourceDoctorId);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  return 0;
});

const activeDoctor = computed((): DoctorOption | null => {
  const id = selectedDoctorId.value;
  if (!id) return null;
  if (
    appStore.doctor?.name &&
    Number(appStore.doctor?.id) === id
  ) {
    return {
      doctorId: id,
      doctorName: appStore.doctor.name,
      title: String(appStore.doctor.title || ""),
      dept: String(appStore.doctor.dept || ""),
      hospital: String(appStore.doctor.hospital || ""),
    };
  }
  const fromList = doctorOptions.value.find((d) => d.doctorId === id);
  if (fromList) return fromList;
  if (profileFallback.value?.doctorId === id) return profileFallback.value;
  if (catalogDoctor.value?.doctorId === id) return catalogDoctor.value;
  return null;
});

const doctorId = computed(() => selectedDoctorId.value);
const doctorName = computed(() => activeDoctor.value?.doctorName || "");
const doctorHospital = computed(() => activeDoctor.value?.hospital || "");
const isLoggedIn = computed(() => !!getMpToken());
const canSwitchDoctor = computed(() => isLoggedIn.value);
const doctorInitial = computed(() => {
  const name = doctorName.value.trim();
  return name ? name.slice(0, 1) : "";
});
const doctorDisplayName = computed(() =>
  doctorName.value ? `${doctorName.value}医生` : "当前接诊医生"
);
const doctorTitle = computed(() => {
  const d = activeDoctor.value;
  if (!d) return "";
  const title = String(d.title || "").trim();
  const dept = String(d.dept || "").trim();
  if (title && dept) return `${title} · ${dept}`;
  return title || dept || "";
});
const doctorHint = computed(() => {
  if (doctorName.value) return canSwitchDoctor.value ? "点击可切换医生" : "";
  if (loading.value || switching.value) return "正在加载医生信息…";
  if (!isLoggedIn.value) return "登录后查看专属服务包";
  return "点击选择接诊医生";
});

const emptyHint = computed(() => {
  if (doctorName.value) {
    return `${doctorName.value}医生的服务包正在筹备，上线后会出现在这里。`;
  }
  return "服务包筹备中，上线后会出现在这里。";
});

const filteredProducts = computed(() => {
  const key = activeCategory.value;
  if (!key) return products.value;
  return products.value.filter((product) => matchesCategory(product, key));
});

function matchesCategory(product: ServiceProduct, key: string) {
  const cat = String(product.category || "").trim();
  if (cat) return cat === key;
  const text = `${product.title || ""} ${product.scene || ""} ${product.subtitle || ""} ${product.desc || ""}`;
  if (key === "rehab") return /康复|骨折|术后/.test(text);
  if (key === "followup") return /随访|复诊/.test(text);
  if (key === "other") return !/康复|骨折|术后|随访|复诊/.test(text);
  return true;
}

function cycleDays(product: ServiceProduct) {
  const fromSku = product.skus?.[0]?.cycleDays;
  if (fromSku && fromSku > 0) return fromSku;
  if (product.serviceDays && product.serviceDays > 0) return product.serviceDays;
  return 0;
}

function coverBadge(product: ServiceProduct) {
  const days = cycleDays(product);
  if (days >= 90) return `${days}天康复`;
  if (days >= 30) return `${days}天体验`;
  if (days > 0) return `${days}天`;
  return "";
}

function productTags(product: ServiceProduct) {
  const tags: string[] = [];
  const days = cycleDays(product);
  if (days > 0) tags.push(`${days}天`);

  const comps = product.skus?.[0]?.componentSummary || product.skus?.[0]?.components || [];
  const hasBenefit = comps.some((c) => c.type === "BENEFIT_SKU");
  const hasOps = comps.some((c) => c.type === "OPS_SERVICE_TEMPLATE");
  const hasGoods = comps.some((c) => c.type === "GOODS_SKU");

  if (hasBenefit) tags.push(days >= 90 ? "医生权益" : "在线权益");
  if (hasOps) tags.push(days >= 90 ? "康复指导" : "自动提醒");
  if (hasGoods) tags.push("居家用品");

  const title = product.title || "";
  if (title.includes("体验")) {
    if (!tags.includes("在线权益")) tags.push("在线权益");
    if (!tags.includes("自动提醒")) tags.push("自动提醒");
  }
  if (title.includes("康复") || title.includes("骨折")) {
    if (!tags.includes("医生权益")) tags.push("医生权益");
    if (!tags.includes("康复指导")) tags.push("康复指导");
    if (!tags.includes("居家用品")) tags.push("居家用品");
  }

  return [...new Set(tags)].slice(0, 4);
}

function formatPrice(product: ServiceProduct) {
  if (product.totalAmount == null || Number.isNaN(Number(product.totalAmount))) return "价格待定";
  const n = Number(product.totalAmount);
  return Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`;
}

function productKey(product: ServiceProduct) {
  return String(product.key || product.id || product.versionId || product.productId || "");
}

function coverSrc(product: ServiceProduct) {
  return safeLocalImageSrc(product.cover);
}

function selectCategory(key: string) {
  activeCategory.value = key;
}

function mapDoctorRows(rows: ConsultingDoctor[]): DoctorOption[] {
  return rows
    .map((row) => ({
      doctorId: Number(row.doctorId),
      doctorName: row.doctorName || "服务医生",
      title: row.title || "",
      dept: row.dept || "",
      hospital: row.hospital || "",
    }))
    .filter((row) => Number.isFinite(row.doctorId) && row.doctorId > 0);
}

async function refreshDoctorOptions() {
  if (!getMpToken()) {
    doctorOptions.value = [];
    return;
  }
  doctorOptions.value = mapDoctorRows(await getMyDoctors().catch(() => []));
}

async function ensureDoctorBootstrap() {
  const targetId = selectedDoctorId.value || Number(appStore.sourceDoctorId) || undefined;
  const currentId = Number(appStore.doctor?.id);
  const nameMissing = !String(appStore.doctor?.name || "").trim();
  const idMismatch = Number(targetId) > 0 && currentId !== Number(targetId);
  if (!appStore.doctor || nameMissing || idMismatch) {
    try {
      await appStore.load(true, targetId);
    } catch (e) {
      console.error(e);
    }
  }
}

async function resolveProfileFallback() {
  if (doctorName.value) return;
  const id = selectedDoctorId.value;
  if (!id) return;
  await refreshDoctorOptions();
  const hit = doctorOptions.value.find((d) => d.doctorId === id);
  if (hit) profileFallback.value = hit;
}

function resolveDoctorFromProducts(rows: ServiceProduct[]) {
  if (doctorName.value) return;
  const id = selectedDoctorId.value;
  const hit = rows.find((row) => {
    const rowDoctorId = Number(row.doctorId);
    return row.doctorName && (!id || !Number.isFinite(rowDoctorId) || rowDoctorId === id);
  });
  if (!hit?.doctorName) return;
  catalogDoctor.value = {
    doctorId: id || Number(hit.doctorId) || 0,
    doctorName: hit.doctorName,
    title: "",
    dept: "",
    hospital: hit.doctorHospital || "",
  };
}

async function load() {
  await ensureDoctorBootstrap();
  await refreshDoctorOptions();
  await resolveProfileFallback();

  loading.value = true;
  error.value = "";
  try {
    if (!doctorId.value) {
      products.value = [];
      catalogDoctor.value = null;
      return;
    }
    const data = await listServiceProducts({ doctorId: doctorId.value });
    products.value = Array.isArray(data.products) ? data.products : [];
    resolveDoctorFromProducts(products.value);
  } catch (e) {
    error.value = "服务包加载失败，请稍后重试";
    products.value = [];
    catalogDoctor.value = null;
    console.error(e);
  } finally {
    loading.value = false;
  }
}

onShow(() => {
  void load();
});

function openDetail(product: ServiceProduct) {
  const id = productKey(product);
  if (!id) return;
  uni.navigateTo({
    url: `/pages/services/detail?id=${encodeURIComponent(id)}`,
  });
}

async function openMine() {
  const ok = await ensureLogin("/pages/services/mine-services");
  if (!ok) return;
  uni.navigateTo({ url: "/pages/services/mine-services" });
}

async function openCart() {
  const id = doctorId.value;
  const url = id
    ? `/pages/services/cart?doctorId=${encodeURIComponent(String(id))}`
    : "/pages/services/cart";
  const ok = await ensureLogin(url);
  if (!ok) return;
  uni.navigateTo({ url });
}

function openServices() {
  uni.navigateTo({ url: "/pages/services/index" });
}

function openConsult() {
  uni.switchTab({ url: "/pages/consult/index" });
}

function closeDoctorPicker() {
  pickerOpen.value = false;
}

function doctorSubline(option: DoctorOption) {
  return [option.dept, option.hospital].filter(Boolean).join(" · ");
}

function openSelectDoctorPage() {
  uni.navigateTo({
    url: `/pages/auth/select-doctor?returnUrl=${encodeURIComponent("/pages/services/catalog")}`,
  });
}

async function selectDoctor(option: DoctorOption) {
  if (switching.value) return;
  if (option.doctorId === selectedDoctorId.value && doctorName.value) {
    closeDoctorPicker();
    return;
  }
  switching.value = true;
  try {
    appStore.setSourceFromQuery({ doctorId: String(option.doctorId) });
    appStore.rememberDoctorId(option.doctorId);
    await appStore.load(true, option.doctorId);
    if (getMpToken() && auth.phoneBound && auth.sessionDoctorId !== option.doctorId) {
      try {
        await auth.silentLogin(option.doctorId, { claimDoctor: true });
      } catch (e) {
        console.error(e);
      }
    }
    profileFallback.value = option;
    closeDoctorPicker();
    await load();
  } catch (e) {
    console.error(e);
    uni.showToast({ title: "切换医生失败，请重试", icon: "none" });
  } finally {
    switching.value = false;
  }
}

async function openDoctorPanel() {
  if (!isLoggedIn.value) {
    const ok = await ensureLogin("/pages/services/catalog");
    if (ok) void load();
    return;
  }
  await refreshDoctorOptions();
  if (!doctorOptions.value.length) {
    openSelectDoctorPage();
    return;
  }
  if (doctorOptions.value.length === 1 && !doctorName.value) {
    await selectDoctor(doctorOptions.value[0]);
    return;
  }
  pickerOpen.value = true;
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="catalog-hero">
      <view
        class="catalog-hero__head pressable"
        :class="{ 'catalog-hero__head--interactive': canSwitchDoctor }"
        aria-role="button"
        @click="openDoctorPanel"
      >
        <view class="catalog-hero__avatar" :class="{ 'catalog-hero__avatar--live': !!doctorInitial }">
          <text v-if="doctorInitial" class="catalog-hero__initial">{{ doctorInitial }}</text>
          <image v-else class="catalog-hero__avatar-img" :src="ICON_DOCTOR" mode="aspectFit" />
        </view>
        <view class="catalog-hero__info">
          <view class="catalog-hero__title-row">
            <text class="catalog-hero__title">{{ doctorDisplayName }}</text>
            <text v-if="doctorName" class="catalog-hero__badge">专属</text>
          </view>
          <text v-if="doctorTitle" class="catalog-hero__meta">{{ doctorTitle }}</text>
          <text v-if="doctorHospital" class="catalog-hero__meta">{{ doctorHospital }}</text>
          <text v-if="doctorHint" class="catalog-hero__hint">{{ doctorHint }}</text>
        </view>
        <AppIcon v-if="canSwitchDoctor" name="nav-chevron-right" :size="18" tone="muted" />
      </view>

      <view class="catalog-hero__actions">
        <view class="hero-action pressable" aria-role="button" @click.stop="openMine">
          <AppIcon name="health-record" :size="18" tone="primary" />
          <text class="hero-action__label">我的服务</text>
        </view>
        <view class="hero-action pressable" aria-role="button" @click.stop="openCart">
          <AppIcon name="goods-order" :size="18" tone="primary" />
          <text class="hero-action__label">购物车</text>
        </view>
      </view>

      <view class="catalog-hero__features">
        <text v-for="(item, idx) in FEATURES" :key="item" class="catalog-hero__feature">
          <text v-if="idx > 0" class="catalog-hero__dot">·</text>{{ item }}
        </text>
      </view>
    </view>

    <scroll-view class="chips" scroll-x :show-scrollbar="false">
      <view class="chips__inner">
        <view
          v-for="cat in CATEGORIES"
          :key="cat.key || 'all'"
          class="chip pressable"
          :class="{ 'chip--on': activeCategory === cat.key }"
          aria-role="button"
          @click="selectCategory(cat.key)"
        >
          <text class="chip__label">{{ cat.label }}</text>
        </view>
      </view>
    </scroll-view>

    <view v-if="loading" class="skeleton-list">
      <view v-for="n in 2" :key="n" class="skeleton-card">
        <view class="skeleton-card__cover shimmer" />
        <view class="skeleton-card__body">
          <view class="skeleton-line shimmer" />
          <view class="skeleton-line skeleton-line--short shimmer" />
        </view>
      </view>
    </view>

    <view v-else-if="error" class="pressable state state--error" aria-role="button" @click="load">
      {{ error }}（点击重试）
    </view>

    <view v-else-if="!filteredProducts.length" class="empty">
      <image class="empty__visual" :src="ICON_EMPTY" mode="aspectFit" />
      <text class="empty__title">暂无上架服务包</text>
      <text class="empty__text">{{ emptyHint }}</text>
      <view class="empty__actions">
        <AppButton label="返回服务台" icon="nav-back" variant="primary" block @tap="openServices" />
        <AppButton label="先去问助手" icon="nav-consult" variant="soft" block @tap="openConsult" />
      </view>
    </view>

    <view v-else class="list">
      <view
        v-for="product in filteredProducts"
        :key="productKey(product)"
        class="card pressable"
        aria-role="button"
        @click="openDetail(product)"
      >
        <view class="card__cover-wrap">
          <image
            v-if="coverSrc(product)"
            class="card__cover"
            :src="coverSrc(product)"
            mode="aspectFill"
          />
          <view v-else class="card__cover card__cover--placeholder">
            <AppIcon :name="product.icon || 'service-package'" :size="36" tone="primary" />
          </view>
          <text v-if="coverBadge(product)" class="card__badge">{{ coverBadge(product) }}</text>
        </view>
        <view class="card__body">
          <text class="card__title">{{ product.title }}</text>
          <view v-if="productTags(product).length" class="card__tags">
            <text v-for="tag in productTags(product)" :key="tag" class="card__tag">{{ tag }}</text>
          </view>
          <text v-if="product.subtitle || product.desc" class="card__sub">
            {{ product.subtitle || product.desc }}
          </text>
          <view class="card__foot">
            <text class="card__price">{{ formatPrice(product) }}</text>
            <view class="card__btn">
              <text class="card__btn-text">查看详情</text>
              <AppIcon name="nav-chevron-right" :size="12" tone="primary" />
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="filteredProducts.length" class="page-foot">
      <AppIcon name="service-package" :size="14" tone="primary" />
      <text class="page-foot__text">支付后可在「我的服务」查看进度与权益</text>
    </view>

    <view v-if="pickerOpen" class="picker" @touchmove.stop.prevent>
      <view class="picker__mask" @click="closeDoctorPicker" />
      <view class="picker__sheet">
        <view class="picker__head">
          <text class="picker__title">选择服务医生</text>
          <text class="picker__sub">切换后将展示该医生的服务包</text>
        </view>
        <scroll-view scroll-y class="picker__list">
          <view
            v-for="option in doctorOptions"
            :key="option.doctorId"
            class="picker__row pressable"
            :class="{ 'picker__row--active': option.doctorId === selectedDoctorId }"
            @click="selectDoctor(option)"
          >
            <view class="picker__row-main">
              <text class="picker__row-name">{{ option.doctorName }}医生</text>
              <text v-if="doctorSubline(option)" class="picker__row-sub">{{ doctorSubline(option) }}</text>
            </view>
            <text v-if="option.doctorId === selectedDoctorId" class="picker__row-badge">当前</text>
          </view>
        </scroll-view>
        <view class="picker__cancel pressable" @click="openSelectDoctorPage">选择其他医生</view>
        <view class="picker__cancel pressable" @click="closeDoctorPicker">取消</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px 16px calc(24px + env(safe-area-inset-bottom));
  background: #f3f5f4;
}
.catalog-hero {
  overflow: hidden;
  margin-bottom: 14px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(16, 40, 32, 0.06);
}
.catalog-hero__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 12px;
}
.catalog-hero__head--interactive:active {
  opacity: 0.92;
}
.catalog-hero__avatar {
  display: flex;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 14px;
  background: linear-gradient(145deg, #e7f3ec, #d7e9df);
}
.catalog-hero__avatar--live {
  border-radius: 50%;
  background: linear-gradient(145deg, #1a7a5c, #0f5a44);
}
.catalog-hero__initial {
  color: #fff;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}
.catalog-hero__avatar-img {
  display: block;
  width: 34px;
  height: 34px;
}
.catalog-hero__info {
  min-width: 0;
  flex: 1;
}
.catalog-hero__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.catalog-hero__title {
  color: #102820;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.35;
}
.catalog-hero__badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8f3ec;
  color: #0f5a44;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
}
.catalog-hero__meta {
  display: block;
  margin-top: 4px;
  color: #66766e;
  font-size: 13px;
  line-height: 1.45;
}
.catalog-hero__hint {
  display: block;
  margin-top: 6px;
  color: #8a9690;
  font-size: 13px;
  line-height: 1.45;
}
.catalog-hero__actions {
  display: flex;
  gap: 10px;
  padding: 0 16px 14px;
}
.hero-action {
  display: flex;
  min-height: 44px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #dfe7e1;
  border-radius: 12px;
  background: #fafcfb;
}
.hero-action:active {
  background: #f0f6f2;
}
.hero-action__label {
  color: #355447;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}
.catalog-hero__features {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 10px 12px;
  background: #e8f3ec;
  color: #2f6b4f;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}
.catalog-hero__dot {
  margin: 0 6px;
  opacity: 0.55;
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
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border: 1px solid #d8e0da;
  border-radius: 999px;
  background: #fff;
}
.chip--on {
  border-color: #0f5a44;
  background: #0f5a44;
}
.chip__label {
  color: #4a5a52;
  font-size: 14px;
  font-weight: 700;
}
.chip--on .chip__label {
  color: #fff;
}
.state {
  margin-top: 8px;
  padding: 16px 14px;
  border: 1px solid #dce3dd;
  border-radius: 14px;
  background: #fff;
  color: #66766e;
  font-size: 15px;
  text-align: center;
}
.state--error {
  color: #9b3b2e;
}
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton-card {
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(16, 40, 32, 0.05);
}
.skeleton-card__cover {
  height: 168px;
  background: #e8efe9;
}
.skeleton-card__body {
  padding: 14px;
}
.skeleton-line {
  height: 14px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: #e8efe9;
}
.skeleton-line--short {
  width: 58%;
}
.shimmer {
  animation: shimmer 1.2s ease-in-out infinite;
  background: linear-gradient(90deg, #e8efe9 0%, #f5faf6 45%, #e8efe9 90%);
  background-size: 200% 100%;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.empty {
  display: flex;
  margin-top: 4px;
  padding: 18px 16px 16px;
  flex-direction: column;
  align-items: center;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(16, 40, 32, 0.05);
  text-align: center;
}
.empty__visual {
  width: 120px;
  height: 120px;
}
.empty__title {
  margin-top: 8px;
  color: #102820;
  font-size: 18px;
  font-weight: 800;
}
.empty__text {
  margin-top: 8px;
  color: #66766e;
  font-size: 15px;
  line-height: 1.55;
}
.empty__actions {
  display: flex;
  width: 100%;
  margin-top: 16px;
  flex-direction: column;
  gap: 10px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card {
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(16, 40, 32, 0.06);
}
.card:active {
  transform: scale(0.995);
}
.card__cover-wrap {
  position: relative;
}
.card__cover {
  display: block;
  width: 100%;
  height: 168px;
  background: #eef5f0;
}
.card__cover--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}
.card__badge {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 90, 68, 0.92);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}
.card__body {
  padding: 14px 14px 16px;
}
.card__title {
  display: block;
  color: #102820;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.35;
}
.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.card__tag {
  padding: 4px 8px;
  border: 1px solid #c9ddd2;
  border-radius: 6px;
  background: #f4faf6;
  color: #3f6f58;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}
.card__sub {
  display: -webkit-box;
  margin-top: 8px;
  overflow: hidden;
  color: #66766e;
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.card__foot {
  display: flex;
  margin-top: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.card__price {
  color: #0f5a44;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}
.card__btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid #c9ddd2;
  border-radius: 999px;
  background: #fff;
}
.card__btn-text {
  color: #355447;
  font-size: 13px;
  font-weight: 700;
}
.page-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  padding: 0 8px;
}
.page-foot__text {
  color: #66766e;
  font-size: 12px;
  line-height: 1.45;
}
.picker {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.picker__mask {
  position: absolute;
  inset: 0;
  background: rgba(16, 32, 24, 0.45);
}
.picker__sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 18px 18px 0 0;
  background: #fff;
}
.picker__head {
  margin-bottom: 10px;
}
.picker__title {
  display: block;
  color: #17201c;
  font-size: 17px;
  font-weight: 800;
}
.picker__sub {
  display: block;
  margin-top: 4px;
  color: #8a938d;
  font-size: 13px;
}
.picker__list {
  max-height: 42vh;
}
.picker__row {
  display: flex;
  min-height: 56px;
  padding: 12px 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #eef2ef;
}
.picker__row--active .picker__row-name {
  color: #176b52;
}
.picker__row-main {
  min-width: 0;
  flex: 1;
}
.picker__row-name {
  display: block;
  color: #17201c;
  font-size: 16px;
  font-weight: 700;
}
.picker__row-sub {
  display: block;
  margin-top: 2px;
  color: #8a938d;
  font-size: 12px;
}
.picker__row-badge {
  color: #176b52;
  font-size: 13px;
  font-weight: 700;
}
.picker__cancel {
  margin-top: 10px;
  padding: 14px;
  border-radius: 12px;
  background: #f0f3f5;
  color: #44524b;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
.elder .catalog-hero__title,
.elder .empty__title,
.elder .card__title,
.elder .card__price {
  font-size: var(--font-subheading, 19px);
}
.elder .catalog-hero__meta,
.elder .catalog-hero__hint,
.elder .hero-action__label,
.elder .catalog-hero__features,
.elder .empty__text,
.elder .card__sub,
.elder .chip__label,
.elder .state,
.elder .card__btn-text,
.elder .page-foot__text {
  font-size: var(--font-secondary, 16px);
}
</style>
