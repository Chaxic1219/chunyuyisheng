import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultOutputRoot = path.join(projectRoot, "dist", "build", "mp-weixin");

async function readConfig(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function dedupeIgnoreRules(rules = []) {
  const seen = new Set();
  return rules.filter((rule) => {
    const key = `${rule?.type || ""}:${rule?.value || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function patchWechatConfig(
  outputRoot = defaultOutputRoot,
  sourceProjectPath = path.join(projectRoot, "project.config.json"),
) {
  await mkdir(outputRoot, { recursive: true });
  const sourceProject = await readConfig(sourceProjectPath);
  for (const file of ["project.config.json", "project.private.config.json"]) {
    const filePath = path.join(outputRoot, file);
    const config = await readConfig(filePath);
    if (file === "project.config.json" && sourceProject.appid) {
      config.appid = sourceProject.appid;
    }
    // 3.15.1/3.15.2 在 Windows 开发者工具会间歇抛出 WAServiceMainContext Error:timeout（官方已知问题）
    if (file === "project.config.json") {
      config.libVersion = sourceProject.libVersion || "3.14.1";
    }
    config.setting = {
      ...config.setting,
      ...(sourceProject.setting || {}),
      ignoreDevUnusedFiles: false,
      minified: true,
      minifyWXML: true,
      minifyWXSS: true,
    };
    config.packOptions = {
      ...(config.packOptions || {}),
      ignore: dedupeIgnoreRules([
        ...(config.packOptions?.ignore || []),
        { type: "glob", value: "static/icons/quick-*.png" },
        { type: "glob", value: "static/icons/asset-*.png" },
        { type: "glob", value: "static/icons/view-archive-btn.png" },
        { type: "glob", value: "static/visual/*.png" },
        { type: "glob", value: "static/visual/home-poster-*.webp" },
        { type: "glob", value: "static/tab/archive*.png" },
        { type: "glob", value: "static/logo.png" },
      ]),
    };
    await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await patchWechatConfig(process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputRoot);
}
