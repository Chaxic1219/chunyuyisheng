/**
 * 地址 CRUD 自检（临时库）
 * 运行：node app/modules/servicePackage/_check_addresses.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `addr-check-${Date.now()}.db`);
const tempFiles = [process.env.DB_PATH, process.env.DB_PATH + "-wal", process.env.DB_PATH + "-shm"];

function cleanup() {
  for (const f of tempFiles) {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      // Windows 上 SQLite 句柄可能仍占用临时文件，忽略
      if (e && e.code !== "ENOENT" && e.code !== "EBUSY" && e.code !== "EPERM") throw e;
    }
  }
}

cleanup();

const { db } = require("../../db.js");
const { createAddresses } = require("./addresses.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const api = createAddresses(db);
  const personId = 42;

  assert(api.list(personId).length === 0, "初始应为空");

  const a1 = api.create(personId, {
    name: "张三",
    phone: "13800138000",
    region: "广东省 深圳市 南山区",
    detail: "科技园一路 1 号",
    isDefault: true,
  });
  assert(a1 && a1.isDefault, "首条应为默认");
  assert(api.list(personId).length === 1, "应有 1 条");

  const a2 = api.create(personId, {
    name: "李四",
    phone: "13900139000",
    region: "北京市 北京市 海淀区",
    detail: "中关村大街 2 号",
    isDefault: true,
  });
  assert(a2.isDefault, "新默认应生效");
  assert(!api.get(personId, a1.id).isDefault, "旧默认应取消");

  const updated = api.update(personId, a1.id, { detail: "科技园一路 9 号", isDefault: true });
  assert(updated.detail.includes("9"), "更新详情");
  assert(updated.isDefault, "更新后设默认");
  assert(!api.get(personId, a2.id).isDefault, "另一条取消默认");

  api.remove(personId, a1.id);
  const left = api.list(personId);
  assert(left.length === 1 && left[0].id === a2.id, "删除后剩余一条");
  assert(left[0].isDefault, "删除后自动保底默认");

  console.log("[ok] addresses CRUD check passed");
  cleanup();
}

try {
  main();
} catch (e) {
  cleanup();
  throw e;
}
