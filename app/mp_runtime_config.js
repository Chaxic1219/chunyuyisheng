"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function explicitStubRequested(env = process.env) {
  return String(env.MP_AUTH_STUB || "").trim() === "1";
}

function stubModeForEnv(env = process.env) {
  return !isProduction(env) && explicitStubRequested(env);
}

function normalizedEnvValue(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function truthyEnvValue(value) {
  const normalized = normalizedEnvValue(value);
  return !!normalized && !["0", "false", "no", "off"].includes(normalized);
}

function smsDemoRequested(env = process.env, argv = process.argv) {
  return truthyEnvValue(env.SMS_DEMO)
    || (Array.isArray(argv) && argv.some((arg) => normalizedEnvValue(arg) === "--demo"));
}

function validateSmsRuntime(env = process.env, options = {}) {
  const errors = [];
  if (!isProduction(env)) return { ok: true, errors };
  const argv = Object.prototype.hasOwnProperty.call(options, "argv")
    ? options.argv
    : process.argv;
  if (smsDemoRequested(env, argv)) errors.push("sms_demo_forbidden");
  const provider = normalizedEnvValue(env.SMS_PROVIDER);
  if (provider === "demo" || provider === "log") {
    errors.push("sms_provider_forbidden");
  }
  return { ok: errors.length === 0, errors };
}

function validateWechatRuntime(env = process.env) {
  const errors = [];
  if (isProduction(env)) {
    if (
      !String(env.WECHAT_MP_APP_ID || "").trim() ||
      !String(env.WECHAT_MP_APP_SECRET || "").trim()
    ) {
      errors.push("wechat_credentials_missing");
    }
    if (explicitStubRequested(env)) errors.push("mp_auth_stub_forbidden");
  }
  return { ok: errors.length === 0, errors };
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validatePrivateUploadRuntime(env = process.env, options = {}) {
  if (!isProduction(env)) return { ok: true, errors: [] };
  const configured = String(env.PRIVATE_UPLOAD_DIR || "").trim();
  if (!configured) return { ok: false, errors: ["private_upload_dir_missing"] };
  if (!path.isAbsolute(configured)) {
    return { ok: false, errors: ["private_upload_dir_not_absolute"] };
  }
  const appDir = path.resolve(options.appDir || __dirname);
  const releaseDir = path.resolve(options.releaseDir || path.dirname(appDir));
  const releaseIsFilesystemRoot = releaseDir === path.parse(releaseDir).root;
  if (
    isPathWithin(appDir, configured) ||
    (!releaseIsFilesystemRoot && isPathWithin(releaseDir, configured))
  ) {
    return { ok: false, errors: ["private_upload_dir_unsafe"] };
  }
  return { ok: true, errors: [] };
}

function preparePrivateUploadDirectory(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const validation = validatePrivateUploadRuntime(env, options);
  if (!validation.ok) return validation;

  const configured = String(env.PRIVATE_UPLOAD_DIR || "").trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(path.resolve(options.appDir || __dirname), "private-uploads");
  const directory = path.join(root, "patient-vouchers");
  let probePath = "";
  try {
    fsImpl.mkdirSync(root, { recursive: true, mode: 0o700 });
    fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const target of [root, directory]) {
      const stat = fsImpl.lstatSync(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("private_upload_dir_invalid");
      }
      if (typeof fsImpl.chmodSync === "function") fsImpl.chmodSync(target, 0o700);
    }
    probePath = path.join(
      directory,
      `.write-probe-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
    );
    fsImpl.writeFileSync(probePath, Buffer.from("probe"), { flag: "wx", mode: 0o600 });
    fsImpl.unlinkSync(probePath);
    probePath = "";
    return { ok: true, errors: [], directory };
  } catch (error) {
    if (probePath) {
      try { fsImpl.unlinkSync(probePath); } catch (cleanupError) {}
    }
    return { ok: false, errors: ["private_upload_dir_unavailable"] };
  }
}

function runtimeCoreReadiness(options = {}) {
  const env = options.env || process.env;
  const wechat = validateWechatRuntime(env);
  const sms = validateSmsRuntime(env, options);
  const errors = [...wechat.errors, ...sms.errors];
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 200 : 503,
    errors
  };
}

function runtimeUploadReadiness(options = {}) {
  const uploads = options.prepareDirectory === false
    ? validatePrivateUploadRuntime(options.env || process.env, options)
    : preparePrivateUploadDirectory(options);
  return {
    ok: uploads.ok,
    status: uploads.ok ? 200 : 503,
    errors: (uploads.errors || []).slice(),
    directory: uploads.directory
  };
}

function runtimeReadiness(options = {}) {
  const core = runtimeCoreReadiness(options);
  const uploads = runtimeUploadReadiness(options);
  const errors = [...core.errors, ...uploads.errors];
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 200 : 503,
    errors
  };
}

function assertRuntimeReady(options = {}) {
  const result = runtimeCoreReadiness(options);
  if (!result.ok) {
    const error = new Error("runtime_config_invalid");
    error.code = "runtime_config_invalid";
    error.errors = result.errors.slice();
    throw error;
  }
  return result;
}

/** 首发默认兼容开：未设置 MP_SESSION_COMPAT 时为 true。 */
function mpSessionCompatEnabled(env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(env, "MP_SESSION_COMPAT")) {
    return true;
  }
  return truthyEnvValue(env.MP_SESSION_COMPAT);
}

module.exports = {
  isProduction,
  explicitStubRequested,
  stubModeForEnv,
  truthyEnvValue,
  smsDemoRequested,
  validateSmsRuntime,
  validateWechatRuntime,
  validatePrivateUploadRuntime,
  preparePrivateUploadDirectory,
  runtimeCoreReadiness,
  runtimeUploadReadiness,
  runtimeReadiness,
  assertRuntimeReady,
  mpSessionCompatEnabled
};
