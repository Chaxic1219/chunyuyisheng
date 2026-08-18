/* QiWe 第三方企微执行控制台适配层。
   仅负责：本地配置、Webhook 事件归一化、调用 /api/qw/doApi 发送文本/小程序卡片。
   医疗回复、安全分诊、是否可自动发送不在这里判断。 */
const http = require("http");
const https = require("https");
/* 禁止在模块顶层解构 db：若本文件在 db.js 初始化中被同步 require，会因循环依赖得到 undefined 并永久钉死。 */
function getDb(){
  return require("./db.js").db;
}
const db = new Proxy({}, {
  get(_t, prop){
    const real = getDb();
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  }
});

const DEFAULT_API_URL = "http://manager.qiweapi.com/qiwe/api/qw/doApi";
// 聊天图片/文件上传换参端点（api-344613929「本地文件上传」）：走 /doFileApi（不是 /doApi）·multipart/form-data。
const DEFAULT_FILE_API_URL = "http://manager.qiweapi.com/qiwe/api/qw/doFileApi";
const DRY_RUN = process.env.QIWE_DRY_RUN === "1";
// HTTP 请求超时：底层连上不返回时不再永久挂起 → 超时 reject；默认 45s（群同步/改名可能较慢），可 env 覆盖。
const HTTP_TIMEOUT_MS = Number(process.env.QIWE_HTTP_TIMEOUT_MS) > 0 ? Number(process.env.QIWE_HTTP_TIMEOUT_MS) : 45000;
const { createUserinfoGate } = require("./modules/qiwe/userinfo_gate.js");
const userinfoGate = createUserinfoGate();

function clean(v, n){
  return String(v == null ? "" : v).trim().slice(0, n || 240);
}

/* 企微/微信拉链接卡 icon：path 含中文常失败并回退默认链环图；对 path 分段百分号编码。 */
function encodeUrlForWechatFetch(v){
  const raw = clean(v, 1000);
  if(!/^https?:\/\//i.test(raw)) return "";
  try{
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg)=>{
        if(!seg) return "";
        try{ return encodeURIComponent(decodeURIComponent(seg)); }
        catch(e){ return encodeURIComponent(seg); }
      })
      .join("/");
    return u.toString();
  }catch(e){
    return raw;
  }
}

function bool(v, fallback){
  if(v === undefined || v === null || v === "") return !!fallback;
  if(typeof v === "boolean") return v;
  if(typeof v === "number") return v !== 0;
  return ["1", "true", "yes", "on", "启用"].includes(String(v).trim().toLowerCase());
}

function envConfig(){
  return {
    token:process.env.QIWE_TOKEN || "",
    guid:process.env.QIWE_GUID || "",
    selfUserId:process.env.QIWE_SELF_USER_ID || "",
    testToId:process.env.QIWE_TEST_TO_ID || "",
    callbackSecret:process.env.QIWE_CALLBACK_SECRET || "",
    apiUrl:process.env.QIWE_API_URL || DEFAULT_API_URL,
    doctorId:process.env.QIWE_DOCTOR_ID ? Number(process.env.QIWE_DOCTOR_ID) : null,
    enabled:process.env.QIWE_ENABLED === "1",
    autoSend:process.env.QIWE_AUTO_SEND !== "0",
    allowGroup:process.env.QIWE_ALLOW_GROUP === "1",
    note:"env"
  };
}

function getAccountState(){
  try{
    return db.prepare("SELECT * FROM qiwe_account_state WHERE id=1").get() || null;
  }catch(e){
    return null;
  }
}

function upsertAccountState(patch){
  const prev = getAccountState() || {};
  const next = {
    home_guid: patch.homeGuid != null ? clean(patch.homeGuid, 120) : (prev.home_guid || ""),
    active_guid: patch.activeGuid != null ? clean(patch.activeGuid, 120) : (prev.active_guid || ""),
    region: patch.region != null ? clean(patch.region, 80) : (prev.region || ""),
    updated_at: new Date().toISOString()
  };
  db.prepare(`INSERT INTO qiwe_account_state(id, home_guid, active_guid, region, updated_at)
    VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      home_guid=excluded.home_guid,
      active_guid=excluded.active_guid,
      region=excluded.region,
      updated_at=excluded.updated_at`).run(
    next.home_guid, next.active_guid, next.region, next.updated_at
  );
  return getAccountState();
}

function loadConfig(){
  const env = envConfig();
  let latest = null;
  try{ latest = db.prepare("SELECT * FROM qiwe_configs ORDER BY id DESC LIMIT 1").get(); }catch(e){}
  if(!latest) return env;

  // 兼容「最新一行字段为空」的历史脏数据：从新到旧找最近非空值
  let rows = [];
  try{
    rows = db.prepare("SELECT * FROM qiwe_configs ORDER BY id DESC LIMIT 25").all() || [];
  }catch(e){}

  const pickFirstNonEmpty = (key)=>{
    for(const r of rows){
      if(!r) continue;
      const v = r[key];
      if(v == null) continue;
      const s = String(v).trim();
      if(!s) continue;
      return s;
    }
    return "";
  };

  const pickedGuid = pickFirstNonEmpty("guid") || env.guid;
  const pickedSelf = pickFirstNonEmpty("self_user_id") || env.selfUserId;
  const pickedToken = pickFirstNonEmpty("token") || env.token;
  const pickedSecret = pickFirstNonEmpty("callback_secret") || env.callbackSecret;
  const pickedApiUrl = pickFirstNonEmpty("api_url") || latest.api_url || env.apiUrl || DEFAULT_API_URL;

  const state = getAccountState();
  return {
    // 精确字段兜底：按最近非空值优先
    token: pickedToken,
    guid: pickedGuid,
    selfUserId: pickedSelf,
    callbackSecret: pickedSecret,
    apiUrl: pickedApiUrl,
    // 其余按最新一行为主
    testToId: latest.test_to_id || env.testToId,
    doctorId: latest.doctor_id || env.doctorId || null,
    enabled: bool(latest.enabled, env.enabled),
    autoSend: bool(latest.auto_send, env.autoSend),
    allowGroup: bool(latest.allow_group, env.allowGroup),
    note: latest.note || "",
    region:(state && state.region) || "",
    homeGuid:(state && state.home_guid) || (pickedGuid || env.guid || "")
  };
}

function mask(v){
  const s = clean(v, 200);
  if(!s) return "";
  if(s.length <= 8) return "已配置";
  return s.slice(0, 4) + "..." + s.slice(-4);
}

function publicConfig(cfg){
  cfg = cfg || loadConfig();
  const state = getAccountState();
  const homeGuid = (state && state.home_guid) || cfg.homeGuid || cfg.guid || "";
  const activeGuid = cfg.guid || "";
  return {
    configured:!!(cfg.token && cfg.guid),
    enabled:!!cfg.enabled,
    autoSend:!!cfg.autoSend,
    allowGroup:!!cfg.allowGroup,
    doctorId:cfg.doctorId || null,
    guid:mask(cfg.guid),
    token:mask(cfg.token),
    selfUserId:cfg.selfUserId || "",
    testToId:cfg.testToId || "",
    testToIdManaged:true,
    callbackSecret:cfg.callbackSecret ? "已配置" : "",
    apiUrl:cfg.apiUrl || DEFAULT_API_URL,
    note:cfg.note || "",
    region:cfg.region || (state && state.region) || "",
    homeGuid:mask(homeGuid),
    isHomeAccount:!homeGuid || !activeGuid || String(homeGuid).toUpperCase() === String(activeGuid).toUpperCase(),
    dryRun:DRY_RUN
  };
}

function parseTestToIdList(testToId){
  const seen = new Set();
  const out = [];
  for(const part of String(testToId || "").split(/[\s,，;；]+/)){
    const id = clean(part, 80);
    if(!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function formatTestToIdList(ids){
  return parseTestToIdList((ids || []).join(","));
}

/* 托管号被拉入新群时，把 roomId 追加进 testToId 白名单（保留既有本人 userId 与其它群）。 */
function ensureRoomInTestToId(roomId, cfg){
  cfg = cfg || loadConfig();
  const rid = clean(roomId, 80);
  if(!rid) return cfg;
  const ids = parseTestToIdList(cfg.testToId);
  if(cfg.selfUserId && !ids.includes(cfg.selfUserId)) ids.unshift(cfg.selfUserId);
  if(ids.includes(rid)) return cfg;
  ids.push(rid);
  const next = formatTestToIdList(ids).join(",");
  if(next.length > 7800){
    console.warn("[qiwe] testToId 接近上限，请清理无效 roomId。len=", next.length);
  }
  saveConfig({ testToId: next });
  return loadConfig();
}

/** 用全部业务企微群 + 现有白名单重建 testToId（修复历史 240 字截断）。 */
function rebuildTestToIdFromBusinessGroups(){
  const cfg = loadConfig();
  const ids = parseTestToIdList(cfg.testToId).filter((id) => id.length >= 10);
  if(cfg.selfUserId) ids.unshift(cfg.selfUserId);
  let rows = [];
  try{
    rows = db.prepare(`
      SELECT external_group_id FROM community_groups
      WHERE data_source='qiwe'
        AND is_business=1
        AND IFNULL(qiwe_hidden,0)=0
        AND IFNULL(external_group_id,'')!=''
    `).all() || [];
  }catch(e){}
  for(const r of rows){
    const rid = clean(r.external_group_id, 80);
    if(rid && rid.length >= 10) ids.push(rid);
  }
  const next = formatTestToIdList(ids).join(",");
  saveConfig({ testToId: next });
  return loadConfig();
}

function saveConfig(input){
  const prev = loadConfig();
  const v = (key, n) => clean(input && input[key], n || 240);
  const token = v("token") || prev.token;
  const guid = v("guid") || prev.guid;
  const apiUrl = v("apiUrl", 500) || prev.apiUrl || DEFAULT_API_URL;
  // 不改医生本体：doctorId 仅沿用既有配置，禁止通过空值清空
  const doctorId = prev.doctorId || null;
  const region = Object.prototype.hasOwnProperty.call(input || {}, "region")
    ? v("region", 80)
    : (prev.region || "");

  // 首次记录「原账号」home_guid：之后切号隐藏旧群，切回 home 再显示
  const state = getAccountState();
  const homeGuid = (state && state.home_guid) || prev.guid || guid;
  upsertAccountState({
    homeGuid,
    activeGuid: guid,
    region
  });

  let note = v("note", 500) || prev.note;
  if(region && !/地区/.test(note)){
    note = (note ? note + " · " : "") + ("地区：" + region);
    note = note.slice(0, 500);
  }

  db.prepare(`INSERT INTO qiwe_configs(
    doctor_id,token,guid,self_user_id,test_to_id,callback_secret,api_url,enabled,auto_send,allow_group,note,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    Number.isFinite(doctorId) ? doctorId : null,
    token,
    guid,
    v("selfUserId") || prev.selfUserId,
    // testToId 会随业务群增多变长；旧默认 240 会截断新 roomId，导致新建群 outside_test_scope 静默
    (Object.prototype.hasOwnProperty.call(input || {}, "testToId")
      ? clean(input.testToId, 8000)
      : "") || prev.testToId,
    v("callbackSecret") || prev.callbackSecret,
    apiUrl,
    bool(input && input.enabled, prev.enabled) ? 1 : 0,
    bool(input && input.autoSend, prev.autoSend) ? 1 : 0,
    bool(input && input.allowGroup, prev.allowGroup) ? 1 : 0,
    note,
    new Date().toISOString()
  );
  return publicConfig(loadConfig());
}

function asObject(v){
  if(!v) return {};
  if(typeof v === "object" && !Array.isArray(v)) return v;
  if(typeof v === "string"){
    const s = v.trim();
    if(!s) return {};
    try{ return JSON.parse(s); }catch(e){ return {}; }
  }
  return {};
}

function collectObjects(v, out, depth){
  if(depth > 4) return;
  const o = asObject(v);
  if(!o || !Object.keys(o).length) return;
  out.push(o);
  ["msgData", "content", "weapp", "weappInfo", "miniProgram", "miniProgramInfo", "appMsg", "appmsg", "params"].forEach(k=>{
    if(o[k] !== undefined) collectObjects(o[k], out, depth + 1);
  });
}

function firstField(objects, names, n){
  for(const o of objects){
    for(const name of names){
      if(o && o[name] !== undefined && o[name] !== null && String(o[name]).trim() !== ""){
        return clean(o[name], n || 500);
      }
    }
  }
  return "";
}

function normalizeWeappCard(input, fallback){
  const objects = [];
  collectObjects(input, objects, 0);
  collectObjects(input && input.msgData, objects, 0);
  collectObjects(input && input.raw, objects, 0);
  fallback = fallback || {};
  const sizeRaw = firstField(objects, ["coverFileSize", "cover_file_size", "coverImageSize", "cover_image_size", "fileSize", "thumbFileSize"], 40) || fallback.coverFileSize || "";
  const size = Number(sizeRaw);
  const rawTitle = firstField(objects, ["title", "name"], 180);
  const rawDesc = firstField(objects, ["desc", "description", "subTitle", "sub"], 500);
  const appName = firstField(objects, ["appName", "app_name"], 180);
  return {
    appId:firstField(objects, ["appId", "app_id", "appid"], 120) || clean(fallback.appId, 120),
    username:firstField(objects, ["username", "originalId", "original_id", "userName"], 160) || clean(fallback.username || fallback.originalId, 160),
    pagePath:firstField(objects, ["pagePath", "page_path", "path", "pagepath"], 1000) || clean(fallback.pagePath || fallback.path, 1000),
    title:(appName && rawDesc ? rawDesc : rawTitle) || clean(fallback.title || "春雨医生", 180),
    desc:(appName || rawDesc) || clean(fallback.desc || fallback.sub || "", 500),
    thumbUrl:firstField(objects, ["thumbUrl", "thumb_url", "coverUrl", "cover_url", "imageUrl", "iconUrl", "icon_url", "appMediaUrl"], 1200) || clean(fallback.thumbUrl || fallback.coverUrl, 1200),
    coverFileAesKey:firstField(objects, ["coverFileAesKey", "cover_file_aes_key", "coverImageAesKey", "cover_image_aes_key", "fileAesKey", "aesKey"], 1200) || clean(fallback.coverFileAesKey, 1200),
    coverFileId:firstField(objects, ["coverFileId", "cover_file_id", "coverImageId", "cover_image_id", "fileId", "thumbFileId"], 2400) || clean(fallback.coverFileId, 2400),
    coverFileSize:Number.isFinite(size) && size > 0 ? size : (Number(fallback.coverFileSize) || 0)
  };
}

function missingWeappFields(card){
  card = normalizeWeappCard(card);
  const missing = [];
  [
    ["appId", "小程序 appId"],
    ["username", "小程序原始 ID"],
    ["pagePath", "小程序跳转地址"],
    ["title", "卡片标题"],
    ["thumbUrl", "缩略图 URL"],
    ["coverFileAesKey", "封面图 AESKey"],
    ["coverFileId", "封面图 ID"],
    ["coverFileSize", "封面图大小"]
  ].forEach(([k, label])=>{
    if(k === "coverFileSize"){
      if(!Number(card[k])) missing.push(label);
    }else if(!card[k]) missing.push(label);
  });
  return missing;
}

function isWeappReady(card){
  return missingWeappFields(card).length === 0;
}

function knownAppIdForUsername(doctorId, username){
  const u = clean(username, 160);
  if(!doctorId || !u) return "";
  const row = db.prepare(`SELECT app_id FROM qiwe_weapp_templates
    WHERE doctor_id=? AND username=? AND app_id<>''
    ORDER BY updated_at DESC,id DESC LIMIT 1`).get(Number(doctorId), u);
  return row && row.app_id ? row.app_id : "";
}

function saveWeappTemplate(input){
  const doctorId = Number(input && input.doctorId);
  const code = clean(input && input.code, 40);
  if(!doctorId) throw new Error("缺少医生 ID，无法保存小程序卡片模板");
  if(!code) throw new Error("缺少编号，无法保存小程序卡片模板");
  const existing = db.prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(doctorId, code);
  const card = normalizeWeappCard((input && input.card) || input, input && input.fallback);
  if(!card.appId && existing && existing.app_id) card.appId = clean(existing.app_id, 120);
  if(!card.appId && card.username) card.appId = knownAppIdForUsername(doctorId, card.username);
  if(!card.title && !card.appId && !card.pagePath && !card.coverFileId) throw new Error("未识别到小程序卡片字段");
  const sourceType = clean(input && (input.sourceType || input.source_type), 80) || (existing && existing.source_type) || "";
  const sourcePage = clean(input && (input.sourcePage || input.source_page), 200) || (existing && existing.source_page) || "";
  const sourceShortLink = clean(input && (input.sourceShortLink || input.source_short_link), 500) || (existing && existing.source_short_link) || "";
  let raw = "";
  try{ raw = JSON.stringify(input && (input.rawPayload || input.card || input)); }catch(e){ raw = ""; }
  db.prepare(`INSERT INTO qiwe_weapp_templates(
    doctor_id,code,source_type,source_page,source_short_link,title,app_id,username,page_path,thumb_url,cover_file_aes_key,cover_file_id,cover_file_size,desc,raw_payload,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(doctor_id, code) DO UPDATE SET
    source_type=excluded.source_type,
    source_page=excluded.source_page,
    source_short_link=excluded.source_short_link,
    title=excluded.title,
    app_id=excluded.app_id,
    username=excluded.username,
    page_path=excluded.page_path,
    thumb_url=excluded.thumb_url,
    cover_file_aes_key=excluded.cover_file_aes_key,
    cover_file_id=excluded.cover_file_id,
    cover_file_size=excluded.cover_file_size,
    desc=excluded.desc,
    raw_payload=excluded.raw_payload,
    updated_at=excluded.updated_at`).run(
      doctorId, code, sourceType, sourcePage, sourceShortLink,
      card.title, card.appId, card.username, card.pagePath, card.thumbUrl,
      card.coverFileAesKey, card.coverFileId, Number(card.coverFileSize) || 0,
      card.desc, raw, new Date().toISOString()
    );
  // 主人 2026-08-04：小程序贴片按编号独立读取，禁用同短链自动同步到其它编号。
  return loadWeappTemplate(doctorId, code);
}

function rowToWeappTemplate(row){
  if(!row) return null;
  const card = {
    id:row.id,
    doctorId:row.doctor_id,
    code:row.code,
    sourceType:row.source_type || "",
    sourcePage:row.source_page || "",
    sourceShortLink:row.source_short_link || "",
    title:row.title || "",
    appId:row.app_id || "",
    username:row.username || "",
    pagePath:row.page_path || "",
    thumbUrl:row.thumb_url || "",
    coverFileAesKey:row.cover_file_aes_key || "",
    coverFileId:row.cover_file_id || "",
    coverFileSize:Number(row.cover_file_size) || 0,
    desc:row.desc || "",
    updatedAt:row.updated_at || ""
  };
  card.missing = missingWeappFields(card);
  card.ready = card.missing.length === 0;
  return card;
}

function loadWeappTemplate(doctorId, code){
  const row = db.prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(Number(doctorId), clean(code, 40));
  return rowToWeappTemplate(row);
}

function loadWeappTemplates(doctorId){
  return db.prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? ORDER BY code").all(Number(doctorId)).map(rowToWeappTemplate);
}

function cardLikeResponses(responses){
  return (Array.isArray(responses) ? responses : [])
    .map((r, i)=>({ r, i }))
    .filter(({ r })=>r && ["mp", "link", "image", "qr", "popup"].includes(r.type));
}

function preferredCardForRule(responses){
  const cards = cardLikeResponses(responses);
  return cards.find(x=>x.r.type === "mp" && x.r.external && x.r.external.shortLink)
    || cards.find(x=>x.r.external && x.r.external.shortLink)
    || cards.find(x=>x.r.type === "mp")
    || cards[0]
    || ((Array.isArray(responses) && responses[0]) ? { r:responses[0], i:0 } : null)
    || null;
}

function templateSeedFromRule(code, response){
  response = response || {};
  const ext = response.external || {};
  const title = clean(response.title || response.name || response.modal || response.page || code, 180);
  const fallback = {
    title,
    desc:response.sub || ext.shortLinkScope || ext.label || "",
    appId:ext.appId || "",
    username:ext.username || ext.originalId || "",
    pagePath:ext.path || (ext.pathTemplate && !/\{[^}]+\}/.test(ext.pathTemplate) ? ext.pathTemplate : "")
  };
  return {
    sourceType:[response.type || "card", ext.mode || ""].filter(Boolean).join(":"),
    sourcePage:response.page || ext.service || ext.label || "",
    sourceShortLink:ext.shortLink || response.shortLink || "",
    card:fallback
  };
}

function upsertWeappPlaceholder(doctorId, code, response){
  const seed = templateSeedFromRule(code, response);
  const existing = db.prepare("SELECT * FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").get(Number(doctorId), code);
  const ready = existing && rowToWeappTemplate(existing).ready;
  const hasCapturedPayload = !!(existing && existing.raw_payload);
  const title = (ready || hasCapturedPayload) && existing.title ? existing.title : seed.card.title;
  const desc = (ready || hasCapturedPayload) && existing.desc ? existing.desc : seed.card.desc;
  const appId = existing && existing.app_id ? existing.app_id : seed.card.appId;
  const username = existing && existing.username ? existing.username : seed.card.username;
  const pagePath = existing && existing.page_path ? existing.page_path : seed.card.pagePath;
  const thumbUrl = existing && existing.thumb_url ? existing.thumb_url : "";
  const aesKey = existing && existing.cover_file_aes_key ? existing.cover_file_aes_key : "";
  const fileId = existing && existing.cover_file_id ? existing.cover_file_id : "";
  const fileSize = existing && existing.cover_file_size ? existing.cover_file_size : 0;
  db.prepare(`INSERT INTO qiwe_weapp_templates(
    doctor_id,code,source_type,source_page,source_short_link,title,app_id,username,page_path,thumb_url,cover_file_aes_key,cover_file_id,cover_file_size,desc,raw_payload,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(doctor_id, code) DO UPDATE SET
    source_type=excluded.source_type,
    source_page=excluded.source_page,
    source_short_link=excluded.source_short_link,
    title=excluded.title,
    app_id=excluded.app_id,
    username=excluded.username,
    page_path=excluded.page_path,
    thumb_url=excluded.thumb_url,
    cover_file_aes_key=excluded.cover_file_aes_key,
    cover_file_id=excluded.cover_file_id,
    cover_file_size=excluded.cover_file_size,
    desc=excluded.desc,
    updated_at=excluded.updated_at`).run(
      Number(doctorId), code, seed.sourceType, seed.sourcePage, seed.sourceShortLink,
      title, appId, username, pagePath, thumbUrl, aesKey, fileId, Number(fileSize) || 0,
      desc, existing ? (existing.raw_payload || "") : "", new Date().toISOString()
    );
  return loadWeappTemplate(doctorId, code);
}

function syncWeappTemplatesFromRules(doctorId){
  const rows = db.prepare("SELECT code,responses FROM rules WHERE doctor_id=? AND enabled=1 ORDER BY sort").all(Number(doctorId));
  const synced = [];
  for(const row of rows){
    let responses = [];
    try{ responses = JSON.parse(row.responses || "[]"); }catch(e){}
    const card = preferredCardForRule(responses);
    if(card) synced.push(upsertWeappPlaceholder(doctorId, row.code, card.r));
  }
  return synced;
}

function hydrateRelatedTemplates(doctorId, sourceTemplate){
  if(!sourceTemplate || !sourceTemplate.sourceShortLink) return 0;
  const updates = db.prepare(`UPDATE qiwe_weapp_templates SET
    title=CASE WHEN code IN ('102','301','404') THEN ? ELSE title END,
    desc=CASE WHEN code IN ('102','301','404') THEN ? ELSE desc END,
    app_id=?,
    username=?,
    page_path=?,
    thumb_url=?,
    cover_file_aes_key=?,
    cover_file_id=?,
    cover_file_size=?,
    updated_at=?
    WHERE doctor_id=? AND source_short_link=? AND code<>?
      AND COALESCE(raw_payload,'')=''`);
  const r = updates.run(
    sourceTemplate.title,
    sourceTemplate.desc,
    sourceTemplate.appId,
    sourceTemplate.username,
    sourceTemplate.pagePath,
    sourceTemplate.thumbUrl,
    sourceTemplate.coverFileAesKey,
    sourceTemplate.coverFileId,
    Number(sourceTemplate.coverFileSize) || 0,
    new Date().toISOString(),
    Number(doctorId),
    sourceTemplate.sourceShortLink,
    sourceTemplate.code
  );
  return r.changes || 0;
}

function publicWeappTemplates(doctorId){
  syncWeappTemplatesFromRules(doctorId);
  return loadWeappTemplates(doctorId).map(t=>({
    code:t.code,
    title:t.title,
    sourceType:t.sourceType,
    sourcePage:t.sourcePage,
    sourceShortLink:t.sourceShortLink,
    ready:t.ready,
    missing:t.missing || [],
    updatedAt:t.updatedAt || ""
  }));
}

function isConfigured(){
  const c = loadConfig();
  return !!(c.enabled && c.token && c.guid);
}

function postJson(url, body, headers){
  // 图片发送方法级兜底（纵深·codex 第四/五轮反例修）：/msg/sendImage 是实验能力，即便有人直调 postJson 拼 sendImage body
  // 也须过 QIWE_SENDIMAGE_EXPERIMENTAL 门（真相源=模块常量 DRY_RUN·不读运行时 env）。只特判该方法——
  // 不影响 postJson 通用用途（超时测试发 {a:1}、明文告警测试等 method 非 sendImage 的调用一律照常）。
  // 第五轮类型混淆修：闸检查的 method 必须 = 实际序列化上线的 method。旧写法闸读活属性 body.method（boxed String
  // `new String('/msg/sendImage')` !== 原始串、或 getter/toJSON 首求值返非图片），而上线走 JSON.stringify(body) 再次求值
  // → 「检查值 ≠ 发出值」绕过闸真发图。故此处**序列化一次**（getter/toJSON 只求值这一次）→ 闸从序列化结果解析出的
  // method 判定（= 实际发出的 method）→ Promise 内复用同一串上线（不再二次 JSON.stringify），杜绝检查/发出脱节。
  const bodyStr = JSON.stringify(body);
  if(roomWriteBlocked(DRY_RUN, sendImageExperimentalOn())){
    let m; try{ m = JSON.parse(bodyStr).method; }catch(_){ m = undefined; }
    if(m === "/msg/sendImage") throw new Error("图片发送未启用：设 QIWE_SENDIMAGE_EXPERIMENTAL=1 显式开启");
  }
  return new Promise((resolve, reject)=>{
    // 超时调用时读（便于测试设短值）：env 优先，缺省回落 HTTP_TIMEOUT_MS(10s)。
    const ms = Number(process.env.QIWE_HTTP_TIMEOUT_MS) > 0 ? Number(process.env.QIWE_HTTP_TIMEOUT_MS) : HTTP_TIMEOUT_MS;
    let done = false, timer = null;
    const clear = ()=>{ if(timer){ clearTimeout(timer); timer = null; } };
    const finish = (v)=>{ if(done) return; done = true; clear(); resolve(v); };
    const fail = (e)=>{ if(done) return; done = true; clear(); reject(e); };
    const u = new URL(url);
    const data = Buffer.from(bodyStr);   // 复用上面那一次序列化的结果（不再二次 JSON.stringify(body)）：闸(JSON.parse(bodyStr).method)与上线(Buffer.from(bodyStr))逐字节同源
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      method:"POST",
      hostname:u.hostname,
      port:u.port || (u.protocol === "https:" ? 443 : 80),
      path:u.pathname + u.search,
      headers:Object.assign({
        "Content-Type":"application/json",
        "Content-Length":data.length
      }, headers || {})
    }, r=>{
      let raw = "";
      r.on("data", c=>raw += c);
      r.on("end", ()=>{
        let parsed = null;
        try{ parsed = raw ? JSON.parse(raw) : {}; }
        catch(e){ return fail(new Error("QiWe 返回非 JSON：" + raw.slice(0, 160))); }
        if(r.statusCode < 200 || r.statusCode >= 300) return fail(new Error("QiWe HTTP " + r.statusCode));
        finish(parsed);
      });
    });
    req.on("error", fail);
    // 修：绝对总时限（wall-clock），不依赖 socket 活动 → 到点无条件 destroy + reject；挡住"慢滴流/返回头后永不 end"的永久挂起。
    timer = setTimeout(()=>{ try{ req.destroy(new Error("qiwe http timeout")); }catch(_){} fail(new Error("qiwe http timeout")); }, ms);
    // socket 空闲超时作兜底（绝对计时器是主）。
    req.setTimeout(ms, ()=>req.destroy(new Error("qiwe http timeout")));
    req.write(data);
    req.end();
  });
}

// 明文 token 传输告警（实测/生产排障用）：endpoint 非 https 时首次调用 warn 一次，模块级 flag 防刷屏；不阻断、不改默认行为。
// 判定口径严格 = postJson 真发口径：postJson 是 `protocol==="https:" ? https : http`，即「凡非 https 一律走 http 库明文发」。
// 故这里也用同款 new URL() 解析 +「非 https 即明文」(规范化前导空白/大小写，杜绝「" http://…"」绕过、覆盖非 http 非 https 的 endpoint)；解析失败=postJson 也会抛错不发 → 返 false 不告警。
function isCleartextEndpoint(url){
  try{ return new URL(url).protocol !== "https:"; }catch(e){ return false; }
}
let warnedHttp = false;
function warnHttpOnce(url){
  if(warnedHttp) return;
  if(isCleartextEndpoint(url)){
    warnedHttp = true;
    console.warn("[qiwe] QiWe endpoint 经明文（非 https）传输 token，生产应配 https（QIWE_API_URL / 后台 api_url）：" + clean(url, 120));
  }
}

/* 零依赖手搓 multipart/form-data POST（图片上传专用，api-344613929 本地文件上传）。
   超时/http-vs-https 解析/明文告警口径与 postJson 完全同源（照抄那套 wall-clock 绝对计时器为主 + socket 空闲兜底）：
   ① new URL() 解析 + protocol==="https:"?https:http（非 https 即明文，与 postJson/isCleartextEndpoint 一致）；
   ② setTimeout 绝对总时限到点无条件 destroy+reject（挡"返回头后永不 end"永久挂起）；③ req.setTimeout socket 兜底。
   body 构造：boundary 随机、每个 textField 一段（Content-Disposition: form-data; name="x"）、file 段带 filename+Content-Type + 二进制字节、结尾 --boundary--。
   Content-Type: multipart/form-data; boundary=...；Content-Length = body 字节长度。返回解析后 JSON。 */
function buildMultipartBody(textFields, fileField, boundary){
  const CRLF = "\r\n";
  const parts = [];
  const tf = textFields || {};
  for(const k of Object.keys(tf)){
    parts.push(Buffer.from(
      "--" + boundary + CRLF +
      'Content-Disposition: form-data; name="' + k + '"' + CRLF + CRLF +
      String(tf[k] == null ? "" : tf[k]) + CRLF
    ));
  }
  if(fileField && fileField.buffer){
    const name = fileField.name || "file";
    const filename = String(fileField.filename || "file");
    const ctype = fileField.contentType || "application/octet-stream";
    parts.push(Buffer.from(
      "--" + boundary + CRLF +
      'Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"' + CRLF +
      "Content-Type: " + ctype + CRLF + CRLF
    ));
    parts.push(Buffer.isBuffer(fileField.buffer) ? fileField.buffer : Buffer.from(fileField.buffer));
    parts.push(Buffer.from(CRLF));
  }
  parts.push(Buffer.from("--" + boundary + "--" + CRLF));
  return Buffer.concat(parts);
}

function postMultipart(url, textFields, fileField, headers){
  return new Promise((resolve, reject)=>{
    const ms = Number(process.env.QIWE_HTTP_TIMEOUT_MS) > 0 ? Number(process.env.QIWE_HTTP_TIMEOUT_MS) : HTTP_TIMEOUT_MS;
    let done = false, timer = null;
    const clear = ()=>{ if(timer){ clearTimeout(timer); timer = null; } };
    const finish = (v)=>{ if(done) return; done = true; clear(); resolve(v); };
    const fail = (e)=>{ if(done) return; done = true; clear(); reject(e); };
    const boundary = "----qiwe" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    const data = buildMultipartBody(textFields, fileField, boundary);
    let u;
    try{ u = new URL(url); }catch(e){ return fail(new Error("QiWe 上传 URL 非法：" + clean(url, 120))); }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      method:"POST",
      hostname:u.hostname,
      port:u.port || (u.protocol === "https:" ? 443 : 80),
      path:u.pathname + u.search,
      headers:Object.assign({
        "Content-Type":"multipart/form-data; boundary=" + boundary,
        "Content-Length":data.length
      }, headers || {})
    }, r=>{
      let raw = "";
      r.on("data", c=>raw += c);
      r.on("end", ()=>{
        let parsed = null;
        try{ parsed = raw ? JSON.parse(raw) : {}; }
        catch(e){ return fail(new Error("QiWe 上传返回非 JSON：" + raw.slice(0, 160))); }
        if(r.statusCode < 200 || r.statusCode >= 300) return fail(new Error("QiWe 上传 HTTP " + r.statusCode));
        finish(parsed);
      });
    });
    req.on("error", fail);
    timer = setTimeout(()=>{ try{ req.destroy(new Error("qiwe http timeout")); }catch(_){} fail(new Error("qiwe http timeout")); }, ms);
    req.setTimeout(ms, ()=>req.destroy(new Error("qiwe http timeout")));
    req.write(data);
    req.end();
  });
}

/* 从 doApi 端点派生 doFileApi 端点：结尾 /doApi → /doFileApi（稳妥用字符串替换 + 兜底默认常量）。
   cfg.apiUrl 常见 = .../qw/doApi；替换末段即可。无 /doApi 结尾（异常配置）→ 回落 DEFAULT_FILE_API_URL，绝不猜。 */
function fileApiUrl(cfg){
  const base = (cfg && cfg.apiUrl) || DEFAULT_API_URL;
  if(/\/doApi(\?|$)/.test(base)) return base.replace(/\/doApi(\?|$)/, "/doFileApi$1");
  return DEFAULT_FILE_API_URL;
}

async function doApi(method, params, cfg){
  if(String(method) === "/contact/batchGetUserinfo" && !DRY_RUN){
    return userinfoGate.run(() => doApiOnce(method, params, cfg));
  }
  return doApiOnce(method, params, cfg);
}

async function doApiOnce(method, params, cfg){
  cfg = cfg || loadConfig();
  if(!cfg.token) throw new Error("缺少 QiWe Token");
  if(!cfg.guid) throw new Error("缺少 QiWe 实例 GUID");
  const body = { method, params:Object.assign({ guid:cfg.guid }, params || {}) };
  if(DRY_RUN){
    console.log("[qiwe][DRY_RUN]", method, "->", clean((params && (params.toId || params.roomId || params.userId)) || "", 80), clean((params && (params.content || params.title)) || "", 120));
    return { code:0, msg:"dry_run", data:{ dryRun:true, method, params:body.params } };
  }
  // 图片发送方法级护栏（纵深·codex 反例修）：/msg/sendImage 是实验能力，直调 doApi 也须过 QIWE_SENDIMAGE_EXPERIMENTAL 门。
  // 与 sendImage/uploadImage 同源 roomWriteBlocked(真相源=模块常量 DRY_RUN)；DRY_RUN 已在上方返桩走不到此。
  // 说明：sendText/sendWeapp 等既有 method 是 V1 常规操作不门控(仅本图片实验能力门控)，故只特判 /msg/sendImage。
  // 第五轮类型混淆修：String(method) 归一化 boxed String（new String('/msg/sendImage') 被 String() 归一化为原始串），
  // 防 doApi 直调传 boxed method 绕过本闸；doApi 构造 body 后仍走 postJson 权威闸兜底。
  if(String(method) === "/msg/sendImage" && roomWriteBlocked(DRY_RUN, sendImageExperimentalOn()))
    throw new Error("图片发送未启用：设 QIWE_SENDIMAGE_EXPERIMENTAL=1 显式开启");
  const apiUrl = cfg.apiUrl || DEFAULT_API_URL;
  warnHttpOnce(apiUrl);   // 明文 http 传 token 告警（首次一次，不阻断、不改默认）
  const res = await postJson(apiUrl, body, {
    "X-QIWEI-TOKEN":cfg.token
  });
  const code = Number(res && res.code);
  if(Number.isFinite(code) && code !== 0 && code !== 200) throw new Error("QiWe 调用失败：" + code + " " + clean(res.msg, 200));
  return res;
}

async function sendText(toId, content, cfg){
  const target = clean(toId, 80);
  const text = clean(content, 3600);
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  if(!text) throw new Error("发送内容为空");
  return doApi("/msg/sendText", { toId:target, content:text, isNoNeedRead:true }, cfg);
}

/* 联系人详情字段偶发 base64（文档示例）；明文中文则原样返回 */
function decodeMaybeBase64(v, max){
  const raw = clean(v, max || 120);
  if(!raw) return "";
  if(/[\u4e00-\u9fff]/.test(raw) || /\s/.test(raw)) return raw.slice(0, max || 120);
  try{
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if(decoded && !decoded.includes("\uFFFD")
      && Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")){
      return decoded.slice(0, max || 120);
    }
  }catch(e){}
  return raw.slice(0, max || 120);
}

/* 群聊展示名优先级：群备注 → 群昵称 → 联系人备注 → 昵称 → 真名（官方：群详情无可靠名，需 batchGetUserinfo） */
function pickContactDisplayName(contact, roomMember){
  const m = roomMember || {};
  const c = contact || {};
  const candidates = [
    decodeMaybeBase64(m.roomRemarkName, 80),
    decodeMaybeBase64(m.name, 80),
    decodeMaybeBase64(c.alias, 80),
    decodeMaybeBase64(c.nickname, 80),
    decodeMaybeBase64(c.realName, 80)
  ];
  for(const n of candidates){
    if(n && !/^\d{10,}$/.test(n) && !/^(?:企微患者|群友|新朋友|新成员|微信用户|患者|未知|匿名)$/.test(n)) return n;
  }
  return "";
}

/** 从 QiWe batchGetUserinfo 联系人对象抽取头像 URL（字段名因协议版本而异） */
function pickContactAvatar(contact){
  const c = contact || {};
  const keys = [
    "avatar", "avatarUrl", "headUrl", "headImgUrl", "head_img_url",
    "smallHeadUrl", "bigHeadUrl", "portrait", "photoUrl", "iconUrl"
  ];
  for(const k of keys){
    const v = clean(c[k], 500);
    if(v && /^https?:\/\//i.test(v)) return v;
  }
  return "";
}

/* 联系人详情-批量：method=/contact/batchGetUserinfo；补齐群成员真实昵称 */
async function batchGetUserinfo(userIdList, cfg){
  const ids = [...new Set((userIdList || []).map(x=>clean(x, 80)).filter(Boolean))];
  if(!ids.length) return [];
  const out = [];
  for(let i=0; i<ids.length; i+=20){
    const chunk = ids.slice(i, i+20);
    const res = await doApi("/contact/batchGetUserinfo", { userIdList:chunk }, cfg);
    const list = (((res || {}).data || {}).contactList) || [];
    out.push(...list);
  }
  return out;
}

function normalizeLinkCard(input){
  const v = input || {};
  const ext = v.external || {};
  return {
    title:clean(v.title || ext.label || ext.title || "相关链接", 120),
    desc:clean(v.desc || v.sub || v.source || ext.service || ext.provider || ext.note || "", 240),
    iconUrl:encodeUrlForWechatFetch(v.iconUrl || v.icon_url || v.thumbUrl || v.thumb_url || v.coverUrl || ext.iconUrl || ext.icon_url || ext.coverUrl || ""),
    linkUrl:clean(v.linkUrl || v.link_url || v.url || ext.url || ext.urlLink || ext.linkUrl || ext.link_url || "", 1000)
  };
}

async function sendLink(toId, card, cfg){
  const target = clean(toId, 80);
  const c = normalizeLinkCard(card);
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  if(!c.title) throw new Error("链接卡片标题为空");
  if(!/^https?:\/\//i.test(c.linkUrl)) throw new Error("链接卡片 URL 非 http(s)");
  const payload = {
    toId:target,
    title:c.title,
    iconUrl:c.iconUrl,
    linkUrl:c.linkUrl,
    desc:c.desc
  };
  try{
    return await doApi("/msg/sendLink", payload, cfg);
  }catch(e){
    // 大图/不可拉取的 iconUrl 会导致整卡发送失败（WxErrorCode -2003）；去掉图标重试，保证链接本身发出。
    if(payload.iconUrl){
      try{ console.error("[qiwe] sendLink 带 icon 失败，去掉 icon 重试：", e && e.message); }catch(_){}
      return await doApi("/msg/sendLink", Object.assign({}, payload, { iconUrl:"" }), cfg);
    }
    throw e;
  }
}

async function sendWeapp(toId, card, cfg){
  const target = clean(toId, 80);
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  const c = normalizeWeappCard(card);
  const missing = missingWeappFields(c);
  if(missing.length) throw new Error("小程序卡片模板字段不完整：" + missing.join("、"));
  return doApi("/msg/sendWeapp", {
    toId:target,
    appId:c.appId,
    coverFileAesKey:c.coverFileAesKey,
    coverFileId:c.coverFileId,
    coverFileSize:Number(c.coverFileSize),
    desc:c.desc || c.title,
    pagePath:c.pagePath,
    thumbUrl:c.thumbUrl,
    title:c.title,
    username:c.username
  }, cfg);
}

async function sendFeedVideo(toId, template, cfg){
  const target = clean(toId, 80);
  const item = template || {};
  const fields = ["channelName", "channelUrl", "coverUrl", "encodeData", "headImgUrl", "feedId", "feedNo", "username"];
  const missing = fields.filter((key)=> !clean(item[key], 4000));
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  if(missing.length) throw new Error("视频号模板字段不完整：" + missing.join("、"));
  const params = { toId:target };
  fields.forEach((key)=>{ params[key] = clean(item[key], key === "encodeData" ? 20000 : 4000); });
  return doApi("/msg/sendFeedVideo", params, cfg);
}

/* 图片上传（api-344613929「本地文件上传」）：POST {doFileApi} multipart/form-data，
   表单字段 method=/cloud/cdnBigUpload、guid、fileType=1(jpg图片)、file=<二进制字节>；header X-QIWEI-TOKEN。
   响应 data 含 sendImage 所需的 fileAesKey、DER fileId(306...)、fileMd5、fileSize。
   DRY_RUN（模块常量）→ 返回桩不真传（fileAesKey/fileId/fileMd5=[dry]、fileSize=buffer 长度），离线可测；
   否则真传后校验 data 有 fileAesKey/fileId/fileMd5/fileSize，缺则抛错（fail-closed，不把朋友圈 /sns/upload 响应误喂给 sendImage）。 */
async function doCdnBigUpload(buffer, filename, cfg, contentType){
  cfg = cfg || loadConfig();
  const buf = Buffer.isBuffer(buffer) ? buffer : (buffer ? Buffer.from(buffer) : null);
  if(!cfg.token) throw new Error("缺少 QiWe Token");
  if(!cfg.guid) throw new Error("缺少 QiWe 实例 GUID");
  if(!buf || !buf.length) throw new Error("上传图片字节为空");
  const url = fileApiUrl(cfg);
  warnHttpOnce(url);
  const res = await postMultipart(url, {
    method:"/cloud/cdnBigUpload",
    guid:cfg.guid,
    fileType:1
  }, {
    name:"file",
    filename:clean(filename, 160) || "image.jpg",
    buffer:buf,
    contentType:contentType || "image/jpeg"
  }, {
    "X-QIWEI-TOKEN":cfg.token
  });
  const code = Number(res && res.code);
  if(Number.isFinite(code) && code !== 0 && code !== 200) throw new Error("QiWe 上传失败：" + code + " " + clean(res && res.msg, 200));
  const d = (res && res.data) || {};
  const fileAesKey = d.fileAesKey || d.fileAeskey;
  if(!fileAesKey || !d.fileId || !d.fileMd5 || !(Number(d.fileSize) > 0))
    throw new Error("QiWe 上传响应缺字段（fileAesKey/fileId/fileMd5/fileSize）");
  return res;
}

async function uploadImage(buffer, filename, cfg){
  cfg = cfg || loadConfig();
  const buf = Buffer.isBuffer(buffer) ? buffer : (buffer ? Buffer.from(buffer) : null);
  if(DRY_RUN){
    console.log("[qiwe][DRY_RUN] uploadImage ->", clean(filename, 80), buf ? buf.length + "B" : "0B");
    return { code:0, msg:"dry_run", data:{ dryRun:true, fileAesKey:"[dry]", fileId:"[dry]", fileMd5:"[dry]", fileSize:buf ? buf.length : 0 } };
  }
  // 护栏 fail-closed（同 sendImage/roomWriteBlocked 语义，真相源=模块常量 DRY_RUN·不读运行时 env）：
  // 非 DRY_RUN + 开关未开 → 拦。纵深防御：uploadImage 被导出可直调，绕过 sendImage 自门控直传 doFileApi（codex 抓的洞）。
  // DRY_RUN 已在上方返桩走不到此处；开关开放行（本人真机测试）。
  if(roomWriteBlocked(DRY_RUN, sendImageExperimentalOn()))
    throw new Error("图片上传未启用：设 QIWE_SENDIMAGE_EXPERIMENTAL=1 显式开启，防意外真传");
  return doCdnBigUpload(buf, filename, cfg, "image/jpeg");
}

/* 小程序贴片自定义封面：CDN 上传换三件套。非「发图给患者」，不走 QIWE_SENDIMAGE_EXPERIMENTAL 门控。 */
async function uploadCdnImageForCover(buffer, filename, cfg, contentType){
  cfg = cfg || loadConfig();
  const buf = Buffer.isBuffer(buffer) ? buffer : (buffer ? Buffer.from(buffer) : null);
  if(DRY_RUN){
    console.log("[qiwe][DRY_RUN] uploadCdnImageForCover ->", clean(filename, 80), buf ? buf.length + "B" : "0B");
    return { code:0, msg:"dry_run", data:{ dryRun:true, fileAesKey:"[dry-cover]", fileId:"306drycover" + String(Date.now()), fileMd5:"[dry]", fileSize:buf ? buf.length : 0 } };
  }
  return doCdnBigUpload(buf, filename, cfg, contentType || "image/jpeg");
}

/* 图片 URL 上传（api-425758709「文件上传-URL」）：作为本地 /cloud/cdnBigUpload 的兜底。
   qiweapi 本地上传在真实环境可能返回上游 i/o timeout；若素材已有公网 https URL，则用本接口换取同样的
   fileAesKey + DER fileId + fileMd5 + fileSize，再交给 /msg/sendImage。 */
async function uploadImageByUrl(fileUrl, filename, cfg){
  cfg = cfg || loadConfig();
  const url = clean(fileUrl, 1000);
  if(DRY_RUN){
    console.log("[qiwe][DRY_RUN] uploadImageByUrl ->", clean(filename, 80), clean(url, 120));
    return { code:0, msg:"dry_run", data:{ dryRun:true, fileAesKey:"[dry]", fileId:"[dry]", fileMd5:"[dry]", fileSize:0, filename:clean(filename, 160) || "image.jpg", cloudUrl:url } };
  }
  if(roomWriteBlocked(DRY_RUN, sendImageExperimentalOn()))
    throw new Error("图片 URL 上传未启用：设 QIWE_SENDIMAGE_EXPERIMENTAL=1 显式开启，防意外真传");
  if(!/^https?:\/\//i.test(url)) throw new Error("图片 URL 非 http(s)");
  const res = await doApi("/cloud/cdnBigUploadByUrl", {
    filename:clean(filename, 160) || "image.jpg",
    fileUrl:url,
    fileType:1
  }, cfg);
  const d = (res && res.data) || {};
  const fileAesKey = d.fileAesKey || d.fileAeskey;
  if(!fileAesKey || !d.fileId || !d.fileMd5 || !(Number(d.fileSize) > 0))
    throw new Error("QiWe URL 上传响应缺字段（fileAesKey/fileId/fileMd5/fileSize）");
  return res;
}

/* 图片消息发送（api-344613915「发送图片消息」）：先 uploadImage 换 fileAesKey/fileId/fileMd5/fileSize，
   再 doApi(/msg/sendImage, {toId, fileAesKey:up.fileAesKey, fileId:up.fileId, fileMd5, fileSize(整数), filename})。
   护栏（照 createRoom/roomWriteBlocked 那套，真相源=模块常量 DRY_RUN·不读运行时 env）：非 DRY_RUN 且 QIWE_SENDIMAGE_EXPERIMENTAL 未开 → 抛错拦截；
   DRY_RUN 放行（uploadImage 返桩 + doApi 返桩，各自处理，sendImage 不另判 DRY_RUN）、开关开放行（本人真机测试）。
   不放宽任何既有真发白名单——本函数只负责"怎么发一张图"，接主投递时真发目标仍受 testToId/idAllowed 约束（不在本函数）。 */
async function sendImage(toId, image, cfg){
  const target = clean(toId, 80);
  image = image || {};
  const buf = Buffer.isBuffer(image.buffer) ? image.buffer : (image.buffer ? Buffer.from(image.buffer) : null);
  const fileUrl = clean(image.fileUrl || image.url, 1000);
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  if((!buf || !buf.length) && !fileUrl) throw new Error("图片字节为空");
  // 护栏 fail-closed（同 roomWriteBlocked 语义）：非 DRY_RUN + 开关未开 → 拦，防意外真发图。
  if(roomWriteBlocked(DRY_RUN, sendImageExperimentalOn()))
    throw new Error("图片真发未启用：设 QIWE_SENDIMAGE_EXPERIMENTAL=1 显式开启，防意外真发图");
  const filename = clean(image.filename, 160) || "image.jpg";
  let up;
  if(buf && buf.length){
    try{
      up = await uploadImage(buf, filename, cfg);
    }catch(e){
      if(!fileUrl) throw e;
      console.warn("[qiwe] uploadImage 本地上传失败，尝试 URL 上传兜底：", filename, "-", e.message);
      up = await uploadImageByUrl(fileUrl, filename, cfg);
    }
  }else{
    up = await uploadImageByUrl(fileUrl, filename, cfg);
  }
  const d = (up && up.data) || {};
  const fileAesKey = d.fileAesKey || d.fileAeskey;
  return doApi("/msg/sendImage", {
    toId:target,
    fileAesKey,
    fileId:d.fileId,
    fileMd5:d.fileMd5,
    fileSize:Number(d.fileSize) || 0,
    filename
  }, cfg);
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/* @所有人真发开关（实验性，默认关）：仅当 QIWE_ATALL_EXPERIMENTAL=1 才允许走 sendHyperText 真发 @；
   运行时读 env（便于切换/测试），默认 OFF → 派发层回落 sendText（正文已含字面"@所有人"作可见兜底）。 */
function atallExperimentalOn(){ return process.env.QIWE_ATALL_EXPERIMENTAL === "1"; }

/* @指定成员真发开关（实验性，默认关）：仅当 QIWE_ATMEMBER_EXPERIMENTAL=1 才允许派发层走 sendHyperText 带 @指定成员。
   与 @所有人开关独立——@指定成员/@所有人 爆炸半径与语义不同，分开控，运营可单独启停。
   注：本开关供 Round 2 派发接线消费；sendHyperText 本身只负责「怎么拼 @ 段」，不自门控（与 atAll 一致）。 */
function atMemberExperimentalOn(){ return process.env.QIWE_ATMEMBER_EXPERIMENTAL === "1"; }

/* 混合文本（支持 @所有人 / @指定成员）。经 doApi、尊重 DRY_RUN、不动 sendText/sendWeapp。
   段格式与顺序按官方文档/示例订正（qiweapi api-344613914「发送混合文本消息」逐字原文）：
     content[].subtype：=0 普通文本（text=正文）；=1 @人（text=对方 userId；text="" 即 @所有人）；=2 系统表情。
     官方示例段顺序为「@段在前、正文段在后」（示例：[{subtype:2,..},{subtype:1,text:""},{subtype:0,text:" 我是智能客服"}]），
     故本函数先拼 @ 段（先 @指定成员、再 @所有人），最后拼正文段。
   @指定成员段 {subtype:1,text:userId}、@所有人段 {subtype:1,text:""} 均依官方文档确认；
   正文段 {subtype:0,text:正文} 2026-06-29 已真机验证（HANDOFF:153，本人测试群 content=[{subtype:1,text:userId},{subtype:0,正文}] 渲染成「@姓名+正文」正常），失败仍回落 sendText。 */
async function sendHyperText(toId, text, opts, cfg){
  opts = opts || {};
  const target = clean(toId, 80);
  let body = clean(text, 3600);
  if(!target) throw new Error("缺少 QiWe 接收方 ID");
  if(!body) throw new Error("发送内容为空");
  // 按官方示例顺序：先 @ 段（先 @指定成员、再 @所有人），最后正文段。
  const content = [];
  const atUserIds = Array.isArray(opts.atUserIds) ? opts.atUserIds : [];
  for(const uid of atUserIds){
    const u = clean(uid, 80);                              // 与现有一致清洗；空/空白跳过，不臆造空 @ 段
    if(u) content.push({ subtype:1, text:u });            // @指定成员（text=对方 userId，官方文档确认）
  }
  if(opts.atAll) content.push({ subtype:1, text:"" });    // @所有人（text="" 即全员，官方文档确认）
  // 有 @ 段时：正文前补分隔，避免客户端渲染成「@姓名拉肚子」黏在一起。
  // 默认空格（官方示例 / AI 回答）；固定模板可传 atBodySep:"\n" 做成「@姓名换行正文」。
  if(content.length && body){
    const sep = opts.atBodySep === "\n" ? "\n" : " ";
    if(sep === "\n"){
      if(!/^\n/.test(body)) body = "\n" + body.replace(/^\s+/, "");
    }else if(!/^\s/.test(body)){
      body = " " + body;
    }
  }
  content.push({ subtype:0, text:body });                 // 正文段（2026-06-29 已真机验证，HANDOFF:153；失败仍回落 sendText）
  return doApi("/msg/sendHyperText", { toId:target, content }, cfg);
}

/* 群内语音转文字（两步：apply→voiceId，query 轮询到 isEnd 取最终 text）。
   DRY_RUN 直接返回桩文本不真调（msgServerId 含 empty/noasr 时返回空，便于测兜底）；
   有界轮询：最多 6 次、间隔 500ms、超时返回空不卡死。字段名 voiceId/text/isEnd 为文档给定，
   仅对响应包裹层（res 顶层 or res.data）做防御性取值，不臆造字段名。 */
async function voiceToText(msgServerId, cfg){
  const sid = clean(msgServerId, 160);
  if(!sid) return "";
  if(DRY_RUN) return /noasr|empty/i.test(sid) ? "" : "[DRY_RUN语音转写] 我想咨询一下复查的事";
  let voiceId = "";
  try{
    const ap = await doApi("/msg/voiceToTextApply", { msgServerId:sid }, cfg);
    const ad = (ap && ap.data) || ap || {};
    voiceId = clean(ad.voiceId || ad.voiceID || "", 160);
  }catch(e){ return ""; }
  if(!voiceId) return "";
  const MAX = 6, INTERVAL = 500;
  for(let i = 0; i < MAX; i++){
    try{
      const q = await doApi("/msg/voiceToTextQuery", { msgServerId:sid, voiceId }, cfg);
      const qd = (q && q.data) || q || {};
      const text = clean(qd.text || "", 1000);
      const isEnd = qd.isEnd === true || qd.isEnd === 1 || qd.isEnd === "1";
      if(isEnd) return text;
      if(text && i === MAX - 1) return text;   // 末次即便未 isEnd 也取已有文本
    }catch(e){ /* 单次查询失败：继续轮询 */ }
    await sleep(INTERVAL);
  }
  return "";   // 超时不卡死
}

/* ===== 群管理能力层（建群/改名/群活码/拉人）。全部复用 doApi 样板：同 endpoint /api/qw/doApi、
   同 header X-QIWEI-TOKEN、同 DRY_RUN 处理、同 cfg/guid 取法（guid 由 doApi 统一注入 params）、同错误处理。
   method 字符串照抄 qiweapi 官方文档，不改不猜。本批仅能力层 + DRY_RUN 离线测试：不接主流程、不自动建群
   （何时自动建 = 后续编排，不在本批）。真建群/真拉人副作用重且难撤销 → createRoom/inviteRoomMember
   自带护栏（cc1 裁定）：非 DRY_RUN 且实验开关未开即抛错；modifyRoomName(改已建群名)/getRoomQrCode(只读)低危不门控。 ===== */

/* 真实建群/拉人实验开关（默认关）：仿 atallExperimentalOn/atMemberExperimentalOn（运行时读 env）。
   createRoom/inviteRoomMember 自门控消费它；后续编排/派发层真发前也应再过此闸。
   注：QIWE_DRY_RUN 默认是「关」（即默认真发），故真建群/真拉人不靠"调用方记得开 DRY_RUN"，
   而靠此开关默认关 + 自门控 fail-closed —— 防"配了 token 的环境忘开 DRY_RUN 一次误调就真建群/真骚扰"。 */
function createRoomExperimentalOn(){ return process.env.QIWE_CREATEROOM_EXPERIMENTAL === "1"; }

/* 图片真发实验开关（默认关）：仿 createRoomExperimentalOn（运行时读 env）。sendImage 自门控消费它（见下）；
   818 海报接线/派发层真发前也应再过此闸。真图片发送=向真实联系人/群发媒体，副作用可见且难撤销 →
   靠此开关默认关 + 自门控 fail-closed，防"配了 token 的环境忘开 DRY_RUN 一次误调就真发图"。 */
function sendImageExperimentalOn(){ return process.env.QIWE_SENDIMAGE_EXPERIMENTAL === "1"; }

/* 真发写操作护栏（纯函数，便于单测）：非 DRY_RUN（doApi 会真发）且实验开关未开 → 拦(true)；其余放行(false)。
   真相源 = 模块常量 DRY_RUN（本文件第 9 行，与 doApi 同源），**不读运行时 process.env** —— 杜绝
   「启动真发模式 + 运行时把 env 改成 DRY_RUN」绕过自门控（codex 复核抓出的洞）。
   恒等保证：门控放行 ⟺ doApi 真发，二者同源不脱节。 */
function roomWriteBlocked(dryRun, expOn){ return !dryRun && !expOn; }

/* 群成员 userId 列表清洗：去空 + 去重 + 单项截断（参照 sendHyperText 里 atUserIds 的 clean(uid,80)）。
   建群/拉人共用，避免空串/重复 userId 进 params。 */
function cleanMemberList(list){
  const seen = new Set();
  const out = [];
  for(const v of (Array.isArray(list) ? list : [])){
    const u = clean(v, 80);
    if(u && !seen.has(u)){ seen.add(u); out.push(u); }
  }
  return out;
}

/* 建群：method=/room/createRoom；params{ guid(doApi 注入), isOuterRoom, memberList }。返回含新群 roomId。
   isOuterRoom 默认 1=外部群（含外部联系人），传 0=内部群；按官方为整数。 */
async function createRoom(memberList, opts, cfg){
  opts = opts || {};
  // 自门控护栏（cc1 裁定 + codex 修）：真建群=建真实企微群，副作用重且难撤销。真相源 = 模块常量 DRY_RUN
  // （与 doApi 同源，不读运行时 env）：非 DRY_RUN（doApi 会真发）且实验开关未开即抛错 —— 防"配了 token 的环境忘开 DRY_RUN 误调就真建群"。
  // DRY_RUN 放行（离线测试不受影响）、开关开放行（本人真机测试）。
  if(roomWriteBlocked(DRY_RUN, createRoomExperimentalOn()))
    throw new Error("真建群未启用：设 QIWE_CREATEROOM_EXPERIMENTAL=1 显式开启，防意外真建群");
  const members = cleanMemberList(memberList);
  if(!members.length) throw new Error("建群成员列表为空");
  const isOuterRoom = Number.isFinite(Number(opts.isOuterRoom)) ? Math.trunc(Number(opts.isOuterRoom)) : 1;   // opts.isOuterRoom ?? 1（整数）
  if(DRY_RUN){
    // 编排层需要可落库的 roomId：桩返回 dry-room-*，与真机 data.roomId 同字段。
    const stubId = "dry-room-" + Date.now();
    console.log("[qiwe][DRY_RUN] /room/createRoom -> members", members.length, "stub", stubId);
    return { code:0, msg:"dry_run", data:{ dryRun:true, method:"/room/createRoom", params:{ guid:(cfg||loadConfig()).guid, isOuterRoom, memberList:members }, roomId:stubId } };
  }
  return doApi("/room/createRoom", { isOuterRoom, memberList:members }, cfg);
}

/* 从 createRoom 响应抽出 roomId（官方 data.roomId；兼容若干别名）。 */
function extractCreatedRoomId(res){
  const d = (res && res.data) || res || {};
  return clean(d.roomId || d.room_id || d.chatRoomId || d.chat_room_id || d.fromRoomId || "", 80);
}

/* 解析医助手填成员：数组或逗号/空白/分号分隔字符串 → 去空去重。 */
function parseMemberIdInput(input){
  if(Array.isArray(input)) return cleanMemberList(input);
  const raw = String(input == null ? "" : input);
  return cleanMemberList(raw.split(/[\s,;，；\n\r\t]+/));
}

/* 改群名：method=/room/modifyRoomName；params{ guid, roomId, name }。 */
async function modifyRoomName(roomId, name, cfg){
  const rid = clean(roomId, 80);
  const nm = clean(name, 120);
  if(!rid) throw new Error("缺少 QiWe 群 roomId");
  if(!nm) throw new Error("群名为空");
  return doApi("/room/modifyRoomName", { roomId:rid, name:nm }, cfg);
}

/* 取群二维码（=群活码）：method=/room/getRoomQrCode；params{ guid, roomId }。 */
async function getRoomQrCode(roomId, cfg){
  const rid = clean(roomId, 80);
  if(!rid) throw new Error("缺少 QiWe 群 roomId");
  return doApi("/room/getRoomQrCode", { roomId:rid }, cfg);
}

/* 拉人进群：method=/room/inviteRoomMember；params{ guid, roomId, memberList }。 */
async function inviteRoomMember(roomId, memberList, cfg){
  // 自门控护栏（cc1 裁定 + codex 修）：真拉人进群=向真实用户发起入群，副作用重且难撤销。真相源 = 模块常量 DRY_RUN
  // （与 doApi 同源，无运行时 env 绕过）：非 DRY_RUN 且实验开关未开即抛错 —— 防"配 token 的环境忘开 DRY_RUN 误调就真拉人骚扰"。
  if(roomWriteBlocked(DRY_RUN, createRoomExperimentalOn()))
    throw new Error("真拉人进群未启用：设 QIWE_CREATEROOM_EXPERIMENTAL=1 显式开启，防意外真拉人");
  const rid = clean(roomId, 80);
  const members = cleanMemberList(memberList);
  if(!rid) throw new Error("缺少 QiWe 群 roomId");
  if(!members.length) throw new Error("拉群成员列表为空");
  return doApi("/room/inviteRoomMember", { roomId:rid, memberList:members }, cfg);
}

/* 群风控极端处置（待办#15）：踢人 / 撤回。默认关；须 QIWE_MODERATION_ENFORCE_EXPERIMENTAL=1。
   优先医助人工点按钮；仅极端高危且开自动闸时才会被调用。DRY_RUN 走桩。 */
function moderationEnforceExperimentalOn(){
  return process.env.QIWE_MODERATION_ENFORCE_EXPERIMENTAL === "1";
}
async function removeRoomMember(roomId, memberList, cfg){
  if(roomWriteBlocked(DRY_RUN, moderationEnforceExperimentalOn()))
    throw new Error("群风控踢人未启用：设 QIWE_MODERATION_ENFORCE_EXPERIMENTAL=1 显式开启，或 DRY_RUN=1 走桩");
  const rid = clean(roomId, 80);
  const members = cleanMemberList(memberList);
  if(!rid) throw new Error("缺少 QiWe 群 roomId");
  if(!members.length) throw new Error("踢人成员列表为空");
  return doApi("/room/removeRoomMember", { roomId:rid, memberList:members }, cfg);
}
async function revokeMessage(msgId, cfg){
  if(roomWriteBlocked(DRY_RUN, moderationEnforceExperimentalOn()))
    throw new Error("群风控撤回未启用：设 QIWE_MODERATION_ENFORCE_EXPERIMENTAL=1 显式开启，或 DRY_RUN=1 走桩");
  const mid = clean(msgId, 160);
  if(!mid) throw new Error("缺少 msgId");
  return doApi("/msg/revokeMsg", { msgId:mid }, cfg);
}

function id(v){
  const s = clean(v, 80);
  return s === "0" ? "" : s;
}

function dataObj(v){
  if(!v) return {};
  if(typeof v === "object") return v;
  try{ return JSON.parse(v); }catch(e){ return {}; }
}

function extractEvents(body){
  if(Array.isArray(body)) return body;
  if(body && Array.isArray(body.data)) return body.data;
  if(body && body.data && typeof body.data === "object") return [body.data];
  if(body && (body.cmd || body.msgType || body.msgData)) return [body];
  return [];
}

/* 企微图片 msgType=14；个微图片 msgType=101（官方回调结构说明）。 */
function isImageMsgType(msgType){
  const n = Number(msgType);
  return n === 14 || n === 101;
}

/* 从图片回调 msgData 抽出可尝试访问的 HTTP 链（大图 > 中图 > 缩略图）。 */
function extractImageHttpUrls(msgData){
  const md = msgData && typeof msgData === "object" ? msgData : {};
  const keys = [
    "localPreviewUrl", "_localPreviewUrl", "cloudUrl",
    "fileBigHttpUrl", "fileMiddleHttpUrl", "fileThumbHttpUrl",
    "fileHttpUrl", "imageUrl", "url"
  ];
  const out = [];
  for(const k of keys){
    const v = clean(md[k], 2000);
    if((/^https?:\/\//i.test(v) || /^\/uploads\/qiwe-media\//i.test(v)) && !out.includes(v)) out.push(v);
  }
  const nested = md.localPreviewUrls || md._localPreviewUrls || md._remotePreviewUrls;
  if(Array.isArray(nested)){
    for(const x of nested){
      const v = clean(x, 2000);
      if((/^https?:\/\//i.test(v) || /^\/uploads\/qiwe-media\//i.test(v)) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

function imageDownloadParams(msgData, msgType){
  const md = msgData && typeof msgData === "object" ? msgData : {};
  const fileAeskey = clean(md.fileAeskey || md.fileAesKey || md.aesKey || md.aeskey, 200);
  const fileId = clean(md.fileId || md.file_id || md.cdnFileId, 800);
  const fileSize = Number(md.fileSize || md.fileBigSize || md.fileMiddleSize || md.size || 0) || 0;
  const imageHasHd = md.imageHasHd === true || md.imageHasHd === 1 || md.image_has_hd === true || md.image_has_hd === 1;
  // 官方：imageHasHd=1 → fileType=1 大图；否则 2 小图
  const fileType = imageHasHd ? 1 : 2;
  if(!fileAeskey || !fileId || !(fileSize > 0)) return null;
  // 个微 101 常无 DER fileId，仅企微 14 走 /cloud/wxWorkDownload
  if(Number(msgType) === 101 && !/^306/.test(fileId)) return null;
  return { fileAeskey, fileId, fileSize, fileType };
}

/* 个微图片 msgType=101：/cloud/wxDownload（fileAuthKey + fileUrl，非 wxWorkDownload）。 */
function wxPersonalDownloadParams(msgData, msgType, preferFileType){
  if(Number(msgType) !== 101) return null;
  const md = msgData && typeof msgData === "object" ? msgData : {};
  const fileAeskey = clean(md.fileAeskey || md.fileAesKey, 200);
  const fileAuthkey = clean(md.fileAuthkey || md.fileAuthKey, 800);
  if(!fileAeskey || !fileAuthkey) return null;
  const imageHasHd = md.imageHasHd === true || md.imageHasHd === 1;
  const candidates = [
    { fileType:2, fileUrl:clean(md.fileMiddleHttpUrl, 2000), fileSize:Number(md.fileMiddleSize)||0 },
    { fileType:3, fileUrl:clean(md.fileThumbHttpUrl, 2000), fileSize:Number(md.fileThumbSize)||0 },
    { fileType:imageHasHd ? 1 : 2, fileUrl:clean(md.fileBigHttpUrl, 2000), fileSize:Number(md.fileBigSize)||0 }
  ];
  if(Number(preferFileType) > 0){
    const hit = candidates.find(c => c.fileType === Number(preferFileType));
    if(hit && hit.fileUrl && hit.fileSize > 0) return Object.assign({ fileAeskey, fileAuthkey }, hit);
  }
  for(const c of candidates){
    if(c.fileUrl && c.fileSize > 0) return Object.assign({ fileAeskey, fileAuthkey }, c);
  }
  return null;
}

async function downloadWxPersonalFile(msgData, msgType, cfg, preferFileType){
  const p = wxPersonalDownloadParams(msgData, msgType, preferFileType);
  if(!p) throw new Error("个微图片下载缺字段（fileAesKey/fileAuthKey/fileUrl）");
  if(DRY_RUN){
    return { code:0, msg:"dry_run", data:{ dryRun:true, cloudUrl:"https://example.com/dry-run-wx-personal.jpg" } };
  }
  const res = await doApi("/cloud/wxDownload", p, cfg);
  const d = (res && res.data) || res || {};
  const cloudUrl = clean(d.cloudUrl || d.url || d.fileUrl, 2000);
  if(!cloudUrl) throw new Error("个微下载响应缺 cloudUrl");
  return res;
}

/* GET 二进制（下载临时 cloudUrl / imunion 链）。短超时，失败返回 null。 */
function getUrlBuffer(url, timeoutMs, redirectLeft){
  const target = clean(url, 2000);
  if(!/^https?:\/\//i.test(target)) return Promise.resolve(null);
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : Math.min(HTTP_TIMEOUT_MS, 4000);
  const left = Number.isFinite(redirectLeft) ? Math.max(0, redirectLeft) : 2;
  return new Promise((resolve)=>{
    let done = false;
    const finish = (v)=>{ if(done) return; done = true; resolve(v); };
    try{
      const u = new URL(target);
      const mod = u.protocol === "https:" ? https : http;
      const req = mod.request({
        method:"GET",
        hostname:u.hostname,
        port:u.port || (u.protocol === "https:" ? 443 : 80),
        path:u.pathname + u.search,
        headers:{
          // 模拟浏览器 UA：部分企微/云存储临时链会按 UA 做风控/判定
          "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        }
      }, r=>{
        // 跟随简单重定向：部分临时链可能先回 302
        if(r && r.statusCode >= 300 && r.statusCode < 400 && r.headers && r.headers.location && left > 0){
          const loc = String(r.headers.location || "");
          try{
            const nextUrl = new URL(loc, target).toString();
            r.resume();
            getUrlBuffer(nextUrl, ms, left - 1).then(finish).catch(()=>finish(null));
          }catch(_){
            try{ r.resume(); }catch(_2){}
            finish(null);
          }
          return;
        }
        const chunks = [];
        let total = 0;
        const MAX = 8 * 1024 * 1024;
        r.on("data", c=>{
          total += c.length;
          if(total > MAX){ try{ req.destroy(); }catch(_){} return finish(null); }
          chunks.push(c);
        });
        r.on("end", ()=>{
          if(r.statusCode < 200 || r.statusCode >= 300) return finish(null);
          const buf = Buffer.concat(chunks);
          finish(buf.length ? buf : null);
        });
      });
      req.on("error", ()=>finish(null));
      req.setTimeout(ms, ()=>{ try{ req.destroy(); }catch(_){} finish(null); });
      req.end();
    }catch(e){ finish(null); }
  });
}

/* 企微文件下载（api-399776006 /cloud/wxWorkDownload）→ 临时 cloudUrl。下载接口只读，无实验开关门控。 */
async function downloadWxWorkFile(params, cfg){
  const p = params || {};
  const fileAeskey = clean(p.fileAeskey || p.fileAesKey, 200);
  const fileId = clean(p.fileId, 800);
  const fileSize = Number(p.fileSize) || 0;
  const fileType = Number(p.fileType) || 2;
  if(!fileAeskey || !fileId || !(fileSize > 0)) throw new Error("图片下载缺字段（fileAeskey/fileId/fileSize）");
  if(DRY_RUN){
    return { code:0, msg:"dry_run", data:{ dryRun:true, cloudUrl:"https://example.com/dry-run-qiwe-image.jpg" } };
  }
  const res = await doApi("/cloud/wxWorkDownload", {
    fileAeskey,
    fileId,
    fileSize,
    fileType
  }, cfg);
  const d = (res && res.data) || res || {};
  const cloudUrl = clean(d.cloudUrl || d.url || d.fileUrl, 2000);
  if(!cloudUrl) throw new Error("QiWe 下载响应缺 cloudUrl");
  return res;
}

/* 成员变更入群 msgType：2118（文档/旧样本）、1005（changedMemberId）、1002（changedMemberList，真机 2026-07-17）。 */
function isMemberJoinMsgType(msgType){
  const n = Number(msgType);
  return n === 2118 || n === 1005 || n === 1002;
}

/* changedMemberList 真机可为对象数组，也可能为 base64 编码的 userId 串（如 Nzg4MTMwMTY3NTMzODQzNw==）。 */
function expandJoinMemberListValue(v){
  if(v == null) return [];
  if(Array.isArray(v)) return v;
  if(typeof v === "object") return [v];
  const s = String(v).trim();
  if(!s) return [];
  if(/^\d{5,}$/.test(s)) return [s];
  if(/[+/=]/.test(s) || (/^[A-Za-z0-9+/]+=*$/.test(s) && /[A-Za-z]/.test(s))){
    try{
      const decoded = Buffer.from(s, "base64").toString("utf8").trim();
      if(/^\d{5,}$/.test(decoded)) return [decoded];
      const parts = decoded.split(/[,;|\s]+/).map(x=>x.trim()).filter(x=>/^\d{5,}$/.test(x));
      if(parts.length) return parts;
    }catch(e){}
  }
  try{
    const j = JSON.parse(s);
    if(Array.isArray(j)) return j;
    if(j && typeof j === "object") return [j];
  }catch(e){}
  return s.split(/[,;|\s]+/).map(x=>x.trim()).filter(x=>/^\d{5,}$/.test(x));
}

function collectJoinUserIds(raw, msgData){
  const seen = new Set();
  const out = [];
  const push = (v)=>{
    const uid = id(v);
    if(!uid || seen.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };
  const pushMaybeObject = (item)=>{
    if(item == null) return;
    if(Array.isArray(item)){
      item.forEach(pushMaybeObject);
      return;
    }
    if(typeof item === "object"){
      push(item.userId || item.memberId || item.joinUserId || item.changedMemberId || item.newUserId || item.externalUserId || item.external_userid);
      return;
    }
    push(item);
  };
  const pushJoinListField = (item)=>{
    expandJoinMemberListValue(item).forEach(pushMaybeObject);
  };
  [
    msgData && msgData.changedMemberId,
    msgData && msgData.joinUserId,
    raw && raw.joinUserId,
    raw && raw.newUserId,
    raw && raw.memberId,
    raw && raw.joinMemberId,
    raw && raw.externalUserId,
    raw && raw.external_userid
  ].forEach(push);
  [
    msgData && msgData.changedMemberList,
    msgData && msgData.changedMemberIdList,
    msgData && msgData.changedMemberIds,
    msgData && msgData.joinUserList,
    msgData && msgData.joinUserIdList,
    msgData && msgData.joinUserIds,
    msgData && msgData.newUserList,
    msgData && msgData.newUserIdList,
    msgData && msgData.newUserIds,
    msgData && msgData.memberList,
    msgData && msgData.memberIdList,
    msgData && msgData.memberIds,
    raw && raw.changedMemberList,
    raw && raw.changedMemberIdList,
    raw && raw.changedMemberIds,
    raw && raw.joinUserList,
    raw && raw.joinUserIdList,
    raw && raw.joinUserIds,
    raw && raw.newUserList,
    raw && raw.newUserIdList,
    raw && raw.newUserIds,
    raw && raw.memberList,
    raw && raw.memberIdList,
    raw && raw.memberIds
  ].forEach(pushJoinListField);
  return out;
}

/* 归一化 qiwe 回调事件。识别消息类（cmd=15000）：文本(0/2)、小程序(78)、语音(16)、图片(14/101)、成员变更入群(2118/1005/1002+changedMemberId/List，真机抓包扩展兼容)。 */
function normalizeEvent(raw, cfg){
  raw = raw || {};
  cfg = cfg || loadConfig();
  const msgData = dataObj(raw.msgData);
  const msgType = Number(raw.msgType);
  const fromRoomId = id(raw.fromRoomId || raw.roomId || raw.chatRoomId);
  const senderId = id(raw.senderId || raw.fromId || raw.fromUserId);
  const receiverId = id(raw.receiverId || raw.toId || raw.toUserId);
  const loggedInUserId = id(raw.userId || cfg.selfUserId);
  const joinUserIds = collectJoinUserIds(raw, msgData);
  const joinUserId = joinUserIds[0] || "";
  const isGroup = !!fromRoomId;
  const replyToId = isGroup ? fromRoomId : (senderId || receiverId);
  const isMemberJoin = isMemberJoinMsgType(msgType) && !!joinUserId && isGroup;
  const isImage = isImageMsgType(msgType);
  return {
    raw,
    msgData,
    cmd:Number(raw.cmd),
    msgType,
    isText:msgType === 0 || msgType === 2,
    isWeapp:msgType === 78 || !!(msgData && (msgData.appId || msgData.app_id) && (msgData.pagePath || msgData.page_path || msgData.path)),
    isFeedVideo:msgType === 141,
    isImage,
    isMemberJoin,
    isRoomNotice:!!(raw.isRoomNotice || msgData.isRoomNotice),
    joinUserId,
    joinUserIds,
    isGroup,
    fromRoomId,
    senderId,
    receiverId,
    loggedInUserId,
    replyToId,
    senderName:clean(
      raw.senderName || raw.fromName || raw.senderNick || raw.nickName || raw.nickname || raw.remarkName || raw.roomRemarkName
      || msgData.senderName || msgData.fromName || msgData.nickName || msgData.nickname || msgData.remarkName || msgData.roomRemarkName
      || msgData.name || raw.name
      || "企微患者", 80),
    text:clean(msgData.content || raw.content || raw.text || "", 1000),
    externalMsgId:clean(raw.msgUniqueIdentifier || raw.msgServerId || raw.seq || raw.msgId, 160),
    isFromSelf:!!(senderId && (senderId === cfg.selfUserId || senderId === loggedInUserId))
  };
}

module.exports = {
  DEFAULT_API_URL,
  DEFAULT_FILE_API_URL,
  DRY_RUN,
  loadConfig,
  publicConfig,
  saveConfig,
  getAccountState,
  upsertAccountState,
  parseTestToIdList,
  ensureRoomInTestToId,
  rebuildTestToIdFromBusinessGroups,
  isConfigured,
  isCleartextEndpoint,
  warnHttpOnce,
  doApi,
  postJson,
  // postMultipart 不导出（图片上传专用原始网络写函数，仅 uploadImage 内部调用；导出会给外部
  // 绕过 uploadImage 护栏直传 /doFileApi 的面——codex 第三轮抓）。保留导出 buildMultipartBody（纯拼 Buffer·零网络）+ fileApiUrl（纯算 URL）供测试。
  buildMultipartBody,
  fileApiUrl,
  sendText,
  normalizeLinkCard,
  sendLink,
  sendWeapp,
  sendFeedVideo,
  sendHyperText,
  voiceToText,
  uploadImage,
  uploadCdnImageForCover,
  uploadImageByUrl,
  sendImage,
  sendImageExperimentalOn,
  createRoom,
  extractCreatedRoomId,
  parseMemberIdInput,
  modifyRoomName,
  getRoomQrCode,
  inviteRoomMember,
  removeRoomMember,
  revokeMessage,
  moderationEnforceExperimentalOn,
  createRoomExperimentalOn,
  roomWriteBlocked,
  atallExperimentalOn,
  atMemberExperimentalOn,
  normalizeWeappCard,
  missingWeappFields,
  isWeappReady,
  saveWeappTemplate,
  loadWeappTemplate,
  loadWeappTemplates,
  syncWeappTemplatesFromRules,
  publicWeappTemplates,
  extractEvents,
  normalizeEvent,
  isMemberJoinMsgType,
  expandJoinMemberListValue,
  isImageMsgType,
  extractImageHttpUrls,
  imageDownloadParams,
  wxPersonalDownloadParams,
  getUrlBuffer,
  downloadWxWorkFile,
  downloadWxPersonalFile,
  decodeMaybeBase64,
  pickContactDisplayName,
  pickContactAvatar,
  batchGetUserinfo
};
