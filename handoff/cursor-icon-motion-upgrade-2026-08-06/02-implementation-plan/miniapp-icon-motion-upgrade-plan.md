# 患者端小程序图标与动效升级 Implementation Plan

> **执行说明：** Cursor 无需安装或调用 Superpowers 插件；直接按本文 Task 和复选项顺序逐步执行，每个检查点保留测试或人工确认记录。

**Goal:** 为患者端小程序全部可点击控件建立统一的纯线性语义图标和状态引导动效，并优先完成服务包盈利核心链路。

**Architecture:** 使用集中式图标注册表把页面语义映射到本地 PNG，并由 `AppIcon` 统一解析资源和动效类型；`AppButton`、`AppIconButton`、列表、卡片和页头统一处理按下、加载、成功、失败及低动效状态。页面只传递动作语义和业务状态；生产调用迁移到新语义名，注册表继续保留服务端旧数据兼容别名。

**Tech Stack:** UniApp、Vue 3、TypeScript、Pinia、微信小程序、Node.js `node:test`、Python Pillow

---

## 执行前说明

- 设计依据：从交接包根目录读取 `01-requirements/miniapp-icon-motion-upgrade-design.md`；本计划文件相对路径为 `../01-requirements/miniapp-icon-motion-upgrade-design.md`。
- 实施目录：`patient-uniapp`
- 当前目录不是 Git 仓库。本计划不初始化仓库、不提交代码；每个任务以测试通过作为检查点。若主人后续提供 Git 仓库，再按任务分别提交。
- 不调整服务包定价、支付接口、健康档案数据结构或其他业务逻辑。
- 所有新图标采用已确认的 24×24、1.8px、圆角描边、无填充、无高光视觉语言。

## 文件结构

### 新增文件

- `patient-uniapp/src/constants/iconRegistry.ts`：语义图标、旧名称别名、默认动效和状态资源的唯一注册表。
- `patient-uniapp/src/components/AppIconButton.vue`：要求可访问名称的独立图标按钮。
- `patient-uniapp/src/static/icons/v2/*.png`：由批准的 SVG 母版导出的高清 PNG。
- `patient-uniapp/scripts/optimize-icon-assets.py`：统一尺寸、无损压缩并检查图标总体积。
- `patient-uniapp/tests/icon-motion.test.mjs`：图标资源、语义映射、组件状态、页面覆盖率和包体契约测试。

### 主要修改文件

- `patient-uniapp/src/utils/mediaSrc.ts`：接入新注册表，保留旧名称兼容，未知值不再回退到 `help`。
- `patient-uniapp/src/components/AppIcon.vue`：支持语义色调、交互状态和默认动效类型。
- `patient-uniapp/src/components/AppButton.vue`：支持加载、成功、失败、防重复点击和可访问名称。
- `patient-uniapp/src/components/AppListRow.vue`
- `patient-uniapp/src/components/AppActionTile.vue`
- `patient-uniapp/src/components/AppServiceProductCard.vue`
- `patient-uniapp/src/components/AppPageHeader.vue`
- `patient-uniapp/src/components/AppBackNav.vue`
- `patient-uniapp/src/components/AppSectionHeader.vue`
- `patient-uniapp/src/components/AppHeroPanel.vue`
- `patient-uniapp/src/components/AppEmptyState.vue`
- `patient-uniapp/src/stores/app.ts`：增加低动效偏好及持久化。
- `patient-uniapp/src/App.vue`：统一按压和语义动效 CSS。
- `patient-uniapp/src/api/mock/v32.ts`、`patient-uniapp/src/constants/mineDefaults.ts`：替换位置型旧图标名。
- `patient-uniapp/src/pages/**`：为全部可点击控件配置语义图标和状态。
- `patient-uniapp/src/custom-tab-bar/index.js`
- `patient-uniapp/src/custom-tab-bar/index.wxml`
- `patient-uniapp/src/custom-tab-bar/index.wxss`
- `patient-uniapp/package.json`：加入图标测试和构建前资源检查。

## Task 1：建立语义图标资产与注册表

**Files:**

- Create: `patient-uniapp/src/constants/iconRegistry.ts`
- Create: `patient-uniapp/src/static/icons/v2/*.png`
- Create: `patient-uniapp/tests/icon-motion.test.mjs`
- Modify: `patient-uniapp/src/utils/mediaSrc.ts`
- Modify: `patient-uniapp/package.json`

- [ ] **Step 1：写注册表失败测试**

在 `tests/icon-motion.test.mjs` 写入基础测试框架和首组断言：

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const importTypeScript = async (relativePath) => {
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
};

test("语义图标注册表覆盖批准名称且未知值不回退到帮助图标", async () => {
  const registry = await importTypeScript("src/constants/iconRegistry.ts");
  for (const name of registry.ICON_NAMES) {
    assert.equal(existsSync(path.join(root, registry.resolveIconAsset(name, "primary"))), true, name);
  }
  for (const [name, tone] of [
    ["upload-record", "inverse"], ["nav-home", "muted"], ["nav-consult", "inverse"],
    ["data-delete", "danger"], ["status-error", "danger"],
  ]) {
    assert.equal(existsSync(path.join(root, registry.resolveIconAsset(name, tone))), true, `${name}:${tone}`);
  }
  assert.equal(registry.resolveSemanticIcon("quick-upload"), "upload-record");
  assert.equal(registry.resolveSemanticIcon("quick-service"), "service-package");
  assert.equal(registry.resolveSemanticIcon("not-a-real-icon"), "action-unknown");
  assert.notEqual(registry.resolveSemanticIcon("not-a-real-icon"), "help");
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `node --test tests/icon-motion.test.mjs`

Expected: FAIL，错误指出 `src/constants/iconRegistry.ts` 不存在。

- [ ] **Step 3：创建可测试的注册表接口骨架，不落最终资产**

先创建 `src/constants/iconRegistry.ts` 的可编译接口骨架，仅声明 `IconTone`、`IconMotion`、`ICON_NAMES` 及 `resolveSemanticIcon`、`resolveIconMotion`、`resolveIconAsset` 的公开接口和安全占位行为。此时不得复制旧 PNG、不得把占位资源放入 `src/static/icons/v2/`、不得开始页面迁移；别名、tone 文件集合和最终资源解析仍由 Step 7 完成。

再次运行 `node --test tests/icon-motion.test.mjs`，预期仍为 FAIL，失败原因应是 v2 资源尚未生成或别名映射尚未完成，而不是 TypeScript 接口缺失。

- [ ] **Step 4：生成完整纯线性 SVG 母版**

依据 `03-assets/new-icon-output-spec.md` 的批准语义清单，以及 `04-mapping/interaction-inventory.csv` 的 `tone` 列，生成完整 SVG 母版到 `design/icons/v2-svg/`。每个母版使用 24×24 画布、1.8px 圆角描边，不使用填充、渐变、投影、高光或拟物底座。只生成映射表和输出规范实际要求的 tone，不导出 PNG，不开始页面开发。

- [ ] **Step 5：主人确认 SVG 母版，形成强制停止点**

输出 SVG 文件清单、语义/tone 覆盖统计和可视化预览，交给主人确认。**在主人明确确认全部母版前必须停止**：不得导出 PNG、不得完成注册表映射、不得接入媒体解析器，也不得进入 Task 2 或任何页面迁移。收到修改意见时只修 SVG 母版并重新提交确认。

- [ ] **Step 6：确认导出工具后导出 PNG**

主人确认 SVG 后，先在 `patient-uniapp/` 执行：

```powershell
$inkscape = Get-Command inkscape -ErrorAction SilentlyContinue
if (-not $inkscape) { throw "未检测到 Inkscape；停止导出，请主人选择安装 Inkscape 或提供等价 SVG→PNG 工具" }
```

当前交接环境在 2026-08-06 未检测到 Inkscape，因此这是已知停止条件。Cursor 必须在自身环境重新检查；缺失时不得静默安装、下载或替换工具，必须让主人选择安装 Inkscape 或提供等价 SVG→PNG 工具。

工具可用且主人已确认母版后，为 `ICON_NAMES` 中每个名称导出 96×96 透明 PNG 到 `src/static/icons/v2/`；严格按映射表 `tone` 列和 `TONE_FILES` 输出必要的 `-inverse`、`-muted`、`-danger` 文件，执行无损压缩并核对 400KB 预算。

- [ ] **Step 7：完成语义注册表实现**

`src/constants/iconRegistry.ts` 使用以下公开接口和完整语义列表：

```ts
export type IconTone = "primary" | "inverse" | "muted" | "danger";
export type IconMotion = "none" | "up" | "right" | "left" | "rotate" | "expand" | "confirm";

export const ICON_NAMES = [
  "action-add", "action-clear", "action-close", "action-confirm", "action-create",
  "action-more", "action-refresh", "action-send", "action-unknown", "action-update",
  "nav-back", "nav-chevron-right", "nav-consult", "nav-home", "nav-profile",
  "upload-record", "medication", "metric-record", "follow-up", "service-package",
  "consult-doctor", "profile-edit", "reminder", "doctor-group", "invite-patient",
  "group-service", "quick-question", "record-bind", "plan-create", "record-edit",
  "health-record", "health-log", "task-next", "health-plan", "plan-consult",
  "service-detail", "service-activate", "rehab-guide", "postop-assessment",
  "goods-order", "service-rights", "member-add", "member-record", "permission-scope",
  "wechat", "phone-bind", "verification-code", "order", "service-center", "privacy",
  "account-security", "data-export", "data-delete", "account-logout", "wechat-unbind",
  "settings", "elder-mode", "camera", "search", "attachment",
  "help-center", "doctor-profile", "health-assistant", "inpatient-service", "nutrition", "reply-record",
  "status-loading", "status-success", "status-error", "status-warning", "status-empty",
] as const;

export type SemanticIconName = (typeof ICON_NAMES)[number];

const ICON_SET = new Set<string>(ICON_NAMES);
const LEGACY_ALIASES: Record<string, SemanticIconName> = {
  plus: "action-add", add: "action-add", back: "nav-back", chevron: "nav-chevron-right",
  home: "nav-home", user: "nav-profile", chat: "consult-doctor", send: "action-send",
  upload: "upload-record", health: "medication", heart: "health-log", calendar: "follow-up",
  clock: "reminder", check: "status-success", lock: "account-security", phone: "phone-bind",
  search: "search", camera: "camera", image: "attachment", file: "health-record",
  archive: "health-record", team: "member-record", form: "record-edit", shield: "service-package",
  help: "help-center", hospital: "doctor-profile", bed: "inpatient-service",
  food: "nutrition", replies: "reply-record", surgery: "postop-assessment", az: "elder-mode",
  "quick-upload": "upload-record", "quick-med": "medication", "quick-metric": "metric-record",
  "quick-followup": "follow-up", "quick-service": "service-package",
  "asset-records": "health-record", "asset-plans": "health-plan",
  "asset-health-log": "health-log", "asset-family": "member-record",
  "asset-services": "service-center", "asset-orders": "order",
  "asset-rights": "service-rights", "asset-settings": "settings",
  "asset-elder": "elder-mode", "asset-reminders": "reminder",
  "asset-privacy": "privacy", "asset-data": "data-export",
  "asset-security": "account-security",
};

const MOTION_BY_ICON: Partial<Record<SemanticIconName, IconMotion>> = {
  "upload-record": "up", "action-send": "right", "nav-chevron-right": "right",
  "task-next": "right", "nav-back": "left", "action-refresh": "rotate",
  "action-add": "expand", "action-create": "expand", "action-confirm": "confirm",
  "status-success": "confirm",
};

const TONE_FILES: Record<Exclude<IconTone, "primary">, Set<SemanticIconName>> = {
  inverse: new Set([
    "action-confirm", "action-create", "action-refresh", "action-send", "action-update",
    "consult-doctor", "nav-consult", "phone-bind", "profile-edit", "record-bind",
    "service-activate", "status-loading", "status-warning", "upload-record", "wechat",
  ]),
  muted: new Set(["nav-chevron-right", "nav-home", "nav-profile", "status-empty"]),
  danger: new Set([
    "account-logout", "action-close", "data-delete", "status-error", "wechat-unbind",
  ]),
};

export function resolveSemanticIcon(name?: string | null): SemanticIconName {
  const raw = String(name || "").trim();
  if (ICON_SET.has(raw)) return raw as SemanticIconName;
  return LEGACY_ALIASES[raw] || "action-unknown";
}

export function resolveIconMotion(name?: string | null): IconMotion {
  return MOTION_BY_ICON[resolveSemanticIcon(name)] || "none";
}

export function resolveIconAsset(name?: string | null, tone: IconTone = "primary"): string {
  const semantic = resolveSemanticIcon(name);
  const suffix = tone !== "primary" && TONE_FILES[tone].has(semantic) ? `-${tone}` : "";
  return `src/static/icons/v2/${semantic}${suffix}.png`;
}
```

- [ ] **Step 8：接入媒体解析器**

将 `src/utils/mediaSrc.ts` 的 `SUPPORTED`、`COLOR_VARIANTS`、`PAINTED_PREFIXES` 和 `help` 回退替换为注册表解析；保留首页按 key 映射：

```ts
import { resolveIconAsset, resolveSemanticIcon, type IconTone } from "../constants/iconRegistry";

const HOME_QUICK_BY_KEY: Record<string, string> = {
  upload: "upload-record",
  med: "medication",
  consult: "consult-doctor",
  metric: "metric-record",
  follow: "follow-up",
  service: "service-package",
};

export function resolveIconName(name?: string | null): string {
  return resolveSemanticIcon(name);
}

export function resolveHomeQuickIcon(key?: string | null, icon?: string | null): string {
  return HOME_QUICK_BY_KEY[String(key || "")] || resolveSemanticIcon(icon);
}

function normalizeIconTone(toneOrColor?: IconTone | string | null): IconTone {
  const value = String(toneOrColor || "primary").toLowerCase();
  if (["primary", "inverse", "muted", "danger"].includes(value)) return value as IconTone;
  if (value === "#ffffff") return "inverse";
  if (["#a33c33", "#d92d20"].includes(value)) return "danger";
  if (["#b0b8b3", "#637188", "#89948e"].includes(value)) return "muted";
  return "primary";
}

export function resolveIconSrc(name?: string | null, toneOrColor?: IconTone | string | null): string {
  const tone = normalizeIconTone(toneOrColor);
  return `/${resolveIconAsset(name, tone).replace(/^src\//, "")}`;
}
```

保留 `safeLocalImageSrc` 的现有安全校验，不改变其行为。

- [ ] **Step 9：增加测试命令并验证**

在 `package.json` 增加：

```json
"test:icons": "node --test tests/icon-motion.test.mjs",
"test:ui": "node --test tests/ui-contract.test.mjs tests/icon-motion.test.mjs"
```

Run: `npm run test:icons`

Expected: PASS，注册表、旧名称别名和全部新资源均存在。

## Task 2：升级 AppIcon、低动效偏好和全局微交互

**Files:**

- Modify: `patient-uniapp/tests/icon-motion.test.mjs`
- Modify: `patient-uniapp/src/components/AppIcon.vue`
- Modify: `patient-uniapp/src/stores/app.ts`
- Modify: `patient-uniapp/src/App.vue`

- [ ] **Step 1：添加状态与低动效失败测试**

```js
test("AppIcon 使用语义色调和动效状态，应用提供低动效偏好", () => {
  const icon = read("src/components/AppIcon.vue");
  const store = read("src/stores/app.ts");
  const app = read("src/App.vue");
  assert.match(icon, /tone\?: IconTone/);
  assert.match(icon, /state\?: "idle" \| "loading" \| "success" \| "error"/);
  assert.match(icon, /resolveIconMotion|app-icon--motion-/);
  assert.doesNotMatch(icon, /help\.png/);
  assert.match(store, /reducedMotion|setReducedMotion|hydrateReducedMotion/);
  assert.match(app, /pressable--motion|app-icon--motion-right|app-icon--motion-rotate/);
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npm run test:icons`

Expected: FAIL，指出 `tone`、`state` 和 `reducedMotion` 尚未实现。

- [ ] **Step 3：扩展应用状态**

在 `src/stores/app.ts` 增加 `REDUCED_MOTION_KEY = "reducedMotion"`、`reducedMotion`、`setReducedMotion` 和 `hydrateReducedMotion`。存储读取失败时返回 `false`；写入失败时保留内存状态。把 `syncElderToTabBar` 改为 `syncPreferencesToTabBar`，向自定义 Tab 同步 `{ elder: elderMode.value, reducedMotion: reducedMotion.value }`。`App.vue` 启动时在 `hydrateElderMode()` 后调用 `hydrateReducedMotion()`。

公开接口保持为：

```ts
function readBooleanStorage(key: string): boolean {
  try {
    return uni.getStorageSync(key) === "1";
  } catch {
    return false;
  }
}

const reducedMotion = ref(readBooleanStorage(REDUCED_MOTION_KEY));

function setReducedMotion(next: boolean): boolean {
  const enabled = !!next;
  if (reducedMotion.value === enabled) return false;
  reducedMotion.value = enabled;
  try { uni.setStorageSync(REDUCED_MOTION_KEY, enabled ? "1" : "0"); } catch {}
  return true;
}

function hydrateReducedMotion() {
  reducedMotion.value = readBooleanStorage(REDUCED_MOTION_KEY);
}
```

- [ ] **Step 4：升级 AppIcon**

`AppIcon.vue` 接受 `tone`、`motion`、`state`，未知或加载失败均切到 `action-unknown`，并在开发环境输出一次告警。类名计算使用：

```ts
const props = withDefaults(defineProps<{
  name: string;
  size?: number;
  tone?: IconTone;
  /** 迁移期兼容旧调用；Task 8 删除 */
  color?: string;
  motion?: IconMotion | "auto";
  state?: "idle" | "loading" | "success" | "error";
}>(), { size: 24, color: "", motion: "auto", state: "idle" });

const effectiveName = computed(() => {
  if (props.state === "loading") return "status-loading";
  if (props.state === "success") return "status-success";
  if (props.state === "error") return "status-error";
  return failed.value ? "action-unknown" : props.name;
});

const effectiveMotion = computed(() =>
  store.reducedMotion ? "none" : props.motion === "auto"
    ? resolveIconMotion(effectiveName.value)
    : props.motion
);

const iconSrc = computed(() =>
  resolveIconSrc(effectiveName.value, props.color || props.tone || "primary")
);
```

在 `MOTION_BY_ICON` 中为 `status-loading` 配置 `rotate`，确保加载状态实际旋转。

根节点追加 `app-icon--motion-${effectiveMotion}` 和 `app-icon--state-${state}`。

- [ ] **Step 5：更新全局动效 CSS**

保留 44px 触控目标，将现有透明度反馈改为：

```css
.pressable {
  min-width: var(--touch-target, 44px);
  min-height: var(--touch-target, 44px);
  transition: opacity 140ms ease-out, background-color 140ms ease-out, transform 140ms ease-out;
}
.pressable.pressable--motion:active { opacity: 0.88; transform: scale(0.98); }
.pressable:active .app-icon--motion-up { transform: translateY(-3px); }
.pressable:active .app-icon--motion-right { transform: translateX(3px); }
.pressable:active .app-icon--motion-left { transform: translateX(-3px); }
.pressable:active .app-icon--motion-expand { transform: scale(1.08); }
.app-icon--state-loading.app-icon--motion-rotate { animation: icon-spin 800ms linear infinite; }
.app-icon--state-success.app-icon--motion-confirm { animation: icon-confirm 220ms ease-out both; }
@keyframes icon-spin { to { transform: rotate(360deg); } }
@keyframes icon-confirm { from { opacity: 0; transform: translateY(3px) scale(.94); } to { opacity: 1; transform: none; } }
```

组件在 `reducedMotion` 为 `false` 时才添加 `pressable--motion`。

- [ ] **Step 6：验证**

Run: `npm run test:icons && npm run type-check`

Expected: 两条命令均 PASS。

## Task 3：统一按钮、页头和独立图标操作

**Files:**

- Create: `patient-uniapp/src/components/AppIconButton.vue`
- Modify: `patient-uniapp/src/components/AppButton.vue`
- Modify: `patient-uniapp/src/components/AppPageHeader.vue`
- Modify: `patient-uniapp/src/components/AppBackNav.vue`
- Modify: `patient-uniapp/src/components/AppSectionHeader.vue`
- Modify: `patient-uniapp/src/components/AppHeroPanel.vue`
- Modify: `patient-uniapp/src/components/AppEmptyState.vue`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`

- [ ] **Step 1：添加按钮状态契约测试**

```js
test("公共按钮支持语义图标、状态、防重复点击和可访问名称", () => {
  const button = read("src/components/AppButton.vue");
  const iconButton = read("src/components/AppIconButton.vue");
  assert.match(button, /state\?: "idle" \| "loading" \| "success" \| "error"/);
  assert.match(button, /ariaLabel\?: string/);
  assert.match(button, /state === "loading"|isBusy/);
  assert.match(button, /AppIcon[\s\S]*:state="state"/);
  assert.match(iconButton, /ariaLabel: string/);
  assert.match(iconButton, /AppButton/);
});
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，指出 `AppIconButton.vue` 不存在且按钮缺少状态属性。

- [ ] **Step 3：升级 AppButton**

新增以下属性并锁定加载、成功、禁用状态：

```ts
type ButtonState = "idle" | "loading" | "success" | "error";

const props = withDefaults(defineProps<{
  label?: string;
  icon?: string;
  ariaLabel?: string;
  variant?: "primary" | "soft" | "amber" | "ghost" | "danger";
  size?: "sm" | "md";
  block?: boolean;
  disabled?: boolean;
  state?: ButtonState;
}>(), {
  label: "", icon: "", ariaLabel: "", variant: "primary", size: "md",
  block: false, disabled: false, state: "idle",
});

const isLocked = computed(() =>
  props.disabled || props.state === "loading" || props.state === "success"
);

function onTap() {
  if (isLocked.value) return;
  emit("tap");
}
```

模板在 `icon` 存在时渲染 `AppIcon`，传入 `:state="state"`；按钮根节点设置 `:aria-label="ariaLabel || label"` 和 `aria-disabled`。图标色调使用 `tone` 而非十六进制颜色：primary 按钮使用 `inverse`，danger 按钮使用 `danger`，其余使用 `primary`。迁移期暂时保留可选 `icon`，Task 8 在所有调用点完成迁移后改为必填。

```ts
const iconTone = computed<IconTone>(() => {
  if (props.variant === "primary") return "inverse";
  if (props.variant === "danger") return "danger";
  return "primary";
});
```

- [ ] **Step 4：新增 AppIconButton**

```vue
<script setup lang="ts">
import AppButton from "./AppButton.vue";
withDefaults(defineProps<{
  icon: string;
  ariaLabel: string;
  variant?: "primary" | "soft" | "amber" | "ghost" | "danger";
  disabled?: boolean;
}>(), { variant: "ghost", disabled: false });
const emit = defineEmits<{ tap: [] }>();
</script>

<template>
  <AppButton
    :icon="icon"
    :aria-label="ariaLabel"
    :variant="variant"
    :disabled="disabled"
    @tap="emit('tap')"
  />
</template>
```

- [ ] **Step 5：迁移公共页头与动作组件**

- `AppPageHeader` 使用 `AppIconButton`，新增必填的 `actionLabel`，不再用无文字 `AppButton`。
- `AppBackNav` 用 `AppIcon name="nav-back"` 替换字符 `‹`。
- `AppSectionHeader` 新增 `actionIcon`，默认 `nav-chevron-right`。
- `AppHeroPanel` 新增 `actionIcon` 并传给内部 `AppButton`。
- `AppEmptyState` 新增 `actionIcon`，默认 `action-refresh`。

公共属性签名：

```ts
actionIcon?: string;
actionLabel?: string;
```

所有内部 `AppButton` 均显式传入 `:icon="actionIcon"`。

- [ ] **Step 6：验证**

Run: `npm run test:icons && npm run type-check`

Expected: PASS；图标按钮均有可访问名称，加载状态无法重复触发。

## Task 4：统一列表、快捷入口和服务卡片

**Files:**

- Modify: `patient-uniapp/src/components/AppListRow.vue`
- Modify: `patient-uniapp/src/components/AppActionTile.vue`
- Modify: `patient-uniapp/src/components/AppServiceProductCard.vue`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`

- [ ] **Step 1：写交互容器失败测试**

```js
test("列表、快捷入口和服务卡片统一使用 AppIcon 与状态动效", () => {
  for (const file of ["AppListRow.vue", "AppActionTile.vue", "AppServiceProductCard.vue"]) {
    const source = read(`src/components/${file}`);
    assert.match(source, /AppIcon/);
    assert.doesNotMatch(source, /<image[^>]+icon/);
    assert.match(source, /pressable--motion/);
  }
  assert.match(read("src/components/AppServiceProductCard.vue"), /actionIcon/);
});
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，指出三个组件仍直接渲染图标图片。

- [ ] **Step 3：迁移 AppListRow**

- 删除 `resolveIconSrc` 和 `<image>` 图标渲染。
- 左侧改为 `<AppIcon :name="icon" :size="isStack ? 28 : 24" :tone="danger ? 'danger' : 'primary'" />`。
- 右侧使用 `<AppIcon name="nav-chevron-right" :size="16" tone="muted" />`。
- 从应用 store 读取 `reducedMotion`，仅在关闭低动效时添加 `pressable--motion`。
- 根节点增加 `:aria-label="title"`。

- [ ] **Step 4：迁移 AppActionTile**

- 删除 `resolveIconSrc` 和 `quick-*` 布局判断。
- 使用 `AppIcon`；compact 模式尺寸 32px，普通模式 28px。
- 将原 56px 轻立体图标缩小到纯线性视觉尺寸，保留现有卡片高度和触控范围。
- 低动效模式不添加 `pressable--motion`。

- [ ] **Step 5：迁移 AppServiceProductCard**

- 用 `AppIcon` 替换 tile 和 row 中的图标 `<image>`。
- 新增 `actionIcon?: string`，默认 `service-detail`。
- 内部按钮改为：

```vue
<AppButton
  v-if="actionLabel"
  :label="actionLabel"
  :icon="actionIcon"
  :variant="buttonVariant"
  size="sm"
  @tap.stop="emit('action')"
/>
```
- 整卡点击保留主图标；按钮点击继续使用 `.stop`，避免同时触发卡片跳转。

- [ ] **Step 6：验证**

先把 `tests/ui-contract.test.mjs` 中三个组件的契约从 `resolveIconSrc` 更新为 `AppIcon`，并将页头契约从无文字 `AppButton` 更新为 `AppIconButton`；保留其余既有断言。

Run: `npm run test:icons && npm run test:ui && npm run type-check`

Expected: 三条命令均 PASS，现有组件结构契约按新实现更新后无回归。

## Task 5：迁移首页与服务包盈利核心链路

**Files:**

- Modify: `patient-uniapp/src/api/mock/v32.ts`
- Modify: `patient-uniapp/src/pages/index/index.vue`
- Modify: `patient-uniapp/src/pages/services/index.vue`
- Modify: `patient-uniapp/src/pages/services/detail.vue`
- Modify: `patient-uniapp/src/components/AppServiceProductCard.vue`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`
- Modify: `patient-uniapp/tests/ui-contract.test.mjs`

- [ ] **Step 1：写核心链路语义测试**

```js
test("首页与服务包核心链路不再使用 quick、asset 或 help 兜底", () => {
  const files = [
    "src/api/mock/v32.ts",
    "src/pages/index/index.vue",
    "src/pages/services/index.vue",
    "src/pages/services/detail.vue",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /quick-(upload|med|metric|followup|service)|icon="help"/);
  }
  assert.match(read("src/api/mock/v32.ts"), /consult-doctor/);
  assert.match(read("src/api/mock/v32.ts"), /service-package/);
});
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，指出 mock 和服务页仍包含旧名称。

- [ ] **Step 3：替换首页数据语义**

`src/api/mock/v32.ts` 按以下映射修改：

```ts
upload  -> upload-record
med     -> medication
consult -> consult-doctor
metric  -> metric-record
follow  -> follow-up
service -> service-package
```

问用药与直接咨询必须分别使用 `medication` 和 `consult-doctor`。

- [ ] **Step 4：为首页所有按钮补齐图标**

在 `src/pages/index/index.vue` 使用以下明确映射：

```text
去完善       profile-edit
上传档案     upload-record
手动创建     action-create
计划下一任务 task-next
查看计划     health-plan
异常主操作   status-warning
异常次操作   nav-chevron-right
服务区更多   nav-chevron-right
```

`AppButton`、`AppSectionHeader`、`AppActionTile`、`AppServiceProductCard` 均传入对应语义属性。
首页内联状态图标同时迁移：时钟改为 `reminder`，异常问号改为 `status-warning`，医生头像提示改为 `doctor-profile`，计划爱心改为 `health-plan`，待处理文件改为 `health-record`。

- [ ] **Step 5：迁移服务中心和详情**

服务类别固定映射：

```ts
const CATEGORY_ICON_BY_KEY: Record<string, string> = {
  plan: "health-plan",
  med: "medication",
  appoint: "follow-up",
  rehab: "rehab-guide",
  assessment: "postop-assessment",
  consult: "consult-doctor",
  goods: "goods-order", // 实物商品与配送订单
  rights: "service-rights",
};
```

- 当前服务按钮使用 `service-detail`。
- 开通按钮使用 `service-activate`。
- 返回健康服务使用 `nav-back`。
- 加载失败使用 `action-refresh`，不再使用 `help`。

- [ ] **Step 6：验证核心链路**

同步修改 `tests/ui-contract.test.mjs`：将首页五入口旧 `quick-*` 资源断言替换为 `upload-record`、`medication`、`metric-record`、`follow-up`、`service-package`、`consult-doctor`，并断言 mock 数据不再包含 `quick-*`。

Run: `npm run test:icons && npm run test:ui && npm run type-check`

Expected: PASS；首页和服务页不存在 `quick-*`、`asset-*` 或 `help` 兜底。

## Task 6：迁移健康档案、计划和咨询链路

**Files:**

- Modify: `patient-uniapp/src/pages/records/index.vue`
- Modify: `patient-uniapp/src/pages/archive/profile.vue`
- Modify: `patient-uniapp/src/pages/archive/health.vue`
- Modify: `patient-uniapp/src/pages/plans/detail.vue`
- Modify: `patient-uniapp/src/pages/consult/index.vue`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`

- [ ] **Step 1：添加健康链路按钮覆盖测试**

```js
test("档案、计划和咨询页面的每个 AppButton 都配置图标", () => {
  for (const file of [
    "src/pages/records/index.vue",
    "src/pages/archive/profile.vue",
    "src/pages/archive/health.vue",
    "src/pages/plans/detail.vue",
  ]) {
    for (const tag of read(file).match(/<AppButton\b[^>]*>/g) || []) {
      assert.match(tag, /(?:^|\s)(?:icon|:icon)=/, `${file}: ${tag}`);
    }
  }
  assert.match(read("src/pages/consult/index.vue"), /action-send|action-clear|action-refresh/);
});
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，列出尚未配置 `icon` 的按钮。

- [ ] **Step 3：迁移档案页面**

```text
去绑定         record-bind
生成健康计划   plan-create
完善基础档案   record-edit
去完善档案     profile-edit
确认此项       action-confirm
查看健康记录   health-record
更新档案       action-update
返回查看       nav-back
查看全部       nav-chevron-right
重新加载       action-refresh
```

记录列表的服务端 `icon` 先经过 `resolveSemanticIcon`，未知值显示 `action-unknown` 并开发告警。

- [ ] **Step 4：迁移计划页面**

- 下一任务按钮：`task-next`。
- 查看计划：`health-plan`。
- 用药管理：`medication`，替换当前 `health`。
- 咨询当前计划：`plan-consult`。
- 加载失败：`action-refresh`。

- [ ] **Step 5：迁移咨询页原生交互**

- 清空：`action-clear`。
- 快捷问题：`quick-question`。
- 重试：`action-refresh`。
- 发送：`action-send`。
- 发送原生按钮内部增加 `AppIcon`，`aria-label="发送消息"`。
- 回复中将发送图标状态切换为 `loading`，并保持现有发送防重逻辑。
- 失败后恢复 `idle`，允许再次发送。
- 档案、计划和咨询页内联图标同步迁移：锁 `account-security`、表单 `record-edit`、文件 `health-record`、日历 `follow-up`、方向箭头 `nav-chevron-right`、警告问号 `status-error`、助手盾牌 `health-assistant`。

- [ ] **Step 6：验证**

Run: `npm run test:icons && npm run test:ui && npm run type-check`

Expected: PASS；问用药、用药管理、咨询和计划入口图标语义互不混淆。

## Task 7：迁移我的、设置、认证、表单和辅助页面

**Files:**

- Modify: `patient-uniapp/src/constants/mineDefaults.ts`
- Modify: `patient-uniapp/src/pages/mine/index.vue`
- Modify: `patient-uniapp/src/pages/settings/index.vue`
- Modify: `patient-uniapp/src/pages/family/index.vue`
- Modify: `patient-uniapp/src/pages/auth/bind.vue`
- Modify: `patient-uniapp/src/components/PatientForm.vue`
- Modify: `patient-uniapp/src/pages/article/detail.vue`
- Modify: `patient-uniapp/src/pages/faq/index.vue`
- Modify: `patient-uniapp/src/pages/replies/index.vue`
- Modify: `patient-uniapp/src/pages/invite/form.vue`
- Modify: `patient-uniapp/src/pages/form/add.vue`
- Modify: `patient-uniapp/src/pages/form/admission.vue`
- Modify: `patient-uniapp/src/pages/form/contact.vue`
- Modify: `patient-uniapp/src/components/AppNotice.vue`
- Modify: `patient-uniapp/src/components/FnGroup.vue`
- Modify: `patient-uniapp/src/components/CoreEntries.vue`
- Modify: `patient-uniapp/src/stores/consultation.ts`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`

- [ ] **Step 1：添加旧资产名称和按钮覆盖测试**

```js
test("账户与辅助页面不再复用 asset 图标，AppButton 均有图标", () => {
  const files = [
    "src/constants/mineDefaults.ts", "src/pages/mine/index.vue", "src/pages/settings/index.vue",
    "src/pages/family/index.vue", "src/pages/auth/bind.vue", "src/components/PatientForm.vue",
    "src/pages/article/detail.vue", "src/pages/faq/index.vue", "src/pages/replies/index.vue",
    "src/pages/invite/form.vue", "src/pages/form/add.vue", "src/pages/form/admission.vue",
    "src/pages/form/contact.vue",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /asset-(records|plans|health-log|family|services|orders|rights|settings|elder|reminders|privacy|data|security)/);
    for (const tag of source.match(/<AppButton\b[^>]*>/g) || []) {
      assert.match(tag, /(?:^|\s)(?:icon|:icon)=/, `${file}: ${tag}`);
    }
  }
});
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，列出仍使用 `asset-*` 或缺少图标的文件。

- [ ] **Step 3：迁移我的页默认数据**

```text
健康档案   health-record
健康计划   health-plan
健康记录   health-log
家属管理   member-record
我的服务   service-center
我的订单   order
优惠和权益 service-rights
服务协议   privacy
发票与售后 data-export
设置与授权 settings
长辈模式   elder-mode
```

头像选择的原生按钮增加 `camera` 图标和 `aria-label="更换头像"`。

- [ ] **Step 4：拆分设置页冲突语义**

```text
医生管理授权   privacy
助手信息共享   group-service
家属授权       permission-scope
账号安全       account-security
更换手机号     phone-bind
退出登录       account-logout
解除微信绑定   wechat-unbind
导出健康数据   data-export
申请删除数据   data-delete
数据申请记录   health-record
减少动态效果   settings
```

新增“减少动态效果”列表项，点击调用 `setReducedMotion(!reducedMotion)`，右侧状态文字显示“已开启/已关闭”。危险操作保留原确认弹窗。

- [ ] **Step 5：迁移家庭、认证和 PatientForm**

```text
家庭成员进入       member-record
授权范围           permission-scope
添加成员           member-add
微信登录           wechat
绑定/更换手机号    phone-bind
获取验证码         verification-code
确认绑定           action-confirm
上传附件           upload-record
删除附件           data-delete
提交表单           action-confirm
重新加载           action-refresh
```

具有 `open-type` 的原生按钮不得改成 `view`；在按钮内部加入 `AppIcon` 并保留原事件属性。

- [ ] **Step 6：迁移文章、FAQ、查询和表单壳页**

- 所有“重新加载/重新查询”使用 `action-refresh`。
- FAQ 展开使用 `nav-chevron-right` 并旋转 90°。
- “去咨询”使用 `consult-doctor`。
- “返回”使用 `nav-back`。
- 表单页公共提交操作由 `PatientForm` 提供 `action-confirm`，壳页只处理加载失败按钮。
- `AppNotice` 默认图标改为 `service-package`；FAQ 帮助入口使用 `help-center`。
- `FnGroup` 和 `CoreEntries` 的入口映射改为新语义：门诊 `follow-up`、住院 `inpatient-service`、营养 `nutrition`、医生 `doctor-profile`、档案 `health-record`、添加 `action-add`。
- `stores/consultation.ts` 的等待、健康助手和生活管家图标分别改为 `service-package`、`health-assistant` 和 `consult-doctor`。
- 文章页内联图标：安全说明 `privacy`、资料 `health-record`、帮助 `help-center`。
- FAQ 内联图标：帮助 `help-center`、展开 `nav-chevron-right`、咨询 `consult-doctor`。
- 查询页内联图标：失败 `status-error`、成功 `status-success`、时间 `reminder`、回复记录 `reply-record`。
- `PatientForm` 及表单壳页内联图标：表单 `record-edit`、方向 `nav-chevron-right`、失败 `status-error`、安全 `account-security`、门诊 `follow-up`。

- [ ] **Step 7：验证**

Run: `npm run test:icons && npm run test:ui && npm run type-check`

Expected: PASS；安全、退出、解绑、导出和删除数据不再共享同一图标。

## Task 8：升级底部导航、压缩资源并完成整体验收

**Files:**

- Create: `patient-uniapp/scripts/optimize-icon-assets.py`
- Modify: `patient-uniapp/src/custom-tab-bar/index.js`
- Modify: `patient-uniapp/src/custom-tab-bar/index.wxml`
- Modify: `patient-uniapp/src/custom-tab-bar/index.wxss`
- Modify: `patient-uniapp/scripts/sync-mp-static.py`
- Modify: `patient-uniapp/package.json`
- Modify: `patient-uniapp/tests/icon-motion.test.mjs`
- Delete after reference check: obsolete files under `patient-uniapp/src/static/icons/`

- [ ] **Step 1：添加包体、旧引用和底部导航失败测试**

```js
test("新图标总量不超过 400KB 且生产代码无旧位置型名称", () => {
  const iconDir = path.join(root, "src/static/icons/v2");
  const files = readdirSync(iconDir).filter((name) => name.endsWith(".png"));
  const bytes = files.reduce((sum, name) => sum + statSync(path.join(iconDir, name)).size, 0);
  assert.ok(bytes <= 400 * 1024, `图标总体积 ${Math.round(bytes / 1024)}KB`);
  const legacyIconLiteral = /(?:name|icon)="(?:chat|plus|add|calendar|bed|home|user|team|hospital|form|file|archive|help|send|back|chevron|clock|heart|phone|food|surgery|replies|shield|check|image|upload|lock|health|az)"|\bicon:\s*"(?:chat|plus|add|calendar|bed|home|user|team|hospital|form|file|archive|help|send|back|chevron|clock|heart|phone|food|surgery|replies|shield|check|image|upload|lock|health|az)"/;
  for (const file of listSourceFiles(path.join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    if (!file.endsWith("iconRegistry.ts")) {
      assert.doesNotMatch(source, /quick-(upload|med|metric|followup|service)|asset-(records|plans|health-log|family|services|orders|rights|settings|elder|reminders|privacy|data|security)/, file);
      assert.doesNotMatch(source, legacyIconLiteral, file);
    }
  }
});

test("所有 AppButton 与原生 button 都有图标", () => {
  for (const file of listSourceFiles(path.join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    if (!file.endsWith("AppButton.vue")) {
      for (const tag of source.match(/<AppButton\b[^>]*>/g) || []) {
        assert.match(tag, /(?:^|\s)(?:icon|:icon)=/, `${file}: ${tag}`);
      }
    }
    for (const block of source.match(/<button\b[\s\S]*?<\/button>/g) || []) {
      assert.match(block, /<AppIcon\b/, `${file}: native button 缺少 AppIcon`);
    }
  }
});

test("底部导航使用新版纯线性资源和克制状态反馈", () => {
  const js = read("src/custom-tab-bar/index.js");
  const wxss = read("src/custom-tab-bar/index.wxss");
  assert.match(js, /icons\/v2\/nav-home/);
  assert.match(js, /icons\/v2\/nav-consult/);
  assert.match(js, /icons\/v2\/nav-profile/);
  assert.match(wxss, /transition:[^;]*(opacity|transform)/);
  assert.doesNotMatch(wxss, /bounce|spring/);
});
```

同时从 `node:fs` 引入 `readdirSync` 和 `statSync`，并实现只读取 `.vue`、`.ts`、`.js`、`.wxml` 的 `listSourceFiles`。

```js
function listSourceFiles(dir) {
  const output = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...listSourceFiles(target));
    else if (/\.(vue|ts|js|wxml)$/.test(entry.name)) output.push(target);
  }
  return output;
}
```

- [ ] **Step 2：确认测试失败**

Run: `npm run test:icons`

Expected: FAIL，指出旧底部导航资源和旧引用仍存在。

- [ ] **Step 3：升级底部导航资源与反馈**

`src/custom-tab-bar/index.js` 使用：

```js
home:    /static/icons/v2/nav-home-muted.png
active:  /static/icons/v2/nav-home.png
consult: /static/icons/v2/nav-consult-inverse.png
profile: /static/icons/v2/nav-profile-muted.png
active:  /static/icons/v2/nav-profile.png
```

保留现有中央凸起布局，不新增弹跳。`index.wxss` 只为图标增加 `opacity 160ms ease-out` 和 `transform 160ms ease-out`；按下缩放不低于 0.98。

`index.js` 增加 `reducedMotion: false`；`index.wxml` 在根节点追加 `{{reducedMotion ? 'tab-bar--reduced-motion' : ''}}`；`index.wxss` 在该类下关闭图标 transform，只保留颜色和透明度反馈。

- [ ] **Step 4：创建图标压缩脚本**

`scripts/optimize-icon-assets.py`：

```py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src" / "static" / "icons" / "v2"
MAX_SIDE = 96
MAX_TOTAL = 400 * 1024

def main() -> int:
    for path in sorted(ICON_DIR.glob("*.png")):
        with Image.open(path) as image:
            rgba = image.convert("RGBA")
            rgba.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
            rgba.save(path, format="PNG", optimize=True)
    total = sum(path.stat().st_size for path in ICON_DIR.glob("*.png"))
    print(f"icon total: {total / 1024:.1f} KB")
    if total > MAX_TOTAL:
        raise SystemExit(f"icon budget exceeded: {total / 1024:.1f} KB > 400 KB")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5：接入构建和静态同步检查**

`package.json` 的微信构建命令调整为：

```json
"build:mp-weixin": "python scripts/optimize-visual-assets.py && python scripts/optimize-icon-assets.py && uni build -p mp-weixin && python scripts/sync-mp-static.py && node scripts/patch-wechat-config.mjs"
```

`sync-mp-static.py` 的必需文件检查加入 `icons/v2/nav-home.png`、`icons/v2/nav-consult-inverse.png` 和 `icons/v2/nav-profile.png`。

- [ ] **Step 6：确认生产调用点没有旧名称后删除旧资源**

保留 `LEGACY_ALIASES` 作为当前版本的服务端旧数据兼容层，但所有页面、公共组件、mock 和 store 必须使用新语义名称。别名只存在于 `src/constants/iconRegistry.ts`，不再对应旧 PNG；服务端图标字段仍为旧值时也会解析到 v2 资源。本次不删除这层兼容代码。

所有 `AppButton` 调用点迁移完成后，将 `AppButton` 的 `icon?: string` 改成 `icon: string`，并删除 `withDefaults` 中的 `icon: ""`。

确认 `rg -n ':color=|color="#[0-9A-Fa-f]' src/components src/pages` 不再发现 `AppIcon` 旧颜色调用后，从 `AppIcon.vue` 删除迁移期 `color` 属性。

Run: `rg -n 'quick-|asset-|view-archive-btn|help-danger|chevron-muted|name="(chat|plus|add|calendar|bed|home|user|team|hospital|form|file|archive|help|send|back|chevron|clock|heart|phone|food|surgery|replies|shield|check|image|upload|lock|health|az)"' src --glob '!static/icons/**' --glob '!constants/iconRegistry.ts'`

Expected: 无输出。

只删除无引用的旧 PNG，包括 9 组重复资源、`quick-*`、`asset-*`、`view-archive-btn.png` 和旧颜色变体；保留仍被非交互插图使用的图片。删除后再次运行 `npm run test:icons`。

- [ ] **Step 7：运行完整自动验证**

Run: `npm run test:icons`

Expected: PASS。

Run: `npm run test:ui`

Expected: PASS。

Run: `npm run type-check`

Expected: PASS，0 个 TypeScript 错误。

Run: `npm run build:mp-weixin`

Expected: exit code 0；输出包含 `icon total:`、静态资源同步成功和微信配置补丁成功。

- [ ] **Step 8：完成微信开发者工具人工验收**

依次检查：

1. 首页：首页三态、快捷入口、服务推荐、异常操作。
2. 服务包：服务列表、详情、开通、康复指导、术后评估、问诊、商品与权益入口。
3. 咨询：清空、快捷问题、发送中、失败重试、防重复发送。
4. 档案与计划：绑定、完善、确认、查看、下一任务和用药管理。
5. 我的与设置：头像、订单、授权、安全、导出、删除、退出和解绑。
6. 普通模式、长辈模式和低动效模式。
7. 所有独立图标按钮触控区不小于 44×44px。
8. 所有状态切换不改变按钮宽度或卡片高度。

Expected: 无缺图、无问号回退、无重复提交、无明显布局跳动；图标保持纯线性统一风格。

## 最终完成标准

- 设计文档第 11 节的 11 项验收标准全部满足。
- 87 个交互模板已完成分类和图标覆盖。
- `npm run test:icons`、`npm run test:ui`、`npm run type-check`、`npm run build:mp-weixin` 全部通过。
- 新图标资源总体积不超过 400KB。
- 生产调用点的旧位置型图标名称和完全重复资源已经清理；服务端兼容别名仅保留在注册表中。
- 微信开发者工具的首页、服务包、咨询、档案、计划、我的和设置链路人工验收通过。
