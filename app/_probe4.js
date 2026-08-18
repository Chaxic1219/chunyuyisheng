const puppeteer = require("puppeteer-core");
const fs=require("fs");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const BASE="http://localhost:3211";
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--lang=zh-CN"]});
  const p=await b.newPage();
  for(const w of [320,360,390,420]){
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await p.goto(BASE,{waitUntil:"networkidle0"});
    await p.waitForSelector(".appbar");
    await new Promise(r=>setTimeout(r,150));
    const info=await p.evaluate(()=>{
      const ab=document.querySelector(".appbar");
      const brand=document.querySelector(".appbar .brand");
      const cs=getComputedStyle(ab);
      return {
        appbarH:Math.round(ab.getBoundingClientRect().height),
        cssHeight:cs.height,
        brandH:Math.round(brand.getBoundingClientRect().height),
        brandLines: Math.round(brand.getBoundingClientRect().height/ (parseFloat(getComputedStyle(brand).lineHeight)||24)),
        brandWrapped: brand.scrollHeight> (parseFloat(getComputedStyle(brand).fontSize)*1.6)+4
      };
    });
    console.log(JSON.stringify({w,...info}));
  }
  // Also check view-inner / cta on desktop chat
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
