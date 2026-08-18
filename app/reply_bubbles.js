/* 患者可见回复分条：超长或含句号时拆成多条群消息（更像真人连发）
 * 空行分段优先拆成独立气泡，不再用空行留在同一条消息里 */
const opsConfig = require("./ops_config.js");

const SPLIT_MIN_TOTAL = 120;
const SPLIT_MAX_BUBBLE = 280;
const SPLIT_DELAY_MS = 420;

function clampInt(v, fallback, min, max){
  const n = Number(String(v == null ? "" : v).trim());
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function resolveReplyBubbleConfig(doctorId){
  const cfg = opsConfig.prompts(doctorId);
  let minTotal = cfg.replySplitMinTotal;
  let maxBubble = cfg.replySplitMaxBubble;
  // 旧默认 48/96 会把分段细聊撕碎；视为未配置，改用新默认
  if(minTotal == null || String(minTotal).trim() === "" || Number(minTotal) === 48) minTotal = SPLIT_MIN_TOTAL;
  if(maxBubble == null || String(maxBubble).trim() === "" || Number(maxBubble) === 96) maxBubble = SPLIT_MAX_BUBBLE;
  return {
    minTotal: clampInt(minTotal, SPLIT_MIN_TOTAL, 24, 500),
    maxBubble: clampInt(maxBubble, SPLIT_MAX_BUBBLE, 36, 520),
    delayMs: clampInt(cfg.replySplitDelayMs, SPLIT_DELAY_MS, 0, 3000)
  };
}

function splitBySentence(text, maxBubble){
  const t = String(text || "").trim();
  if(!t) return [];
  if(t.length <= maxBubble) return [t];
  const sentences = t.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [t];
  const out = [];
  let buf = "";
  const flush = ()=>{
    const s = buf.trim();
    if(s) out.push(s);
    buf = "";
  };
  sentences.forEach(raw=>{
    const s = String(raw || "").trim();
    if(!s) return;
    if(!buf){
      buf = s;
      if(buf.length >= maxBubble) flush();
      return;
    }
    const combined = buf + s;
    if(combined.length <= maxBubble) buf = combined;
    else{
      flush();
      buf = s;
      if(buf.length >= maxBubble) flush();
    }
  });
  flush();
  return out.length ? out : [t];
}

function splitReplyBubbles(text, cfg){
  cfg = cfg || {};
  const minTotal = clampInt(cfg.minTotal, SPLIT_MIN_TOTAL, 24, 500);
  const maxBubble = clampInt(cfg.maxBubble, SPLIT_MAX_BUBBLE, 36, 520);
  const t = String(text == null ? "" : text).trim();
  if(!t) return [];

  // 空行 = 多条消息：每段单独发，过长段再按句拆
  if(/\n\s*\n/.test(t)){
    const paras = t.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    if(paras.length >= 2){
      const out = [];
      paras.forEach(p=>{
        splitBySentence(p, maxBubble).forEach(x=>out.push(x));
      });
      return out.length ? out : [t];
    }
  }

  if(t.length < minTotal) return [t];

  const out = splitBySentence(t, maxBubble);

  if(out.length <= 1 && t.length >= minTotal){
    const m = t.match(/^(.+?[。！？!?])([\s\S]+)$/);
    if(m && m[1] && m[2] && m[2].trim().length >= 6){
      return [m[1].trim(), m[2].trim()];
    }
  }
  return out.length ? out : [t];
}

function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve, ms));
}

module.exports = { splitReplyBubbles, resolveReplyBubbleConfig, SPLIT_MIN_TOTAL, SPLIT_MAX_BUBBLE, SPLIT_DELAY_MS, sleep };
