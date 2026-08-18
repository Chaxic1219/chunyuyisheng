import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(projectFile(path), "utf8");
const literal = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("我的页使用批准稿的信息层级", () => {
  const page = read("src/pages/mine/index.vue");

  for (const text of [
    "家庭成员",
    "进行中",
    "优惠券",
    "我的健康",
    "健康档案",
    "健康计划",
    "健康记录",
    "服务与订单",
    "我的服务",
    "我的订单",
    "优惠权益",
    "家庭与工具",
    "地址管理",
    "设置与授权",
  ]) {
    assert.match(page, literal(text), `缺少批准稿文案：${text}`);
  }

  for (const text of [
    "健康资料",
    "常用服务",
    "订单服务",
    "工具与服务",
    "开启长辈模式",
    "春雨健康患者端 V3.2",
  ]) {
    assert.doesNotMatch(page, literal(text), `仍包含旧版文案：${text}`);
  }
});

test("我的页保留真实入口和新增素材", () => {
  const page = read("src/pages/mine/index.vue");

  for (const route of [
    "/pages/records/index",
    "/pages/plans/detail",
    "/pages/archive/health",
    "/pages/services/mine-services?tab=active",
    "/pages/services/mine-services?tab=orders",
    "/pages/services/rights",
    "/pages/family/index",
    "/pages/address/index",
    "/pages/settings/index",
  ]) {
    assert.match(page, literal(route), `缺少真实入口：${route}`);
  }

  for (const asset of [
    "src/static/visual/mine-leaf-bg.webp",
    "src/static/icons/v2/location.png",
  ]) {
    assert.equal(existsSync(projectFile(asset)), true, `缺少新增素材：${asset}`);
  }

  for (const icon of [
    "health-record",
    "health-plan",
    "health-log",
    "service-center",
    "order",
    "service-rights",
    "member-record",
    "location",
    "settings",
  ]) {
    assert.match(page, literal(`/static/icons/v2/${icon}.png`), `菜单未显式使用 v2 图标：${icon}`);
  }

  assert.match(page, /:src="item\.iconSrc"/, "菜单图标未使用 item.iconSrc");
  assert.match(
    page,
    /src="\/static\/visual\/mine-leaf-bg\.webp"/,
    "背景未在模板中实际使用"
  );
  assert.match(
    page,
    /src="\/static\/icons\/v2\/settings\.png"/,
    "设置胶囊未显式使用 v2 图标"
  );
  assert.match(page, /@click="openMenu\(stat\.url\)"/, "统计项未统一使用 openMenu");
  assert.match(page, /@click="openMenu\(item\.url\)"/, "菜单项未统一使用 openMenu");
  assert.doesNotMatch(page, /\.loadMine\(/, "新版我的页仍请求旧版 mineAssets");
});
