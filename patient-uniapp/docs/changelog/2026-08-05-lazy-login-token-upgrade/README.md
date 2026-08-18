# 更改记录：懒登录改造 + 设计令牌字体化（2026-08-05）

**日期**：2026-08-05 14:58 ~ 15:01
**范围**：患者小程序（patient-uniapp）6 个页面
**性质**：源码修改 + mp-weixin 重新构建（dist/build/mp-weixin 15:01:59 更新）
**决定**：保留全部改动；本目录留存更改记录与前后版本

---

## 一、修改文件清单

| 页面 | 修改时间 | 修改后行数 | 修改前行数 | 版本属性 |
|------|---------|-----------|-----------|---------|
| `src/pages/index/index.vue` | 14:58:48 | 919 | 883 | 新版（含 8/3 v32 开发）+ 本次叠加 |
| `src/pages/archive/health.vue` | 15:00:08 | 174 | 173 | 旧版（8/3 大开发未覆盖） |
| `src/pages/form/contact.vue` | 15:00:36 | 55 | 57 | 旧版 |
| `src/pages/form/add.vue` | 15:00:50 | 42 | 43 | 旧版 |
| `src/pages/form/admission.vue` | 15:01:06 | 42 | 43 | 旧版 |
| `src/pages/records/index.vue` | 15:01:21 | 357 | 368 | 旧版 |

> 版本属性说明：`index.vue` 在 8/3 15:51"患者小程序账户兼容"大开发中已更新（含 v32 快速入口、`resolveHomeQuickIcon`、`syncCustomTabBar` 等）；其余 5 个页面自 8/3 09:41 快照后、本次修改前未被更新，为旧版页面。

---

## 二、改动内容明细

### 1. 登录策略：强制登录 → 懒登录

| 页面 | 修改前 | 修改后 |
|------|--------|--------|
| `form/contact.vue` | `onShow` 中 `void ensureLogin("/pages/form/contact")` | 移除 `ensureLogin` 导入与调用，注释"懒登录：填写/提交表单不强制登录（表单自带手机号收集，提交走公开接口）" |
| `form/add.vue` | `onShow` 中 `void ensureLogin("/pages/form/add")` | 同上移除，注释"懒登录：填写/提交不强制登录（表单自带手机号收集）" |
| `form/admission.vue` | `onShow` 中 `void ensureLogin("/pages/form/admission")` | 同上移除 |
| `archive/health.vue` | `onShow`：未绑定手机号 → `ensureLogin` | `onShow`：仅 `auth.phoneBound && getMpToken()` 时加载；否则清空分类/记录并置 `loading=false` 静默空态。注释"懒登录：浏览健康记录不强制登录；未登录静默空态，进入档案操作时再绑定" |
| `records/index.vue` | `onMounted` 内先 `ensureLogin` 再加载；`AppBackNav` 顶栏 | 登录门控前移：`onShow` 中 `ensureLogin` 结果驱动 `pageReady`；`AppBackNav` → `AppPageHeader`（含 `action-icon="health" @action="openUpload"`） |

### 2. 设计令牌字体化（硬编码像素 → `var(--font-*)`）

统一映射（涉及 5 个旧版页面全部文本样式）：

| 原硬编码 | 替换令牌（兜底值） |
|---------|------------------|
| `12px` | `var(--font-caption, 14px)` |
| `13px` | `var(--font-secondary, 16px)` |
| `14px` | `var(--font-secondary, 16px)` |
| `15px` | `var(--font-body, 18px)` |
| `16px` | `var(--font-subheading, 19px)` |

### 3. 图标尺寸放大

| 原尺寸 | 新尺寸 | 出现位置 |
|--------|--------|---------|
| 22 | 27 | 表单页 `AppIcon lock/calendar/bed`、健康页 `file/calendar/chevron` |
| 24 | 29 | 错误态 `help` 图标 |
| 28 | 34 | 空态/`unavailable` 图标、健康页 `health` 图标 |
| 18 | 22 | 记录卡 `calendar/chevron` 图标 |

### 4. index.vue 附加改动（叠加在 v32 新版上）

- 新增 `resolveHomeQuickIcon` / `resolveIconSrc` 导入，快速入口图标解析
- 新增 `safeFeed` 访客态兜底结构（plan/alert/softNotice/pendingRecord/quickActions 默认空）
- 新增 `emptyStateIconSrc`（`resolveIconSrc("asset-records", "#176B52")`）

---

## 三、已识别风险提示（未处理，仅记录）

1. **登录策略一致性**：3 个表单页移除强制登录后走公开提交接口，但 `auth.phoneBound` 预填（`fetchArchiveFormPrefill`）依赖登录态——未登录用户提交时预填缺失。需确认后端公开接口的提交校验与 8/3 账户兼容体系（`ensureLogin`/bind 流程/v32 token）是否对齐。
2. **设计令牌兜底放大**：`var(--font-caption, 14px)` 等令牌兜底值大于原硬编码（12/13px），若 `uni.scss` 未定义对应令牌，小字会实际放大，可能影响原定稿视觉。已确认 `src/uni.scss` 8/3 10:22 定义过令牌（需真机确认实际渲染）。
3. **旧版基础**：5 个旧版页面（health/contact/add/admission/records）缺少 8/3 15:51 账户兼容大开发的 v32 逻辑，本次改造建立在旧版之上；后续若要与新版首页/个人中心功能衔接，需评估是否补齐 v32 相关实现。
4. **records 顶栏变更**：`AppBackNav` 移除改为 `AppPageHeader`，需确认从"我的"进入时返回路径仍正确（`openArchiveProfile` 回调）。

---

## 四、版本留存

```
before/  ← 修改前基线（取自快照 chunyu-doctor-review-snapshot-20260803-094127）
after/   ← 修改后版本（当前工作区状态）
```

如需回退：将 `before/` 对应文件复制回 `src/pages/` 原路径即可。

---

## 五、追加修复：懒登录冷启动缺陷（2026-08-05 15:30）

针对上述风险 1 的冷启动部分，已修复并重新构建（dist 15:30:58）。

### 修复 1：`archive/health.vue` — 已登录用户冷启动误走空态

- **问题**：`phoneBound` 是内存态，已登录用户冷启动时初始为 `false`（懒登录后不再经 `ensureLogin` 的 `refreshMe`），原逻辑 `if (auth.phoneBound && getMpToken())` 会误走"静默空态"，看不到已归档记录。
- **修复**：`onShow` 中有 token 但 `phoneBound` 为空时，先静默 `await auth.refreshMe()` 恢复登录态（401 时内部自动清 token），恢复成功再加载记录；同时**移除无门控的 `onMounted(loadRecords)`**（避免无 token 时直接请求导致 401 错误态覆盖空态）。

### 修复 2：`form/contact.vue` — 已登录用户冷启动丢失档案预填

- **问题**：`fetchArchiveFormPrefill` 依赖 `phoneBound`，冷启动时为 `false` 导致已登录用户不预填。
- **修复**：`onMounted` 中有 token 但 `phoneBound` 为空时，先静默 `refreshMe` 恢复，再决定是否预填（恢复失败不影响表单填写，懒登录语义不变）。

### 修复后逻辑（懒登录语义保持不变）

| 场景 | 行为 |
|------|------|
| 未登录（无 token） | 静默空态 / 直接填写表单，不强制登录 ✅ |
| 已登录冷启动 | 静默恢复登录态 → 正常加载记录 / 预填 ✅（本次修复） |
| 已登录返回页面 | 直接加载 ✅ |

---

## 六、追加修复：打开"我的"页触发 unauthorized 报错（2026-08-05 15:53）

### 现象

未登录（无有效 mpToken）用户打开"我的"页，控制台自动打印多条 `Error: unauthorized`。

### 根因（Phase 1 调查结论）

```
打开"我的"页
→ mine/index.vue onMounted + onShow 无条件调用 healthAssets.loadMine()
→ GET /api/mp/v32/mine-assets（未登录无 Authorization）
→ 后端 mp-v32.js requirePerson：无 token → 401 {error:"unauthorized"}
→ v32.ts requestV32 throw Error("unauthorized")
→ healthAssets.ts withLoading 的 console.error(e) → 控制台报错
```

对比：首页 `index.vue`（今天懒登录改造的新版）已有 `if (!getMpToken()) { homeStore.reset(); return; }` 门控（loadHome，123 行）；"我的"页 store 层**缺失同一门控**——懒登录改造的遗漏点。

### 修复（根因）

`src/stores/healthAssets.ts`：`loadMine / loadRecords / loadPlan / loadFamily` 4 个加载函数统一加 `if (!getMpToken()) return;` 门控——未登录不请求受保护接口，与首页 `loadHome` 懒登录模式对齐。

- 未登录：不请求，静默（菜单项由 `withLocalIcons` 回退本地 `MINE_DEFAULTS`，页面正常渲染）
- 已登录：正常加载（登录后 `onShow` 的 `loadMine(true)` 正常刷新）
- 已重新构建（dist 15:53:43），产物含门控

### 遗留边缘场景（已知、可接受）

token 失效冷启动：`onMounted` 的 `loadMine` 会先请求一次（401 噪音一次），随后 `onShow` 的 `refreshMe` 检测 401 并清理 token，后续恢复正常。该次 401 是合理的会话失效诊断，不阻塞。

---

## 七、服务端回归修复：home-feed 500（2026-08-05 16:15）

### 现象

重新登录后首页报「健康首页加载失败」，云端日志：`GET /api/mp/v32/home-feed Cannot read properties of undefined (reading 'map')`。

### 根因（本次 A1 清理引入的回归）

- A1 删除了 `servicesCatalog.js` 的 `PRODUCTS` 导出
- 但 `feed.js:3` 仍 `require("./servicesCatalog.js").PRODUCTS` → `undefined`
- 首页 `buildHomeFeed` → `filterRecommendations` → `defaultRecommendations()` → `PRODUCTS.map()` → 500

### 修复

1. `app/modules/mpV32/feed.js`：删除 `PRODUCTS` import；`defaultRecommendations()` 返回 `[]`（演示推荐一并清理，首页不再展示"医生共管/复诊协助"）
2. `app/_mp_v32_test.js`：更新断言（products 应为空），移除对 `copilot` 的依赖
3. 已部署云端（备份 `.bak-homefeed-fix-*`）+ PM2 重启 + 云端模拟 buildHomeFeed 验证通过

### 教训

删除导出时必须检查全部引用者（`grep PRODUCTS` 只查了 servicesCatalog 相关，漏了 feed.js 的跨模块引用）。已补全引用检查并同步更新测试。

---

## 八、首页推荐区恢复：医生管家 / 复诊协助（2026-08-05 16:30）

### 现象

A1 清理时把 `defaultRecommendations()` 改为返回 `[]`，导致首页"常用健康服务"区（医生管家 / 复诊协助 两个大卡片）消失。

### 决策

这两个卡片是**服务导航入口**（点击进入健康服务中心），非"可购买商品占位"，业务上需要保留。恢复入口，同时移除"（本期仅展示）"等演示占位文案。

### 修复

`app/modules/mpV32/feed.js` `defaultRecommendations()` 恢复返回 2 个服务入口：
- `copilot`（前端自动显示为"医生管家"）：计划审核和异常处理支持
- `followup`（复诊协助）：准备资料并协助预约

`actionUrl` 均指向 `/pages/services/index`（服务页当前显示"服务筹备中"空态，入口正确落地）。

已部署云端（备份 `.bak-recommend-restore-*`）+ 验证 `recs=copilot,followup`。

### 区分（后续服务包实施时的口径）

| 位置 | 性质 | 处理 |
|------|------|------|
| 服务页商品列表（servicesCatalog.products）| 可购买商品 | 保持空（真实商品由服务包系统提供）|
| 首页推荐区（defaultRecommendations）| 服务导航入口 | 保留（医生管家/复诊协助）|

---

## 九、B1-B4 小程序端：来源归因 + 分享合规 + 服务包查看（2026-08-05 16:45）

孙轶凡 B 组任务的小程序端部分先行实施：

### B3 来源归因（群卡片/分享/二维码 → 正确医生上下文）

- `stores/app.ts`：新增 `sourceDoctorId / sourceGroupId / sourceChannel` + `setSourceFromQuery()`（校验数字 ID、白名单 channel，忽略非法值防串医生）+ `buildSharePath()`
- `App.vue` `onLaunch`：解析 `uni.getLaunchOptionsSync().query` 存入来源参数

### B4 分享合规

- 4 个主页面（index/consult/mine/services）加 `onShareAppMessage`：`path` 携带来源参数（`buildSharePath`），**标题不含任何患者信息**；services 页标题含医生名（非患者信息）

### 服务包查看界面

- `pages.json`：注册 `pages/services/detail`（服务详情）
- 新建 `services/detail.vue`：服务包详情页骨架，对齐 PRD §9.3 信息架构——
  医生/机构、价格拆分（总价/服务/实物/运费）、服务周期、适用范围、康复内容、
  术后评估、春雨问诊（**独立支付提示**）、实物商品、退款规则；
  从服务页商品列表按 id 匹配，**无商品时展示"服务筹备中"空态**，真实服务包数据接入后自动填充
- 服务页 `onProductAction` 跳转路径（A4 预留）现已落地到真实页面

### 验证

- ✅ 构建成功（16:45:19），detail 页面产物生成，app.json 注册 `services/detail`
- ✅ 分享/来源参数编译进产物
- ✅ 小程序端无需部署云端（纯前端），后端无改动

### 说明

- 群卡片模板配置（B1）/群配置切换（B2）属于后台配置 + 医生/群数据，待试点群正式配置后由后台完成（不涉及小程序代码）
- "患者本人信息查询"：我的页健康资产（档案/计划/记录/家庭）已具备，本次未改动

