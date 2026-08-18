/* 服务端关键词规则引擎：从 DB 读规则，匹配患者输入 */
const { db } = require("./db.js");
const { scanRisk } = require("./triage.js");   // 仅用其确定性本地风险扫描（纯函数，triage 不反向依赖 engine）

function norm(s){ return (s||"").trim().toLowerCase(); }

function isMenuIntent(t){
  return /(?:这里|这群|这个群|群里|你|机器人|医助|助手|小助手).{0,8}(?:能干嘛|能做什么|可以干嘛|可以做什么|有什么用|怎么用|如何用|有哪些功能|有什么功能|有什么服务|能帮(?:我)?什么)/i.test(t);
}

function match(doctorId, text){
  const t = norm(text);
  if(!t) return null;
  const menuIntent = t==="1"||t==="菜单"||t==="功能"||t==="全部功能"||isMenuIntent(t);

  try{
    const outbound = require("./modules/outbound/resolve.js");
    if(outbound.hasOutboundConfig(doctorId)){
      const hit = outbound.matchCode(doctorId, isMenuIntent(t) ? "1" : text);
      if(hit) return hit;
      if(menuIntent && outbound.hasCodeTrigger(doctorId, "1")) return null;
      if(menuIntent) return { menu:true };
      return null; // migrated doctor: no fallback to rules
    }
  }catch(e){}

  if(menuIntent) return { menu:true };

  const rows = db.prepare("SELECT code,aliases,match_type,bot,responses FROM rules WHERE doctor_id=? AND enabled=1 ORDER BY sort").all(doctorId);
  const rules = rows.map(r=>({ code:r.code, aliases:JSON.parse(r.aliases||"[]"), match:r.match_type, bot:r.bot, responses:JSON.parse(r.responses) }));

  for(const r of rules){           // 精确：code 或 alias
    if(r.match!=="includes"){
      if(norm(r.code)===t || r.aliases.some(a=>norm(a)===t)) return { code:r.code, bot:r.bot, responses:r.responses };
    }
  }
  for(const r of rules){           // 包含匹配
    if(r.match==="includes"){
      if(t.indexOf(norm(r.code))>=0 || r.aliases.some(a=>t.indexOf(norm(a))>=0)){
        // fail-closed：includes 是按内容子串模糊截胡，可能吞掉带病情/红旗词的描述（如「想咨询癌症」含红旗词「癌」），
        // 或沾『症状大类哨兵』的低风险描述（如「嘴歪了想咨询医生」——嘴歪∈SYMPTOM_SENTINEL、scanRisk=low+sentinel）。
        // 命中后先过本地风险扫描：非低风险【或沾症状哨兵】都不返回预置话术，返回 null 落到 AI 分诊
        //（triage.handleIncoming：high→安全模板+转人工；sentinel→离线 sentinelRaise 升 medium 转人工 / 在线 L2 精判），
        // 避免中风/紫绀/触电等哨兵急症被编号话术当低风险自动处理（红线①加固）。精确(exact)匹配是显式功能意图，不受此限。
        const rk = scanRisk(text);
        if(rk.riskLevel !== "low" || rk.sentinel) return null;
        return { code:r.code, bot:r.bot, responses:r.responses };
      }
    }
  }
  return null;
}

function fallback(){
  return { bot:"小宝医助", responses:[
    { type:"text", text:"没有找到对应的功能哦～ 在群里发送数字「1」可以查看全部群功能菜单。" }
  ]};
}

module.exports = { match, fallback };
