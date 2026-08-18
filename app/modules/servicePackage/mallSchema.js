"use strict";

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function migrateCartForMallSkus(db) {
  const columns = db.prepare("PRAGMA table_info(svc_cart_items)").all();
  const versionColumn = columns.find((item) => item.name === "version_id");
  if (!versionColumn || !versionColumn.notnull) return;
  db.exec(`
    CREATE TABLE svc_cart_items__mall(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      version_id INTEGER,
      mall_sku_id INTEGER,
      qty INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(version_id IS NOT NULL OR mall_sku_id IS NOT NULL)
    );
    INSERT INTO svc_cart_items__mall(id,person_id,doctor_id,version_id,mall_sku_id,qty,created_at,updated_at)
    SELECT id,person_id,doctor_id,version_id,NULL,qty,created_at,updated_at FROM svc_cart_items;
    DROP TABLE svc_cart_items;
    ALTER TABLE svc_cart_items__mall RENAME TO svc_cart_items;
  `);
}

function ensureMallSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mall_benefit_skus(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cycle_days INTEGER NOT NULL CHECK(cycle_days > 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
      current_version_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mall_benefit_sku_versions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benefit_sku_id INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
      provider_name TEXT NOT NULL DEFAULT '',
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(estimated_cost_cents >= 0),
      max_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(max_cost_cents >= 0),
      channel_config_json TEXT NOT NULL DEFAULT '{}',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(benefit_sku_id, version_no),
      FOREIGN KEY(benefit_sku_id) REFERENCES mall_benefit_skus(id)
    );
    CREATE TABLE IF NOT EXISTS mall_benefit_sku_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      benefit_type TEXT NOT NULL,
      quota INTEGER CHECK(quota IS NULL OR quota >= 0),
      unit TEXT NOT NULL,
      apply_rule_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(version_id) REFERENCES mall_benefit_sku_versions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mall_benefit_versions_sku
      ON mall_benefit_sku_versions(benefit_sku_id, version_no DESC);

    CREATE TABLE IF NOT EXISTS ops_service_templates(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_doctor_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'health_management',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
      current_version_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_doctor_id, code)
    );
    CREATE TABLE IF NOT EXISTS ops_service_template_versions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
      cycle_days INTEGER NOT NULL CHECK(cycle_days > 0),
      start_condition TEXT NOT NULL DEFAULT 'package_activated',
      provider_name TEXT NOT NULL DEFAULT '',
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(estimated_cost_cents >= 0),
      max_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(max_cost_cents >= 0),
      config_json TEXT NOT NULL DEFAULT '{}',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(template_id, version_no),
      FOREIGN KEY(template_id) REFERENCES ops_service_templates(id)
    );
    CREATE TABLE IF NOT EXISTS ops_service_template_tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      timing_type TEXT NOT NULL,
      timing_value INTEGER NOT NULL DEFAULT 0,
      execution_mode TEXT NOT NULL,
      result_schema_json TEXT NOT NULL DEFAULT '{}',
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(estimated_cost_cents >= 0),
      escalation_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(version_id) REFERENCES ops_service_template_versions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ops_templates_owner_status
      ON ops_service_templates(owner_doctor_id, status, id DESC);

    CREATE TABLE IF NOT EXISTS mall_goods_skus(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      purchase_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(purchase_cost_cents >= 0),
      logistics_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(logistics_cost_cents >= 0),
      rebate_cents INTEGER NOT NULL DEFAULT 0 CHECK(rebate_cents >= 0),
      logistics_config_json TEXT NOT NULL DEFAULT '{}',
      after_sale_config_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
      version_no INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mall_goods_inventory(
      goods_sku_id INTEGER PRIMARY KEY,
      on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
      sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0),
      updated_at TEXT NOT NULL,
      CHECK(reserved + sold <= on_hand),
      FOREIGN KEY(goods_sku_id) REFERENCES mall_goods_skus(id)
    );
    CREATE TABLE IF NOT EXISTS mall_inventory_movements(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goods_sku_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reason TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(goods_sku_id, idempotency_key),
      FOREIGN KEY(goods_sku_id) REFERENCES mall_goods_skus(id)
    );
    CREATE INDEX IF NOT EXISTS idx_goods_inventory_sku ON mall_goods_inventory(goods_sku_id);

    CREATE TABLE IF NOT EXISTS mall_spus(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      scene TEXT NOT NULL DEFAULT '',
      target_people TEXT NOT NULL DEFAULT '',
      value_proposition TEXT NOT NULL DEFAULT '',
      service_boundary TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','offline')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(doctor_id, code)
    );
    CREATE TABLE IF NOT EXISTS mall_skus(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spu_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cycle_days INTEGER NOT NULL CHECK(cycle_days > 0),
      sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(sale_price_cents >= 0),
      list_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(list_price_cents >= 0),
      minimum_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_price_cents >= 0),
      minimum_margin_bps INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','offline')),
      version_no INTEGER NOT NULL DEFAULT 1,
      display_snapshot_json TEXT NOT NULL DEFAULT '{}',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(spu_id) REFERENCES mall_spus(id)
    );
    CREATE TABLE IF NOT EXISTS mall_sku_components(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id INTEGER NOT NULL,
      component_type TEXT NOT NULL CHECK(component_type IN ('BENEFIT_SKU','OPS_SERVICE_TEMPLATE','GOODS_SKU')),
      source_id INTEGER NOT NULL,
      source_version_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
      source_code TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL,
      provider_name TEXT NOT NULL DEFAULT '',
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(estimated_cost_cents >= 0),
      max_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(max_cost_cents >= 0),
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(sku_id) REFERENCES mall_skus(id)
    );
    CREATE TABLE IF NOT EXISTS mall_sku_cost_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id INTEGER NOT NULL,
      sku_version_no INTEGER NOT NULL,
      benefit_cost_cents INTEGER NOT NULL DEFAULT 0,
      ops_cost_cents INTEGER NOT NULL DEFAULT 0,
      goods_cost_cents INTEGER NOT NULL DEFAULT 0,
      logistics_cost_cents INTEGER NOT NULL DEFAULT 0,
      rebate_cents INTEGER NOT NULL DEFAULT 0,
      estimated_total_cents INTEGER NOT NULL DEFAULT 0,
      maximum_total_cents INTEGER NOT NULL DEFAULT 0,
      gross_margin_bps INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(sku_id, sku_version_no),
      FOREIGN KEY(sku_id) REFERENCES mall_skus(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mall_sku_one_benefit
      ON mall_sku_components(sku_id)
      WHERE component_type='BENEFIT_SKU' AND status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mall_sku_active_component
      ON mall_sku_components(sku_id, component_type, source_id, COALESCE(source_version_id, 0))
      WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_mall_spus_doctor_status ON mall_spus(doctor_id, status, id DESC);
    CREATE INDEX IF NOT EXISTS idx_mall_skus_spu_status ON mall_skus(spu_id, status, id DESC);

    CREATE TABLE IF NOT EXISTS package_instances(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_line_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      mall_spu_id INTEGER NOT NULL,
      mall_sku_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(order_line_id),
      FOREIGN KEY(order_id) REFERENCES svc_orders(id),
      FOREIGN KEY(order_line_id) REFERENCES svc_order_lines(id)
    );
    CREATE TABLE IF NOT EXISTS package_component_instances(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_instance_id INTEGER NOT NULL,
      component_type TEXT NOT NULL CHECK(component_type IN ('BENEFIT_SKU','OPS_SERVICE_TEMPLATE','GOODS_SKU')),
      source_id INTEGER NOT NULL,
      source_version_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed')),
      idempotency_key TEXT NOT NULL UNIQUE,
      result_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(package_instance_id, component_type, source_id, source_version_id),
      FOREIGN KEY(package_instance_id) REFERENCES package_instances(id)
    );
    CREATE INDEX IF NOT EXISTS idx_package_instances_person ON package_instances(person_id, status, id DESC);

    CREATE TABLE IF NOT EXISTS ops_service_instances(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_component_instance_id INTEGER NOT NULL UNIQUE,
      person_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      template_version_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_service_tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_instance_id INTEGER NOT NULL,
      template_task_id INTEGER,
      title TEXT NOT NULL,
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(service_instance_id, template_task_id),
      FOREIGN KEY(service_instance_id) REFERENCES ops_service_instances(id)
    );
    CREATE TABLE IF NOT EXISTS mall_goods_fulfillments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_component_instance_id INTEGER NOT NULL UNIQUE,
      goods_sku_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      status TEXT NOT NULL DEFAULT 'pending_shipment',
      carrier TEXT,
      tracking_no TEXT,
      receiver_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(goods_sku_id) REFERENCES mall_goods_skus(id)
    );
    CREATE TABLE IF NOT EXISTS mall_audit_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      doctor_id INTEGER,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    -- PRD §10.1：订单明细购买时的完整组成/价格/优惠/成本/协议快照（不可变，历史订单始终引用购买时版本）
    CREATE TABLE IF NOT EXISTS mall_order_line_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_line_id INTEGER NOT NULL UNIQUE,
      spu_id INTEGER,
      sku_id INTEGER,
      spu_code TEXT NOT NULL DEFAULT '',
      spu_name TEXT NOT NULL DEFAULT '',
      sku_code TEXT NOT NULL DEFAULT '',
      sku_name TEXT NOT NULL DEFAULT '',
      cycle_days INTEGER NOT NULL DEFAULT 0,
      component_snapshot_json TEXT NOT NULL DEFAULT '[]',
      price_snapshot_json TEXT NOT NULL DEFAULT '{}',
      cost_snapshot_json TEXT NOT NULL DEFAULT '{}',
      agreement_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES svc_orders(id),
      FOREIGN KEY(order_line_id) REFERENCES svc_order_lines(id)
    );

    -- PRD §10.1：跨系统事件 outbox（支付成功/组合激活/权益发放/运营实例生成/实物出库/退款/关单），
    -- 支撑分支幂等重试与异常追踪；同一事件幂等键唯一，成功后不重复处理
    CREATE TABLE IF NOT EXISTS mall_integration_outbox(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_instance_id INTEGER,
      package_component_instance_id INTEGER,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed','cancelled')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mall_outbox_status ON mall_integration_outbox(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_mall_outbox_package ON mall_integration_outbox(package_instance_id);
    CREATE INDEX IF NOT EXISTS idx_mall_line_snapshot_order ON mall_order_line_snapshots(order_id);
  `);

  migrateCartForMallSkus(db);
  ensureColumn(db, "svc_cart_items", "mall_sku_id", "mall_sku_id INTEGER");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_svc_cart_person_doctor ON svc_cart_items(person_id, doctor_id)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_svc_cart_legacy_version
    ON svc_cart_items(person_id, version_id) WHERE version_id IS NOT NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_svc_cart_mall_sku
    ON svc_cart_items(person_id, mall_sku_id) WHERE mall_sku_id IS NOT NULL`);
  ensureColumn(db, "svc_orders", "mall_spu_id", "mall_spu_id INTEGER");
  ensureColumn(db, "svc_orders", "mall_sku_id", "mall_sku_id INTEGER");
  ensureColumn(db, "svc_orders", "cost_snapshot_json", "cost_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "svc_order_lines", "mall_spu_id", "mall_spu_id INTEGER");
  ensureColumn(db, "svc_order_lines", "mall_sku_id", "mall_sku_id INTEGER");
  ensureColumn(db, "svc_order_lines", "component_snapshot_json", "component_snapshot_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "svc_order_lines", "cost_snapshot_json", "cost_snapshot_json TEXT NOT NULL DEFAULT '{}'");
}

module.exports = { ensureMallSchema };
