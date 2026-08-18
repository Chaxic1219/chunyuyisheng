/* PII 掩码单一模块（生产DB架构 v1.0 §3-4，2026-07-04）：
   此前 server.js 与 triage.js 各持一份 maskPII/maskPIIStrict 本地副本（triage 侧注释「口径一字不差」靠人肉维持），
   已知会漂移 → 合并为唯一源。正则以 triage.js 现版为准【原样搬家、一字不动】（分隔符容忍最全）；
   调用方一律 require 本模块，禁止再复制本地副本。本模块零依赖（不 require 任何项目文件，杜绝循环依赖）。 */

// 正文里的手机号/身份证号脱敏（连续数字形态）。原 server.js:444 / triage.js:58 同款。
function maskPII(s){ return String(s || "").replace(/1[3-9]\d{9}/g, "***").replace(/\d{17}[\dXx]/g, "***"); }

// 增强 PII 掩码（codex 绝尾反例，2026-07-03；原 triage.js:64）：文本可能含带空格/连字符的手机号/身份证
// （138-1234-5678 / 138 1234 5678），绕过 maskPII 的连续数字正则。
// 顺序：身份证在前（18 位，更长、更具体，先吃掉；避免其前 11 位先被手机号规则截半），再手机号。
// 分隔符仅容忍每位间单个空格/连字符（不吞逗号/句号，防误伤「120、发30分钟」等）。
function maskPIIStrict(s){
  let t = String(s || "")
    .replace(/\d(?:[\s\-]?\d){16}[\s\-]?[\dXx]/g, "***")   // 身份证：18 位、每位间（含末位 [\dXx] 前）均可夹单个空格/连字符（codex 修：末位 X 前也容忍分隔，堵 11010119900101123-X）
    .replace(/1[\s\-]?[3-9](?:[\s\-]?\d){9}/g, "***");     // 手机号：11 位、每位间（含第 1-2 位间）均可夹单个空格/连字符（codex 修：逐位空格 1 3 8… 不再漏）
  return maskPII(t);                                        // 再跑原全局 maskPII（无分隔的连续号 + 兜底）
}

/* 提交表单【功能字段】白名单（生产DB架构 v1.0 §3-2，/api/submit 存储侧脱敏用；codex FAIL 修 fail-closed 反转，2026-07-04）：
   ⚠ /api/submit 是公开接口、payload 键名客户端任意——按「只掩 textarea label」的黑名单会被 `{"desc":"回拨138-1234-5678"}`
   这类任意键名/键变体整段绕过（codex 实测突破）。故反转为白名单：功能字段（被下游明文消费者需要的键）保留明文，
   其余一切字符串值（含未知键/textarea 自由文本/嵌套里的字符串）一律 maskPIIStrict。
   功能字段 = 表单配置里【非 textarea】字段的 label（姓名/手机号/主诉/随访方案/日期/城市/期望就诊日/诊断拟手术/期望住院时间等，
   被 /api/replies/mine、isRegistered/registeredName、db.applyPatientBackfill、followup.enroll、resolvePatient 按明文匹配；盲索引属目标态）。 */
function functionalLabels(fields){
  return (Array.isArray(fields) ? fields : []).filter(f=>f && f.type !== "textarea" && f.label).map(f=>String(f.label));
}

/* /api/submit 家庭代办块四键（前端 renderProxy 通用块，联络表/加号/住院三 type 均可带；patient.js:1013-1014）：
   客户端透传值、服务端不改写；代办人手机被 /api/replies/mine 跨 type 明文匹配（server.js:383）→ 须保留明文。
   与患者关系/办理身份/代办人姓名 是结构功能字段（后台按明文展示），一并明文。这四键进白名单。 */
const SUBMIT_PROXY_KEYS = ["办理身份","代办人姓名","代办人手机","与患者关系"];
/* 联络表医患通档案：label 键 + 凭证 URL 键。即使医生 content 仍是旧 3 字段，也要明文保留新档案快照（避免 PII 误掩导致档案空白）。 */
const SUBMIT_CONTACT_EXTRA_KEYS = [
  "性别", "出生日期", "身份证号", "您所患的疾病", "是否妊娠哺乳",
  "食物、接触物过敏", "药物过敏", "疾病史", "请上传门诊凭证",
  "outpatientVoucherUrl"
];
/* 服务端自写标志键（codex 第八轮 §2）：手机号验证/敏感信息单独同意（联络表 verifySms 后写"已验证"/时间戳）、单独同意（加号/住院写时间戳）——
   值由服务端生成、客户端传值无意义。这些键【不进白名单】：客户端同名传值一律走掩码（防伪造系统键夹带 PII），
   服务端在掩码副本上覆写自己的权威值（见 server.js /api/submit）。故此处不导出为白名单常量。
   注：随访方案是联络表表单字段（seed contactForm plan.label="随访方案"）→ 已被 functionalLabels 覆盖，不必单列系统键。 */

/* 按 type 组装白名单（codex 第八轮 §1 收紧，不再全局拼）：该 type 表单非 textarea 字段 label + 该 type 适用的代办键。
   story 特例：只放行 name（正文 text 属自由文本 → 被掩）。formFields=该 type 的 content 表单块 fields（server 侧取好传入）。
   服务端自写标志键刻意不含——由服务端在掩码副本上覆写。 */
function submitWhitelistForType(type, formFields){
  if(type === "story") return ["name"];
  // 联络表/加号/住院三 type 都含家庭代办通用块 → 代办四键都进；服务端自写键不进（走覆写）。
  const base = functionalLabels(formFields).concat(SUBMIT_PROXY_KEYS);
  if(type === "联络表") return base.concat(SUBMIT_CONTACT_EXTRA_KEYS);
  return base;
}

/* 提交 payload 存储副本脱敏（fail-closed 白名单）：白名单键的字符串值保留明文；其余任何键的字符串值一律 maskPIIStrict。
   递归下钻数组/对象里的字符串（防 payload 嵌套结构里夹带 PII 绕过）——嵌套层不认白名单（白名单只作用于顶层功能键）。
   返回新对象/数组、绝不就地修改入参（入库后调用方还要读内存 payload 的结构字段做建档/随访入组）。 */
function maskDeep(v){
  if(typeof v === "string") return maskPIIStrict(v);
  // number/bigint（codex 第六轮反例，2026-07-04；第七轮改全串锚定）：白名单外键以 JSON 数字传手机号（{desc:13812345678}，JSON.parse 得 number）会绕过字符串分支原样入库。
  //   数字是【原子值】、不该子串扫描——旧版直接跑 maskPIIStrict 会误伤 13 位毫秒时间戳（1720080000000 前 11 位撞 /1[3-9]\d{9}/ → "***00"）。
  //   故对数字用【整串锚定】：仅当整串恰好是 11 位手机形态(^1[3-9]\d{9}$)或 18 位纯数字身份证形态(^\d{18}$，number 不含 X，Xx 尾只存在于字符串路径)才掩为 "***"；
  //   否则返回【原值原类型】——12/13 位时间戳、10 位以下小数字、年龄/年份/数量均不受伤。字符串路径维持 maskPIIStrict 子串扫描不动（文本里嵌 PII 该掩，语义不同）。
  if(typeof v === "number" || typeof v === "bigint"){
    const s = String(v);
    return (/^1[3-9]\d{9}$/.test(s) || /^\d{18}$/.test(s)) ? "***" : v;   // 整串恰为手机/身份证形态 → 掩；否则原值原类型
  }
  if(Array.isArray(v)) return v.map(maskDeep);
  if(v && typeof v === "object"){ const o = {}; Object.keys(v).forEach(k=>{ o[k] = maskDeep(v[k]); }); return o; }
  return v;   // boolean/null/undefined 原样
}
function maskPayloadExceptWhitelist(payload, whitelist){
  const src = (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload : {};
  const wl = new Set(Array.isArray(whitelist) ? whitelist : []);
  const out = {};
  Object.keys(src).forEach(k=>{
    const v = src[k];
    if(wl.has(k)){ out[k] = v; return; }          // 功能字段：整值保留明文（即使是对象/数组也不下钻——功能字段由下游按明文消费）
    out[k] = maskDeep(v);                          // 非白名单：字符串掩、递归掩嵌套里的字符串
  });
  return out;
}

module.exports = { maskPII, maskPIIStrict, functionalLabels, SUBMIT_PROXY_KEYS, submitWhitelistForType, maskDeep, maskPayloadExceptWhitelist };
