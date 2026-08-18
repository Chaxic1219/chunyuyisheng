/* 运营展示统一北京时间。
   SQLite datetime('now') / 无时区 ISO → 按 UTC；带 Z 或 ±偏移 → 按绝对时间。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TimeFmt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function fmtCnTime(v, mode) {
    const raw = String(v == null ? "" : v).trim();
    if (!raw) return "";
    let d;
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
      d = new Date(raw);
    } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
      const base = raw.replace(" ", "T").replace(/\.\d{1,3}$/, "");
      d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(base) ? base : base + "Z");
    } else {
      d = new Date(raw);
    }
    if (Number.isNaN(d.getTime())) return raw.replace("T", " ").slice(0, 16);
    const s = d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }); // YYYY-MM-DD HH:mm:ss
    if (mode === "mdhm") return s.slice(5, 16);
    return s.slice(0, 16);
  }
  return { fmtCnTime };
});
