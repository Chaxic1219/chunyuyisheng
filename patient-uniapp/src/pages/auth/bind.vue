<script setup lang="ts">
/**
 * 绑定手机号：仅微信官方 getPhoneNumber 一键绑定（无短信验证码）。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { getMpToken, mpBindPhone } from "../../api/auth";
import { useAuthStore } from "../../stores/auth";
import { useAppStore } from "../../stores/app";
import { resolveDoctorAffiliation } from "../../utils/doctorAffiliation";
import { isExplicitSignedOut } from "../../utils/signedOut";
import { createSubmissionGuard } from "../../utils/submissionGuard";
import { createTimerRegistry } from "../../utils/timerRegistry";

const auth = useAuthStore();
const app = useAppStore();

const returnUrl = ref("/pages/mine/index");
const rebind = ref(false);
const needsResumeLogin = ref(false);
const agreed = ref(true);
const busy = ref(false);
const completed = ref(false);
const timers = createTimerRegistry();
const bindGuard = createSubmissionGuard((state) => {
  busy.value = state.busy;
  completed.value = state.completed;
});

const ICON_SHIELD = "/static/service-ui/shield.png";
const ICON_HEART = "/static/service-ui/health-heart.png";
const ICON_CHECK = "/static/service-ui/check.png";

const pageTitle = computed(() => {
  if (needsResumeLogin.value) return "重新登录";
  return rebind.value ? "更换绑定手机号" : "绑定手机号";
});

const benefits = [
  "保存健康档案与报告",
  "接收服务进度提醒",
  "安全找回账号",
];

function sourceDoctorId(): number | undefined {
  const n = Number(app.sourceDoctorId || "");
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 静默登录可用 bootstrap 医生；绑手机请求禁止传默认医生 */
function provisionalDoctorId(): number | undefined {
  const fromSource = sourceDoctorId();
  if (fromSource) return fromSource;
  const n = Number(app.doctor?.id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function doctorId(): number | undefined {
  // 绑手机时仅传来源医生；禁止传 bootstrap 默认医生
  return sourceDoctorId();
}

const TAB_PATHS = new Set([
  "/pages/index/index",
  "/pages/consult/index",
  "/pages/mine/index",
]);

onLoad((query) => {
  rebind.value = String(query?.rebind || "") === "1";
  const raw = query?.returnUrl ? decodeURIComponent(String(query.returnUrl)) : "";
  if (raw.startsWith("/pages/")) returnUrl.value = raw;
});

onMounted(async () => {
  if (isExplicitSignedOut() && !getMpToken()) {
    needsResumeLogin.value = true;
    return;
  }
  if (!getMpToken()) {
    try {
      if (!app.doctor?.id) await app.load();
      await auth.silentLogin(provisionalDoctorId());
    } catch (e: any) {
      uni.showToast({ title: e?.message || "登录失败，请重试", icon: "none" });
    }
  }
});

async function onResumeLogin() {
  if (busy.value || completed.value) return;
  busy.value = true;
  try {
    if (!app.doctor?.id) await app.load();
    await auth.silentLogin(provisionalDoctorId());
    needsResumeLogin.value = false;
    if (auth.phoneBound) {
      await finishAfterPhoneBound();
      return;
    }
    uni.showToast({ title: "请继续绑定手机号", icon: "none" });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "登录失败，请重试", icon: "none" });
  } finally {
    busy.value = false;
  }
}

function goAfterBind() {
  const url = returnUrl.value || "/pages/mine/index";
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
  uni.navigateBack({ fail: () => uni.switchTab({ url: "/pages/mine/index" }) });
}

async function finishAfterPhoneBound() {
  const affiliation = await resolveDoctorAffiliation(returnUrl.value);
  if (affiliation === "need_select") return;
  if (affiliation === "failed") return;
  try {
    const { getMyArchive } = await import("../../api/patient");
    const { buildStorageScope, scopedStorageKey } = await import("../../utils/storageScope");
    const profileKey = scopedStorageKey(
      "patientProfile",
      buildStorageScope({
        doctorId: auth.sessionDoctorId || app.doctor?.id,
        patientId: auth.patientId,
        personId: auth.personId,
        token: getMpToken(),
      })
    );
    await getMyArchive(profileKey);
  } catch {
    /* ignore */
  }
  goAfterBind();
}

async function afterSuccess() {
  uni.showToast({
    title: rebind.value ? "更换成功" : "绑定成功",
    icon: "success",
  });
  timers.timeout(() => {
    void finishAfterPhoneBound();
  }, 400);
}

async function onWxPhone(e: any) {
  if (!agreed.value) {
    uni.showToast({ title: "请先同意用户协议与隐私政策", icon: "none" });
    return;
  }
  const code = e?.detail?.code;
  if (!code) {
    uni.showToast({ title: "未获取到手机号授权", icon: "none" });
    return;
  }
  if (busy.value || !bindGuard.start()) return;
  try {
    const data = await mpBindPhone({
      phoneCode: String(code),
      doctorId: sourceDoctorId(),
    });
    await auth.commitSessionWithRecovery(data);
    bindGuard.complete();
    await afterSuccess();
  } catch (err: any) {
    if (err?.code === "auth_recovery_failed") bindGuard.complete();
    uni.showToast({ title: err?.message || "微信绑定失败，请重试", icon: "none" });
  } finally {
    bindGuard.finish();
  }
}

function openAgreement(kind: "user" | "privacy") {
  uni.navigateTo({
    url: `/pages/services/agreements?type=${kind}`,
    fail: () => uni.showToast({ title: "协议页暂不可用", icon: "none" }),
  });
}

onUnmounted(() => {
  timers.dispose();
});
</script>

<template>
  <view class="page" :class="{ elder: app.elderMode }">
    <view class="hero">
      <view class="hero__copy">
        <text class="hero__title">安全保存你的健康信息</text>
        <text class="hero__sub">绑定后可在不同设备查看档案、计划和服务进度</text>
      </view>
      <view class="hero__art">
        <image class="hero__shield" :src="ICON_SHIELD" mode="aspectFit" />
        <image class="hero__heart" :src="ICON_HEART" mode="aspectFit" />
      </view>
    </view>

    <view class="card benefits">
      <view v-for="item in benefits" :key="item" class="benefit">
        <image class="benefit__icon" :src="ICON_CHECK" mode="aspectFit" />
        <text class="benefit__text">{{ item }}</text>
      </view>
    </view>

    <view class="card action">
      <button
        v-if="needsResumeLogin"
        class="btn btn--primary"
        :loading="busy"
        :disabled="busy || completed"
        @click="onResumeLogin"
      >
        <AppIcon name="wechat" :size="20" tone="inverse" />
        <text>使用微信登录</text>
      </button>

      <button
        v-else
        class="btn btn--wechat"
        open-type="getPhoneNumber"
        :loading="busy"
        :disabled="busy || completed || !agreed"
        @getphonenumber="onWxPhone"
      >
        <AppIcon name="wechat" :size="20" tone="inverse" />
        <text>{{ rebind ? "微信手机号一键更换" : "微信手机号一键绑定" }}</text>
      </button>

      <text class="action__tip">仅支持微信官方授权取号，不再使用短信验证码</text>
    </view>

    <view class="agree pressable" @click="agreed = !agreed">
      <view class="agree__box" :class="{ 'agree__box--on': agreed }">
        <text v-if="agreed">✓</text>
      </view>
      <text class="agree__text">我已阅读并同意</text>
      <text class="agree__link" @click.stop="openAgreement('user')">《用户协议》</text>
      <text class="agree__text">和</text>
      <text class="agree__link" @click.stop="openAgreement('privacy')">《隐私政策》</text>
    </view>
    <text class="footer-note">手机号仅用于账号验证和服务通知，不会公开展示</text>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
  background: #f5f7f6;
  box-sizing: border-box;
}
.hero {
  display: flex;
  margin-bottom: 14px;
  padding: 8px 4px 4px;
  align-items: center;
  gap: 12px;
}
.hero__copy {
  min-width: 0;
  flex: 1;
}
.hero__title {
  display: block;
  color: #0f3d2e;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.35;
}
.hero__sub {
  display: block;
  margin-top: 8px;
  color: #6a756f;
  font-size: 14px;
  line-height: 1.5;
}
.hero__art {
  position: relative;
  width: 88px;
  height: 88px;
  flex: 0 0 auto;
  border-radius: 24px;
  background: linear-gradient(160deg, #e8f5ee, #f7fcf9);
}
.hero__shield {
  position: absolute;
  left: 14px;
  top: 18px;
  width: 36px;
  height: 36px;
}
.hero__heart {
  position: absolute;
  right: 12px;
  bottom: 14px;
  width: 40px;
  height: 40px;
}
.card {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 61, 46, 0.05);
}
.benefit {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.benefit__icon {
  width: 20px;
  height: 20px;
}
.benefit__text {
  color: #17201c;
  font-size: 15px;
  font-weight: 600;
}
.action__tip {
  display: block;
  margin-top: 12px;
  color: #8a938d;
  font-size: 12px;
  text-align: center;
}
.btn {
  display: flex;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 0 16px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  line-height: 48px;
}
.btn::after {
  border: 0;
}
.btn--wechat,
.btn--primary {
  background: #176b52;
  color: #fff;
}
.btn[disabled] {
  opacity: 0.55;
}
.agree {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18px;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.agree__box {
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
}
.agree__box--on {
  background: #176b52;
}
.agree__text {
  color: #44524b;
  font-size: 13px;
}
.agree__link {
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
}
.footer-note {
  display: block;
  margin-top: 10px;
  color: #9aa49d;
  font-size: 12px;
  text-align: center;
  line-height: 1.45;
}
.elder .hero__title {
  font-size: 28px;
}
</style>
