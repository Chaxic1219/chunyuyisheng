import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const mappings = [
  ["member-record", "member-record.png"],
  ["location", "location.png"],
  ["health-record", "health-record.png"],
  ["health-log", "health-log.png"],
  ["consult-doctor", "consult-doctor.png"],
  ["health-assistant", "health-assistant.png"],
  ["help-center", "help-center.png"],
  ["service-center", "service-center.png"],
  ["service-package", "service-package.png"],
  ["medication", "medication.png"],
  ["service-rights", "service-rights.png"],
  ["order", "order.png"],
  ["goods-order", "goods-order.png"],
  ["settings", "settings.png"],
  ["health-plan", "health-plan.png"],
];

const digest = (url) => createHash("sha256").update(readFileSync(url)).digest("hex");

test("自定义图标包替换可对应的语义素材", () => {
  const media = readFileSync(new URL("../src/utils/mediaSrc.ts", import.meta.url), "utf8");
  const keep = media.match(/const V2_VISUAL_KEEP = new Set<string>\(\[([\s\S]*?)\]\)/)?.[1] || "";
  for (const [semantic, filename] of mappings) {
    assert.match(keep, new RegExp(`["]${semantic}["]`), `${semantic} 未启用新图标包`);
    const current = new URL(`../src/static/icons/v2/${filename}`, import.meta.url);
    const backup = new URL(`../design-assets/icon-backup-before-custom-pack-2026-08-10/${filename}`, import.meta.url);
    assert.equal(existsSync(current), true, `${filename} 不存在`);
    assert.equal(existsSync(backup), true, `${filename} 缺少可恢复备份`);
    assert.notEqual(digest(current), digest(backup), `${filename} 尚未替换`);
  }
});
