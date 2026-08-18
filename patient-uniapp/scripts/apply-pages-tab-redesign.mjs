// scripts/apply-pages-tab-redesign.mjs
// 任务 6：替换 tabBar 列表与颜色
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "src", "pages.json");
const src = readFileSync(file, "utf8");

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

if (!src.includes(oldTabBar)) {
  console.error("[err] old tabBar block not found");
  process.exit(1);
}
const out = src.replace(oldTabBar, newTabBar);
writeFileSync(file, out, "utf8");
console.log("[ok] tabBar 替换完成");
