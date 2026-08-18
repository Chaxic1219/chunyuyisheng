/**
 * 微信 WXSS 兼容清理：
 * 1) 去掉 :root（小程序不支持，会报 error at token ':'）
 * 2) 去掉 var(--token, fallback) 的 fallback（含 #hex / rgba() 时易导致 WXSS 误解析）
 * 3) 去掉 prefers-reduced-motion 媒体查询（WXSS 媒体特性支持有限）
 */
export function stripVarFallbacks(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("var(", i)) {
      const start = i;
      i += 4;
      let depth = 1;
      let commaAt = -1;
      while (i < css.length && depth > 0) {
        const ch = css[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        } else if (ch === "," && depth === 1 && commaAt < 0) {
          commaAt = i;
        }
        i += 1;
      }
      if (depth !== 0) {
        out += css.slice(start, start + 4);
        i = start + 4;
        continue;
      }
      const inner = css.slice(start + 4, i);
      if (commaAt >= 0) {
        const name = css.slice(start + 4, commaAt).trim();
        out += `var(${name})`;
      } else {
        out += `var(${inner})`;
      }
      i += 1; // skip closing )
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

export function stripRootSelector(css) {
  return css
    .replace(/:root\s*,\s*/g, "")
    .replace(/,\s*:root\b/g, "")
    .replace(/:root\b/g, "page");
}

export function stripPrefersReducedMotion(css) {
  let out = "";
  let i = 0;
  const needle = "@media";
  while (i < css.length) {
    const idx = css.indexOf(needle, i);
    if (idx < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, idx);
    let j = idx + needle.length;
    while (j < css.length && /\s/.test(css[j])) j += 1;
    if (css[j] !== "(") {
      out += css.slice(idx, idx + needle.length);
      i = idx + needle.length;
      continue;
    }
    let depth = 0;
    let k = j;
    for (; k < css.length; k += 1) {
      if (css[k] === "(") depth += 1;
      else if (css[k] === ")") {
        depth -= 1;
        if (depth === 0) {
          k += 1;
          break;
        }
      }
    }
    const cond = css.slice(j, k);
    while (k < css.length && /\s/.test(css[k])) k += 1;
    if (!/prefers-reduced-motion/i.test(cond) || css[k] !== "{") {
      out += css.slice(idx, k);
      i = k;
      continue;
    }
    // skip balanced block
    depth = 0;
    for (; k < css.length; k += 1) {
      if (css[k] === "{") depth += 1;
      else if (css[k] === "}") {
        depth -= 1;
        if (depth === 0) {
          k += 1;
          break;
        }
      }
    }
    i = k;
  }
  return out;
}

export function sanitizeMpCss(css) {
  return stripVarFallbacks(stripPrefersReducedMotion(stripRootSelector(css)));
}

export function sanitizeMpCssInVueSfc(source) {
  return source.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, attrs, css) => {
    return `<style${attrs}>${sanitizeMpCss(css)}</style>`;
  });
}
