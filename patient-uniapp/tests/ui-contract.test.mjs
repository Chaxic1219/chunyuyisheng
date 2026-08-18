import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import "./task7.test.mjs";
import "./task8.test.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));
const importTypeScript = async (relativePath) => {
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
};

test("ColorUI 已作为小程序端基础样式库接入", () => {
  const app = read("src/App.vue");
  for (const file of ["main.css", "icon.css", "animation.css", "LICENSE"]) {
    assert.equal(existsSync(path.join(root, "src/colorui", file)), true, file);
  }
  assert.equal(existsSync(path.join(root, "src/colorui/components/cu-custom.vue")), true);
  assert.match(app, /@import "\.\/colorui\/main\.css"/);
  assert.match(app, /@import "\.\/colorui\/icon\.css"/);
  assert.match(app, /@import "\.\/colorui\/animation\.css"/);
  assert.match(read("src/colorui/main.css"), /\.cu-btn|\.cu-tag|\.bg-green/);
});

test("视觉令牌包含批准的医生私域色板和层级变量", () => {
  const css = read("../packages/patient-design/tokens.css");
  for (const token of [
    "--primary",
    "--primary-deep",
    "--accent-violet",
    "--mist-blue",
    "--surface-muted",
    "--text-strong",
    "--shadow-card",
    "--page-bg",
  ]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /--primary:\s*#176b52/i);
  assert.match(css, /--primary-deep:\s*#0c4535/i);
  assert.match(css, /--page-bg:\s*#f3f4ef/i);
});

test("微信 WXSS 令牌选择器不使用 :root", () => {
  const css = read("../packages/patient-design/tokens.css");
  assert.doesNotMatch(css, /:root/);
  assert.match(css, /^page\s*\{/m);
});

test("微信 WXSS 清理会去掉 :root、var 回退与 prefers-reduced-motion", async () => {
  const { sanitizeMpCss } = await import(
    pathToFileURL(path.join(root, "scripts", "sanitize-mp-css.mjs")).href
  );
  const input = `
:root, page { --c: #14213b; --shadow: 0 8px 24px rgba(69, 111, 216, .1); }
.box { color: var(--c, #14213b); box-shadow: var(--shadow, 0 8px 24px rgba(69, 111, 216, .1)); }
@media (prefers-reduced-motion: reduce) { .box { transition: none; } }
.ok { color: var(--c); }
`;
  const out = sanitizeMpCss(input);
  assert.doesNotMatch(out, /:root/);
  assert.doesNotMatch(out, /var\(--c,\s*#14213b\)/);
  assert.doesNotMatch(out, /prefers-reduced-motion/);
  assert.match(out, /color:\s*var\(--c\)/);
  assert.match(out, /box-shadow:\s*var\(--shadow\)/);
  assert.match(out, /\.ok\s*\{\s*color:\s*var\(--c\)/);
});

test("V3.2 三 Tab 架构：动态首页、双助手咨询、我的健康资产中心", () => {
  const pages = readJson("src/pages.json");
  assert.equal(pages.tabBar.custom, true);
  const tabPaths = pages.tabBar.list.map((t) => t.pagePath);
  assert.deepEqual(tabPaths, [
    "pages/index/index",
    "pages/consult/index",
    "pages/mine/index",
  ]);
  assert.equal(tabPaths.includes("pages/archive/index"), false);
  assert.match(read("src/custom-tab-bar/index.wxss"), /font-size:\s*14px/);
  assert.match(read("src/custom-tab-bar/index.wxss"), /\.tab-bar__icon\s*\{[\s\S]*width:\s*27px/);
  assert.match(read("src/pages/consult/index.vue"), /bottom:\s*calc\(72px/);
  assert.equal(existsSync(path.join(root, "src/static/tab/chat-fab.png")), true);
  assert.equal(existsSync(path.join(root, "src/static/tab/center-pedestal.png")), true);
  assert.match(read("src/pages/index/index.vue"), /syncCustomTabBar\(0\)/);
  assert.match(read("src/pages/consult/index.vue"), /syncCustomTabBar\(1\)/);
  assert.match(read("src/pages/mine/index.vue"), /syncCustomTabBar\(2\)/);
  for (const pathName of [
    "pages/records/index",
    "pages/plans/detail",
    "pages/services/index",
    "pages/family/index",
    "pages/settings/index",
  ]) {
    const inMain = pages.pages.some((p) => p.path === pathName);
    const inSub = (pages.subPackages || []).some((pkg) =>
      pkg.pages.some((p) => `${pkg.root}/${p.path}` === pathName)
    );
    assert.ok(inMain || inSub, `缺少 ${pathName}`);
  }

  const home = read("src/pages/index/index.vue");
  assert.doesNotMatch(home, /DoctorCard/);
  assert.doesNotMatch(home, /CoreEntries/);
  assert.match(home, /useHomeStore|getHomeFeed|健康计划|健康档案|快捷操作|你还可以/);
  assert.match(home, /正在进行的服务|根据当前计划推荐|常用服务|homeMode/);
  assert.doesNotMatch(home, /服务申请|我的资料|门诊加号|住院预约|医患联络表/);

  const homeData = read("src/api/mock/v32.ts");
  assert.match(homeData, /健康计划|健康档案|医生管家|复诊协助/);
  assert.match(read("src/api/v32.ts"), /getHomeFeed|getMineAssets|getRecordList|getPlanDetail|getServiceCenter|getFamilyData/);
  assert.match(read("src/api/v32.ts"), /normalizeHomeFeedLabels|normalizeServiceCenterLabels/);
  assert.match(read("src/utils/renameCopilotLabels.ts"), /医生管家|医生共管 Pro/);
  assert.match(read("src/types/v32.ts"), /AssistantRole|HomeFeed|MineAssets|PlanDetailData/);

  const consult = read("src/pages/consult/index.vue");
  assert.match(consult, /健康助手|生活管家|协同处理中/);
  assert.match(consult, /AI 服务提示|AI 辅助|不是医生|自动匹配健康助手或生活管家/);
  assert.match(consult, /safety-bar|message-row|conversation|consent-card|typewriter/);
  assert.doesNotMatch(consult, /咨询对象选择/);

  const mine = read("src/pages/mine/index.vue");
  assert.match(mine, /我的健康|服务与订单|家庭与工具/);
  assert.match(mine, /健康档案|健康计划|健康记录|家属管理/);
  assert.match(mine, /useHealthAssetsStore|loadMine/);
  assert.match(mine, /open-type="chooseAvatar"|@chooseavatar/);
  assert.doesNotMatch(mine, /title="我的资料"|title="服务申请"|门诊加号|患者档案填写/);
  assert.doesNotMatch(mine, /doctor\?\.name|doctor\.name|医生团队/);
  assert.doesNotMatch(home, /doctor\?\.name|doctor\.name|DoctorCard/);

  assert.match(read("src/stores/healthAssets.ts"), /getMineAssets|MINE_SETTING_ENTRIES|mineDefaults/);
  assert.match(read("src/stores/serviceAssets.ts"), /getServiceCenter/);
  assert.match(read("src/stores/consultation.ts"), /classifyIntent|roleMeta|生活管家/);
  assert.match(read("src/pages/records/index.vue"), /健康档案|冲突|不会自动进入健康计划|loadRecords/);
  assert.match(read("src/pages/plans/detail.vue"), /健康计划|loadPlan/);
  assert.match(read("src/pages/plans/detail.vue"), /今日任务|总体进度|本周重点/);
  assert.match(read("src/pages/services/index.vue"), /健康服务|按需求找服务|loadCenter/);
  assert.match(read("src/pages/family/index.vue"), /家属管理|loadFamily|inviteFamily|revokeMember/);
  assert.match(read("src/pages/archive/index.vue"), /switchTab|reLaunch/);

  assert.match(read("src/pages/invite/form.vue"), /PatientForm|建档/);
  assert.match(read("src/pages/invite/success.vue"), /去咨询/);
});

test("V3.2 我的页不再暴露旧版服务申请和医生主页入口", () => {
  const home = read("src/pages/index/index.vue");
  const mine = read("src/pages/mine/index.vue");
  assert.doesNotMatch(home, /医生风采|门诊时间|术后饮食/);
  assert.doesNotMatch(mine, /医生风采|门诊时间|术后饮食|医生团队/);
  assert.match(mine, /春雨健康患者端/);
  assert.doesNotMatch(mine, /自主管理计划不会默认由医生持续查看/);
  assert.doesNotMatch(mine, /:meta="entry\.sub"|asset-card__sub">\{\{ entry\.sub \}\}/);
});

test("V3.2 二级页面提供健康闭环承接", () => {
  assert.match(read("src/pages/records/index.vue"), /健康档案|AppPageHeader/);
  assert.doesNotMatch(read("src/pages/records/index.vue"), /资料有来源，确认后再进入健康计划/);
  assert.match(read("src/pages/plans/detail.vue"), /plan-card|data\.title|loadPlan/);
  assert.doesNotMatch(read("src/pages/plans/detail.vue"), /完整任务、用药和健康记录在这里管理|status-label="自主管理"/);
  assert.match(read("src/pages/services/index.vue"), /健康服务|为你推荐|正在加载健康服务/);
  assert.match(read("src/pages/family/index.vue"), /AppPageHeader title="家属管理"/);
  assert.doesNotMatch(read("src/pages/family/index.vue"), /代记录和代咨询都会标记实际操作者/);
  assert.match(read("src/pages/settings/index.vue"), /消息提醒|消息与任务提醒|更换绑定手机号|退出登录|解除微信绑定/);
  assert.doesNotMatch(
    read("src/pages/settings/index.vue"),
    /隐私与数据授权|申请删除数据|导出健康数据|减少动态效果|医生管家数据授权/
  );
  assert.match(read("src/pages/mine/index.vue"), /pages\/settings\/index|设置与授权|MINE_SETTING_ENTRIES/);
  assert.match(read("src/constants/mineDefaults.ts"), /settings-hub[\s\S]*elder/);
  assert.doesNotMatch(
    read("src/constants/mineDefaults.ts"),
    /消息与提醒|隐私与数据授权|账号安全|数据管理|数据导出/
  );
});

test("旧版患者服务中心关键入口不再占据首页主枢纽", () => {
  const home = read("src/pages/index/index.vue");
  assert.doesNotMatch(home, /服务申请/);
  assert.doesNotMatch(home, /我的资料/);
  assert.doesNotMatch(home, /门诊加号/);
  assert.doesNotMatch(home, /住院预约/);
  assert.doesNotMatch(home, /医患联络表/);
  assert.doesNotMatch(home, /常见问题/);
  assert.match(home, /健康计划|健康档案|健康服务/);
});

test("V3.2 mock 数据保留 PRD 要求的命名和入口分工", () => {
  const data = read("src/api/mock/v32.ts");
  assert.match(data, /健康计划/);
  assert.match(data, /健康档案/);
  assert.match(data, /健康记录/);
  assert.match(data, /首页只保留当前最重要的行动/);
  assert.match(data, /自主管理 · 不依赖医生持续查看/);
});

test("V3.2 小程序端按钮和提示组件统一关键操作样式", () => {
  const appButton = read("src/components/AppButton.vue");
  const appAction = read("src/components/AppActionTile.vue");
  const appNotice = read("src/components/AppNotice.vue");
  const appEmpty = read("src/components/AppEmptyState.vue");
  const appList = read("src/components/AppListRow.vue");
  const appHero = read("src/components/AppHeroPanel.vue");
  const appPageHeader = read("src/components/AppPageHeader.vue");
  const appSection = read("src/components/AppSectionHeader.vue");
  const appServiceProduct = read("src/components/AppServiceProductCard.vue");
  const appStatus = read("src/components/AppStatusBadge.vue");
  const appMetric = read("src/components/AppMetricGrid.vue");
  assert.match(appButton, /variant\?: "primary" \| "soft" \| "amber" \| "ghost" \| "danger"/);
  assert.match(appButton, /app-button--ghost|AppIcon|pressable|::after/);
  assert.match(appAction, /tone\?: "green" \| "amber" \| "blue" \| "danger"/);
  assert.match(appAction, /resolveIconSrc|app-action-tile--compact|app-action-tile--quick|app-action-tile__box|emit\('tap'\)/);
  assert.match(appNotice, /tone\?: "green" \| "amber" \| "blue" \| "danger"/);
  assert.match(appNotice, /bg-orange light|bg-blue light|app-notice__title|app-notice__text/);
  assert.match(appEmpty, /cu-card|shadow|AppButton|app-empty__image|actionLabel/);
  assert.match(appList, /resolveIconSrc|app-list-row--danger|app-list-row__chevron|app-list-row__meta/);
  assert.match(appList, /statusLabel\?: string|chevron\?: boolean/);
  assert.match(appHero, /AppButton|app-hero-panel__visual|actionLabel\?: string|showVisual/);
  assert.match(appHero, /<slot \/>|emit\('action'\)/);
  assert.match(appPageHeader, /title: string|subtitle: string|actionIcon\?: string|statusLabel\?: string/);
  assert.match(appPageHeader, /cu-bar bg-white|AppIconButton|AppStatusBadge|app-page-header__subtitle/);
  assert.match(appSection, /title: string|action\?: string|app-section-header__action/);
  assert.match(appSection, /app-section-header__title|app-section-header__action|emit\('action'\)/);
  assert.match(appServiceProduct, /AppButton|resolveIconSrc|AppStatusBadge|app-service-product__glow/);
  assert.match(appServiceProduct, /layout\?: "tile" \| "row"|app-service-product--row|app-service-product__reason/);
  assert.match(appStatus, /tone\?: "green" \| "amber" \| "blue" \| "danger" \| "dark"/);
  assert.match(appStatus, /cu-tag|bg-green light|app-status-badge--compact|AppIcon/);
  assert.match(appMetric, /items: Array<\{ value: string \| number; label: string \}>/);
  assert.match(appMetric, /bg-green light|bg-white|app-metric-grid--dark|grid-template-columns: repeat\(3/);

  for (const page of [
    "src/pages/records/index.vue",
    "src/pages/family/index.vue",
  ]) {
    assert.match(read(page), /AppButton/);
  }
  assert.doesNotMatch(read("src/pages/index/index.vue"), /AppButton/);
  for (const page of [
    "src/pages/records/index.vue",
    "src/pages/services/index.vue",
    "src/pages/family/index.vue",
  ]) {
    assert.match(read(page), /AppNotice/);
  }
  assert.match(read("src/pages/archive/health.vue"), /AppEmptyState/);
  for (const page of [
    "src/pages/records/index.vue",
    "src/pages/family/index.vue",
  ]) {
    assert.match(read(page), /AppPageHeader/);
    assert.doesNotMatch(read(page), /page-head__title|page-head__sub|head-action/);
  }
  assert.match(read("src/pages/services/index.vue"), /page-head__spacer|page-head__link|section__title/);
  assert.doesNotMatch(read("src/pages/services/index.vue"), /AppPageHeader/);
  for (const page of [
    "src/pages/records/index.vue",
    "src/pages/family/index.vue",
  ]) {
    assert.match(read(page), /AppSectionHeader/);
    assert.doesNotMatch(read(page), /section-title__main|section-title__link/);
  }
  const colorUiPageShells = {
    "src/pages/index/index.vue": /greeting-title|poster-card|task-section|health-grid|service-section/,
    "src/pages/mine/index.vue": /profile-panel|stats-card|menu-card|page-head/,
    "src/pages/records/index.vue": /summary-card|profile-box|已保存的患者信息/,
    "src/pages/plans/detail.vue": /plan-card|progress-ring|task-row/,
    "src/pages/services/index.vue": /page-head|category-grid|section__title|recommend-card/,
    "src/pages/family/index.vue": /family-card--green|family-card--blue|empty-card/,
  };
  for (const [page, pattern] of Object.entries(colorUiPageShells)) {
    assert.match(read(page), pattern);
  }
  const colorUiSupportPages = {
    "src/pages/auth/bind.vue": /btn--primary|btn--wechat|open-type="getPhoneNumber"/,
    "src/pages/archive/profile.vue": /AppButton|view-card cu-card radius shadow|service-note radius bg-blue light/,
    "src/pages/archive/health.vue": /AppButton|intro-card cu-card radius shadow|category-card cu-card radius shadow/,
    "src/pages/replies/index.vue": /AppButton|query-intro cu-card radius shadow|result-card cu-card radius shadow/,
    "src/pages/article/detail.vue": /AppButton|article-card cu-card radius shadow|review-badge cu-tag round/,
    "src/pages/faq/index.vue": /AppButton|faq-intro cu-card radius shadow|faq-card cu-card radius shadow/,
    "src/pages/invite/form.vue": /AppButton|service-note radius bg-blue light|reloadInviteForm/,
    "src/pages/form/add.vue": /AppButton|service-note radius bg-blue light/,
    "src/pages/form/admission.vue": /AppButton|service-note radius bg-blue light/,
    "src/pages/form/contact.vue": /AppButton|service-note radius bg-blue light/,
  };
  for (const [page, pattern] of Object.entries(colorUiSupportPages)) {
    const source = read(page);
    assert.match(source, pattern);
    assert.doesNotMatch(source, /state-action|retry-button/);
  }
  for (const page of [
    "src/pages/plans/detail.vue",
  ]) {
    assert.doesNotMatch(read(page), /plan-hero|service-hero/);
  }
  assert.match(read("src/pages/family/index.vue"), /AppStatusBadge/);
  assert.match(read("src/pages/services/index.vue"), /action-label|查看服务/);
  assert.match(read("src/pages/mine/index.vue"), /profile__meta|完善档案|stats/);
  assert.doesNotMatch(read("src/pages/plans/detail.vue"), /status-label="自主管理"/);
  assert.doesNotMatch(read("src/pages/index/index.vue"), /plan-card__badge|service-card__unread|brandbar__pill/);
  assert.doesNotMatch(read("src/pages/family/index.vue"), /family-card__btn|permission-row text/);
  assert.doesNotMatch(read("src/pages/index/index.vue"), /recommend-card|product-card/);
  assert.doesNotMatch(read("src/pages/index/index.vue"), /quick-btn|category-btn|action-card/);
  assert.match(read("src/pages/records/index.vue"), /AppListRow/);
  assert.doesNotMatch(read("src/pages/records/index.vue"), /menu-row|record-row/);
  assert.match(read("src/pages/mine/index.vue"), /stats|menu-card|profile__meta/);
  assert.match(read("src/pages/plans/detail.vue"), /data\.stats|progressPercent/);
  assert.doesNotMatch(read("src/pages/mine/index.vue"), /stat-num|stat-label/);
});

test("表单与长辈模式保留明确标签和可访问触控尺寸", () => {
  const form = read("src/components/PatientForm.vue");
  const runtimeStyles = [
    read("src/App.vue"),
    read("../packages/patient-design/tokens.css"),
  ].join("\n");
  assert.match(form, /提交申请/);
  assert.match(form, /field-error/);
  assert.match(form, /cu-form-group|cu-btn round bg-green|cu-tag radius|card-menu/);
  assert.match(runtimeStyles, /--touch-target:\s*44px/);
  assert.match(runtimeStyles, /--touch-target:\s*52px/);
  assert.match(runtimeStyles, /--font-body:\s*18px/);
  assert.match(runtimeStyles, /\.elder\s*\{[\s\S]*--font-body:\s*25px/);
});

test("Image 2 正式资产已保存到小程序工程", () => {
  const assets = read("src/constants/v32Assets.ts");
  for (const file of [
    "rehab-guide-cover.webp",
    "report-upload-guide.webp",
    "health-record-empty.webp",
    "health-plan-service-hero.webp",
    "home-hero-action.webp",
    "empty-no-plan.webp",
    "family-empty.webp",
    "assistant-health-avatar.webp",
    "assistant-life-avatar.webp",
    "default-user-avatar.webp",
  ]) {
    assert.equal(existsSync(path.join(root, "src/static/visual", file)), true, file);
    assert.match(assets, new RegExp(file.replace(".", "\\.")));
  }
  for (const file of ["home.png", "home-active.png", "chat.png", "chat-active.png", "user.png", "user-active.png"]) {
    assert.equal(existsSync(path.join(root, "src/static/tab", file)), true, file);
  }
  assert.match(read("package.json"), /sync-mp-static\.py/);
  assert.equal(existsSync(path.join(root, "scripts/sync-mp-static.py")), true);
  for (const file of [
    "quick-upload.png",
    "quick-med.png",
    "quick-metric.png",
    "quick-followup.png",
    "quick-service.png",
  ]) {
    assert.equal(existsSync(path.join(root, "src/static/icons", file)), true, file);
  }
  assert.match(read("src/api/mock/v32.ts"), /quick-upload|quick-med|quick-metric/);
  assert.match(read("src/utils/mediaSrc.ts"), /quick-upload|resolveHomeQuickIcon|HOME_QUICK_BY_KEY/);
  assert.match(read("src/api/mock/v32.ts"), /V32_VISUAL_ASSETS/);
  assert.match(read("src/pages/archive/health.vue"), /V32_VISUAL_ASSETS\.healthRecordEmpty/);
  assert.match(read("src/pages/mine/index.vue"), /chooseAvatar|nameInitial|profile-panel/);
  assert.match(read("src/components/AppHeroPanel.vue"), /app-hero-panel__visual/);
  assert.match(read("src/pages/plans/detail.vue"), /plan-card|data\.title/);
  assert.match(read("src/pages/services/index.vue"), /section__title|category-grid/);
});

test("微信开发者工具不会过滤实际引用的组件", () => {
  const project = readJson("project.config.json");
  const privateProject = readJson("project.private.config.json");
  assert.equal(project.setting.ignoreDevUnusedFiles, false);
  assert.equal(privateProject.setting.ignoreDevUnusedFiles, false);
});

test("微信构建会修正输出目录中的依赖过滤配置", async () => {
  const packageJson = readJson("package.json");
  assert.match(packageJson.scripts["build:mp-weixin"], /patch-wechat-config\.mjs/);

  const patcherPath = path.join(root, "scripts", "patch-wechat-config.mjs");
  assert.equal(existsSync(patcherPath), true, "缺少微信构建配置修正脚本");

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "wechat-config-"));
  try {
    writeFileSync(
      path.join(fixtureRoot, "project.config.json"),
      JSON.stringify({ appid: "touristappid", setting: { ignoreDevUnusedFiles: true } }),
    );
    writeFileSync(
      path.join(fixtureRoot, "project.private.config.json"),
      JSON.stringify({ setting: { ignoreDevUnusedFiles: true } }),
    );
    const sourceProjectPath = path.join(fixtureRoot, "source-project.config.json");
    writeFileSync(sourceProjectPath, JSON.stringify({ appid: "wx-test-appid" }));
    const { patchWechatConfig } = await import(pathToFileURL(patcherPath).href);
    await patchWechatConfig(fixtureRoot, sourceProjectPath);
    const readFixture = (file) => JSON.parse(readFileSync(path.join(fixtureRoot, file), "utf8"));
    assert.equal(readFixture("project.config.json").appid, "wx-test-appid");
    assert.equal(readFixture("project.config.json").libVersion, "3.14.1");
    assert.equal(readFixture("project.config.json").setting.ignoreDevUnusedFiles, false);
    assert.equal(readFixture("project.private.config.json").setting.ignoreDevUnusedFiles, false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("微信 WXSS 不使用会被错误压缩的裸伪类子选择器", () => {
  const archivePage = read("src/pages/archive/index.vue");
  assert.doesNotMatch(archivePage, />\s*:last-child/);
});

test("微信登录绑手机页已注册", () => {
  const pages = readJson("src/pages.json");
  assert.ok(pages.pages.some((p) => p.path === "pages/auth/bind"));
  assert.match(read("src/pages/auth/bind.vue"), /getPhoneNumber|sms|bind/);
  assert.match(read("src/utils/ensureLogin.ts"), /ensureLogin|openArchiveProfile|redirectTo/);
  assert.match(read("src/pages/invite/form.vue"), /buildInviteReturnUrl|invite\/form\?t=/);
});

test("账号登录采用 single-flight、结构化错误与原子换绑", () => {
  const authApi = read("src/api/auth.ts");
  const authStore = read("src/stores/auth.ts");
  const ensureLogin = read("src/utils/ensureLogin.ts");
  const home = read("src/pages/index/index.vue");
  const bind = read("src/pages/auth/bind.vue");
  const settings = read("src/pages/settings/index.vue");

  assert.match(authApi, /export class ApiError extends Error/);
  assert.match(authApi, /public status:\s*number/);
  assert.match(authApi, /public code:\s*string/);
  assert.match(authApi, /throw (?:new ApiError\(status,\s*code|createApiError\(status,\s*data\.error)/);
  assert.doesNotMatch(authApi, /mpBindPhone[\s\S]*setMpToken\(data\.mpToken\)/);
  assert.match(authApi, /createResilientTokenStorage/);
  assert.match(authApi, /forceClearMpToken/);

  assert.match(authStore, /defineStore\("auth",\s*\(\)\s*=>\s*\{[\s\S]*createAuthStateCoordinator\(\)/);
  assert.match(authStore, /const authEpoch\s*=\s*ref/);
  assert.match(authStore, /const sessionDoctorId\s*=\s*ref/);
  assert.match(authStore, /createSerialLatestExecutor/);
  assert.match(authStore, /guardedAuthRefresh/);
  assert.match(read("src/utils/authRefresh.ts"), /isStaleAuthResult/);
  assert.match(authStore, /function performSilentLogin/);
  assert.match(authStore, /authState\.capture\(token\)/);
  assert.match(authStore, /authState\.isCurrent\(captured,\s*getMpToken\(\)\)/);
  assert.match(authStore, /function commitSession/);
  assert.match(authStore, /loginExecutor\.request\(\{ doctorId/);
  assert.match(authStore, /const doctorId\s*=\s*sessionDoctorId\.value\s*\|\|\s*app\.doctor\?\.id/);
  assert.match(authStore, /function commitSession[\s\S]*authState\.transition\(doctorId\)/);
  assert.match(authStore, /function invalidateLocalSession[\s\S]*authState\.transition\(null\)/);
  assert.match(authStore, /function commitSessionWithRecovery/);
  assert.match(authStore, /recoverAfterStorageFailure/);
  assert.match(authStore, /let latestDesiredDoctorId/);
  assert.match(authStore, /let recoveryOperationId/);
  assert.match(authStore, /captureContext/);
  assert.match(authStore, /isContextCurrent/);
  assert.match(authStore, /currentResult/);

  assert.doesNotMatch(ensureLogin, /let loginRecoveryPromise|createSingleFlight/);
  const bootstrapAt = ensureLogin.indexOf("await app.load(");
  const doctorAt = ensureLogin.indexOf("const doctorId");
  assert.ok(bootstrapAt >= 0 && doctorAt > bootstrapAt, "必须先 bootstrap 再读取 doctorId");
  assert.match(ensureLogin, /status\s*===\s*401/);
  assert.match(ensureLogin, /clearSession:\s*\(\)\s*=>\s*auth\.clear\(\)/);
  assert.match(ensureLogin, /silentLogin:\s*\(id\)\s*=>\s*auth\.silentLogin\(id\)/);
  assert.match(ensureLogin, /getSessionDoctorId:\s*\(\)\s*=>\s*auth\.sessionDoctorId/);
  assert.match(ensureLogin, /auth\.runRecovery\(\s*doctorId/);
  assert.match(ensureLogin, /isStaleAuthResult/);

  assert.match(home, /let initializePromise:\s*Promise<void>\s*\|\s*null\s*=\s*null/);
  assert.match(home, /function initialize/);
  assert.doesNotMatch(home, /onShow\([\s\S]*auth\.refreshMe/);

  assert.match(settings, /rebind=1/);
  assert.match(settings, /退出登录|auth\.logout/);
  assert.match(settings, /mpUnbindPhone|解除微信绑定/);
  assert.match(settings, /setExplicitSignedOut\(true\)/);
  assert.match(bind, /const rebind\s*=\s*ref\(false\)/);
  assert.match(bind, /query\?\.rebind/);
  assert.match(bind, /微信手机号一键更换|更换成功/);
  assert.match(bind, /const completed\s*=\s*ref\(false\)/);
  assert.match(bind, /needsResumeLogin|使用微信登录|isExplicitSignedOut/);
  assert.match(ensureLogin, /isExplicitSignedOut/);
  assert.match(authStore, /setExplicitSignedOut\(true\)/);
  assert.match(authStore, /clearExplicitSignedOut/);
  assert.match(read("src/utils/signedOut.ts"), /mpExplicitSignedOut|isExplicitSignedOut/);
  assert.match(read("src/utils/aiSendStage.ts"), /markAiSendStage|request_started/);
  assert.match(read("src/pages/consult/index.vue"), /markAiSendStage\("request_started"|failAiSendStage/);
  assert.match(read("src/pages/consult/index.vue"), /confirmText:\s*"同意"/);
  assert.doesNotMatch(read("src/pages/consult/index.vue"), /同意并继续/);
  assert.match(bind, /bindGuard\.complete\(\)/);
  assert.match(bind, /auth\.commitSessionWithRecovery\(data\)/);
  assert.match(bind, /auth_recovery_failed[\s\S]*bindGuard\.complete\(\)/);
  assert.match(bind, /onUnmounted\(\(\)\s*=>\s*\{[\s\S]*timers\.dispose\(\)/);
  assert.match(bind, /:disabled="[^"]*completed/);

  const appStore = read("src/stores/app.ts");
  assert.match(appStore, /defineStore\("app",\s*\(\)\s*=>\s*\{[\s\S]*createLatestRequestCoordinator\(\)/);
  assert.match(appStore, /loadCoordinator\.run/);
  assert.match(appStore, /ELDER_TOGGLE_LOCK_MS|elderToggleLockUntil/);
  assert.match(appStore, /setElderMode|hydrateElderMode/);
  assert.match(read("src/constants/mineDefaults.ts"), /key: "elder"|asset-elder/);
  assert.match(read("src/App.vue"), /hydrateElderMode/);
});

test("single-flight 并发复用同一 Promise，失败后允许重试", async () => {
  const { createSingleFlight } = await importTypeScript("src/utils/singleFlight.ts");
  const run = createSingleFlight();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = run(async () => {
    calls += 1;
    await gate;
    return "ready";
  });
  const second = run(async () => {
    calls += 1;
    return "duplicate";
  });
  assert.strictEqual(first, second);
  assert.equal(calls, 0);
  release();
  assert.equal(await first, "ready");
  assert.equal(calls, 1);

  await assert.rejects(
    run(async () => {
      calls += 1;
      throw new Error("first_failed");
    }),
    /first_failed/
  );
  assert.equal(await run(async () => {
    calls += 1;
    return "retry_ok";
  }), "retry_ok");
  assert.equal(calls, 3);
});

test("登录恢复先加载 doctorId，且只对 401 清会话后重试一次", async () => {
  const { runLoginRecovery } = await importTypeScript("src/utils/loginRecovery.ts");
  const calls = [];
  let doctorId;
  const result = await runLoginRecovery({
    loadBootstrap: async () => {
      calls.push("bootstrap");
      doctorId = 17;
    },
    getDoctorId: () => doctorId,
    hasToken: () => false,
    refreshMe: async () => calls.push("refresh"),
    silentLogin: async (id) => calls.push(`login:${id}`),
    clearSession: () => calls.push("clear"),
    isUnauthorized: () => false,
  });
  assert.equal(result, "ready");
  assert.deepEqual(calls, ["bootstrap", "login:17"]);

  const retryCalls = [];
  await runLoginRecovery({
    loadBootstrap: async () => retryCalls.push("bootstrap"),
    getDoctorId: () => 18,
    hasToken: () => true,
    refreshMe: async () => {
      retryCalls.push("refresh");
      throw { status: 401, code: "unauthorized" };
    },
    silentLogin: async (id) => retryCalls.push(`login:${id}`),
    clearSession: () => retryCalls.push("clear"),
    isUnauthorized: (error) => error?.status === 401,
  });
  assert.deepEqual(retryCalls, ["refresh", "clear", "login:18"]);

  const limitedCalls = [];
  await assert.rejects(
    runLoginRecovery({
      loadBootstrap: async () => limitedCalls.push("bootstrap"),
      getDoctorId: () => 19,
      hasToken: () => true,
      refreshMe: async () => {
        limitedCalls.push("refresh");
        throw { status: 429, code: "rate_limited" };
      },
      silentLogin: async () => limitedCalls.push("login"),
      clearSession: () => limitedCalls.push("clear"),
      isUnauthorized: (error) => error?.status === 401,
    }),
    (error) => error?.status === 429
  );
  assert.deepEqual(limitedCalls, ["refresh"]);
});

test("401 与 429 会生成可区分且不回显服务端原文的安全错误", async () => {
  const { resolveApiError } = await importTypeScript("src/api/apiError.ts");
  assert.deepEqual(resolveApiError(401, "unauthorized"), {
    status: 401,
    code: "unauthorized",
    message: "登录状态已失效，请重新登录",
  });
  assert.deepEqual(resolveApiError(429, "rate_limited"), {
    status: 429,
    code: "rate_limited",
    message: "请求过于频繁，请稍后再试",
  });
  assert.equal(resolveApiError(500, "<script>unsafe</script>").message, "服务暂时不可用，请稍后再试");
});

test("认证快照阻止旧 refresh 覆盖或清除新 bind 会话", async () => {
  const { createAuthStateCoordinator } = await importTypeScript(
    "src/utils/authStateCoordinator.ts"
  );
  const state = createAuthStateCoordinator();
  state.transition(11);
  const refreshT1 = state.capture("token-t1");
  const applied = [];
  const cleared = [];

  state.transition(11);
  assert.equal(state.epoch, 2);
  assert.equal(
    state.runIfCurrent(refreshT1, "token-t2", () => applied.push("t1")),
    false
  );
  assert.equal(
    state.runIfCurrent(refreshT1, "token-t2", () => cleared.push("t1-401")),
    false
  );
  assert.deepEqual(applied, []);
  assert.deepEqual(cleared, []);

  const refreshT2 = state.capture("token-t2");
  assert.equal(
    state.runIfCurrent(refreshT2, "token-t2", () => applied.push("t2")),
    true
  );
  assert.deepEqual(applied, ["t2"]);

});

test("换绑 T2 后旧 T1 refresh 的 401 作为 stale 继续恢复且不清新会话", async () => {
  const { createAuthStateCoordinator } = await importTypeScript(
    "src/utils/authStateCoordinator.ts"
  );
  const { guardedAuthRefresh, isStaleAuthResult } = await importTypeScript(
    "src/utils/authRefresh.ts"
  );
  const { runLoginRecovery } = await importTypeScript("src/utils/loginRecovery.ts");
  const state = createAuthStateCoordinator();
  state.transition(11);
  let token = "token-t1";
  let rejectOldRefresh;
  let refreshCount = 0;
  let clearCount = 0;

  const refreshMe = () => {
    refreshCount += 1;
    const snapshot = state.capture(token);
    const request = refreshCount === 1
      ? () => new Promise((resolve, reject) => {
        rejectOldRefresh = reject;
      })
      : async () => ({ doctorId: 11, mpToken: token });
    return guardedAuthRefresh({
      snapshot,
      request,
      isCurrent: (captured) => state.isCurrent(captured, token),
      apply: (data) => state.rememberDoctor(data.doctorId),
      clearOnUnauthorized: () => {
        clearCount += 1;
        token = "";
        state.transition(null);
      },
      isUnauthorized: (error) => error?.status === 401,
    });
  };

  const recovery = runLoginRecovery({
    loadBootstrap: async () => {},
    getDoctorId: () => 11,
    getSessionDoctorId: () => state.doctorId,
    hasToken: () => !!token,
    refreshMe,
    silentLogin: async () => {
      throw new Error("不应重新 login");
    },
    clearSession: () => {
      clearCount += 1;
    },
    isUnauthorized: (error) => error?.status === 401,
    isStaleAuthResult,
  });
  await Promise.resolve();

  token = "token-t2";
  state.transition(11);
  rejectOldRefresh({ status: 401, code: "unauthorized" });
  assert.equal(await recovery, "ready");
  assert.equal(token, "token-t2");
  assert.equal(clearCount, 0);
  assert.equal(refreshCount, 2);
});

test("同一 store 的 A→B 登录严格串行且只采用最终 B token", async () => {
  const { createSerialLatestExecutor } = await importTypeScript(
    "src/utils/serialLatestExecutor.ts"
  );
  const pending = [];
  const serverCalls = [];
  const accepted = [];
  let serverToken = "";
  let concurrent = 0;
  let maxConcurrent = 0;
  let tokenSequence = 0;

  const executor = createSerialLatestExecutor({
    key: (doctorId) => String(doctorId),
    execute: (doctorId) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      serverCalls.push(doctorId);
      return new Promise((resolve) => {
        pending.push(() => {
          concurrent -= 1;
          serverToken = `token-${doctorId}-${++tokenSequence}`;
          resolve({ doctorId, mpToken: serverToken });
        });
      });
    },
    accept: (doctorId, result) => {
      accepted.push(result.mpToken);
      assert.equal(result.doctorId, doctorId);
    },
  });

  const loginA = executor.request(11);
  const loginB = executor.request(22);
  assert.strictEqual(loginA, loginB);
  assert.deepEqual(serverCalls, [11]);
  assert.equal(maxConcurrent, 1);

  pending.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(serverCalls, [11, 22]);
  assert.deepEqual(accepted, []);
  pending.shift()();
  const result = await loginB;
  assert.equal(result.mpToken, serverToken);
  assert.match(serverToken, /^token-22-/);
  assert.deepEqual(accepted, [serverToken]);
  assert.equal(maxConcurrent, 1);
});

test("A 存储恢复 pending 时切换 B，A 收尾不得清除已落地的 B", async () => {
  const { createSerialLatestExecutor } = await importTypeScript(
    "src/utils/serialLatestExecutor.ts"
  );
  const { recoverAfterStorageFailure } = await importTypeScript(
    "src/utils/authRecovery.ts"
  );
  const pending = [];
  let current = { doctorId: 11, mpToken: "old-token" };
  let invalidateCount = 0;
  let desiredDoctorId = 11;
  let operationId = 1;
  let epoch = 0;

  const executor = createSerialLatestExecutor({
    key: (doctorId) => String(doctorId),
    execute: (doctorId) =>
      new Promise((resolve) => {
        pending.push(() =>
          resolve({ doctorId, mpToken: `token-${doctorId}` })
        );
      }),
    accept: (_doctorId, result) => {
      current = result;
      epoch += 1;
    },
  });

  const recoveryA = recoverAfterStorageFailure({
    invalidate: () => {
      invalidateCount += 1;
      current = { doctorId: null, mpToken: "" };
      epoch += 1;
    },
    captureContext: () => ({ doctorId: 11, epoch, operationId }),
    isContextCurrent: (context) =>
      context.operationId === operationId &&
      desiredDoctorId === context.doctorId,
    currentResult: () => (current.mpToken ? current : null),
    login: () => executor.request(11),
    isReady: () =>
      current.doctorId === 11 &&
      current.mpToken === "token-11",
  });

  assert.equal(invalidateCount, 1);
  assert.equal(pending.length, 1);

  desiredDoctorId = 22;
  const loginB = executor.request(22);
  pending.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pending.length, 1);

  pending.shift()();
  const [recoveryResult, loginResult] = await Promise.all([recoveryA, loginB]);
  assert.equal(recoveryResult.doctorId, 22);
  assert.equal(loginResult.doctorId, 22);
  assert.deepEqual(current, { doctorId: 22, mpToken: "token-22" });
  assert.equal(invalidateCount, 1);
});

test("token 存储异常不泄露原文并通过同医生 login 恢复，失败则保持未登录", async () => {
  const { createResilientTokenStorage, TokenStorageError } = await importTypeScript(
    "src/utils/tokenStorage.ts"
  );
  const { recoverAfterStorageFailure, AuthRecoveryError } = await importTypeScript(
    "src/utils/authRecovery.ts"
  );
  let stored = "old-revoked-token";
  let failWrites = 1;
  const storage = createResilientTokenStorage({
    read: () => stored,
    write: (value) => {
      if (failWrites-- > 0) throw new Error("底层磁盘路径和隐私原文");
      stored = value;
    },
    remove: () => {
      stored = "";
    },
  });

  assert.throws(
    () => storage.set("bind-token"),
    (error) =>
      error instanceof TokenStorageError &&
      error.code === "token_storage_failed" &&
      !error.message.includes("磁盘") &&
      !error.message.includes("隐私")
  );
  assert.equal(storage.get(), "");

  const recovered = await recoverAfterStorageFailure({
    invalidate: () => storage.forceClear(),
    login: async () => {
      storage.set("recovered-doctor-11-token");
      return { doctorId: 11, mpToken: storage.get() };
    },
    isReady: () => storage.get() === "recovered-doctor-11-token",
  });
  assert.equal(recovered.mpToken, "recovered-doctor-11-token");

  await assert.rejects(
    recoverAfterStorageFailure({
      invalidate: () => storage.forceClear(),
      login: async () => {
        throw new Error("微信底层原始错误");
      },
      isReady: () => false,
    }),
    (error) =>
      error instanceof AuthRecoveryError &&
      error.code === "auth_recovery_failed" &&
      !error.message.includes("微信底层")
  );
  assert.equal(storage.get(), "");

  await assert.rejects(
    recoverAfterStorageFailure({
      invalidate: () => {
        throw new Error("清理底层隐私原文");
      },
      login: async () => ({ mpToken: "never" }),
      isReady: () => false,
    }),
    (error) =>
      error instanceof AuthRecoveryError &&
      !error.message.includes("清理底层")
  );
});

test("登录恢复发现会话医生与 bootstrap 医生不一致时清旧作用域并重登", async () => {
  const { runLoginRecovery } = await importTypeScript("src/utils/loginRecovery.ts");
  const calls = [];
  const result = await runLoginRecovery({
    loadBootstrap: async () => calls.push("bootstrap"),
    getDoctorId: () => 22,
    getSessionDoctorId: () => 11,
    hasToken: () => true,
    refreshMe: async () => calls.push("refresh"),
    silentLogin: async (doctorId) => calls.push(`login:${doctorId}`),
    clearSession: () => calls.push("clear:doctor-11"),
    isUnauthorized: () => false,
  });
  assert.equal(result, "ready");
  assert.deepEqual(calls, ["clear:doctor-11", "login:22"]);
});

test("keyed single-flight 按实例、医生和 epoch 隔离并发任务", async () => {
  const { createKeyedSingleFlight } = await importTypeScript("src/utils/singleFlight.ts");
  const storeA = createKeyedSingleFlight();
  const storeB = createKeyedSingleFlight();
  const releases = new Map();
  const calls = [];
  const task = (name) => () => new Promise((resolve) => {
    calls.push(name);
    releases.set(name, resolve);
  });

  const a1 = storeA.run("doctor-11:epoch-1", task("a1"));
  const a2 = storeA.run("doctor-11:epoch-1", task("a2"));
  const otherStore = storeB.run("doctor-11:epoch-1", task("store-b"));
  const doctorB = storeA.run("doctor-22:epoch-1", task("doctor-b"));
  assert.strictEqual(a1, a2);
  assert.notStrictEqual(a1, otherStore);
  assert.notStrictEqual(a1, doctorB);
  assert.deepEqual(calls, ["a1", "store-b", "doctor-b"]);

  releases.get("a1")("A");
  releases.get("store-b")("B");
  releases.get("doctor-b")("doctor-B");
  assert.deepEqual(await Promise.all([a1, otherStore, doctorB]), ["A", "B", "doctor-B"]);
});

test("bootstrap load 同实例 single-flight，force 乱序只允许最新响应落库", async () => {
  const { createLatestRequestCoordinator } = await importTypeScript(
    "src/utils/latestRequestCoordinator.ts"
  );
  const coordinator = createLatestRequestCoordinator();
  const pending = [];
  const committed = [];
  const settled = [];
  let requests = 0;
  const request = () => new Promise((resolve, reject) => {
    requests += 1;
    pending.push({ resolve, reject });
  });
  const options = (force) => ({
    force,
    request,
    onSuccess: (value) => committed.push(value),
    onError: (error) => committed.push(`error:${error.message}`),
    onSettled: () => settled.push("done"),
  });

  const launchLoad = coordinator.run(options(false));
  const indexLoad = coordinator.run(options(false));
  assert.strictEqual(launchLoad, indexLoad);
  assert.equal(requests, 1);
  pending.shift().resolve("initial");
  await launchLoad;
  assert.deepEqual(committed, ["initial"]);

  const olderForce = coordinator.run(options(true));
  const newestForce = coordinator.run(options(true));
  assert.equal(requests, 3);
  const older = pending.shift();
  const newest = pending.shift();
  newest.resolve("newest");
  await newestForce;
  older.resolve("older");
  await olderForce;
  assert.deepEqual(committed, ["initial", "newest"]);
  assert.equal(settled.length, 2);
});

test("绑定提交成功后保持禁用，失败可重试且页面销毁释放全部定时器", async () => {
  const { createSubmissionGuard } = await importTypeScript(
    "src/utils/submissionGuard.ts"
  );
  const states = [];
  const guard = createSubmissionGuard((state) => states.push({ ...state }));
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.complete();
  guard.finish();
  assert.deepEqual(guard.state, { busy: true, completed: true });
  assert.equal(guard.start(), false);

  const retryGuard = createSubmissionGuard();
  assert.equal(retryGuard.start(), true);
  retryGuard.finish();
  assert.deepEqual(retryGuard.state, { busy: false, completed: false });
  assert.equal(retryGuard.start(), true);

  const { createTimerRegistry } = await importTypeScript("src/utils/timerRegistry.ts");
  const cleared = [];
  let nextId = 0;
  const timers = createTimerRegistry({
    setTimeout: () => ++nextId,
    clearTimeout: (id) => cleared.push(`timeout:${id}`),
    setInterval: () => ++nextId,
    clearInterval: (id) => cleared.push(`interval:${id}`),
  });
  const navigationTimer = timers.timeout(() => {}, 400);
  timers.interval(() => {}, 1000);
  timers.clear(navigationTimer);
  timers.dispose();
  assert.deepEqual(cleared, ["timeout:1", "interval:2"]);
  assert.equal(timers.timeout(() => {}, 500), null);
  assert.equal(nextId, 2);
});

test("档案相关入口已接 ensureLogin 门禁", () => {
  assert.match(read("src/pages/index/index.vue"), /ensureLogin/);
  assert.match(read("src/pages/mine/index.vue"), /ensureLogin/);
  assert.match(read("src/pages/consult/index.vue"), /ensureLogin/);
  assert.match(read("src/pages/archive/profile.vue"), /ensureLogin/);
  // 健康记录浏览允许懒登录；有 token 时 refreshMe，写操作再门禁
  assert.match(read("src/pages/archive/health.vue"), /getMpToken|ensureLogin/);
  assert.match(read("src/pages/replies/index.vue"), /ensureLogin/);
  assert.match(read("src/pages/form/add.vue"), /ensureLogin|PatientForm|getMpToken/);
  assert.match(read("src/pages/form/admission.vue"), /ensureLogin|PatientForm|getMpToken/);
  assert.match(read("src/pages/form/contact.vue"), /ensureLogin|PatientForm|getMpToken/);
  assert.match(read("src/pages/invite/form.vue"), /ensureLogin/);
});

test("患者展示名禁止演示假名，绑号后引导完善档案", () => {
  assert.match(read("src/utils/displayName.ts"), /resolvePatientDisplayName|resolvePatientGreetingLabel/);
  assert.doesNotMatch(read("src/pages/index/index.vue"), /张女士/);
  assert.doesNotMatch(read("src/pages/mine/index.vue"), /张女士/);
  assert.match(read("src/pages/auth/bind.vue"), /finishAfterPhoneBound|getMyArchive/);
  assert.match(read("src/utils/ensureLogin.ts"), /ARCHIVE_PROFILE_URL|openArchiveProfile/);
  assert.match(read("src/pages/archive/profile.vue"), /档案已同步|getMyArchive/);
  assert.match(read("src/pages/index/index.vue"), /ensureLogin|records\/index/);
  assert.match(read("src/components/PatientForm.vue"), /phoneFieldLocked|field__control--readonly/);
  assert.match(read("src/api/patient.ts"), /已登录只信服务端|emptyArchive/);
  assert.match(read("src/api/auth.ts"), /mpUnbindPhone|unbind-phone/);
  assert.match(read("src/pages/settings/index.vue"), /更换绑定手机号|onRebindPhone/);
});

test("本地缓存与 AI 会话按作用域分桶", () => {
  assert.match(read("src/utils/storageScope.ts"), /buildStorageScope|scopedStorageKey/);
  assert.match(read("src/utils/mpAiSession.ts"), /mpAiIdentity|scope/);
  assert.match(read("src/pages/mine/index.vue"), /avatarCacheKey|scopedStorageKey/);
  assert.match(read("src/pages/mine/index.vue"), /mpAvatarPending|syncPendingAvatar|已本地更新，稍后自动同步/);
  assert.match(read("src/api/patient.ts"), /state:\s*"success"\s*\|\s*"empty"\s*\|\s*"error"/);
});

test("V32 API 默认禁止静默 mock 回退", () => {
  const src = read("src/api/v32.ts");
  assert.doesNotMatch(src, /fallback to mock/);
  assert.match(src, /V32_ALLOW_MOCK_FALLBACK|ALLOW_MOCK_FALLBACK/);
  assert.match(src, /throw /);
});

test("Tab 选中色为春雨青绿", () => {
  const pages = readJson("src/pages.json");
  assert.equal(String(pages.tabBar.selectedColor).toLowerCase(), "#176b52");
});

test("首页三态：异常优先于计划，无计划走空态 HOME-001", () => {
  const page = read("src/pages/index/index.vue");
  // 改版后首页为海报卡 + 当前任务 + 健康入口结构；异常/空态数据仍由 feed 契约与 mock 支撑
  assert.match(page, /poster-card|task-section|health-section|service-section/);
  assert.match(read("src/types/v32.ts"), /HomeAlert|softNotice|subtitle/);
  assert.match(read("src/api/mock/v32.ts"), /mockHomeFeedAbnormal|mockHomeFeedEmpty|高优先级异常/);
});

test("Task 7 权益展示与请求页面对接后端 API 和契约", () => {
  const instanceSource = read("src/pages/services/instance.vue");
  const pagesJsonSource = read("src/pages.json");
  const entitlementSource = read("src/pages/services/entitlement.vue");

  assert.match(instanceSource, /listInstanceEntitlements|权益/);
  assert.match(pagesJsonSource, /"path":\s*"entitlement"/);
  assert.match(pagesJsonSource, /权益详情/);
  assert.match(entitlementSource, /getEntitlement|requestEntitlementUsage/);
});
