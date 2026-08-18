/* 全面 UI 扫查截图：患者端全部视图 + 后台全部 tab，桌面/平板/手机三宽度
   依赖：服务以 --demo 运行 + 已跑 _qa_populate.js 灌数据；需 puppeteer-core + Chrome/Edge
   用法：node _qa_sweep.js   输出：_shots/sweep/ */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "_shots", "sweep");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p=>fs.existsSync(p));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));

const PWIDTHS = [ {w:1366,l:"desktop"}, {w:820,l:"tablet"}, {w:390,l:"phone"} ];
const AWIDTHS = [ {w:1680,l:"desktop"}, {w:1024,l:"tablet"}, {w:414,l:"phone"} ];

// 打开某功能视图（点首页 data-fn 卡片）
async function openKey(page, key){
  await page.evaluate(k=>{ const b=document.querySelector('[data-fn="'+k+'"]'); if(b) b.click(); }, key);
}
async function gotoHome(page, w, h, elder){
  await page.setViewport({width:w, height:h, deviceScaleFactor:1});
  await page.goto(BASE, {waitUntil:"networkidle0"});
  await page.evaluate(()=>{ try{ localStorage.removeItem("elderMode"); }catch(e){} document.documentElement.classList.remove("elder"); });
  await page.waitForSelector(".doc-card", {timeout:8000});
  if(elder){ await page.evaluate(()=>document.querySelector("#elderBtn").click()); }
  await sleep(250);
}

// 患者端各视图：name + 打开逻辑（在 home 之后执行）
const PVIEWS = [
  { name:"01-home",        full:true,  open:async()=>{} },
  { name:"02-home-elder",  full:true,  elder:true, open:async()=>{} },
  { name:"03-consult",     open:async(p)=>{ await openKey(p,"consult"); await p.waitForSelector(".chat",{timeout:6000});
      await p.evaluate(()=>{ const ci=document.querySelector("#ci"); ci.value="我右上腹剧痛，还发烧、皮肤发黄，怎么办"; document.querySelector("#cs").click(); });
      await p.waitForSelector(".escalate",{timeout:9000}).catch(()=>{}); await sleep(600); } },
  { name:"04-add",         open:async(p)=>{ await openKey(p,"add"); await p.waitForSelector("#frm",{timeout:6000}); } },
  { name:"05-add-proxy",   open:async(p)=>{ await openKey(p,"add"); await p.waitForSelector("#proxySeg",{timeout:6000});
      await p.evaluate(()=>document.querySelector('.seg-b[data-who="proxy"]').click()); await sleep(300); } },
  { name:"06-admission",   open:async(p)=>{ await openKey(p,"adm"); await p.waitForSelector("#frm",{timeout:6000}); } },
  { name:"07-contact",     open:async(p)=>{ await openKey(p,"file"); await p.waitForSelector("#ctog",{timeout:6000});
      await p.evaluate(()=>document.querySelector("#ctog").click()); await sleep(300); } },
  { name:"08-followup-verify", open:async(p)=>{ await openKey(p,"followup"); await p.waitForSelector("#ffrm",{timeout:6000}); } },
  { name:"09-followup-timeline", open:async(p)=>{ await openKey(p,"followup"); await p.waitForSelector("#fcd",{timeout:6000});
      const code=await p.evaluate(async()=>{ const r=await fetch('/api/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800138010'})}); return (await r.json()).code; });
      await p.evaluate(c=>{ document.querySelector("#fph").value="13800138010"; document.querySelector("#fcd").value=c; document.querySelector("#fsub").click(); }, code);
      await p.waitForSelector(".fu-timeline",{timeout:9000}).catch(()=>{}); await sleep(500); } },
  { name:"10-packages",    open:async(p)=>{ await openKey(p,"packages"); await p.waitForSelector(".pkg",{timeout:6000}); } },
  { name:"11-profile",     open:async(p)=>{ await openKey(p,"prof"); await p.waitForSelector(".tabs",{timeout:6000}); await sleep(300); } },
  { name:"12-profile-reviews", open:async(p)=>{ await openKey(p,"prof"); await p.waitForSelector(".tabs",{timeout:6000});
      await p.evaluate(()=>document.querySelector('.tabs button[data-i="2"]').click()); await p.waitForSelector(".review-card",{timeout:6000}).catch(()=>{}); await sleep(400); } },
  { name:"13-review-form", open:async(p)=>{ await openKey(p,"prof"); await p.waitForSelector(".tabs",{timeout:6000});
      await p.evaluate(()=>document.querySelector('.tabs button[data-i="2"]').click()); await sleep(300);
      await p.evaluate(()=>document.querySelector("#writeReview").click()); await p.waitForSelector("#rfrm",{timeout:6000}); await sleep(300); } },
  { name:"14-video",       open:async(p)=>{ await openKey(p,"video"); await p.waitForSelector(".hero-banner",{timeout:6000}); } },
  { name:"15-accounts",    open:async(p)=>{ await openKey(p,"sci"); await p.waitForSelector(".list-row",{timeout:6000}); } },
  { name:"16-diet",        open:async(p)=>{ await openKey(p,"diet"); await p.waitForSelector(".article",{timeout:6000}); } },
  { name:"17-clinic",      open:async(p)=>{ await openKey(p,"clinic"); await p.waitForSelector(".article",{timeout:6000}); } },
  { name:"18-referral",    open:async(p)=>{ await openKey(p,"ref"); await p.waitForSelector(".panel",{timeout:6000}); } },
  { name:"19-copy",        open:async(p)=>{ await openKey(p,"copy"); await p.waitForSelector(".article",{timeout:6000}); } },
  { name:"20-faq",         open:async(p)=>{ await openKey(p,"faq"); await p.waitForSelector(".list-row",{timeout:6000});
      await p.evaluate(()=>{ const r=document.querySelector(".list-row"); if(r) r.click(); }); await sleep(300); } },
  { name:"21-poster",      open:async(p)=>{ await openKey(p,"share"); await p.waitForSelector(".poster-frame",{timeout:6000}); } },
  { name:"22-phone-modal", open:async(p)=>{ await openKey(p,"tel"); await p.waitForSelector(".modal",{timeout:6000}); } },
];

async function patientSweep(browser){
  const page = await browser.newPage();
  for(const wl of PWIDTHS){
    for(const v of PVIEWS){
      const h = v.full ? 1000 : 3200;
      try{
        await gotoHome(page, wl.w, h, v.elder);
        await v.open(page);
        await sleep(300);
        await page.screenshot({ path:path.join(OUT,`patient-${v.name}-${wl.l}.png`), fullPage: !!v.full });
        process.stdout.write(`✓ patient-${v.name}-${wl.l}\n`);
      }catch(e){ process.stdout.write(`✗ patient-${v.name}-${wl.l}: ${e.message}\n`); }
    }
  }
  await page.close();
}

const ATABS = ["triage","followup","waitlist","dash","subs","archive","rules","faq","doctors"];
async function adminSweep(browser){
  for(const wl of AWIDTHS){
    const page = await browser.newPage();
    await page.setViewport({width:wl.w, height:1000, deviceScaleFactor:1});
    await page.goto(BASE+"/admin", {waitUntil:"networkidle0"});
    await page.waitForSelector("#loginBtn"); await sleep(150);
    await page.evaluate(()=>document.querySelector("#loginBtn").click());
    await page.waitForSelector("#nav button", {timeout:8000}); await sleep(700);
    const n = (await page.$$("#nav button")).length;
    for(let i=0;i<n;i++){
      try{
        await page.evaluate(idx=>{ const b=document.querySelectorAll("#nav button")[idx]; b.scrollIntoView({block:"nearest",inline:"center"}); b.click(); }, i);
        await sleep(800);
        await page.screenshot({ path:path.join(OUT,`admin-${ATABS[i]||i}-${wl.l}.png`), fullPage:true });
        process.stdout.write(`✓ admin-${ATABS[i]||i}-${wl.l}\n`);
      }catch(e){ process.stdout.write(`✗ admin-${ATABS[i]||i}-${wl.l}: ${e.message}\n`); }
    }
    // 规则编辑弹层
    try{
      await page.evaluate(()=>{ const b=document.querySelectorAll("#nav button")[6]; b.click(); }); // rules
      await sleep(700);
      await page.evaluate(()=>{ const e=document.querySelector("[data-edit]"); if(e) e.click(); });
      await page.waitForSelector(".modal",{timeout:5000});
      await sleep(400);
      await page.screenshot({ path:path.join(OUT,`admin-rule-modal-${wl.l}.png`), fullPage:true });
      process.stdout.write(`✓ admin-rule-modal-${wl.l}\n`);
    }catch(e){ process.stdout.write(`✗ admin-rule-modal-${wl.l}: ${e.message}\n`); }
    await page.close();
  }
}

(async()=>{
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, {recursive:true});
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:"new", args:["--no-sandbox","--lang=zh-CN"] });
  await patientSweep(browser);
  await adminSweep(browser);
  await browser.close();
  console.log("\n=== 全面截图完成 →", OUT, "===");
})().catch(e=>{ console.error("截图失败:", e); process.exit(1); });
