"use strict";

const llmConfig = require("./modules/llm_config.js");

const CHECK_INTERVAL_MS = Math.max(+(process.env.LLM_HEALTH_INTERVAL_MS || 5 * 60 * 1000), 60_000);
const FAIL_THRESHOLD = Math.max(+(process.env.LLM_HEALTH_FAIL_THRESHOLD || 3), 1);
const TIMEOUT_MS = +(process.env.LLM_HEALTH_TIMEOUT_MS || 8000);

let consecutiveFails = 0;
let lastOkAt = 0;
let lastError = "";

function retryable(error){
  if(error) error.llmRetryable = true;
  return error;
}

function startLlmHealthCheck(deps){
  deps = deps || {};
  const log = deps.log || ((...args) => console.log(...args));
  const logError = deps.logError || ((...args) => console.error(...args));

  async function probeOnce(){
    try{
      await llmConfig.runWithFallback("health_probe", async cfg => {
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(), +(cfg.timeoutMs || TIMEOUT_MS));
        try{
          const res = await fetch(cfg.url, { method:"POST", headers:cfg.headers, signal:controller.signal,
            body:JSON.stringify({ model:cfg.model, messages:[{ role:"user", content:"hi" }], max_tokens:1, stream:false }) });
          if(!res.ok) throw retryable(new Error("http_" + res.status));
          const data = await res.json();
          const text = String((((data.choices || [])[0] || {}).message || {}).content || "").trim();
          if(!text) throw retryable(new Error("empty_response"));
        }catch(e){ throw retryable(e); }
        finally{ clearTimeout(timer); }
      });
      consecutiveFails = 0;
      lastOkAt = Date.now();
      lastError = "";
    }catch(e){
      consecutiveFails++;
      lastError = (e && e.name === "AbortError") ? "timeout" : ((e && e.message) || "fetch_error");
      if(consecutiveFails === FAIL_THRESHOLD){
        logError("[llm-health] LLM 连续" + FAIL_THRESHOLD + "次探测失败：" + lastError);
      }
    }
  }

  probeOnce().catch(()=>{});
  const timer = setInterval(()=>{ probeOnce().catch(()=>{}); }, CHECK_INTERVAL_MS);
  if(typeof timer.unref === "function") timer.unref();
  log("[llm-health] 已开启：每" + Math.round(CHECK_INTERVAL_MS/1000) + "s 探测一次，连续" + FAIL_THRESHOLD + "次失败告警");
  return { timer, probeOnce, status:()=>({ ok:consecutiveFails === 0, consecutiveFails, lastOkAt, lastError }) };
}

module.exports = { startLlmHealthCheck, CHECK_INTERVAL_MS, FAIL_THRESHOLD };
