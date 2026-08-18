/* Agent 工具：春雨卡 / 菜单 / 交接 */
const { db } = require("../db.js");
const { buildMenuText } = require("../patient_reply.js");
const triage = require("../triage.js");

function loadCodeResponses(doctorId, code){
  let responses = [];
  try{
    const r = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=? AND enabled=1").get(Number(doctorId), String(code));
    const parsed = r && r.responses ? JSON.parse(r.responses) : [];
    responses = Array.isArray(parsed) ? parsed : [];
  }catch(e){ responses = []; }
  return responses;
}

function cardResponsesOnly(responses){
  return (responses || []).filter(x=>{
    if(!x || typeof x !== "object" || x.type === "text" || x.type === "popup") return false;
    if(x.type === "mp" || x.type === "link" || x.type === "qr") return true;
    const ext = x.external || {};
    return ext.mode === "mini_program" || !!ext.shortLink || !!ext.url;
  }).slice(0, 3);
}

function runTools(doctorId, toolCalls, ctx){
  ctx = ctx || {};
  const out = { responses:[], menuText:null, codes:[], handoff:false, handoffReason:null };
  for(const call of (toolCalls || [])){
    const name = call && call.name;
    const args = (call && call.args) || {};
    if(name === "open_chunyu_card"){
      // allowCard===true：显式服务诉求（找医生/挂号等）已放行，不再用 level 二次否决
      // allowCard===false：硬禁止
      // allowCard 未显式 true：仍按 L2/L5 档位 fail-closed
      if(ctx.allowCard === false) continue;
      if(ctx.allowCard !== true && ctx.level != null && !triage.canAttachMiniProgram(ctx.level, ctx)){
        continue;
      }
      const code = String(args.code || "101");
      const cards = cardResponsesOnly(loadCodeResponses(doctorId, code));
      if(cards.length){
        out.responses.push(...cards);
        out.codes.push(code);
      }else{
        // 无卡时退化为 triage.attachCardResponses；仍无则占位 link 提示（本地可无模板）
        const attached = triage.attachCardResponses(doctorId, code);
        if(attached.length){
          out.responses.push(...attached);
          out.codes.push(code);
        }else{
          out.responses.push({
            type:"text",
            text:`（本地提示）已为您准备功能入口「${code}」。配置小程序卡片模板后可直接点开春雨医生。`
          });
          out.codes.push(code);
        }
      }
    }else if(name === "open_menu"){
      let content = {};
      try{ content = JSON.parse((db.prepare("SELECT content FROM doctors WHERE id=?").get(Number(doctorId)) || {}).content || "{}"); }catch(e){ content = {}; }
      out.menuText = buildMenuText(content);
      out.responses.push({ type:"text", text:out.menuText });
    }else if(name === "handoff_human"){
      out.handoff = true;
      out.handoffReason = args.reason || "human";
    }
    // reply_text / ask_clarify 由 Composer 产出正文
  }
  return out;
}

module.exports = { runTools, loadCodeResponses, cardResponsesOnly };
