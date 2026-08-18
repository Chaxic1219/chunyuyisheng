/**
 * ponytail: resolveChunyuWxEnvVersion 行为自检（node 可跑）
 * 测试 env 返回 trial 时，不因本小程序 formal 而改成 release。
 */
import assert from "node:assert";

function resolve(jump) {
  const fromApi = String(jump.wxEnvVersion || "").trim();
  if (fromApi === "develop" || fromApi === "trial" || fromApi === "release") return fromApi;
  return "release";
}

assert.equal(resolve({ wxEnvVersion: "release" }), "release");
assert.equal(resolve({ wxEnvVersion: "trial" }), "trial");
assert.equal(resolve({}), "release");
console.log("ok chunyu wx env version");
