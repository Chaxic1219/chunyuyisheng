const os = require("os");
const path = require("path");
const fs = require("fs");

const TMP = path.join(os.tmpdir(), "chunyu_partnership_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach((file) => {
  try { fs.unlinkSync(file); } catch (e) {}
});

process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const { registerPartnershipRoutes } = require("./routes/partnership.js");

let count = 0;
const failures = [];
function ok(condition, message) {
  count += 1;
  if (!condition) failures.push(message);
  console.log((condition ? "ok " : "not ok ") + count + " - " + message);
}

const routes = [];
function route(method, re, fn) {
  routes.push({ method, re, fn });
}

let requestBody = {};
async function parseBody() {
  return requestBody;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.body = payload;
}

function gate(req, res) {
  if (req.admin === true) return { adminId: 1 };
  json(res, 401, { error: "未登录" });
  return null;
}

const notifications = [];
let notificationError = null;

registerPartnershipRoutes(route, {
  db,
  parseBody,
  json,
  gate,
  now: () => "2026-07-24T00:00:00.000Z",
  notifyPartnershipApplication: async (application) => {
    notifications.push(application);
    if (notificationError) throw notificationError;
  }
});

async function call(method, pathName, body, extraReq) {
  const matched = routes.find((r) => r.method === method && r.re.test(pathName));
  if (!matched) throw new Error("route not found: " + method + " " + pathName);
  const match = pathName.match(matched.re);
  requestBody = body || {};
  const req = Object.assign({ method, url: pathName, headers: {} }, extraReq || {});
  const res = {};
  await matched.fn(req, res, match, {});
  return res;
}

(async () => {
  const created = await call("POST", "/api/partnership-applications", {
    name: "张医生",
    hospital: "北京测试医院",
    department: "消化内科",
    title: "主任医师",
    phone: "13800138000",
    source: "landing_page"
  });
  ok(created.statusCode === 200 && created.body && created.body.ok === true && created.body.id > 0, "公开接口保存合作申请并返回 id");

  const row = db.prepare("SELECT * FROM partnership_applications WHERE id=?").get(created.body.id);
  ok(row && row.name === "张医生" && row.phone === "13800138000" && row.status === "待跟进", "合作申请写入独立表并保持待跟进状态");

  await new Promise((resolve) => setImmediate(resolve));
  ok(notifications.length === 1 && notifications[0].id === created.body.id && notifications[0].phone === "13800138000", "partnership submit triggers email notification");

  const invalid = await call("POST", "/api/partnership-applications", {
    name: "张医生",
    phone: "123"
  });
  ok(invalid.statusCode === 400, "公开接口拒绝非法手机号");

  const list = await call("GET", "/api/admin/partnership-applications", null, { admin: true });
  ok(list.statusCode === 200 && Array.isArray(list.body) && list.body.length === 1 && list.body[0].name === "张医生", "后台接口可读取合作申请列表");

  const updated = await call("PUT", "/api/admin/partnership-applications/" + created.body.id, { status: "已联系" }, { admin: true });
  ok(updated.statusCode === 200 && updated.body && updated.body.ok === true, "后台接口可更新跟进状态");
  const after = db.prepare("SELECT status FROM partnership_applications WHERE id=?").get(created.body.id);
  ok(after && after.status === "已联系", "跟进状态已落库");

  notificationError = new Error("smtp unavailable");
  const createdWhenMailFails = await call("POST", "/api/partnership-applications", {
    name: "Li Doctor",
    phone: "13900139000"
  });
  await new Promise((resolve) => setImmediate(resolve));
  ok(createdWhenMailFails.statusCode === 200 && createdWhenMailFails.body && createdWhenMailFails.body.ok === true, "mail notification failure does not block submit");

  console.log("\nchecks: " + count + " failures: " + failures.length);
  if (failures.length) {
    failures.forEach((failure) => console.log(" - " + failure));
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
