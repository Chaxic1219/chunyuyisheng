"use strict";
const assert = require("assert");
const { createUserinfoGate, isQiweRateLimitError } = require("./modules/qiwe/userinfo_gate.js");

async function main(){
  assert.equal(isQiweRateLimitError(new Error("QiWe 调用失败：500 请求过于频繁（请稍后再试，每秒限制）")), true);
  assert.equal(isQiweRateLimitError(new Error("QiWe 调用失败：400 参数错误")), false);

  let now = 0;
  const sleeps = [];
  const gate = createUserinfoGate({
    minIntervalMs: 1000,
    maxRetries: 2,
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; }
  });

  const started = [];
  const calls = [
    gate.run(async () => { started.push(now); return "a"; }),
    gate.run(async () => { started.push(now); return "b"; }),
    gate.run(async () => { started.push(now); return "c"; })
  ];
  const out = await Promise.all(calls);
  assert.deepEqual(out, ["a", "b", "c"]);
  assert.deepEqual(started, [0, 1000, 2000], "并发 batchGetUserinfo 必须串行且间隔 >= 1s");

  now = 0;
  sleeps.length = 0;
  let hits = 0;
  const retryGate = createUserinfoGate({
    minIntervalMs: 1000,
    maxRetries: 2,
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; }
  });
  const result = await retryGate.run(async () => {
    hits++;
    if(hits < 3) throw new Error("QiWe 调用失败：500 请求过于频繁（请稍后再试，每秒限制）");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(hits, 3, "限流错误应退避重试直到成功");
  assert.ok(sleeps.some((ms) => ms >= 2000), "限流后应指数退避，不只等 1s 槽位");
}

main().then(() => {
  console.log("userinfo_gate ok");
}).catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
