/**
 * Generate bind.vue with UTF-8 CJK via \\u escapes (avoids Write-tool corruption).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const vue = `<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { API_BASE, PHONE_BIND_MODE } from "../../api/config";
import { getMpToken, mpBindPhone } from "../../api/auth";
import { useAuthStore } from "../../stores/auth";
import { useAppStore } from "../../stores/app";

const auth = useAuthStore();
const app = useAppStore();

const returnUrl = ref("/pages/mine/index");
const phone = ref("");
const smsCode = ref("");
const showSms = ref(PHONE_BIND_MODE === "sms");
const busy = ref(false);
const smsCooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

const showWechat = computed(() => PHONE_BIND_MODE === "wechat" || PHONE_BIND_MODE === "auto");

function doctorId(): number | undefined {
  const n = Number(app.doctor?.id);
  return Number.isFinite(n) ? n : undefined;
}

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
  try {
    if (!app.doctor) await app.load();
  } catch {
    /* ignore */
  }
  if (!getMpToken()) {
    try {
      await auth.silentLogin(doctorId());
    } catch (e: any) {
      uni.showToast({
        title: e?.message || "\\u767b\\u5f55\\u5931\\u8d25\\uff0c\\u8bf7\\u91cd\\u8bd5",
        icon: "none",
      });
    }
  }
  if (PHONE_BIND_MODE === "sms") showSms.value = true;
});

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

async function afterSuccess(data: any) {
  auth.applyMe(data);
  if (!auth.hasProfile) {
    uni.showToast({
      title: "\\u5efa\\u8bae\\u5b8c\\u5584\\u60a3\\u8005\\u6863\\u6848",
      icon: "none",
      duration: 2000,
    });
    setTimeout(goAfterBind, 600);
  } else {
    uni.showToast({ title: "\\u7ed1\\u5b9a\\u6210\\u529f", icon: "success" });
    setTimeout(goAfterBind, 400);
  }
}

async function onWxPhone(e: any) {
  const code = e?.detail?.code;
  if (!code) {
    showSms.value = true;
    uni.showToast({
      title: "\\u8bf7\\u4f7f\\u7528\\u77ed\\u4fe1\\u9a8c\\u8bc1\\u7801\\u7ed1\\u5b9a",
      icon: "none",
    });
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    const data = await mpBindPhone({ phoneCode: String(code), doctorId: doctorId() });
    await afterSuccess(data);
  } catch (err: any) {
    showSms.value = true;
    uni.showToast({
      title: err?.message || "\\u7ed1\\u5b9a\\u5931\\u8d25",
      icon: "none",
    });
  } finally {
    busy.value = false;
  }
}

function startCooldown(sec = 60) {
  smsCooldown.value = sec;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    smsCooldown.value -= 1;
    if (smsCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
}

async function sendSms() {
  const p = phone.value.trim();
  if (!/^1[3-9]\\d{9}$/.test(p)) {
    uni.showToast({ title: "\\u8bf7\\u8f93\\u5165\\u6b63\\u786e\\u624b\\u673a\\u53f7", icon: "none" });
    return;
  }
  if (smsCooldown.value > 0 || busy.value) return;
  busy.value = true;
  try {
    const body: Record<string, unknown> = { phone: p };
    const d = doctorId();
    if (d != null) body.doctorId = d;
    const res = await uni.request({
      url: \`\${API_BASE}/api/sms/send\`,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: body,
      timeout: 15000,
    });
    const data: any = typeof res.data === "string" ? JSON.parse(res.data as string) : res.data;
    if ((res.statusCode || 0) >= 400 || data?.error) {
      throw new Error(data?.error || "\\u53d1\\u9001\\u5931\\u8d25");
    }
    if (data?.demo && data?.code) smsCode.value = String(data.code);
    uni.showToast({ title: "\\u9a8c\\u8bc1\\u7801\\u5df2\\u53d1\\u9001", icon: "none" });
    startCooldown(60);
  } catch (err: any) {
    uni.showToast({ title: err?.message || "\\u53d1\\u9001\\u5931\\u8d25", icon: "none" });
  } finally {
    busy.value = false;
  }
}

async function bindBySms() {
  const p = phone.value.trim();
  const code = smsCode.value.trim();
  if (!/^1[3-9]\\d{9}$/.test(p)) {
    uni.showToast({ title: "\\u8bf7\\u8f93\\u5165\\u6b63\\u786e\\u624b\\u673a\\u53f7", icon: "none" });
    return;
  }
  if (!code) {
    uni.showToast({ title: "\\u8bf7\\u8f93\\u5165\\u9a8c\\u8bc1\\u7801", icon: "none" });
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    const data = await mpBindPhone({
      phone: p,
      smsCode: code,
      doctorId: doctorId(),
    });
    await afterSuccess(data);
  } catch (err: any) {
    uni.showToast({ title: err?.message || "\\u7ed1\\u5b9a\\u5931\\u8d25", icon: "none" });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="page ambient-bg">
    <view class="card">
      <text class="title">\\u7ed1\\u5b9a\\u624b\\u673a\\u53f7</text>
      <text class="hint">\\u7ed1\\u5b9a\\u540e\\u53ef\\u4fdd\\u5b58\\u6863\\u6848\\u4e0e\\u54a8\\u8be2\\u8bb0\\u5f55\\uff0c\\u4ec5\\u533b\\u751f\\u56e2\\u961f\\u53ef\\u89c1</text>

      <button
        v-if="showWechat && !showSms"
        class="btn btn-primary"
        open-type="getPhoneNumber"
        :loading="busy"
        @getphonenumber="onWxPhone"
      >
        \\u5fae\\u4fe1\\u624b\\u673a\\u53f7\\u4e00\\u952e\\u7ed1\\u5b9a
      </button>

      <button
        v-if="showWechat && !showSms"
        class="btn btn-ghost"
        @click="showSms = true"
      >
        \\u4f7f\\u7528\\u77ed\\u4fe1\\u9a8c\\u8bc1\\u7801
      </button>

      <view v-if="showSms || PHONE_BIND_MODE === 'sms'" class="sms">
        <view class="field">
          <text class="label">\\u624b\\u673a\\u53f7</text>
          <input
            class="input"
            type="number"
            maxlength="11"
            :placeholder="'\\u8bf7\\u8f93\\u5165\\u624b\\u673a\\u53f7'"
            v-model="phone"
          />
        </view>
        <view class="field field-row">
          <view class="field-grow">
            <text class="label">\\u9a8c\\u8bc1\\u7801</text>
            <input
              class="input"
              type="number"
              maxlength="6"
              :placeholder="'\\u8bf7\\u8f93\\u5165\\u9a8c\\u8bc1\\u7801'"
              v-model="smsCode"
            />
          </view>
          <button
            class="btn btn-sms"
            :disabled="smsCooldown > 0 || busy"
            @click="sendSms"
          >
            {{ smsCooldown > 0 ? smsCooldown + 's' : '\\u83b7\\u53d6\\u9a8c\\u8bc1\\u7801' }}
          </button>
        </view>
        <button class="btn btn-primary" :loading="busy" @click="bindBySms">
          \\u786e\\u8ba4\\u7ed1\\u5b9a
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24px 16px;
  background: #fafbfc;
  box-sizing: border-box;
}
.card {
  padding: 20px 16px;
  border: 1px solid #e5eaf2;
  border-radius: 8px;
  background: #fff;
}
.title {
  display: block;
  color: #2a3547;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.hint {
  display: block;
  margin-top: 8px;
  margin-bottom: 20px;
  color: #5a6a85;
  font-size: 13px;
  line-height: 1.55;
}
.btn {
  width: 100%;
  margin: 0 0 12px;
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 44px;
}
.btn::after {
  border: 0;
}
.btn-primary {
  background: #5d87ff;
  color: #fff;
}
.btn-ghost {
  background: #f5f7fa;
  color: #2a3547;
}
.btn-sms {
  width: auto;
  min-width: 110px;
  margin: 0;
  margin-top: 22px;
  padding: 0 12px;
  background: #eef2ff;
  color: #5d87ff;
  font-size: 13px;
  white-space: nowrap;
}
.btn[disabled] {
  opacity: 0.55;
}
.sms {
  margin-top: 4px;
}
.field {
  margin-bottom: 14px;
}
.field-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.field-grow {
  flex: 1;
  min-width: 0;
}
.label {
  display: block;
  margin-bottom: 6px;
  color: #52627a;
  font-size: 13px;
  font-weight: 600;
}
.input {
  height: 44px;
  padding: 0 12px;
  border: 1px solid #e5eaf2;
  border-radius: 8px;
  background: #fff;
  color: #2a3547;
  font-size: 15px;
  box-sizing: border-box;
}
</style>
`;

const outDir = path.join(root, "src", "pages", "auth");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "bind.vue");
// Source keeps ASCII \\uXXXX; decode to real UTF-8 CJK before write.
const decoded = vue.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
  String.fromCharCode(parseInt(h, 16))
);
fs.writeFileSync(outFile, decoded, "utf8");
const cjk = (decoded.match(/[\u4e00-\u9fff]/g) || []).length;
console.log("wrote", path.relative(root, outFile), "cjk=", cjk);
