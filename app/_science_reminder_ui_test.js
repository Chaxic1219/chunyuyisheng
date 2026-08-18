"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "admin-ui", "src", "views", "chunyu", "ops", "science-reminders", "index.vue");
const source = fs.readFileSync(file, "utf8");

for (const expected of [
  "activeTab",
  "pendingDrafts",
  "knowledgeMode",
  "knowledgeIds",
  "AI 通用知识生成 · 无外部知识依据",
  "community.outbox.edit",
  "community.outbox.send",
  "待办",
  "提醒计划",
  "运行记录"
]) assert.ok(source.includes(expected), `missing UI behavior: ${expected}`);

assert.ok(source.includes(":multiple-limit=\"3\""), "knowledge selector must limit selections to 3");
console.log("science reminder ui ok");
