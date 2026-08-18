const puppeteer = require("puppeteer-core");
const fs=require("fs");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const BASE="http://localhost:3211";
async function gridInfo(p){
  return await p.evaluate(()=>{
    function cols(sel){const g=document.querySelector(sel);if(!g)return null;return getComputedStyle(g).gridTemplateColumns.split(" ").length;}
    const ab=document.querySelector(".appbar");
    return {
      coreCols:cols(".core-grid"), fnCols:cols(".fn-grid"),
      pageOverflowX:document.documentElement.scrollWidth>window.innerWidth+1,
      docScrollW:document.documentElement.scrollWidth,
      appbarScrollW: ab?ab.scrollWidth:null, appbarClientW: ab?ab.clientWidth:null,
      appbarOverflow: ab?ab.scrollWidth>ab.clientWidth+1:null
    };
  });
}
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--lang=zh-CN"]});
  const p=await b.newPage();
  const widths=[320,360,380,381,390,560,561,767,768,820,1080];
  console.log("=== PATIENT HOME (normal) ===");
  for(const w of widths){
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await p.goto(BASE,{waitUntil:"networkidle0"});
    await p.evaluate(()=>{try{localStorage.removeItem("elderMode")}catch(e){};document.documentElement.classList.remove("elder");});
    await p.waitForSelector(".core-grid",{timeout:8000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,150));
    console.log(JSON.stringify({w,...(await gridInfo(p))}));
  }
  console.log("=== PATIENT HOME (elder) ===");
  for(const w of [320,360,380,560,767,768,820]){
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await p.goto(BASE,{waitUntil:"networkidle0"});
    await p.evaluate(()=>{document.documentElement.classList.add("elder");});
    await p.waitForSelector(".core-grid",{timeout:8000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,150));
    console.log(JSON.stringify({w,...(await gridInfo(p))}));
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
