/* 606 科普卡门控 + 医生主页报道可展示内容：
   无可用科普文章时不发卡链；有内容后按 scienceArticles 重新生成 link 响应。
   主页「报道」仅展示春雨域名链接（可贴图），其它外链不进入患者可见列表。 */
const CHUNYU_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*chunyuyisheng\.com(\/|$)/i;

function parseDoctorContent(raw){
  if(!raw) return {};
  if(typeof raw === "object") return raw;
  try{ return JSON.parse(raw || "{}") || {}; }catch(e){ return {}; }
}

function isChunyuUrl(url){
  const u = String(url || "").trim();
  return !!u && CHUNYU_HOST_RE.test(u);
}

/* 规范化 content.scienceArticles：仅保留有标题+合法 http(s) 链的条目 */
function normalizeScienceArticles(content){
  const c = parseDoctorContent(content);
  const list = Array.isArray(c.scienceArticles) ? c.scienceArticles : [];
  const out = [];
  const seen = new Set();
  list.forEach(item=>{
    if(!item || typeof item !== "object") return;
    const title = String(item.title || item.t || "").trim().slice(0, 120);
    const url = String(item.url || item.link || "").trim();
    if(!title || !/^https?:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push({
      title,
      url,
      source: String(item.source || item.provider || "春雨医生 · 科普").trim().slice(0, 80) || "春雨医生 · 科普",
      label: String(item.label || title).trim().slice(0, 120),
      img: String(item.img || item.image || item.thumb || "").trim().slice(0, 240)
    });
  });
  return out.slice(0, 12);
}

function hasScienceContent(content){
  return normalizeScienceArticles(content).length > 0;
}

function buildScienceLinkResponses(articles){
  return (articles || []).map(a=>({
    type:"link",
    title:a.title,
    source:a.source,
    thumb:"mpScience",
    external:{
      provider:a.source,
      label:a.label || a.title,
      service:"医生科普",
      url:a.url
    },
    ctaLabel:"打开科普内容",
    fallbackPage:"accounts",
    scienceGate:true
  }));
}

/* 从医生 content 同步 606 卡片响应：无文章 → 空数组（仅靠 code606 话术）；有文章 → 重建 link 卡 */
function scienceResponsesFromContent(content){
  const articles = normalizeScienceArticles(content);
  if(!articles.length) return [];
  return buildScienceLinkResponses(articles);
}

function isScienceCardResponse(r){
  if(!r || typeof r !== "object") return false;
  if(r.scienceGate === true) return true;
  const type = String(r.type || "");
  if(type !== "link" && type !== "mp" && type !== "weapp") return false;
  const page = String(r.page || r.fallbackPage || "");
  if(page === "accounts" || page.indexOf("article") === 0) return true;
  const ext = r.external || {};
  if(ext.url || ext.shortLink || r.url) return true;
  return type === "mp" || type === "weapp";
}

/* 606：无科普内容则剥掉卡片类响应，保留 text；有内容则用 content 重建卡（替换旧卡） */
function gateScienceCodeResponses(code, responses, content){
  const c = String(code == null ? "" : code).trim();
  if(c !== "606" && c !== "科普" && c !== "科普专栏") return Array.isArray(responses) ? responses : [];
  const list = Array.isArray(responses) ? responses.slice() : [];
  const articles = normalizeScienceArticles(content);
  if(!articles.length){
    return list.filter(r=>r && r.type === "text");
  }
  const texts = list.filter(r=>r && r.type === "text");
  return texts.concat(buildScienceLinkResponses(articles));
}

/* 主页「报道」：仅春雨域名 + 可选配图；无 url 或非春雨域 → 不展示 */
function normalizeHomepageNews(content){
  const c = parseDoctorContent(content);
  const profile = (c.doctorProfile && typeof c.doctorProfile === "object") ? c.doctorProfile : {};
  const list = Array.isArray(profile.news) ? profile.news : [];
  const out = [];
  list.forEach(item=>{
    if(!item || typeof item !== "object") return;
    const t = String(item.t || item.title || "").trim().slice(0, 120);
    const d = String(item.d || item.date || item.sub || "").trim().slice(0, 80);
    const url = String(item.url || item.link || "").trim();
    const img = String(item.img || item.image || "").trim().slice(0, 240);
    if(!t || !isChunyuUrl(url)) return;
    out.push({ t, d, url, img });
  });
  return out.slice(0, 20);
}

module.exports = {
  isChunyuUrl,
  parseDoctorContent,
  normalizeScienceArticles,
  hasScienceContent,
  buildScienceLinkResponses,
  scienceResponsesFromContent,
  isScienceCardResponse,
  gateScienceCodeResponses,
  normalizeHomepageNews
};
