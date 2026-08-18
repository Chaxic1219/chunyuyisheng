/**
 * Restore UTF-8 Chinese copy corrupted to "?".
 * Content is ASCII-only in this file (\\u escapes) to avoid tooling encoding loss.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = (rel, text) => {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, text, { encoding: "utf8" });
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  console.log("wrote", rel, "cjk=", cjk);
};

write(
  "src/pages.json",
  `{
  "pages": [
    {
      "path": "pages/index/index",
      "style": {
        "navigationStyle": "custom",
        "navigationBarTitleText": "\u533b\u60a3\u901a",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/consult/index",
      "style": {
        "navigationBarTitleText": "\u5728\u7ebf\u54a8\u8be2",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/mine/index",
      "style": {
        "navigationBarTitleText": "\u6211\u7684",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/archive/index",
      "style": {
        "navigationBarTitleText": "\u60a3\u8005\u6863\u6848",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/form/add",
      "style": {
        "navigationBarTitleText": "\u670d\u52a1\u7533\u8bf7"
      }
    },
    {
      "path": "pages/form/admission",
      "style": {
        "navigationBarTitleText": "\u670d\u52a1\u7533\u8bf7"
      }
    },
    {
      "path": "pages/form/contact",
      "style": {
        "navigationBarTitleText": "\u670d\u52a1\u7533\u8bf7"
      }
    },
    {
      "path": "pages/article/detail",
      "style": {
        "navigationBarTitleText": "\u5065\u5eb7\u6307\u5f15"
      }
    },
    {
      "path": "pages/replies/index",
      "style": {
        "navigationBarTitleText": "\u67e5\u770b\u56de\u590d"
      }
    },
    {
      "path": "pages/faq/index",
      "style": {
        "navigationBarTitleText": "\u5e38\u89c1\u95ee\u9898"
      }
    },
    {
      "path": "pages/archive/profile",
      "style": {
        "navigationBarTitleText": "\u60a3\u8005\u6863\u6848\u586b\u5199",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/archive/health",
      "style": {
        "navigationBarTitleText": "\u5065\u5eb7\u8bb0\u5f55",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/invite/form",
      "style": {
        "navigationBarTitleText": "\u60a3\u8005\u5efa\u6863",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/invite/success",
      "style": {
        "navigationBarTitleText": "\u5efa\u6863\u6210\u529f",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    },
    {
      "path": "pages/auth/bind",
      "style": {
        "navigationBarTitleText": "\u7ed1\u5b9a\u624b\u673a\u53f7",
        "navigationBarBackgroundColor": "#FAFBFC"
      }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "\u533b\u60a3\u901a",
    "navigationBarBackgroundColor": "#FAFBFC",
    "backgroundColor": "#FAFBFC"
  },
  "tabBar": {
    "color": "#6B6B6B",
    "selectedColor": "#5D87FF",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "\u9996\u9875",
        "iconPath": "static/tab/home.png",
        "selectedIconPath": "static/tab/home-active.png"
      },
      {
        "pagePath": "pages/consult/index",
        "text": "\u54a8\u8be2",
        "iconPath": "static/tab/chat.png",
        "selectedIconPath": "static/tab/chat-active.png"
      },
      {
        "pagePath": "pages/mine/index",
        "text": "\u6211\u7684",
        "iconPath": "static/tab/user.png",
        "selectedIconPath": "static/tab/user-active.png"
      }
    ]
  }
}
`,
);

const formStyle = `<style scoped>
.form-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; border: 1px solid var(--line, #e5eaf2); border-radius: var(--r-md, 8px); background: var(--surface-muted, #f5f7fa); color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; }
.state-action { min-height: 40px; padding: 0 16px; border: 0; border-radius: var(--r-md, 8px); background: var(--primary, #5d87ff); color: #fff; font-size: 14px; font-weight: 600; line-height: 40px; }
</style>
`;

write(
  "src/pages/form/add.vue",
  `<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
onMounted(() => store.load());
onShow(() => {
  void ensureLogin("/pages/form/add");
});
const config = computed(() => store.content?.addNumber);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note">
      <AppIcon name="calendar" :size="22" />
      <text>\u63d0\u4ea4\u540e\u7531\u533b\u751f\u56e2\u961f\u8bc4\u4f30\u53f7\u6e90\u4e0e\u75c5\u60c5\uff0c\u5de5\u4f5c\u65e5\u5c06\u901a\u8fc7\u624b\u673a\u53f7\u53cd\u9988\u3002</text>
    </view>
    <PatientForm v-if="config" :config="config" type="\u52a0\u53f7" />
    <view v-else-if="store.loading" class="state-card form-state">\u6b63\u5728\u52a0\u8f7d\u7533\u8bf7\u8868\u2026</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <button class="state-action pressable" @click="store.load">\u91cd\u65b0\u52a0\u8f7d</button>
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="calendar" :size="28" />
      <text class="unavailable-title">\u52a0\u53f7\u670d\u52a1\u6682\u4e0d\u53ef\u7528</text>
      <text>\u5f53\u524d\u672a\u914d\u7f6e\u7533\u8bf7\u8868\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</text>
    </view>
  </view>
</template>

${formStyle}`,
);

write(
  "src/pages/form/admission.vue",
  `<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
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
    <view class="service-note">
      <AppIcon name="bed" :size="22" />
      <text>\u9884\u7ea6\u7533\u8bf7\u4e0d\u7b49\u540c\u4e8e\u786e\u8ba4\u5e8a\u4f4d\uff0c\u5177\u4f53\u5165\u9662\u65f6\u95f4\u4ee5\u533b\u751f\u56e2\u961f\u901a\u77e5\u4e3a\u51c6\u3002</text>
    </view>
    <PatientForm v-if="config" :config="config" type="\u4f4f\u9662\u9884\u7ea6" />
    <view v-else-if="store.loading" class="state-card form-state">\u6b63\u5728\u52a0\u8f7d\u7533\u8bf7\u8868\u2026</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <button class="state-action pressable" @click="store.load">\u91cd\u65b0\u52a0\u8f7d</button>
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="bed" :size="28" />
      <text class="unavailable-title">\u4f4f\u9662\u9884\u7ea6\u6682\u4e0d\u53ef\u7528</text>
      <text>\u5f53\u524d\u672a\u914d\u7f6e\u7533\u8bf7\u8868\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</text>
    </view>
  </view>
</template>

${formStyle}`,
);

write(
  "src/pages/form/contact.vue",
  `<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PatientForm from "../../components/PatientForm.vue";
import AppIcon from "../../components/AppIcon.vue";
import { useAppStore } from "../../stores/app";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
onMounted(() => store.load());
onShow(() => {
  void ensureLogin("/pages/form/contact");
});
const config = computed(() => store.content?.contactForm);
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom form-page" :class="{ elder: store.elderMode }">
    <view class="service-note">
      <AppIcon name="lock" :size="22" color="#52627A" />
      <text>\u586b\u5199\u7684\u4fe1\u606f\u4ec5\u7528\u4e8e\u5efa\u7acb\u533b\u60a3\u8054\u7edc\u4e0e\u540e\u7eed\u670d\u52a1\uff0c\u4e0d\u4f1a\u4f5c\u4e3a\u516c\u5f00\u8d44\u6599\u5c55\u793a\u3002</text>
    </view>
    <PatientForm v-if="config" :config="config" type="\u8054\u7edc\u8868" />
    <view v-else-if="store.loading" class="state-card form-state">\u6b63\u5728\u52a0\u8f7d\u8054\u7edc\u8868\u2026</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <button class="state-action pressable" @click="store.load">\u91cd\u65b0\u52a0\u8f7d</button>
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="form" :size="28" />
      <text class="unavailable-title">\u8054\u7edc\u670d\u52a1\u6682\u4e0d\u53ef\u7528</text>
      <text>\u5f53\u524d\u672a\u914d\u7f6e\u8054\u7edc\u8868\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</text>
    </view>
  </view>
</template>

${formStyle}`,
);

const inviteStyle = `<style scoped>
.invite-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; border: 1px solid var(--line, #e5eaf2); border-radius: var(--r-md, 8px); background: var(--surface-muted, #f5f7fa); color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; }
.state-action { min-height: 40px; padding: 0 16px; border: 0; border-radius: var(--r-md, 8px); background: var(--primary, #5d87ff); color: #fff; font-size: 14px; font-weight: 600; line-height: 40px; }
</style>
`;

const profileStyle = `<style scoped>
.profile-page { padding-top: 16px; }
.service-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 16px; padding: 12px; border: 1px solid var(--line, #e5eaf2); border-radius: var(--r-md, 8px); background: var(--surface-muted, #f5f7fa); color: var(--text-secondary, #5a6a85); font-size: 13px; line-height: 1.55; }
.form-state { display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 16px; }
.unavailable-title { color: var(--text-strong, #2a3547); font-size: 15px; font-weight: 600; }
.state-action { min-height: 40px; padding: 0 16px; border: 0; border-radius: var(--r-md, 8px); background: var(--primary, #5d87ff); color: #fff; font-size: 14px; font-weight: 600; line-height: 40px; }
</style>
`;

write(
  "src/pages/invite/form.vue",
  `<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { FormConfig } from "@chunyu/patient-design/types";
import AppIcon from "../../components/AppIcon.vue";
import PatientForm from "../../components/PatientForm.vue";
import { saveLocalProfileFromPayload } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
const auth = useAuthStore();
onMounted(() => store.load());
onShow(() => {
  void ensureLogin("/pages/invite/form");
});

const FOOD_CONTACT_OPTIONS = ["\u65e0", "\u9ec4\u74dc", "\u5316\u5986\u54c1", "\u8292\u679c", "\u82b1\u7c89", "\u725b\u5976", "\u6cb9\u6f06", "\u575a\u679c", "\u52a8\u7269\u76ae\u6bdb", "\u6d77\u9c9c", "\u5176\u4ed6"];
const DRUG_ALLERGY_OPTIONS = ["\u65e0", "\u666e\u9c81\u5361\u56e0", "\u7ef4\u751f\u7d20B1", "\u9752\u9709\u7d20", "\u7834\u4f24\u98ce\u6297\u6bd2\u7d20", "\u5730\u5361\u56e0", "\u78fa\u80fa\u7c7b\u836f\u7269", "\u6cdb\u5f71\u8461\u80fa", "\u963f\u53f8\u5339\u6797", "\u5176\u4ed6"];
const DISEASE_HISTORY_OPTIONS = ["\u65e0", "\u9ad8\u8840\u538b", "\u8fc7\u654f\u6027\u75be\u75c5", "\u54ee\u5598", "\u7cd6\u5c3f\u75c5", "\u767d\u765c\u98ce", "\u5fc3\u810f\u75c5", "\u766b\u75eb", "\u5176\u4ed6"];
const PREGNANCY_OPTIONS = ["\u5426", "\u5907\u5b55\u4e2d", "\u6000\u5b55\u4e2d", "\u54fa\u4e73\u4e2d"];

const config = computed<FormConfig | null>(() => {
  if (!store.doctor) return null;
  const diseaseField = (store.content?.contactForm?.fields || []).find((f) => f.key === "disease");
  const diseases = diseaseField?.options?.length ? diseaseField.options : ["\u6d88\u5316\u7cfb\u7edf\u75be\u75c5", "\u5176\u5b83"];
  return {
    title: "\u9080\u8bf7\u5efa\u6863",
    notes: "\u6f14\u793a\u5165\u53e3\uff1a\u6b63\u5f0f\u73af\u5883\u7531\u9080\u8bf7\u77ed\u94fe\u6253\u5f00\u3002\u4ee5\u4e0b\u4fe1\u606f\u4ec5\u533b\u751f\u56e2\u961f\u53ef\u89c1\u3002",
    fields: [
      { key: "name", label: "\u59d3\u540d", type: "text", required: true, err: "\u8bf7\u586b\u5199\u59d3\u540d" },
      { key: "gender", label: "\u6027\u522b", type: "select", required: true, options: ["\u7537", "\u5973"], err: "\u8bf7\u9009\u62e9\u6027\u522b" },
      { key: "birthDate", label: "\u51fa\u751f\u65e5\u671f", type: "date", required: true, err: "\u8bf7\u586b\u5199\u51fa\u751f\u65e5\u671f" },
      { key: "phone", label: "\u624b\u673a\u53f7", type: "tel", required: true, pattern: "^1[3-9]\\\\d{9}$", err: "\u8bf7\u8f93\u5165\u6b63\u786e\u624b\u673a\u53f7" },
      { key: "idNumber", label: "\u8eab\u4efd\u8bc1\u53f7", type: "text", required: false, sensitive: true },
      { key: "disease", label: "\u60a8\u6240\u60a3\u7684\u75be\u75c5", type: "select", required: true, options: diseases, err: "\u8bf7\u9009\u62e9\u6240\u60a3\u75be\u75c5" },
      { key: "pregnancyStatus", label: "\u662f\u5426\u598a\u5a20\u54fa\u4e73", type: "select", required: false, options: PREGNANCY_OPTIONS },
      { key: "foodContactAllergies", label: "\u98df\u7269\u3001\u63a5\u89e6\u7269\u8fc7\u654f", type: "checkboxGroup", required: false, options: FOOD_CONTACT_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      { key: "drugAllergies", label: "\u836f\u7269\u8fc7\u654f", type: "checkboxGroup", required: false, options: DRUG_ALLERGY_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      { key: "diseaseHistory", label: "\u75be\u75c5\u53f2", type: "checkboxGroup", required: false, options: DISEASE_HISTORY_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      {
        key: "outpatientVoucher", label: "\u8bf7\u4e0a\u4f20\u95e8\u8bca\u51ed\u8bc1", type: "file", required: true,
        accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        err: "\u8bf7\u4e0a\u4f20\u95e8\u8bca\u51ed\u8bc1",
      },
    ],
    consent: "\u6211\u5df2\u9605\u8bfb\u5e76\u5355\u72ec\u540c\u610f\u654f\u611f\u4e2a\u4eba\u4fe1\u606f\u5904\u7406\u544a\u77e5\uff0c\u6240\u586b\u4fe1\u606f\u4ec5\u7528\u4e8e\u5efa\u7acb\u60a3\u8005\u6863\u6848\u4e0e\u533b\u751f\u56e2\u961f\u8ddf\u8fdb\u3002",
  };
});

function onSubmitted(payload: Record<string, string>) {
  saveLocalProfileFromPayload(payload);
  void auth.refreshMe().catch(() => {});
  uni.redirectTo({ url: "/pages/invite/success" });
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom invite-page" :class="{ elder: store.elderMode }">
    <view class="service-note">
      <AppIcon name="lock" :size="22" color="#52627A" />
      <text>\u9080\u8bf7\u5efa\u6863\u95ee\u5377\uff08\u6f14\u793a\uff09\u3002\u63d0\u4ea4\u540e\u8fdb\u5165\u6210\u529f\u9875\uff0c\u4e0d\u4f1a\u81ea\u52a8\u8df3\u8f6c\u54a8\u8be2\u3002</text>
    </view>
    <PatientForm v-if="config" :config="config" type="\u8054\u7edc\u8868" @submitted="onSubmitted" />
    <view v-else-if="store.loading" class="state-card form-state">\u6b63\u5728\u52a0\u8f7d\u5efa\u6863\u95ee\u5377\u2026</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <button class="state-action pressable" @click="store.load">\u91cd\u65b0\u52a0\u8f7d</button>
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="form" :size="28" />
      <text class="unavailable-title">\u5efa\u6863\u670d\u52a1\u6682\u4e0d\u53ef\u7528</text>
      <text>\u5f53\u524d\u672a\u52a0\u8f7d\u533b\u751f\u670d\u52a1\u4fe1\u606f\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</text>
    </view>
  </view>
</template>

${inviteStyle}`,
);

write(
  "src/pages/archive/profile.vue",
  `<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type { FormConfig } from "@chunyu/patient-design/types";
import AppIcon from "../../components/AppIcon.vue";
import PatientForm from "../../components/PatientForm.vue";
import { saveLocalProfileFromPayload } from "../../api/patient";
import { useAppStore } from "../../stores/app";
import { useAuthStore } from "../../stores/auth";
import { ensureLogin } from "../../utils/ensureLogin";

const store = useAppStore();
const auth = useAuthStore();
onMounted(() => store.load());
onShow(() => {
  if (!auth.phoneBound) {
    void ensureLogin("/pages/archive/profile");
  }
});

const FOOD_CONTACT_OPTIONS = ["\u65e0", "\u9ec4\u74dc", "\u5316\u5986\u54c1", "\u8292\u679c", "\u82b1\u7c89", "\u725b\u5976", "\u6cb9\u6f06", "\u575a\u679c", "\u52a8\u7269\u76ae\u6bdb", "\u6d77\u9c9c", "\u5176\u4ed6"];
const DRUG_ALLERGY_OPTIONS = ["\u65e0", "\u666e\u9c81\u5361\u56e0", "\u7ef4\u751f\u7d20B1", "\u9752\u9709\u7d20", "\u7834\u4f24\u98ce\u6297\u6bd2\u7d20", "\u5730\u5361\u56e0", "\u78fa\u80fa\u7c7b\u836f\u7269", "\u6cdb\u5f71\u8461\u80fa", "\u963f\u53f8\u5339\u6797", "\u5176\u4ed6"];
const DISEASE_HISTORY_OPTIONS = ["\u65e0", "\u9ad8\u8840\u538b", "\u8fc7\u654f\u6027\u75be\u75c5", "\u54ee\u5598", "\u7cd6\u5c3f\u75c5", "\u767d\u765c\u98ce", "\u5fc3\u810f\u75c5", "\u766b\u75eb", "\u5176\u4ed6"];
const PREGNANCY_OPTIONS = ["\u5426", "\u5907\u5b55\u4e2d", "\u6000\u5b55\u4e2d", "\u54fa\u4e73\u4e2d"];

/** \u4e0e\u670d\u52a1\u7aef\u9080\u8bf7\u5efa\u6863\u95ee\u5377\uff08/?p=invite\uff0cpatient_profile.defaultContactProfileFields\uff09\u5b57\u6bb5\u4e00\u81f4 */
const config = computed<FormConfig | null>(() => {
  if (!store.doctor) return null;
  const diseaseField = (store.content?.contactForm?.fields || []).find((f) => f.key === "disease");
  const diseases = diseaseField?.options?.length ? diseaseField.options : ["\u6d88\u5316\u7cfb\u7edf\u75be\u75c5", "\u5176\u5b83"];
  return {
    title: "\u60a3\u8005\u5efa\u6863\u95ee\u5377",
    notes: "\u4ee5\u4e0b\u4fe1\u606f\u4e0e\u7f51\u9875\u9080\u8bf7\u5efa\u6863\u95ee\u5377\u4e00\u81f4\uff0c\u4ec5\u533b\u751f\u56e2\u961f\u53ef\u89c1\uff0c\u7528\u4e8e\u5efa\u7acb\u60a3\u8005\u6863\u6848\u3002",
    fields: [
      { key: "name", label: "\u59d3\u540d", type: "text", required: true, err: "\u8bf7\u586b\u5199\u59d3\u540d" },
      { key: "gender", label: "\u6027\u522b", type: "select", required: true, options: ["\u7537", "\u5973"], err: "\u8bf7\u9009\u62e9\u6027\u522b" },
      { key: "birthDate", label: "\u51fa\u751f\u65e5\u671f", type: "date", required: true, err: "\u8bf7\u586b\u5199\u51fa\u751f\u65e5\u671f" },
      { key: "phone", label: "\u624b\u673a\u53f7", type: "tel", required: true, pattern: "^1[3-9]\\\\d{9}$", err: "\u8bf7\u8f93\u5165\u6b63\u786e\u624b\u673a\u53f7" },
      { key: "idNumber", label: "\u8eab\u4efd\u8bc1\u53f7", type: "text", required: false, sensitive: true },
      { key: "disease", label: "\u60a8\u6240\u60a3\u7684\u75be\u75c5", type: "select", required: true, options: diseases, err: "\u8bf7\u9009\u62e9\u6240\u60a3\u75be\u75c5" },
      { key: "pregnancyStatus", label: "\u662f\u5426\u598a\u5a20\u54fa\u4e73", type: "select", required: false, options: PREGNANCY_OPTIONS },
      { key: "foodContactAllergies", label: "\u98df\u7269\u3001\u63a5\u89e6\u7269\u8fc7\u654f", type: "checkboxGroup", required: false, options: FOOD_CONTACT_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      { key: "drugAllergies", label: "\u836f\u7269\u8fc7\u654f", type: "checkboxGroup", required: false, options: DRUG_ALLERGY_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      { key: "diseaseHistory", label: "\u75be\u75c5\u53f2", type: "checkboxGroup", required: false, options: DISEASE_HISTORY_OPTIONS, noneValue: "\u65e0", otherValue: "\u5176\u4ed6" },
      {
        key: "outpatientVoucher", label: "\u8bf7\u4e0a\u4f20\u95e8\u8bca\u51ed\u8bc1", type: "file", required: true,
        accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        err: "\u8bf7\u4e0a\u4f20\u95e8\u8bca\u51ed\u8bc1",
      },
    ],
    consent: "\u6211\u5df2\u9605\u8bfb\u5e76\u5355\u72ec\u540c\u610f\u654f\u611f\u4e2a\u4eba\u4fe1\u606f\u5904\u7406\u544a\u77e5\uff0c\u6240\u586b\u4fe1\u606f\u4ec5\u7528\u4e8e\u5efa\u7acb\u60a3\u8005\u6863\u6848\u4e0e\u533b\u751f\u56e2\u961f\u8ddf\u8fdb\u3002",
  };
});

function onSubmitted(payload: Record<string, string>) {
  saveLocalProfileFromPayload(payload);
  void auth.refreshMe().catch(() => {});
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom profile-page" :class="{ elder: store.elderMode }">
    <view class="service-note">
      <AppIcon name="lock" :size="22" color="#52627A" />
      <text>\u672c\u95ee\u5377\u4e0e{{ store.doctor?.name || "\u4e3b\u8bca" }}\u533b\u751f\u56e2\u961f\u7f51\u9875\u9080\u8bf7\u5efa\u6863\u95ee\u5377\u5185\u5bb9\u4e00\u81f4\uff0c\u63d0\u4ea4\u540e\u6863\u6848\u9875\u53ef\u67e5\u770b\u6458\u8981\u3002</text>
    </view>
    <PatientForm v-if="config" :config="config" type="\u8054\u7edc\u8868" @submitted="onSubmitted" />
    <view v-else-if="store.loading" class="state-card form-state">\u6b63\u5728\u52a0\u8f7d\u5efa\u6863\u95ee\u5377\u2026</view>
    <view v-else-if="store.error" class="state-card form-state">
      <text>{{ store.error }}</text>
      <button class="state-action pressable" @click="store.load">\u91cd\u65b0\u52a0\u8f7d</button>
    </view>
    <view v-else class="state-card form-state">
      <AppIcon name="form" :size="28" />
      <text class="unavailable-title">\u5efa\u6863\u670d\u52a1\u6682\u4e0d\u53ef\u7528</text>
      <text>\u5f53\u524d\u672a\u52a0\u8f7d\u533b\u751f\u670d\u52a1\u4fe1\u606f\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</text>
    </view>
  </view>
</template>

${profileStyle}`,
);
