<script setup lang="ts">
/** 补充服务资料：步骤条 + 分区卡片（症状标签 + 自由补充） */
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { submitPostoperativeProfile } from "../../api/servicePackage";
import { uploadVoucher } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { mpVisual } from "../../utils/mediaSrc";

const appStore = useAppStore();
const auth = useAuthStore();
const orderId = ref(0);
const submitting = ref(false);
const selectedTags = ref<string[]>([]);
const extraNote = ref("");

const form = ref({
  surgeryDate: "",
  surgeryType: "",
  recoveryStage: "",
  voucherUrls: [] as string[],
});

const SYMPTOM_TAGS = ["疼痛", "肿胀", "活动受限", "睡眠受影响"] as const;

const ICON_SURGERY = mpVisual("service-ui/surgery.png");
const ICON_HEART = mpVisual("service-ui/health-heart.png");
const ICON_REPORT = mpVisual("service-ui/report.png");
const ICON_UPLOAD = mpVisual("service-ui/upload-cloud.png");
const ICON_SHIELD = mpVisual("service-ui/shield.png");
const ICON_HELP = mpVisual("service-ui/help.png");

const dateLabel = computed(() => {
  const raw = form.value.surgeryDate;
  if (!raw) return "请选择";
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return raw;
  const d = new Date(t);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
});

onLoad((query) => {
  orderId.value = Number(query?.orderId || 0);
});

function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag);
  if (i >= 0) selectedTags.value.splice(i, 1);
  else selectedTags.value.push(tag);
}

function buildSymptoms(): string {
  const tags = selectedTags.value.join("、");
  const extra = extraNote.value.trim();
  if (tags && extra) return `${tags}；${extra}`;
  return tags || extra;
}

async function pickVoucher() {
  try {
    const remain = 9 - form.value.voucherUrls.length;
    if (remain <= 0) {
      uni.showToast({ title: "最多上传 9 份", icon: "none" });
      return;
    }
    const choose = await uni.chooseImage({ count: Math.min(remain, 3), sizeType: ["compressed"] });
    const paths = choose.tempFilePaths || [];
    if (!paths.length) return;
    const doctorId = String(appStore.doctor?.id || appStore.sourceDoctorId || "0");
    for (const path of paths) {
      const fs = uni.getFileSystemManager();
      const base64: string = await new Promise((resolve, reject) => {
        fs.readFile({
          filePath: path,
          encoding: "base64",
          success: (r) => resolve(String(r.data || "")),
          fail: reject,
        });
      });
      const dataUrl = `data:image/jpeg;base64,${base64}`;
      const up = await uploadVoucher(doctorId, dataUrl, async () => {
        await auth.refreshMe();
        return !!auth.phoneBound;
      });
      form.value.voucherUrls.push(up.url);
    }
    uni.showToast({ title: "已上传", icon: "success" });
  } catch (e: any) {
    uni.showToast({ title: e?.message || "上传失败", icon: "none" });
  }
}

async function submit() {
  if (submitting.value) return;
  if (!orderId.value) return;
  const surgeryDate = form.value.surgeryDate.trim();
  const surgeryType = form.value.surgeryType.trim();
  const recoveryStage = form.value.recoveryStage.trim();
  const symptoms = buildSymptoms();
  if (!surgeryDate || !surgeryType || !recoveryStage || !symptoms) {
    uni.showToast({ title: "请完整填写资料", icon: "none" });
    return;
  }
  submitting.value = true;
  try {
    await submitPostoperativeProfile(orderId.value, {
      surgeryDate,
      surgeryType,
      laterality: symptoms,
      recoveryStage,
      voucherUrls: form.value.voucherUrls,
    });
    uni.showToast({ title: "已提交，等待审核", icon: "success" });
    setTimeout(() => {
      uni.redirectTo({ url: "/pages/services/mine-services" });
    }, 600);
  } catch (e: any) {
    submitting.value = false;
    uni.showToast({ title: e?.message || "提交失败", icon: "none" });
  }
}

function onDateChange(e: { detail?: { value?: string } }) {
  form.value.surgeryDate = String(e?.detail?.value || "");
}

function saveDraft() {
  uni.showToast({ title: "已暂存到本页", icon: "none" });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <view class="steps">
      <view class="steps__item steps__item--done">
        <view class="steps__dot steps__dot--done"><text>✓</text></view>
        <text class="steps__label">支付完成</text>
      </view>
      <view class="steps__line steps__line--on" />
      <view class="steps__item steps__item--active">
        <view class="steps__dot steps__dot--active"><text>2</text></view>
        <text class="steps__label steps__label--active">补充资料</text>
      </view>
      <view class="steps__line" />
      <view class="steps__item">
        <view class="steps__dot"><text>3</text></view>
        <text class="steps__label">等待审核</text>
      </view>
    </view>

    <view class="info-bar">
      <image class="info-bar__icon" :src="ICON_HELP" mode="aspectFit" />
      <text class="info-bar__text">资料仅用于医生制定服务计划，通常 1 个工作日内完成审核</text>
    </view>

    <scroll-view scroll-y class="scroll">
      <view class="card">
        <view class="card__head">
          <image class="card__head-icon" :src="ICON_SURGERY" mode="aspectFit" />
          <text class="card__title">手术信息</text>
        </view>
        <picker mode="date" @change="onDateChange">
          <view class="cell pressable">
            <text class="cell__label">手术日期</text>
            <text class="cell__value" :class="{ 'cell__value--ph': !form.surgeryDate }">{{ dateLabel }}</text>
            <text class="cell__arrow">›</text>
          </view>
        </picker>
        <view class="cell">
          <text class="cell__label">手术类型</text>
          <input
            v-model="form.surgeryType"
            class="cell__input"
            type="text"
            placeholder="如：膝关节置换"
            placeholder-class="cell__ph"
          />
        </view>
        <view class="cell cell--last">
          <text class="cell__label">当前恢复阶段</text>
          <input
            v-model="form.recoveryStage"
            class="cell__input"
            type="text"
            placeholder="如：术后第 2 周"
            placeholder-class="cell__ph"
          />
        </view>
      </view>

      <view class="card">
        <view class="card__head">
          <image class="card__head-icon" :src="ICON_HEART" mode="aspectFit" />
          <text class="card__title">当前情况</text>
        </view>
        <view class="tags">
          <view
            v-for="tag in SYMPTOM_TAGS"
            :key="tag"
            class="tag pressable"
            :class="{ 'tag--on': selectedTags.includes(tag) }"
            @click="toggleTag(tag)"
          >
            <text v-if="selectedTags.includes(tag)" class="tag__check">✓ </text>
            <text>{{ tag }}</text>
          </view>
        </view>
        <text class="area-label">还有什么需要医生了解</text>
        <view class="area-wrap">
          <textarea
            v-model="extraNote"
            class="area"
            maxlength="300"
            placeholder="可填写近期变化或特别担心的问题"
            placeholder-class="cell__ph"
            :auto-height="false"
            :adjust-position="true"
          />
          <text class="area-count">{{ extraNote.length }}/300</text>
        </view>
      </view>

      <view class="card">
        <view class="card__head">
          <image class="card__head-icon" :src="ICON_REPORT" mode="aspectFit" />
          <text class="card__title">相关资料 (选填)</text>
        </view>
        <view class="upload pressable" aria-role="button" @click="pickVoucher">
          <image class="upload__icon" :src="ICON_UPLOAD" mode="aspectFit" />
          <text class="upload__title">上传出院小结或检查报告</text>
          <text class="upload__sub">支持图片，最多 9 份</text>
        </view>
        <text v-if="form.voucherUrls.length" class="upload-ok">已上传 {{ form.voucherUrls.length }} 份</text>
        <view class="privacy">
          <image class="privacy__icon" :src="ICON_SHIELD" mode="aspectFit" />
          <text class="privacy__text">资料将加密保存，仅授权人员可查看</text>
        </view>
      </view>

      <view class="draft pressable" @click="saveDraft"><text>保存草稿</text></view>
      <view class="scroll-spacer" />
    </scroll-view>

    <view class="footer">
      <view
        class="footer__btn pressable"
        :class="{ 'footer__btn--disabled': submitting }"
        aria-role="button"
        @click="submit"
      >
        <text>{{ submitting ? "提交中…" : "提交资料" }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  background: #f5f7f6;
}
.steps {
  display: flex;
  padding: 14px 20px 8px;
  align-items: center;
  justify-content: space-between;
  background: #fff;
}
.steps__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.steps__dot {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8ece9;
  color: #8a938d;
  font-size: 12px;
  font-weight: 700;
}
.steps__dot--done,
.steps__dot--active {
  background: #176b52;
  color: #fff;
}
.steps__label {
  color: #8a938d;
  font-size: 12px;
}
.steps__label--active {
  color: #176b52;
  font-weight: 700;
}
.steps__line {
  flex: 1;
  height: 1px;
  margin: 0 8px 18px;
  background: #dce3dd;
}
.steps__line--on {
  background: #176b52;
}
.info-bar {
  display: flex;
  padding: 10px 16px;
  align-items: flex-start;
  gap: 8px;
  background: #eef2ef;
}
.info-bar__icon {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex: 0 0 auto;
}
.info-bar__text {
  flex: 1;
  color: #44524b;
  font-size: 12px;
  line-height: 1.45;
}
.scroll {
  height: calc(100vh - 210px - env(safe-area-inset-bottom));
  padding: 12px 16px 0;
  box-sizing: border-box;
}
.card {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 2px 10px rgba(15, 61, 46, 0.04);
}
.card__head {
  display: flex;
  margin-bottom: 8px;
  align-items: center;
  gap: 8px;
}
.card__head-icon {
  width: 20px;
  height: 20px;
}
.card__title {
  color: #17201c;
  font-size: 16px;
  font-weight: 800;
}
.cell {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #eef2ef;
}
.cell--last {
  border-bottom: 0;
}
.cell__label {
  width: 96px;
  flex: 0 0 auto;
  color: #44524b;
  font-size: 14px;
}
.cell__value,
.cell__input {
  min-width: 0;
  flex: 1;
  color: #17201c;
  font-size: 14px;
  text-align: right;
}
.cell__value--ph,
.cell__ph {
  color: #9aa49d;
}
.cell__input {
  height: 44px;
  text-align: right;
}
.cell__arrow {
  color: #c0c8c3;
  font-size: 18px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 14px;
}
.tag {
  padding: 8px 12px;
  border: 1px solid #176b52;
  border-radius: 999px;
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
  background: #fff;
}
.tag--on {
  background: #176b52;
  color: #fff;
}
.tag__check {
  font-weight: 700;
}
.area-label {
  display: block;
  margin-bottom: 8px;
  color: #44524b;
  font-size: 13px;
}
.area-wrap {
  position: relative;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fafcfa;
}
.area {
  width: 100%;
  min-height: 96px;
  padding: 12px;
  box-sizing: border-box;
  color: #17201c;
  font-size: 14px;
}
.area-count {
  display: block;
  padding: 0 12px 8px;
  color: #9aa49d;
  font-size: 12px;
  text-align: right;
}
.upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 16px;
  border: 1px dashed #c9d7cf;
  border-radius: 14px;
  background: #fafcfa;
}
.upload__icon {
  width: 36px;
  height: 36px;
  margin-bottom: 10px;
}
.upload__title {
  color: #17201c;
  font-size: 14px;
  font-weight: 700;
}
.upload__sub {
  margin-top: 4px;
  color: #8a938d;
  font-size: 12px;
}
.upload-ok {
  display: block;
  margin-top: 8px;
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
}
.privacy {
  display: flex;
  margin-top: 12px;
  align-items: center;
  gap: 6px;
}
.privacy__icon {
  width: 16px;
  height: 16px;
}
.privacy__text {
  color: #8a938d;
  font-size: 12px;
}
.draft {
  margin: 4px 0 8px;
  color: #176b52;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.scroll-spacer {
  height: 16px;
}
.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  box-shadow: 0 -4px 16px rgba(15, 61, 46, 0.06);
}
.footer__btn {
  padding: 14px;
  border-radius: 999px;
  background: #176b52;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
}
.footer__btn--disabled {
  opacity: 0.55;
}
.elder .card__title,
.elder .cell__label,
.elder .cell__value,
.elder .cell__input {
  font-size: 16px;
}
</style>
