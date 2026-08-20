<script setup lang="ts">
/**
 * 健康服务：匹配医生 + 进行中服务 + 按需求找服务 + 推荐
 */
import { computed, onMounted, ref } from "vue";
import { onShareAppMessage, onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import AppNotice from "../../components/AppNotice.vue";
import { getMyDoctors, type ConsultingDoctor } from "../../api/patient";
import { getMpToken } from "../../api/auth";
import {
  listMyOrders,
  listMyServices,
  type ServiceInstance,
  type ServiceOrder,
} from "../../api/servicePackage";
import { useConsultationStore } from "../../stores/consultation";
import { useServiceAssetsStore } from "../../stores/serviceAssets";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import { mpVisual, safeLocalImageSrc } from "../../utils/mediaSrc";

type DoctorOption = {
  doctorId: number;
  doctorName: string;
  title: string;
  dept: string;
  hospital: string;
};

type TodoItem = {
  key: string;
  title: string;
  sub: string;
  count?: number;
  action: () => void;
};

const serviceAssets = useServiceAssetsStore();
const consultation = useConsultationStore();
const appStore = useAppStore();
const auth = useAuthStore();
const data = computed(() => serviceAssets.center);

const doctorOptions = ref<DoctorOption[]>([]);
const pickerOpen = ref(false);
const switching = ref(false);
const todoLoading = ref(false);
const pendingPay = ref(0);
const pendingProfile = ref(0);
const pendingReview = ref(0);
const activeServices = ref<ServiceInstance[]>([]);
const spotlightOrder = ref<ServiceOrder | null>(null);

const selectedDoctorId = computed(() => {
  const fromApp = Number(appStore.doctor?.id);
  if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
  const fromCenter = Number((data.value as { doctorId?: number } | null)?.doctorId);
  if (Number.isFinite(fromCenter) && fromCenter > 0) return fromCenter;
  const fromSource = Number(appStore.sourceDoctorId);
  if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  return 0;
});

const doctorName = computed(() => {
  const fromList = doctorOptions.value.find((d) => d.doctorId === selectedDoctorId.value);
  return fromList?.doctorName || appStore.doctor?.name || (data.value as { doctorName?: string } | null)?.doctorName || "";
});
const doctorHospital = computed(() => {
  const fromList = doctorOptions.value.find((d) => d.doctorId === selectedDoctorId.value);
  return fromList?.hospital || appStore.doctor?.hospital || "";
});
const canSwitchDoctor = computed(() => doctorOptions.value.length > 1);
const products = computed(() => data.value?.products || []);
const hasProducts = computed(() => products.value.length > 0);
const featuredProduct = computed(() => products.value[0] || null);
const activeService = computed(() => activeServices.value[0] || null);
const activeProgress = computed(() => serviceProgressPercent(activeService.value));

const urgentTodos = computed<TodoItem[]>(() => {
  const rows: TodoItem[] = [];
  if (pendingPay.value > 0) {
    rows.push({
      key: "pay",
      title: "待付款服务包",
      sub: "有订单尚未支付，可继续完成开通",
      count: pendingPay.value,
      action: () => void openMyServices("orders", "pending_payment"),
    });
  }
  if (pendingProfile.value > 0) {
    rows.push({
      key: "profile",
      title: "待补充资料",
      sub: "支付已完成，请补充术后/康复资料",
      count: pendingProfile.value,
      action: () => void openMyServices("orders", "paid_pending_profile"),
    });
  }
  if (pendingReview.value > 0) {
    rows.push({
      key: "review",
      title: "审核进行中",
      sub: "资料已提交，等待医护开通服务",
      count: pendingReview.value,
      action: () => void openMyServices("orders", "pending_review"),
    });
  }
  return rows.slice(0, 2);
});

const needCategories = [
  {
    key: "rehab",
    title: "术后康复",
    desc: "科学康复指导，促进身体恢复",
    iconSrc: mpVisual("service-ui/rehab.png"),
  },
  {
    key: "chronic",
    title: "慢病管理",
    desc: "长期健康管理，稳定控制指标",
    iconSrc: mpVisual("service-ui/chronic.png"),
  },
  {
    key: "med",
    title: "用药指导",
    desc: "合理用药建议，减少用药风险",
    iconSrc: mpVisual("service-ui/medication.png"),
  },
  {
    key: "nutrition",
    title: "营养调理",
    desc: "个性化营养方案，改善饮食结构",
    iconSrc: mpVisual("service-ui/nutrition.png"),
  },
] as const;

const ICON_DOCTOR = mpVisual("service-ui/doctor.png");
const ICON_CHECKLIST = mpVisual("service-ui/checklist.png");
const ICON_HEART = mpVisual("service-ui/health-heart.png");

function serviceProgressPercent(inst: ServiceInstance | null | undefined): number {
  if (!inst) return 0;
  const start = Date.parse(String(inst.serviceStartDate || ""));
  const end = Date.parse(String(inst.serviceEndDate || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const raw = ((Date.now() - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function ringStyle(percent: number) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return {
    background: `conic-gradient(#176b52 ${p}%, #e5f3ec 0)`,
  };
}

function formatServiceUntil(dateStr?: string | null): string {
  const raw = String(dateStr || "").trim();
  if (!raw) return "服务进行中";
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return `服务至 ${raw}`;
  const d = new Date(t);
  return `服务至 ${d.getMonth() + 1}月${d.getDate()}日`;
}

function productKey(product: { key?: string; id?: string | number; versionId?: number; productId?: number }) {
  return String(product.key || product.id || product.versionId || product.productId || "");
}

function productCover(product: { cover?: string; icon?: string }) {
  return safeLocalImageSrc(product.cover || product.icon);
}

function formatPrice(product: { totalAmount?: number }) {
  if (product.totalAmount == null || Number.isNaN(Number(product.totalAmount))) return "价格待定";
  const n = Number(product.totalAmount);
  return Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`;
}

function productDaysTag(product: { serviceDays?: number }) {
  const days = Number(product.serviceDays);
  if (!Number.isFinite(days) || days <= 0) return "";
  return `${days}天`;
}

function productFeatureLine(product: { contents?: string[]; desc?: string; subtitle?: string }) {
  const bits = (product.contents || []).filter(Boolean).slice(0, 3);
  if (bits.length) return bits.join(" · ");
  return product.desc || product.subtitle || "医生随访 · 健康管理 · 专属服务";
}

function currentAsOption(): DoctorOption | null {
  const id = selectedDoctorId.value;
  if (!id) return null;
  return {
    doctorId: id,
    doctorName: appStore.doctor?.name || (data.value as { doctorName?: string } | null)?.doctorName || "当前医生",
    title: appStore.doctor?.title || "",
    dept: appStore.doctor?.dept || "",
    hospital: appStore.doctor?.hospital || "",
  };
}

function mergeDoctorOptions(rows: ConsultingDoctor[]) {
  const map = new Map<number, DoctorOption>();
  for (const row of rows) {
    const id = Number(row.doctorId);
    if (!Number.isFinite(id) || id <= 0) continue;
    map.set(id, {
      doctorId: id,
      doctorName: row.doctorName || "服务医生",
      title: row.title || "",
      dept: row.dept || "",
      hospital: row.hospital || "",
    });
  }
  const current = currentAsOption();
  if (current && !map.has(current.doctorId)) {
    map.set(current.doctorId, current);
  }
  doctorOptions.value = Array.from(map.values());
}

async function refreshDoctorOptions() {
  let rows: ConsultingDoctor[] = [];
  if (getMpToken()) {
    rows = await getMyDoctors().catch(() => []);
  }
  mergeDoctorOptions(rows);
}

async function ensureDoctorContext() {
  if (!appStore.doctor) {
    try {
      await appStore.load(false, appStore.sourceDoctorId || undefined);
    } catch {
      /* ignore */
    }
  }
}

async function loadTodos() {
  if (!getMpToken()) {
    pendingPay.value = 0;
    pendingProfile.value = 0;
    pendingReview.value = 0;
    activeServices.value = [];
    spotlightOrder.value = null;
    return;
  }
  todoLoading.value = true;
  try {
    const [orderData, svcData] = await Promise.all([
      listMyOrders({ limit: 50 }).catch(() => ({ orders: [] as ServiceOrder[] })),
      listMyServices().catch(() => ({ instances: [] as ServiceInstance[], orders: [] as ServiceOrder[] })),
    ]);
    const orders = orderData.orders || [];
    pendingPay.value = orders.filter((o) => o.status === "pending_payment").length;
    pendingProfile.value = orders.filter((o) => o.status === "paid_pending_profile").length;
    pendingReview.value = orders.filter((o) => o.status === "pending_review").length;
    spotlightOrder.value =
      orders.find((o) => o.status === "pending_payment") ||
      orders.find((o) => o.status === "paid_pending_profile") ||
      null;
    activeServices.value = (svcData.instances || []).filter(
      (i) => i.status === "active" || i.status === "pending_review"
    );
  } finally {
    todoLoading.value = false;
  }
}

async function bootstrap() {
  await ensureDoctorContext();
  await refreshDoctorOptions();
  await Promise.all([serviceAssets.loadCenter(true), loadTodos()]);
}

onMounted(() => {
  void bootstrap();
});

onShow(() => {
  void loadTodos();
});

function toast(title: string) {
  uni.showToast({ title, icon: "none" });
}

function openCatalog() {
  uni.navigateTo({ url: "/pages/services/catalog" });
}

function consult(extra?: string) {
  consultation.applyEntryContext(
    extra || "来自健康服务：请协助处理服务包选购、订单、资料与开通问题。",
    "life"
  );
  uni.switchTab({ url: "/pages/consult/index" });
}

async function openMyServices(tab?: "active" | "orders", status?: string) {
  let url = "/pages/services/mine-services";
  const qs: string[] = [];
  if (tab === "orders") qs.push("tab=orders");
  else if (tab === "active") qs.push("tab=active");
  if (status) qs.push(`status=${encodeURIComponent(status)}`);
  if (qs.length) url += `?${qs.join("&")}`;
  const ok = await ensureLogin(url);
  if (!ok) return;
  uni.navigateTo({ url });
}

function openProduct(product: { key?: string; id?: string | number; versionId?: number; productId?: number }) {
  const id = productKey(product);
  if (!id) return;
  uni.navigateTo({ url: `/pages/services/detail?id=${encodeURIComponent(id)}` });
}

function openNeedCategory(key: string) {
  if (key === "med") {
    consult("来自健康服务：想了解用药指导相关服务。");
    return;
  }
  openCatalog();
}

function continueActiveService() {
  const inst = activeService.value;
  if (!inst) {
    void openMyServices("active");
    return;
  }
  if (inst.planId) {
    uni.navigateTo({ url: "/pages/plans/detail" });
    return;
  }
  uni.navigateTo({ url: `/pages/services/instance?id=${inst.id}` });
}

function openSpotlight() {
  const o = spotlightOrder.value;
  if (!o) return;
  if (o.status === "paid_pending_profile") {
    uni.navigateTo({ url: `/pages/services/onboarding?orderId=${o.id}` });
    return;
  }
  uni.navigateTo({ url: `/pages/services/order-detail?id=${o.id}` });
}

function reload() {
  void bootstrap();
}

function openDoctorPicker() {
  if (!canSwitchDoctor.value || switching.value) return;
  pickerOpen.value = true;
}

function closeDoctorPicker() {
  pickerOpen.value = false;
}

async function selectDoctor(option: DoctorOption) {
  if (switching.value) return;
  if (option.doctorId === selectedDoctorId.value) {
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
    await refreshDoctorOptions();
    await serviceAssets.loadCenter(true);
    await loadTodos();
    closeDoctorPicker();
  } catch (e) {
    console.error(e);
    toast("切换医生失败，请重试");
  } finally {
    switching.value = false;
  }
}

onShareAppMessage(() => ({
  title: doctorName.value ? `${doctorName.value}医生的健康服务` : "春雨健康患者端",
  path: appStore.buildSharePath("/pages/services/index"),
}));

function doctorSubline(option: DoctorOption) {
  return [option.dept, option.hospital].filter(Boolean).join(" · ");
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="page-head">
      <view class="page-head__spacer" />
      <view class="page-head__link pressable" aria-role="button" @click="openMyServices()">
        <text>我的服务</text>
        <AppIcon name="nav-chevron-right" :size="14" tone="primary" />
      </view>
    </view>

    <view v-if="(serviceAssets.loading || switching) && !data" class="state-card">正在加载健康服务…</view>

    <view
      v-else-if="serviceAssets.error && !data"
      class="pressable"
      aria-role="button"
      @click="reload"
    >
      <AppNotice tone="danger" icon="action-refresh" title="服务加载失败" :text="`${serviceAssets.error}，点击重试`" />
    </view>

    <template v-else>
      <view v-if="switching" class="state-card state-card--soft">正在切换医生服务…</view>

      <view
        class="doctor-card pressable"
        :class="{ 'doctor-card--interactive': canSwitchDoctor }"
        :aria-role="canSwitchDoctor ? 'button' : undefined"
        @click="openDoctorPicker"
      >
        <view class="doctor-card__avatar">
          <image class="doctor-card__avatar-img" :src="ICON_DOCTOR" mode="aspectFit" />
        </view>
        <view class="doctor-card__copy">
          <text class="doctor-card__name">
            {{ doctorName ? `${doctorName}医生` : "请选择医生" }}
            <text v-if="doctorHospital"> · {{ doctorHospital }}</text>
          </text>
          <text class="doctor-card__sub">{{ doctorName ? "已为你匹配" : "登录后可匹配专属医生" }}</text>
        </view>
        <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
      </view>

      <view v-if="!todoLoading && urgentTodos.length" class="todo-strip">
        <view
          v-for="item in urgentTodos"
          :key="item.key"
          class="todo-strip__item pressable"
          aria-role="button"
          @click="item.action()"
        >
          <view class="todo-strip__main">
            <text class="todo-strip__title">{{ item.title }}</text>
            <text class="todo-strip__sub">{{ item.sub }}</text>
          </view>
          <text v-if="item.count" class="todo-strip__count">{{ item.count }}</text>
          <AppIcon name="nav-chevron-right" :size="14" tone="muted" />
        </view>
      </view>

      <view v-else-if="spotlightOrder" class="todo-strip">
        <view class="todo-strip__item pressable" aria-role="button" @click="openSpotlight">
          <view class="todo-strip__main">
            <text class="todo-strip__title">继续处理订单</text>
            <text class="todo-strip__sub">服务单号 {{ spotlightOrder.orderNo }}</text>
          </view>
          <AppIcon name="nav-chevron-right" :size="14" tone="muted" />
        </view>
      </view>

      <view v-if="activeService" class="active-card">
        <view class="active-card__top">
          <view class="active-card__info">
            <text class="active-card__badge">进行中</text>
            <text class="active-card__title">{{ activeService.title || "服务包" }}</text>
            <text class="active-card__meta">{{ formatServiceUntil(activeService.serviceEndDate) }}</text>
          </view>
          <view class="progress-ring" :style="ringStyle(activeProgress)">
            <view class="progress-ring__inner">
              <text class="progress-ring__value">{{ activeProgress }}%</text>
              <text class="progress-ring__label">服务进度</text>
            </view>
          </view>
        </view>
        <view class="active-card__foot">
          <view class="active-card__next">
            <image class="active-card__next-icon" :src="ICON_CHECKLIST" mode="aspectFit" />
            <view class="active-card__next-copy">
              <text class="active-card__next-label">下一步</text>
              <text class="active-card__next-text">
                {{ activeService.summary?.nextTask || "查看服务详情并继续执行" }}
              </text>
            </view>
          </view>
          <view class="active-card__btn pressable" aria-role="button" @click="continueActiveService">
            <text>继续服务</text>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section__title">按需求找服务</text>
        <view class="need-grid">
          <view
            v-for="item in needCategories"
            :key="item.key"
            class="need-card pressable"
            aria-role="button"
            @click="openNeedCategory(item.key)"
          >
            <image class="need-card__icon" :src="item.iconSrc" mode="aspectFit" />
            <view class="need-card__copy">
              <view class="need-card__title-row">
                <text class="need-card__title">{{ item.title }}</text>
                <AppIcon name="nav-chevron-right" :size="12" tone="muted" />
              </view>
              <text class="need-card__desc">{{ item.desc }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section__title">为你推荐</text>
        <view v-if="featuredProduct" class="recommend-card pressable" aria-role="button" @click="openProduct(featuredProduct)">
          <view class="recommend-card__thumb">
            <image
              v-if="productCover(featuredProduct)"
              class="recommend-card__cover"
              :src="productCover(featuredProduct)"
              mode="aspectFill"
            />
            <image v-else class="recommend-card__fallback" :src="ICON_HEART" mode="aspectFit" />
          </view>
          <view class="recommend-card__body">
            <view class="recommend-card__title-row">
              <text class="recommend-card__title">{{ featuredProduct.title }}</text>
              <text v-if="productDaysTag(featuredProduct)" class="recommend-card__tag">
                {{ productDaysTag(featuredProduct) }}
              </text>
            </view>
            <text class="recommend-card__desc">{{ productFeatureLine(featuredProduct) }}</text>
            <view class="recommend-card__foot">
              <text class="recommend-card__price">{{ formatPrice(featuredProduct) }}</text>
              <view class="recommend-card__btn" @click.stop="openProduct(featuredProduct)">
                <text>查看详情</text>
              </view>
            </view>
          </view>
        </view>
        <view v-else-if="hasProducts" class="recommend-card pressable" @click="openCatalog">
          <view class="recommend-card__thumb">
            <image class="recommend-card__fallback" :src="ICON_HEART" mode="aspectFit" />
          </view>
          <view class="recommend-card__body">
            <text class="recommend-card__title">浏览更多服务包</text>
            <text class="recommend-card__desc">按医生服务目录查看可开通项目</text>
            <view class="recommend-card__foot">
              <text class="recommend-card__price">去看看</text>
              <view class="recommend-card__btn"><text>查看详情</text></view>
            </view>
          </view>
        </view>
        <view v-else class="empty-rec">
          <image class="empty-rec__icon" :src="ICON_HEART" mode="aspectFit" />
          <text class="empty-rec__title">暂无推荐服务包</text>
          <text class="empty-rec__sub">
            {{ doctorName ? `${doctorName}医生的服务包筹备中` : "服务包筹备中" }}
          </text>
        </view>
      </view>
    </template>

    <view v-if="pickerOpen" class="picker" @touchmove.stop.prevent>
      <view class="picker__mask" @click="closeDoctorPicker" />
      <view class="picker__sheet">
        <view class="picker__head">
          <text class="picker__title">选择服务医生</text>
          <text class="picker__sub">将展示该医生的服务与档案上下文</text>
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
        <view class="picker__cancel pressable" @click="closeDoctorPicker">取消</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px 16px calc(28px + env(safe-area-inset-bottom));
  background: #f5f7f6;
}
.page-head {
  display: flex;
  margin-bottom: 10px;
  align-items: center;
  justify-content: flex-end;
}
.page-head__spacer {
  flex: 1;
}
.page-head__link {
  display: flex;
  align-items: center;
  gap: 2px;
  color: #176b52;
  font-size: 14px;
  font-weight: 600;
}
.state-card {
  margin-bottom: 12px;
  padding: 18px 14px;
  border-radius: 14px;
  background: #fff;
  color: #6a756f;
  font-size: 15px;
  text-align: center;
}
.state-card--soft {
  background: #eef7f2;
  color: #176b52;
}

.doctor-card {
  display: flex;
  margin-bottom: 12px;
  padding: 14px;
  align-items: center;
  gap: 12px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.doctor-card--interactive:active {
  background: #f7faf8;
}
.doctor-card__avatar {
  display: flex;
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
}
.doctor-card__avatar-img {
  width: 52px;
  height: 52px;
  background: transparent;
}
.doctor-card__copy {
  min-width: 0;
  flex: 1;
}
.doctor-card__name {
  display: block;
  color: #17201c;
  font-size: 16px;
  font-weight: 700;
}
.doctor-card__sub {
  display: block;
  margin-top: 4px;
  color: #8a938d;
  font-size: 13px;
}

.todo-strip {
  margin-bottom: 12px;
}
.todo-strip__item {
  display: flex;
  margin-bottom: 8px;
  padding: 12px 14px;
  align-items: center;
  gap: 8px;
  border-radius: 14px;
  background: #fff8e8;
}
.todo-strip__main {
  min-width: 0;
  flex: 1;
}
.todo-strip__title {
  display: block;
  color: #7a4e12;
  font-size: 15px;
  font-weight: 700;
}
.todo-strip__sub {
  display: block;
  margin-top: 2px;
  color: #9a7340;
  font-size: 12px;
}
.todo-strip__count {
  color: #176b52;
  font-size: 16px;
  font-weight: 800;
}

.active-card {
  margin-bottom: 18px;
  padding: 16px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(15, 61, 46, 0.06);
}
.active-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.active-card__info {
  min-width: 0;
  flex: 1;
}
.active-card__badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8f5ee;
  color: #176b52;
  font-size: 12px;
  font-weight: 700;
}
.active-card__title {
  display: block;
  margin-top: 10px;
  color: #17201c;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.3;
}
.active-card__meta {
  display: block;
  margin-top: 6px;
  color: #8a938d;
  font-size: 13px;
}
.progress-ring {
  display: flex;
  width: 84px;
  height: 84px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.progress-ring__inner {
  display: flex;
  width: 64px;
  height: 64px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #fff;
}
.progress-ring__value {
  color: #176b52;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.1;
}
.progress-ring__label {
  margin-top: 2px;
  color: #8a938d;
  font-size: 10px;
}
.active-card__foot {
  display: flex;
  margin-top: 14px;
  padding-top: 14px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid #eef2ef;
}
.active-card__next {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
}
.active-card__next-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}
.active-card__next-copy {
  min-width: 0;
  flex: 1;
}
.active-card__next-label {
  display: block;
  color: #8a938d;
  font-size: 12px;
}
.active-card__next-text {
  display: block;
  margin-top: 2px;
  color: #17201c;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.active-card__btn {
  flex: 0 0 auto;
  padding: 8px 14px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.section {
  margin-bottom: 18px;
}
.section__title {
  display: block;
  margin-bottom: 10px;
  color: #17201c;
  font-size: 17px;
  font-weight: 800;
}
.need-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.need-card {
  display: flex;
  min-height: 96px;
  padding: 12px;
  align-items: flex-start;
  gap: 10px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 61, 46, 0.04);
}
.need-card__icon {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  margin-top: 0;
  background: transparent;
}
.need-card__copy {
  min-width: 0;
  flex: 1;
}
.need-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.need-card__title {
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
}
.need-card__desc {
  display: block;
  margin-top: 4px;
  color: #8a938d;
  font-size: 12px;
  line-height: 1.45;
}

.recommend-card {
  display: flex;
  padding: 12px;
  align-items: stretch;
  gap: 12px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.recommend-card__thumb {
  display: flex;
  width: 72px;
  height: 72px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  background: #e8f5ee;
}
.recommend-card__cover {
  width: 100%;
  height: 100%;
}
.recommend-card__fallback {
  width: 36px;
  height: 36px;
}
.recommend-card__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.recommend-card__title-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.recommend-card__title {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}
.recommend-card__tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: #eef2ef;
  color: #6a756f;
  font-size: 11px;
}
.recommend-card__desc {
  display: block;
  margin-top: 4px;
  color: #8a938d;
  font-size: 12px;
  line-height: 1.4;
}
.recommend-card__foot {
  display: flex;
  margin-top: auto;
  padding-top: 8px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.recommend-card__price {
  color: #176b52;
  font-size: 18px;
  font-weight: 800;
}
.recommend-card__btn {
  padding: 6px 12px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.empty-rec {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 16px;
  border-radius: 16px;
  background: #fff;
}
.empty-rec__icon {
  width: 40px;
  height: 40px;
  margin-bottom: 10px;
  opacity: 0.7;
}
.empty-rec__title {
  color: #17201c;
  font-size: 15px;
  font-weight: 700;
}
.empty-rec__sub {
  margin-top: 4px;
  color: #8a938d;
  font-size: 13px;
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

.elder .active-card__title,
.elder .doctor-card__name,
.elder .need-card__title,
.elder .recommend-card__title {
  font-size: 18px;
}
</style>
