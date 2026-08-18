"use strict";
/**
 * P2: route index + session throttle
 * Run: node _p2_test.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createRouteIndex, exactPathFromRe } = require("./shared/routeIndex.js");

let failed = 0;
function ok(cond, msg){
  if(cond) console.log("  OK", msg);
  else { console.log("  FAIL", msg); failed++; }
}

console.log("1) exactPathFromRe");
ok(exactPathFromRe(/^\/api\/admin\/me$/) === "/api/admin/me", "exact me");
ok(exactPathFromRe(/^\/api\/admin\/messages\/(\d+)\/send$/) === null, "capture not exact");
ok(exactPathFromRe(/^\/api\/bootstrap\/?$/) === null, "optional slash not exact");

console.log("2) routeIndex match");
const idx = createRouteIndex();
let hitMe = 0, hitSend = 0;
idx.add("GET", /^\/api\/admin\/me$/, ()=>{ hitMe++; });
idx.add("POST", /^\/api\/admin\/messages\/(\d+)\/send$/, (req,res,m)=>{ hitSend += Number(m[1]); });
idx.add("GET", /^\/api\/admin\/messages$/, ()=>{});
const a = idx.match("GET", "/api/admin/me");
ok(a && a.exact === true, "me is exact hit");
a.entry.fn();
ok(hitMe === 1, "me handler");
const b = idx.match("POST", "/api/admin/messages/214/send");
ok(b && b.exact === false && b.match[1] === "214", "send capture");
b.entry.fn(null,null,b.match);
ok(hitSend === 214, "send handler got id");
ok(!idx.match("GET", "/api/nope"), "404 null");
ok(idx.stats().exact >= 1 && idx.stats().total === 3, "stats");

console.log("3) session throttle");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chunyu-p2-"));
process.env.DB_PATH = path.join(tmp, "t.db");
process.env.ADMIN_SESSION_PERSIST_MS = "60000";
const { db } = require("./db.js");
const { createAdminSessionStore } = require("./admin_session_store.js");
const store = createAdminSessionStore(db);
const token = "t1";
const sess = {
  adminId:1, username:"admin", role:"super",
  createdAt:Date.now(), lastSeenAt:Date.now(), expiresAt:Date.now()+12*3600*1000
};
store.set(token, sess);
const n1 = db.prepare("SELECT last_seen_at_ms FROM admin_sessions WHERE token=?").get(token).last_seen_at_ms;
sess.lastSeenAt = Date.now() + 1;
sess.expiresAt = Date.now() + 12*3600*1000;
store.set(token, sess, { throttle:true });
const n2 = db.prepare("SELECT last_seen_at_ms FROM admin_sessions WHERE token=?").get(token).last_seen_at_ms;
ok(n1 === n2, "throttle skips immediate rewrite");
store.set(token, sess); // force
const n3 = db.prepare("SELECT last_seen_at_ms FROM admin_sessions WHERE token=?").get(token).last_seen_at_ms;
ok(n3 === sess.lastSeenAt, "force persist updates");

try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
console.log(failed ? `\nFAILED ${failed}` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
