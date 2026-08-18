"use strict";
/* ponytail: 全局限流槽 1 req/s + 限流指数退避；并发合并成更大 batch 是下一步。 */

function isQiweRateLimitError(err){
  const msg = String((err && err.message) || err || "");
  return /请求过于频繁|每秒限制|too many requests|rate limit/i.test(msg);
}

function createUserinfoGate(opts){
  const o = opts || {};
  const minIntervalMs = Number(o.minIntervalMs) > 0 ? Number(o.minIntervalMs) : 1100;
  const maxRetries = Number.isInteger(o.maxRetries) ? o.maxRetries : 2;
  const now = o.now || Date.now;
  const sleep = o.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastAt = Number.NEGATIVE_INFINITY;
  let chain = Promise.resolve();

  async function waitSlot(){
    const wait = Math.max(0, lastAt + minIntervalMs - now());
    if(wait) await sleep(wait);
    lastAt = now();
  }

  function run(fn){
    const job = chain.then(async () => {
      let attempt = 0;
      while(true){
        await waitSlot();
        try{
          return await fn();
        }catch(e){
          if(!isQiweRateLimitError(e) || attempt >= maxRetries) throw e;
          attempt += 1;
          await sleep(minIntervalMs * Math.pow(2, attempt));
        }
      }
    });
    chain = job.then(() => {}, () => {});
    return job;
  }

  return { run };
}

module.exports = { createUserinfoGate, isQiweRateLimitError };
