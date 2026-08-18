# 春雨医生 · 患者服务中心（本地全栈）

把原系统的功能做成一套**可在本地端口运行的真全栈应用**：现代「患者服务中心」患者端 + 真后端 + 真数据库 + 服务端关键词引擎 + AI 预问诊分诊 + 完整医助后台 + 多医生模板 + **可接企微/微信群回调的社群运营接入层**。**纯 Node，零 npm 依赖**（Node 内置 `node:sqlite` 与 `http`）。

> 当前默认上线演示医生为**吕富靖（消化内科）**，详见 `seed.js`；黄安华/郭强保留为历史需求对照和多医生样例。数字口径：表数 **33**（sqlite_master 实测：`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`；含 schema_patches 迁移记录表 + knowledge_vectors〔RAG Phase 1〕 + ops_configs/ops_config_audit〔运营配置中心〕+ admin_audit_log〔统一后台审计〕）、路由数 **89**（`grep -cE '^\s*route\(' app/server.js`）、离线单元测试当前数以 `HANDOFF.md` §3 实跑快照为准（`cd app && DB_PATH= node _unittest.js`；2026-07-08 数字瘦身后本文件不再镜像具体数字）。接口/UI 测试需 `node server.js --demo` live server 实跑产出，不手写数量。

> 这一版**重新设计了患者端 UI**（自有设计，非照抄截图）：去掉了手机框/微信群聊模拟、去掉「记数字代号」这类反人类操作，改成**功能卡片化导航 + AI 在线咨询**。设计参考 NHS Design System、Epic MyChart「重要信息上浮」、老年可用性研究（正文 ≥17px、触控 ≥48px、对比度 ≥AA）、AI 安全提示「做进 UX」等最佳实践。
>
> 边界：原系统的真实微信群机器人 / 微信小程序 / 好大夫·微医属封闭生态，无法纯本地复刻；本应用做到**功能等价 + 自有美观 UI**。真实微信外壳接入见上级目录《春雨医生社群-生产落地蓝图.md》。

## 运行（零安装）

```bash
cd app
node server.js --demo     # 本地演示/跑测试：短信验证码会在响应里明文返回，便于体验
# 或生产模式：
node server.js            # 短信不返回明文 code（需接真实短信通道）；建议设 ADMIN_PASSWORD
```

- **患者端**：http://localhost:3000/
- **医助后台**：http://localhost:3000/admin　（默认 `admin` / `admin888`）

需 Node ≥ 22（内置 `node:sqlite`）。首次启动自动建库并灌入种子（3 位医生：吕富靖/黄安华/郭强）。

**上线前安全**：① 设环境变量 `ADMIN_PASSWORD` 修改后台口令（启动时自动生效，未设会打印告警）；② 用 `node server.js`（不带 `--demo`）并配置 `SMS_PROVIDER`（见 `docs/sms-config.md`）接入真实短信；③ 收敛/关闭任何公网穿透（如 ngrok）。

## 患者端做了什么

| 能力 | 实现 |
|---|---|
| 首页 | 医生名片（头像+职称+信任徽标）+「快速找医生」核心入口 +「找医生看病 / 了解与康复 / 我的资料」三组功能卡片，点开即用 |
| AI 在线咨询 | 干净对话界面，接 `POST /api/message`→ 服务端分诊；顶部免责条 + 常驻提示 + **分级紧急度卡（急诊拨120/当天就诊/3天内门诊/居家观察，含就诊时间窗与去向）+ 直接行动入口（加号/住院/电话/转人工/120）** + **AI 生成内容标识** |
| 春雨真实跳转接入链路 | 关键词回复卡支持 `external` 元数据；点击时按 `URL Link → URL Scheme → 微信开放标签 wx-open-launch-weapp → H5 URL → Short Link 复制` 优先级处理。当前默认吕富靖医生已采集医生主页 Short Link；黄安华/郭强保留为历史需求对照和多医生样例。101/102/303/404/808 优先使用当前医生主页/预约就诊短链，符合需求表“跳医生主页/问诊主页/预约就诊”的口径；202 因“我的订单”页不可分享/复制，使用春雨主界面短链兜底并提示点底部“我的订单”；909 因“送心意”页不可分享/复制，使用医生主页短链兜底并提示进主页后点“送心意”；414 按需求表保持本地问卷收集和运营跟进，不挂春雨外部跳转。注意：`#小程序://...` 不是浏览器 URL，Chrome 里不能直接打开，只能复制到微信内识别；图文急诊/快速问诊、我的订单/查看回复、送心意页无法复制页面级短链，检测早筛会打开外部“晓飞检”小程序，因此不冒充为春雨内部分支 |
| 医患联络表（建档） | 合规样板：**手机短信验证码 + 敏感信息单独同意**，`POST /api/submit` 真写库；「仅医生团队可见」提示 |
| 门诊加号 | 表单 + **停诊时段服务端拦截**（选到停诊日被 409 拒绝）；**智能候补名单**（停诊/满号可加入候补，名额释放医助一键通知）；**家庭代办（子女代老人）+ 价值动作即时单独同意** |
| 住院预约 / 门诊时间 / 医院电话 | 各自详情页/弹窗，提交真持久化（住院同样支持家庭代办 + 即时同意）；「院内转诊」已按甲方裁定整体移除 |
| 医生风采 / 视频 / 科普 / 术后饮食 / 感谢信 | 风采三段式+Tab；患者写给医生的感谢信本地真持久化（患者自写、转医助人工，不接 AI 生成）|
| 认证口碑墙 | 风采页「患者评价」tab：**仅建档患者**（联络表建档+本人手机验证）可写认证评价，标「已认证患者」、署名脱敏，从源头防刷 |
| 我的随访 | **术式/病种随访 SOP**：建档选方案自动入组 → 术后 1/3/7/30 天时间轴（宣教+复诊提醒+到期节点加号/咨询入口），本人手机验证后查看 |
| 病案复印 / 常见问题 | 图文指引 / FAQ 手风琴 |
| 按病种服务 | 按病种把相关功能打包成「一站式服务包」，少走弯路 |
| 统一认证徽标 | 医生名片「平台认证」+ 数据驱动资质项（卫健委执业注册/三甲主任医师/实名认证），跨医生一致 |
| 多医生 | `?doctor=slug` 切换；顶栏下拉；后台可新增/切换/**一键克隆**（整套底座复制给新医生，对标春雨医生批量复制） |
| 社群工作台 | 后台可配置医生群、欢迎语、外部群 ID、审核模式；支持 `/api/community/inbound` 入站回调、入群欢迎 + 群友常见问题卡、群消息关键词回复、AI 分诊草稿、高风险待审、周五科普/互动题生成、出站队列确认发送。医疗自由文本默认不自动发，避免在群里替医生做疾病判断 |
| 企业微信接入 | V1 主通道为 qiweapi 第三方外挂（`manager.qiweapi.com`，回调 `/api/qiwe/callback`，实现见 `qiwe.js`/`qiwe_bridge.js`）：甲方 2026-06-26 裁定采用，知悉并接受封号/合规风险；官方企微自建应用（`wecom.js`，回调 `/api/wecom/callback`）为备用通道，V1 未启用；微信客服/wecom-cli 仍排除，不作为方案写入或暴露接口 |
| 老年友好 | 正文 17px 起、触控 ≥48px；右上角「**长辈模式**」一键放大全站(大字/大按钮/高对比，持久化)；**听一听** TTS 朗读；联络表节点化步骤提示 |

## 目录

```
app/
├── server.js     HTTP 服务：静态托管 + 患者API + 后台API + 会话鉴权 + 安全加固（路由数 89；来源：`grep -cE '^\s*route\(' app/server.js`）
├── db.js         node:sqlite 建表（33 张；来源：sqlite_master 实测 `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`）+ 首次种子
├── engine.js     服务端关键词规则引擎（功能码快速路径）
├── triage.js     AI 预问诊分诊（红旗规则 + 紧急度分级 + 行动入口 + 六要素病历卡 + 可插拔 LLM，fail-closed）
├── followup.js   随访自动化（术式/病种 SOP 入组 + 时间轴 + 医助队列）
├── community.js  社群运营接入层（群配置 + 入站消息 + 规则/AI处理 + 出站队列）
│                 （智能候补名单/家庭代办/一键克隆等在 server.js + 前端实现）
├── seed.js       种子数据（当前默认吕富靖；黄安华/郭强为历史样例）
├── public/
│   ├── index.html     患者端入口（应用骨架）
│   ├── app.css        患者端设计系统（医疗青蓝 / 老年友好）
│   ├── admin.html     医助后台（含 AI 分诊台 + 结构化六要素病历卡 + 随访队列）
│   └── src/
│       ├── ui.js        线性图标 + 头像 + 二维码/海报/空态（SVG 占位）
│       ├── patient.js   患者端应用（首页/导航/各功能页/AI咨询/合规表单）
│       └── admin.js     后台 SPA
├── _uitest.js    新患者端端到端测试（需 jsdom）
├── _shots.js     截图脚本（需 puppeteer-core + 本机 Chrome/Edge）
└── data.db       运行时自动生成的 SQLite（可删，重启重建）
```

## 接口

**患者端**：`GET /api/bootstrap[?doctor=slug]`、`GET /api/wechat/js-config?url=`（生产配置公众号 `WECHAT_OA_APP_ID/WECHAT_OA_APP_SECRET` 后给 `wx-open-launch-weapp` 生成 JS-SDK 签名；未配置时返回 501）、`POST /api/message`（功能码走规则引擎，返回 `text/mp/link/qr` 等卡片；卡片可带 `external` 用于春雨 H5/API/小程序跳转；普通咨询走 AI 分诊；支持最多 3 张 PNG/JPG/WebP 图片/报告，图片场景走 MiMo v2.5 多模态预审并转人工）、`POST /api/sms/send`、`POST /api/submit`、`GET /api/stories`
**社群入站**：`POST /api/community/inbound`（真实企微/微信群回调可映射到这里；生产可设置 `COMMUNITY_WEBHOOK_TOKEN` 并通过 `x-community-token` 校验）
**企业微信**：V1 主通道 `POST /api/qiwe/callback`（qiweapi 第三方外挂，`manager.qiweapi.com`，甲方 2026-06-26 裁定采用并接受封号/合规风险，见 `qiwe.js`/`qiwe_bridge.js`）；`/api/wecom/callback`（官方企微应用）为备用通道，V1 未启用；微信客服/wecom-cli 仍排除
**后台**（需登录）：`/api/admin/login|logout|me`、`GET/POST /api/admin/doctors`、`.../doctors/:id/activate`、`GET/POST/PUT/DELETE /api/admin/rules`、`.../faq`、`GET/PUT /api/admin/submissions`、`GET /api/admin/stats`、`/api/admin/triage/*`、`/api/admin/community/*`（含 `/api/admin/community/campaigns/weekly` 生成周五群运营科普）

## AI 分诊模型配置（默认走本地安全模板）

不设任何 key 时，分诊用**本地红旗规则 + 安全话术模板**（确定性、断网可用、高危必转人工）。要启用真实 LLM：
- `MIMO_API_KEY`（小米 MiMo，优先）：`sk-` 走 `api.xiaomimimo.com/v1`，`tp-` 走 token-plan 端点；`MIMO_TEXT_MODEL` 默认 `mimo-v2.5-pro`，`MIMO_MULTIMODAL_MODEL` 默认 `mimo-v2.5`。
- 回退 `DEEPSEEK_API_KEY`；`TRIAGE_AI_DISABLED=1` 强制只走本地模板。

> 安全设计：高危症状**永不**调用 LLM、直接转人工（仍标 needsHuman=true）；自动发三档（甲方 2026-07-02 裁定，实施于 normalizeDecision）：low/high 自动发确定性安全话术（high 另附医生 DB code=101 问诊卡，均非模型文本）、medium 不自动发转人工；患者侧 patientReply 默认为 service-only 安全模板，**低危 LLM 例外**（甲方 2026-07-03 裁定，生产 `LOW_RISK_LLM_REPLY=1` 已开）：仅 low 档自动发时用 `generateLowRiskReply` 的 LLM 文本覆写 patientReply，经**双道闸**——① 确定性词表 `postScanLowRiskReply` ② L2 语义复检 `recheckReplyLLM`（命中医疗断言/红旗/含医疗建议 → 降级回 safeReply）；双闸都过后对最终文本 `maskPIIStrict` **掩码后仍发**（掩码而非降级），无 key/超时/异常 → 降级 safeReply；这是唯一允许模型文本直达患者的路径（high 仍恒安全话术、medium 恒 pending 不自动发）；旧闸门 low∧知识库充足∧L2 确判保留为模型草稿免审线（未达线模型文本仅作 aiDraft 转人工）。**风险下界由本地确定性规则（`scanRisk`）给出，大模型不能降低安全分级**——可选 L2 风险天网（`assessRiskLLM`→`combineRisk`）只能上抬风险、从不下调（只升不降），高危（floor=high）直接跳过 L2、不调用任何模型；LLM 返回经规范化，不能把风险降级或诱导自动发；六要素病历卡抽取走后台异步、失败回退本地规则，不阻塞患者回复。患者上传图片/报告时，系统可用 `mimo-v2.5` 做材料摘要和补充信息清单，但默认判为中风险并进入医生团队审核，不自动下诊断/检查结论。

## 试一试（约 1 分钟）

1. `node server.js` → 打开 http://localhost:3000/
2. **在线咨询** → 输入「我右上腹痛很厉害，还发烧发黄」→ 看**分级紧急度卡**（建议今天就诊 + 就诊时间窗/去向 + 行动入口：加号/转人工/电话）；也可上传检查报告/患处照片，图片材料会进入 MiMo v2.5 多模态预审并转人工；输入「胸痛呼吸困难」升级为**急诊/拨120**
3. **医患联络表** → 获取验证码 + 勾选单独同意 → 提交（真写库）
4. **门诊加号** → 选停诊时段会被拦截，选可用时段提交成功
5. 在线咨询输入 `102` → 聊天流出现“春雨视频问诊”服务卡；当前默认医生会展示吕富靖医生主页/视频问诊状态提示。输入 `101/303/404/808/909` 也会优先展示当前医生主页/预约就诊/送心意兜底短链；输入 `202` 展示春雨“我的全部服务/我的订单”真实短链（甲方 2026-07-02 采集，复制进微信直达订单页）（编号 505/313/888 相关功能已按甲方裁定整体移除）。走微信 H5 开放标签或 URL Link/Scheme 一键拉起时仍需要春雨小程序原始 ID `gh_xxx`、已替换 `token/session_id` 的 path、公众号 JS-SDK 签名和 JS 安全域名
6. `/admin` 登录 → 「提交记录 / 患者档案」看到刚才的提交；「关键词规则」可看到“外部跳转”数量并编辑 `external` JSON；「医生管理」可增改、切换医生
7. 顶栏「大字模式」「医生下拉」体验老年友好与多医生

## 测试 / 截图

> 测试/截图依赖短信明文 code，请先用 **`node server.js --demo`**（或 `npm run demo`）起服务，再执行接口/UI/截图命令。离线单元当前数以 `HANDOFF.md` §3 为准（全绿基线·来源：`cd app && DB_PATH= node _unittest.js`）。

```bash
npm test                                # 一次跑全套（_unittest.js + _fulltest.js + _uitest.js；接口/UI 数量以 live server 实跑输出为准）
node _fulltest.js                       # 全接口（分诊/图片材料/口碑墙/随访/代办/克隆/候补/服务包/认证）
npm i jsdom && node _uitest.js          # 新患者端 × 运行中服务端 端到端
npm i puppeteer-core && node _shots.js  # 用本机 Chrome/Edge 截图到 _shots/
```

## 声明

虚构脱敏数据，不含真实患者信息；头像/二维码/海报为 SVG 占位。已采集的 Short Link 可在微信内打开对应春雨页面；未配置春雨/微信官方参数前，网页内不会伪装成已完成一键拉起。
