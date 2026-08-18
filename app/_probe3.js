const puppeteer = require("puppeteer-core");
const fs=require("fs");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const BASE="http://localhost:3211";
const OUT="C:/Users/30112/Desktop/功能实现/app/_shots/sweep";
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--lang=zh-CN"]});
  const p=await b.newPage();
  // doc count
  await p.setViewport({width:768,height:1100,deviceScaleFactor:1});
  await p.goto(BASE,{waitUntil:"networkidle0"});
  const docCount=await p.evaluate(()=>document.querySelectorAll("#docSel option").length);
  console.log("docSel options:",docCount);
  // elder at 768 - full page
  await p.evaluate(()=>{document.documentElement.classList.add("elder");});
  await new Promise(r=>setTimeout(r,300));
  await p.screenshot({path:OUT+"/_chk_elder_768.png",fullPage:true});
  // elder at 820
  await p.setViewport({width:820,height:1100,deviceScaleFactor:1});
  await new Promise(r=>setTimeout(r,300));
  await p.screenshot({path:OUT+"/_chk_elder_820.png",fullPage:true});
  // 320 narrow with appbar
  await p.setViewport({width:320,height:900,deviceScaleFactor:1});
  await p.goto(BASE,{waitUntil:"networkidle0"});
  await new Promise(r=>setTimeout(r,300));
  await p.screenshot({path:OUT+"/_chk_320.png",fullPage:false});
  // measure elder fn-card text wrap/height at 768
  await p.setViewport({width:768,height:1100,deviceScaleFactor:1});
  await p.goto(BASE,{waitUntil:"networkidle0"});
  await p.evaluate(()=>{document.documentElement.classList.add("elder");});
  await new Promise(r=>setTimeout(r,300));
  const m=await p.evaluate(()=>{
    const cards=[...document.querySelectorAll(".fn-card")].slice(0,6).map(c=>{const t=c.querySelector(".t");return {w:Math.round(c.getBoundingClientRect().width),title:t?t.textContent.trim():"",titleScrollW:t?t.scrollWidth:0,titleClientW:t?t.clientWidth:0,overflow:t?t.scrollWidth>t.clientWidth+1:false};});
    return cards;
  });
  console.log("elder768 fn-cards:",JSON.stringify(m));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
