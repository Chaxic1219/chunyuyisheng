"use strict";

const assert = require("assert");

// ponytail: 仅校验 uploads 前缀拼接逻辑
const API_BASE = "https://yht.chunyutianxia.com";
function safeLocalImageSrc(src, fallback = "") {
  const value = String(src || "").trim();
  if (!value) return fallback;
  if (value.startsWith("/static/")) return value;
  if (value.startsWith("/uploads/") || value.startsWith("uploads/")) {
    const path = value.startsWith("/") ? value : `/${value}`;
    return `${API_BASE}${path}`;
  }
  if (value.startsWith("https://")) return value;
  if (value.startsWith("data:image/")) return value;
  return fallback;
}

assert.strictEqual(safeLocalImageSrc("/uploads/mall-covers/x.jpg"), "https://yht.chunyutianxia.com/uploads/mall-covers/x.jpg");
assert.strictEqual(safeLocalImageSrc("uploads/mall-covers/x.jpg"), "https://yht.chunyutianxia.com/uploads/mall-covers/x.jpg");
assert.strictEqual(safeLocalImageSrc("https://yht.chunyutianxia.com/uploads/x.jpg"), "https://yht.chunyutianxia.com/uploads/x.jpg");
assert.strictEqual(safeLocalImageSrc(""), "");
assert.strictEqual(safeLocalImageSrc("dirty-key"), "");
console.log("media_src_check ok");
