<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useAppStore } from "../../stores/app";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";

const store = useAppStore();
const openIdx = ref<number | null>(0);
onMounted(() => store.load());

function toggle(index: number) {
  openIdx.value = openIdx.value === index ? null : index;
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom faq-page" :class="{ elder: store.elderMode }">
    <view class="faq-intro cu-card radius shadow">
      <view class="faq-intro__icon radius bg-blue light"><AppIcon name="help-center" :size="34" /></view>
      <view>
        <text class="faq-intro__title">常见问题</text>
        <text class="faq-intro__copy">关于春雨健康助手、服务时效与隐私保护的说明</text>
      </view>
    </view>

    <view v-if="store.loading && !store.faq.length" class="state-card">正在加载常见问题…</view>
    <view v-else-if="store.error" class="state-card faq-state">
      <text>{{ store.error }}</text>
      <AppButton label="重新加载" icon="action-refresh" size="sm" @tap="store.load" />
    </view>
    <view v-else-if="!store.faq.length" class="state-card">暂无常见问题</view>

    <view v-else class="faq-list">
      <view
        v-for="(item, index) in store.faq"
        :key="index"
        class="faq-card cu-card radius shadow pressable"
        aria-role="button"
        :aria-expanded="openIdx === index"
        :aria-label="`${item.q}，${openIdx === index ? '已展开' : '未展开'}`"
        @click="toggle(index)"
      >
        <view class="faq-question">
          <view class="faq-number radius bg-blue light">{{ String(index + 1).padStart(2, "0") }}</view>
          <text>{{ item.q }}</text>
          <view class="faq-toggle" :class="{ 'faq-toggle--open': openIdx === index }">
            <AppIcon name="nav-chevron-right" :size="18" tone="muted" />
          </view>
        </view>
        <view v-if="openIdx === index" class="faq-answer">
          <text>{{ item.a }}</text>
        </view>
      </view>
    </view>

    <view class="faq-footer">
      <AppIcon name="consult-doctor" :size="24" tone="muted" />
      <text>仍有疑问？可返回首页进入在线咨询</text>
    </view>
  </view>
</template>

<style scoped>
.faq-page { padding: 16px; }
.faq-intro { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--surface, #fff); }
.faq-intro__icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 36px; height: 36px; }
.faq-intro__title, .faq-intro__copy { display: block; }
.faq-intro__title { color: var(--text-strong, #2a3547); font-size: var(--font-subheading, 19px); font-weight: 600; line-height: 1.35; }
.faq-intro__copy { margin-top: 4px; color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.55; }
.faq-list { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.faq-card { padding: 14px; background: var(--surface, #fff); }
.faq-question { display: grid; grid-template-columns: 28px 1fr 28px; align-items: center; gap: 10px; color: var(--text-strong, #2a3547); font-size: var(--font-secondary, 16px); font-weight: 600; line-height: 1.45; }
.faq-number { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--primary, #5d87ff); font-size: var(--font-caption, 14px); font-weight: 600; }
.faq-toggle { display: flex; align-items: center; justify-content: center; transition: transform 160ms ease-out; }
.faq-toggle--open { transform: rotate(90deg); }
.faq-answer { margin: 12px 0 0 38px; padding-top: 12px; border-top: 1px solid var(--line-soft, #eef2f6); color: var(--text-secondary, #5a6a85); font-size: var(--font-secondary, 16px); line-height: 1.6; }
.faq-state { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.state-card { margin-top: 12px; }
.faq-footer { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; color: var(--text-secondary, #5a6a85); font-size: var(--font-caption, 14px); line-height: 1.5; }
</style>
