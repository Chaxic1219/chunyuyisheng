# 患者端小程序 IA 精简骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `2026-07-23-patient-miniprogram-ia-redesign-design.md` 把 `patient-uniapp` 改成三 Tab「首页枢纽」骨架：去名片与档案 Tab、主路径建档→咨询 / 跟进、表单与知识降为二级，并增加邀请建档占位页；保留现有设计语言与 mock。

**Architecture:** 只改 UniApp 路由与页面入口层级；复用 `FnGroup` / `PatientForm` / `getLocalProfile`；`pages/archive/index` 退出 tabBar 并重定向到「我的」；首页用本地档案 + mock 回复摘要驱动状态区；咨询顶栏收成一行队名 +「更多服务」；邀请页 mock 提交后写本地档案并进成功页。

**Tech Stack:** UniApp Vue3 + Pinia + TypeScript；`@chunyu/patient-design`；`node --test` 契约测试（`tests/ui-contract.test.mjs`）。

**Spec:** `app/docs/superpowers/specs/2026-07-23-patient-miniprogram-ia-redesign-design.md`

---

## File Map

| Path | Responsibility |
|------|----------------|
| `patient-uniapp/src/pages.json` | Tab 改为首页/咨询/我的；注册 invite 子页；archive/index 仅非 Tab |
| `patient-uniapp/tests/ui-contract.test.mjs` | 契约断言对齐新 IA（先改测试再改页面） |
| `patient-uniapp/README.md` | 功能说明对齐三 Tab |
| `patient-uniapp/src/pages/index/index.vue` | 状态区 + 主 CTA + 二级折叠；去 DoctorCard / CoreEntries |
| `patient-uniapp/src/pages/consult/index.vue` | 顶栏一行队名；未建档轻提示；更多服务 |
| `patient-uniapp/src/pages/mine/index.vue` | P0/P1/P2 分组；去掉对 archive Tab 的依赖 |
| `patient-uniapp/src/pages/archive/index.vue` | `onLoad` 重定向到 `/pages/mine/index` |
| `patient-uniapp/src/pages/invite/form.vue` | 邀请问卷占位（复用 PatientForm + 本地档案） |
| `patient-uniapp/src/pages/invite/success.vue` | 成功页 + 可选「去咨询」 |
| `patient-uniapp/src/api/patient.ts` | 可选：`getFollowupSummary()` mock（首页待跟进用） |

**不修改：** `packages/patient-design` 色板、`admin-ui`、后端真接口、`DoctorCard.vue`（可保留文件但首页不再引用）。

---

### Task 1: 更新契约测试（先红）

**Files:**
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`

- [ ] **Step 1: 改写「四个核心 Tab」相关断言为三 Tab IA**

把现有测试：

```js
test("四个核心 Tab 保留医生主体、医疗安全与患者资产语义", () => {
  assert.match(read("src/pages/index/index.vue"), /医生团队|主诊医生/);
  assert.match(read("src/pages/index/index.vue"), /健康指引/);
  assert.match(read("src/pages/consult/index.vue"), /医疗建议仅供参考/);
  assert.match(read("src/pages/archive/index.vue"), /健康档案概览/);
  assert.match(read("src/pages/mine/index.vue"), /患者资产/);
});
```

替换为：

```js
test("三 Tab 首页枢纽：状态区、咨询安全提示、我的资产；档案页仅重定向", () => {
  const pages = readJson("src/pages.json");
  const tabPaths = pages.tabBar.list.map((t) => t.pagePath);
  assert.deepEqual(tabPaths, [
    "pages/index/index",
    "pages/consult/index",
    "pages/mine/index",
  ]);
  assert.equal(tabPaths.includes("pages/archive/index"), false);

  const home = read("src/pages/index/index.vue");
  assert.doesNotMatch(home, /DoctorCard/);
  assert.doesNotMatch(home, /CoreEntries/);
  assert.match(home, /完善档案|去咨询|待跟进/);

  assert.match(read("src/pages/consult/index.vue"), /医疗建议仅供参考/);
  assert.match(read("src/pages/consult/index.vue"), /更多服务/);

  assert.match(read("src/pages/mine/index.vue"), /患者资产|患者档案填写/);
  assert.match(read("src/pages/archive/index.vue"), /switchTab|reLaunch/);

  assert.match(read("src/pages/invite/form.vue"), /PatientForm|建档/);
  assert.match(read("src/pages/invite/success.vue"), /去咨询/);
});
```

- [ ] **Step 2: 跑测试确认失败（尚未改 pages/页面）**

Run:

```bash
cd patient-uniapp
pnpm run test:ui
```

Expected: FAIL（tabBar 仍为 4 项 / 缺 invite 文件 / 首页仍含 DoctorCard 等）

- [ ] **Step 3: Commit**

```bash
git add patient-uniapp/tests/ui-contract.test.mjs
git commit -m "test: align ui-contract with three-tab patient IA"
```

---

### Task 2: 调整 `pages.json` 路由与 Tab

**Files:**
- Modify: `patient-uniapp/src/pages.json`

- [ ] **Step 1: 更新 pages 列表与 tabBar**

要求：

1. `tabBar.list` 仅三项：`pages/index/index`（首页）、`pages/consult/index`（咨询）、`pages/mine/index`（我的）；删除档案 Tab 项（含 icon 引用可留文件不动）。
2. `pages` 数组保留 `pages/archive/index`、`profile`、`health` 等子页。
3. 在 `pages` 中追加：

```json
{
  "path": "pages/invite/form",
  "style": {
    "navigationBarTitleText": "患者建档",
    "navigationBarBackgroundColor": "#F4F7FB"
  }
},
{
  "path": "pages/invite/success",
  "style": {
    "navigationBarTitleText": "建档成功",
    "navigationBarBackgroundColor": "#F4F7FB"
  }
}
```

完整 `tabBar` 目标形态：

```json
"tabBar": {
  "color": "#6B6B6B",
  "selectedColor": "#5D87FF",
  "backgroundColor": "#FFFFFF",
  "borderStyle": "black",
  "list": [
    {
      "pagePath": "pages/index/index",
      "text": "首页",
      "iconPath": "static/tab/home.png",
      "selectedIconPath": "static/tab/home-active.png"
    },
    {
      "pagePath": "pages/consult/index",
      "text": "咨询",
      "iconPath": "static/tab/chat.png",
      "selectedIconPath": "static/tab/chat-active.png"
    },
    {
      "pagePath": "pages/mine/index",
      "text": "我的",
      "iconPath": "static/tab/user.png",
      "selectedIconPath": "static/tab/user-active.png"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add patient-uniapp/src/pages.json
git commit -m "chore: drop archive tab and register invite pages"
```

---

### Task 3: 档案 Tab 页改为重定向

**Files:**
- Modify: `patient-uniapp/src/pages/archive/index.vue`

- [ ] **Step 1: 用最小重定向替换页面逻辑**

将 `archive/index.vue` 改为（可清空原模板内容）：

```vue
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";

onLoad(() => {
  uni.switchTab({ url: "/pages/mine/index" });
});
</script>

<template>
  <view class="redirect">正在前往「我的」…</view>
</template>

<style scoped>
.redirect {
  padding: 48px 24px;
  color: var(--text-secondary, #52627a);
  font-size: 16px;
  text-align: center;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add patient-uniapp/src/pages/archive/index.vue
git commit -m "refactor: redirect former archive tab to mine"
```

---

### Task 4: 首页枢纽改造

**Files:**
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/api/patient.ts`（追加 summary helper）

- [ ] **Step 1: 在 `patient.ts` 增加待跟进摘要 mock**

在 `getLocalProfile` 附近追加：

```ts
export type FollowupSummary = {
  pendingCount: number;
  latestTitle: string;
};

/** 首页「待跟进」摘要；骨架期 mock，有本地档案时返回固定条数 */
export async function getFollowupSummary(): Promise<FollowupSummary> {
  if (USE_MOCK) {
    await delay(120);
    const local = getLocalProfile();
    if (!local) return { pendingCount: 0, latestTitle: "" };
    return { pendingCount: 1, latestTitle: "门诊加号 · 助理处理中" };
  }
  return { pendingCount: 0, latestTitle: "" };
}
```

- [ ] **Step 2: 重写首页 script：状态 + CTA + 二级知识**

替换 `index.vue` 的 `<script setup>` 核心逻辑为（保留 brandbar / elder / loading / error 结构）：

```ts
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import FnGroup, { type FnItem } from "../../components/FnGroup.vue";
import {
  getFollowupSummary,
  getLocalProfile,
  type FollowupSummary,
  type PatientProfile,
} from "../../api/patient";
import { useAppStore } from "../../stores/app";

const store = useAppStore();
const profile = ref<PatientProfile | null>(null);
const followup = ref<FollowupSummary>({ pendingCount: 0, latestTitle: "" });

async function refreshLocal() {
  profile.value = getLocalProfile();
  followup.value = await getFollowupSummary();
}

onMounted(async () => {
  await store.load();
  await refreshLocal();
});
onShow(() => {
  void refreshLocal();
});

const hasProfile = computed(() => !!(profile.value?.name || profile.value?.phone));

const secondaryItems = computed<FnItem[]>(() => {
  const c = store.content;
  const items: FnItem[] = [];
  if (c?.clinicArticle) items.push({ key: "clinic", title: "门诊时间", sub: "出诊地址、时间与挂号方式" });
  if (c?.dietArticle) items.push({ key: "diet", title: "术后饮食", sub: "康复期饮食注意事项" });
  if (c?.surgeryArticle) items.push({ key: "surgery", title: "住院手术须知", sub: "入院前后准备清单" });
  if (c?.doctorProfile) items.push({ key: "prof", title: "医生风采", sub: "简介、擅长与团队资历" });
  if (store.doctor?.hospitalPhone) items.push({ key: "tel", title: "医院电话", sub: "咨询与预约热线" });
  items.push({ key: "faq", title: "常见问题", sub: "就诊前先看这里" });
  return items;
});

function primaryAction() {
  if (!hasProfile.value) {
    uni.navigateTo({ url: "/pages/archive/profile" });
    return;
  }
  uni.switchTab({ url: "/pages/consult/index" });
}

function openFollowup() {
  uni.navigateTo({ url: "/pages/replies/index" });
}

function open(key: string) {
  if (key === "faq") {
    uni.navigateTo({ url: "/pages/faq/index" });
    return;
  }
  if (key === "clinic" || key === "diet" || key === "surgery") {
    uni.navigateTo({ url: `/pages/article/detail?key=${key}` });
    return;
  }
  if (key === "tel" && store.doctor?.hospitalPhone) {
    uni.makePhoneCall({ phoneNumber: store.doctor.hospitalPhone });
    return;
  }
  if (key === "prof") {
    const profileDoc = store.content?.doctorProfile;
    uni.showModal({
      title: "医生风采",
      content: `${profileDoc?.intro || ""}\n擅长：${profileDoc?.skills || ""}`,
      showCancel: false,
    });
  }
}
```

- [ ] **Step 3: 重写首页 template（去名片/四宫格/大指南卡主堆）**

在 brandbar + loading/error 之后：

```vue
<view v-else class="page-shell home-content">
  <view class="status-card">
    <text class="status-card__eyebrow">下一步</text>
    <template v-if="!hasProfile">
      <text class="status-card__title">请先完善患者档案</text>
      <text class="status-card__desc">建档后可与医生团队在线咨询，资料仅团队可见。</text>
    </template>
    <template v-else>
      <text class="status-card__title">您好，{{ profile?.name || "患者" }}</text>
      <text
        v-if="followup.pendingCount > 0"
        class="status-card__follow pressable"
        aria-role="button"
        @click="openFollowup"
      >待跟进 {{ followup.pendingCount }} · {{ followup.latestTitle }}</text>
      <text v-else class="status-card__desc">暂无待跟进事项，可直接咨询医生团队。</text>
    </template>
    <view class="status-card__cta pressable" aria-role="button" @click="primaryAction">
      {{ hasProfile ? "去咨询" : "完善档案" }}
    </view>
  </view>

  <FnGroup
    v-if="secondaryItems.length"
    title="更多指引"
    :items="secondaryItems"
    @open="open"
  />
</view>
```

样式沿用现有变量；`status-card` 用白底圆角 + `--shadow-card`，CTA 用 `--primary-deep`，触控高度 ≥ `--touch-target`。删除对 `DoctorCard` / `CoreEntries` 的 import。

- [ ] **Step 4: Commit**

```bash
git add patient-uniapp/src/pages/index/index.vue patient-uniapp/src/api/patient.ts
git commit -m "feat: hub home with status CTA and secondary guides"
```

---

### Task 5: 咨询页 — 顶栏队名、轻提示、更多服务

**Files:**
- Modify: `patient-uniapp/src/pages/consult/index.vue`

- [ ] **Step 1: script 增加档案检查与更多服务跳转**

在现有 imports 中增加 `getLocalProfile`、`onShow`；追加：

```ts
import { getLocalProfile } from "../../api/patient";
import { onShow } from "@dcloudio/uni-app";

const profileHintShown = ref(false);

onShow(() => {
  if (profileHintShown.value) return;
  const p = getLocalProfile();
  if (!p?.name && !p?.phone) {
    profileHintShown.value = true;
    uni.showToast({ title: "建议先完善档案，便于团队跟进", icon: "none" });
  }
});

function openMoreService(key: "add" | "admission" | "contact") {
  const map = {
    add: "/pages/form/add",
    admission: "/pages/form/admission",
    contact: "/pages/form/contact",
  };
  uni.navigateTo({ url: map[key] });
}
```

- [ ] **Step 2: 把大块 `service-card` 收成一行顶栏 + 更多服务条**

将 template 顶部 `service-card` 替换为：

```vue
<view class="team-bar">
  <text class="team-bar__name">{{ store.doctor?.name || "主诊" }}医生团队</text>
  <text class="team-bar__more pressable" aria-role="button" @click="showMore = !showMore">更多服务</text>
</view>
<view v-if="showMore" class="more-sheet">
  <view class="more-sheet__item pressable" @click="openMoreService('add')">门诊加号</view>
  <view class="more-sheet__item pressable" @click="openMoreService('admission')">住院预约</view>
  <view class="more-sheet__item pressable" @click="openMoreService('contact')">医患联络表</view>
</view>
```

在 script 增加 `const showMore = ref(false)`。保留 `safety-note`、聊天流、composer。`upload-guide` 可保留（属咨询辅助，非名片）。

样式示例：

```css
.team-bar {
  display: flex;
  min-height: var(--touch-target, 44px);
  padding: 8px 4px 12px;
  align-items: center;
  justify-content: space-between;
}
.team-bar__name {
  color: var(--text-strong, #14213b);
  font-size: 17px;
  font-weight: 800;
}
.team-bar__more {
  color: var(--primary-deep, #456fd8);
  font-size: 15px;
  font-weight: 700;
}
.more-sheet {
  display: flex;
  margin-bottom: 12px;
  gap: 8px;
  flex-wrap: wrap;
}
.more-sheet__item {
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid rgba(93, 135, 255, 0.24);
  border-radius: 999px;
  background: #fff;
  color: var(--primary-deep, #456fd8);
  font-size: 15px;
  font-weight: 600;
}
```

删除已无用的 `.service-card*` 样式块。

- [ ] **Step 3: Commit**

```bash
git add patient-uniapp/src/pages/consult/index.vue
git commit -m "feat: slim consult header and secondary service sheet"
```

---

### Task 6: 「我的」承接档案与二级入口

**Files:**
- Modify: `patient-uniapp/src/pages/mine/index.vue`

- [ ] **Step 1: 调整分组与 open 路由**

将资产/服务列表改为：

```ts
const assetItems: FnItem[] = [
  { key: "profile", title: "患者档案填写", sub: "基本信息、病史与用药情况" },
  { key: "health", title: "健康记录", sub: "分类查看健康资料" },
  { key: "replies", title: "查看回复", sub: "申请与跟进进度" },
];

const serviceItems: FnItem[] = [
  { key: "add", title: "门诊加号", sub: "提交加号需求" },
  { key: "adm", title: "住院预约", sub: "术前准备与排期登记" },
  { key: "contact", title: "医患联络表", sub: "补充基础信息" },
];

const settingItems: FnItem[] = [
  { key: "elder", title: "长辈模式", sub: "放大字号与触控区域" },
  { key: "faq", title: "常见问题", sub: "咨询、加号与隐私说明" },
  { key: "clinic", title: "门诊时间", sub: "出诊安排与挂号指引" },
  { key: "invite", title: "邀请建档（演示）", sub: "打开邀请问卷占位页" },
];
```

`open` 函数：

```ts
function open(key: string) {
  if (key === "elder") {
    store.toggleElder();
    uni.showToast({
      title: store.elderMode ? "已开启长辈模式" : "已关闭长辈模式",
      icon: "none",
    });
    return;
  }
  const map: Record<string, string> = {
    profile: "/pages/archive/profile",
    health: "/pages/archive/health",
    replies: "/pages/replies/index",
    add: "/pages/form/add",
    adm: "/pages/form/admission",
    contact: "/pages/form/contact",
    faq: "/pages/faq/index",
    clinic: "/pages/article/detail?key=clinic",
    invite: "/pages/invite/form",
  };
  if (map[key]) uni.navigateTo({ url: map[key] });
}
```

模板中：保留身份卡与隐私说明；用三个 `FnGroup`（我的医疗资产 / 更多服务 / 服务与设置）。**删除**任何 `switchTab` 到 `/pages/archive/index` 的逻辑。统计数字：有本地档案时用 `followup` 或固定「已建立」文案，避免写死误导——可用：

```ts
const archiveLabel = computed(() => (profile.value ? "已建立" : "未建档"));
```

- [ ] **Step 2: Commit**

```bash
git add patient-uniapp/src/pages/mine/index.vue
git commit -m "feat: mine owns archive entries and secondary forms"
```

---

### Task 7: 邀请建档占位页

**Files:**
- Create: `patient-uniapp/src/pages/invite/form.vue`
- Create: `patient-uniapp/src/pages/invite/success.vue`

- [ ] **Step 1: 创建 `invite/form.vue`**

复用 `archive/profile.vue` 的字段配置与 `PatientForm`；提交成功后：

```ts
function onSubmitted(payload: Record<string, string>) {
  saveLocalProfileFromPayload(payload);
  uni.redirectTo({ url: "/pages/invite/success" });
}
```

页面标题区文案：「邀请建档」；notes 可写「演示入口：正式环境由邀请短链打开」。

可直接以 `archive/profile.vue` 为模板复制后改 `onSubmitted` 与标题文案，避免重复维护字段时可后续再抽 composable——骨架期允许两处字段列表相同（YAGNI：不强制立刻抽取）。

- [ ] **Step 2: 创建 `invite/success.vue`**

```vue
<script setup lang="ts">
import { useAppStore } from "../../stores/app";
import AppIcon from "../../components/AppIcon.vue";

const store = useAppStore();

function goConsult() {
  uni.switchTab({ url: "/pages/consult/index" });
}

function goHome() {
  uni.switchTab({ url: "/pages/index/index" });
}
</script>

<template>
  <view class="page-shell ambient-bg safe-bottom success-page" :class="{ elder: store.elderMode }">
    <view class="success-card">
      <AppIcon name="check" :size="36" color="#087965" />
      <text class="success-card__title">建档成功</text>
      <text class="success-card__desc">资料已保存（Demo）。可返回首页，或前往在线咨询。</text>
      <view class="success-card__cta pressable" @click="goConsult">去咨询</view>
      <view class="success-card__link pressable" @click="goHome">返回首页</view>
    </view>
  </view>
</template>
```

样式：白卡、主按钮 `--primary-deep`、次链接灰色；**不要**在 `onLoad` 里自动 `switchTab` 咨询。

- [ ] **Step 3: Commit**

```bash
git add patient-uniapp/src/pages/invite/form.vue patient-uniapp/src/pages/invite/success.vue
git commit -m "feat: add invite onboarding placeholder pages"
```

---

### Task 8: README + 全量契约测试 + 类型检查

**Files:**
- Modify: `patient-uniapp/README.md`
- Verify: tests / type-check

- [ ] **Step 1: 更新 README 功能说明**

将「功能（MVP）」改为：

```markdown
## 功能（骨架 · IA 精简）

- 首页：状态区（完善档案 / 待跟进）+ 主 CTA + 二级知识折叠（无医生名片）
- 咨询：一行队名、聊天、选图、「更多服务」（加号/住院/联络）
- 我的：档案 / 健康记录 / 回复 + 二级表单与设置
- 邀请占位：`pages/invite/form` → `success`（不自动跳咨询）
```

- [ ] **Step 2: 跑测试与类型检查**

```bash
cd patient-uniapp
pnpm run test:ui
pnpm run type-check
```

Expected: 全部 PASS（若 `vue-tsc` 对未使用组件报错，删除首页对 `DoctorCard`/`CoreEntries` 的残留引用即可）。

- [ ] **Step 3: 微信开发者工具冒烟（手动）**

```bash
pnpm run dev:mp-weixin
```

打开 `patient-uniapp/dist/dev/mp-weixin`，核对：

1. 底栏仅 3 Tab  
2. 首页无名片；未建档点「完善档案」→ 填写 → 回首页 CTA 变「去咨询」  
3. 咨询有「更多服务」；未建档有 toast  
4. 我的 → 邀请建档（演示）→ 成功页「去咨询」可选  

- [ ] **Step 4: Commit**

```bash
git add patient-uniapp/README.md
git commit -m "docs: update patient-uniapp README for hub IA"
```

- [ ] **Step 5: 更新规格状态**

将 `app/docs/superpowers/specs/2026-07-23-patient-miniprogram-ia-redesign-design.md` 头部状态改为：`已批准 · 实施中`（实施全部完成后改为 `骨架已落地`）。

```bash
git add app/docs/superpowers/specs/2026-07-23-patient-miniprogram-ia-redesign-design.md
git commit -m "docs: mark patient miniprogram IA spec as in progress"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 三 Tab：首页/咨询/我的 | 2 |
| 去掉档案 Tab | 2、3 |
| 首页无名片、状态区、主 CTA、二级知识 | 4 |
| 咨询顶栏队名 + 更多服务 + 未建档轻提示 | 5 |
| 我的承接档案/回复/P2 表单 | 6 |
| 邀请落地 + 成功页不自动跳咨询 | 7 |
| 设计语言不变 / mock | 全程不改 tokens；API 仍 USE_MOCK |
| 契约可验 | 1、8 |

---

## Self-Review Notes

- 无 TBD 步骤；邀请字段允许与 `archive/profile` 重复（骨架 YAGNI）。
- `getFollowupSummary` 与首页 `hasProfile` 命名在 Task 4/6 一致。
- 咨询页大紫卡改为 `team-bar`，满足「一行队名、非名片」。
- Commit 步骤保留在计划中；若主人要求「不要自动 commit」，执行时跳过 commit 步骤、仅改代码与跑测试。
