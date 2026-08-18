/* 初始化种子数据：两位医生（黄安华全量 / 郭强精简，演示「不同医生不同配置」） */

const CHUNYU_DOCS = {
  product:"https://www.chunyuyisheng.com/cooperation/open_api/product_description/",
  wap:"https://www.chunyuyisheng.com/cooperation/open_api/interface/wap/",
  graph:"https://www.chunyuyisheng.com/cooperation/open_api/interface/graph/",
  video:"https://www.chunyuyisheng.com/cooperation/open_api/interface/video_inquiry/",
  expert:"https://www.chunyuyisheng.com/cooperation/open_api/interface/expert_appointment/"
};
const CHUNYU_USER_MAIN_SHORT_LINK = "#小程序://春雨医生/春雨医生/lVFxFuumHslz8Tb===";
const CHUNYU_HOME_SHORT_LINK = "#小程序://春雨医生/EhSc2V0ssa0h2hF";   // 春雨主界面短链（供 home + 医生主页未采集时的兜底复用）
const CHUNYU_SHORT_LINKS = {
  home: { shortLink:CHUNYU_HOME_SHORT_LINK, scope:"春雨医生主界面" },
  // 202 查看回复真实短链（甲方 2026-07-02 采集，页面=春雨医生小程序「我的全部服务/我的订单」）：替换此前的主界面兜底短链。
  myOrders: { shortLink:"#小程序://春雨医生/PuW00A6zBsHAw9y", scope:"春雨医生·我的全部服务/我的订单页（甲方 2026-07-02 采集）" },
  video: { shortLink:"#小程序://春雨医生/XKw5Nt8BiFBstaF", scope:"视频问诊服务" },
  expert: { shortLink:"#小程序://春雨医生/ZlCwdzwnSMN7FAd", scope:"权威专家" },
  hospital: { shortLink:"#小程序://春雨医生/yNJLReN2nQ4EOzg", scope:"医院列表" },
  phone: { shortLink:"#小程序://春雨医生/nUSAHROscP8bMeq", scope:"快捷电话" },
  selfCheck: { shortLink:"#小程序://春雨医生/75wri2U4ACBJa3j", scope:"自诊自查" },
  prescription: { shortLink:"#小程序://春雨医生/cbzAi0HxIi6wEzD", scope:"问诊开药" },
  discountClinic: { shortLink:"#小程序://春雨医生/rFMgG3KxBvPC8rH", scope:"特惠义诊" },
  pediatrics: { shortLink:"#小程序://春雨医生/TpakrKrn6bJjgas", scope:"儿科线上门诊" },
  ai: { shortLink:"#小程序://春雨医生/jg2cpU5PoDIXDvi", scope:"春雨慧问 AI" },
  huangDoctor: { shortLink:"#小程序://春雨医生/HE2svfzJmtGbXim", scope:"黄安华医生主页（电话咨询/预约就诊入口）" },
  // 吕富靖（消化内科·北京友谊医院）医生主页真实 Short Link（甲方提供，对应网页主页 chunyuyisheng.com/pc/doctor/4ab15ad117fc8297c028/）。
  // 2026-06-30 复核：旧短链 oN2SkZSqhfTQgRf 打开提示页面不存在，改用微信内新复制短链。
  // 小程序短链不能在浏览器直跳，只能复制到微信内打开；页面级入口拿到真卡后必须独立成组，不能复用医生主页短链。
  lvDoctor: { shortLink:"#小程序://春雨医生/5ujZ4dqouQjf8Fh", scope:"吕富靖医生主页（图文/电话咨询、视频问诊、预约就诊入口）" },
  // 吕富靖医生专属「预约就诊/服务」页 Short Link（甲方 2026-07-02 采集；截图=选择档期/病情描述/预约时间/服务类型，含视频问诊）。
  //   ⚠ 已停用（甲方 2026-07-08 晚裁定·覆盖待办6）：102 视频问诊卡改「复用 101 医生主页卡」（LV_CY.videoHome 现指向 lvDoctor·5ujZ），本短链不再被引用；保留供参考。
  lvBooking: { shortLink:"#小程序://春雨医生/S9bW6EQGDjO4HNg", scope:"吕富靖医生 · 预约就诊/视频问诊页（甲方 2026-07-02 采集·已停用，102 改复用主页卡）" },
  // 404 预约就诊/出诊时间地点真机转发卡（甲方 2026-07-06 采集）。
  //   ⚠ 已停用（甲方 2026-07-08 晚裁定·覆盖待办6·替换不并存）：404 末卡改「复用 101 医生主页卡」（LV_CY.booking 现指向 lvDoctor·5ujZ），本短链不再被引用；保留供参考。
  lvClinicBooking: { shortLink:"#小程序://春雨医生/出诊时间地点/MCGKlVkiNDBumbz", scope:"吕富靖医生 · 预约就诊/出诊时间地点页（甲方 2026-07-06 采集·已停用，404 改复用主页卡）" },
  // 909 送心意真机转发卡（甲方 2026-07-06 采集）。页面级直达，不能再用医生主页 fallback。
  lvSendHeart: { shortLink:"#小程序://春雨医生/送心意/pbycpPEVVipdyff", scope:"吕富靖医生 · 送心意页（甲方 2026-07-06 采集）" },
  // 808 医生风采「新版」：h5_webview 小程序卡（appId wx2e72ecb9760b913c·config_id=2515，甲方 2026-07-06 真机采集封面三件套；
  //   与 101/303/909 复用的医生主页短链(lvDoctor·5ujZ) 刻意不同——独立 source_short_link，避免 hydrateRelatedTemplates 把 808 的新封面
  //   与 101 主页卡的封面互相覆盖（808 已从旧「医生主页 doctor-profile」卡换成 h5_webview 卡）。占位标记短链、真发走 qiwe_weapp_templates 行。
  lvProfileWebview: { shortLink:"#小程序://春雨医生/lv808webview2515", scope:"吕富靖医生风采 · h5_webview(config_id=2515)（甲方 2026-07-06 采集）" },
  // 303 挂号原生卡「新版」（甲方 2026-07-08 裁定·替换春雨主页卡）：北京友谊医院患者服务平台小程序·吕富靖医生详情页卡（真机采集·MINI_PROGRAM msgType78）。
  //   独立 source 标记短链（不与 101/303 旧组的医生主页短链 5ujZ 同组）→ hydrateRelatedTemplates 不会把 101 主页封面串进 303；封面三件套由 qiwe_weapp_templates 行承载。
  //   ⚠ 标记串刻意不含「北京友谊医院患者服务平台」子串——避免被 applySeedPatches cleanup_303_hosp_platform_card_v1 幂等清理（按该指纹删 shortLink）误删本卡。
  lvFriendshipDetail: { shortLink:"#小程序://友谊医院/吕富靖医生详情页/lv303detail", scope:"吕富靖医生 · 北京友谊医院患者服务平台挂号/医生详情页（甲方 2026-07-08 采集）" },
  // 周玉春（中医男科·江苏省中医院）医生主页 Short Link（运营 2026-07-22 提供）；101/102/301/909 同组复用。
  zhouDoctor: { shortLink:"#小程序://春雨医生/LgKHxRiHTqKDfVp", scope:"周玉春医生主页（图文/视频问诊、预约就诊入口）" }
};
const CHUNYU_SHORT_LINK_CHECKED_AT = "2026-06-24";

function chunyuExternal(o){
  return {
    provider:o.provider || "春雨医生开放平台",
    label:o.label || "春雨医生",
    mode:o.mode || "h5",
    service:o.service || "",
    status:o.status || "pending_config",
    url:o.url || "",
    urlLink:o.urlLink || "",
    urlScheme:o.urlScheme || "",
    shortLink:o.shortLink || "",
    shortLinkScope:o.shortLinkScope || "",
    shortLinkCheckedAt:o.shortLinkCheckedAt || CHUNYU_SHORT_LINK_CHECKED_AT,
    urlTemplate:o.urlTemplate || "",
    appId:o.appId || "",
    originalId:o.originalId || o.username || "",
    username:o.username || o.originalId || "",
    pathTemplate:o.pathTemplate || "",
    path:o.path || "",
    jumpPriority:o.jumpPriority || ["urlLink", "urlScheme", "wx_open_tag", "h5_url"],
    docUrl:o.docUrl || CHUNYU_DOCS.product,
    requires:o.requires || ["partner", "partner_key", "user_id", "sign"],
    note:o.note || "只有拿到春雨/微信的真实跳转参数后才会直跳；缺参时只展示接入缺口并保留本地备用页。"
  };
}

function extCard(card, external){
  const realUrl = external.url || external.urlLink || external.urlScheme;
  const wxTagReady = external.mode === "mini_program" && external.originalId && (external.path || (external.pathTemplate && !/\{[^}]+\}/.test(external.pathTemplate)));
  return { ...card, external, fallbackPage:card.page || "", ctaLabel:realUrl ? "打开春雨入口" : (wxTagReady ? "微信内打开小程序" : (external.shortLink ? "查看/复制微信短链" : "查看真实跳转缺口")) };
}

function withShortLink(external, link, overrides){
  return { ...external, status:"short_link_ready", shortLink:link.shortLink, shortLinkScope:link.scope, ...(overrides || {}) };
}

/* 普通 Web 外链 external（医院官网/公众号/春雨问卷/落地页，均 https）。
   手写 card 对象时用它生成 external，故意不套 extCard（extCard 会按 url 强制把 ctaLabel 重算成“打开春雨入口”，对官网/公众号会误导）。
   url 走前端 openConfiguredExternal→configuredUrl 协议白名单(https?/weixin)直开 window.open(noopener)；mode/provider 使前端 hasExt 为真、状态显示“已配置”。 */
function webLink(o){
  return {
    provider:o.provider || "外部网页入口",
    label:o.label || "网页入口",
    mode:"h5",
    service:o.service || "",
    status:"ready",
    url:o.url || "",
    note:o.note || "点击在浏览器/微信内打开该网页。",
    requires:[]
  };
}

const CY = {
  graphConsult: chunyuExternal({
    label:"春雨图文问诊",
    mode:"h5_api",
    service:"图文问诊 / 创建问题",
    status:"blocked_by_wechat_share",
    docUrl:CHUNYU_DOCS.graph,
    urlTemplate:"https://www.chunyuyisheng.com/cooperation/wap/login/?user_id={user_id}&atime={atime}&partner={partner}&sign={sign}",
    requires:["春雨 partner", "partner_key", "user_id/phone", "atime", "服务端 sign", "医生/策略参数", "春雨提供图文问诊页面级 Short Link/URL Link/URL Scheme"],
    note:"用于 101 咨询：已实测可从春雨首页进入“描述病情”，但该页右上角复制链接不会生成新短链，不能把主界面冒充为图文问诊分支；生产需后端实时生成春雨签名链接，或直接调用春雨图文问诊 API 创建问题。"
  }),
  video: chunyuExternal({
    label:"春雨视频问诊",
    mode:"mini_program",
    service:"视频问诊",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.video,
    appId:"wx214b7e2bcde837d6",
    shortLink:CHUNYU_SHORT_LINKS.video.shortLink,
    shortLinkScope:CHUNYU_SHORT_LINKS.video.scope,
    pathTemplate:"pages/open_login/index?token={token}&session_id={session_id}",
    requires:["春雨 partner", "partner_key", "user_id/phone", "atime", "服务端 sign", "jump_wxapp 返回 token/session_id", "春雨小程序原始 ID gh_xxx", "公众号 JS-SDK 签名/JS 安全域名", "或春雨提供页面级 URL Link/URL Scheme/Short Link"],
    note:"用于 102 视频问诊：已从当前春雨医生小程序复制到“视频问诊服务”页面级 Short Link，可在微信内粘贴打开；若要在 H5 一键拉起，仍需春雨 jump_wxapp token/session_id、小程序原始 ID gh_xxx 与公众号 JS-SDK 签名，或 URL Link/URL Scheme。"
  }),
  replies: chunyuExternal({
    label:"春雨问诊回复",
    mode:"mini_program",
    service:"我的提问历史 / 查看回复",
    // 原生卡候选保持 gated（status=fallback_short_link）：已采集真实「我的全部服务/我的订单」页短链用于文本承接（复制进微信直达订单页），
    //   但不把它包装成企微原生小程序直达卡片——避免老库/演示库遗留的旧 202 原生卡模板（page_path=pages/index=春雨主界面，非订单页）
    //   被 deliverOutbox 当订单页原生卡误发（fail-closed，codex 复核 2026-07-03 抓回退）。待为订单页采集真实原生卡模板后再放开 short_link_ready。
    status:"fallback_short_link",
    docUrl:CHUNYU_DOCS.graph,
    appId:"wx214b7e2bcde837d6",
    shortLink:CHUNYU_SHORT_LINKS.myOrders.shortLink,
    shortLinkScope:CHUNYU_SHORT_LINKS.myOrders.scope,
    requires:["春雨 partner", "partner_key", "user_id", "atime", "服务端 sign", "问诊记录 URL", "用户身份态"],
    note:"用于 202 查看回复：已采集春雨医生小程序“我的全部服务/我的订单”页短链用于文本承接（复制进微信即可直达订单页查看回复/订单状态）；原生卡候选按 V1 保持 gated（status=fallback_short_link）——避免老库遗留的旧 pages/index 模板被当订单页原生卡误发，待为订单页采集真实原生卡模板后再放开。生产要免复制、按用户身份自动登录跳转仍需服务端生成签名链接，或直接调用 API 拉取回复状态。"
  }),
  doctorDetail: chunyuExternal({
    label:"春雨医生主页",
    mode:"h5_api",
    service:"医生详情",
    status:"pending_doctor_short_link",
    docUrl:CHUNYU_DOCS.graph,
    requires:["春雨 partner", "partner_key", "doctor_id", "医生主页 URL 或医生详情 API 参数"],
    note:"用于 808 医生简介：已拿到春雨“找医生”列表短链，但还不是黄安华医生个人主页；需要春雨医生 ID/主页地址后再直跳。"
  }),
  expertAppointment: chunyuExternal({
    label:"春雨专家预约",
    mode:"api",
    service:"专家预约 / 挂号 / 加号",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.expert,
    shortLink:CHUNYU_SHORT_LINKS.expert.shortLink,
    shortLinkScope:CHUNYU_SHORT_LINKS.expert.scope,
    requires:["春雨 partner", "partner_key", "patient_id", "doctor_id", "service_type", "预约服务合同参数"],
    note:"用于 404 加号、414 住院预约：已从当前春雨医生小程序复制到“权威专家”短链，可作为专家服务入口；精确到黄安华医生的预约仍需要春雨专家预约合同、doctor_id 与患者参数。"
  }),
  evaluation: chunyuExternal({
    label:"春雨问诊评价",
    mode:"api",
    service:"评价问题接口",
    status:"pending_order",
    docUrl:CHUNYU_DOCS.graph,
    requires:["春雨 partner", "partner_key", "question_id", "user_id", "已完成问诊订单"],
    note:"用于 919 评价医生：必须有春雨问诊订单/问题编号；未完成订单时只能使用本地认证口碑墙。"
  }),
  hospitalRegister: chunyuExternal({
    provider:"医院/春雨外部入口",
    label:"挂号与门诊入口",
    mode:"h5",
    service:"医院挂号 / 门诊时间",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.product,
    shortLink:CHUNYU_SHORT_LINKS.hospital.shortLink,
    shortLinkScope:CHUNYU_SHORT_LINKS.hospital.scope,
    requires:["医院服务号 H5 或春雨挂号入口 URL", "医生/科室参数"],
    note:"用于 303 门诊挂号：已从当前春雨医生小程序复制到“医院列表”短链，可作为外部医院检索入口；精确到上海市东方医院/黄安华门诊还需要医院服务号 H5 或春雨医院/科室参数。"
  })
};

const HUANG_CY = {
  consultHome: withShortLink(CY.graphConsult, CHUNYU_SHORT_LINKS.huangDoctor, {
    label:"黄安华医生春雨主页",
    mode:"mini_program",
    service:"医生主页 / 电话咨询 / 预约就诊",
    appId:"wx214b7e2bcde837d6",
    urlTemplate:"",
    requires:["医生主页 Short Link 已采集", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 101 咨询：按需求表“优先跳转医生在春雨上的问诊主页 or 医生线下拉患者二维码”。已采集黄安华医生个人主页 Short Link；Chrome 不能直接跳，只能复制到微信内打开。"
  }),
  videoHome: withShortLink(CY.video, CHUNYU_SHORT_LINKS.huangDoctor, {
    label:"黄安华医生春雨主页",
    service:"医生主页 / 视频问诊入口",
    requires:["医生主页 Short Link 已采集", "黄安华医生视频问诊开通状态以春雨页面为准", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 102 视频问诊：需求表要求“优先跳转医生在春雨上视频问诊，直接进医生主页”。已采集黄安华医生主页 Short Link；页面内可见视频问诊当前暂未开通，不能用通用视频问诊页冒充医生主页。"
  }),
  appointment: withShortLink(CY.expertAppointment, CHUNYU_SHORT_LINKS.huangDoctor, {
    label:"黄安华医生预约就诊",
    service:"医生主页 / 预约就诊",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集", "精确预约日期/号源以春雨医生页实时状态为准", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 303/404：已进入黄安华医生“预约就诊”日期列表验证，但复制链接返回同一个黄安华医生主页 Short Link；用户进入主页后可点“预约就诊”。"
  }),
  doctorHome: withShortLink(CY.doctorDetail, CHUNYU_SHORT_LINKS.huangDoctor, {
    label:"黄安华医生春雨主页",
    mode:"mini_program",
    service:"医生主页",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 808 医生简介：已采集黄安华医生个人主页 Short Link；本地医生风采页继续承载更完整的运营素材。"
  }),
  sendHeart: withShortLink(chunyuExternal({
    label:"春雨送心意入口",
    mode:"mini_program",
    service:"医生主页 / 送心意",
    status:"fallback_short_link",
    docUrl:CHUNYU_DOCS.graph,
    appId:"wx214b7e2bcde837d6",
    requires:["页面级“送心意”Short Link 当前不可复制", "进入医生主页后点击“送心意”", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 909 感谢医生：已实测“送心意”页可从医生主页进入，但页面右上角显示不可转发、不可分享，点击复制链接不会生成新短链；因此不冒充为直达页，使用医生主页短链作为真实入口，并保留本地感谢留言审核兜底。"
  }), CHUNYU_SHORT_LINKS.huangDoctor, {
    status:"fallback_short_link",
    shortLinkScope:"黄安华医生主页（进入后点击“送心意”）",
    requires:["医生主页 Short Link 已采集", "页面级“送心意”Short Link 当前不可复制", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 909 感谢医生：已实测“送心意”页可从医生主页进入，但页面右上角菜单显示不可转发、不可分享，复制链接不会产生短链；所以只提供黄安华医生主页短链作为真实入口，用户进入后点击“送心意”，本地 thank-doctor 页面继续承接不支付的感谢留言。"
  })
};

/* 吕富靖（消化内科·首都医科大学附属北京友谊医院）外链：
   已拿到医生主页、预约就诊/出诊时间地点、送心意等真实 Short Link。页面级卡片独立成组，
   不能复用医生主页短链，否则 QiWe 模板 hydrate 会把不同卡片串组覆盖。
   诚实口径：小程序短链不能在浏览器直跳，只能复制到微信内打开；只有拿到真机页面级卡后才标直达。
   注：本批数据由甲方提供、协调器转述，短链/电话/SOP 真实性仍待人/codex 复核签字（实现≠签字）。 */
const LV_CY = {
  consultHome: withShortLink(CY.graphConsult, CHUNYU_SHORT_LINKS.lvDoctor, {
    label:"吕富靖医生春雨主页",
    mode:"mini_program",
    service:"医生主页 / 图文咨询 / 电话咨询",
    appId:"wx214b7e2bcde837d6",
    urlTemplate:"",
    requires:["医生主页 Short Link 已采集", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 101 咨询：已采集吕富靖医生个人主页 Short Link；小程序短链不能在浏览器直跳，只能复制到微信内打开，同时保留医生线下二维码作为真实联系入口。"
  }),
  // 102 视频问诊（甲方 2026-07-08 晚裁定·覆盖待办6）：卡改「吕富靖医生主页卡」，复用 101 医生主页短链 5ujZ（lvDoctor）→ 与 101 同组，
  //   企微原生卡由 101 主页卡真机采集封面 hydrate/patch 拷贝承载（免为 102 单独重采）；page:"video-consult" 患者端 H5 本地承接不变。
  videoHome: withShortLink(CY.video, CHUNYU_SHORT_LINKS.lvDoctor, {
    label:"吕富靖医生春雨主页",
    service:"医生主页 / 视频问诊入口",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集（与 101 同短链 5ujZ）", "视频问诊入口在春雨主页内，开通状态以春雨页面为准", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 102 视频问诊（甲方 2026-07-08 晚裁定·复用 101 医生主页卡·覆盖待办6）：进入吕富靖医生春雨主页后选择视频问诊入口；小程序短链不能在浏览器直跳，只能复制到微信内打开。不冒充视频问诊页面级直达，急症请直接线下就医。"
  }),
  appointment: withShortLink(CY.expertAppointment, CHUNYU_SHORT_LINKS.lvDoctor, {
    label:"吕富靖医生预约就诊",
    service:"医生主页 / 预约就诊",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集", "出诊时间/号源以“北京友谊医院”服务号实时为准", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 303/404：已采集吕富靖医生主页 Short Link；复制到微信内打开后可点“预约就诊”；出诊时间：西城院区周一上午；西城特需周一、周二下午；顺义特需周三下午（具体以“北京友谊医院”服务号实时号源为准，如有调整以服务号为准）；本地表单/加号继续兜底。"
  }),
  // 404 加号末卡（甲方 2026-07-08 晚裁定·覆盖待办6·替换不并存）：卡改「吕富靖医生主页卡」，复用 101 医生主页短链 5ujZ（lvDoctor）→ 与 101 同组，
  //   企微原生卡由 101 主页卡真机采集封面 hydrate/patch 拷贝承载（免为 404 单独重采）；page:"add-number" 患者端 H5 本地承接不变；
  //   404 门控前三条（先填医患联络表）不受影响、原样保留（硬门控配套）。替换旧「出诊时间地点」页面级卡（lvClinicBooking）。键名 booking 保留（404 规则引用）。
  booking: withShortLink(CY.expertAppointment, CHUNYU_SHORT_LINKS.lvDoctor, {
    label:"吕富靖医生春雨主页",
    service:"医生主页 / 预约就诊入口",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集（与 101 同短链 5ujZ）", "出诊时间/号源以“北京友谊医院”服务号实时状态为准", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 404 加号（甲方 2026-07-08 晚裁定·复用 101 医生主页卡·覆盖待办6）：进入吕富靖医生春雨主页后可点“预约就诊”；小程序短链不能在浏览器直跳，只能复制到微信内打开；本地表单/加号继续兜底。"
  }),
  doctorHome: withShortLink(CY.doctorDetail, CHUNYU_SHORT_LINKS.lvDoctor, {
    label:"吕富靖医生春雨主页",
    mode:"mini_program",
    service:"医生主页",
    appId:"wx214b7e2bcde837d6",
    requires:["医生主页 Short Link 已采集", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 808 医生简介（旧口径·doctor-profile 卡）：已采集吕富靖医生个人主页 Short Link，复制到微信内打开；808 已改为下方 profileWebview（h5_webview 卡），本键保留供参考不再被 808 规则引用。"
  }),
  // 808 新口径（甲方 2026-07-06）：医生风采卡从「医生主页 doctor-profile」换成「h5_webview·config_id=2515」小程序卡（appId wx2e72ecb9760b913c）。
  //   mini_program 直达参数(appId/originalId=gh_xxx/path) 已就绪；封面三件套由 qiwe_weapp_templates 行承载（真机采集）。独立短链标记，不与 101 主页卡同组。
  profileWebview: withShortLink(chunyuExternal({
    label:"吕富靖主任 · 医生风采（春雨小程序）",
    mode:"mini_program",
    service:"医生风采 / 春雨活动页",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.product,
    appId:"wx2e72ecb9760b913c",
    username:"gh_681d3fd5683f@app",
    path:"pages/h5_webview/index.html?url=https%3A%2F%2Fwww.chunyuyisheng.com%2Fevents%2Fspecial%2F%3Fconfig_id%3D2515",
    requires:["小程序 appId/原始 ID(gh_xxx)/页面路径 已就绪", "封面三件套已采集(qiwe_weapp_templates)"],
    note:"用于 808 医生简介：企微原生小程序卡（appId wx2e72ecb9760b913c·h5_webview·config_id=2515，甲方 2026-07-06 真机采集封面）；复制短链到微信内亦可打开。"
  }), CHUNYU_SHORT_LINKS.lvProfileWebview, {
    appId:"wx2e72ecb9760b913c",
    username:"gh_681d3fd5683f@app",
    path:"pages/h5_webview/index.html?url=https%3A%2F%2Fwww.chunyuyisheng.com%2Fevents%2Fspecial%2F%3Fconfig_id%3D2515"
  }),
  sendHeart: withShortLink(chunyuExternal({
    label:"春雨送心意",
    mode:"mini_program",
    service:"送心意",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.graph,
    appId:"wx214b7e2bcde837d6",
    nativeCard:true,
    requires:["吕富靖医生送心意页面级 Short Link 已采集（甲方 2026-07-06）", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 909 感谢医生：已采集吕富靖医生送心意页面级 Short Link 和原生卡，可直达送心意页；本地 thank-doctor 页面继续作为备用。"
  }), CHUNYU_SHORT_LINKS.lvSendHeart, {
    status:"short_link_ready",
    nativeCard:true,
    requires:["吕富靖医生送心意页面级 Short Link 已采集（甲方 2026-07-06）", "如需网页一键拉起仍需 URL Link/URL Scheme 或 gh_xxx + JS-SDK"],
    note:"用于 909 感谢医生：已采集吕富靖医生送心意页面级 Short Link 和原生卡，可直达送心意页；本地 thank-doctor 页面继续作为备用。"
  }),
  // 303 挂号原生卡（甲方 2026-07-08 裁定·替换春雨主页卡，替换不并存）：北京友谊医院患者服务平台小程序·吕富靖医生详情页卡。
  //   真机采集 msgType78/MINI_PROGRAM（appId wxbc8c84999432ac95·gh_43eb4b5211ca@app·pages/doctor-detail）；封面三件套由 qiwe_weapp_templates 行承载
  //   （db.js seed_lv_friendship_303_card_2026_07_08_v1，raw_payload=真实采集 JSON 锁）。独立 source_short_link，不与 101 主页卡 5ujZ 同组；挂号时间地点仍由 303 首条文本承载。
  friendshipRegister: withShortLink(chunyuExternal({
    label:"北京友谊医院患者服务平台 · 吕富靖医生详情页",
    mode:"mini_program",
    service:"挂号 / 门诊时间 / 医生详情",
    status:"short_link_ready",
    docUrl:CHUNYU_DOCS.product,
    appId:"wxbc8c84999432ac95",
    username:"gh_43eb4b5211ca@app",
    path:"pages/doctor-detail/index.html?departmentCode=1CqsZB6iinEZFtiCx1Mr_g&doctorCode=oODcjMMW7D9u8-_IFF27FQ",
    requires:["北京友谊医院患者服务平台小程序 appId/原始 ID(gh_xxx)/页面路径 已就绪（甲方 2026-07-08 真机采集）", "封面三件套已采集(qiwe_weapp_templates)"],
    note:"用于 303 挂号：企微原生小程序卡（北京友谊医院患者服务平台·吕富靖医生详情页，甲方 2026-07-08 真机采集封面）；挂号时间地点仍由 303 首条文本说明，复制短链到微信内亦可打开。"
  }), CHUNYU_SHORT_LINKS.lvFriendshipDetail, {
    nativeCard:true,
    appId:"wxbc8c84999432ac95",
    username:"gh_43eb4b5211ca@app",
    path:"pages/doctor-detail/index.html?departmentCode=1CqsZB6iinEZFtiCx1Mr_g&doctorCode=oODcjMMW7D9u8-_IFF27FQ"
  })
};

const huang = {
  slug: "huang", active: 0,   // 甲方裁定单医生（吕富靖），停用 demo 的黄安华；保留对象用于演示“切换/停用旧医生”，不删
  name: "黄安华", title: "主任医师 / 教授",
  hospital: "上海市东方医院", dept: "胆石病中心",
  specialty: "胆结石 · 胆囊息肉 · 胆道疾病微创/保胆治疗",
  group_name: "黄安华主任健康 12群", member_count: 184,
  scope_note: "院外公益健康群", hospital_phone: "021-3880-4518",
  bots: ["小宝医助", "小雪医助"],
  clinic: { place: "上海市东方医院（南院）门诊楼 3 楼 普外科诊区",
            times: ["周二 上午 08:00–11:30", "周四 全天 08:00–16:30"] },
  accounts: [
    { platform: "微信公众号", handle: "有胆无石", icon: "📰" },
    { platform: "视频号", handle: "黄安华主任", icon: "🎬" },
    { platform: "抖音", handle: "护胆黄安华", icon: "🎵" },
    { platform: "好大夫在线", handle: "黄安华 主任医师", icon: "🩺" },
    { platform: "微医", handle: "黄安华 工作室", icon: "💊" }
  ],
  content: {
    disclaimer: "本页面为本地演示，不构成诊断、处方、诊疗建议或疗效承诺；群内沟通不能替代线下面诊。急重症、持续腹痛、发热、黄疸等情况请立即到正规医院就诊。",
    chunyuIntegration: {
      status:"已接入当前可复制的春雨小程序页面级 Short Link；需要登录态/签名/医生参数的分支仍不假装已可直跳",
      defaultMiniProgram:{ appId:"wx214b7e2bcde837d6", originalId:"待春雨提供 gh_xxx", path:"pages/open_login/index?token={token}&session_id={session_id}", shortLink:CHUNYU_SHORT_LINKS.home.shortLink, shortLinkScope:CHUNYU_SHORT_LINKS.home.scope, userProvidedShortLink:CHUNYU_USER_MAIN_SHORT_LINK },
      knownShortLinks:CHUNYU_SHORT_LINKS,
      checkedAt:CHUNYU_SHORT_LINK_CHECKED_AT,
      unavailableShortLinks:[
        "图文急诊/快速问诊：可进“描述病情”，但复制链接不会产生页面级短链",
        "我的订单/查看回复：当前状态下复制链接不会产生新短链",
        "送心意：可从医生主页进入，但页面不可转发/不可分享，复制链接不会产生页面级短链",
        "检测早筛：会跳到外部“晓飞检”小程序，不写作春雨医生内部分支"
      ],
      required:["春雨 partner", "partner_key", "user_id/phone", "atime", "服务端 sign", "doctor_id/服务策略key", "jump_wxapp 返回 token/session_id", "春雨小程序原始 ID gh_xxx", "公众号 JS-SDK 签名/JS 安全域名", "或页面级 URL Link/URL Scheme/Short Link"],
      docs:[CHUNYU_DOCS.product, CHUNYU_DOCS.wap, CHUNYU_DOCS.graph, CHUNYU_DOCS.video, CHUNYU_DOCS.expert],
      fallback:"已拿到页面级短链的入口可复制到微信打开；未拿到真实参数的入口只展示缺口并保留本地页面兜底，便于集团例会演示完整闭环但不冒充真跳。"
    },
    consentText: "处理目的：用于本医生健康班的患者建档、随访提醒、医助联系与就诊资料预沟通。\n处理范围：姓名、手机号、所在城市、疾病/主诉、病情简述，以及您主动上传的病历或检查报告；其中疾病与病历资料属于敏感个人信息。\n处理方式：仅授权医助团队在本地演示后台查看与跟进；生产环境需限制最小必要人员访问并保留审计日志。\n保存期限：本地演示数据库留存；真实上线应按最短必要期限保存，到期删除或匿名化。\n您的权利：您可申请查阅、更正、删除、撤回同意；撤回后可能影响医助继续跟进。",
    doctorProfile: {
      profile: {
        oneline: "专注胆石病微创与保胆治疗，帮助患者把检查、挂号、加号、住院和术后随访串起来。",
        stats: [{n:"30+年",l:"普外/胆石病诊疗"},{n:"上万例",l:"胆石病手术经验"},{n:"周二/周四",l:"专家门诊"}],
        who: "上海市东方医院胆石病中心主任医师、教授，长期从事胆结石、胆囊息肉、胆道疾病诊疗。",
        solve: "胆囊结石、胆囊息肉、胆总管结石、术后复诊和需要评估保胆/微创方案的患者。",
        howto: "初诊先发 303 查看门诊与挂号方式；确需加号发 404；外地患者可发 101 获取线上咨询入口。"
      },
      intro: "黄安华，上海市东方医院主任医师、教授，从事普外及胆石病诊疗 30 余年，专注胆结石、胆囊息肉、胆道疾病的微创与保胆治疗，累计完成手术上万例。坚持「能保胆不切胆、能微创不开腹」的理念。",
      columns: [{t:"胆结石一定要切胆囊吗？",d:"保胆取石的适应症与禁忌。"},{t:"体检查出胆囊息肉会癌变吗？",d:"息肉大小、随访与手术时机。"},{t:"胆囊切除后身体有哪些变化？",d:"术后饮食与消化适应。"}],
      news: [{t:"《健康报》专访：保胆手术的规范之路",d:"2024-09"},{t:"东方医院胆石病中心完成第 10000 例微创手术",d:"2024-05"}],
      thanks: [{name:"李**",text:"黄主任保住了我的胆囊，术后恢复很快，全家感激！"},{name:"王**",text:"从外地慕名而来，主任耐心细致，手术非常成功。"}],
      cases: [{t:"42岁女性·多发胆囊结石保胆取石",d:"保胆成功，随访 1 年无复发。"},{t:"58岁男性·胆总管结石微创取石",d:"三孔腹腔镜，术后 3 天出院。"}]
    },
    doctorVideo: { title:"医生给您留的一段话", duration:"01:48", caption:"黄安华主任：欢迎加入我们的院外健康群，我会和团队一起，陪伴大家的康复。" },
    videoConsult: { title:"申请和黄主任视频问诊", desc:"如医生开通视频问诊，可通过春雨医生或第三方平台发起；未开通时先走图文咨询和门诊评估。", platform:"春雨医生 / 第三方视频问诊", status:"待配置外部入口", qr:"video-consult-huang", note:"视频问诊需符合互联网诊疗规则，急症请直接线下就医。" },
    replyCenter: { title:"查看回复", desc:"用建档手机号验证后，查看您提交过的联络表、加号、住院、感谢等记录及当前跟进状态。" },
    contactForm: {
      title:"医患联络表", desc:"提交您的基础信息，方便医生精准了解您的情况。信息仅用于本群医助跟进。",
      fields:[
        {key:"name",label:"姓名",type:"text",required:true,placeholder:"请输入真实姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"用于医助联系您",err:"请输入正确的 11 位手机号",pattern:"^1[3-9]\\d{9}$",hint:"演示版做了格式校验（原系统手机号无验证）"},
        {key:"disease",label:"主要疾病 / 主诉",type:"text",required:true,placeholder:"如：多发胆囊结石",err:"请填写主要疾病"},
        {key:"plan",label:"随访方案",type:"select",required:false,options:["暂不需要","腹腔镜胆囊切除术后随访","保胆取石术后随访"],hint:"术后患者可选，建档后自动加入对应随访计划"},
        {key:"opDate",label:"手术/治疗日期",type:"date",required:false,hint:"用于随访起算（选填，不填则从建档日起算）"},
        {key:"city",label:"所在城市",type:"text",required:false,placeholder:"如：上海"},
        {key:"desc",label:"病情简述",type:"textarea",required:false,placeholder:"症状、时长、既往检查与用药…"}
      ],
      upload:{label:"上传病历 / 检查报告（选填）",note:"演示版仅做交互，不会真实上传"},
      submitText:"提交联络表", success:{title:"已提交",desc:"医助会尽快与您联系并完善建档。"}
    },
    addNumber: {
      title:"门诊加号申请", desc:"专家号有限，确有需要可申请加号。申请前请先提交医患联络表，方便医助核对基本信息和病情背景；未建档手机号无法直接提交加号申请。",
      requiresContactForm:true,
      unavailableSlots:["周四 全天"],
      fields:[
        {key:"name",label:"患者姓名",type:"text",required:true,placeholder:"请输入姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"11 位手机号",err:"请输入正确手机号",pattern:"^1[3-9]\\d{9}$"},
        {key:"date",label:"期望就诊日",type:"select",required:true,options:["周二 上午","周四 全天"],err:"请选择就诊日"},
        {key:"reason",label:"加号原因",type:"textarea",required:false,placeholder:"如：外地复诊、术后拆线…"}
      ],
      submitText:"提交加号申请", success:{title:"加号申请已提交",desc:"助理会在出诊日前与您电话确认，请保持手机畅通。"}
    },
    admission: {
      title:"住院预约", notes:["适用于已明确需手术/住院治疗的患者。","床位按病情紧急程度与排期安排。","请准备好既往检查报告。"],
      fields:[
        {key:"name",label:"患者姓名",type:"text",required:true,placeholder:"请输入姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"11 位手机号",err:"请输入正确手机号",pattern:"^1[3-9]\\d{9}$"},
        {key:"diag",label:"诊断 / 拟手术",type:"text",required:true,placeholder:"如：胆囊结石拟行腹腔镜手术",err:"请填写诊断"},
        {key:"time",label:"期望住院时间",type:"text",required:false,placeholder:"如：两周内 / 国庆后"}
      ],
      submitText:"提交住院预约", success:{title:"住院预约已提交",desc:"住院助理会联系您评估床位与排期。"}
    },
    clinicArticle: { title:"黄安华主任 · 出诊地址与时间", source:"上海市东方医院服务号",
      body:[{h:"出诊地点",p:"上海市东方医院（南院）门诊楼 3 楼 普外科 / 胆石病中心专家诊区。"},{h:"出诊时间",p:"周二 上午 08:00–11:30；周四 全天 08:00–16:30。"},{h:"挂号方式",p:"「上海市东方医院」公众号挂号；专家号紧张，建议提前预约或群内发 404 申请加号。"}],
      tip:"初诊请携带既往 B超/CT/化验单等检查资料。" },
    dietArticle: { title:"胆囊术后 / 胆石病患者 · 饮食指南", source:"春雨医生 · 科普",
      body:[{h:"术后早期（1–2周）",p:"清流质、低脂半流质：米汤、藕粉、蒸蛋。少量多餐，避免油腻。"},{h:"恢复期（1–3月）",p:"过渡到低脂正常饮食，增加优质蛋白与膳食纤维。"},{h:"长期原则",p:"控制脂肪、规律三餐、戒酒、少吃内脏与蛋黄。"}],
      tip:"胆囊切除后初期进食油腻可能腹泻，多为暂时性。" },
    copyArticle: { title:"病案 / 病历复印 办理指引", source:"上海市东方医院服务号",
      body:[{h:"可复印内容",p:"住院病案首页、出院记录、手术记录、检验检查报告等。"},{h:"办理材料",p:"患者本人身份证；委托他人需委托书及代办人身份证。"},{h:"办理流程",p:"门诊 1 楼病案室提交申请→核对登记→缴费→领取或邮寄。"}],
      tip:"复印用于商保理赔、转院、伤残鉴定等，请按需选择。" },
    surgeryArticle: { title:"住院及手术须知", source:"科室宣教资料 · 运营整理",
      body:[{h:"入院前准备",p:"携带身份证、医保卡、既往检查报告、过敏史/用药清单；按医生要求空腹或停用相关药物。"},{h:"住院期间",p:"听从医生和护士安排完成术前检查、签署知情同意、按时禁食禁饮；如发热、腹痛加重请及时告知。"},{h:"出院后",p:"按出院小结服药、换药、拆线和复诊；出现高热、剧烈腹痛、伤口渗血/红肿等情况请及时就医。"}],
      tip:"不同手术方式要求不同，最终以医生和护士的当面交代为准。" },
    consult: { title:"群内咨询病情", text:"您可以在群里简单描述病情，助理会做基础科普并引导就医。群内沟通不能替代面诊，复杂或紧急情况请尽快到院。", guide:"想要医生 1对1 解答？发送 101 获取专属咨询入口。" },
    story: { title:"给黄主任写感谢信", intro:"如果黄主任和医助团队的诊治让您有所收获，欢迎在这里写下您想对他们说的感谢。内容会转达给医生团队，不替代诊疗。",
      prompts:["最想感谢黄主任的一件事","印象最深的一次帮助","想对医助团队说的话"],
      samples:[{name:"老患者·张先生",text:"感谢黄主任当年帮我保住了胆囊，到现在都好好的，真心谢谢您和团队的用心。"},{name:"宝妈·小林",text:"哺乳期胆囊炎反复发作，多亏黄主任团队细心评估、选了最稳妥的方案，特别感谢。"}] },
    thankDoctor: { title:"感谢医生", desc:"可以给医生团队留下一段感谢或鼓励。内容会先进入后台待审核，不直接公开展示。", placeholders:["感谢医生耐心解答","感谢医助随访提醒","给医生团队一点鼓励"] },
    communityFaq: {
      title:"周琦/黄主任答群友常见问题",
      sections:[
        {title:"手术相关",items:["什么情况需要手术", "术前要带哪些检查", "术后多久复诊"]},
        {title:"门诊挂号",items:["门诊时间", "加号流程", "外地患者就医路径"]},
        {title:"住院与复印",items:["住院预约", "病案复印", "医保流程"]},
        {title:"康复随访",items:["饮食指导", "伤口观察", "异常情况处理"]}
      ],
      safeNote:"FAQ 只做流程和科普引导，不替代医生诊断；遇到报告解读、用药调整、手术决策或急症风险，统一转人工/线下就医。"
    },
    weeklyOps: {
      defaultTopic:"不吸烟，为什么还会得肺癌？",
      template:"本周内容先做科普提醒：风险因素、筛查方式和就诊时机需要结合个人年龄、基础病、影像资料和症状综合判断。群内只做健康教育，不在群里直接判断个人病情。",
      quiz:["长期二手烟/油烟暴露","家族史或基础肺病","胸部 CT 发现结节","以上都可能相关"]
    },
    followupPlans: [
      { key:"lc", name:"腹腔镜胆囊切除术后随访", scene:"胆囊切除术后", nodes:[
        {day:1, title:"术后第 1 天", edu:"以清流质为主（米汤、藕粉、稀粥），少量多次饮水；避免油腻与产气食物。", reminder:"观察伤口有无渗血、红肿、发热；如剧烈腹痛 / 高热 / 呕吐请立即急诊。", action:"consult"},
        {day:3, title:"术后第 3 天", edu:"过渡到低脂半流质（蒸蛋、烂面、豆腐）；继续少量多餐。", reminder:"保持伤口敷料干燥清洁；下床适度活动预防血栓。", action:"consult"},
        {day:7, title:"术后第 7 天", edu:"多数患者可拆线；逐步增加优质蛋白与膳食纤维。", reminder:"门诊拆线 / 复查，号源紧张可申请加号。", action:"add"},
        {day:30, title:"术后第 30 天", edu:"过渡到低脂正常饮食，规律三餐、戒酒、少吃内脏与蛋黄。", reminder:"门诊复诊评估恢复；如仍有腹胀腹泻可复查。", action:"add"}
      ]},
      { key:"preserve", name:"保胆取石术后随访", scene:"保胆取石术后", nodes:[
        {day:1, title:"术后第 1 天", edu:"清淡流质饮食，避免油腻；注意休息。", reminder:"观察有无腹痛、发热；异常及时就医。", action:"consult"},
        {day:7, title:"术后第 7 天", edu:"低脂饮食为主，规律作息。", reminder:"门诊复查，可申请加号。", action:"add"},
        {day:30, title:"术后第 30 天", edu:"建立低脂规律饮食习惯，预防结石复发。", reminder:"复诊评估并安排后续超声随访。", action:"add"},
        {day:90, title:"术后第 90 天", edu:"长期低脂饮食、控制体重、规律三餐。", reminder:"复查腹部超声，评估有无复发。", action:"add"}
      ]}
    ],
    certifications: ["卫健委执业注册", "三甲医院主任医师", "实名认证"],
    servicePackages: [
      { disease:"胆囊结石", name:"胆囊结石 · 一站式服务", intro:"从评估、加号、手术到术后随访的全流程，一处搞定。", items:["consult","add","adm","diet","followup","copy"] },
      { disease:"胆囊息肉", name:"胆囊息肉 · 随访管理", intro:"息肉大小评估、随访与手术时机判断。", items:["consult","add","clinic","diet"] }
    ],
    menu: { title:"群功能菜单 · 发送对应代号即可", items:[
      {code:"101",label:"向黄主任咨询"},{code:"102",label:"申请视频问诊"},{code:"114",label:"查询医院咨询电话"},{code:"202",label:"查看回复"},{code:"303",label:"挂号及门诊时间"},{code:"404",label:"门诊加号"},{code:"414",label:"住院预约"},{code:"606",label:"学习黄主任科普专栏"},{code:"616",label:"住院及手术须知"},{code:"626",label:"就医常见问题"},{code:"808",label:"医生简介展示"},{code:"818",label:"把黄主任介绍给亲友"},{code:"909",label:"感谢医生"},{code:"919",label:"分享就医经验"},{code:"707",label:"术后饮食指导"},{code:"717",label:"病案复印指导"},{code:"979",label:"医患联络表"}
    ]},
    quickKeywords: [{c:"101",l:"咨询"},{c:"102",l:"视频"},{c:"202",l:"回复"},{c:"303",l:"门诊"},{c:"404",l:"加号"},{c:"414",l:"住院"},{c:"606",l:"科普"},{c:"616",l:"手术"},{c:"626",l:"FAQ"},{c:"808",l:"简介"},{c:"909",l:"感谢"},{c:"707",l:"饮食"},{c:"717",l:"复印"},{c:"979",l:"联络表"},{c:"1",l:"全部功能"}]
  },
  intro: { opensFaq:true, items:[
    { bot:"小宝医助", type:"text", text:"您好，欢迎加入黄安华医生建立的【院外公益健康班】，旨在给大家提供门诊之外的帮助👏\n\n⚠️ 以下非常重要 ⚠️\n1️⃣ 点击下方【医患联络表】，在充分告知和单独同意后提交基础信息\n2️⃣ 群昵称不建议公开姓名、病情或手机号；医助会通过联络表识别与跟进\n3️⃣ 在群里输入数字「1」，查看全部群功能\n\n请点击下方小程序，观看黄安华医生给您的视频问候。" },
    { bot:"小宝医助", type:"mp", title:"【必看】医生给您留的一段话", sub:"医生风采 · 进群必看", thumb:"mpProfile", page:"doctor-profile" },
    { bot:"小宝医助", type:"mp", title:"【必填】医患联络表", sub:"提交基础信息，医助精准跟进", thumb:"mpForm", page:"contact-form" },
    { bot:"小宝医助", type:"text", text:"📌 已为您弹出「群友常见问题」，多数问题先看这页就能解决～" }
  ]},
  rules: [
    {code:"101",aliases:["咨询医生","想咨询医生","问医生","找医生看看","向黄主任咨询","怎么咨询","如何咨询","想问医生","想问问医生"],match:"exact",bot:"小雪医助",responses:[
      {type:"text",text:"如需 1对1 咨询医生，可点击下方春雨医生小程序卡片进入黄安华主任主页，再选择图文/电话/视频问诊或预约就诊入口。\n\n群内沟通不能替代面诊；如情况紧急或症状明显加重，请及时到正规医院就诊。"},
      extCard({type:"mp",title:"春雨图文问诊入口",sub:"黄安华医生主页 · 可复制微信短链",thumb:"mpForm",page:"doctor-profile"}, HUANG_CY.consultHome),
      {type:"qr",name:"黄安华 · 上海市东方医院",sub:"胆石病中心",caption:"亲爱的患友您好：微信扫一扫，和我保持联系",code:"haodaifu"}
    ]},
    {code:"102",aliases:["视频问诊","想视频问诊","申请视频","怎么视频问诊","视频咨询"],match:"exact",bot:"小雪医助",responses:[
      {type:"text",text:"@{patient} 如需和黄主任视频问诊，可先点击下方入口查看是否已开通；急症请不要等待视频问诊，直接线下就医。"},
      extCard({type:"mp",title:"申请和黄主任视频问诊",sub:"黄安华医生主页 · 视频问诊状态以春雨为准",thumb:"mpVideo",page:"video-consult"}, HUANG_CY.videoHome)]},
    {code:"114",aliases:["医院电话","咨询电话"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"@{patient} 这是医生所在医院的咨询电话，点击下方可查看👇"},{type:"popup",modal:"hospitalPhone"}]},
    {code:"202",aliases:["查看回复","我的回复","订单回复","怎么查回复","查看我的回复","有回复了吗"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"@{patient} 点击下方入口，用建档手机号验证后可查看您提交过的记录和当前跟进状态；也可复制下方春雨小程序链接到微信打开，直接查看您的订单/回复👇"},
      extCard({type:"mp",title:"查看回复",sub:"春雨问诊历史/API 回复状态 · 本地记录兜底",thumb:"mpForm",page:"replies"}, CY.replies)]},
    {code:"303",aliases:["挂号","怎么挂号","想挂号","约门诊","门诊","出诊","挂号方式","怎么约门诊","怎么预约门诊","如何挂号","怎么看门诊"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"黄安华主任的出诊地址与时间如下👇 专家号紧张，建议提前预约，或发「404」申请加号。"},
      extCard({type:"link",title:"黄安华主任 · 出诊地址与时间",source:"上海市东方医院服务号",thumb:"hospital",page:"article:clinic"}, HUANG_CY.appointment)]},
    {code:"404",aliases:["加号","怎么加号","加个号","能加号吗","想加号","如何加号"],match:"exact",bot:"小雪医助",responses:[
      {type:"text",text:"需要加号的患友，请先点击【医患联络表】提交基础信息；完成建档后再提交加号申请，助理会在出诊日前与您电话确认👇"},
      {type:"mp",title:"【必填】医患联络表",sub:"先建档，再申请加号",thumb:"mpForm",page:"contact-form"},
      extCard({type:"mp",title:"门诊加号申请",sub:"黄安华医生主页/预约就诊 · 本地表单兜底",thumb:"mpAdd",page:"add-number"}, HUANG_CY.appointment)]},
    {code:"414",aliases:["住院","住院预约","想住院","要住院","办住院","怎么住院"],match:"exact",bot:"小雪医助",responses:[
      {type:"text",text:"如需住院治疗，请点击下方提交住院预约。床位紧张，我们会按病情与排期为您安排👇"},
      {type:"mp",title:"住院预约",sub:"问卷收集 · 运营/医助跟进",thumb:"mpBed",page:"admission",external:null,ctaLabel:"填写住院预约问卷"}]},
    {code:"606",aliases:["科普","科普专栏"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"黄主任在各平台都有科普内容，欢迎关注学习👇"},
      {type:"mp",title:"黄主任 · 科普账号汇总",sub:"公众号/视频号/抖音/好大夫",thumb:"mpScience",page:"accounts"}]},
    {code:"616",aliases:["住院须知","手术须知","住院手术"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"@{patient} 住院和手术前后需要准备的事项整理在这里，具体仍以医生和护士当面交代为准👇"},
      {type:"link",title:"住院及手术须知",source:"科室宣教资料 · 运营整理",thumb:"mpBed",page:"article:surgery"}]},
    {code:"626",aliases:["常见问题","群友常见问题","FAQ"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"@{patient} 群友最常问的问题都汇总在这里，先看这一页通常能解决大部分基础问题👇"},
      {type:"mp",title:"群友常见问题",sub:"挂号/加号/住院/复印/康复 FAQ",thumb:"mpScience",page:"faq"}]},
    {code:"808",aliases:["医生简介","医生介绍","医生主页"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"先来认识一下黄安华主任👇"},
      extCard({type:"mp",title:"黄安华主任 · 医生风采",sub:"春雨医生主页 · 本地风采兜底",thumb:"mpProfile",page:"doctor-profile"}, HUANG_CY.doctorHome)]},
    {code:"818",aliases:["介绍给亲友","推荐","海报"],match:"exact",bot:"小雪医助",responses:[
      {type:"text",text:"感谢您的信任！身边亲友若也有胆结石、胆囊息肉等困扰，欢迎把黄主任介绍给他们。点击下方保存医生海报👇"},
      {type:"image",svg:"poster",page:"poster"}]},
    {code:"909",aliases:["感谢医生","送心意","感谢","想感谢医生","怎么感谢","感谢黄主任"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"@{patient} 如果想给黄主任和医助团队留一段感谢或鼓励，可以点击下方填写。春雨“送心意”需要先进入医生主页再点送心意；本系统留言会先进入后台审核，不直接公开。"},
      extCard({type:"mp",title:"感谢医生 / 春雨送心意",sub:"医生主页短链 · 本地感谢留言兜底",thumb:"mpHeart",page:"thank-doctor"}, HUANG_CY.sendHeart)]},
    {code:"919",aliases:["评价","分享经验","好评"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"如果黄主任的诊疗让您有所收获，欢迎分享您的就医经验，帮助更多病友🌷"},
      {type:"link",title:"我乐意分享就医经验",source:"春雨问诊评价",thumb:"star",page:"review"},
      {type:"text",text:"（温馨提示：按平台规则，需完成一次问诊后方可评价。）"}]},
    {code:"707",aliases:["饮食","术后饮食","饮食指导"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"术后饮食很有讲究，吃对了恢复更快👇 点击查看完整《饮食指南》。"},
      {type:"link",title:"胆囊术后 / 胆石病患者 · 饮食指南",source:"春雨医生 · 科普",thumb:"diet",page:"article:diet"}]},
    {code:"717",aliases:["复印","病案复印","复印病历"],match:"exact",bot:"小宝医助",responses:[
      {type:"text",text:"需要复印病历 / 病案的患友，按以下指引办理即可👇"},
      {type:"link",title:"病案 / 病历复印 办理指引",source:"上海市东方医院服务号",thumb:"copy",page:"article:copy"}]},
    {code:"979",aliases:["医患联络表","建档","联络表"],match:"exact",bot:"小宝医助",responses:[
      {type:"mp",title:"【必填】医患联络表",sub:"提交基础信息",thumb:"mpForm",page:"contact-form"}]},
  ],
  faq: [
    {grp:"看病就医",q:"怎么找黄主任看病？",a:"发送 303 查看出诊时间与挂号方式；号源紧张可发 404 申请加号。",sort:1},
    {grp:"看病就医",q:"外地患者怎么办？",a:"可先发 101 进行 1对1 图文咨询；确需手术可发 414 预约住院。",sort:2},
    {grp:"群内服务",q:"群里的数字代号都是什么？",a:"101咨询、114电话、303门诊、404加号、414住院、606科普、818推荐、919评价、707饮食、717复印、979联络表。发 1 看完整菜单。",sort:3},
    {grp:"康复与随访",q:"术后吃什么？",a:"发送 707 或「饮食」查看术后饮食指南。",sort:4},
    {grp:"康复与随访",q:"怎么复印病历？",a:"发送 717 或「复印」查看病案复印办理指引。",sort:5}
  ]
};

// 第二位医生：郭强（仁济·风湿免疫科）——精简配置，演示「不同医生不同功能/话术」
const guo = {
  slug:"guo", active:0,
  name:"郭强", title:"主任医师",
  hospital:"上海仁济医院", dept:"风湿免疫科",
  specialty:"类风湿关节炎 · 痛风 · 红斑狼疮",
  group_name:"郭强医生健康 15班", member_count:96,
  scope_note:"院外公益健康班", hospital_phone:"021-6837-0000",
  bots:["小玉医助","盼盼医助"],
  clinic:{ place:"上海仁济医院（东院）门诊 5 楼 风湿免疫科", times:["周一 上午","周三 下午"] },
  accounts:[{platform:"微信公众号",handle:"郭强谈风湿",icon:"📰"},{platform:"好大夫在线",handle:"郭强 主任医师",icon:"🩺"}],
  content:{
    disclaimer:"本页面为本地演示，不构成诊断、处方、诊疗建议或疗效承诺；急重症请立即到院。",
    chunyuIntegration: {
      status:"已接入当前可复制的春雨小程序页面级 Short Link；需要登录态/签名/医生参数的分支仍不假装已可直跳",
      defaultMiniProgram:{ appId:"wx214b7e2bcde837d6", originalId:"待春雨提供 gh_xxx", path:"pages/open_login/index?token={token}&session_id={session_id}", shortLink:CHUNYU_SHORT_LINKS.home.shortLink, shortLinkScope:CHUNYU_SHORT_LINKS.home.scope, userProvidedShortLink:CHUNYU_USER_MAIN_SHORT_LINK },
      knownShortLinks:CHUNYU_SHORT_LINKS,
      checkedAt:CHUNYU_SHORT_LINK_CHECKED_AT,
      unavailableShortLinks:[
        "图文急诊/快速问诊：可进“描述病情”，但复制链接不会产生页面级短链",
        "我的订单/查看回复：当前状态下复制链接不会产生新短链",
        "送心意：可从医生主页进入，但页面不可转发/不可分享，复制链接不会产生页面级短链",
        "检测早筛：会跳到外部“晓飞检”小程序，不写作春雨医生内部分支"
      ],
      required:["春雨 partner", "partner_key", "user_id/phone", "atime", "服务端 sign", "doctor_id/服务策略key", "jump_wxapp 返回 token/session_id", "春雨小程序原始 ID gh_xxx", "公众号 JS-SDK 签名/JS 安全域名", "或页面级 URL Link/URL Scheme/Short Link"],
      docs:[CHUNYU_DOCS.product, CHUNYU_DOCS.wap, CHUNYU_DOCS.graph, CHUNYU_DOCS.video, CHUNYU_DOCS.expert],
      fallback:"已拿到页面级短链的入口可复制到微信打开；未拿到真实参数的入口只展示缺口并保留本地页面兜底。"
    },
    consentText:"处理目的：用于本医生健康班建档、随访与医助联系。\n处理范围：姓名、手机号、疾病描述及您主动上传的病历资料。\n您的权利：可申请查阅、更正、删除或撤回授权。",
    doctorProfile:{ profile:{oneline:"围绕风湿免疫慢病管理，把就诊、复诊、化验和随访提醒串起来。",stats:[{n:"20+年",l:"风湿免疫诊疗"},{n:"长期",l:"慢病随访管理"},{n:"周一/周三",l:"专家门诊"}]},
      intro:"郭强，上海仁济医院风湿免疫科主任医师，擅长类风湿关节炎、痛风、系统性红斑狼疮的规范化诊疗与长期管理。",
      columns:[{t:"类风湿关节炎能根治吗？",d:"达标治疗与长期管理。"},{t:"痛风发作怎么办？",d:"急性期处理与降尿酸。"}], news:[], thanks:[{name:"刘**",text:"郭主任把我的类风湿控制得很稳定。"}], cases:[{t:"35岁女性·类风湿达标治疗",d:"规范用药，关节功能恢复。"}] },
    doctorVideo:{ title:"郭强医生的问候", duration:"01:17", caption:"郭强主任：欢迎加入风湿免疫健康班。" },
    contactForm:{ title:"医患联络表", desc:"提交基础信息，方便医助跟进。", fields:[
      {key:"name",label:"姓名",type:"text",required:true,err:"请填写姓名"},
      {key:"phone",label:"手机号",type:"tel",required:true,err:"请输入正确手机号",pattern:"^1[3-9]\\d{9}$"},
      {key:"disease",label:"主要疾病",type:"text",required:true,placeholder:"如：类风湿关节炎",err:"请填写主要疾病"}
    ], submitText:"提交", success:{title:"已提交",desc:"医助会尽快联系您。"} },
    clinicArticle:{ title:"郭强主任 · 出诊时间", source:"仁济医院服务号", body:[{h:"出诊",p:"周一上午、周三下午，仁济医院东院风湿免疫科。"}], tip:"初诊带既往化验单。" },
    consult:{ title:"群内咨询病情", text:"可在群内描述病情，助理做基础科普并引导就医。", guide:"发送 101 获取 1对1 咨询入口。" },
    story:{ title:"给郭主任写感谢信", intro:"欢迎在这里写下您想对郭主任和医助团队说的感谢，内容会转达给医生团队。", samples:[] },
    followupPlans:[
      { key:"ra", name:"类风湿达标治疗随访", scene:"类风湿关节炎慢病管理", nodes:[
        {day:14, title:"用药 2 周", edu:"按医嘱规律服药，记录晨僵时间与关节肿痛数。", reminder:"复查血常规、肝肾功能，监测药物不良反应。", action:"add"},
        {day:30, title:"用药 1 个月", edu:"坚持规范用药与适度关节功能锻炼。", reminder:"门诊评估疗效（DAS28），必要时调整方案。", action:"add"},
        {day:90, title:"用药 3 个月", edu:"达标治疗阶段，注意感染防护与作息。", reminder:"复查炎症指标与影像，评估是否达标。", action:"add"}
      ]}
    ],
    certifications: ["卫健委执业注册", "三甲医院主任医师", "实名认证"],
    servicePackages: [
      { disease:"类风湿关节炎", name:"类风湿 · 达标治疗管理", intro:"规范用药、定期复查、达标管理一站式。", items:["consult","add","clinic","followup"] }
    ],
    menu:{ title:"群功能菜单", items:[{code:"101",label:"咨询郭主任"},{code:"114",label:"医院电话"},{code:"303",label:"出诊时间"},{code:"707",label:"痛风饮食"}] },
    quickKeywords:[{c:"101",l:"咨询"},{c:"303",l:"门诊"},{c:"饮食",l:"饮食"},{c:"1",l:"全部功能"}]
  },
  intro:{ opensFaq:false, items:[
    { bot:"小玉医助", type:"text", text:"您好，欢迎加入郭强医生的【院外公益健康班】👏\n请在群里输入数字「1」查看全部功能。" },
    { bot:"小玉医助", type:"mp", title:"郭强主任 · 医生风采", sub:"进群必看", thumb:"mpProfile", page:"doctor-profile" }
  ]},
  rules:[
    {code:"101",aliases:["咨询"],match:"exact",bot:"盼盼医助",responses:[
      {type:"text",text:"如需 1对1 咨询医生，可点击下方春雨医生小程序卡片进入郭强主任主页，再按页面提示选择服务。\n\n群内沟通不能替代面诊；如情况紧急或症状明显加重，请及时到正规医院就诊。"},
      extCard({type:"mp",title:"春雨图文问诊入口",sub:"H5/API 直连春雨问诊 · 待联调",thumb:"mpForm",page:"doctor-profile"}, CY.graphConsult),
      {type:"qr",name:"郭强 · 上海仁济医院",sub:"风湿免疫科",caption:"扫一扫保持联系",code:"haodaifu"}]},
    {code:"114",aliases:["医院电话"],match:"exact",bot:"小玉医助",responses:[
      {type:"text",text:"@{patient} 医院咨询电话👇"},{type:"popup",modal:"hospitalPhone"}]},
    {code:"303",aliases:["门诊","出诊"],match:"exact",bot:"小玉医助",responses:[
      {type:"text",text:"郭强主任出诊时间如下👇"},
      extCard({type:"link",title:"郭强主任 · 出诊时间",source:"仁济医院服务号",thumb:"hospital",page:"article:clinic"}, CY.hospitalRegister)]},
    {code:"707",aliases:["饮食","痛风饮食"],match:"exact",bot:"小玉医助",responses:[
      {type:"text",text:"痛风患者饮食要点：低嘌呤、多饮水、限酒。详询门诊。"}]}
  ],
  faq:[{grp:"看病就医",q:"怎么找郭主任看病？",a:"发送 303 查看出诊时间。",sort:1}]
};

/* 唯一上线医生：吕富靖（消化内科 · 首都医科大学附属北京友谊医院）。
   profile 取自甲方春雨主页截图（真值）；科室特定内容为消化内科保守通用口径；
   随访节点/病例/科普一律保守（“遵医嘱、如有不适及时就医”级）并显式标注“待吕主任团队确认”，不自编具体天数/结论/检查/用药；
   跳转一律走 LV_CY 兜底（不冒充直达）。擅长全文、主页短链、友谊医院电话、出诊时间等缺口见报告“数据缺口”。 */
const lvfujing = {
  slug: "lvfujing", active: 1,
  name: "吕富靖", title: "消化内科 主任医师",
  hospital: "首都医科大学附属北京友谊医院", dept: "消化内科",
  specialty: "胃肠息肉及息肉病 · 胃息肉 · 幽门螺杆菌感染 · 慢性（萎缩性/糜烂性）胃炎 · 胃食管反流 · 反流性食管炎 · 胃/十二指肠溃疡 · 消化道出血 · 功能性消化不良 · 肠易激综合征 · 便秘 · 胆囊息肉/胆总管结石/梗阻性黄疸 · 肝硬化 · 慢性胰腺炎 · 早期胃癌及消化道肿瘤",
  group_name: "吕富靖主任消化健康群", member_count: 0,
  scope_note: "院外公益健康群（演示）", hospital_phone: "010-63138585",
  bots: ["小友医助", "小消医助"],   // 医助机器人名为演示占位，待甲方确认
  clinic: { place: "首都医科大学附属北京友谊医院（西城院区：北京市西城区永安路95号）消化内科门诊",
            times: ["西城院区周一上午；西城特需周一、周二下午；顺义特需周三下午（具体以北京友谊医院服务号挂号为准，如有调整以服务号为准）"] },
  accounts: [
    { platform: "微信公众号", handle: "（待甲方补全）", icon: "📰" },
    { platform: "好大夫在线", handle: "吕富靖 主任医师", icon: "🩺" }
  ],
  content: {
    disclaimer: "本页面为本地演示，不构成诊断、处方、诊疗建议或疗效承诺；群内沟通不能替代线下面诊。出现呕血、黑便、剧烈腹痛、持续高热、吞咽困难、明显消瘦等情况请立即到正规医院就诊。",
    chunyuIntegration: {
      status:"已接入吕富靖医生主页真实 Short Link 与当前可复制的春雨小程序页面级 Short Link；小程序短链需复制到微信内打开，需要登录态/签名/医生参数的分支不假装已可直跳",
      defaultMiniProgram:{ appId:"wx214b7e2bcde837d6", originalId:"待春雨提供 gh_xxx", path:"pages/open_login/index?token={token}&session_id={session_id}", shortLink:CHUNYU_SHORT_LINKS.home.shortLink, shortLinkScope:CHUNYU_SHORT_LINKS.home.scope, userProvidedShortLink:CHUNYU_USER_MAIN_SHORT_LINK },
      knownShortLinks:CHUNYU_SHORT_LINKS,
      checkedAt:CHUNYU_SHORT_LINK_CHECKED_AT,
      doctorHomeShortLink:CHUNYU_SHORT_LINKS.lvDoctor.shortLink,
      doctorHomePage:"https://www.chunyuyisheng.com/pc/doctor/4ab15ad117fc8297c028/",
      unavailableShortLinks:[
        "图文急诊/快速问诊：可进“描述病情”，但复制链接不会产生页面级短链",
        "我的订单/查看回复：当前状态下复制链接不会产生新短链",
        "送心意：可从医生主页进入，但页面不可转发/不可分享，复制链接不会产生页面级短链"
      ],
      required:["春雨 partner", "partner_key", "user_id/phone", "atime", "服务端 sign", "doctor_id/服务策略key", "jump_wxapp 返回 token/session_id", "春雨小程序原始 ID gh_xxx", "公众号 JS-SDK 签名/JS 安全域名（仅网页一键拉起需要）"],
      docs:[CHUNYU_DOCS.product, CHUNYU_DOCS.wap, CHUNYU_DOCS.graph, CHUNYU_DOCS.video, CHUNYU_DOCS.expert],
      fallback:"吕富靖医生主页与已拿到页面级短链的入口可复制到微信打开；页面级（送心意/我的订单）仍需进入主页后再点，不冒充页面级直达。"
    },
    consentText: "处理目的：用于本医生健康群的患者建档、随访提醒、医助联系与就诊资料预沟通。\n处理范围：姓名、手机号、所在城市、疾病/主诉、病情简述，以及您主动上传的病历或检查报告；其中疾病与病历资料属于敏感个人信息。\n处理方式：仅授权医助团队在本地演示后台查看与跟进；生产环境需限制最小必要人员访问并保留审计日志。\n保存期限：本地演示数据库留存；真实上线应按最短必要期限保存，到期删除或匿名化。\n您的权利：您可申请查阅、更正、删除、撤回同意；撤回后可能影响医助继续跟进。",
    doctorProfile: {
      profile: {
        oneline: "消化内科主任医师，专注胃肠息肉、幽门螺杆菌与慢性胃炎等消化道常见病的规范诊治与术后随访。",
        stats: [{n:"31年",l:"消化内科从业"},{n:"1.5万",l:"累计接诊量"},{n:"5.0",l:"春雨评分"}],
        who: "首都医科大学附属北京友谊医院消化内科主任医师、知名专家，长期从事胃肠息肉、幽门螺杆菌感染、慢性胃炎、胃食管反流等消化道疾病诊疗。",
        solve: "胃肠息肉、幽门螺杆菌感染、慢性（萎缩性/糜烂性）胃炎、胃食管反流，以及胃肠镜检查与息肉切除术后需要随访的患者。",
        howto: "初诊先发 201 查看门诊与挂号方式；确需加号发 301；外地患者可发 101 获取线上咨询入口。"
      },
      intro: "吕富靖，首都医科大学附属北京友谊医院消化内科主任医师，从事消化内科诊疗 31 年，累计接诊约 1.5 万人次，同行认可度高。擅长：胃肠息肉及息肉病、胃息肉、幽门螺杆菌感染、慢性胃炎、胃食管反流、慢性萎缩性胃炎、糜烂性胃炎、胃肠功能紊乱、功能性消化不良、便秘、肠易激综合征、胃肠炎、食管疾病、反流性食管炎、胃溃疡、十二指肠溃疡、消化道出血、胆囊息肉、胆总管结石、梗阻性黄疸、肝硬化、慢性胰腺炎、早期胃癌、胃肠道间质瘤、胃肠道肿瘤、食管癌、贲门癌、胆管癌、胰腺癌、溃疡性结肠炎。所属医院为百强医院、消化学科全国前列。",
      credentials: ["首都医科大学附属北京友谊医院（三甲）", "医学博士", "中华消化内镜学分会委员", "中华消化内镜学分会结直肠学组委员", "可开处方", "实名认证 / 执业资质审核通过"],
      columns: [{t:"查出胃肠息肉要紧吗？",d:"息肉随访与处理的一般原则（科普，具体以面诊为准）。"},{t:"幽门螺杆菌一定要根除吗？",d:"幽门螺杆菌相关科普与就医引导。"},{t:"慢性胃炎日常怎么养？",d:"饮食作息一般建议（科普，不替代诊疗）。"}],
      // 报道仅展示春雨域链接（science_content.normalizeHomepageNews）；有配图才渲染图片。更多真实新闻素材到位后直接增补本数组即可出现。
      news: [
        {t:"吕富靖主任 · 春雨医生主页", d:"春雨医生", url:"https://www.chunyuyisheng.com/pc/doctor/4ab15ad117fc8297c028/", img:"/assets/lvfujing-avatar.png"},
        {t:"线上咨询与服务入口", d:"春雨医生", url:"https://www.chunyuyisheng.com/events/special/?config_id=2515", img:"/assets/chunyu-doctor-icon.png"}
      ],
      thanks: [{name:"（演示占位）",text:"感谢信内容待吕主任团队提供真实素材。"}],
      cases: [{t:"病例展示（演示占位）",d:"真实病例素材待吕主任团队提供并审核后再上线。"}]
    },
    // 606 科普外链卡唯一数据源：有条目才发卡；空数组 → 只发 code606 渠道话术（待主办方补春雨域科普后再生成卡）。
    scienceArticles: [],
    doctorVideo: { title:"医生给您留的一段话", duration:"待补", caption:"（视频问候素材待吕主任团队提供）" },
    videoConsult: { title:"申请和吕主任视频问诊", desc:"如医生开通视频问诊，可通过春雨医生或第三方平台发起；未开通时先走图文咨询和门诊评估。", platform:"春雨医生 / 第三方视频问诊", status:"待配置外部入口", qr:"video-consult-lvfujing", note:"视频问诊需符合互联网诊疗规则，急症请直接线下就医。" },
    replyCenter: { title:"查看回复", desc:"用建档手机号验证后，查看您提交过的联络表、加号、住院、感谢等记录及当前跟进状态。" },
    contactForm: {
      title:"医患联络表", desc:"提交您的基础信息，方便医生精准了解您的情况。信息仅用于本群医助跟进。",
      fields:[
        {key:"name",label:"姓名",type:"text",required:true,placeholder:"请输入真实姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"用于医助联系您",err:"请输入正确的 11 位手机号",pattern:"^1[3-9]\\d{9}$",hint:"演示版做了格式校验（原系统手机号无验证）"},
        {key:"disease",label:"主要疾病 / 主诉",type:"text",required:true,placeholder:"如：胃息肉 / 幽门螺杆菌感染",err:"请填写主要疾病"},
        {key:"plan",label:"随访方案",type:"select",required:false,options:["暂不需要","胃肠镜检查后随访","胃肠息肉/结肠息肉切除后随访","幽门螺杆菌根除随访"],hint:"相关患者可选，建档后自动加入对应随访计划"},
        {key:"opDate",label:"检查/治疗日期",type:"date",required:false,hint:"用于随访起算（选填，不填则从建档日起算）"},
        {key:"city",label:"所在城市",type:"text",required:false,placeholder:"如：北京"},
        {key:"desc",label:"病情简述",type:"textarea",required:false,placeholder:"症状、时长、既往检查与用药…"}
      ],
      upload:{label:"上传病历 / 检查报告（选填）",note:"演示版仅做交互，不会真实上传"},
      submitText:"提交联络表", success:{title:"已提交",desc:"医助会尽快与您联系并完善建档。"}
    },
    addNumber: {
      title:"门诊加号申请", desc:"专家号有限，确有需要可申请加号。申请前请先提交医患联络表，方便医助核对基本信息和病情背景；未建档手机号无法直接提交加号申请。",
      requiresContactForm:true,
      unavailableSlots:["其他时段 / 临时停诊（转候补）"],   // 出诊时间已写死；不编造具体停诊日，撞「其他时段/临时停诊」即转候补，与下方 date option 逐字一致
      fields:[
        {key:"name",label:"患者姓名",type:"text",required:true,placeholder:"请输入姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"11 位手机号",err:"请输入正确手机号",pattern:"^1[3-9]\\d{9}$"},
        {key:"date",label:"期望就诊日",type:"select",required:true,options:["西城院区 周一上午","西城特需 周一下午","西城特需 周二下午","顺义特需 周三下午","其他时段 / 临时停诊（转候补）"],hint:"出诊时间以北京友谊医院服务号实时号源为准，如有调整以服务号为准；专家号紧张建议提前预约。",err:"请选择就诊日"},
        {key:"reason",label:"加号原因",type:"textarea",required:false,placeholder:"如：外地复诊、复查胃肠镜…"}
      ],
      submitText:"提交加号申请", success:{title:"加号申请已提交",desc:"助理会在出诊日前与您电话确认，请保持手机畅通。"}
    },
    admission: {
      title:"住院预约", notes:["适用于已明确需进一步检查/治疗的患者。","床位按病情与排期安排。","请准备好既往检查报告。"],
      fields:[
        {key:"name",label:"患者姓名",type:"text",required:true,placeholder:"请输入姓名",err:"请填写姓名"},
        {key:"phone",label:"手机号",type:"tel",required:true,placeholder:"11 位手机号",err:"请输入正确手机号",pattern:"^1[3-9]\\d{9}$"},
        {key:"diag",label:"诊断 / 拟处理",type:"text",required:true,placeholder:"如：结肠多发息肉拟内镜下处理",err:"请填写诊断"},
        {key:"time",label:"期望住院时间",type:"text",required:false,placeholder:"如：两周内 / 假期后"}
      ],
      submitText:"提交住院预约", success:{title:"住院预约已提交",desc:"住院助理会联系您评估床位与排期。"}
    },
    clinicArticle: { title:"吕富靖主任 · 挂号路径与就诊地址", source:"北京友谊医院服务号",
      body:[{h:"就诊地点",p:"首都医科大学附属北京友谊医院 消化内科门诊（西城院区：北京市西城区永安路95号）。"},{h:"出诊时间",p:"西城院区周一上午；西城特需周一、周二下午；顺义特需周三下午。具体以北京友谊医院服务号挂号为准，如有调整以服务号为准。"},{h:"挂号方式",p:"① 微信关注“北京友谊医院”服务号 → 预约挂号；② 电话预约挂号 010-114。专家号紧张，建议提前预约或群内发 301 申请加号。"},{h:"医院联系方式",p:"西城院区 010-63138585（永安路95号），科室电话 010-63014411；通州院区 010-80838585；顺义院区 010-81608585；电话预约挂号 010-114。"}],
      tip:"初诊请携带既往胃肠镜/化验单等检查资料。" },
    dietArticle: { title:"消化道常见病 · 日常饮食一般建议", source:"健康科普（一般性，不替代诊疗）",
      body:[{h:"一般原则",p:"规律三餐、细嚼慢咽，少食辛辣、过烫、过油及刺激性食物，戒烟限酒。"},{h:"检查/治疗后",p:"按医生当面交代的饮食过渡安排进食；如有不适及时与医生沟通。"},{h:"温馨提示",p:"以上为一般性健康教育，个体饮食方案请遵主治医生意见。"}],
      tip:"以上为一般性健康教育；具体饮食与忌口请以主治医生当面医嘱为准。" },
    copyArticle: { title:"病案 / 病历复印 办理指引", source:"北京友谊医院服务号",
      body:[{h:"可复印内容",p:"住院病案首页、出院记录、内镜/检查报告、检验报告等。"},{h:"办理材料",p:"患者本人身份证；委托他人需委托书及代办人身份证。"},{h:"办理流程",p:"到医院病案室提交申请→核对登记→缴费→领取或邮寄（具体窗口/流程以医院公告为准）。"}],
      tip:"复印用于商保理赔、转院等，请按需选择；具体流程以友谊医院官方公告为准。" },
    surgeryArticle: { title:"检查 / 住院前后须知（一般性）", source:"科室宣教资料 · 运营整理",
      body:[{h:"检查/入院前准备",p:"携带身份证、医保卡、既往检查报告、过敏史/用药清单；按医生要求做相应准备（如空腹、停用相关药物等，以医嘱为准）。"},{h:"过程中",p:"听从医生和护士安排完成检查与签署知情同意；如有不适及时告知。"},{h:"之后",p:"按医生交代复诊与观察；如出现呕血、黑便、剧烈腹痛、持续高热等情况请及时就医。"}],
      tip:"不同检查/治疗方式要求不同，最终以医生和护士的当面交代为准。" },
    consult: { title:"群内咨询病情", text:"您可以在群里简单描述病情，助理会做基础科普并引导就医。群内沟通不能替代面诊，复杂或紧急情况请尽快到院。", guide:"想要医生 1对1 解答？发送 101 获取专属咨询入口。" },
    story: { title:"给吕主任写感谢信", intro:"如果吕主任和医助团队的诊治让您有所收获，欢迎在这里写下您想对他们说的感谢。内容会转达给医生团队，不替代诊疗。",
      prompts:["最想感谢吕主任的一件事","印象最深的一次帮助","想对医助团队说的话"],
      samples:[] },
    thankDoctor: { title:"感谢医生", desc:"可以给医生团队留下一段感谢或鼓励。内容会先进入后台待审核，不直接公开展示。", placeholders:["感谢医生耐心解答","感谢医助随访提醒","给医生团队一点鼓励"] },
    communityFaq: {
      title:"吕主任答群友常见问题",
      sections:[
        {title:"检查相关",items:["什么情况建议做胃肠镜", "检查前要做哪些准备", "检查后多久复诊"]},
        {title:"门诊挂号",items:["门诊时间", "加号流程", "外地患者就医路径"]},
        {title:"住院与复印",items:["住院预约", "病案复印", "医保流程"]},
        {title:"康复随访",items:["日常饮食一般建议", "随访节点", "异常情况处理"]}
      ],
      safeNote:"FAQ 只做流程和科普引导，不替代医生诊断；遇到报告解读、用药调整、治疗决策或急症风险，统一转人工/线下就医。"
    },
    weeklyOps: {
      defaultTopic:"查出胃肠息肉，要不要紧？",
      template:"本周内容先做科普提醒：是否需要进一步检查或处理，需要结合个人年龄、基础病、息肉大小/数量、病理和症状综合判断。群内只做健康教育，不在群里直接判断个人病情。",
      quiz:["长期反酸/上腹不适","有胃肠息肉或肿瘤家族史","体检发现胃肠息肉","以上都可能相关"]
    },
    followupPlans: [
      { key:"endoscopy", name:"胃肠镜检查后随访", scene:"胃肠镜检查后", nodes:[
        {day:0, title:"检查当天", edu:"无痛检查后当天不开车、不饮酒、不独自外出；咽喉麻木消退后先少量温凉水，耐受后过渡软食/半流质。", reminder:"如出现剧烈腹痛、呕血、黑便、发热，请立即就医。", action:"consult"},
        {day:1, title:"检查后第 1 天", edu:"无活检/治疗且无不适者可逐步恢复清淡饮食。", reminder:"留意腹痛、腹胀、便血、恶心呕吐等情况，有异常及时就医。", action:"consult"},
        {day:3, title:"检查后第 3 天", edu:"提醒查看检查报告；若做了活检，请等待病理结果，不要自行解读“息肉/萎缩/肠化/糜烂”等结论。", reminder:"报告/病理有疑问请门诊找医生解读，不在群里做个人病情判断。", action:"consult"},
        {day:7, title:"检查后第 7 天", edu:"提醒收集并上传检查报告与病理结果，由医生判断是否进入 Hp/息肉切除后/萎缩性胃炎等专项随访。", reminder:"门诊复诊看报告，号源紧张可申请加号。", action:"add"}
      ]},
      { key:"polyp", name:"胃肠息肉/结肠息肉切除后随访", scene:"内镜下息肉切除术后", nodes:[
        {day:0, title:"术后当天", edu:"按医嘱禁食或流质；避免剧烈活动、热水澡、饮酒、辛辣；无痛内镜当天不驾车。", reminder:"如出现腹痛、发热、鲜血便、黑便，请立即就医。", action:"consult"},
        {day:1, title:"术后第 1 天", edu:"小息肉按医嘱流质/半流质；大息肉、多发或分片切除者按医生要求更严格休息。", reminder:"确认有无腹痛、发热、鲜血便、黑便，异常及时就医。", action:"consult"},
        {day:3, title:"术后第 3 天", edu:"继续低渣软食，避免重体力活动与用力排便。", reminder:"重点排查迟发出血、腹痛、发热，出现异常立即就医。", action:"consult"},
        {day:7, title:"术后第 7 天", edu:"提醒查看病理结果；复查间隔由病理结果决定，不能只按“切掉了”就结束随访。", reminder:"门诊复诊看病理，可申请加号。", action:"add"},
        {day:14, title:"术后第 14 天", edu:"复核是否仍有便血、腹痛、发热；无异常可逐步恢复正常活动。", reminder:"仍有上述症状请门诊复诊评估。", action:"add"},
        {day:30, title:"术后第 30 天", edu:"建立复查计划：低/中风险按医生建议 1-3 年复查；高风险（肠道准备差、未完成全结肠、息肉很多、>1cm 广基或分片切除、绒毛成分或高级别上皮内瘤变等）常需 3-6 个月或更短，由医生确定。", reminder:"门诊复诊与医生共同确定个体化复查间隔。", action:"add"}
      ]},
      { key:"hp", name:"幽门螺杆菌根除随访", scene:"幽门螺杆菌根除治疗后", nodes:[
        {day:0, title:"开始治疗", edu:"按处方足疗程服药、不自行停药；记录有无过敏、严重腹泻、皮疹或明显不适。", reminder:"出现严重不良反应请及时转医生评估。", action:"consult"},
        {day:3, title:"用药第 3 天", edu:"依从性提醒：确认有无漏服、恶心、口苦、黑便。", reminder:"严重反应转医生处理。", action:"consult"},
        {day:7, title:"用药第 7 天", edu:"疗程中点，坚持完成疗程；避免饮酒。家人若有胃部症状，建议正规检测。", reminder:"按医嘱继续完成疗程。", action:"consult"},
        {day:14, title:"疗程结束", edu:"疗程结束提醒：此时不要马上复查（过早易出现假阴性）。", reminder:"按医嘱停药并等待规定的复查时间。", action:"consult"},
        {day:35, title:"复查准备（结束 ≥4 周后）", edu:"结束治疗至少 4 周后做 13C/14C 呼气试验或医生认可的检测；检测前停 PPI/P-CAB 至少 2 周、停抗生素/铋剂约 4 周。", reminder:"按医嘱安排复查，门诊可申请加号。", action:"add"},
        {day:42, title:"复查后随访", edu:"阴性记录为根除成功；阳性不要自动按二线方案用药，转医生重新评估。", reminder:"复查结果请由医生判读与决策。", action:"add"}
      ]}
    ],
    certifications: ["实名认证 / 执业资质审核通过", "三甲医院主任医师", "医学博士", "可开处方", "中华消化内镜学分会委员", "中华消化内镜学分会结直肠学组委员"],
    servicePackages: [
      { disease:"胃肠息肉", name:"胃肠息肉 · 切除后随访管理", intro:"息肉评估、内镜下切除术后随访与复查间隔管理（复查间隔由病理与医生评估决定）。", items:["consult","add","clinic","followup"] },
      { disease:"幽门螺杆菌", name:"幽门螺杆菌 · 根除随访", intro:"就医引导、足疗程用药随访与停药后复查提醒（呼气试验时机以医嘱为准）。", items:["consult","add","followup"] },
      { disease:"胃肠镜检查", name:"胃肠镜检查后随访", intro:"检查后饮食与观察、报告/病理跟进，并由医生判断是否进入专项随访。", items:["consult","add","clinic","followup"] }
    ],
    menu: { title:"群功能菜单 · 发送对应代号即可", items:[
      {code:"101",label:"医生咨询"},{code:"102",label:"视频问诊"},{code:"103",label:"查看就医相关电话"},{code:"105",label:"查看回复"},{code:"201",label:"挂号及门诊时间"},{code:"301",label:"加号"},{code:"302",label:"住院预约"},{code:"606",label:"学习科普"},{code:"616",label:"了解住院及手术知识"},{code:"626",label:"就医常见问题"},{code:"808",label:"医生简介展示"},{code:"818",label:"医生介绍给亲友"},{code:"909",label:"感谢医生"},{code:"919",label:"评价医生"}
    ]},
    quickKeywords: [{c:"101",l:"咨询"},{c:"102",l:"视频"},{c:"103",l:"电话"},{c:"105",l:"回复"},{c:"201",l:"门诊"},{c:"301",l:"加号"},{c:"302",l:"住院"},{c:"606",l:"科普"},{c:"616",l:"须知"},{c:"626",l:"FAQ"},{c:"808",l:"简介"},{c:"909",l:"感谢"},{c:"1",l:"全部功能"}],
    groupNaming: { pattern:"{医生}医生健康群{序号}" },
    // 群活码（可选）：海报底部嵌入的微信群二维码，data URI（^data:image/(png|jpeg);base64,...）。
    // 空串=不嵌入（海报回退占位二维码）。真实群活码由运维在生产库按医生回填，种子不放测试群二维码。
    groupQrImage: "",
    // 818 真实海报（甲方 2026-07-03 提供，含吕主任照片/简介/群活码，720×1280 JPEG）：站内 /assets/ 相对路径。
    // 患者端 openPoster() 白名单校验（仅 /assets/ 下 jpg/jpeg/png）通过后优先渲染此图；不合法/为空回退生成 SVG 海报。
    // 仅吕富靖已有真实设计海报；黄安华/郭强未提供，字段留空（不设该键）→ 保持现状生成 SVG，向后兼容。
    posterImage: "/assets/lvfujing-818-poster.jpg"
  },
  intro: { opensFaq:true, items:[
    { bot:"小友医助", type:"text", text:"👏您好，欢迎加入吕富靖主任建立的【院外公益健康群】\n⭐点击【医患联络表】提交基础信息，便于医生了解您的情况☑\n⭐“1”😄在群里输入数字，查看所有群功能⭐\n💗点击下方小程序观看吕富靖主任给您的视频问候" },
    { bot:"小友医助", type:"mp", title:"【必看】医生给您留的一段话", sub:"医生风采 · 进群必看", thumb:"mpProfile", page:"doctor-profile" },
    { bot:"小友医助", type:"mp", title:"【必填】医患联络表", sub:"提交基础信息，医助精准跟进", thumb:"mpForm", page:"contact-form" },
    { bot:"小友医助", type:"text", text:"📌 已为您弹出「群友常见问题」，多数问题先看这页就能解决～" }
  ]},
  rules: [
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text——固定话术由发送侧 withConfiguredCodeScript 前插 docx 值（LV_DOCX_SCRIPTS.code101）提供，此处只留卡片响应。
    {code:"101",aliases:["咨询医生","想咨询医生","问医生","找医生看看","向吕主任咨询","怎么咨询","如何咨询","想问医生","想问问医生"],match:"exact",bot:"小消医助",responses:[
      extCard({type:"mp",title:"吕富靖医生主页",sub:"医生咨询 / 1对1 咨询入口",thumb:"mpForm",page:"doctor-profile"}, LV_CY.consultHome),
      {type:"qr",name:"吕富靖 · 北京友谊医院",sub:"消化内科",caption:"亲爱的患友您好：微信扫一扫，和我保持联系",code:"haodaifu"}
    ]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值提供，只留卡片/popup 响应。
    // 102 视频问诊卡（甲方 2026-07-08 晚裁定·覆盖待办6）：改「吕富靖医生主页卡」，复用 101 医生主页短链 5ujZ（LV_CY.videoHome）与 101 同组；
    //   企微原生卡内容由 qiwe_weapp_templates(code=102) 承载（db.js seed_lv_homepage_card_102_404_2026_07_09_v1 从 101 拷贝真机采集封面/同组 hydrate）；page:"video-consult" 患者端 H5 本地承接不变。
    {code:"102",aliases:["视频问诊","想视频问诊","申请视频","怎么视频问诊","视频咨询"],match:"exact",bot:"小消医助",responses:[
      extCard({type:"mp",title:"吕富靖医生主页",sub:"视频问诊入口",thumb:"mpVideo",page:"video-consult"}, LV_CY.videoHome)]},
    {code:"103",aliases:["医院电话","咨询电话","就医相关电话","查看就医相关电话"],match:"exact",bot:"小友医助",responses:[]},
    {code:"105",aliases:["查看回复","我的回复","订单回复","怎么查回复","查看我的回复","有回复了吗"],match:"exact",bot:"小友医助",responses:[
      extCard({type:"mp",title:"查看回复",sub:"春雨医生小程序 · 我的订单/问诊回复",thumb:"mpForm",page:"replies"}, CY.replies)]},
    {code:"201",aliases:["挂号","怎么挂号","想挂号","约门诊","门诊","出诊","挂号方式","怎么约门诊","怎么预约门诊","如何挂号","怎么看门诊"],match:"exact",bot:"小友医助",responses:[
      // 话术统一（甲方 2026-07-09 最新 docx）：201 第二段承载出诊时间地点/加号引导；固定引导语由 code201 前插作第一段。
      {type:"text",text:"吕富靖主任出诊：西城院区周一上午；西城特需周一、周二下午；顺义特需周三下午（以服务号实时为准）。挂号方式：电话预约 010-114；也可点击下方小程序卡，进入北京友谊医院患者服务平台预约挂号。专家号紧张建议提前，或发「301」申请加号👇"},
      // 201 挂号原生卡（沿用 303 友谊医院详情页真机卡）：从「春雨医生主页卡（LV_CY.appointment·企微原生卡由 101 主页短链 5ujZ hydrate·appId wx214b7e2bcde837d6）」
      //   换成「北京友谊医院患者服务平台·吕富靖医生详情页」原生小程序卡（LV_CY.friendshipRegister·appId wxbc8c84999432ac95）；挂号时间地点仍由上方首条文本说明（原样保留）。
      //   真发卡片内容由 qiwe_weapp_templates(code=303) 行承载（db.js seed_lv_friendship_303_card_2026_07_08_v1·真机采集封面三件套 + raw_payload 锁）；type/page/article 不变→患者端本地挂号说明文章承接不变。
      extCard({type:"link",title:"吕富靖主任 · 挂号路径与就诊地址",source:"北京友谊医院服务号",thumb:"hospital",page:"article:clinic"}, LV_CY.friendshipRegister)]},
    // 甲方 2026-07-09 最新 docx：旧 404 加号改为 301。
    {code:"301",aliases:["加号","怎么加号","加个号","能加号吗","想加号","如何加号"],match:"exact",bot:"小消医助",responses:[
      {type:"text",text:"需要加号的患友，请先点击【医患联络表】提交基础信息；完成建档后再提交加号申请，助理会在出诊日前与您电话确认👇"},
      {type:"link",title:"医患联络表（先填写）",desc:"打开服务页提交基础信息",linkUrl:"/?p=contact-form",fallbackPage:"contact-form",deepLink:true},
      {type:"mp",title:"【必填】医患联络表",sub:"先建档，再申请加号",thumb:"mpForm",page:"contact-form"},
      // 301 末卡（沿用 404 主页卡裁定）：改「吕富靖医生主页卡」，复用 101 医生主页短链 5ujZ（LV_CY.booking）与 101 同组；
      //   企微原生卡由 qiwe_weapp_templates(code=404) 承载（db.js seed_lv_homepage_card_102_404_2026_07_09_v1 从 101 拷贝封面/同组 hydrate·替换旧出诊时间地点锁卡）；page:"add-number" 患者端 H5 承接不变；上方门控前三条原样保留。
      extCard({type:"mp",title:"吕富靖医生主页",sub:"预约就诊入口",thumb:"mpAdd",page:"add-number"}, LV_CY.booking)]},
    // 话术统一（甲方 2026-07-09 最新 docx）：旧 414 住院预约改为 302，固定话术由 code302 前插。
    {code:"302",aliases:["住院","住院预约","想住院","要住院","办住院","怎么住院"],match:"exact",bot:"小消医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=admission（住院预约表单），后续上小程序可无缝换卡片。
      // linkUrl 存相对路径（可移植纪律：不硬编码域名，发送侧按 env PUBLIC_ORIGIN 补全绝对 https；web 端同域直开本地页）。
      {type:"link",title:"住院预约（在线填写）",desc:"打开服务页在线提交住院预约",linkUrl:"/?p=admission",fallbackPage:"admission",deepLink:true},
      {type:"mp",title:"住院预约",sub:"问卷收集 · 运营/医助跟进",thumb:"mpBed",page:"admission",external:webLink({provider:"春雨医生",label:"住院预约问卷",service:"住院预约问卷",url:"https://www.chunyuyisheng.com/rec/j1dwloa3ht"}),ctaLabel:"填写住院预约问卷",fallbackPage:"admission"}]},
    // 606 科普：无 scienceArticles 时不预置外链卡（待办#7）；话术由 withConfiguredCodeScript 前插 code606；有内容后由 db 同步重建。
    {code:"606",aliases:["科普","科普专栏"],match:"exact",bot:"小友医助",responses:[]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值提供，只留卡片响应（code616 值已修为「-」=显式关闭，docx 该行「直接弹出链接」是运营操作说明非患者话术）。
    {code:"616",aliases:["住院须知","手术须知","检查须知","住院手术"],match:"exact",bot:"小友医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=article:surgery（手术/住院须知文章），页内医院官网/公众号外链保留不动。
      {type:"link",title:"手术 / 住院须知",desc:"打开服务页查看检查、住院前后须知",linkUrl:"/?p=article:surgery",fallbackPage:"article:surgery",deepLink:true},
      {type:"link",title:"检查 / 住院前后须知（一般性）",source:"科室宣教资料 · 运营整理",thumb:"mpBed",page:"article:surgery"},
      {type:"link",title:"住院办理流程",source:"北京友谊医院官网",thumb:"hospital",external:webLink({provider:"北京友谊医院官网",label:"住院办理流程",url:"https://www.bfh.com.cn/Html/News/Articles/5419.html"}),ctaLabel:"打开医院官网",fallbackPage:"article:surgery"},
      {type:"link",title:"医保政策温馨问答",source:"北京友谊医院官网",thumb:"hospital",external:webLink({provider:"北京友谊医院官网",label:"医保政策温馨问答",url:"https://www.bfh.com.cn/Html/News/Articles/5049.html"}),ctaLabel:"打开医院官网",fallbackPage:"article:surgery"},
      {type:"link",title:"住院患者告知书",source:"北京友谊医院官网",thumb:"hospital",external:webLink({provider:"北京友谊医院官网",label:"住院患者告知书",url:"https://www.bfh.com.cn/Html/News/Articles/203280.html"}),ctaLabel:"打开医院官网",fallbackPage:"article:surgery"},
      {type:"link",title:"【友谊科普】手术前为什么要“饿肚子”？一篇给您讲明白",source:"北京友谊医院服务号",thumb:"mpScience",external:webLink({provider:"北京友谊医院服务号",label:"手术前为什么要“饿肚子”",url:"https://mp.weixin.qq.com/s/EraiHHJrtym62BBBjyrwYQ"}),ctaLabel:"打开公众号文章",fallbackPage:"article:surgery"}]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值提供，只留卡片响应（code626 值已修为「-」=显式关闭，docx 该行「直接弹出链接」是运营操作说明非患者话术）。
    {code:"626",aliases:["常见问题","群友常见问题","FAQ"],match:"exact",bot:"小友医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=faq（群友常见问题），页内公众号/医院官网外链保留不动。
      {type:"link",title:"群友常见问题",desc:"打开服务页查看挂号/加号/住院/复印/康复 FAQ",linkUrl:"/?p=faq",fallbackPage:"faq",deepLink:true},
      {type:"mp",title:"群友常见问题",sub:"挂号/加号/住院/复印/康复 FAQ",thumb:"mpScience",page:"faq"},
      {type:"link",title:"【就诊指南】北京友谊医院异地医保患者就医攻略与常见问题解答",source:"北京友谊医院服务号",thumb:"mpScience",external:webLink({provider:"北京友谊医院服务号",label:"异地医保就医攻略与常见问题",url:"https://mp.weixin.qq.com/s/gmA7fYNVMIhrPlapQ8eFRQ"}),ctaLabel:"打开公众号文章",fallbackPage:"faq"},
      {type:"link",title:"门诊就诊须知",source:"北京友谊医院官网",thumb:"hospital",external:webLink({provider:"北京友谊医院官网",label:"门诊就诊须知",url:"https://www.bfh.com.cn/Html/News/Columns/180/Index.html"}),ctaLabel:"打开医院官网",fallbackPage:"faq"}]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值提供，只留卡片响应（code808 值已修为「-」=显式关闭，docx 该行「直接弹出链接」是运营操作说明非患者话术）。
    {code:"808",aliases:["医生简介","医生介绍","医生主页"],match:"exact",bot:"小友医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=doctor-profile（医生风采页），春雨主页外链保留不动。
      {type:"link",title:"吕富靖主任 · 医生风采",desc:"打开服务页查看医生简介与资质",linkUrl:"/?p=doctor-profile",fallbackPage:"doctor-profile",deepLink:true},
      // 808 医生风采卡（甲方 2026-07-06 改）：从旧「医生主页 doctor-profile 卡(appId wx214b7e2bcde837d6·5ujZ 短链)」换成「h5_webview·config_id=2515 卡(appId wx2e72ecb9760b913c)」；封面三件套由 qiwe_weapp_templates 行承载（db.js seed_lv_weapp_cards_2026_07_06_v1）。
      extCard({type:"mp",title:"吕富靖主任 · 医生风采",sub:"春雨医生风采页 · 复制到微信内打开，本地风采兜底",thumb:"mpProfile",page:"doctor-profile"}, LV_CY.profileWebview),
      {type:"link",title:"吕富靖主任 · 春雨主页（网页直开）",sub:"春雨医生落地页 · 浏览器/微信内可直接打开",thumb:"mpProfile",external:webLink({provider:"春雨医生",label:"吕富靖医生主页",service:"医生主页落地页",url:"https://www.chunyuyisheng.com/events/special/?config_id=2515"}),ctaLabel:"打开春雨主页",fallbackPage:"doctor-profile"}]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值（code818 转发海报感谢）提供，只留海报图片响应。
    {code:"818",aliases:["介绍给亲友","推荐","海报"],match:"exact",bot:"小消医助",responses:[
      {type:"image",svg:"poster",page:"poster"}]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值（code909 感谢信任）提供，只留送心意卡片响应。
    {code:"909",aliases:["感谢医生","送心意","感谢","想感谢医生","怎么感谢","感谢吕主任"],match:"exact",bot:"小友医助",responses:[
      extCard({type:"mp",title:"感谢医生 / 春雨送心意",sub:"春雨送心意 · 原生卡片直达",thumb:"mpHeart",page:"thank-doctor"}, LV_CY.sendHeart)]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text（及末尾「温馨提示·平台规则」旁白，甲方口径老话术全删），固定话术由 withConfiguredCodeScript 前插 docx 值（code919 分享就医感受）提供，只留评价入口卡。
    {code:"919",aliases:["评价","分享经验","好评"],match:"exact",bot:"小友医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=review（分享就医经验页），春雨评价问卷外链保留不动。
      {type:"link",title:"分享我的就医经验",desc:"打开服务页填写评价与就医经验",linkUrl:"/?p=review",fallbackPage:"review",deepLink:true},
      // 919 企微原生小程序卡触发位（甲方 2026-07-06）：无 external → 过 nativeWeappAllowedResponse（非 fallback_short_link）；封面三件套由 qiwe_weapp_templates 行承载
      //   （db.js seed_lv_weapp_cards_2026_07_06_v1，appId wx2e72ecb9760b913c·h5_webview·questionnaire/7108）。page:"review" 供患者端 H5 本地承接。
      {type:"mp",title:"评价吕富靖主任",sub:"填写评价与就医经验",thumb:"star",page:"review"},
      {type:"link",title:"先填写评价问卷",sub:"春雨问卷 · 在线评价",thumb:"star",external:webLink({provider:"春雨医生",label:"评价问卷",service:"医生评价问卷",url:"https://www.chunyuyisheng.com/rec/ujv9r36u27"}),ctaLabel:"先填写评价问卷",fallbackPage:"review"}]},
    {code:"707",aliases:["饮食","日常饮食","饮食指导","饮食建议"],match:"exact",bot:"小友医助",responses:[
      {type:"text",text:"消化道常见病的日常饮食有一些一般性建议👇 点击查看，具体忌口请遵主治医生意见。"},
      {type:"link",title:"消化道常见病 · 日常饮食一般建议",source:"健康科普（一般性，不替代诊疗）",thumb:"diet",page:"article:diet"}]},
    {code:"717",aliases:["复印","病案复印","复印病历"],match:"exact",bot:"小友医助",responses:[
      {type:"text",text:"需要复印病历 / 病案的患友，按以下指引办理即可👇"},
      {type:"link",title:"病案 / 病历复印 办理指引",source:"北京友谊医院服务号（待核对）",thumb:"copy",page:"article:copy"}]},
    // 话术统一（甲方 2026-07-08）：删旧口语化引导 text，固定话术由 withConfiguredCodeScript 前插 docx 值（code979 / code联络表）提供，只留联络表卡片响应。
    {code:"979",aliases:["医患联络表","建档","联络表"],match:"exact",bot:"小友医助",responses:[
      // 域名深链卡（甲方 2026-07-03）：落我们自己的 H5 页 /?p=contact-form（医患联络表），春雨建档问卷外链保留不动。
      {type:"link",title:"医患联络表（在线填写）",desc:"打开服务页提交基础信息",linkUrl:"/?p=contact-form",fallbackPage:"contact-form",deepLink:true},
      {type:"mp",title:"【必填】医患联络表",sub:"提交基础信息",thumb:"mpForm",page:"contact-form"},
      {type:"link",title:"春雨建档问卷",sub:"春雨问卷 · 在线提交建档信息",thumb:"mpForm",external:webLink({provider:"春雨医生",label:"春雨建档问卷",service:"医患联络/建档问卷",url:"https://www.chunyuyisheng.com/rec/97sj59n1e5"}),ctaLabel:"填写春雨建档问卷",fallbackPage:"contact-form"}]}
  ],
  faq: [
    {grp:"看病就医",q:"怎么找吕主任看病？",a:"发送 201 查看出诊时间与挂号方式；号源紧张可发 301 申请加号。",sort:1},
    {grp:"看病就医",q:"外地患者怎么办？",a:"可先发 101 进行 1对1 图文咨询；确需进一步检查/治疗可发 302 预约住院。",sort:2},
    {grp:"群内服务",q:"群里的数字代号都是什么？",a:"101咨询、102视频、103电话、105查看回复、201门诊、301加号、302住院、606科普、616住院及手术知识、626常见问题、808简介、818推荐、909感谢、919评价。发 1 看完整菜单。",sort:3},
    {grp:"康复与随访",q:"日常饮食要注意什么？",a:"发送 707 或「饮食」查看消化道常见病日常饮食一般建议；具体忌口请遵主治医生意见。",sort:4},
    {grp:"康复与随访",q:"怎么复印病历？",a:"发送 717 或「复印」查看病案复印办理指引。",sort:5}
  ]
};

/* 周玉春（中医男科 · 江苏省中医院）：测试环境医生。
   主页短链 LgKHxRiHTqKDfVp → 101/102/301/909 发春雨主页小程序卡（同组 hydrate）；
   105 → 春雨「我的订单」短链（可复用已采集 all_service 原生模板）；
   103/201 → 医院小程序短链（mp 规则；原生卡需对该短链真机采集封面后就绪）；
   问卷 / 公众号文章仍以 link 下发。 */
const ZHOU_WELCOME = "您好，欢迎加入周玉春主任建立的【院外公益健康群】👏\n\n⭐点击【医患联络表】提交基础信息，便于医生了解您的情况☑\n\n⭐在群里输入数字 “1”，查看所有群功能😄\n\n⭐点击下方卡片观看周玉春主任给您的视频问候💗";
const ZHOU_CONTACT_URL = "https://yht.chunyutianxia.com/i/gMeulR5LbkMt";
const ZHOU_ADMISSION_URL = "https://www.chunyuyisheng.com/rec/e0bevagis9";
const ZHOU_REVIEW_URL = "https://www.chunyuyisheng.com/rec/kp7cvoqzge";
const ZHOU_MP_PHONE = "#小程序://江苏省中医院互联网医院/mBufUFUrvgczv6m";
const ZHOU_MP_REGISTER = "#小程序://江苏省中医院互联网医院/IewVyHslsxnrARy";
const ZHOU_MP_FAQ_A = "#小程序://江苏省中医院互联网医院/mBufUFUrvgczv6m";
const ZHOU_MP_FAQ_B = "#小程序://江苏省中医院互联网医院/qGrZhZvoQemhnGw";
const ZHOU_SURGERY_ARTICLE = "https://mp.weixin.qq.com/s/3OPSFkck65aPnCNqsNwnsQ";
const ZHOU_MY_ORDERS = "#小程序://春雨医生/PuW00A6zBsHAw9y";
/** 与 101/102/301/909 共用主页短链的编号（配置中心改短链时同步刷新） */
const ZHOU_HOME_MP_CODES = ["101", "102", "301", "909"];
const ZHOU_CY = {
  consultHome: withShortLink(CY.graphConsult, CHUNYU_SHORT_LINKS.zhouDoctor, {
    label: "周玉春医生春雨主页",
    mode: "mini_program",
    service: "医生主页 / 图文咨询 / 电话咨询",
    appId: "wx2e72ecb9760b913c",
    username: "gh_681d3fd5683f@app",
    originalId: "gh_681d3fd5683f@app",
    urlTemplate: "",
    requires: ["医生主页 Short Link 已采集", "企微原生卡封面需对该短链采集一次"],
    note: "用于 101 咨询：周玉春医生主页 Short Link；小程序短链需在微信内打开。"
  }),
  videoHome: withShortLink(CY.video, CHUNYU_SHORT_LINKS.zhouDoctor, {
    label: "周玉春医生春雨主页",
    service: "医生主页 / 视频问诊入口",
    appId: "wx2e72ecb9760b913c",
    username: "gh_681d3fd5683f@app",
    originalId: "gh_681d3fd5683f@app",
    requires: ["医生主页 Short Link 已采集（与 101 同组）"],
    note: "用于 102：进入周玉春主页后选择视频问诊。"
  }),
  appointment: withShortLink(CY.expertAppointment, CHUNYU_SHORT_LINKS.zhouDoctor, {
    label: "周玉春医生春雨主页",
    service: "医生主页 / 预约就诊",
    appId: "wx2e72ecb9760b913c",
    username: "gh_681d3fd5683f@app",
    originalId: "gh_681d3fd5683f@app",
    requires: ["医生主页 Short Link 已采集（与 101 同组）"],
    note: "用于 301 加号：进入主页后选择预约就诊。"
  }),
  sendHeart: withShortLink(CY.graphConsult, CHUNYU_SHORT_LINKS.zhouDoctor, {
    label: "周玉春医生春雨主页",
    mode: "mini_program",
    service: "医生主页 / 送心意入口",
    appId: "wx2e72ecb9760b913c",
    username: "gh_681d3fd5683f@app",
    originalId: "gh_681d3fd5683f@app",
    urlTemplate: "",
    requires: ["暂无送心意页面级短链，先进主页再点送心意"],
    note: "用于 909：主页入口，进入后点送心意。"
  })
};

const WANG_WELCOME = "您好，欢迎加入王云程主任建立的【院外公益健康群】👏\n\n⭐点击【医患联络表】提交基础信息，便于医生了解您的情况☑\n\n⭐在群里输入数字 “1”，查看所有群功能😄\n\n⭐点击下方卡片观看王云程主任给您的视频问候💗";
const WANG_HOME_SHORT_LINK = "#小程序://春雨医生/T2ZrR81CrFmWgfG";
const WANG_CONTACT_URL = "https://yht.chunyutianxia.com/i/o6G-jhQiZwCI";
const WANG_REGISTER_URL = "https://h5.app.bjdxzxy.com/";
const WANG_ADMISSION_URL = "https://www.chunyuyisheng.com/rec/lsx2qjqsu6";
const WANG_REVIEW_URL = "https://www.chunyuyisheng.com/rec/sewaya7aqe";
const WANG_HOSPITAL_PHONE = "010-67992043";
const WANG_SURGERY_ARTICLE = "https://www.bjdxzxy.com/content/details54_264.html";
const WANG_FAQ_A = "https://www.bjdxzxy.com/service/must.html";
const WANG_FAQ_B = "https://www.bjdxzxy.com/service/insurance.html";
const WANG_HOME_MP_CODES = ["101", "102", "301", "808", "909"];
const WANG_CY = {
  consultHome: withShortLink(CY.graphConsult, { shortLink: WANG_HOME_SHORT_LINK, scope: "王云程医生主页" }, {
    label: "王云程医生春雨主页",
    mode: "mini_program",
    service: "医生主页 / 图文咨询 / 电话咨询",
    note: "用于 101 咨询：王云程医生主页短链。"
  }),
  videoHome: withShortLink(CY.video, { shortLink: WANG_HOME_SHORT_LINK, scope: "王云程医生主页" }, {
    label: "王云程医生春雨主页",
    service: "医生主页 / 视频问诊入口",
    note: "用于 102：进入王云程主页后选择视频问诊。"
  }),
  appointment: withShortLink(CY.expertAppointment, { shortLink: WANG_HOME_SHORT_LINK, scope: "王云程医生主页" }, {
    label: "王云程医生春雨主页",
    service: "医生主页 / 预约就诊",
    note: "用于 301 加号：进入主页后选择预约就诊。"
  }),
  doctorHome: withShortLink(CY.graphConsult, { shortLink: WANG_HOME_SHORT_LINK, scope: "王云程医生主页" }, {
    label: "王云程医生春雨主页",
    mode: "mini_program",
    service: "医生主页 / 医生简介展示",
    note: "用于 808/818：王云程医生主页短链。"
  }),
  sendHeart: withShortLink(CY.graphConsult, { shortLink: WANG_HOME_SHORT_LINK, scope: "王云程医生主页" }, {
    label: "王云程医生春雨主页",
    mode: "mini_program",
    service: "医生主页 / 感谢医生入口",
    note: "用于 909：先进入主页，再点感谢/送心意。"
  })
};

const zhouyuchun = {
  slug: "zhouyuchun", active: 1,
  name: "周玉春", title: "主任医师",
  hospital: "江苏省中医院", dept: "中医男科",
  specialty: "中医男科",
  group_name: "周玉春主任健康群①", member_count: 0,
  scope_note: "院外公益健康群（测试）", hospital_phone: "",
  bots: ["小周医助"],
  clinic: { place: "江苏省中医院", times: ["以医院官方挂号平台实时号源为准"] },
  accounts: [
    { platform: "抖音", handle: "中医男科周玉春", icon: "📱" },
    { platform: "小红书", handle: "中医男科周玉春", icon: "📕" },
    { platform: "百家号", handle: "中医男科周玉春", icon: "📰" },
    { platform: "快手", handle: "中医男科周玉春", icon: "🎬" }
  ],
  content: {
    disclaimer: "本群为院外公益健康群，群内沟通不能替代线下面诊；急症请及时到正规医院就诊。",
    consentText: "处理目的：用于本医生健康群的患者建档、随访提醒与医助联系。\n处理范围：姓名、手机号、病情简述等您主动提交的信息。\n您的权利：可申请查阅、更正、删除或撤回同意。",
    chunyuIntegration: {
      status: "周玉春医生主页 Short Link 已配置；企微原生卡待对该短链采集封面后就绪。",
      defaultMiniProgram: {
        appId: "wx214b7e2bcde837d6",
        originalId: "待春雨提供 gh_xxx",
        path: "pages/open_login/index?token={token}&session_id={session_id}",
        shortLink: CHUNYU_SHORT_LINKS.zhouDoctor.shortLink,
        shortLinkScope: CHUNYU_SHORT_LINKS.zhouDoctor.scope
      },
      doctorHomeShortLink: CHUNYU_SHORT_LINKS.zhouDoctor.shortLink,
      homeMpCodes: ZHOU_HOME_MP_CODES
    },
    // 818 真实海报（甲方 2026-08-04 提供）：站内 /assets/ 相对路径。
    posterImage: "/assets/zhouyuchun-818-poster.jpg",
    // 入群欢迎视频页（极简 H5 + 企微链接卡）；有此配置则入群发 979 联络表 + 视频卡（不发 808）。
    welcomeVideo: {
      pagePath: "/welcome-video/zhou.html",
      cardTitle: "周玉春主任视频问候",
      cardDesc: "点击观看",
      iconUrl: ""
    },
    contactForm: {
      title: "医患联络表",
      desc: "提交基础信息，便于医生了解您的情况。",
      externalUrl: ZHOU_CONTACT_URL,
      fields: [
        { key: "name", label: "姓名", type: "text", required: true, err: "请填写姓名" },
        { key: "phone", label: "手机号", type: "tel", required: true, err: "请输入正确手机号", pattern: "^1[3-9]\\d{9}$" },
        { key: "disease", label: "主要疾病/主诉", type: "text", required: true, err: "请填写主要疾病" }
      ],
      submitText: "前往填写",
      success: { title: "请在打开的页面完成填写", desc: "提交后医助会跟进。" }
    },
    menu: {
      title: "群功能菜单",
      items: [
        { code: "101", label: "医生咨询" },
        { code: "102", label: "视频问诊" },
        { code: "103", label: "就医相关电话" },
        { code: "105", label: "查看回复" },
        { code: "201", label: "挂号及门诊时间" },
        { code: "301", label: "加号" },
        { code: "302", label: "住院预约" },
        { code: "606", label: "学习科普" },
        { code: "616", label: "住院及手术知识" },
        { code: "626", label: "就医常见问题" },
        { code: "818", label: "医生介绍给亲友" },
        { code: "909", label: "感谢医生" },
        { code: "919", label: "评价医生" },
        { code: "979", label: "医患联络表" }
      ]
    },
    quickKeywords: [
      { c: "101", l: "咨询" },
      { c: "201", l: "挂号" },
      { c: "1", l: "全部功能" }
    ]
  },
  intro: {
    opensFaq: false,
    items: [
      { bot: "小周医助", type: "text", text: ZHOU_WELCOME },
      {
        type: "link",
        title: "医患联络表",
        sub: "提交基础信息",
        thumb: "mpForm",
        external: webLink({ provider: "春雨医生", label: "医患联络表", service: "建档问卷", url: ZHOU_CONTACT_URL }),
        ctaLabel: "填写联络表",
        fallbackPage: "contact-form"
      }
    ]
  },
  rules: [
    { code: "101", aliases: ["咨询医生", "想咨询医生", "问医生", "怎么咨询", "如何咨询", "向周主任咨询"], match: "exact", bot: "小周医助", responses: [
      extCard({ type: "mp", title: "周玉春医生主页", sub: "医生咨询 / 1对1 咨询入口", thumb: "mpForm", page: "doctor-profile" }, ZHOU_CY.consultHome)
    ]},
    { code: "102", aliases: ["视频问诊", "视频咨询", "申请视频问诊"], match: "exact", bot: "小周医助", responses: [
      extCard({ type: "mp", title: "周玉春医生主页", sub: "视频问诊入口", thumb: "mpVideo", page: "video-consult" }, ZHOU_CY.videoHome)
    ]},
    {
      code: "103", aliases: ["医院电话", "就医电话", "咨询电话"], match: "exact", bot: "小周医助",
      // 医院小程序原生卡：规则用 mp+短链；企微贴片需对该短链真机采集一次封面三件套后就绪。
      responses: [extCard({ type: "mp", title: "就医相关电话", sub: "江苏省中医院互联网医院", thumb: "mpForm", page: "hospital-phone" }, withShortLink(chunyuExternal({
        label: "江苏省中医院 · 就医电话", mode: "mini_program", service: "就医相关电话",
        note: "医院官方小程序短链；原生卡待真机采集。"
      }), { shortLink: ZHOU_MP_PHONE, scope: "江苏省中医院互联网医院 · 电话" }))]
    },
    {
      code: "105", aliases: ["查看回复", "我的订单", "看回复"], match: "exact", bot: "小周医助",
      // 与吕/王同口径：春雨「我的全部服务/我的订单」短链；生产可直接复用已采集的 all_service 原生模板。
      responses: [extCard({ type: "mp", title: "查看回复", sub: "春雨医生小程序 · 我的订单/问诊回复", thumb: "mpForm", page: "replies" }, CY.replies)]
    },
    {
      code: "201", aliases: ["挂号", "门诊", "出诊时间", "挂号及门诊时间"], match: "exact", bot: "小周医助",
      responses: [extCard({ type: "mp", title: "挂号及门诊时间", sub: "江苏省中医院互联网医院", thumb: "hospital", page: "hospital-register" }, withShortLink(chunyuExternal({
        label: "江苏省中医院 · 挂号", mode: "mini_program", service: "挂号及门诊时间",
        note: "医院官方挂号短链；原生卡待真机采集。"
      }), { shortLink: ZHOU_MP_REGISTER, scope: "江苏省中医院互联网医院 · 挂号" }))]
    },
    { code: "301", aliases: ["加号", "门诊加号", "申请加号"], match: "exact", bot: "小周医助", responses: [
      extCard({ type: "mp", title: "周玉春医生主页", sub: "预约就诊 / 加号入口", thumb: "mpForm", page: "add-number" }, ZHOU_CY.appointment)
    ]},
    {
      code: "302", aliases: ["住院", "住院预约", "申请住院"], match: "exact", bot: "小周医助",
      responses: [{
        type: "link", title: "住院申请表", sub: "春雨问卷 · 在线填写",
        external: webLink({ provider: "春雨医生", label: "住院申请表", url: ZHOU_ADMISSION_URL }),
        ctaLabel: "填写住院申请表", fallbackPage: "admission"
      }]
    },
    { code: "606", aliases: ["科普", "学习科普", "科普专栏"], match: "exact", bot: "小周医助", responses: [] },
    {
      code: "616", aliases: ["住院及手术", "手术知识", "了解住院及手术知识"], match: "exact", bot: "小周医助",
      responses: [{
        type: "link", title: "住院及手术知识", source: "微信公众号",
        external: webLink({ provider: "微信公众号", label: "住院及手术知识", url: ZHOU_SURGERY_ARTICLE }),
        ctaLabel: "打开文章", fallbackPage: "article:surgery"
      }]
    },
    {
      code: "626", aliases: ["常见问题", "就医常见问题", "FAQ"], match: "exact", bot: "小周医助",
      // 文案 + 两张医院小程序贴片（模板码 626a/626b；626a 与 103 同短链可复用封面，626b 需对该短链采集一次）。
      responses: [
        { type: "text", text: "就医常见问题入口：" },
        extCard({ type: "mp", title: "就医常见问题①", sub: "江苏省中医院互联网医院", thumb: "mpForm", page: "faq-a", weappCode: "626a" }, withShortLink(chunyuExternal({
          label: "江苏省中医院 · 常见问题①", mode: "mini_program", service: "就医常见问题",
          note: "医院官方小程序短链；与 103 同链时可复用封面。"
        }), { shortLink: ZHOU_MP_FAQ_A, scope: "江苏省中医院互联网医院 · FAQ①" })),
        extCard({ type: "mp", title: "就医常见问题②", sub: "江苏省中医院互联网医院", thumb: "mpForm", page: "faq-b", weappCode: "626b" }, withShortLink(chunyuExternal({
          label: "江苏省中医院 · 常见问题②", mode: "mini_program", service: "就医常见问题",
          note: "医院官方小程序短链；原生卡需对该短链真机采集一次。"
        }), { shortLink: ZHOU_MP_FAQ_B, scope: "江苏省中医院互联网医院 · FAQ②" }))
      ]
    },
    // 818：固定话术由 code818 前插；海报真图走 content.posterImage。
    { code: "818", aliases: ["介绍给亲友", "推荐", "海报"], match: "exact", bot: "小周医助", responses: [
      { type: "image", svg: "poster", page: "poster" }
    ]},
    { code: "909", aliases: ["感谢医生", "送心意", "感谢", "感谢周主任"], match: "exact", bot: "小周医助", responses: [
      extCard({ type: "mp", title: "周玉春医生主页", sub: "感谢医生 / 送心意入口", thumb: "mpHeart", page: "thank-doctor" }, ZHOU_CY.sendHeart)
    ]},
    {
      code: "919", aliases: ["评价", "评价医生", "分享经验"], match: "exact", bot: "小周医助",
      responses: [{
        type: "link", title: "分享就医感受", sub: "春雨问卷",
        external: webLink({ provider: "春雨医生", label: "评价问卷", url: ZHOU_REVIEW_URL }),
        ctaLabel: "填写评价", fallbackPage: "review"
      }]
    },
    {
      code: "979", aliases: ["医患联络表", "建档", "联络表"], match: "exact", bot: "小周医助",
      responses: [{
        type: "link", title: "医患联络表", sub: "提交基础信息",
        external: webLink({ provider: "春雨医生", label: "医患联络表", url: ZHOU_CONTACT_URL }),
        ctaLabel: "填写联络表", fallbackPage: "contact-form"
      }]
    }
  ],
  faq: [
    { grp: "看病就医", q: "怎么找周主任看病？", a: "发送 201 查看挂号入口；需要咨询可发 101。", sort: 1 },
    { grp: "群内服务", q: "群里数字代号是什么？", a: "发 1 查看完整功能菜单。", sort: 2 }
  ]
};

const wangyuncheng = {
  slug: "wangyuncheng", active: 0,
  name: "王云程", title: "主任医师",
  hospital: "北京市大兴区中西医结合医院", dept: "骨科",
  specialty: "骨科相关疾病诊疗",
  group_name: "王云程主任院外公益健康群", member_count: 0,
  scope_note: "院外公益健康群", hospital_phone: WANG_HOSPITAL_PHONE,
  bots: ["小王医助"],
  clinic: { place: "北京市大兴区中西医结合医院骨科门诊", times: ["以医院官方挂号平台实时信息为准"] },
  accounts: [
    { platform: "抖音", handle: "骨科王云程", icon: "📱" },
    { platform: "小红书", handle: "骨科王云程", icon: "📕" }
  ],
  content: {
    disclaimer: "本群为院外公益健康群，群内沟通不能替代线下面诊；如情况紧急，请及时到医院就诊。",
    consentText: "处理目的：用于本医生健康群的患者建档、随访提醒与医助联系。\n处理范围：姓名、手机号、病情简述等您主动提交的信息。\n您的权利：可申请查阅、更正、删除或撤回同意。",
    chunyuIntegration: {
      status: "王云程医生主页短链已配置；主页类编号统一承接到该春雨小程序入口。",
      defaultMiniProgram: {
        appId: "wx214b7e2bcde837d6",
        originalId: "待春雨提供 gh_xxx",
        path: "pages/open_login/index?token={token}&session_id={session_id}",
        shortLink: WANG_HOME_SHORT_LINK,
        shortLinkScope: "王云程医生主页"
      },
      doctorHomeShortLink: WANG_HOME_SHORT_LINK,
      homeMpCodes: WANG_HOME_MP_CODES
    },
    // 818 真实海报（甲方 2026-08-04 提供）：站内 /assets/ 相对路径。
    posterImage: "/assets/wangyuncheng-818-poster.jpg",
    // 入群欢迎视频页（极简 H5 + 企微链接卡）；有此配置则入群发 979 联络表 + 视频卡（不发 808）。
    welcomeVideo: {
      pagePath: "/welcome-video/wang.html",
      cardTitle: "王云程主任视频问候",
      cardDesc: "点击观看",
      iconUrl: ""
    },
    contactForm: {
      title: "医患联络表",
      desc: "提交基础信息，便于医生了解您的情况。",
      externalUrl: WANG_CONTACT_URL,
      fields: [
        { key: "name", label: "姓名", type: "text", required: true, err: "请填写姓名" },
        { key: "phone", label: "手机号", type: "tel", required: true, err: "请输入正确手机号", pattern: "^1[3-9]\\d{9}$" },
        { key: "disease", label: "主要疾病/主诉", type: "text", required: true, err: "请填写主要疾病" }
      ],
      submitText: "前往填写",
      success: { title: "请完成联络表填写", desc: "提交后医助会跟进。" }
    },
    menu: { title: "群功能菜单", items: [
      { code: "101", label: "医生咨询" }, { code: "102", label: "视频问诊" }, { code: "103", label: "查看就医相关电话" },
      { code: "105", label: "查看回复" }, { code: "201", label: "挂号及门诊时间" }, { code: "301", label: "加号" },
      { code: "302", label: "住院预约" }, { code: "606", label: "学习科普" }, { code: "616", label: "了解住院及手术知识" },
      { code: "626", label: "就医常见问题" }, { code: "808", label: "医生简介展示" }, { code: "818", label: "医生介绍给亲友" },
      { code: "909", label: "感谢医生" }, { code: "919", label: "评价医生" },
      { code: "979", label: "医患联络表" }
    ]},
    quickKeywords: [
      { c: "101", l: "咨询" }, { c: "102", l: "视频" }, { c: "103", l: "电话" }, { c: "105", l: "回复" },
      { c: "201", l: "门诊" }, { c: "301", l: "加号" }, { c: "302", l: "住院" }, { c: "606", l: "科普" },
      { c: "616", l: "须知" }, { c: "626", l: "FAQ" }, { c: "808", l: "简介" }, { c: "909", l: "感谢" }, { c: "1", l: "全部功能" }
    ]
  },
  intro: {
    opensFaq: false,
    items: [
      { bot: "小王医助", type: "text", text: WANG_WELCOME },
      extCard({ type: "mp", title: "王云程主任主页", sub: "进群必看 / 医生介绍", thumb: "mpProfile", page: "doctor-profile" }, WANG_CY.doctorHome),
      { bot: "小王医助", type: "mp", title: "医患联络表", sub: "提交基础信息", thumb: "mpForm", page: "contact-form" }
    ]
  },
  rules: [
    { code: "101", aliases: ["咨询医生", "想咨询医生", "问医生", "怎么咨询", "如何咨询", "向王主任咨询"], match: "exact", bot: "小王医助", responses: [
      extCard({ type: "mp", title: "王云程医生主页", sub: "医生咨询 / 1对1 咨询入口", thumb: "mpForm", page: "doctor-profile" }, WANG_CY.consultHome)
    ]},
    { code: "102", aliases: ["视频问诊", "视频咨询", "申请视频问诊"], match: "exact", bot: "小王医助", responses: [
      extCard({ type: "mp", title: "王云程医生主页", sub: "视频问诊入口", thumb: "mpVideo", page: "video-consult" }, WANG_CY.videoHome)
    ]},
    // 103：固定话术由 ops code103 前插（医院电话+科室电话）；规则不再重复发 text，避免叠字。
    { code: "103", aliases: ["医院电话", "就医电话", "咨询电话"], match: "exact", bot: "小王医助", responses: [] },
    // 105：与周/吕同口径，春雨「我的订单」短链；生产复用已采集 all_service 原生模板即可发卡。
    { code: "105", aliases: ["查看回复", "我的订单", "看回复"], match: "exact", bot: "小王医助", responses: [extCard({ type: "mp", title: "查看回复", sub: "春雨医生小程序 · 我的订单/问诊回复", thumb: "mpForm", page: "replies" }, CY.replies)] },
    // 201：引导语由 code201 前插；贴片为医院官方挂号 H5 链接卡（不再发春雨小程序卡）。
    { code: "201", aliases: ["挂号", "门诊", "出诊时间", "挂号及门诊时间"], match: "exact", bot: "小王医助", responses: [
      { type: "link", title: "挂号及门诊时间", sub: "大兴区中西医结合医院官方挂号", external: webLink({ provider: "大兴区中西医结合医院", label: "官方挂号", url: WANG_REGISTER_URL }), ctaLabel: "打开挂号", fallbackPage: "clinic-register" }
    ] },
    { code: "301", aliases: ["加号", "门诊加号", "申请加号"], match: "exact", bot: "小王医助", responses: [extCard({ type: "mp", title: "王云程医生主页", sub: "预约就诊 / 加号入口", thumb: "mpForm", page: "add-number" }, WANG_CY.appointment)] },
    { code: "302", aliases: ["住院", "住院预约", "申请住院"], match: "exact", bot: "小王医助", responses: [{ type: "link", title: "住院申请表", sub: "春雨问卷 · 在线填写", external: webLink({ provider: "春雨医生", label: "住院申请表", url: WANG_ADMISSION_URL }), ctaLabel: "填写住院申请表", fallbackPage: "admission" }] },
    { code: "606", aliases: ["科普", "学习科普", "科普专栏"], match: "exact", bot: "小王医助", responses: [] },
    { code: "616", aliases: ["住院须知", "手术须知", "了解住院及手术知识"], match: "exact", bot: "小王医助", responses: [{ type: "link", title: "住院及手术知识", source: "医院官网", external: webLink({ provider: "医院官网", label: "住院及手术知识", url: WANG_SURGERY_ARTICLE }), ctaLabel: "打开文章", fallbackPage: "article:surgery" }] },
    // 626：引导文案 + 两张医院官网链接卡（不再把 URL 打进正文）。
    { code: "626", aliases: ["常见问题", "就医常见问题", "FAQ"], match: "exact", bot: "小王医助", responses: [
      { type: "text", text: "就医常见问题入口：" },
      { type: "link", title: "就医常见问题", sub: "门诊就诊须知", external: webLink({ provider: "大兴区中西医结合医院", label: "就医常见问题", url: WANG_FAQ_A }), ctaLabel: "打开须知", fallbackPage: "faq" },
      { type: "link", title: "医保相关说明", sub: "医院官网医保说明", external: webLink({ provider: "大兴区中西医结合医院", label: "医保相关说明", url: WANG_FAQ_B }), ctaLabel: "打开说明", fallbackPage: "faq-insurance" }
    ] },
    { code: "808", aliases: ["医生简介", "医生介绍", "医生主页"], match: "exact", bot: "小王医助", responses: [extCard({ type: "mp", title: "王云程主任主页", sub: "医生简介展示", thumb: "mpProfile", page: "doctor-profile" }, WANG_CY.doctorHome)] },
    // 818：固定话术由 code818 前插；海报真图走 content.posterImage（与吕同口径）。
    { code: "818", aliases: ["介绍给亲友", "推荐", "海报"], match: "exact", bot: "小王医助", responses: [
      { type: "image", svg: "poster", page: "poster" }
    ] },
    { code: "909", aliases: ["感谢医生", "送心意", "感谢", "感谢王主任"], match: "exact", bot: "小王医助", responses: [extCard({ type: "mp", title: "感谢医生 / 送心意", sub: "王云程医生主页入口", thumb: "mpHeart", page: "thank-doctor" }, WANG_CY.sendHeart)] },
    { code: "919", aliases: ["评价", "评价医生", "分享经验"], match: "exact", bot: "小王医助", responses: [{ type: "link", title: "分享就医感受", sub: "春雨问卷", external: webLink({ provider: "春雨医生", label: "评价问卷", url: WANG_REVIEW_URL }), ctaLabel: "填写评价", fallbackPage: "review" }] },
    { code: "979", aliases: ["医患联络表", "建档", "联络表"], match: "exact", bot: "小王医助", responses: [
      { type: "link", title: "医患联络表", sub: "提交基础信息建档", external: webLink({ provider: "春雨医患通", label: "医患联络表", url: WANG_CONTACT_URL }), ctaLabel: "填写联络表", fallbackPage: "contact-form" }
    ] }
  ],
  faq: [
    { grp: "看病就医", q: "怎么找王主任看病？", a: "发送 201 查看挂号入口；需要咨询可发 101。", sort: 1 },
    { grp: "群内服务", q: "群里数字代号是什么？", a: "发 1 查看完整功能菜单。", sort: 2 }
  ]
};

module.exports = [lvfujing, huang, guo, zhouyuchun, wangyuncheng];
module.exports.ZHOU_SCRIPTS = {
  groupWelcome: ZHOU_WELCOME,
  doctorHomeShortLink: CHUNYU_SHORT_LINKS.zhouDoctor.shortLink,
  memberVisit: "【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份，并主动引导 101 咨询/201 挂号等入口。",
  code101: "为保护您的隐私，请通过医生小程序主页相关服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n\n🌻 紧急情况，请及时到医院就诊。",
  code102: "为保护您的隐私，请通过医生小程序主页视频问诊服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n\n🌻 紧急情况，请及时到医院就诊。",
  code103: "-",
  code105: "点击问诊小程序，查看医生回复，如果未回复请耐心等待一下。",
  code201: "请您选择合适的时间，通过医院官方挂号平台挂号，挂号成功后持医保卡前往医院取号。",
  code202: "-",
  code301: "注意：本次加号为群内专属，与医院官方发布门诊信息不互通。请留意医院公众号及群内通知，排除医生停诊日，停诊日加号无效。\n\n📢 【申请加号】操作步骤如下：\n\n1、打开【小程序链接】，选择【预约就诊】，根据流程操作。\n\n2、申请加号后，您可通过订单页面查看加号结果。",
  code302: "📝 填写须知：\n1、请填写【住院申请表】，向医生申请住院。最终能否入院及具体入院时间，由院方审核后再行通知。\n2、由于医院床位紧张，请各位朋友提前做好安排，避免错过最佳治疗时机。\n\n🌻 友情提醒：\n1. 填写完信息后，请在群里【告知医助】，以便及时为您跟进。\n2. 床位安排确定后，住院部医生会提前电话通知，最终住院时间以医生电话通知为准。",
  code501: "-",
  code606: "🌻 周主任的科普在以下渠道发布，欢迎大家关注\n\n1、抖音：中医男科周玉春\n2、小红书：中医男科周玉春\n3、百家号：中医男科周玉春\n4、快手：中医男科周玉春",
  code616: "-",
  code626: "-",
  code808: "-",
  code818: "🌻 感谢您转发海报，让更多患者获得主任的帮助\n\n👉🏻 转发方法：保存图片，转发到朋友圈、微信好友或微信群",
  code888: "-",
  code909: "感谢您的信任与认可，祝您后续诊疗一切顺利，早日痊愈。",
  code919: "分享您的就医感受，让更多人了解周主任。",
  code979: "请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。",
  "code联络表": "请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。"
};
module.exports.ZHOU_HOME_MP_CODES = ZHOU_HOME_MP_CODES;
module.exports.WANG_SCRIPTS = {
  groupWelcome: WANG_WELCOME,
  doctorHomeShortLink: WANG_HOME_SHORT_LINK,
  memberVisit: "【新患者到访 · 仅供医助关注，无需发送】{patient} 首次在群内发言，系统已发送入群欢迎。建议医助关注后续消息，必要时确认身份，并主动引导 101 咨询/201 挂号等入口。",
  code101: "为保护您的隐私，请通过医生小程序主页相关服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n\n🌻 紧急情况，请及时到医院就诊。",
  code102: "为保护您的隐私，请通过医生小程序主页视频问诊服务进行 1对1 咨询医生，医生利用空闲时间回复，请耐心等待。感谢您的理解和配合[玫瑰][玫瑰]。\n\n🌻 紧急情况，请及时到医院就诊。",
  code103: "医院电话：010-67992043\n科室电话：010-61278037",
  code105: "点击问诊小程序，查看医生回复，如果未回复请耐心等待一下。",
  code201: "请您选择合适的时间，通过医院官方挂号平台挂号，挂号成功后持医保卡前往医院取号。",
  code202: "-",
  code301: "注意：本次加号为群内专属，与医院官方发布门诊信息不互通。请留意医院公众号及群内通知，排除医生停诊日，停诊日加号无效。\n\n📢 【申请加号】操作步骤如下：\n\n1、打开【小程序链接】，选择【预约就诊】，根据流程操作。\n\n2、申请加号后，您可通过订单页面查看加号结果。",
  code302: "📝 填写须知：\n1、请填写【住院申请表】，向医生申请住院。最终能否入院及具体入院时间，由院方审核后再行通知。\n2、由于医院床位紧张，请各位朋友提前做好安排，避免错过最佳治疗时机。\n\n🌻 友情提醒：\n1. 填写完信息后，请在群里【告知医助】，以便及时为您跟进。\n2. 床位安排确定后，住院部医生会提前电话通知，最终住院时间以医生电话通知为准。",
  code501: "-",
  code606: "🌻 王主任的科普在以下渠道发布，欢迎大家关注\n\n1、抖音：骨科王云程\n2、小红书：骨科王云程",
  code616: "-",
  code626: "-",
  code808: "-",
  code818: "🌻 感谢您转发海报，让更多患者获得主任的帮助\n\n👉🏻 转发方法：保存图片，转发到朋友圈、微信好友或微信群",
  code888: "-",
  code909: "感谢您的信任与认可，祝您后续诊疗一切顺利，早日痊愈。",
  code919: "分享您的就医感受，让更多人了解王主任。",
  code979: "请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。",
  "code联络表": "请点击下方【医患联络表】提交基础信息，便于医生了解您的情况。\n建议将群昵称改为「真实姓名」，方便医助识别跟进。"
};
module.exports.WANG_HOME_MP_CODES = WANG_HOME_MP_CODES;
module.exports.CHUNYU_SHORT_LINKS = CHUNYU_SHORT_LINKS;
