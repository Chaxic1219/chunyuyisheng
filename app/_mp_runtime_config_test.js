"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mp-runtime-config-"));

function test(name, fn) {
  fn();
  console.log("ok -", name);
}

try {
  const config = require("./mp_runtime_config.js");

  test("production 禁止所有短信 demo/log 配置变体，但允许完全未配置短信", () => {
    const validBase = {
      NODE_ENV: "production",
      WECHAT_MP_APP_ID: "id",
      WECHAT_MP_APP_SECRET: "secret",
      PRIVATE_UPLOAD_DIR: path.join(tempRoot, "sms-matrix-private")
    };
    const cases = [
      [{ SMS_DEMO: "1" }, [], "sms_demo_forbidden"],
      [{ SMS_DEMO: " true " }, [], "sms_demo_forbidden"],
      [{ SMS_DEMO: "YES" }, [], "sms_demo_forbidden"],
      [{ SMS_DEMO: "custom-truthy" }, [], "sms_demo_forbidden"],
      [{ SMS_PROVIDER: " demo " }, [], "sms_provider_forbidden"],
      [{ SMS_PROVIDER: "LOG" }, [], "sms_provider_forbidden"],
      [{}, ["node", "server.js", "--demo"], "sms_demo_forbidden"]
    ];
    for (const [envPatch, argv, code] of cases) {
      const result = config.runtimeReadiness({
        env: { ...validBase, ...envPatch },
        argv,
        appDir: path.join(tempRoot, "release", "app"),
        prepareDirectory: false
      });
      assert.equal(result.status, 503);
      assert.ok(result.errors.includes(code));
      assert.equal(JSON.stringify(result).includes("custom-truthy"), false);
    }
    const withoutSms = config.runtimeReadiness({
      env: validBase,
      argv: ["node", "server.js"],
      appDir: path.join(tempRoot, "release", "app"),
      prepareDirectory: false
    });
    assert.deepStrictEqual(withoutSms, { ok: true, status: 200, errors: [] });
  });

  test("production 短信 provider 不会把 demo/log 解析成已配置能力", () => {
    for (const provider of ["demo", " LOG "]) {
      const child = spawnSync(process.execPath, ["-e", `
        const sms = require("./sms_provider.js");
        (async () => {
          let error = "";
          try { await sms.sendVerificationCode("13800138000", "123456"); }
          catch (caught) { error = caught && caught.code; }
          console.log(JSON.stringify({
            provider: sms.resolveProviderName(),
            configured: sms.isConfigured(),
            error
          }));
        })();
      `], {
        cwd: __dirname,
        env: {
          ...process.env,
          NODE_ENV: "production",
          SMS_PROVIDER: provider,
          SMS_DEMO: ""
        },
        encoding: "utf8",
        timeout: 10_000
      });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      assert.deepStrictEqual(JSON.parse(String(child.stdout).trim()), {
        provider: "off",
        configured: false,
        error: "sms_not_configured"
      });
    }
  });

  test("production 恶意短信 demo 组合在监听前拒绝启动", () => {
    const baseEnv = {
      ...process.env,
      NODE_ENV: "production",
      DB_PATH: path.join(tempRoot, "sms-startup.db"),
      MP_AUTH_STUB: "0",
      WECHAT_MP_APP_ID: "safe-app-id",
      WECHAT_MP_APP_SECRET: "safe-app-secret",
      PRIVATE_UPLOAD_DIR: path.join(tempRoot, "sms-startup-private"),
      SMS_DEMO: "",
      SMS_PROVIDER: ""
    };
    const cases = [
      [{ SMS_DEMO: " On " }, [], "sms_demo_forbidden"],
      [{ SMS_PROVIDER: " DeMo " }, [], "sms_provider_forbidden"],
      [{ SMS_PROVIDER: " log " }, [], "sms_provider_forbidden"],
      [{}, ["--demo"], "sms_demo_forbidden"]
    ];
    for (const [envPatch, args, code] of cases) {
      const child = spawnSync(process.execPath, ["server.js", ...args], {
        cwd: __dirname,
        env: { ...baseEnv, ...envPatch },
        encoding: "utf8",
        timeout: 5_000
      });
      assert.notEqual(child.status, 0, "恶意短信配置不应开始监听");
      const output = String(child.stderr || "") + String(child.stdout || "");
      assert.match(output, /runtime_config_invalid/);
      assert.ok(output.includes(code));
      assert.equal(output.includes("safe-app-secret"), false);
    }
  });

  test("production 缺少任一微信凭证或启用 stub 时 fail closed", () => {
    const cases = [
      [{ NODE_ENV: "production" }, "wechat_credentials_missing"],
      [{ NODE_ENV: "production", WECHAT_MP_APP_ID: "id" }, "wechat_credentials_missing"],
      [{ NODE_ENV: "production", WECHAT_MP_APP_SECRET: "secret" }, "wechat_credentials_missing"],
      [{
        NODE_ENV: "production",
        WECHAT_MP_APP_ID: "id",
        WECHAT_MP_APP_SECRET: "secret",
        MP_AUTH_STUB: "1"
      }, "mp_auth_stub_forbidden"]
    ];
    for (const [env, code] of cases) {
      const result = config.validateWechatRuntime(env);
      assert.equal(result.ok, false);
      assert.ok(result.errors.includes(code));
      assert.equal(JSON.stringify(result).includes("secret"), false);
    }
  });

  test("开发和测试仅显式 MP_AUTH_STUB=1 才允许 stub", () => {
    assert.equal(config.stubModeForEnv({ NODE_ENV: "development" }), false);
    assert.equal(config.stubModeForEnv({ NODE_ENV: "test" }), false);
    assert.equal(
      config.stubModeForEnv({ NODE_ENV: "test", MP_AUTH_STUB: "1" }),
      true
    );
    assert.equal(
      config.stubModeForEnv({
        NODE_ENV: "production",
        WECHAT_MP_APP_ID: "id",
        WECHAT_MP_APP_SECRET: "secret",
        MP_AUTH_STUB: "1"
      }),
      false
    );
  });

  test("production 私密目录必须绝对且位于应用发布树外", () => {
    const appDir = path.join(tempRoot, "release", "app");
    fs.mkdirSync(appDir, { recursive: true });
    const cases = [
      [{ NODE_ENV: "production" }, "private_upload_dir_missing"],
      [{ NODE_ENV: "production", PRIVATE_UPLOAD_DIR: "relative-private" }, "private_upload_dir_not_absolute"],
      [{ NODE_ENV: "production", PRIVATE_UPLOAD_DIR: appDir }, "private_upload_dir_unsafe"],
      [{ NODE_ENV: "production", PRIVATE_UPLOAD_DIR: path.join(appDir, "public", "private") }, "private_upload_dir_unsafe"],
      [{ NODE_ENV: "production", PRIVATE_UPLOAD_DIR: path.join(appDir, "releases", "private") }, "private_upload_dir_unsafe"],
      [{ NODE_ENV: "production", PRIVATE_UPLOAD_DIR: path.join(path.dirname(appDir), "shared-private") }, "private_upload_dir_unsafe"]
    ];
    for (const [env, code] of cases) {
      const result = config.validatePrivateUploadRuntime(env, { appDir });
      assert.equal(result.ok, false);
      assert.ok(result.errors.includes(code));
    }
  });

  test("production 私密目录会创建 0700 并通过写入探针", () => {
    const appDir = path.join(tempRoot, "release", "app");
    const privateRoot = path.join(tempRoot, "sensitive-data");
    const result = config.preparePrivateUploadDirectory({
      env: {
        NODE_ENV: "production",
        PRIVATE_UPLOAD_DIR: privateRoot
      },
      appDir
    });
    assert.equal(result.ok, true);
    assert.equal(result.directory, path.join(privateRoot, "patient-vouchers"));
    assert.equal(fs.statSync(result.directory).isDirectory(), true);
    assert.deepStrictEqual(fs.readdirSync(result.directory), []);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(result.directory).mode & 0o777, 0o700);
    }
  });

  test("私密目录不可写时返回安全错误码且不泄露路径", () => {
    const appDir = path.join(tempRoot, "release", "app");
    const privateRoot = path.join(tempRoot, "unwritable");
    const failingFs = {
      ...fs,
      writeFileSync() {
        const error = new Error("permission denied at " + privateRoot);
        error.code = "EACCES";
        throw error;
      }
    };
    const result = config.preparePrivateUploadDirectory({
      env: {
        NODE_ENV: "production",
        PRIVATE_UPLOAD_DIR: privateRoot
      },
      appDir,
      fsImpl: failingFs
    });
    assert.deepStrictEqual(result.errors, ["private_upload_dir_unavailable"]);
    assert.equal(JSON.stringify(result).includes(privateRoot), false);
  });

  test("ready 状态只列安全错误码且 production 错配为 503", () => {
    const readiness = config.runtimeReadiness({
      env: { NODE_ENV: "production", MP_AUTH_STUB: "1" },
      appDir: path.join(tempRoot, "release", "app"),
      prepareDirectory: false
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.status, 503);
    assert.ok(readiness.errors.includes("wechat_credentials_missing"));
    assert.ok(readiness.errors.includes("mp_auth_stub_forbidden"));
    assert.ok(readiness.errors.includes("private_upload_dir_missing"));
    assert.equal(JSON.stringify(readiness).includes(tempRoot), false);
  });

  test("core readiness ok even when private upload dir missing in production", () => {
    const env = {
      NODE_ENV: "production",
      WECHAT_MP_APP_ID: "wx_test",
      WECHAT_MP_APP_SECRET: "secret_test"
    };
    const core = config.runtimeCoreReadiness({ env, prepareDirectory: false });
    assert.equal(core.ok, true);
    assert.deepStrictEqual(core.errors, []);
    const uploads = config.validatePrivateUploadRuntime(env);
    assert.equal(uploads.ok, false);
    assert.ok(uploads.errors.includes("private_upload_dir_missing"));
    assert.doesNotThrow(() => config.assertRuntimeReady({ env, prepareDirectory: false }));
  });

  test("wechat 模块不因缺少 AppID 自动进入 stub", () => {
    const child = spawnSync(process.execPath, ["-e", `
      delete process.env.MP_AUTH_STUB;
      delete process.env.WECHAT_MP_APP_ID;
      delete process.env.WECHAT_MP_APP_SECRET;
      const wechat = require("./wechat_mp.js");
      (async () => {
        let code = "";
        try { await wechat.code2Session("anything"); }
        catch (error) { code = error && error.message; }
        console.log(JSON.stringify({ stub: wechat.stubMode(), code }));
      })();
    `], {
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: "development" },
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const out = JSON.parse(String(child.stdout).trim());
    assert.deepStrictEqual(out, {
      stub: false,
      code: "missing_wechat_mp_credentials"
    });
  });

  test("production 即使设置 stub 也不得使用短信默认码 fallback", () => {
    const dbPath = path.join(tempRoot, "sms-production.db");
    const child = spawnSync(process.execPath, ["-e", `
      const mpAuth = require("./mp_auth.js");
      let code = "";
      try { mpAuth.assertSmsOk("13800138000", "1234"); }
      catch (error) { code = error && error.message; }
      console.log("__SMS_RESULT__" + code);
      require("./db.js").db.close();
    `], {
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: "production",
        MP_AUTH_STUB: "1",
        DB_PATH: dbPath
      },
      encoding: "utf8",
      timeout: 20_000
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const marker = String(child.stdout || "")
      .split(/\r?\n/)
      .find((line) => line.startsWith("__SMS_RESULT__"));
    assert.equal(marker, "__SMS_RESULT__sms_unavailable");
  });

  test("production 错配会在监听端口前拒绝启动且仅输出安全错误码", () => {
    const dbPath = path.join(tempRoot, "server-production.db");
    const child = spawnSync(process.execPath, ["server.js"], {
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DB_PATH: dbPath,
        MP_AUTH_STUB: "1",
        WECHAT_MP_APP_ID: "",
        WECHAT_MP_APP_SECRET: "",
        PRIVATE_UPLOAD_DIR: ""
      },
      encoding: "utf8",
      timeout: 10_000
    });
    assert.notEqual(child.status, 0, "错配生产进程不应持续监听");
    const output = String(child.stderr || "") + String(child.stdout || "");
    assert.match(output, /runtime_config_invalid/);
    assert.match(output, /wechat_credentials_missing/);
    assert.match(output, /mp_auth_stub_forbidden/);
    assert.equal(output.includes("private_upload_dir_missing"), false);
    assert.equal(output.includes(tempRoot), false);
  });

  test("health/ready 使用同一动态配置检查并在运行期错配时返回 503", () => {
    const dbPath = path.join(tempRoot, "runtime-health.db");
    const privateRoot = path.join(tempRoot, "runtime-health-private");
    const child = spawnSync(process.execPath, ["-e", `
      const serverModule = require("./server.js");
      process.env.NODE_ENV = "production";
      process.env.MP_AUTH_STUB = "1";
      process.env.WECHAT_MP_APP_ID = "";
      process.env.WECHAT_MP_APP_SECRET = "";
      process.env.PRIVATE_UPLOAD_DIR = "";
      process.env.SMS_DEMO = " true ";
      const health = serverModule.runtimeHealth();
      console.log("__RUNTIME_HEALTH__" + JSON.stringify(health));
      process.exit(0);
    `], {
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: "test",
        MP_AUTH_STUB: "1",
        DB_PATH: dbPath,
        PRIVATE_UPLOAD_DIR: privateRoot
      },
      encoding: "utf8",
      timeout: 20_000
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const marker = String(child.stdout || "")
      .split(/\r?\n/)
      .find((line) => line.startsWith("__RUNTIME_HEALTH__"));
    assert.ok(marker);
    const health = JSON.parse(marker.slice("__RUNTIME_HEALTH__".length));
    assert.equal(health.statusCode, 503);
    assert.equal(health.body.ok, false);
    assert.ok(health.body.config.errors.includes("wechat_credentials_missing"));
    assert.ok(health.body.config.errors.includes("mp_auth_stub_forbidden"));
    assert.ok(health.body.config.errors.includes("sms_demo_forbidden"));
    assert.equal(health.body.config.errors.includes("private_upload_dir_missing"), false);
    assert.ok(health.body.uploads && health.body.uploads.ok === false);
    assert.ok(health.body.uploads.errors.includes("private_upload_dir_missing"));
    assert.equal(JSON.stringify(health).includes(tempRoot), false);
    const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    assert.match(source, /\/api\\\/\(\?:health\|ready\)/);
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
