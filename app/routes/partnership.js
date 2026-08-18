"use strict";

function registerPartnershipRoutes(route, ctx) {
  const { db, parseBody, json, gate, now } = ctx;
  const notifyPartnershipApplication = ctx.notifyPartnershipApplication || (async () => {});

  db.exec(`CREATE TABLE IF NOT EXISTS partnership_applications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hospital TEXT,
    department TEXT,
    title TEXT,
    phone TEXT NOT NULL,
    status TEXT DEFAULT '待跟进',
    source TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  function text(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function isPhone(value) {
    return /^1[3-9]\d{9}$/.test(String(value || "").trim());
  }

  route("POST", /^\/api\/partnership-applications$/, async (req, res) => {
    const body = await parseBody(req);
    if (body.__oversize) return json(res, 413, { error: "请求体过大" });

    const name = text(body.name, 60);
    const phone = text(body.phone, 20);
    const hospital = text(body.hospital, 120);
    const department = text(body.department, 80);
    const title = text(body.title, 80);
    const source = text(body.source || "landing_page", 80);
    if (!name) return json(res, 400, { error: "请填写姓名" });
    if (!isPhone(phone)) return json(res, 400, { error: "请填写正确的手机号" });

    const ts = now();
    const result = db.prepare(`INSERT INTO partnership_applications
      (name,hospital,department,title,phone,status,source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
        name,
        hospital,
        department,
        title,
        phone,
        "待跟进",
        source,
        ts,
        ts
      );
    Promise.resolve(notifyPartnershipApplication({
      id: result.lastInsertRowid,
      name,
      hospital,
      department,
      title,
      phone,
      status: "pending",
      source,
      createdAt: ts,
      updatedAt: ts
    })).catch((error) => {
      console.error("[partnership] email notification failed", error && error.message);
    });
    json(res, 200, { ok: true, id: result.lastInsertRowid });
  });

  route("GET", /^\/api\/admin\/partnership-applications$/, (req, res, m, q) => {
    const session = gate(req, res);
    if (!session) return;
    const status = text(q && q.status, 40);
    let sql = "SELECT * FROM partnership_applications";
    const args = [];
    if (status) {
      sql += " WHERE status=?";
      args.push(status);
    }
    sql += " ORDER BY id DESC LIMIT 500";
    json(res, 200, db.prepare(sql).all(...args).map((row) => ({
      id: row.id,
      name: row.name,
      hospital: row.hospital || "",
      department: row.department || "",
      title: row.title || "",
      phone: row.phone,
      status: row.status || "待跟进",
      source: row.source || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })));
  });

  route("PUT", /^\/api\/admin\/partnership-applications\/(\d+)$/, async (req, res, m) => {
    const session = gate(req, res);
    if (!session) return;
    const body = await parseBody(req);
    const status = text(body.status || "待跟进", 40);
    const allowed = new Set(["待跟进", "已联系", "已转化", "无效"]);
    if (!allowed.has(status)) return json(res, 400, { error: "不支持的状态" });
    const result = db.prepare("UPDATE partnership_applications SET status=?, updated_at=? WHERE id=?")
      .run(status, now(), +m[1]);
    if (!result.changes) return json(res, 404, { error: "申请不存在" });
    json(res, 200, { ok: true });
  });
}

module.exports = { registerPartnershipRoutes };
