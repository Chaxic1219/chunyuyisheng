/* 修复验证截图：只截本轮改动到的视图 → _shots/verify/ */
const puppeteer = require("puppeteer-core");
const fs = require("fs"), path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "_shots", "verify");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));

async function patientShot(browser, w, h, name, opener, full){
  const page = await browser.newPage();
  await page.setViewport({width:w, height:h, deviceScaleFactor:1});
  await page.goto(BASE, {waitUntil:"networkidle0"});
  await page.evaluate(()=>{ try{ localStorage.removeItem("elderMode"); }catch(e){} document.documentElement.classList.remove("elder"); });
  await page.waitForSelector(".doc-card", {timeout:8000});
  await opener(page);
  await sleep(400);
  await page.screenshot({path:path.join(OUT,name), fullPage:!!full});
  await page.close();
  console.log("✓", name);
}

async function adminPage(browser, w){
  const page = await browser.newPage();
  await page.setViewport({width:w, height:1000, deviceScaleFactor:1});
  await page.goto(BASE+"/admin", {waitUntil:"networkidle0"});
  await page.waitForSelector("#loginBtn"); await sleep(150);
  await page.evaluate(()=>document.querySelector("#loginBtn").click());
  await page.waitForSelector("#nav button", {timeout:8000}); await sleep(700);
  return page;
}
async function clickTab(page, idx){ await page.evaluate(i=>{ const b=document.querySelectorAll("#nav button")[i]; b.scrollIntoView({block:"nearest",inline:"center"}); b.click(); }, idx); await sleep(800); }
async function adminShot(page, name){ await page.screenshot({path:path.join(OUT,name), fullPage:true}); console.log("✓", name); }

(async()=>{
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, {recursive:true});
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox","--lang=zh-CN"] });

  // 患者端
  await patientShot(browser, 390, 1200, "patient-home-elder-phone.png", async(p)=>{ await p.evaluate(()=>document.querySelector("#elderBtn").click()); await sleep(300); }, true);
  await patientShot(browser, 1366, 3200, "patient-accounts-desktop.png", async(p)=>{ await p.evaluate(()=>{ const b=document.querySelector('[data-fn="sci"]'); if(b)b.click(); }); await p.waitForSelector(".list-row",{timeout:6000}); });
  await patientShot(browser, 1366, 3200, "patient-followup-verify-desktop.png", async(p)=>{ await p.evaluate(()=>{ const b=document.querySelector('[data-fn="followup"]'); if(b)b.click(); }); await p.waitForSelector("#ffrm",{timeout:6000}); });

  // 后台：分诊台（桌面 + 手机）——选「你好」短会话展示气泡修复
  for(const [w,tag] of [[1680,"desktop"],[414,"phone"]]){
    const page = await adminPage(browser, w);
    await clickTab(page, 0); // triage
    await page.evaluate(()=>{ const chips=[...document.querySelectorAll(".session-chip")]; const hi=chips.find(c=>(c.querySelector("small")||{}).textContent==="你好"); (hi||chips[0]).click(); });
    await sleep(700);
    await adminShot(page, `admin-triage-${tag}.png`);
    await page.close();
  }

  // 后台手机端：导航换行 + 各表 + 标题
  {
    const page = await adminPage(browser, 414);
    await clickTab(page, 1); await adminShot(page, "admin-followup-phone.png"); // 随访队列（标题+按钮+导航）
    await clickTab(page, 4); await adminShot(page, "admin-subs-phone.png");      // 提交记录（表+时间戳）
    await clickTab(page, 6); await adminShot(page, "admin-rules-phone.png");     // 规则表
    await clickTab(page, 8); await adminShot(page, "admin-doctors-phone.png");   // 医生表（徽章/按钮）
    // 规则编辑弹层
    await clickTab(page, 6);
    await page.evaluate(()=>{ const e=document.querySelector("[data-edit]"); if(e) e.click(); });
    await page.waitForSelector(".modal",{timeout:5000}); await sleep(400);
    await adminShot(page, "admin-rule-modal-phone.png");
    await page.close();
  }
  // 后台平板：提交记录表
  {
    const page = await adminPage(browser, 1024);
    await clickTab(page, 4); await adminShot(page, "admin-subs-tablet.png");
    await page.close();
  }

  await browser.close();
  console.log("\n=== 验证截图完成 →", OUT, "===");
})().catch(e=>{ console.error("验证截图失败:", e); process.exit(1); });
