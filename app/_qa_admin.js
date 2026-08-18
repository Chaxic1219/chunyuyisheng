/* 后台各 tab 截图自检：登录后逐个切 nav，移动/桌面双宽 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000/admin";
const OUT = path.join(__dirname, "_shots", "qa");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const TABS = ["triage","dash","subs","archive","rules","faq","doctors"];

async function capture(browser, vw, vh, label){
  const page = await browser.newPage();
  await page.setViewport({ width:vw, height:vh, deviceScaleFactor:1 });
  await page.goto(BASE, { waitUntil:"networkidle0" });
  await page.waitForSelector("#loginBtn"); await sleep(200);
  await page.evaluate(()=>document.querySelector("#loginBtn").click());
  await page.waitForSelector("#nav button"); await sleep(700);
  const n = (await page.$$("#nav button")).length;
  for(let i=0;i<n;i++){
    // 移动端 nav 横向滚动，先滚到该按钮再点（用 evaluate 直接触发，避开 not-clickable）
    await page.evaluate(idx=>{ const b=document.querySelectorAll("#nav button")[idx]; b.scrollIntoView({block:"nearest",inline:"center"}); b.click(); }, i);
    await sleep(700);
    await page.screenshot({ path:path.join(OUT,`admin-${TABS[i]||i}-${label}.png`) });
  }
  await page.close();
}

(async()=>{
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive:true });
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox"] });
  await capture(browser, 1280, 1000, "d");
  await capture(browser, 430, 900, "m");
  await browser.close();
  console.log("后台 QA 截图完成 →", OUT);
})().catch(e=>{ console.error("截图失败:", e.message); process.exit(1); });
