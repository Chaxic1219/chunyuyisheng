"use strict";

const { ensureMallSchema } = require("./mallSchema.js");

/**
 * 骨科服务包交易域表结构 + 王云程种子商品。
 * schema 始终执行；种子写入由调用方包在 unlessDataFrozen 中。
 */

function nowIso() {
  return new Date().toISOString();
}

function ensureColumn(db, table, column, ddlFragment) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddlFragment}`);
  }
}

/** S2：一单可多实例，去掉 svc_instances.order_id 上的 UNIQUE（含既有库迁移） */
function dropUniqueOrderIdOnInstances(db) {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='svc_instances'`).get();
  if (!exists) return;
  const indexes = db.prepare(`PRAGMA index_list(svc_instances)`).all();
  const toDrop = [];
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const cols = db.prepare(`PRAGMA index_info('${String(idx.name).replace(/'/g, "''")}')`).all();
    if (cols.length === 1 && cols[0].name === "order_id") toDrop.push(idx.name);
  }
  if (!toDrop.length) return;

  // 列级 UNIQUE 产生的 sqlite_autoindex_* 无法 DROP INDEX，需重建表
  db.exec(`
    CREATE TABLE svc_instances__s2(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      version_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      service_start_date TEXT NOT NULL,
      service_end_date TEXT NOT NULL,
      plan_id INTEGER,
      summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES svc_orders(id)
    );
    INSERT INTO svc_instances__s2(
      id, order_id, person_id, doctor_id, version_id, title, status,
      service_start_date, service_end_date, plan_id, summary_json, created_at, updated_at
    ) SELECT
      id, order_id, person_id, doctor_id, version_id, title, status,
      service_start_date, service_end_date, plan_id, summary_json, created_at, updated_at
    FROM svc_instances;
    DROP TABLE svc_instances;
    ALTER TABLE svc_instances__s2 RENAME TO svc_instances;
  `);
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mp_person_addresses(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    region TEXT NOT NULL,
    detail TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_mp_person_addresses_person ON mp_person_addresses(person_id)`
  );

  db.exec(`CREATE TABLE IF NOT EXISTS svc_products(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    current_version_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(doctor_id, slug)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_products_doctor ON svc_products(doctor_id, status)`);
  ensureColumn(db, "svc_products", "category", "category TEXT NOT NULL DEFAULT 'rehab'");
  ensureColumn(db, "svc_products", "cost_cents", "cost_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "svc_products", "list_price_cents", "list_price_cents INTEGER NOT NULL DEFAULT 0");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_products_category ON svc_products(doctor_id, category, status)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_product_versions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    version_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    cover TEXT,
    service_days INTEGER NOT NULL DEFAULT 30,
    eligible_json TEXT,
    ineligible_json TEXT,
    service_amount_cents INTEGER NOT NULL DEFAULT 0,
    goods_amount_cents INTEGER NOT NULL DEFAULT 0,
    shipping_amount_cents INTEGER NOT NULL DEFAULT 0,
    total_amount_cents INTEGER NOT NULL DEFAULT 0,
    content_json TEXT,
    assessment_json TEXT,
    consultation_json TEXT,
    goods_json TEXT,
    refund_policy TEXT,
    agreement_version TEXT,
    privacy_consent_version TEXT,
    refund_policy_version TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(product_id, version_no),
    FOREIGN KEY(product_id) REFERENCES svc_products(id)
  )`);
  ensureColumn(db, "svc_product_versions", "cost_cents", "cost_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "svc_product_versions", "list_price_cents", "list_price_cents INTEGER NOT NULL DEFAULT 0");

  db.exec(`CREATE TABLE IF NOT EXISTS svc_components(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'internal',
    provider_ref TEXT,
    provider_name TEXT,
    description TEXT,
    default_unit TEXT NOT NULL,
    default_sla_hours INTEGER NOT NULL DEFAULT 0,
    default_action_key TEXT,
    default_action_label TEXT,
    settlement_enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_components_type_status ON svc_components(type, status)`);
  ensureColumn(db, "svc_components", "config_json", "config_json TEXT");

  db.exec(`CREATE TABLE IF NOT EXISTS svc_product_version_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    component_id INTEGER,
    component_code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider_json TEXT,
    description TEXT,
    benefit_type TEXT NOT NULL,
    total_quota INTEGER,
    period_unit TEXT,
    period_quota INTEGER,
    unit TEXT NOT NULL,
    sla_hours INTEGER NOT NULL DEFAULT 0,
    lead_days INTEGER NOT NULL DEFAULT 0,
    reset_each_period INTEGER NOT NULL DEFAULT 0,
    allow_repeat_apply INTEGER NOT NULL DEFAULT 0,
    max_concurrent INTEGER NOT NULL DEFAULT 1,
    settlement_enabled INTEGER NOT NULL DEFAULT 0,
    start_day INTEGER NOT NULL DEFAULT 0,
    end_day INTEGER,
    action_key TEXT,
    action_label TEXT,
    notify_enabled INTEGER NOT NULL DEFAULT 0,
    refund_share_cents INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(version_id) REFERENCES svc_product_versions(id),
    FOREIGN KEY(component_id) REFERENCES svc_components(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_version_items_version ON svc_product_version_items(version_id, sort_order, id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    service_amount_cents INTEGER NOT NULL,
    goods_amount_cents INTEGER NOT NULL,
    shipping_amount_cents INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    service_for TEXT NOT NULL DEFAULT 'self',
    contact_phone TEXT,
    receiver_name TEXT,
    receiver_phone TEXT,
    receiver_address TEXT,
    source_doctor_id TEXT,
    source_group_id TEXT,
    source_channel TEXT,
    idempotency_key TEXT,
    agreement_accepted_at TEXT,
    privacy_accepted_at TEXT,
    paid_at TEXT,
    profile_submitted_at TEXT,
    reviewed_at TEXT,
    reviewer_admin_id INTEGER,
    review_note TEXT,
    service_start_date TEXT,
    instance_id INTEGER,
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_orders_person ON svc_orders(person_id, status, id DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_orders_doctor ON svc_orders(doctor_id, status, id DESC)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_orders_idem
    ON svc_orders(person_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != ''`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_payments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    out_trade_no TEXT NOT NULL UNIQUE,
    provider_trade_no TEXT,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    prepay_json TEXT,
    notify_summary TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_payments_order ON svc_payments(order_id, id DESC)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_order_profiles(
    order_id INTEGER PRIMARY KEY,
    surgery_date TEXT,
    surgery_type TEXT,
    laterality TEXT,
    recovery_stage TEXT,
    symptoms_json TEXT,
    voucher_urls_json TEXT,
    extra_json TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_instances(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    service_start_date TEXT NOT NULL,
    service_end_date TEXT NOT NULL,
    plan_id INTEGER,
    summary_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);
  // S2：一单多行 → 多实例，去掉历史 UNIQUE(order_id)
  dropUniqueOrderIdOnInstances(db);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_instances_person ON svc_instances(person_id, status, id DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_instances_order ON svc_instances(order_id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_entitlements(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    order_line_id INTEGER,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    version_item_id INTEGER,
    component_code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider_json TEXT,
    unit TEXT NOT NULL,
    total_quota INTEGER,
    used_quota INTEGER NOT NULL DEFAULT 0,
    reserved_quota INTEGER NOT NULL DEFAULT 0,
    remaining_quota INTEGER,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    rule_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(instance_id, version_item_id),
    FOREIGN KEY(instance_id) REFERENCES svc_instances(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_entitlements_person ON svc_entitlements(person_id, status, id DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_entitlements_instance ON svc_entitlements(instance_id, id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_entitlement_usages(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entitlement_id INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    requested_qty INTEGER NOT NULL DEFAULT 1,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    consumed_qty INTEGER NOT NULL DEFAULT 0,
    balance_before INTEGER,
    balance_after INTEGER,
    biz_type TEXT,
    biz_ref TEXT,
    actor_type TEXT NOT NULL DEFAULT 'patient',
    actor_id INTEGER,
    note TEXT,
    requested_at TEXT NOT NULL,
    accepted_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(entitlement_id, idempotency_key),
    FOREIGN KEY(entitlement_id) REFERENCES svc_entitlements(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_usage_entitlement ON svc_entitlement_usages(entitlement_id, status, id DESC)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_refunds(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    payment_id INTEGER,
    provider TEXT NOT NULL,
    out_refund_no TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_cart_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(person_id, version_id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_cart_person_doctor ON svc_cart_items(person_id, doctor_id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_order_lines(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    service_amount_cents INTEGER NOT NULL,
    goods_amount_cents INTEGER NOT NULL,
    shipping_amount_cents INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL,
    instance_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_order_lines_order ON svc_order_lines(order_id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_coupon_templates(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    threshold_cents INTEGER NOT NULL DEFAULT 0,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    percent_off INTEGER NOT NULL DEFAULT 0,
    max_discount_cents INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    total_quota INTEGER NOT NULL DEFAULT 0,
    claimed_count INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_coupons(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    discount_snapshot_cents INTEGER,
    order_id INTEGER,
    claimed_at TEXT NOT NULL,
    locked_at TEXT,
    used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_coupons_person_status ON svc_coupons(person_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_coupons_template ON svc_coupons(template_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_coupons_order ON svc_coupons(order_id)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_coupon_redemption_codes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'single',
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(template_id) REFERENCES svc_coupon_templates(id)
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_svc_coupon_codes_template ON svc_coupon_redemption_codes(template_id)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_coupon_codes_code ON svc_coupon_redemption_codes(code)`);

  db.exec(`CREATE TABLE IF NOT EXISTS svc_coupon_redemption_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    coupon_id INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL,
    UNIQUE(code_id, person_id)
  )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_svc_coupon_code_logs_person ON svc_coupon_redemption_logs(person_id)`
  );

  db.exec(`CREATE TABLE IF NOT EXISTS svc_after_sales(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reason TEXT,
    admin_note TEXT,
    refund_amount_cents INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    FOREIGN KEY(order_id) REFERENCES svc_orders(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_after_sales_person ON svc_after_sales(person_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_after_sales_order ON svc_after_sales(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_after_sales_doctor ON svc_after_sales(doctor_id, status)`);

  ensureColumn(db, "svc_orders", "coupon_id", "coupon_id INTEGER");
  ensureColumn(db, "svc_orders", "discount_amount_cents", "discount_amount_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "svc_orders", "payable_amount_cents", "payable_amount_cents INTEGER");
  ensureMallSchema(db);
}

module.exports = { ensureSchema, nowIso };
