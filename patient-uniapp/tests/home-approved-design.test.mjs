import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("首页实现批准稿的完整信息层级", () => {
  const page = read("src/pages/index/index.vue");

  assert.match(page, /夏季肠胃健康指南/);
  assert.match(page, /今天需要完成/);
  assert.match(page, /完善健康档案/);
  assert.match(page, /我的健康/);
  assert.match(page, /健康档案/);
  assert.match(page, /健康计划/);
  assert.match(page, /健康记录/);
  assert.match(page, /常用服务/);
  assert.match(page, /问助手/);
  assert.match(page, /医生管家/);
  assert.match(page, /\/pages\/services\/catalog/);
  assert.doesNotMatch(page, /<textarea|咨询医生|开始对话/);
});

test("首页使用真实海报素材并保留三等宽底部导航", () => {
  const page = read("src/pages/index/index.vue");
  const tab = read("src/custom-tab-bar/index.wxml");

  assert.equal(existsSync(new URL("../src/static/visual/home-summer-guide.webp", import.meta.url)), true);
  assert.match(page, /home-summer-guide\.webp/);
  assert.doesNotMatch(tab, /item\.elevated|tab-bar__center|tab-bar__fab/);
});
