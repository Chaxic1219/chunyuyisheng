<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import type { HealthCategory } from "@chunyu/patient-design/types";
import AppButton from "../../components/AppButton.vue";
import AppIcon from "../../components/AppIcon.vue";
import AppPageHeader from "../../components/AppPageHeader.vue";
import { createMyHealthRecord, getMyHealthCategories } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
const categories = ref<HealthCategory[]>([]);
const selectedCategory = ref("");
const title = ref("");
const summary = ref("");
const recordedAt = ref(new Date().toISOString().slice(0, 10));
const imagePaths = ref<string[]>([]);
const loading = ref(false);
const submitting = ref(false);
const step = ref<"pick" | "form">("pick");

const selectedMeta = computed(() => categories.value.find((c) => c.key === selectedCategory.value) || null);

onLoad(async (query) => {
  const ok = await ensureLogin("/pages/records/add");
  if (!ok) return;
  loading.value = true;
  try {
    categories.value = await getMyHealthCategories();
  } finally {
    loading.value = false;
  }
  const preset = String(query?.category || "").trim();
  if (preset && categories.value.some((c) => c.key === preset)) {
    selectedCategory.value = preset;
    step.value = "form";
  }
});

function pickCategory(key: string) {
  selectedCategory.value = key;
  step.value = "form";
}

function backToPick() {
  step.value = "pick";
}

async function chooseImages() {
  const remain = Math.max(0, 3 - imagePaths.value.length);
  if (!remain) {
    uni.showToast({ title: "最多上传 3 张", icon: "none" });
    return;
  }
  const res = await uni.chooseImage({ count: remain, sizeType: ["compressed"] });
  const paths = Array.isArray(res.tempFilePaths) ? res.tempFilePaths : [];
  imagePaths.value = [...imagePaths.value, ...paths].slice(0, 3);
}

function removeImage(idx: number) {
  imagePaths.value = imagePaths.value.filter((_, i) => i !== idx);
}

function onDateChange(e: { detail?: { value?: string } }) {
  recordedAt.value = String(e.detail?.value || recordedAt.value);
}

async function submitRecord() {
  if (!selectedCategory.value) {
    uni.showToast({ title: "请选择记录类型", icon: "none" });
    return;
  }
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle) {
    uni.showToast({ title: "请填写标题", icon: "none" });
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const created = await createMyHealthRecord({
      category: selectedCategory.value,
      title: trimmedTitle,
      summary: summary.value.trim(),
      recordedAt: recordedAt.value,
      imagePaths: imagePaths.value,
    });
    uni.showToast({ title: "已提交，待确认", icon: "success" });
    setTimeout(() => {
      uni.redirectTo({
        url: `/pages/records/detail?id=${encodeURIComponent(String(created.id))}`,
      });
    }, 400);
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "提交失败";
    uni.showToast({ title: message, icon: "none" });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page" :class="{ elder: store.elderMode }">
    <AppPageHeader title="补充健康记录" />

    <view v-if="loading" class="state-card">正在加载记录类型…</view>

    <template v-else-if="step === 'pick'">
      <text class="lead">请选择要补充的资料类型</text>
      <view class="category-grid">
        <view
          v-for="category in categories"
          :key="category.key"
          class="category-card pressable"
          @tap="pickCategory(category.key)"
        >
          <view class="category-card__icon"><AppIcon name="health-record" :size="26" /></view>
          <text class="category-card__label">{{ category.label }}</text>
          <text class="category-card__hint">{{ category.hint }}</text>
        </view>
      </view>
    </template>

    <template v-else>
      <view class="form-card">
        <view class="form-row">
          <text class="form-row__label">类型</text>
          <text class="form-row__value">{{ selectedMeta?.label || selectedCategory }}</text>
          <text class="form-row__action pressable" @tap="backToPick">更换</text>
        </view>
        <view class="form-field">
          <text class="form-field__label">标题</text>
          <input v-model="title" class="form-field__input" placeholder="例如：2026年8月血常规检查" maxlength="200" />
        </view>
        <view class="form-field">
          <text class="form-field__label">记录日期</text>
          <picker mode="date" :value="recordedAt" @change="onDateChange">
            <view class="form-field__input picker-value">{{ recordedAt }}</view>
          </picker>
        </view>
        <view class="form-field">
          <text class="form-field__label">摘要（选填）</text>
          <textarea
            v-model="summary"
            class="form-field__textarea"
            placeholder="可填写关键指标、诊断或用药说明"
            maxlength="4000"
          />
        </view>
        <view class="form-field">
          <text class="form-field__label">附件（选填，最多 3 张）</text>
          <view class="image-grid">
            <image
              v-for="(path, idx) in imagePaths"
              :key="path"
              class="image-grid__img"
              :src="path"
              mode="aspectFill"
              @tap="removeImage(idx)"
            />
            <view v-if="imagePaths.length < 3" class="image-grid__add pressable" @tap="chooseImages">
              <AppIcon name="quick-upload" :size="24" />
              <text>上传图片</text>
            </view>
          </view>
        </view>
      </view>
      <AppButton
        label="提交并进入待确认"
        icon="action-confirm"
        variant="primary"
        :disabled="submitting"
        @tap="submitRecord"
      />
      <text class="hint">提交后可在健康档案「需要你确认」中核对，确认后纳入正式档案。</text>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 0 14px calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.state-card,
.lead,
.hint {
  display: block;
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}
.state-card {
  margin-top: 48px;
  text-align: center;
}
.lead {
  margin: 12px 0;
  color: #17201c;
  font-weight: 700;
}
.hint {
  margin-top: 10px;
  line-height: 1.55;
}
.category-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.category-card {
  width: calc(50% - 5px);
  padding: 12px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
}
.category-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #ecf2ff;
}
.category-card__label,
.category-card__hint {
  display: block;
}
.category-card__label {
  margin-top: 10px;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.category-card__hint {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  line-height: 1.45;
}
.form-card {
  margin: 12px 0;
  padding: 14px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
}
.form-row,
.form-field {
  margin-bottom: 14px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-row__label,
.form-field__label {
  color: #6a756f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.form-row__value {
  flex: 1;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  font-weight: 700;
}
.form-row__action {
  color: #2f6b4f;
  font-size: var(--font-caption, 14px);
  font-weight: 700;
}
.form-field__label {
  display: block;
  margin-bottom: 6px;
}
.form-field__input,
.form-field__textarea,
.picker-value {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dce3dd;
  border-radius: 8px;
  background: #fafbfa;
  color: #17201c;
  font-size: var(--font-secondary, 16px);
  box-sizing: border-box;
}
.form-field__textarea {
  min-height: 96px;
}
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.image-grid__img,
.image-grid__add {
  width: 88px;
  height: 88px;
  border-radius: 8px;
}
.image-grid__img {
  background: #edf1ee;
}
.image-grid__add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed #b8c4bd;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
</style>
