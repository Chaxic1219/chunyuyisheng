// tests/pages-json-no-conflict.test.mjs
// 防止「主包 pages 与 subPackages 路径冲突」回归
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(path.join(root, "src/pages.json"), "utf8"));

function fullPaths() {
  const out = [];
  for (const p of cfg.pages || []) out.push(p.path);
  for (const sp of cfg.subPackages || []) {
    for (const p of sp.pages || []) {
      const sub = typeof p === "string" ? p : p.path;
      out.push(sp.root + "/" + sub);
    }
  }
  return out;
}

test("pages.json：主包 pages 与 subPackages 路径不可重复", () => {
  const all = fullPaths();
  const dup = all.filter((v, i, arr) => arr.indexOf(v) !== i);
  assert.equal(dup.length, 0, "重复路径：" + dup.join(", "));
});

test("pages.json：tabBar 列表的 pagePath 必须在主包 pages 中", () => {
  const main = new Set((cfg.pages || []).map(p => p.path));
  for (const t of cfg.tabBar?.list || []) {
    assert.equal(main.has(t.pagePath), true, "tabBar 不在主包：" + t.pagePath);
  }
});

test("pages.json：subPackages root 不应覆盖主包路径前缀冲突", () => {
  const mainRoots = new Set((cfg.pages || []).map(p => p.path.split("/")[1]));
  for (const sp of cfg.subPackages || []) {
    const segs = sp.root.split("/");
    assert.notEqual(mainRoots.has(segs[1]), true,
      "subPackage root " + sp.root + " 与主包目录同名（可能导致 path 解析歧义）");
  }
});
