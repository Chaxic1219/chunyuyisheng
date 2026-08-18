// scripts/force-utf8-pages.mjs
// 把 src/pages.json 强制按 GBK 读出，转回 UTF-8 写回；然后做 tabBar 替换
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "src", "pages.json");

// 1. 用 GBK 读出
const buf = readFileSync(file);
let decoded;
try {
  decoded = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  console.log("[info] 文件已是 UTF-8，无需转换");
} catch {
  decoded = new TextDecoder("gbk").decode(buf);
  console.log("[info] 文件按 GBK 解码，转换中...");
  writeFileSync(file, decoded, "utf8");
  console.log("[ok] 已写回 UTF-8");
}

// 2. 替换 tabBar
const oldTabBar = `  "tabBar": {
    "custom": true,
    "color": "#6B6B6B",
    "selectedColor": "#176B52",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "static/tab/home.png",
        "selectedIconPath": "static/tab/home-active.png"
      },
      {
        "pagePath": "pages/consult/index",
        "text": "咨询",
        "iconPath": "static/tab/chat.png",
        "selectedIconPath": "static/tab/chat-active.png"
      },
      {
        "pagePath": "pages/mine/index",
        "text": "我的",
        "iconPath": "static/tab/user.png",
        "selectedIconPath": "static/tab/user-active.png"
      }
    ]
  }`;

const newTabBar = `  "tabBar": {
    "custom": true,
    "color": "#68726E",
    "selectedColor": "#0B6B47",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "white",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "static/tab/index.png",
        "selectedIconPath": "static/tab/index-active.png"
      },
      {
        "pagePath": "pages/services/index",
        "text": "健康服务",
        "iconPath": "static/tab/health-service.png",
        "selectedIconPath": "static/tab/health-service-active.png"
      },
      {
        "pagePath": "pages/mine/index",
        "text": "我的",
        "iconPath": "static/tab/mine.png",
        "selectedIconPath": "static/tab/mine-active.png"
      }
    ]
  }`;

if (!decoded.includes(oldTabBar)) {
  console.error("[err] old tabBar block not found");
  process.exit(1);
}
const out = decoded.replace(oldTabBar, newTabBar);
writeFileSync(file, out, "utf8");
console.log("[ok] tabBar 替换完成");
