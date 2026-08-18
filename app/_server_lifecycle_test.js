"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function test(name, fn) {
  await fn();
  console.log("ok -", name);
}

(async () => {
  const { createGracefulShutdown } = require("./server_lifecycle.js");

  await test("双信号共享一次关闭：先停接收，再等 dispose 和连接，最后关库退出", async () => {
    const events = [];
    const disposeGate = deferred();
    let closeCallback = null;
    const server = {
      close(callback) {
        events.push("server.close");
        closeCallback = callback;
      },
      closeAllConnections() {
        events.push("server.force");
      }
    };
    const shutdown = createGracefulShutdown({
      server,
      async dispose() {
        events.push("dispose.start");
        await disposeGate.promise;
        events.push("dispose.end");
      },
      closeDb() {
        events.push("db.close");
      },
      exit(code) {
        events.push(`exit:${code}`);
      },
      timeoutMs: 1000,
      log() {}
    });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");
    assert.strictEqual(first, second);
    assert.deepStrictEqual(events, ["server.close", "dispose.start"]);
    disposeGate.resolve();
    await Promise.resolve();
    assert.equal(events.includes("db.close"), false);
    closeCallback();
    await first;
    assert.deepStrictEqual(events, [
      "server.close",
      "dispose.start",
      "dispose.end",
      "db.close",
      "exit:0"
    ]);
  });

  await test("关闭超时会强制断开并只退出一次", async () => {
    const exits = [];
    let forceCalls = 0;
    const shutdown = createGracefulShutdown({
      server: {
        close() {},
        closeAllConnections() { forceCalls += 1; }
      },
      dispose: () => new Promise(() => {}),
      closeDb() {},
      exit(code) { exits.push(code); },
      timeoutMs: 20,
      log() {}
    });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    assert.equal(forceCalls, 1);
    assert.deepStrictEqual(exits, [1]);
  });

  await test("server 持有 patient-public dispose 并接入 SIGTERM/SIGINT", async () => {
    const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    assert.match(source, /patientPublicLifecycle\s*=\s*registerPatientPublicRoutes/);
    assert.match(source, /patientPublicLifecycle\.dispose/);
    assert.match(source, /process\.once\(["']SIGTERM["']/);
    assert.match(source, /process\.once\(["']SIGINT["']/);
    assert.match(source, /createGracefulShutdown/);
  });

  console.log("all server lifecycle tests passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

