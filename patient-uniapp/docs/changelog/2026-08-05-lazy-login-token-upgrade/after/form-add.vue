<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";

const store = useAppStore();
onMounted(() => store.load());
onShow(() => {
  // 懒登录：填写/提交不强制登录（表单自带手机号收集）
});
const config = computed(() => store.content?.addNumber);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note radius bg-blue light">
      <AppIcon name="calendar" :size="27" />
      <text>提交后由服务人员评估号源与病情，工作日将通过手机号反馈。</text>
    </view>
    <PatientForm v-if="config" :config="config" type="加号" />
    <view v-else-if="store.loading" class="state-card form-state">正在加载申请表…</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <AppButton label="重新加载" size="sm" @tap="store.load" />
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="calendar" :size="34" />
      <text class="unavailable-title">加号服务暂不可用</text>
      <text>当前未配置申请表，请稍后再试。</text>
    </view>
  </view>
</template>

<style scoped>
.form-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: var(--font-body, 18px); font-weight: 600; }
</style>
