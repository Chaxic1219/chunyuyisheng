"use strict";
const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const TMP = path.join(os.tmpdir(), `chunyu-removed-doctor-${Date.now()}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(TMP + suffix); } catch (e) {}
}
process.env.DB_PATH = TMP;
delete process.env.DB_FREEZE_EXISTING_DATA;

const { db, applySeedPatches, rememberRemovedDoctorSlug, forgetRemovedDoctorSlug } = require("./db.js");

function main(){
  assert.ok(db.prepare("SELECT id FROM doctors WHERE slug='huang'").get(), "种子含黄安华");
  assert.ok(db.prepare("SELECT id FROM doctors WHERE slug='guo'").get(), "种子含郭强");

  const huang = db.prepare("SELECT id,slug,name FROM doctors WHERE slug='huang'").get();
  db.prepare("DELETE FROM doctors WHERE id=?").run(huang.id);
  rememberRemovedDoctorSlug(huang.slug, huang.name);
  applySeedPatches();
  assert.equal(db.prepare("SELECT id FROM doctors WHERE slug='huang'").get(), undefined, "删除后启动种子不得复活黄安华");
  assert.ok(db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get(), "吕富靖仍在");

  const guo = db.prepare("SELECT id,slug,name FROM doctors WHERE slug='guo'").get();
  db.prepare("DELETE FROM doctors WHERE id=?").run(guo.id);
  rememberRemovedDoctorSlug(guo.slug, guo.name);
  applySeedPatches();
  assert.equal(db.prepare("SELECT id FROM doctors WHERE slug='guo'").get(), undefined, "删除后启动种子不得复活郭强");

  forgetRemovedDoctorSlug("huang");
  applySeedPatches();
  assert.ok(db.prepare("SELECT id FROM doctors WHERE slug='huang'").get(), "管理员重新创建同 slug 后允许种子补回");
  console.log("removed_doctor_slug ok");
}

main();
