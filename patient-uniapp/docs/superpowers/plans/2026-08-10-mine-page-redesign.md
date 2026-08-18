# “我的”页参考图复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将患者端“我的”页按批准参考图重做为浅绿色、三项统计、三组列表的全年龄友好界面，并保留现有数据与跳转。

**Architecture:** 继续由 `src/pages/mine/index.vue` 管理页面数据和交互，只替换展示数组、模板与局部样式。复用 `AppIcon`、现有 stores、接口、登录校验和自定义 TabBar；只为缺失的叶影背景与定位图标新增位图素材。

**Tech Stack:** Vue 3、TypeScript、uni-app、微信小程序、自定义 TabBar、Node.js 内置测试运行器

---

> 当前目录不是 Git 仓库，因此计划中的每个“提交”检查点改为测试与构建检查点，不执行 `git commit`。

### Task 1: 锁定页面内容契约

**Files:**
- Create: `tests/mine-approved-design.test.mjs`
- Read: `src/pages/mine/index.vue`

- [ ] **Step 1: 写入失败契约测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/mine/index.vue", import.meta.url), "utf8");

test("我的页使用批准稿的信息层级", () => {
  for (const text of [
    "家庭成员", "进行中", "优惠券", "我的健康", "健康档案", "健康计划", "健康记录",
    "服务与订单", "我的服务", "我的订单", "优惠权益", "家庭与工具", "地址管理", "设置与授权",
  ]) assert.match(page, new RegExp(text));

  assert.doesNotMatch(page, /健康资料|常用服务|订单服务|工具与服务|开启长辈模式|春雨健康患者端 V3\.2/);
});

test("我的页保留真实入口和新增素材", () => {
  for (const route of [
    "/pages/records/index", "/pages/plans/detail", "/pages/archive/health",
    "/pages/services/mine-services?tab=active", "/pages/services/mine-services?tab=orders",
    "/pages/services/rights", "/pages/family/index", "/pages/address/index", "/pages/settings/index",
  ]) assert.match(page, new RegExp(route.replace(/[?]/g, "\\?")));

  assert.equal(existsSync(new URL("../src/static/visual/mine-leaf-bg.webp", import.meta.url)), true);
  assert.equal(existsSync(new URL("../src/static/icons/v2/location.png", import.meta.url)), true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/mine-approved-design.test.mjs`  
Expected: FAIL，原因包括旧版文案仍存在、新素材不存在。

### Task 2: 生成并接入缺失视觉素材

**Files:**
- Create: `src/static/visual/mine-leaf-bg.webp`
- Create: `src/static/icons/v2/location.png`
- Modify: `src/constants/iconRegistry.ts`

- [ ] **Step 1: 生成顶部叶影背景**

使用参考图作为风格依据生成无文字、无 UI 的浅绿色虚化叶影背景；主体集中在右上区域，左侧保持干净以承载头像和姓名。保存源图后使用项目现有视觉资源优化脚本转换为 `mine-leaf-bg.webp`。

- [ ] **Step 2: 生成定位图标**

生成与现有 V2 图标一致的深绿色单线定位图标，去除背景并导出透明 PNG 到 `src/static/icons/v2/location.png`。禁止使用字符、Emoji、CSS 图形或手绘 SVG。

- [ ] **Step 3: 注册图标**

在 `ICON_NAMES` 中加入：

```ts
"location",
```

保持 `resolveIconAsset()` 的既有路径规则不变。

- [ ] **Step 4: 验证图标契约**

Run: `node --test tests/icon-motion.test.mjs`  
Expected: PASS。

### Task 3: 收敛数据模型与页面交互

**Files:**
- Modify: `src/pages/mine/index.vue`

- [ ] **Step 1: 将顶部统计收敛为三项**

替换 `stats`：

```ts
const stats = computed(() => [
  { key: "family", value: String(familyCount.value), label: "家庭成员", url: "/pages/family/index" },
  { key: "services", value: String(activeServiceCount.value), label: "进行中", url: "/pages/services/mine-services?tab=active" },
  { key: "coupon", value: String(couponCount.value), label: "优惠券", url: "/pages/services/rights" },
]);
```

删除不再使用的 `recordCount`、`familyMeta`、`commonServices`、`orderServices`、`toolServices`、`openCommon`、`openOrder`、`openTool`、`openFamily` 和 `toggleElder`。

- [ ] **Step 2: 定义三组列表**

```ts
const menuGroups = [
  {
    key: "health",
    title: "我的健康",
    items: [
      { key: "records", icon: "health-record", title: "健康档案", url: "/pages/records/index" },
      { key: "plans", icon: "health-plan", title: "健康计划", url: "/pages/plans/detail" },
      { key: "health-log", icon: "health-log", title: "健康记录", url: "/pages/archive/health" },
    ],
  },
  {
    key: "services",
    title: "服务与订单",
    items: [
      { key: "mine-services", icon: "service-center", title: "我的服务", url: "/pages/services/mine-services?tab=active" },
      { key: "orders", icon: "order", title: "我的订单", url: "/pages/services/mine-services?tab=orders" },
      { key: "rights", icon: "service-rights", title: "优惠权益", url: "/pages/services/rights" },
    ],
  },
  {
    key: "family",
    title: "家庭与工具",
    items: [
      { key: "family", icon: "member-record", title: "家庭成员", url: "/pages/family/index" },
      { key: "address", icon: "location", title: "地址管理", url: "/pages/address/index" },
      { key: "settings", icon: "settings", title: "设置与授权", url: "/pages/settings/index" },
    ],
  },
] as const;

function openMenu(url: string) {
  void goWithLogin(url);
}
```

- [ ] **Step 3: 保留现有头像和个人档案行为**

继续使用 `avatarSrc`、`onChooseAvatar`、`openProfile`、`openSettings`、`syncPendingAvatar` 和现有缓存键；无头像时渲染：

```vue
<AppIcon v-else name="nav-profile" :size="48" tone="primary" />
```

### Task 4: 重建模板与样式

**Files:**
- Modify: `src/pages/mine/index.vue`

- [ ] **Step 1: 替换页面主体模板**

页面主体保留现有 `scroll-view`、安全区计算和头像上传按钮，结构调整为：

```vue
<view class="mine-page" :class="{ elder: store.elderMode }">
  <scroll-view scroll-y class="mine-scroll">
    <view class="mine-shell" :style="{ paddingTop: `${headerPadTop}px` }">
      <view class="profile-panel">
        <!-- 现有头像与 chooseAvatar 按钮 -->
        <view class="profile-copy" @click="openProfile">
          <text class="profile-name">{{ profileCardLabel }}</text>
          <text class="profile-status">{{ auth.phoneBound ? "已绑定手机号" : "请绑定手机号" }}</text>
        </view>
        <view class="settings-pill" @click="openSettings">
          <AppIcon name="settings" :size="22" tone="primary" />
          <text>设置</text>
        </view>
      </view>

      <view class="stats-card">
        <view v-for="(item, index) in stats" :key="item.key" class="stat-item" :class="{ divided: index > 0 }" @click="openStat(item.url)">
          <text class="stat-value">{{ item.value }}</text>
          <text class="stat-label">{{ item.label }}</text>
        </view>
      </view>

      <view v-for="group in menuGroups" :key="group.key" class="menu-card">
        <text class="menu-title">{{ group.title }}</text>
        <view v-for="(item, index) in group.items" :key="item.key" class="menu-row" :class="{ divided: index > 0 }" @click="openMenu(item.url)">
          <view class="menu-icon"><AppIcon :name="item.icon" :size="28" tone="primary" /></view>
          <text class="menu-label">{{ item.title }}</text>
          <AppIcon name="nav-chevron-right" :size="20" tone="muted" />
        </view>
      </view>
    </view>
  </scroll-view>
</view>
```

- [ ] **Step 2: 应用参考图视觉令牌**

```css
.mine-page { min-height: 100vh; background: #f5faf3 url('/static/visual/mine-leaf-bg.webp') top right / 100% auto no-repeat; color: #111713; }
.mine-scroll { height: 100vh; }
.mine-shell { box-sizing: border-box; padding: 8px 16px calc(96px + env(safe-area-inset-bottom)); }
.profile-panel { display: flex; min-height: 126px; align-items: center; gap: 16px; padding: 8px 10px; }
.profile-name { font-size: 28px; font-weight: 800; }
.profile-status { margin-top: 5px; color: #69716d; font-size: 16px; }
.settings-pill { display: flex; align-items: center; gap: 7px; padding: 10px 14px; border: 1px solid rgba(10,104,67,.12); border-radius: 20px; background: rgba(255,255,255,.86); }
.stats-card, .menu-card { border: 1px solid rgba(10,104,67,.035); border-radius: 26px; background: rgba(255,255,255,.94); box-shadow: 0 14px 34px rgba(45,87,65,.07); }
.stats-card { display: flex; margin-bottom: 16px; padding: 14px 0; }
.stat-item { position: relative; flex: 1; text-align: center; }
.stat-value { display: block; color: #0a6843; font-size: 26px; font-weight: 800; }
.stat-label { display: block; margin-top: 4px; font-size: 16px; }
.menu-card { margin-bottom: 14px; padding: 20px 16px 8px; }
.menu-title { display: block; margin-bottom: 8px; font-size: 21px; font-weight: 800; }
.menu-row { display: flex; min-height: 70px; align-items: center; gap: 14px; }
.menu-icon { display: flex; width: 50px; height: 50px; align-items: center; justify-content: center; border-radius: 50%; background: #edf6ee; }
.menu-label { min-width: 0; flex: 1; overflow: hidden; font-size: 18px; text-overflow: ellipsis; white-space: nowrap; }
.profile-copy { min-width: 0; flex: 1; }
.profile-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat-item.divided::before { position: absolute; top: 8px; bottom: 8px; left: 0; width: 1px; background: #e5ece7; content: ""; }
.menu-row.divided::before { position: absolute; top: 0; right: 0; left: 64px; height: 1px; background: #e7ece8; content: ""; }
.menu-row { position: relative; }
.pressable { transition: opacity 120ms ease-out, transform 120ms ease-out; }
.pressable:active { opacity: .88; transform: scale(.992); }
.elder .profile-name { font-size: 31px; }
.elder .menu-title { font-size: 24px; }
.elder .menu-label, .elder .stat-label, .elder .profile-status { font-size: 19px; }
```

- [ ] **Step 3: 运行内容契约测试**

Run: `node --test tests/mine-approved-design.test.mjs`  
Expected: PASS。

### Task 5: 构建与运行态验收

**Files:**
- Verify: `dist/build/mp-weixin/pages/mine/index.*`

- [ ] **Step 1: 运行相关测试**

Run: `node --test tests/mine-approved-design.test.mjs tests/icon-motion.test.mjs tests/pages-json-no-conflict.test.mjs`  
Expected: 全部 PASS。

- [ ] **Step 2: 构建微信小程序**

Run: `npm run build:mp-weixin`  
Expected: `DONE Build complete.`，静态资源同步成功，TabBar 图标检查通过。

- [ ] **Step 3: 检查运行态结构**

在 H5 本地预览中确认 DOM 同时包含三项统计、三个分组标题和九个入口；确认无旧版隐藏条目。依主人要求，不执行截图比对阻塞。

- [ ] **Step 4: 交付主人视觉复核**

保持本地预览可访问，说明测试、构建结果和需要主人在微信开发者工具中判断的视觉细节。
