"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.DB_PATH = path.join(require("os").tmpdir(), `outbound-image-${Date.now()}.db`);
process.env.QIWE_DRY_RUN = "1";
process.env.TRIAGE_AI_DISABLED = "1";
process.env.PUBLIC_ORIGIN = "https://example.com";

require("./db.js");
const delivery = require("./qiwe_bridge.js");
const media = require("./modules/qiwe/media.js");

const relative = "/uploads/outbound-assets/image-test.png";
const absolute = path.join(__dirname, "public", relative.replace(/^\//, ""));
fs.mkdirSync(path.dirname(absolute), { recursive: true });
fs.writeFileSync(absolute, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

const reply = { responses: [{ type: "image", title: "", url: relative, imageUrl: relative }] };
const plan = delivery.prepareDelivery(1, reply, "", { isGroup: true });
assert.equal(plan.linkCards.length, 0, "图片不能退化成链接卡");
assert.deepEqual(plan.images, [{ url: relative }], "图片投递不需要标题");

const image = media.resolveOutboundImageAsset(relative);
assert.equal(image.filename, "image-test.png");
assert.ok(Buffer.isBuffer(image.buffer) && image.buffer.length === 7);
assert.equal(media.resolveOutboundImageAsset("/uploads/outbound-assets/../server.js"), null);

fs.unlinkSync(absolute);
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (_) {}
}
console.log("outbound image PASS");
