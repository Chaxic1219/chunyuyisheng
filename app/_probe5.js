const puppeteer = require("puppeteer-core");
const fs=require("fs");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const BASE="http://localhost:3211";
const OUT="C:/Users/30112/Desktop/功能实现/app/_shots/sweep";
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--lang=zh-CN"]});
  const p=await b.newPage();
  // Admin login box at 320
  for(const w of [320,360]){
    await p.setViewport({width:w,height:700,deviceScaleFactor:1});
    await p.goto(BASE+"/admin",{waitUntil:"networkidle0"});
    await p.waitForSelector(".login .box");
    const info=await p.evaluate(()=>{
      const box=document.querySelector(".login .box");
      return {boxW:Math.round(box.getBoundingClientRect().width),winW:window.innerWidth,
        pageOverflowX:document.documentElement.scrollWidth>window.innerWidth+1,docScrollW:document.documentElement.scrollWidth};
    });
    console.log("login",JSON.stringify({w,...info}));
  }
  // Admin rule modal at 360 (row3 stacking) — login then open
  await p.setViewport({width:360,height:800,deviceScaleFactor:1});
  await p.goto(BASE+"/admin",{waitUntil:"networkidle0"});
  await p.waitForSelector("#loginBtn"); await p.evaluate(()=>document.querySelector("#loginBtn").click());
  await p.waitForSelector("#nav button",{timeout:8000});
  await p.evaluate(()=>{const bs=[...document.querySelectorAll('#nav button')];bs[6].click();});
  await new Promise(r=>setTimeout(r,500));
  await p.evaluate(()=>{const e=document.querySelector("[data-edit]");if(e)e.click();});
  await p.waitForSelector(".modal",{timeout:5000});
  await new Promise(r=>setTimeout(r,300));
  const modalInfo=await p.evaluate(()=>{
    const row3=document.querySelector(".modal .row3");
    const divs=row3?[...row3.children]:[];
    const tops=new Set(divs.map(d=>Math.round(d.getBoundingClientRect().top)));
    const m=document.querySelector(".modal .m");
    return {row3Rows:tops.size, modalW:m?Math.round(m.getBoundingClientRect().width):null, winW:window.innerWidth,
      pageOverflowX:document.documentElement.scrollWidth>window.innerWidth+1};
  });
  console.log("rule-modal-360",JSON.stringify(modalInfo));
  await p.screenshot({path:OUT+"/_chk_rulemodal_360.png",fullPage:false});

  // Patient desktop chat - cta/view on 1366
  await p.setViewport({width:1366,height:900,deviceScaleFactor:1});
  await p.goto(BASE,{waitUntil:"networkidle0"});
  await p.waitForSelector(".core-grid");
  await p.evaluate(()=>{const c=document.querySelector('[data-fn="add"]');if(c)c.click();});
  await p.waitForSelector(".cta-bar",{timeout:6000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,300));
  const ctaInfo=await p.evaluate(()=>{
    const cta=document.querySelector(".cta-bar"); const inner=document.querySelector(".view-inner");
    const btn=cta?cta.querySelector("*"):null;
    return {ctaW:cta?Math.round(cta.getBoundingClientRect().width):null,
      btnW:btn?Math.round(btn.getBoundingClientRect().width):null,
      innerW:inner?Math.round(inner.getBoundingClientRect().width):null,
      btnLeft:btn?Math.round(btn.getBoundingClientRect().left):null,
      innerLeft:inner?Math.round(inner.getBoundingClientRect().left):null};
  });
  console.log("patient-cta-1366",JSON.stringify(ctaInfo));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
