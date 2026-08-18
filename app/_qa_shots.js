/* 逐页面截图做布局自检：患者端每个功能视图 × 移动/桌面两种宽度 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "_shots", "qa");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));

const KEYS = ["consult","add","adm","clinic","ref","tel","prof","video","sci","diet","story","file","copy","faq","share"];

async function capture(browser, vw, vh, label){
  const page = await browser.newPage();
  await page.setViewport({ width:vw, height:vh, deviceScaleFactor:1 });
  await page.goto(BASE+"/", { waitUntil:"networkidle0" });
  await page.waitForSelector(".doc-card"); await sleep(300);
  await page.screenshot({ path:path.join(OUT,`home-${label}.png`) });  // 视口截图（dsf=1，可读、无 fixed 叠加伪影）
  for(const k of KEYS){
    await page.goto(BASE+"/", { waitUntil:"networkidle0" });
    await page.waitForSelector(".doc-card"); await sleep(150);
    const card = await page.$(`[data-fn="${k}"]`);
    if(!card){ console.log("  (无卡片:", k, ")"); continue; }
    await card.click();
    await sleep(700);
    // 滚到视图底部，确保 .fix-note / 同意条等贴底元素入镜
    await page.evaluate(()=>{ const b=document.querySelector(".view-body"); if(b) b.scrollTop=b.scrollHeight; });
    await sleep(250);
    await page.screenshot({ path:path.join(OUT,`${k}-${label}.png`) });
  }
  await page.close();
}

(async()=>{
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive:true });
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox"] });
  await capture(browser, 430, 932, "m");
  await capture(browser, 1280, 1200, "d");
  await browser.close();
  console.log("QA 截图完成 →", OUT);
  fs.readdirSync(OUT).forEach(f=>console.log("  "+f));
})().catch(e=>{ console.error("截图失败:", e.message); process.exit(1); });
