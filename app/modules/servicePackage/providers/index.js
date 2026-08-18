"use strict";

const fs = require("fs");
const path = require("path");
const { getWechatPayConfig, isWechatPayConfigured } = require("./wechatConfig.js");

/** Mock 支付：create 后可立即或经 mockComplete 标记成功；refund 即时成功。 */

function createMockProvider() {
  return {
    name: "mock",
    async create({ outTradeNo, amountCents, description }) {
      return {
        provider: "mock",
        outTradeNo,
        amountCents,
        status: "pending",
        prepay: {
          provider: "mock",
          mock: true,
          description: description || "",
          message: "开发态 Mock 支付，调用 mock-complete 或自动完成",
        },
      };
    },
    async query({ outTradeNo, providerTradeNo }) {
      return {
        outTradeNo,
        providerTradeNo: providerTradeNo || null,
        status: "unknown",
      };
    },
    async handleNotify() {
      return { handled: false };
    },
    async refund({ outRefundNo, amountCents, reason }) {
      return {
        provider: "mock",
        outRefundNo,
        amountCents,
        status: "refunded",
        reason: reason || "",
      };
    },
  };
}

/** 占位：商户号就绪后实现真实微信支付。 */
function createWechatProviderStub() {
  return {
    name: "wechat",
    async create() {
      const err = new Error("WechatPayProvider 尚未配置（请设置 SERVICE_PAY_PROVIDER=mock 或实现真实商户对接）");
      err.code = "pay_not_configured";
      throw err;
    },
    async query() {
      const err = new Error("WechatPayProvider 尚未配置");
      err.code = "pay_not_configured";
      throw err;
    },
    async handleNotify() {
      const err = new Error("WechatPayProvider 尚未配置");
      err.code = "pay_not_configured";
      throw err;
    },
    async refund() {
      const err = new Error("WechatPayProvider 尚未配置");
      err.code = "pay_not_configured";
      throw err;
    },
  };
}

function resolveWechatProvider() {
  if (!isWechatPayConfigured()) {
    return createWechatProviderStub();
  }
  const wechatModulePath = path.join(__dirname, "wechat.js");
  if (!fs.existsSync(wechatModulePath)) {
    const err = new Error(
      "WechatPayProvider 已配置（configured=true），但 providers/wechat.js 尚未实现；请完成 S4 wechat provider 或暂用 SERVICE_PAY_PROVIDER=mock"
    );
    err.code = "pay_provider_missing";
    throw err;
  }
  const { createWechatProvider } = require("./wechat.js");
  if (typeof createWechatProvider !== "function") {
    const err = new Error("providers/wechat.js 必须导出 createWechatProvider");
    err.code = "pay_provider_invalid";
    throw err;
  }
  return createWechatProvider(getWechatPayConfig());
}

function getPaymentProvider() {
  const name = String(process.env.SERVICE_PAY_PROVIDER || "mock").trim().toLowerCase();
  if (name === "wechat" || name === "wx" || name === "wechatpay") {
    return resolveWechatProvider();
  }
  if (!["test", "development"].includes(process.env.NODE_ENV || "") && process.env.SERVICE_PAY_ALLOW_MOCK !== "1") {
    const err = new Error("mock payment is forbidden in production");
    err.code = "pay_mock_forbidden";
    throw err;
  }
  return createMockProvider();
}

module.exports = {
  createMockProvider,
  createWechatProviderStub,
  getPaymentProvider,
  getWechatPayConfig,
  isWechatPayConfigured,
};
