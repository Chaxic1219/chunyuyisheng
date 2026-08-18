# 春雨医生患者端 UniApp Demo 设计

**日期：** 2026-07-17  
**状态：** 已批准并进入开发（Demo 已落地）  
**范围：** 仅患者端微信小程序 Demo + 共享设计令牌包；不部署、不改后端构建、不上传服务器

---

## 1. 背景与目标

现有患者端为 `app/public` 下原生 JS H5（`patient.js` + `app.css`），医助后台为 `admin-ui`（Vue3，本期不动）。主人需要将患者端迁移重绘为 UniApp，先产出可本地演示的微信小程序 Demo。

**成功标准：**

1. 微信开发者工具可打开并点通 MVP 主流程（首页 → 咨询 → 表单提交 toast）。
2. 视觉调性与现网 H5 一致（医疗青蓝、适老、低认知负荷）。
3. 色板/图标/API 类型集中在共享包，便于日后 H5 对齐同一源头。
4. 默认无后端也可跑（mock）；不要求部署与真机发布。

---

## 2. 已锁定决策

| 项 | 决策 |
|----|------|
| 目标端 | 仅微信小程序 |
| 范围 | MVP Demo（非全量对齐） |
| 视觉 | 与现网浏览器端同调性（沿用 `app.css` 令牌） |
| 同步策略 | 方案一：共享令牌 + 图标 + API 类型包；不共享 Vue 组件 |
| 后端/部署 | 不考虑上传服务器、构建发布；后端可不动 |
| 管理端 | `admin-ui` 不迁移 |

---

## 3. 架构

```
chunyu-doctor-review/
├── packages/patient-design/   # 共享：tokens / icons / types
├── patient-uniapp/            # UniApp Vue3 微信小程序 Demo
├── app/                       # 现有全栈（本期不改；可选本地联调）
└── admin-ui/                  # 不动
```

- **技术栈：** UniApp（Vue3 + Vite）+ TypeScript（优先）+ 微信小程序运行时  
- **UI：** 自绘，对齐现网；不引入 Element Plus；可选轻量图标自 `patient-design`  
- **状态：** 页面级 + 简单全局 store（bootstrap、elderMode、patientKey）即可  

---

## 4. MVP 页面与导航

### 4.1 TabBar

| Tab | 内容 |
|-----|------|
| 首页 | 医生名片、核心入口、分组功能列表、长辈模式开关 |
| 咨询 | 聊天流、mock 分诊卡、选图附件（最多 3） |
| 我的 | 联络表入口、查看回复（mock）、FAQ、文章入口 |

### 4.2 子页面

- 门诊加号表单  
- 住院预约表单  
- 医患联络表  
- 文章详情（门诊时间等，mock 正文）

### 4.3 Demo 明确不做

视频问诊真链、海报保存相册、TTS「听一听」、口碑提交、候补名单、多医生切换（固定一位 mock 医生）、短信真发、微信开放标签拉小程序、真机发布与 CI。

---

## 5. 共享包 `packages/patient-design`

| 内容 | 说明 |
|------|------|
| `tokens.css` / `tokens.json` | 从 `app/public/app.css` 抽出：`--primary #0A6E8C`、`--teal`、`--bg`、间距、圆角、长辈模式字号规则 |
| `icons/` | 与 `ui.js` 中线性图标语义对齐的 SVG（chat/plus/bed/…） |
| `types/` | bootstrap、doctor、content、message、submit 等 TS 类型 |

**不做：** Vue/uni 组件放入共享包（原生 H5 无法消费；避免假「共享」）。

**与 H5 关系（本期可选、非阻塞）：** Demo 完成后可用同一 `tokens.css` 替换或 `@import` 进现网 `app.css` 头部，实现令牌同源；不要求本期改完 H5。

---

## 6. 数据流

```
页面 → api 客户端 → USE_MOCK=true → mock JSON / 内存回执
                 ↘ USE_MOCK=false（可选）→ uni.request → 本地 app（如 :3200）
```

- 默认 **mock 开启**，保证零后端可演示。  
- 提交类接口：mock 返回成功结构 + `uni.showToast`，不写真实库。  
- `patientKey`：`uni.setStorageSync` 持久化。  
- mock 的 bootstrap 字段形状对齐现网 `/api/bootstrap`，便于日后切真接口。

---

## 7. 视觉与交互原则

- **色板与组件形态：** 医生名片左边线、核心入口卡、功能列表行、底栏、表单字段布局对齐现网。  
- **适老：** 长辈模式放大字号与按钮；触控目标 ≥ 44×44px；表单必须有可见 label（非仅 placeholder）。  
- **禁止：** emoji 当图标、霓虹色、重动效、AI 紫粉渐变。  
- **字体：** 小程序端使用系统中文字体栈（PingFang SC / 系统默认），不依赖 Google Fonts。

设计方向与 ui-ux-pro-max「Accessible & Ethical / medical teal」一致，但 **以现网 `app.css` 色值为准**，不采用工具随机推荐的替代色（如 `#0891B2`）。

---

## 8. 错误处理（Demo 级）

- 网络/mock 失败：toast 文案，保留可重试入口。  
- 表单校验：必填项本地校验，与现网字段意图一致（手机号格式等）。  
- 选图：类型与张数限制；超限 toast。

---

## 9. 验证方式

1. `patient-uniapp` 用微信开发者工具打开，首页/咨询/表单可走通。  
2. 长辈模式开关后字号与按钮明显变大。  
3. `patient-design` 令牌色值与现网 `--primary` 等一致（抽检）。  
4. 不启动 `app/server.js` 时仍可完整演示（mock）。

---

## 10. 非目标（再次强调）

- 不修改 `server.js` 业务与部署流水线。  
- 不迁移 `admin-ui`。  
- 不做生产构建上传、证书、域名、审核发布。  
- 不做 UniApp H5/App 端（可列为二期）。

---

## 11. 后续二期（仅记录，不在本期）

- 全量功能对齐、真 API 默认、多医生、口碑/海报/TTS 降级方案。  
- H5 接入同一 tokens；或再评估 UniApp H5 替换 `patient.js` 以实现组件级共享。
