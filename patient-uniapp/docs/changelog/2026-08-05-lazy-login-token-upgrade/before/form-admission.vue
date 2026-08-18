<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
onMounted(() => store.load());
onShow(() => {
  void ensureLogin("/pages/form/admission");
});
const config = computed(() => store.content?.admission);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note radius bg-blue light">
      <AppIcon name="bed" :size="22" />
      <text>预约申请不等同于确认床位，具体入院时间以服务通知为准。</text>
    </view>
    <PatientForm v-if="config" :config="config" type="住院预约" />
    <view v-else-if="store.loading" class="state-card form-state">正在加载申请表…</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <AppButton label="重新加载" size="sm" @tap="store.load" />
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="bed" :size="28" />
      <text class="unavailable-title">住院预约暂不可用</text>
      <text>当前未配置申请表，请稍后再试。</text>
    </view>
  </view>
</template>

<style scoped>
.form-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; }
</style>
