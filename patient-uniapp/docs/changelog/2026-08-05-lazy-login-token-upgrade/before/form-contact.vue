<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { fetchArchiveFormPrefill, type FormInitialValue } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";
import { useAuthStore } from "../../stores/auth";

const store = useAppStore();
const auth = useAuthStore();
const initialValues = ref<Record<string, FormInitialValue> | null>(null);

onMounted(async () => {
  await store.load();
  if (auth.phoneBound) initialValues.value = await fetchArchiveFormPrefill();
});
onShow(() => {
  void ensureLogin("/pages/form/contact");
});
const config = computed(() => store.content?.contactForm);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note radius bg-blue light">
      <AppIcon name="lock" :size="22" color="#52627A" />
      <text>填写的信息仅用于建立医患联络与后续服务，不会作为公开资料展示。</text>
    </view>
    <PatientForm
      v-if="config"
      :config="config"
      type="联络表"
      archive-mode="contact"
      :initial-values="initialValues || undefined"
    />
    <view v-else-if="store.loading" class="state-card form-state">正在加载联络表…</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <AppButton label="重新加载" size="sm" @tap="store.load" />
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="form" :size="28" />
      <text class="unavailable-title">联络服务暂不可用</text>
      <text>当前未配置联络表，请稍后再试。</text>
    </view>
  </view>
</template>

<style scoped>
.form-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; }
</style>
