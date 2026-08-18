/* 长辈模式 + 听一听 截图 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "_shots", "qa");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox"] });
  const p = await b.newPage(); await p.setViewport({ width:430, height:1000, deviceScaleFactor:1 });
  await p.goto(BASE+"/", { waitUntil:"networkidle0" }); await p.waitForSelector(".doc-card");
  // 开长辈模式
  await p.evaluate(()=>document.querySelector("#elderBtn").click()); await sleep(400);
  await p.screenshot({ path:path.join(OUT,"elder-home-m.png") });
  // 术后饮食文章（含听一听），长辈模式下
  await p.evaluate(()=>document.querySelector('.fn-card[data-fn="diet"]').click()); await sleep(500);
  await p.screenshot({ path:path.join(OUT,"elder-article-m.png") });
  await p.evaluate(()=>document.querySelectorAll(".view").forEach(v=>v.remove()));
  // 联络表步骤提示（长辈模式）
  await p.evaluate(()=>document.querySelector('.fn-card[data-fn="file"]').click()); await sleep(500);
  await p.screenshot({ path:path.join(OUT,"elder-contact-m.png") });
  await b.close(); console.log("ok");
})().catch(e=>{ console.error(e.message); process.exit(1); });
