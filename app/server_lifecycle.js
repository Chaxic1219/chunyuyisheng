"use strict";

function serverClosePromise(server) {
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    } catch (error) {
      if (error && error.code === "ERR_SERVER_NOT_RUNNING") resolve();
      else reject(error);
    }
  });
}

function createGracefulShutdown(options) {
  const server = options.server;
  const dispose = typeof options.dispose === "function" ? options.dispose : () => {};
  const closeDb = typeof options.closeDb === "function" ? options.closeDb : () => {};
  const exit = typeof options.exit === "function" ? options.exit : (code) => process.exit(code);
  const log = typeof options.log === "function" ? options.log : console.error;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : 15_000;
  let shutdownPromise = null;

  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const closePromise = serverClosePromise(server);
      let disposePromise;
      try {
        disposePromise = Promise.resolve(dispose());
      } catch (error) {
        disposePromise = Promise.reject(error);
      }
      const work = Promise.all([closePromise, disposePromise]).then(() => {
        closeDb();
        return "complete";
      });
      let timeoutHandle;
      const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
      });

      try {
        const result = await Promise.race([work, timeout]);
        if (result === "timeout") {
          try {
            if (typeof server.closeAllConnections === "function") {
              server.closeAllConnections();
            }
          } catch (error) {}
          log("[shutdown] timeout", String(signal || "signal"));
          exit(1);
          return;
        }
        clearTimeout(timeoutHandle);
        exit(0);
      } catch (error) {
        clearTimeout(timeoutHandle);
        log("[shutdown] failed", String(signal || "signal"));
        exit(1);
      }
    })();
    return shutdownPromise;
  };
}

module.exports = { createGracefulShutdown };

