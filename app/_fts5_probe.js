"use strict";
process.env.DB_PATH = ":memory:";
const dbApi = require("./db.js");
const triage = require("./triage.js");
const { db } = dbApi;
const now = new Date().toISOString();
const ins = db.prepare("INSERT INTO knowledge_items(doctor_id,layer,mode,title,body,source,owner,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
ins.run(4,"医生个人","半预制","帕罗西汀停药须知","帕罗西汀属于 SSRI 类抗抑郁药，停药需遵医嘱，不要自行突然停药","ops","system","ready",now);
ins.run(4,"医生个人","半预制","服药期间饮酒","服药期间原则上不建议饮酒，酒精影响药效并加重肝脏负担","ops","system","ready",now);
// 直接调函数（导出检查）
console.log("导出检查: retrieveKnowledgeBM25 =", typeof triage.retrieveKnowledgeBM25);
// 构造与函数相同的 terms（模拟 ftsQueryTerms 逻辑）
const t = "周六有酒局 帕罗西汀能不能喝酒";
const direct = [];
const syn = [];
const KB_KEYWORD_GROUPS = [
  ["帕罗西汀","抗抑郁","抑郁药","舍曲林","西酞普兰","氟西汀"],
  ["停药","减量","加量","换药","改量","改成","吃一片","两片","剂量","药量"],
  ["喝酒","饮酒","酒局","酒精","啤酒","白酒","红酒"],
  ["饭前","饭后","空腹","随餐","睡前"],
  ["副作用","不良反应","头晕","嗜睡","恶心","口干","禁忌","忌口"],
  ["同时吃","一起吃","同时服用","同服","间隔","中西药","汤剂","中成药","衔接"],
  ["复诊","拿药","取药","新药","吃完"]
];
for(const group of KB_KEYWORD_GROUPS){
  const hitWords = group.filter(word => t.includes(word));
  if(hitWords.length){
    direct.push(...hitWords);
    for(const word of group){
      if(!hitWords.includes(word)) syn.push(word);
    }
  }
}
const merged = [...new Set([...direct, ...syn])];
console.log("direct:", JSON.stringify(direct), "| syn 前:", JSON.stringify(syn.slice(0,3)), "| merged:", JSON.stringify(merged));
const grams = [];
for(const word of merged.slice(0, 8)) grams.push(...triage.cjkBigrams ? triage.cjkBigrams(word) : []);
console.log("grams:", JSON.stringify(grams));
