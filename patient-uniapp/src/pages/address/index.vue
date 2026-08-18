<script setup lang="ts">
/**
 * 地址管理：云端列表 / 结算时选择地址
 */
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import AppEmptyState from "../../components/AppEmptyState.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import {
  formatAddressLine,
  removeAddress,
  setDefaultAddress,
  setSelectedAddressId,
  syncAddresses,
  type ServiceAddress,
} from "../../utils/serviceAddress";

const appStore = useAppStore();
const fromCheckout = ref(false);
const returnUrl = ref("");
const rows = ref<ServiceAddress[]>([]);
const loading = ref(false);

const doctorId = computed(() => appStore.doctor?.id || appStore.sourceDoctorId || 0);
const pageTitle = computed(() => (fromCheckout.value ? "选择服务地址" : "地址管理"));

async function reload() {
  loading.value = true;
  try {
    rows.value = await syncAddresses(doctorId.value);
  } catch (e: any) {
    uni.showToast({ title: e?.message || "地址加载失败", icon: "none" });
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

onLoad((query) => {
  fromCheckout.value = String(query?.from || "") === "checkout";
  returnUrl.value = decodeURIComponent(String(query?.returnUrl || "").trim());
});

onShow(async () => {
  const ok = await ensureLogin("/pages/address/index");
  if (!ok) return;
  await reload();
  if (fromCheckout.value && !rows.value.length) {
    uni.showModal({
      title: "请先新增地址",
      content: "下单前需要填写服务联系地址，请先新增一条。",
      showCancel: false,
      success: () => openEdit(),
    });
  }
});

function openEdit(id?: string) {
  const qs = id ? `?id=${encodeURIComponent(id)}` : "";
  const extra = fromCheckout.value
    ? `${qs ? "&" : "?"}from=checkout${returnUrl.value ? `&returnUrl=${encodeURIComponent(returnUrl.value)}` : ""}`
    : "";
  uni.navigateTo({ url: `/pages/address/edit${qs}${extra}` });
}

async function selectAddress(addr: ServiceAddress) {
  try {
    setSelectedAddressId(addr.id, doctorId.value);
    await setDefaultAddress(addr.id, doctorId.value);
    if (fromCheckout.value) {
      if (returnUrl.value) {
        uni.redirectTo({
          url: returnUrl.value,
          fail: () => uni.navigateBack({ fail: () => uni.redirectTo({ url: returnUrl.value }) }),
        });
      } else {
        uni.navigateBack({ fail: () => uni.redirectTo({ url: "/pages/services/checkout" }) });
      }
      return;
    }
    uni.showToast({ title: "已设为默认地址", icon: "none" });
    await reload();
  } catch (e: any) {
    uni.showToast({ title: e?.message || "操作失败", icon: "none" });
  }
}

function onDelete(addr: ServiceAddress) {
  uni.showModal({
    title: "删除地址",
    content: "确定删除该地址吗？",
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await removeAddress(addr.id, doctorId.value);
        await reload();
      } catch (e: any) {
        uni.showToast({ title: e?.message || "删除失败", icon: "none" });
      }
    },
  });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="banner">
      <text class="banner__title">{{ pageTitle }}</text>
      <text class="banner__sub">用于服务包联系、随访安排与物流寄送。信息加密存储，仅服务相关人员可见。</text>
    </view>

    <view v-if="loading" class="loading">加载中…</view>

    <AppEmptyState
      v-else-if="!rows.length"
      :visual="''"
      title="暂无地址"
      text="新增个人地址后，即可确认订单并继续购买。"
      action-label="新增地址"
      action-icon="profile-edit"
      @action="openEdit()"
    />

    <view v-else class="list">
      <view v-for="addr in rows" :key="addr.id" class="card">
        <view class="card__main pressable" @click="selectAddress(addr)">
          <view class="card__head">
            <text class="card__name">{{ addr.name }}</text>
            <text class="card__phone">{{ addr.phone }}</text>
            <text v-if="addr.isDefault" class="card__badge">默认</text>
          </view>
          <text class="card__addr">{{ formatAddressLine(addr) }}</text>
          <text v-if="fromCheckout" class="card__tip">点击选用此地址并返回确认订单</text>
        </view>
        <view class="card__actions">
          <view class="link pressable" @click="openEdit(addr.id)">
            <AppIcon name="profile-edit" :size="16" tone="primary" />
            <text class="link__text">编辑</text>
          </view>
          <view class="link pressable" @click="onDelete(addr)">
            <text class="link__text link__text--danger">删除</text>
          </view>
        </view>
      </view>
    </view>

    <text class="secure">地址仅用于服务履约，不会用于营销推送</text>

    <view class="fab pressable" aria-role="button" @click="openEdit()">
      <text class="fab__text">+ 新增地址</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px 16px calc(88px + env(safe-area-inset-bottom));
  background: #f5f7f6;
  --font-caption: 15px;
  --font-secondary: 17px;
  --font-body: 19px;
}
.banner {
  margin-bottom: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(160deg, #e8f5ee, #f7fcf9);
}
.banner__title {
  display: block;
  color: #0f3d2e;
  font-size: 18px;
  font-weight: 800;
}
.banner__sub {
  display: block;
  margin-top: 6px;
  color: #5f6b64;
  font-size: var(--font-caption);
  line-height: 1.45;
}
.loading {
  padding: 40px 0;
  color: #8a938d;
  text-align: center;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 61, 46, 0.05);
  overflow: hidden;
}
.card__main {
  padding: 14px 16px;
}
.card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.card__name {
  color: #17201c;
  font-size: var(--font-body);
  font-weight: 800;
}
.card__phone {
  color: #44514a;
  font-size: var(--font-secondary);
}
.card__badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8f4ee;
  color: #176b52;
  font-size: 12px;
  font-weight: 700;
}
.card__addr {
  display: block;
  margin-top: 8px;
  color: #5f6b64;
  font-size: var(--font-secondary);
  line-height: 1.45;
}
.card__tip {
  display: block;
  margin-top: 8px;
  color: #176b52;
  font-size: var(--font-caption);
  font-weight: 600;
}
.card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid #eef2ef;
}
.link {
  display: flex;
  align-items: center;
  gap: 4px;
}
.link__text {
  color: #176b52;
  font-size: var(--font-caption);
  font-weight: 700;
}
.link__text--danger {
  color: #a33c33;
}
.secure {
  display: block;
  margin-top: 14px;
  color: #9aa49d;
  font-size: 12px;
  text-align: center;
}
.fab {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  padding: 14px;
  border-radius: 999px;
  background: #176b52;
  text-align: center;
}
.fab__text {
  color: #fff;
  font-size: var(--font-body);
  font-weight: 800;
}
.elder .card__name,
.elder .fab__text {
  font-size: 22px;
}
</style>
