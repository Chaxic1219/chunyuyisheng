/* 入群欢迎语统一解析：仅运营配置 groupWelcome，硬编码兜底。
   社群工作台不再提供本群文案覆盖（避免双源漂移）。
   QiWe 真回调与 community 仿真入站共用。 */
const { db } = require("./db.js");
const opsConfig = require("./ops_config.js");

function cleanText(v, n){
  return String(v == null ? "" : v).replace(/\s+\n/g, "\n").trim().slice(0, n || 1200);
}

function publicGroupName(v){
  return cleanText(v, 120).replace(/（群名待甲方确认）|\(群名待甲方确认\)/g, "").trim();
}

function welcomeVars(doctorId, patientName, extra){
  let d = {};
  try{ d = db.prepare("SELECT name,hospital,dept,specialty,group_name FROM doctors WHERE id=?").get(+doctorId) || {}; }catch(e){ d = {}; }
  const ext = extra || {};
  return {
    patient: cleanText(patientName || ext.patient || "", 80),
    group: publicGroupName(ext.group || d.group_name || ""),
    doctor: cleanText(d.name || "", 80),
    dept: cleanText(d.dept || d.specialty || "", 80),
    hospital: cleanText(d.hospital || "", 120)
  };
}

function hardcodedWelcome(doctorId, patientName){
  let doctorName = "医生";
  try{
    const d = db.prepare("SELECT name FROM doctors WHERE id=?").get(+doctorId);
    if(d && d.name) doctorName = d.name;
  }catch(e){}
  const titleName = doctorName.endsWith("主任") ? doctorName : `${doctorName}主任`;
  const who = cleanText(patientName, 40);
  const greet = who ? "" : "新朋友 ";
  return [
    `👏${greet}您好，欢迎加入${titleName}建立的健康群`,
    `⭐可先完善联络信息，便于团队了解情况`,
    `⭐直接告诉我您想办的事（问诊/挂号/加号等），或发送 1 查看群功能`,
    `💗下方可打开医生介绍与服务入口`
  ].join("\n");
}

/**
 * 优先级：运营配置 groupWelcome → 硬编码兜底
 * （群级 welcome_text 已废弃，不再覆盖）
 * @returns {{ text:string, source:'ops'|'fallback' }}
 */
function resolveWelcomeText(input){
  input = input || {};
  const doctorId = Number(input.doctorId);
  const vars = welcomeVars(doctorId, input.patientName, { group:input.groupName });

  const scripts = opsConfig.scripts(doctorId);
  const fromOps = cleanText(opsConfig.render(opsConfig.scriptValue(scripts, "groupWelcome"), vars), 1200);
  if(fromOps) return { text:fromOps, source:"ops" };

  return { text:hardcodedWelcome(doctorId, input.patientName), source:"fallback" };
}

module.exports = { resolveWelcomeText, welcomeVars, hardcodedWelcome };
