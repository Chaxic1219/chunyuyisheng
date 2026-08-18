<script setup lang="ts">
/**
 * 首次选医生：仅当后台无医生关系且无来源 doctorId 时出现。
 */
import { onMounted, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { getSettledDoctors, type SettledDoctor } from "../../api/patient";
import { useAuthStore } from "../../stores/auth";
import { useAppStore } from "../../stores/app";

const auth = useAuthStore();
const app = useAppStore();

const returnUrl = ref("/pages/index/index");
const loading = ref(true);
const selecting = ref(false);
const error = ref("");
const doctors = ref<SettledDoctor[]>([]);

const TAB_PATHS = new Set([
  "/pages/index/index",
  "/pages/consult/index",
  "/pages/mine/index",
]);

onLoad((query) => {
  const raw = query?.returnUrl ? decodeURIComponent(String(query.returnUrl)) : "";
  if (raw.startsWith("/pages/")) returnUrl.value = raw;
});

onMounted(async () => {
  if (!auth.phoneBound) {
    uni.redirectTo({
      url: `/pages/auth/bind?returnUrl=${encodeURIComponent(returnUrl.value)}`,
    });
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    doctors.value = await getSettledDoctors();
    if (!doctors.value.length) {
      error.value = "暂无可选医生，请稍后再试";
    }
  } catch {
    error.value = "加载医生列表失败，请重试";
  } finally {
    loading.value = false;
  }
});

function doctorSubline(d: SettledDoctor) {
  return [d.title, d.dept, d.hospital].filter(Boolean).join(" · ");
}

function goAfterSelect() {
  const url = returnUrl.value || "/pages/index/index";
  const pathOnly = url.split("?")[0];
  if (TAB_PATHS.has(pathOnly)) {
    uni.switchTab({ url: pathOnly });
    return;
  }
  if (url.startsWith("/pages/")) {
    uni.redirectTo({
      url,
      fail: () => uni.reLaunch({ url }),
    });
    return;
  }
  uni.switchTab({ url: "/pages/index/index" });
}

async function selectDoctor(d: SettledDoctor) {
  if (selecting.value) return;
  const id = Number(d.doctorId);
  if (!Number.isInteger(id) || id <= 0) return;
  selecting.value = true;
  try {
    app.setSourceFromQuery({ doctorId: String(id) });
    app.rememberDoctorId(id);
    await auth.silentLogin(id, { claimDoctor: true });
    await app.load(true, id).catch(() => undefined);
    if (auth.needsDoctorSelection || Number(auth.sessionDoctorId) !== id) {
      throw new Error("switch_failed");
    }
    uni.showToast({ title: "已选择医生", icon: "success" });
    setTimeout(goAfterSelect, 350);
  } catch {
    uni.showToast({ title: "切换失败，请重试", icon: "none" });
  } finally {
    selecting.value = false;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: app.elderMode }">
    <view class="hero">
      <text class="hero__title">请选择您的医生</text>
      <text class="hero__sub">选择后可完善健康档案，并可在健康服务中切换</text>
    </view>

    <view v-if="loading" class="state">正在加载医生列表…</view>
    <view v-else-if="error" class="state state--error">{{ error }}</view>
    <view v-else class="list">
      <view
        v-for="d in doctors"
        :key="d.doctorId"
        class="row pressable"
        :class="{ 'row--disabled': selecting }"
        @click="selectDoctor(d)"
      >
        <view class="row__main">
          <text class="row__name">{{ d.doctorName || "医生" }}</text>
          <text v-if="doctorSubline(d)" class="row__sub">{{ doctorSubline(d) }}</text>
        </view>
        <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 20px 16px calc(28px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.hero {
  margin-bottom: 16px;
}
.hero__title {
  display: block;
  color: #1a2e28;
  font-size: 22px;
  font-weight: 700;
}
.hero__sub {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: 14px;
  line-height: 1.5;
}
.state {
  padding: 28px 16px;
  border-radius: 14px;
  background: #fff;
  color: #6a756f;
  font-size: 15px;
  text-align: center;
}
.state--error {
  color: #b42318;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 14px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.row--disabled {
  opacity: 0.6;
}
.row__main {
  min-width: 0;
  flex: 1;
}
.row__name {
  display: block;
  color: #1a2e28;
  font-size: 17px;
  font-weight: 650;
}
.row__sub {
  display: block;
  margin-top: 4px;
  color: #6a756f;
  font-size: 13px;
}
.elder .hero__title {
  font-size: 26px;
}
.elder .row__name {
  font-size: 20px;
}
</style>
