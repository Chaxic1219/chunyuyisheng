/* 用本机 Chrome 截图新患者端，做视觉自检 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "_shots");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const pollSel = async (pg,sel,tries=24)=>{ for(let i=0;i<tries;i++){ if(await pg.$(sel)) return true; await sleep(500); } return false; };

(async()=>{
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox","--force-device-scale-factor=2"] });

  // 移动端 首页
  let page = await browser.newPage();
  await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
  await page.goto(BASE+"/", { waitUntil:"networkidle0" });
  await page.waitForSelector(".doc-card"); await sleep(400);
  await page.screenshot({ path:path.join(OUT,"1-home-mobile.png"), fullPage:true });

  // AI 咨询（发一条低风险 + 一条红旗，展示升级卡）
  await page.evaluate(()=>document.querySelector('.core-card[data-fn="consult"]').click());
  await page.waitForSelector("#ci"); await sleep(300);
  await page.type("#ci","我术后能不能吃鸡蛋"); await page.click("#cs");
  await pollSel(page,"#thread .bubble-row.ai .ai-tag"); await sleep(300);  // 等真实 MiMo 回复（而非占位）
  await page.evaluate(()=>{ document.querySelector("#ci").value=""; });
  await page.type("#ci","我右上腹痛很厉害，还发烧发黄"); await page.click("#cs");
  await pollSel(page,"#thread .escalate"); await sleep(400);
  await page.screenshot({ path:path.join(OUT,"2-assistant.png"), fullPage:true });

  // 合规联络表
  await page.goto(BASE+"/", { waitUntil:"networkidle0" }); await page.waitForSelector(".doc-card");
  await page.evaluate(()=>document.querySelector('.fn-card[data-fn="file"]').click());
  await page.waitForSelector("#frm"); await sleep(400);
  await page.evaluate(()=>document.querySelector("#cbody").classList.add("open"));
  await page.screenshot({ path:path.join(OUT,"3-contact.png"), fullPage:true });

  // 医生风采
  await page.goto(BASE+"/", { waitUntil:"networkidle0" }); await page.waitForSelector(".doc-card");
  await page.evaluate(()=>document.querySelector('.fn-card[data-fn="prof"]').click());
  await page.waitForSelector(".hero-banner"); await sleep(400);
  await page.screenshot({ path:path.join(OUT,"4-profile.png"), fullPage:true });

  // 桌面端 首页
  const dp = await browser.newPage();
  await dp.setViewport({ width:1200, height:900, deviceScaleFactor:1.5 });
  await dp.goto(BASE+"/", { waitUntil:"networkidle0" });
  await dp.waitForSelector(".doc-card"); await sleep(400);
  await dp.screenshot({ path:path.join(OUT,"5-home-desktop.png") });

  // 桌面端 AI 咨询（验证宽度修复）
  await dp.evaluate(()=>document.querySelector('.core-card[data-fn="consult"]').click());
  await dp.waitForSelector("#ci"); await sleep(300);
  await dp.type("#ci","你好，我想了解一下保胆手术"); await dp.click("#cs");
  await pollSel(dp,"#thread .bubble-row.ai .ai-tag"); await sleep(300);  // 等真实 MiMo 回复（而非占位）
  await dp.screenshot({ path:path.join(OUT,"6-assistant-desktop.png") });

  // 医助后台 · AI 分诊台（紧急度 + 结构化六要素病历卡）
  const ap = await browser.newPage();
  await ap.setViewport({ width:1320, height:1100, deviceScaleFactor:1.5 });
  await ap.goto(BASE+"/admin", { waitUntil:"networkidle0" });
  await ap.waitForSelector("#loginBtn"); await sleep(200);
  await ap.click("#loginBtn");
  await ap.waitForSelector("[data-demo]", { timeout:9000 }); await sleep(500);
  // 触发一条红旗症状演示会话，展示紧急度分级 + 结构化六要素病历卡
  await ap.evaluate(()=>{ const b=[...document.querySelectorAll("[data-demo]")].find(x=>x.dataset.demo.includes("右上腹")); if(b) b.click(); });
  await sleep(1600);
  await ap.screenshot({ path:path.join(OUT,"7-admin-triage.png"), fullPage:true });

  await browser.close();
  console.log("截图完成 →", OUT);
  fs.readdirSync(OUT).forEach(f=>console.log("  "+f));
})().catch(e=>{ console.error("截图失败:",e.message); process.exit(1); });
