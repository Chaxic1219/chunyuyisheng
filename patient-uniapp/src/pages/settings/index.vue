<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import AppListRow from "../../components/AppListRow.vue";
import AppSectionHeader from "../../components/AppSectionHeader.vue";
import { ApiError, getMpToken, mpUnbindPhone } from "../../api/auth";
import { useAuthStore } from "../../stores/auth";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import { setExplicitSignedOut } from "../../utils/signedOut";

const STORAGE_KEY = "mpV32SettingsReminders";
const SETTINGS_URL = "/pages/settings/index";
const auth = useAuthStore();
const appStore = useAppStore();

const accountMeta = computed(() => auth.phoneMasked || "未绑定");
/** 三项本机提醒偏好合并为一个开关；全开视为开，否则视为关 */
const remindersOn = ref(true);

function loadReminders() {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    if (!raw) {
      remindersOn.value = true;
      return;
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") {
      remindersOn.value = true;
      return;
    }
    remindersOn.value = !!(parsed.medication && parsed.service && parsed.followup);
  } catch {
    remindersOn.value = true;
  }
}

function saveReminders(enabled: boolean) {
  uni.setStorageSync(STORAGE_KEY, {
    medication: enabled,
    service: enabled,
    followup: enabled,
  });
}

function resolveSwitchValue(event: unknown): boolean {
  const detail = (event as { detail?: { value?: unknown } } | null)?.detail;
  return !!detail?.value;
}

function onToggleReminders(event: unknown) {
  const enabled = resolveSwitchValue(event);
  remindersOn.value = enabled;
  saveReminders(enabled);
  uni.showToast({
    title: enabled ? "已开启提醒" : "已关闭提醒",
    icon: "none",
  });
}

function openBindPage() {
  const url = "/pages/auth/bind?rebind=1&returnUrl=%2Fpages%2Fsettings%2Findex";
  uni.redirectTo({
    url,
    fail: () => uni.navigateTo({ url }),
  });
}

function onRebindPhone() {
  uni.showModal({
    title: "更换绑定手机号",
    content: "新号码验证成功前，当前账号和原手机号会保持有效。",
    success: (res) => {
      if (!res.confirm) return;
      openBindPage();
    },
  });
}

function leaveToMine(title: string) {
  uni.showToast({ title, icon: "none" });
  setTimeout(() => {
    uni.switchTab({ url: "/pages/mine/index" });
  }, 400);
}

function onLogout() {
  uni.showModal({
    title: "退出登录",
    content:
      "将清除本机登录态。再次使用需手动点击「使用微信登录」。同一微信若仍绑定手机号，登录后会回到原账号；若要彻底断开请使用「解除微信绑定」。",
    confirmText: "退出",
    cancelText: "取消",
    success: (res) => {
      if (!res.confirm) return;
      void (async () => {
        try {
          await auth.logout();
        } catch {
          auth.clear();
          setExplicitSignedOut(true);
        }
        leaveToMine("已退出登录");
      })();
    },
  });
}

function onUnbindWechat() {
  uni.showModal({
    title: "解除微信绑定",
    content:
      "将断开当前微信与账号的关联并退出登录。之后需重新绑定手机号才能使用。此操作影响较大，请确认。",
    confirmText: "确认解除",
    confirmColor: "#A33C33",
    cancelText: "取消",
    success: (res) => {
      if (!res.confirm) return;
      void (async () => {
        try {
          if (!(await ensureLogin(SETTINGS_URL))) return;
          await mpUnbindPhone();
          auth.clear();
          setExplicitSignedOut(true);
          leaveToMine("已解除微信绑定");
        } catch (error) {
          const title =
            error instanceof ApiError ? error.message : "解除失败，请稍后重试";
          uni.showToast({ title: String(title).slice(0, 40), icon: "none" });
        }
      })();
    },
  });
}

onMounted(async () => {
  loadReminders();
  if (!(await ensureLogin(SETTINGS_URL))) return;
  if (getMpToken()) void auth.refreshMe().catch(() => {});
});
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="section">
      <AppSectionHeader title="消息提醒" />
      <view class="card">
        <view class="switch-row">
          <view class="switch-row__icon">
            <AppIcon name="reminder" :size="28" tone="primary" />
          </view>
          <view class="switch-row__copy">
            <text class="switch-row__title">消息与任务提醒</text>
            <text class="switch-row__desc">用药、服务进度与复诊提示</text>
          </view>
          <switch
            class="switch-row__ctrl"
            color="#176B52"
            :checked="remindersOn"
            @change="onToggleReminders"
          />
        </view>
      </view>
    </view>

    <view class="section">
      <AppSectionHeader title="账号" />
      <view class="card card--list">
        <AppListRow
          icon="phone-bind"
          title="更换绑定手机号"
          :meta="accountMeta"
          @tap="onRebindPhone"
        />
        <AppListRow
          icon="account-logout"
          title="退出登录"
          meta="清除本机会话"
          danger
          @tap="onLogout"
        />
        <AppListRow
          icon="wechat-unbind"
          title="解除微信绑定"
          meta="断开微信与账号关联"
          danger
          @tap="onUnbindWechat"
        />
      </view>
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
.section {
  margin-bottom: 18px;
}
.card {
  overflow: hidden;
  border: 1px solid #e4ebe6;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(16, 52, 40, 0.04);
}
.card--list {
  padding: 2px 14px;
}
.switch-row {
  display: flex;
  padding: 14px;
  align-items: center;
  gap: 10px;
}
.switch-row__icon {
  position: relative;
  display: block;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  overflow: hidden;
}
.switch-row__copy {
  min-width: 0;
  flex: 1;
}
.switch-row__title,
.switch-row__desc {
  display: block;
}
.switch-row__title {
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 700;
  line-height: 1.35;
}
.switch-row__desc {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.4;
}
.switch-row__ctrl {
  flex-shrink: 0;
  transform: scale(0.9);
  transform-origin: right center;
}
</style>
