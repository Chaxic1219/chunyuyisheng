"use strict";

const { ensureSchema } = require("./schema.js");
const { createCatalog } = require("./catalog.js");
const { createCart } = require("./cart.js");
const { createCoupons } = require("./coupons.js");
const { createOrders } = require("./orders.js");
const { createPayments } = require("./payments.js");
const { createActivation } = require("./activation.js");
const { createAdminOrders } = require("./adminOrders.js");
const { createAdminProducts } = require("./adminProducts.js");
const { createAdminCoupons } = require("./adminCoupons.js");
const { createAfterSales } = require("./afterSales.js");
const { createAddresses } = require("./addresses.js");
const { createComponents } = require("./components.js");
const { createEntitlements } = require("./entitlements.js");
const { createMasterData } = require("./masterData.js");
const { createMallProducts } = require("./mallProducts.js");
const { createFulfillment } = require("./fulfillment.js");
const { createBenefitClaim } = require("./benefitClaim.js");

function createServicePackage(db) {
  const masterData = createMasterData(db);
  const mallProducts = createMallProducts(db);
  const catalog = createCatalog(db);
  const cart = createCart(db, catalog);
  const coupons = createCoupons(db, catalog);
  const orders = createOrders(db, catalog, coupons);
  const entitlements = createEntitlements(db);
  const fulfillment = createFulfillment(db, orders, entitlements);
  const payments = createPayments(db, orders, coupons, fulfillment);
  const activation = createActivation(db, orders, entitlements);
  const adminOrders = createAdminOrders(db, {
    ordersApi: orders,
    paymentsApi: payments,
    activationApi: activation,
  });
  const adminProducts = createAdminProducts(db, catalog);
  const adminCoupons = createAdminCoupons(db, coupons);
  const afterSales = createAfterSales(db, {
    ordersApi: orders,
    paymentsApi: payments,
    activationApi: activation,
    couponsApi: coupons,
  });
  const addresses = createAddresses(db);
  const components = createComponents(db);
  const benefitClaim = createBenefitClaim(db, orders);

  return {
    catalog,
    cart,
    coupons,
    orders,
    payments,
    activation,
    adminOrders,
    adminProducts,
    adminCoupons,
    afterSales,
    addresses,
    components,
    entitlements,
    masterData,
    mallProducts,
    fulfillment,
    benefitClaim,
  };
}

module.exports = {
  createServicePackage,
  ensureSchema,
};
