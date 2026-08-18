"use strict";

function createFixedWindowLimiter(options = {}) {
  const limit = Math.max(1, Number(options.limit) || 1);
  const windowMs = Math.max(1, Number(options.windowMs) || 60_000);
  const maxKeys = Math.max(1, Number(options.maxKeys) || 10_000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const entries = new Map();
  let operations = 0;

  function cleanupExpired(timestamp = now()) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= timestamp) entries.delete(key);
    }
  }

  function makeRoom() {
    while (entries.size >= maxKeys) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  function consume(key) {
    const normalizedKey = String(key || "");
    const timestamp = now();
    operations += 1;
    if (operations % 64 === 0) cleanupExpired(timestamp);
    let entry = entries.get(normalizedKey);
    if (entry && entry.resetAt <= timestamp) {
      entries.delete(normalizedKey);
      entry = null;
    }
    if (!entry) {
      makeRoom();
      entries.set(normalizedKey, { count: 1, resetAt: timestamp + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000))
      };
    }
    return { allowed: true, retryAfter: 0 };
  }

  return {
    consume,
    cleanup: cleanupExpired,
    size: () => entries.size
  };
}

module.exports = { createFixedWindowLimiter };
