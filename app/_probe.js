const puppeteer = require("puppeteer-core");
const fs=require("fs");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const BASE="http://localhost:3211";
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--lang=zh-CN"]});
  const widths=[414,390,560,768,820,980,981,1024,1180];
  const p=await b.newPage();
  await p.goto(BASE+"/admin",{waitUntil:"networkidle0"});
  await p.waitForSelector("#loginBtn"); await p.evaluate(()=>document.querySelector("#loginBtn").click());
  await p.waitForSelector("#nav button",{timeout:8000});
  console.log("=== ADMIN NAV ===");
  for(const w of widths){
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await new Promise(r=>setTimeout(r,300));
    const info=await p.evaluate(()=>{
      const nav=document.querySelector("#nav");
      const btns=[...nav.querySelectorAll("button")];
      const tops=new Set(btns.map(x=>Math.round(x.getBoundingClientRect().top)));
      return {
        navRows:tops.size,
        navOverflowX: nav.scrollWidth>nav.clientWidth+1,
        pageOverflowX: document.documentElement.scrollWidth>window.innerWidth+1,
        docScrollW:document.documentElement.scrollWidth
      };
    });
    console.log(JSON.stringify({w,...info}));
  }
  console.log("=== ADMIN TRIAGE shell ===");
  await p.evaluate(()=>{const bs=[...document.querySelectorAll('#nav button')];bs[0].click();});
  await new Promise(r=>setTimeout(r,500));
  for(const w of [560,820,981,1024,1180]){
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await new Promise(r=>setTimeout(r,400));
    const info=await p.evaluate(()=>{
      const sh=document.querySelector('.triage-shell');
      return sh?{shellOverflowX:sh.scrollWidth>sh.clientWidth+1,
        pageOverflowX:document.documentElement.scrollWidth>window.innerWidth+1,docScrollW:document.documentElement.scrollWidth}:{none:true};
    });
    console.log(JSON.stringify({w,...info}));
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
