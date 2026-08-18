<script setup lang="ts">
/**
 * 新增 / 编辑个人服务地址（云端）
 */
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";
import { getAddress, syncAddresses, upsertAddress } from "../../utils/serviceAddress";

const appStore = useAppStore();
const auth = useAuthStore();
const addressId = ref("");
const fromCheckout = ref(false);
const returnUrl = ref("");
const saving = ref(false);
const regionCodes = ref<string[]>([]);

const form = ref({
  name: "",
  phone: "",
  region: "",
  detail: "",
  isDefault: true,
});

const doctorId = computed(() => appStore.doctor?.id || appStore.sourceDoctorId || 0);
const isEdit = computed(() => !!addressId.value);

const regionDisplay = computed(() => {
  if (regionCodes.value.length >= 3) {
    return regionCodes.value.filter(Boolean).join(" ");
  }
  return form.value.region || "";
});

function parseRegionToCodes(region: string): string[] {
  const text = String(region || "").trim();
  if (!text) return [];
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("")];
  const m = text.match(/^(.+?(?:省|自治区|特别行政区|市))(.+?市|.+?州|.+?地区|.+?盟)?(.+?(?:区|县|市|旗))?$/);
  if (m) {
    return [m[1] || "", m[2] || "", m[3] || ""].filter(Boolean);
  }
  return [];
}

onLoad(async (query) => {
  addressId.value = String(query?.id || "").trim();
  fromCheckout.value = String(query?.from || "") === "checkout";
  returnUrl.value = decodeURIComponent(String(query?.returnUrl || "").trim());
  const ok = await ensureLogin(
    `/pages/address/edit${addressId.value ? `?id=${addressId.value}` : ""}`
  );
  if (!ok) return;

  try {
    await syncAddresses(doctorId.value);
  } catch {
    /* 缓存兜底 */
  }

  if (addressId.value) {
    const row = getAddress(addressId.value, doctorId.value);
    if (row) {
      form.value = {
        name: row.name,
        phone: row.phone,
        region: row.region,
        detail: row.detail,
        isDefault: !!row.isDefault,
      };
      regionCodes.value = parseRegionToCodes(row.region);
      return;
    }
  }
  form.value.name = String(auth.profileName || "").trim();
  form.value.phone = "";
});

function onRegionChange(e: { detail?: { value?: string[] } }) {
  const value = e?.detail?.value;
  if (!Array.isArray(value) || value.length < 3) return;
  regionCodes.value = value.map((v) => String(v || "").trim());
  form.value.region = regionCodes.value.filter(Boolean).join(" ");
}

async function save() {
  if (saving.value) return;
  const phone = String(form.value.phone || "").trim();
  if (!/^1\d{10}$/.test(phone)) {
    uni.showToast({ title: "请填写正确手机号", icon: "none" });
    return;
  }
  if (!form.value.region || regionCodes.value.length < 3) {
    uni.showToast({ title: "请选择省市区", icon: "none" });
    return;
  }
  if (!String(form.value.detail || "").trim()) {
    uni.showToast({ title: "请填写详细地址", icon: "none" });
    return;
  }
  saving.value = true;
  try {
    await upsertAddress(
      {
        id: addressId.value || undefined,
        name: form.value.name,
        phone,
        region: form.value.region,
        detail: form.value.detail,
        isDefault: form.value.isDefault,
      },
      doctorId.value
    );
    uni.showToast({ title: "已保存", icon: "success" });
    setTimeout(() => {
      if (fromCheckout.value && returnUrl.value) {
        uni.redirectTo({
          url: returnUrl.value,
          fail: () => uni.navigateBack(),
        });
        return;
      }
      if (fromCheckout.value) {
        uni.navigateBack({
          fail: () =>
            uni.redirectTo({
              url: "/pages/address/index?from=checkout",
            }),
        });
        return;
      }
      uni.navigateBack({
        fail: () => uni.redirectTo({ url: "/pages/address/index" }),
      });
    }, 400);
  } catch (e: any) {
    saving.value = false;
    uni.showToast({ title: e?.message || "保存失败", icon: "none" });
  }
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="banner">
      <text class="banner__title">{{ isEdit ? "编辑地址" : "新增地址" }}</text>
      <text class="banner__sub">请填写真实联系信息，便于服务安排与物流送达</text>
    </view>

    <view class="card">
      <text class="label">联系人</text>
      <input
        v-model="form.name"
        class="input"
        maxlength="32"
        placeholder="请输入姓名"
        placeholder-class="ph"
      />

      <text class="label">手机号</text>
      <input
        v-model="form.phone"
        class="input"
        type="number"
        maxlength="11"
        placeholder="请输入 11 位手机号"
        placeholder-class="ph"
      />

      <text class="label">省市区</text>
      <picker mode="region" :value="regionCodes" @change="onRegionChange">
        <view class="picker pressable">
          <text class="picker__text" :class="{ 'picker__text--ph': !regionDisplay }">
            {{ regionDisplay || "请选择省、市、区" }}
          </text>
          <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
        </view>
      </picker>

      <text class="label">详细地址</text>
      <textarea
        v-model="form.detail"
        class="textarea"
        maxlength="120"
        auto-height
        placeholder="请填写街道、门牌号等"
        placeholder-class="ph"
      />

      <view class="check pressable" @click="form.isDefault = !form.isDefault">
        <checkbox :checked="form.isDefault" color="#176b52" />
        <text class="check__text">设为默认地址</text>
      </view>
    </view>

    <text class="secure">信息将加密存储在云端，仅用于服务履约</text>

    <AppButton
      class="save-btn"
      :label="saving ? '保存中…' : isEdit ? '保存地址' : '保存并使用'"
      icon="action-confirm"
      variant="primary"
      size="md"
      block
      :disabled="saving"
      @tap="save"
    />
  </view>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 16px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #f5f7f6;
  --font-caption: 15px;
  --font-secondary: 17px;
  --font-body: 19px;
  --font-subheading: 21px;
  font-size: var(--font-body);
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
.card {
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 61, 46, 0.05);
}
.label {
  display: block;
  margin: 16px 0 8px;
  color: #17201c;
  font-size: var(--font-secondary);
  font-weight: 750;
  line-height: 1.4;
}
.label:first-child {
  margin-top: 0;
}
.input,
.textarea,
.picker {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  border: 1px solid #e4ebe6;
  border-radius: 12px;
  background: #f7faf8;
  color: #17201c;
  font-size: var(--font-body);
  line-height: 1.4;
}
.picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.picker__text {
  flex: 1;
  min-width: 0;
  color: #17201c;
  font-size: var(--font-body);
  line-height: 1.4;
}
.picker__text--ph {
  color: #9aa39d;
}
.textarea {
  min-height: 96px;
  width: 100%;
}
.ph {
  color: #9aa39d;
  font-size: var(--font-body);
  line-height: 1.4;
}
.check {
  display: flex;
  margin-top: 18px;
  align-items: center;
  gap: 10px;
}
.check__text {
  color: #44514a;
  font-size: var(--font-secondary);
  font-weight: 700;
}
.secure {
  display: block;
  margin-bottom: 14px;
  color: #9aa49d;
  font-size: 12px;
  text-align: center;
}
.save-btn {
  width: 100%;
}
.elder .label,
.elder .check__text,
.elder .input,
.elder .textarea,
.elder .picker__text {
  font-size: var(--font-subheading);
}
</style>
