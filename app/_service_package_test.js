"use strict";
/**
 * 服务包交易垂直切片 — 表结构 + 订单/Mock 支付/开通闭环冒烟
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

process.env.NODE_ENV = "test";
process.env.MP_AUTH_STUB = "1";
process.env.SMS_DEMO = "1";
process.env.TRIAGE_AI_DISABLED = "1";
process.env.SERVICE_PAY_PROVIDER = "mock";
process.env.SERVICE_PAY_MOCK_AUTO = "1";
process.env.DB_PATH = path.join(os.tmpdir(), `svc-pkg-${Date.now()}.db`);
const tempDbFiles = [process.env.DB_PATH, process.env.DB_PATH + "-wal", process.env.DB_PATH + "-shm"];
function removeTempDbFiles() {
  tempDbFiles.forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
  });
}
removeTempDbFiles();

const { db } = require("./db.js");
const { createServicePackage } = require("./modules/servicePackage");

function closeDb() {
  try {
    db.close();
  } catch (e) {
    /* ignore */
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (e) {
    console.error("fail -", name);
    throw e;
  }
}

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

(async () => {
  const TABLES = [
    "svc_products",
    "svc_product_versions",
    "svc_orders",
    "svc_payments",
    "svc_order_profiles",
    "svc_instances",
    "svc_refunds",
  ];

  await test("tables exist", () => {
    for (const t of TABLES) assert.ok(tableExists(t), t);
  });

  await test("cart and order_lines tables exist", () => {
    assert.ok(tableExists("svc_cart_items"));
    assert.ok(tableExists("svc_order_lines"));
  });

  await test("coupon tables exist", () => {
    assert.ok(tableExists("svc_coupon_templates"));
    assert.ok(tableExists("svc_coupons"));
  });

  await test("svc_after_sales table exists", () => {
    assert.ok(tableExists("svc_after_sales"));
  });

  await test("benefit component and entitlement tables exist", () => {
    for (const name of [
      "svc_components",
      "svc_product_version_items",
      "svc_entitlements",
      "svc_entitlement_usages",
    ]) {
      assert.ok(tableExists(name), name);
    }
  });

  await test("svc_orders has coupon columns", () => {
    const cols = db.prepare(`PRAGMA table_info(svc_orders)`).all().map((c) => c.name);
    assert.ok(cols.includes("coupon_id"), "coupon_id column");
    assert.ok(cols.includes("discount_amount_cents"), "discount_amount_cents column");
    assert.ok(cols.includes("payable_amount_cents"), "payable_amount_cents column");
  });

  await test("svc_products has category", () => {
    const cols = db.prepare(`PRAGMA table_info(svc_products)`).all().map((c) => c.name);
    assert.ok(cols.includes("category"), "category column");
  });

  // 确保有王云程医生（种子医生可能因 freeze 或空库缺失）
  let doctor = db.prepare(`SELECT id, name FROM doctors WHERE name LIKE ?`).get("%王云程%");
  if (!doctor) {
    const info = db
      .prepare(
        `INSERT INTO doctors(slug, name, title, hospital, dept, active)
         VALUES ('wangyuncheng-test', '王云程', '主任医师', '测试医院', '骨科', 1)`
      )
      .run();
    doctor = { id: Number(info.lastInsertRowid), name: "王云程" };
  }

  await test("explicit test fixture package", () => {
    const fixtureSvc = createServicePackage(db);
    fixtureSvc.adminProducts.create(doctor.id, {
      slug: "ortho-postop-test",
      title: "骨科术后康复服务包",
      category: "rehab",
      serviceDays: 30,
      serviceAmount: 199,
      goodsAmount: 99,
      shippingAmount: 0,
      totalAmount: 298,
      cost: 200,
      listPrice: 398,
      publish: true,
    });
    const products = fixtureSvc.catalog.listPublished({ doctorId: doctor.id });
    assert.ok(products.length >= 1, "should have published product");
    assert.strictEqual(products[0].totalAmountCents, 29800);
  });

  await test("listPublished filters by category", () => {
    const svc = createServicePackage(db);
    const all = svc.catalog.listPublished({ doctorId: doctor.id });
    assert.ok(all.length >= 1);
    const rehab = svc.catalog.listPublished({ doctorId: doctor.id, category: "rehab" });
    assert.ok(rehab.every((p) => p.category === "rehab"));
    const empty = svc.catalog.listPublished({ doctorId: doctor.id, category: "followup" });
    assert.strictEqual(empty.length, 0);
  });

  const svc = createServicePackage(db);
  const products = svc.catalog.listPublished({ doctorId: doctor.id });
  const product = products[0];
  assert.ok(product);

  // 造 person
  const personInfo = db
    .prepare(
      `INSERT INTO persons(real_name, phone, created_at, updated_at)
       VALUES ('测试患者', '13800000001', datetime('now'), datetime('now'))`
    )
    .run();
  const personId = Number(personInfo.lastInsertRowid);

  let componentizedProduct;
  let componentizedOrder;
  let componentizedInstance;

  await test("cart add and list + doctor mismatch", () => {
    assert.ok(svc.cart, "svc.cart should be wired");
    svc.cart.clear(personId, doctor.id);
    svc.cart.addItem(personId, {
      versionId: product.versionId,
      doctorId: product.doctorId,
      qty: 1,
    });
    const list = svc.cart.list(personId, doctor.id);
    assert.strictEqual(list.doctorId, doctor.id);
    assert.strictEqual(list.items.length, 1);
    assert.strictEqual(list.items[0].versionId, product.versionId);
    assert.strictEqual(list.items[0].productId, product.productId);
    assert.strictEqual(list.items[0].qty, 1);
    assert.strictEqual(list.items[0].unavailable, false);
    assert.strictEqual(list.items[0].unitTotalCents, product.totalAmountCents);
    assert.strictEqual(list.items[0].lineTotalCents, product.totalAmountCents);
    assert.strictEqual(list.totalAmountCents, product.totalAmountCents);

    let threw = false;
    try {
      svc.cart.addItem(personId, {
        versionId: product.versionId,
        doctorId: product.doctorId + 99999,
        qty: 1,
      });
    } catch (e) {
      threw = e.code === "cart_doctor_mismatch";
    }
    assert.ok(threw, "wrong doctorId on addItem must throw cart_doctor_mismatch");
  });

  let orderId;

  await test("create order uses server-side price + idempotent", async () => {
    const body = {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路 1 号",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-test-1",
      sourceChannel: "group",
    };
    const o1 = svc.orders.createOrder(personId, body);
    const o2 = svc.orders.createOrder(personId, { ...body, totalAmount: 1 });
    assert.strictEqual(o1.id, o2.id);
    assert.strictEqual(o1.totalAmountCents, product.totalAmountCents);
    assert.strictEqual(o1.status, "pending_payment");
    orderId = o1.id;
  });

  await test("mock pay advances to paid_pending_profile", async () => {
    const { payment, order } = await svc.payments.createPayment(personId, orderId);
    assert.strictEqual(payment.provider, "mock");
    assert.strictEqual(payment.status, "paid");
    assert.strictEqual(order.status, "paid_pending_profile");
  });

  await test("listForPerson filters by status", async () => {
    const listed = svc.orders.listForPerson(personId, { status: "paid_pending_profile" });
    assert.ok(Array.isArray(listed));
    assert.ok(listed.length >= 1);
    assert.ok(listed.every((o) => o.status === "paid_pending_profile"));
    const page = svc.orders.listForPerson(personId, { limit: 10, offset: 0 });
    assert.ok(page.length <= 10);
    const all = svc.orders.listForPerson(personId);
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 1);
  });

  await test("submit profile -> pending_review", () => {
    const order = svc.orders.submitProfile(personId, orderId, {
      surgeryDate: "2026-07-01",
      surgeryType: "膝关节置换",
      laterality: "左",
      recoveryStage: "术后 2 周",
      voucherUrls: [],
    });
    assert.strictEqual(order.status, "pending_review");
  });

  await test("approve creates instance + health plan tasks", () => {
    const instance = svc.activation.approve(orderId, {
      adminId: 1,
      serviceStartDate: "2026-08-06",
      note: "测试开通",
    });
    assert.strictEqual(instance.status, "active");
    assert.ok(instance.planId);
    const order = svc.orders.getById(orderId);
    assert.strictEqual(order.status, "active");
    assert.strictEqual(order.instanceId, instance.id);
    assert.ok(order.lines && order.lines.length >= 1);
    assert.strictEqual(order.lines[0].instanceId, instance.id);
    assert.strictEqual(svc.activation.listByOrderId(orderId).length, 1);
    const plan = db.prepare(`SELECT * FROM health_plans WHERE id=?`).get(instance.planId);
    assert.ok(plan);
    assert.strictEqual(plan.status, "active");
    const tasks = db
      .prepare(`SELECT * FROM health_task_instances WHERE plan_id=? AND person_id=?`)
      .all(instance.planId, personId);
    assert.ok(tasks.length >= 1, "should have today tasks");
  });

  await test("reassign product doctor", () => {
    const other = db
      .prepare(
        `INSERT INTO doctors(slug, name, title, hospital, dept, active)
         VALUES ('svc-reassign-target', '替换医生', '主任医师', '测试医院', '骨科', 1)`
      )
      .run();
    const otherId = Number(other.lastInsertRowid);
    const before = svc.adminProducts.detail(product.productId);
    assert.strictEqual(before.product.doctorId, doctor.id);
    const after = svc.adminProducts.reassignDoctor(product.productId, otherId);
    assert.strictEqual(after.product.doctorId, otherId);
    assert.strictEqual(svc.catalog.listPublished({ doctorId: doctor.id }).length, 0);
    assert.ok(svc.catalog.listPublished({ doctorId: otherId }).length >= 1);
    // 还原，避免影响后续用例的 doctor 上下文
    svc.adminProducts.reassignDoctor(product.productId, doctor.id);
  });

  await test("reject path refunds another order", async () => {
    const o = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路 2 号",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-reject-1",
    });
    await svc.payments.createPayment(personId, o.id);
    svc.orders.submitProfile(personId, o.id, {
      surgeryDate: "2026-07-02",
      surgeryType: "髋关节",
      laterality: "右",
      recoveryStage: "术后 1 周",
    });
    await svc.adminOrders.reject(o.id, { adminId: 1, note: "不适合" });
    const after = svc.orders.getById(o.id);
    assert.strictEqual(after.status, "refunded");
    const refund = db.prepare(`SELECT * FROM svc_refunds WHERE order_id=?`).get(o.id);
    assert.ok(refund);
    assert.strictEqual(refund.status, "refunded");
  });

  await test("coupon claim + quote fixed + per_user_limit", () => {
    assert.ok(svc.coupons, "svc.coupons should be wired");
    const now = new Date().toISOString();
    const insert = db
      .prepare(
        `INSERT INTO svc_coupon_templates(
          doctor_id, title, type, threshold_cents, discount_cents, percent_off,
          max_discount_cents, category, status, total_quota, claimed_count,
          per_user_limit, starts_at, ends_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        doctor.id,
        "满100减20",
        "fixed",
        10000,
        2000,
        0,
        0,
        null,
        "active",
        0,
        0,
        1,
        null,
        null,
        now,
        now
      );
    const templateId = Number(insert.lastInsertRowid);

    const claimable = svc.coupons.listClaimableTemplates(personId, doctor.id);
    assert.ok(claimable.some((t) => t.id === templateId));

    const coupon = svc.coupons.claim(personId, templateId);
    assert.strictEqual(coupon.status, "available");
    assert.strictEqual(coupon.templateId, templateId);
    assert.strictEqual(coupon.doctorId, doctor.id);
    const tplAfter = db.prepare(`SELECT claimed_count FROM svc_coupon_templates WHERE id=?`).get(templateId);
    assert.strictEqual(tplAfter.claimed_count, 1);

    const mine = svc.coupons.listMine(personId, { status: "available" });
    assert.ok(mine.some((c) => c.id === coupon.id));

    const below = svc.coupons.quote({
      personId,
      doctorId: doctor.id,
      subtotalCents: 5000,
      couponId: coupon.id,
    });
    assert.strictEqual(below.usable, false);
    assert.strictEqual(below.discountCents, 0);

    const q = svc.coupons.quote({
      personId,
      doctorId: doctor.id,
      subtotalCents: 29800,
      couponId: coupon.id,
    });
    assert.strictEqual(q.usable, true);
    assert.strictEqual(q.discountCents, 2000);
    assert.strictEqual(q.payableCents, 27800);

    const usable = svc.coupons.assertUsable(personId, coupon.id, doctor.id, 29800);
    assert.strictEqual(usable.discountCents, 2000);

    let limited = false;
    try {
      svc.coupons.claim(personId, templateId);
    } catch (e) {
      limited = e.code === "coupon_per_user_limit";
    }
    assert.ok(limited, "second claim beyond per_user_limit must fail");
  });

  await test("createOrder with couponId locks coupon and sets payable", () => {
    const now = new Date().toISOString();
    const insert = db
      .prepare(
        `INSERT INTO svc_coupon_templates(
          doctor_id, title, type, threshold_cents, discount_cents, percent_off,
          max_discount_cents, category, status, total_quota, claimed_count,
          per_user_limit, starts_at, ends_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        doctor.id,
        "下单满减20",
        "fixed",
        10000,
        2000,
        0,
        0,
        null,
        "active",
        0,
        0,
        1,
        null,
        null,
        now,
        now
      );
    const templateId = Number(insert.lastInsertRowid);
    const coupon = svc.coupons.claim(personId, templateId);
    assert.strictEqual(coupon.status, "available");

    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      couponId: coupon.id,
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址券",
      contactPhone: "13800138000",
      idempotencyKey: `coupon-order-${Date.now()}`,
    });

    assert.strictEqual(order.totalAmountCents, product.totalAmountCents);
    assert.strictEqual(order.discountAmountCents, 2000);
    assert.strictEqual(order.payableAmountCents, product.totalAmountCents - 2000);
    assert.ok(order.payableAmountCents < order.totalAmountCents);
    assert.strictEqual(order.couponId, coupon.id);

    const rawCoupon = db.prepare(`SELECT * FROM svc_coupons WHERE id=?`).get(coupon.id);
    assert.strictEqual(rawCoupon.status, "locked");
    assert.strictEqual(Number(rawCoupon.order_id), order.id);
    assert.strictEqual(Number(rawCoupon.discount_snapshot_cents), 2000);

    const noCoupon = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址无券",
      contactPhone: "13800138000",
      idempotencyKey: `no-coupon-order-${Date.now()}`,
    });
    assert.strictEqual(noCoupon.discountAmountCents, 0);
    assert.strictEqual(noCoupon.payableAmountCents, noCoupon.totalAmountCents);
    assert.strictEqual(noCoupon.couponId, null);
  });

  await test("createOrder with coupon → mock pay → coupon used", async () => {
    const now = new Date().toISOString();
    const insert = db
      .prepare(
        `INSERT INTO svc_coupon_templates(
          doctor_id, title, type, threshold_cents, discount_cents, percent_off,
          max_discount_cents, category, status, total_quota, claimed_count,
          per_user_limit, starts_at, ends_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        doctor.id,
        "支付核销满减20",
        "fixed",
        10000,
        2000,
        0,
        0,
        null,
        "active",
        0,
        0,
        1,
        null,
        null,
        now,
        now
      );
    const templateId = Number(insert.lastInsertRowid);
    const coupon = svc.coupons.claim(personId, templateId);
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      couponId: coupon.id,
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址核销",
      contactPhone: "13800138000",
      idempotencyKey: `coupon-pay-${Date.now()}`,
    });
    assert.strictEqual(
      db.prepare(`SELECT status FROM svc_coupons WHERE id=?`).get(coupon.id).status,
      "locked"
    );

    const { payment, order: paidOrder } = await svc.payments.createPayment(personId, order.id);
    assert.strictEqual(payment.status, "paid");
    assert.strictEqual(payment.amountCents, order.payableAmountCents);
    assert.strictEqual(paidOrder.status, "paid_pending_profile");

    const rawCoupon = db.prepare(`SELECT * FROM svc_coupons WHERE id=?`).get(coupon.id);
    assert.strictEqual(rawCoupon.status, "used");
    assert.strictEqual(Number(rawCoupon.order_id), order.id);
    assert.ok(rawCoupon.used_at);
  });

  await test("createOrder with coupon → closeExpiredPending → coupon available", () => {
    const now = new Date().toISOString();
    const insert = db
      .prepare(
        `INSERT INTO svc_coupon_templates(
          doctor_id, title, type, threshold_cents, discount_cents, percent_off,
          max_discount_cents, category, status, total_quota, claimed_count,
          per_user_limit, starts_at, ends_at, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        doctor.id,
        "超时解锁满减20",
        "fixed",
        10000,
        2000,
        0,
        0,
        null,
        "active",
        0,
        0,
        1,
        null,
        null,
        now,
        now
      );
    const templateId = Number(insert.lastInsertRowid);
    const coupon = svc.coupons.claim(personId, templateId);
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      couponId: coupon.id,
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址超时",
      contactPhone: "13800138000",
      idempotencyKey: `coupon-timeout-${Date.now()}`,
    });
    assert.strictEqual(
      db.prepare(`SELECT status FROM svc_coupons WHERE id=?`).get(coupon.id).status,
      "locked"
    );

    const oldTs = new Date(Date.now() - svc.orders.ORDER_TIMEOUT_MS - 60_000).toISOString();
    db.prepare(`UPDATE svc_orders SET created_at=? WHERE id=?`).run(oldTs, order.id);
    svc.orders.closeExpiredPending(personId);

    const closed = svc.orders.getById(order.id);
    assert.strictEqual(closed.status, "closed_timeout");
    const rawCoupon = db.prepare(`SELECT * FROM svc_coupons WHERE id=?`).get(coupon.id);
    assert.strictEqual(rawCoupon.status, "available");
    assert.strictEqual(rawCoupon.order_id, null);
  });

  await test("createOrder with items creates lines", () => {
    const svc = createServicePackage(db);
    const p = svc.catalog.listPublished({ doctorId: doctor.id })[0];
    const order = svc.orders.createOrder(personId, {
      items: [{ versionId: p.versionId, qty: 2 }],
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址",
      contactPhone: "13800138000",
      idempotencyKey: `multi-${Date.now()}`,
    });
    assert.ok(order.lines && order.lines.length === 1);
    assert.strictEqual(order.lines[0].qty, 2);
    assert.strictEqual(order.totalAmountCents, order.lines[0].totalAmountCents);
  });

  await test("approve multi-line creates one instance per line", async () => {
    const second = svc.adminProducts.create(doctor.id, {
      title: "S2 第二服务包",
      slug: `s2-second-${Date.now()}`,
      serviceAmount: 99,
      goodsAmount: 0,
      shippingAmount: 0,
      serviceDays: 14,
      cost: 99,
      publish: true,
      contents: [{ dayOffset: 0, kind: "content", title: "第二包首日指导", required: true }],
    });
    assert.ok(second && second.current && second.current.versionId);
    const versionId2 = second.current.versionId;

    const order = svc.orders.createOrder(personId, {
      items: [
        { versionId: product.versionId, qty: 1 },
        { versionId: versionId2, qty: 1 },
      ],
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址两行",
      contactPhone: "13800138000",
      idempotencyKey: `multi-lines-${Date.now()}`,
    });
    assert.strictEqual(order.lines.length, 2);

    await svc.payments.createPayment(personId, order.id);
    svc.orders.submitProfile(personId, order.id, {
      surgeryDate: "2026-07-10",
      surgeryType: "膝关节",
      laterality: "左",
      recoveryStage: "术后 1 周",
    });

    const firstInstance = svc.activation.approve(order.id, {
      adminId: 1,
      serviceStartDate: "2026-08-06",
      note: "两行开通",
    });
    assert.ok(firstInstance);
    assert.strictEqual(firstInstance.status, "active");

    const instances = svc.activation.listByOrderId(order.id);
    assert.strictEqual(instances.length, 2);
    assert.strictEqual(instances[0].id, firstInstance.id);
    assert.ok(instances[0].planId, "首行应有康复计划");
    assert.ok(!instances[1].planId, "次行不应重复建计划");

    const after = svc.orders.getById(order.id);
    assert.strictEqual(after.status, "active");
    assert.strictEqual(after.instanceId, firstInstance.id);
    assert.strictEqual(after.lines.length, 2);
    assert.strictEqual(after.lines[0].instanceId, instances[0].id);
    assert.strictEqual(after.lines[1].instanceId, instances[1].id);

    const detail = svc.adminOrders.detail(order.id);
    assert.ok(detail.instances && detail.instances.length === 2);
    assert.strictEqual(detail.instance.id, firstInstance.id);
  });

  await test("approve qty:2 single line creates one instance", async () => {
    const order = svc.orders.createOrder(personId, {
      items: [{ versionId: product.versionId, qty: 2 }],
      agreementAccepted: true,
      privacyAccepted: true,
      receiverName: "测",
      receiverPhone: "13800138000",
      receiverAddress: "测试地址 qty2",
      contactPhone: "13800138000",
      idempotencyKey: `qty2-activate-${Date.now()}`,
    });
    assert.strictEqual(order.lines.length, 1);

    await svc.payments.createPayment(personId, order.id);
    svc.orders.submitProfile(personId, order.id, {
      surgeryDate: "2026-07-11",
      surgeryType: "髋关节",
      laterality: "右",
      recoveryStage: "术后 2 周",
    });

    const instance = svc.activation.approve(order.id, {
      adminId: 1,
      serviceStartDate: "2026-08-07",
    });
    const instances = svc.activation.listByOrderId(order.id);
    assert.strictEqual(instances.length, 1);
    assert.strictEqual(instances[0].id, instance.id);
    const after = svc.orders.getById(order.id);
    assert.strictEqual(after.lines[0].instanceId, instance.id);
  });

  await test("wechat createPayment requires openid before create", async () => {
    const prev = process.env.SERVICE_PAY_PROVIDER;
    const wxVars = [
      "WX_MP_APPID",
      "WECHAT_MP_APP_ID",
      "WX_MCH_ID",
      "WX_API_V3_KEY",
      "WX_MCH_SERIAL_NO",
      "WX_MCH_PRIVATE_KEY_PATH",
      "WX_PAY_NOTIFY_URL",
      "WX_PLATFORM_CERT_PATH",
    ];
    const saved = {};
    for (const k of wxVars) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.SERVICE_PAY_PROVIDER = "wechat";
    db.prepare(`UPDATE persons SET mp_openid=NULL WHERE id=?`).run(personId);
    db.prepare(`DELETE FROM mp_sessions WHERE person_id=?`).run(personId);
    try {
      const o = svc.orders.createOrder(personId, {
        versionId: product.versionId,
        serviceFor: "self",
        contactPhone: "13800000001",
        receiverName: "测试",
        receiverPhone: "13800000001",
        receiverAddress: "北京市朝阳区测试路 openid",
        agreementAccepted: true,
        privacyAccepted: true,
        idempotencyKey: "idem-openid-required-1",
      });
      let code = null;
      try {
        await svc.payments.createPayment(personId, o.id);
      } catch (e) {
        code = e.code;
      }
      assert.strictEqual(code, "openid_required");
    } finally {
      process.env.SERVICE_PAY_PROVIDER = prev || "mock";
      for (const k of wxVars) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  await test("wechat provider not configured throws", async () => {
    const prev = process.env.SERVICE_PAY_PROVIDER;
    const wxVars = [
      "WX_MP_APPID",
      "WECHAT_MP_APP_ID",
      "WX_MCH_ID",
      "WX_API_V3_KEY",
      "WX_MCH_SERIAL_NO",
      "WX_MCH_PRIVATE_KEY_PATH",
      "WX_PAY_NOTIFY_URL",
      "WX_PLATFORM_CERT_PATH",
    ];
    const saved = {};
    for (const k of wxVars) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.SERVICE_PAY_PROVIDER = "wechat";
    const providerPath = path.join(__dirname, "modules/servicePackage/providers/index.js");
    delete require.cache[require.resolve(providerPath)];
    delete require.cache[require.resolve(path.join(__dirname, "modules/servicePackage/providers/wechatConfig.js"))];
    try {
      const { getPaymentProvider } = require(providerPath);
      const p = getPaymentProvider();
      let code = null;
      try {
        await p.create({ outTradeNo: "x", amountCents: 1, description: "t" });
      } catch (e) {
        code = e.code;
      }
      assert.strictEqual(code, "pay_not_configured");
    } finally {
      process.env.SERVICE_PAY_PROVIDER = prev || "mock";
      for (const k of wxVars) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      delete require.cache[require.resolve(providerPath)];
      delete require.cache[require.resolve(path.join(__dirname, "modules/servicePackage/providers/wechatConfig.js"))];
    }
  });

  await test("wechat provider offline sign + AES-GCM", async () => {
    const crypto = require("crypto");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
    const wechatPath = path.join(__dirname, "modules/servicePackage/providers/wechat.js");
    delete require.cache[require.resolve(wechatPath)];
    const {
      createWechatProvider,
      buildJsapiPaySign,
      decryptAesGcm,
    } = require(wechatPath);

    const fakeConfig = {
      appId: "wx_test_appid",
      mchId: "1900000000",
      apiV3Key: "0123456789abcdef0123456789abcdef",
      mchSerialNo: "SERIALTEST001",
      privateKeyPem,
      notifyUrl: "https://example.com/api/mp/payments/wechat/notify",
    };
    const provider = createWechatProvider(fakeConfig);
    assert.strictEqual(provider.name, "wechat");

    const timeStamp = "1710000000";
    const nonceStr = "nonceTestAbc123";
    const pkg = "prepay_id=wx20141027200939501234567890";
    const paySign = buildJsapiPaySign(privateKeyPem, {
      appId: fakeConfig.appId,
      timeStamp,
      nonceStr,
      package: pkg,
    });
    assert.ok(typeof paySign === "string" && paySign.length > 20);
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(`${fakeConfig.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`);
    assert.ok(verify.verify(publicKey, paySign, "base64"));

    const nonce = "a1b2c3d4e5f6";
    const aad = "transaction";
    const plainObj = { out_trade_no: "P1", trade_state: "SUCCESS", transaction_id: "4200" };
    const plain = Buffer.from(JSON.stringify(plainObj), "utf8");
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(fakeConfig.apiV3Key, "utf8"),
      Buffer.from(nonce, "utf8")
    );
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([enc, tag]).toString("base64");
    const decrypted = decryptAesGcm(fakeConfig.apiV3Key, {
      ciphertext,
      nonce,
      associated_data: aad,
    });
    assert.deepStrictEqual(JSON.parse(decrypted), plainObj);

    let notifyCode = null;
    try {
      await provider.handleNotify({}, "{}");
    } catch (e) {
      notifyCode = e.code;
    }
    assert.strictEqual(notifyCode, "platform_cert_required");
  });

  await test("adminCoupons create + publish + grant", () => {
    assert.ok(svc.adminCoupons, "svc.adminCoupons should be wired");
    const tpl = svc.adminCoupons.create({
      doctorId: doctor.id,
      title: "管理端满50减5",
      type: "fixed",
      threshold: 50,
      discount: 5,
      quota: 10,
      perUserLimit: 2,
    });
    assert.ok(tpl.id);
    assert.strictEqual(tpl.status, "draft");
    assert.strictEqual(tpl.thresholdCents, 5000);
    assert.strictEqual(tpl.discountCents, 500);

    const published = svc.adminCoupons.publish(tpl.id);
    assert.strictEqual(published.status, "active");

    const list = svc.adminCoupons.listTemplates({ doctorId: doctor.id, status: "active" });
    assert.ok(list.some((t) => t.id === tpl.id));

    const coupon = svc.adminCoupons.grant({ templateId: tpl.id, personId });
    assert.strictEqual(coupon.status, "available");
    assert.strictEqual(coupon.templateId, tpl.id);
    assert.strictEqual(coupon.personId, personId);

    const after = svc.adminCoupons.getTemplate(tpl.id);
    assert.strictEqual(after.claimedCount, 1);

    const coupons = svc.adminCoupons.listCoupons({ doctorId: doctor.id, personId });
    assert.ok(coupons.some((c) => c.id === coupon.id));
  });

  await test("coupon redemption codes single + passphrase", () => {
    const tpl = svc.adminCoupons.create({
      doctorId: doctor.id,
      title: "兑换码满80减10",
      type: "fixed",
      threshold: 80,
      discount: 10,
      quota: 0,
      perUserLimit: 3,
      publish: true,
    });
    assert.strictEqual(tpl.status, "active");

    const singles = svc.adminCoupons.generateCodes(tpl.id, { kind: "single", count: 2 });
    assert.strictEqual(singles.codes.length, 2);
    const codeA = singles.codes[0].code;
    const redeemed = svc.coupons.redeemByCode(personId, codeA.toLowerCase());
    assert.strictEqual(redeemed.status, "available");
    assert.strictEqual(redeemed.templateId, tpl.id);

    let againErr = null;
    try {
      svc.coupons.redeemByCode(personId, codeA);
    } catch (e) {
      againErr = e.code;
    }
    assert.strictEqual(againErr, "code_already_used");

    const listed = svc.adminCoupons.listCodes(tpl.id);
    const usedRow = listed.find((c) => c.code === codeA);
    assert.ok(usedRow);
    assert.strictEqual(usedRow.usedCount, 1);

    const phrase = svc.adminCoupons.generateCodes(tpl.id, {
      kind: "passphrase",
      code: "CHUNYU-TEST",
      maxUses: 2,
    });
    assert.strictEqual(phrase.codes[0].code, "CHUNYU-TEST");
    const p1 = svc.coupons.redeemByCode(personId, "chunyu-test");
    assert.ok(p1.id);

    // 第二人（同 person 受日志限制不能再兑同一口令）
    let phraseAgain = null;
    try {
      svc.coupons.redeemByCode(personId, "CHUNYU-TEST");
    } catch (e) {
      phraseAgain = e.code;
    }
    assert.strictEqual(phraseAgain, "code_already_used");
  });

  await test("afterSales pending_payment createTicket closes order", () => {
    assert.ok(svc.afterSales, "svc.afterSales should be wired");
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路售后取消",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-aftersales-cancel-1",
    });
    assert.strictEqual(order.status, "pending_payment");
    const ticket = svc.afterSales.createTicket(personId, order.id, {
      reason: "不想买了",
    });
    assert.strictEqual(ticket.type, "cancel_unpaid");
    assert.strictEqual(ticket.status, "closed");
    const closed = svc.orders.getById(order.id);
    assert.strictEqual(closed.status, "closed_timeout");
  });

  await test("afterSales paid createTicket open; approve refunds", async () => {
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路售后退款",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-aftersales-refund-paid-1",
    });
    await svc.payments.createPayment(personId, order.id);
    const paid = svc.orders.getById(order.id);
    assert.strictEqual(paid.status, "paid_pending_profile");

    const ticket = svc.afterSales.createTicket(personId, order.id, {
      reason: "资料填错了要退款",
    });
    assert.strictEqual(ticket.type, "refund_paid");
    assert.strictEqual(ticket.status, "open");
    assert.strictEqual(ticket.refundAmountCents, paid.payableAmountCents);

    const approved = await svc.afterSales.approve(ticket.id, {
      adminNote: "同意退款",
      adminId: 1,
    });
    assert.strictEqual(approved.status, "approved");
    const refunded = svc.orders.getById(order.id);
    assert.strictEqual(refunded.status, "refunded");
  });

  await test("afterSales active createTicket open; approve does not refund", async () => {
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路售后开通",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-aftersales-refund-active-1",
    });
    await svc.payments.createPayment(personId, order.id);
    svc.orders.submitProfile(personId, order.id, {
      surgeryDate: "2026-07-20",
      surgeryType: "髋关节",
      laterality: "左",
      recoveryStage: "术后 1 周",
    });
    svc.activation.approve(order.id, {
      adminId: 1,
      serviceStartDate: "2026-08-07",
    });
    const active = svc.orders.getById(order.id);
    assert.strictEqual(active.status, "active");

    const ticket = svc.afterSales.createTicket(personId, order.id, {
      reason: "开通后想退，需人工",
    });
    assert.strictEqual(ticket.type, "refund_active");
    assert.strictEqual(ticket.status, "open");

    const approved = await svc.afterSales.approve(ticket.id, {
      adminNote: "已记录，人工处理",
      adminId: 1,
    });
    assert.strictEqual(approved.status, "approved");
    const still = svc.orders.getById(order.id);
    assert.strictEqual(still.status, "active");
    assert.notStrictEqual(still.status, "refunded");

    const assets = svc.afterSales.buildAssets(personId);
    assert.ok(Array.isArray(assets.instances));
    assert.ok(Array.isArray(assets.openTickets));
    assert.ok(typeof assets.couponAvailableCount === "number");
  });

  await test("afterSales updateReason and cancelForPerson", async () => {
    const order = svc.orders.createOrder(personId, {
      versionId: product.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路售后撤销",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "idem-aftersales-cancel-user-1",
    });
    await svc.payments.createPayment(personId, order.id);
    const ticket = svc.afterSales.createTicket(personId, order.id, {
      reason: "先写错原因",
    });
    assert.strictEqual(ticket.status, "open");
    assert.ok(ticket.productTitle);

    const updated = svc.afterSales.updateReasonForPerson(ticket.id, personId, "改成正确原因");
    assert.strictEqual(updated.reason, "改成正确原因");
    assert.strictEqual(updated.status, "open");

    const cancelled = svc.afterSales.cancelForPerson(ticket.id, personId);
    assert.strictEqual(cancelled.status, "closed");
    assert.strictEqual(cancelled.adminNote, "用户撤销");

    // 撤销后可再次申请
    const again = svc.afterSales.createTicket(personId, order.id, {
      reason: "再次申请退款",
    });
    assert.strictEqual(again.status, "open");
  });

  await test("service components create update list and disable", () => {
    const api = svc.components;
    const created = api.create({
      code: "SVC-REPORT-INTERPRETATION",
      name: "报告解析",
      type: "REPORT_INTERPRETATION",
      providerType: "internal",
      providerRef: "health-assistant",
      providerName: "健康助理团队",
      description: "上传报告后解析",
      defaultUnit: "次",
      defaultSlaHours: 24,
      defaultActionKey: "report_upload",
      defaultActionLabel: "上传报告",
    });
    assert.strictEqual(created.status, "active");
    assert.strictEqual(api.list({ status: "active" }).length, 1);
    const updated = api.update(created.id, { ...created, name: "检查报告解析" });
    assert.strictEqual(updated.name, "检查报告解析");
    assert.strictEqual(api.disable(created.id).status, "disabled");
  });

  await test("component with per-type config persists", () => {
    const api = svc.components;
    const config = { consultForm: "video", durationMin: 20, doctorAssigned: true };
    const created = api.create({
      code: "SVC-MED-CONFIG",
      name: "医疗问诊(视频)",
      type: "MEDICAL_CONSULTATION",
      providerType: "internal",
      providerName: "测试团队",
      defaultUnit: "次",
      defaultSlaHours: 24,
      config,
    });
    assert.deepStrictEqual(created.config, config);
    const fetched = api.getById(created.id);
    assert.deepStrictEqual(fetched.config, config);
  });

  await test("component config invalid is rejected", () => {
    const api = svc.components;
    const base = {
      name: "非法配置组件",
      type: "MEDICAL_CONSULTATION",
      providerType: "internal",
      providerName: "测试团队",
      defaultUnit: "次",
    };
    const bads = ["not-an-object", [1, 2]];
    for (let i = 0; i < bads.length; i++) {
      let code = null;
      try {
        api.create({ ...base, code: `SVC-CFG-BAD-${i + 1}`, config: bads[i] });
      } catch (e) {
        code = e.code;
      }
      assert.strictEqual(code, "validation", `config ${JSON.stringify(bads[i])} 应被拒绝`);
    }
  });

  await test("component config update", () => {
    const api = svc.components;
    const created = api.create({
      code: "SVC-CFG-UPDATE",
      name: "实物商品",
      type: "PHYSICAL_GOODS",
      providerType: "internal",
      providerName: "测试团队",
      defaultUnit: "件",
      config: { spec: "标准装" },
    });
    assert.deepStrictEqual(created.config, { spec: "标准装" });
    const next = { spec: "豪华装", supplier: "测试供应商", shipWithinDays: 3 };
    const updated = api.update(created.id, { ...created, config: next });
    assert.deepStrictEqual(updated.config, next);
  });

  await test("product version snapshots benefit items", () => {
    const component = svc.components.create({
      code: "SVC-REPORT-INTERPRETATION-SKU",
      name: "报告解析",
      type: "REPORT_INTERPRETATION",
      providerType: "internal",
      providerName: "健康助理团队",
      defaultUnit: "次",
      defaultSlaHours: 24,
      defaultActionKey: "report_upload",
      defaultActionLabel: "上传报告",
    });
    const created = svc.adminProducts.create(doctor.id, {
      slug: "report-benefit-test",
      title: "报告解析权益 SKU",
      category: "other",
      serviceDays: 30,
      serviceAmount: 99,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 99,
      eligible: ["已完成实名认证的用户"],
      ineligible: [],
      refundPolicy: "未使用可申请退款",
      cost: 99,
      publish: true,
      benefitItems: [{
        componentId: component.id,
        name: "报告解析",
        benefitType: "TOTAL_LIMIT",
        totalQuota: 1,
        unit: "次",
        slaHours: 24,
        maxConcurrent: 1,
        actionKey: "report_upload",
        actionLabel: "上传报告",
        notifyEnabled: true,
        refundShareCents: 9900,
        sortOrder: 10,
      }],
    });
    componentizedProduct = created.current;

    const detail = svc.adminProducts.detail(created.product.id);
    assert.strictEqual(detail.current.benefitItems.length, 1);
    assert.strictEqual(detail.current.benefitItems[0].componentCode, component.code);
    assert.strictEqual(detail.current.benefitItems[0].totalQuota, 1);

    const publicProduct = svc.catalog.getCurrentPublished(String(created.current.versionId));
    assert.strictEqual(publicProduct.benefitItems.length, 1);

    componentizedOrder = svc.orders.createOrder(personId, {
      versionId: created.current.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试患者",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路 3 号",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: "benefit-sku-order-1",
    });
    assert.strictEqual(componentizedOrder.lines[0].snapshot.benefitItems.length, 1);
  });

  await test("publish gate blocks componentized product with zero items", () => {
    // 创建组件化草稿商品（版本1有权益项）
    const component = svc.components.create({
      code: "SVC-PUBLISH-GATE-TEST",
      name: "门禁测试组件",
      type: "REPORT_INTERPRETATION",
      providerType: "internal",
      providerName: "测试团队",
      defaultUnit: "次",
      defaultSlaHours: 24,
    });
    const draft = svc.adminProducts.create(doctor.id, {
      slug: `publish-gate-${Date.now()}`,
      title: "门禁测试",
      category: "other",
      serviceDays: 30,
      serviceAmount: 50,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 50,
      eligible: ["测试用户"],
      ineligible: [],
      refundPolicy: "测试",
      publish: false,
      benefitItems: [{
        componentId: component.id,
        name: "门禁测试项",
        benefitType: "TOTAL_LIMIT",
        totalQuota: 1,
        unit: "次",
        slaHours: 24,
        maxConcurrent: 1,
        refundShareCents: 5000,
        sortOrder: 1,
      }],
    });
    assert.strictEqual(draft.current.benefitItems.length, 1);

    // 更新为空权益项（版本2无权益项，但版本1权益项仍在表中）
    svc.adminProducts.update(draft.product.id, {
      title: "门禁测试",
      serviceAmount: 50,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 50,
      eligible: ["测试用户"],
      ineligible: [],
      refundPolicy: "测试",
      publish: false,
      benefitItems: [],
    });

    // 发布应拒绝：产品曾有权益项，当前版本为空
    let code = null;
    try {
      svc.adminProducts.publish(draft.product.id);
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "validation");
  });

  await test("activation creates entitlements once", async () => {
    assert.ok(svc.entitlements, "svc.entitlements should be wired");
    await svc.payments.createPayment(personId, componentizedOrder.id);
    svc.orders.submitProfile(personId, componentizedOrder.id, {
      surgeryDate: "2026-08-01",
      surgeryType: "报告解析测试",
      laterality: "无",
      recoveryStage: "恢复期",
    });
    componentizedInstance = svc.activation.approve(componentizedOrder.id, {
      adminId: 1,
      serviceStartDate: "2026-08-15",
    });
    const entitlements = svc.entitlements.listForInstance(componentizedInstance.id, personId);
    assert.strictEqual(entitlements.length, 1);
    assert.strictEqual(entitlements[0].status, "ACTIVE");
    assert.strictEqual(entitlements[0].totalQuota, 1);
    assert.strictEqual(entitlements[0].remainingQuota, 1);
    assert.strictEqual(entitlements[0].validFrom, "2026-08-15");
    assert.strictEqual(entitlements[0].validTo, "2026-09-13");

    const line = svc.orders.getById(componentizedOrder.id).lines[0];
    svc.entitlements.ensureForInstance({
      instance: componentizedInstance,
      orderLine: line,
      benefitItems: line.snapshot.benefitItems,
    });
    assert.strictEqual(
      svc.entitlements.listForInstance(componentizedInstance.id, personId).length,
      1
    );
  });

  await test("entitlement usage reserves completes and is idempotent", () => {
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    const u1 = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-report-1",
      bizType: "report",
    });
    const u2 = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-report-1",
      bizType: "report",
    });
    assert.strictEqual(u1.id, u2.id);
    assert.strictEqual(u1.status, "REQUESTED");
    assert.strictEqual(svc.entitlements.getForPerson(entitlement.id, personId).reservedQuota, 1);

    const completed = svc.entitlements.completeUsage(u1.id, { type: "admin", id: 1 });
    assert.strictEqual(completed.status, "COMPLETED");
    const after = svc.entitlements.getForPerson(entitlement.id, personId);
    assert.strictEqual(after.usedQuota, 1);
    assert.strictEqual(after.reservedQuota, 0);
    assert.strictEqual(after.remainingQuota, 0);
    assert.strictEqual(after.status, "EXHAUSTED");
  });

  await test("insufficient quota after exhaustion", () => {
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    let code = null;
    try {
      svc.entitlements.requestUsage(personId, entitlement.id, {
        qty: 1,
        idempotencyKey: "usage-exhausted-1",
        bizType: "report",
      });
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "quota_insufficient");
  });

  await test("concurrent limit enforcement", () => {
    // maxConcurrent=1 from the product definition
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    // entitlement is already EXHAUSTED, so use direct DB manipulation to reset for concurrent test
    db.prepare(`UPDATE svc_entitlements SET used_quota=0, reserved_quota=0, remaining_quota=1, status='ACTIVE' WHERE id=?`)
      .run(entitlement.id);
    const u1 = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-concurrent-1",
      bizType: "report",
    });
    assert.strictEqual(u1.status, "REQUESTED");

    let code = null;
    try {
      svc.entitlements.requestUsage(personId, entitlement.id, {
        qty: 1,
        idempotencyKey: "usage-concurrent-2",
        bizType: "report",
      });
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "concurrent_limit");

    // cleanup: cancel the first request
    svc.entitlements.cancelUsage(personId, u1.id);
  });

  await test("cancel releases reserved quota", () => {
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    // entitlement should have 0 reserved after previous test canceled
    const u = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-cancel-1",
      bizType: "report",
    });
    assert.strictEqual(u.status, "REQUESTED");
    assert.strictEqual(svc.entitlements.getForPerson(entitlement.id, personId).reservedQuota, 1);

    const cancelled = svc.entitlements.cancelUsage(personId, u.id);
    assert.strictEqual(cancelled.status, "CANCELLED");
    const after = svc.entitlements.getForPerson(entitlement.id, personId);
    assert.strictEqual(after.reservedQuota, 0);

    // cancel by wrong user should fail
    let code = null;
    try {
      svc.entitlements.cancelUsage(personId + 9999, u.id);
    } catch (e) {
      code = e.code;
    }
    assert.ok(code === "not_found" || code === "usage_invalid_status", `expected not_found or usage_invalid_status, got ${code}`);

    // cancel already cancelled usage should fail
    code = null;
    try {
      svc.entitlements.cancelUsage(personId, u.id);
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "usage_invalid_status");
  });

  await test("idempotency conflict with different payload", () => {
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    const u1 = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-idem-ctx-1",
      bizType: "report",
    });
    assert.strictEqual(u1.status, "REQUESTED");

    let code = null;
    try {
      svc.entitlements.requestUsage(personId, entitlement.id, {
        qty: 2, // different qty
        idempotencyKey: "usage-idem-ctx-1",
        bizType: "report",
      });
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "idempotency_conflict");

    // cleanup
    svc.entitlements.cancelUsage(personId, u1.id);
  });

  await test("repeat complete does not double-decrement", () => {
    const entitlement = svc.entitlements.listForInstance(componentizedInstance.id, personId)[0];
    // reset state
    db.prepare(`UPDATE svc_entitlements SET used_quota=0, reserved_quota=0, remaining_quota=1, status='ACTIVE' WHERE id=?`)
      .run(entitlement.id);

    const u = svc.entitlements.requestUsage(personId, entitlement.id, {
      qty: 1,
      idempotencyKey: "usage-idem-complete-2x",
      bizType: "report",
    });
    assert.strictEqual(u.status, "REQUESTED");

    const c1 = svc.entitlements.completeUsage(u.id, { type: "admin", id: 1 });
    assert.strictEqual(c1.status, "COMPLETED");

    const c2 = svc.entitlements.completeUsage(u.id, { type: "admin", id: 1 });
    assert.strictEqual(c2.id, c1.id);
    assert.strictEqual(c2.status, "COMPLETED");

    const after = svc.entitlements.getForPerson(entitlement.id, personId);
    assert.strictEqual(after.usedQuota, 1, "usedQuota should be 1, not double-decremented");
  });

  // ──── PERIOD_LIMIT 窗口测试 ────

  // ──── 成本/划线价 字段 + 上架门禁 ────

  await test("product with cost and listPrice persists and publishes", () => {
    const created = svc.adminProducts.create(doctor.id, {
      slug: `cost-test-${Date.now()}`,
      title: "成本测试商品",
      category: "other",
      serviceDays: 30,
      serviceAmount: 99,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 99,
      cost: 80,
      listPrice: 150,
      eligible: ["测试用户"],
      ineligible: [],
      refundPolicy: "测试",
      publish: true,
    });
    assert.strictEqual(created.product.costCents, 8000);
    assert.strictEqual(created.product.listPriceCents, 15000);
    assert.ok(created.current);
    assert.strictEqual(created.current.costCents, 8000);
    assert.strictEqual(created.current.listPriceCents, 15000);

    // detail also returns cost
    const detail = svc.adminProducts.detail(created.product.id);
    assert.strictEqual(detail.product.costCents, 8000);
    assert.strictEqual(detail.product.listPriceCents, 15000);
  });

  await test("publish without cost is rejected (create path)", () => {
    let code = null;
    let msg = "";
    try {
      svc.adminProducts.create(doctor.id, {
        slug: `no-cost-create-${Date.now()}`,
        title: "无成本创建",
        category: "other",
        serviceDays: 30,
        serviceAmount: 50,
        goodsAmount: 0,
        shippingAmount: 0,
        totalAmount: 50,
        cost: 0,
        eligible: ["测试"],
        ineligible: [],
        refundPolicy: "测试",
        publish: true,
      });
    } catch (e) {
      code = e.code;
      msg = e.message;
    }
    assert.strictEqual(code, "validation");
    assert.ok(msg.includes("成本"), `message should contain 成本, got: ${msg}`);
  });

  await test("publish without cost is rejected (publish path)", () => {
    const draft = svc.adminProducts.create(doctor.id, {
      slug: `no-cost-pub-${Date.now()}`,
      title: "无成本草稿",
      category: "other",
      serviceDays: 30,
      serviceAmount: 50,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 50,
      cost: 0,
      eligible: ["测试"],
      ineligible: [],
      refundPolicy: "测试",
      publish: false,
    });
    let code = null;
    let msg = "";
    try {
      svc.adminProducts.publish(draft.product.id);
    } catch (e) {
      code = e.code;
      msg = e.message;
    }
    assert.strictEqual(code, "validation", `expected validation, got ${code}: ${msg}`);
    assert.ok(msg.includes("成本"), `message should contain 成本, got: ${msg}`);
  });

  await test("listPrice below totalAmount rejected", () => {
    let code = null;
    try {
      svc.adminProducts.create(doctor.id, {
        slug: `bad-listprice-${Date.now()}`,
        title: "划线价过低",
        category: "other",
        serviceDays: 30,
        serviceAmount: 99,
        goodsAmount: 0,
        shippingAmount: 0,
        totalAmount: 99,
        cost: 70,
        listPrice: 50,
        eligible: ["测试"],
        ineligible: [],
        refundPolicy: "测试",
        publish: false,
      });
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "validation");
  });

  await test("patient catalog does not expose cost", () => {
    const created = svc.adminProducts.create(doctor.id, {
      slug: `catalog-cost-${Date.now()}`,
      title: "患者目录成本测试",
      category: "other",
      serviceDays: 30,
      serviceAmount: 99,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 99,
      cost: 80,
      listPrice: 150,
      eligible: ["测试"],
      ineligible: [],
      refundPolicy: "测试",
      publish: true,
    });
    const pub = svc.catalog.getCurrentPublished(String(created.current.versionId));
    assert.ok(pub);
    assert.strictEqual(pub.hasOwnProperty("costCents"), false, "patient DTO must not leak costCents");
    assert.strictEqual(pub.hasOwnProperty("listPriceCents"), false, "patient DTO must not leak listPriceCents");
  });

  await test("PERIOD_LIMIT weekly window quota enforcement", async () => {
    // 1) 创建新组件化商品(period_limit + WEEK)
    const periodComponent = svc.components.create({
      code: "SVC-PERIOD-WEEK-TEST",
      name: "周限量服务",
      type: "REPORT_INTERPRETATION",
      providerType: "internal",
      providerName: "健康助理团队",
      defaultUnit: "次",
      defaultSlaHours: 24,
      defaultActionKey: "period_test",
      defaultActionLabel: "周限量测试",
    });
    const periodCreated = svc.adminProducts.create(doctor.id, {
      slug: `period-week-${Date.now()}`,
      title: "周限量测试商品",
      category: "other",
      serviceDays: 60,
      serviceAmount: 198,
      goodsAmount: 0,
      shippingAmount: 0,
      totalAmount: 198,
      eligible: ["测试用户"],
      ineligible: [],
      refundPolicy: "测试",
      cost: 198,
      publish: true,
      benefitItems: [{
        componentId: periodComponent.id,
        name: "周限量权益",
        benefitType: "PERIOD_LIMIT",
        periodUnit: "WEEK",
        periodQuota: 1,
        totalQuota: null,
        unit: "次",
        slaHours: 24,
        maxConcurrent: 3,
        actionKey: "period_test",
        actionLabel: "周限量测试",
        sortOrder: 1,
      }],
    });

    const periodOrder = svc.orders.createOrder(personId, {
      versionId: periodCreated.current.versionId,
      serviceFor: "self",
      contactPhone: "13800000001",
      receiverName: "测试患者",
      receiverPhone: "13800000001",
      receiverAddress: "北京市朝阳区测试路 5 号",
      agreementAccepted: true,
      privacyAccepted: true,
      idempotencyKey: `period-week-order-${Date.now()}`,
    });

    await svc.payments.createPayment(personId, periodOrder.id);
    svc.orders.submitProfile(personId, periodOrder.id, {
      surgeryDate: "2026-08-01",
      surgeryType: "周限量",
      laterality: "无",
      recoveryStage: "恢复期",
    });

    const periodInstance = svc.activation.approve(periodOrder.id, {
      adminId: 1,
      serviceStartDate: "2026-07-15",
    });

    const periodEntitlements = svc.entitlements.listForInstance(periodInstance.id, personId);
    assert.strictEqual(periodEntitlements.length, 1);
    const pe = periodEntitlements[0];
    assert.strictEqual(pe.status, "ACTIVE");
    assert.ok(pe.rule && pe.rule.benefitType === "PERIOD_LIMIT");

    // 2) 首次 requestUsage 成功
    const pu1 = svc.entitlements.requestUsage(personId, pe.id, {
      qty: 1,
      idempotencyKey: "period-week-usage-1",
      bizType: "report",
    });
    assert.strictEqual(pu1.status, "REQUESTED");
    assert.strictEqual(svc.entitlements.getForPerson(pe.id, personId).reservedQuota, 1);

    // 3) complete 首个使用
    const pc1 = svc.entitlements.completeUsage(pu1.id, { type: "admin", id: 1 });
    assert.strictEqual(pc1.status, "COMPLETED");

    const afterComplete = svc.entitlements.getForPerson(pe.id, personId);
    assert.strictEqual(afterComplete.usedQuota, 1);
    assert.strictEqual(afterComplete.remainingQuota, 0, "period remaining should be 0");

    // 4) 同一窗口内再次请求 → quota_insufficient
    let code = null;
    try {
      svc.entitlements.requestUsage(personId, pe.id, {
        qty: 1,
        idempotencyKey: "period-week-usage-2",
        bizType: "report",
      });
    } catch (e) {
      code = e.code;
    }
    assert.strictEqual(code, "quota_insufficient");

    // 5) 将已完成使用的 requested_at / completed_at 改到上一个窗口 (2026-08-01)
    db.prepare(`UPDATE svc_entitlement_usages SET requested_at=?, completed_at=? WHERE id=?`)
      .run("2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", pu1.id);

    // 6) 再次请求 → 成功（因为上周窗口已关闭，本周窗口重置）
    const pu2 = svc.entitlements.requestUsage(personId, pe.id, {
      qty: 1,
      idempotencyKey: "period-week-usage-3",
      bizType: "report",
    });
    assert.strictEqual(pu2.status, "REQUESTED");

    const afterRetry = svc.entitlements.getForPerson(pe.id, personId);
    assert.strictEqual(afterRetry.remainingQuota, 0, "after retry, remaining should be 0");

    // cleanup
    svc.entitlements.cancelUsage(personId, pu2.id);
  });

  console.log("\nAll service package tests passed.");
  closeDb();
  removeTempDbFiles();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  closeDb();
  removeTempDbFiles();
  process.exit(1);
});
