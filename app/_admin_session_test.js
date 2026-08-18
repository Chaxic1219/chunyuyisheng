"use strict";
/**
 * P0: admin session persistence — failing tests first.
 * Run: node _admin_session_test.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chunyu-admin-sess-"));
const dbPath = path.join(tmp, "t.db");
process.env.DB_PATH = dbPath;

const { db } = require("./db.js");
const { createAdminSessionStore } = require("./admin_session_store.js");

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  OK", msg);
  else { console.log("  FAIL", msg); failed++; }
}

const store = createAdminSessionStore(db);
const token = "tok_persist_1";
const sess = {
  adminId: 1,
  username: "admin",
  role: "super",
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
  expiresAt: Date.now() + 60 * 60 * 1000
};

console.log("1) set + get");
store.set(token, sess);
ok(!!store.get(token), "memory get after set");
ok(store.get(token).adminId === 1, "adminId roundtrip");

console.log("2) survive cold reload (new store instance = restart)");
const store2 = createAdminSessionStore(db);
const loaded = store2.get(token);
ok(!!loaded, "loaded after restart");
ok(loaded && loaded.username === "admin", "username persisted");
ok(loaded && loaded.expiresAt > Date.now(), "expiresAt persisted");

console.log("3) sliding touch persists");
const nextExp = Date.now() + 2 * 60 * 60 * 1000;
loaded.lastSeenAt = Date.now();
loaded.expiresAt = nextExp;
store2.set(token, loaded);
const store3 = createAdminSessionStore(db);
ok(Math.abs(store3.get(token).expiresAt - nextExp) < 5, "touched expiresAt persisted");

console.log("4) delete + deleteByAdminId");
store3.delete(token);
ok(!store3.get(token), "deleted");
store3.set("a", { ...sess, adminId: 7 });
store3.set("b", { ...sess, adminId: 7 });
store3.set("c", { ...sess, adminId: 8 });
const dropped = store3.deleteByAdminId(7);
ok(dropped === 2, "deleteByAdminId dropped 2, got " + dropped);
ok(!store3.get("a") && !store3.get("b") && !!store3.get("c"), "only admin 7 cleared");

console.log("5) expired purged on get");
store3.set("old", { ...sess, adminId: 9, expiresAt: Date.now() - 1000 });
ok(!store3.get("old"), "expired returns null");

try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
console.log(failed ? `\nFAILED ${failed}` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
