"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const TABLES = [
  "svc_entitlement_usages", "svc_entitlements", "ops_service_tasks", "ops_service_instances",
  "mall_goods_fulfillments", "package_component_instances", "package_instances", "svc_after_sales",
  "svc_refunds", "svc_payments", "svc_order_profiles", "svc_instances",
  "mall_order_line_snapshots", "mall_integration_outbox", "svc_order_lines",
  "svc_orders", "svc_cart_items", "svc_product_version_items", "svc_product_versions", "svc_products",
];

function exists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function inspect(db) {
  const result = {};
  for (const table of TABLES) result[table] = exists(db, table) ? db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c : 0;
  return result;
}

function orphanCount(db) {
  let count = 0;
  const checks = [
    ["svc_order_lines", "SELECT COUNT(*) AS c FROM svc_order_lines l LEFT JOIN svc_orders o ON o.id=l.order_id WHERE o.id IS NULL"],
    ["svc_payments", "SELECT COUNT(*) AS c FROM svc_payments p LEFT JOIN svc_orders o ON o.id=p.order_id WHERE o.id IS NULL"],
    ["package_instances", "SELECT COUNT(*) AS c FROM package_instances p LEFT JOIN svc_orders o ON o.id=p.order_id WHERE o.id IS NULL"],
    ["svc_entitlements", "SELECT COUNT(*) AS c FROM svc_entitlements e LEFT JOIN svc_instances i ON i.id=e.instance_id WHERE i.id IS NULL"],
  ];
  for (const [table, sql] of checks) if (exists(db, table)) count += Number(db.prepare(sql).get().c);
  return count;
}

function rollbackOrderInventory(db) {
  if (!exists(db, "mall_inventory_movements") || !exists(db, "mall_goods_inventory")) return;
  const rows = db.prepare(
    `SELECT goods_sku_id,
      SUM(CASE WHEN movement_type='sold' THEN quantity ELSE 0 END) AS sold_qty,
      SUM(CASE WHEN movement_type='reserve' THEN quantity WHEN movement_type='release' THEN quantity WHEN movement_type='sold' THEN -quantity ELSE 0 END) AS reserved_qty
     FROM mall_inventory_movements WHERE reference_type='order_line' GROUP BY goods_sku_id`
  ).all();
  for (const row of rows) {
    db.prepare(
      `UPDATE mall_goods_inventory SET
        reserved=MAX(0,reserved-?),sold=MAX(0,sold-?),updated_at=datetime('now') WHERE goods_sku_id=?`
    ).run(Number(row.reserved_qty || 0), Number(row.sold_qty || 0), row.goods_sku_id);
  }
  db.prepare("DELETE FROM mall_inventory_movements WHERE reference_type='order_line'").run();
}

function cleanup(db, options = {}) {
  const before = inspect(db);
  if (!options.apply) return { before, after: before, orphans: orphanCount(db), applied: false };
  db.exec("BEGIN IMMEDIATE");
  try {
    rollbackOrderInventory(db);
    for (const table of TABLES) {
      if (table === "svc_orders" && exists(db, "svc_coupons")) {
        db.prepare("UPDATE svc_coupons SET status=CASE WHEN status IN ('locked','used') THEN 'available' ELSE status END,order_id=NULL,locked_at=NULL,used_at=NULL,updated_at=datetime('now') WHERE order_id IS NOT NULL").run();
      }
      if (exists(db, table)) db.prepare(`DELETE FROM ${table}`).run();
      if (options.failAfter === table) throw new Error("forced cleanup failure");
    }
    const after = inspect(db);
    const orphans = orphanCount(db);
    if (orphans) throw new Error(`cleanup left ${orphans} orphan rows`);
    db.exec("COMMIT");
    return { before, after, orphans, applied: true };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch (_) { /* ignore */ }
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const backupIndex = args.indexOf("--backup");
  const backup = backupIndex >= 0 ? path.resolve(args[backupIndex + 1] || "") : "";
  if (apply && (!backup || !fs.existsSync(backup) || !fs.statSync(backup).isFile() || fs.statSync(backup).size <= 0)) {
    throw new Error("--apply 必须同时提供存在且非空的绝对备份文件 --backup <path>");
  }
  const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, "..", "data.db"));
  const db = new DatabaseSync(dbPath);
  try { console.log(JSON.stringify(cleanup(db, { apply }), null, 2)); } finally { db.close(); }
}

module.exports = { inspect, cleanup };
