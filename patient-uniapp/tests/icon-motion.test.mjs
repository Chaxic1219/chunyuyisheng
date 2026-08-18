import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { resolveIconAsset, resolveSemanticIcon } from "../src/constants/iconRegistry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("location icon uses the semantic registry and v2 asset", () => {
  assert.equal(resolveSemanticIcon("location"), "location");
  assert.equal(resolveIconAsset("location"), "src/static/icons/v2/location.png");
  assert.equal(existsSync(path.join(root, "src/static/icons/v2/location.png")), true);
});

test("资料卡保留 v2 视觉，其余回退旧图；动效能力保留", () => {
  for (const file of ["camera.png", "health-record.png", "profile-edit.png"]) {
    assert.equal(existsSync(path.join(root, "src/static/icons/v2", file)), true, file);
  }
  for (const file of ["help.png", "quick-upload.png", "asset-records.png", "chat.png"]) {
    assert.equal(existsSync(path.join(root, "src/static/icons", file)), true, file);
  }
  for (const file of ["home.png", "home-active.png", "chat-fab.png", "user.png"]) {
    assert.equal(existsSync(path.join(root, "src/static/tab", file)), true, file);
  }

  const media = read("src/utils/mediaSrc.ts");
  assert.match(media, /V2_VISUAL_KEEP/);
  assert.match(media, /quick-upload/);
  assert.match(media, /health-record/);
  assert.match(media, /camera/);

  const icon = read("src/components/AppIcon.vue");
  assert.match(icon, /resolveIconMotion|app-icon--motion-/);
  assert.match(icon, /state\?: "idle" \| "loading" \| "success" \| "error"/);

  const store = read("src/stores/app.ts");
  assert.match(store, /reducedMotion|setReducedMotion|hydrateReducedMotion/);

  const app = read("src/App.vue");
  assert.match(app, /pressable--motion|app-icon--motion-right|app-icon--motion-rotate/);

  const mine = read("src/pages/mine/index.vue");
  assert.match(mine, /chooseAvatar|onChooseAvatar/);
  assert.match(mine, /icon="health-record"|icon="profile-edit"|nav-profile/);

  const tab = read("src/custom-tab-bar/index.js");
  assert.match(tab, /static\/tab\/home\.png/);
  assert.match(tab, /static\/tab\/chat\.png|static\/tab\/user\.png/);
  assert.match(tab, /reducedMotion/);
});
