<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { fetchArchiveFormPrefill, type FormInitialValue } from "../../api/patient";
import { getMpToken } from "../../api/auth";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";

const store = useAppStore();
const auth = useAuthStore();
const initialValues = ref<Record<string, FormInitialValue> | null>(null);

onMounted(async () => {
  await store.load();
  // 懒登录：不强制登录；但有 token 时先静默恢复登录态，避免已登录用户冷启动
  // phoneBound 内存态为空而丢失档案预填（2026-08-05 冷启动缺陷修复）
  if (getMpToken() && !auth.phoneBound) {
    try {
      await auth.refreshMe();
    } catch {
      /* 静默：恢复失败不影响表单填写 */
    }
  }
  if (auth.phoneBound) initialValues.value = await fetchArchiveFormPrefill();
});
onShow(() => {
  // 懒登录：填写/提交表单不强制登录（表单自带手机号收集，提交走公开接口）
});
const config = computed(() => store.content?.contactForm);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note radius bg-blue light">
      <AppIcon name="lock" :size="27" color="#52627A" />
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
      <AppIcon name="form" :size="34" />
      <text class="unavailable-title">联络服务暂不可用</text>
      <text>当前未配置联络表，请稍后再试。</text>
    </view>
  </view>
</template>

<style scoped>
.form-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
</style>
