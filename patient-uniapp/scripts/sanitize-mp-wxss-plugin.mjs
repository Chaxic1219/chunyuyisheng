import { sanitizeMpCss, sanitizeMpCssInVueSfc } from "./sanitize-mp-css.mjs";

/** @returns {import('vite').Plugin} */
export function sanitizeMpWxssPlugin() {
  const enabled = process.env.UNI_PLATFORM === "mp-weixin";
  return {
    name: "chunyu-sanitize-mp-wxss",
    enforce: "pre",
    transform(code, id) {
      if (!enabled) return null;
      const cleanId = id.split("?")[0].replace(/\\/g, "/");
      if (cleanId.endsWith(".vue")) {
        const next = sanitizeMpCssInVueSfc(code);
        return next === code ? null : { code: next, map: null };
      }
      if (/\.(css|scss|sass|less|wxss)$/.test(cleanId)) {
        const next = sanitizeMpCss(code);
        return next === code ? null : { code: next, map: null };
      }
      return null;
    },
  };
}
