/* ops 真模块冒烟：读侧 + 写路径归属 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_ops_mod_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const eventBus = require("./shared/eventBus.js");
const ops = require("./modules/ops");
const opsCompat = require("./ops_config.js");

let n = 0, fails = [];
const ok = (c, m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function listJsFiles(dir, acc){
  for(const name of fs.readdirSync(dir)){
    if(name === "node_modules" || name === "public" || name === "docs") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if(st.isDirectory()) listJsFiles(p, acc);
    else if(name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

(async ()=>{
  eventBus.clearAllForTests();
  const root = __dirname;
  const files = listJsFiles(root, []);
  const offenders = [];
  for(const f of files){
    const rel = path.relative(root, f).replace(/\\/g, "/");
    if(rel === "modules/ops/repo.js") continue;
    if(rel === "db.js") continue; // 启动种子/迁移暂留
    if(rel.startsWith("_") && rel.endsWith(".js")) continue;
    const src = fs.readFileSync(f, "utf8");
    if(/INSERT\s+INTO\s+ops_configs\s*\(/i.test(src) ||
       /UPDATE\s+ops_configs\s+SET/i.test(src) ||
       /INSERT\s+INTO\s+ops_config_audit\s*\(/i.test(src)){
      offenders.push(rel);
    }
  }
  ok(offenders.length === 0, "业务源码无直写 ops_configs/audit（仅 repo；db 种子除外）");
  if(offenders.length) console.log("  offenders:", offenders.join(", "));

  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  ok(typeof ops.scripts === "function" && typeof ops.render === "function", "ops API 可用");
  ok(opsCompat.scripts === ops.scripts, "ops_config.js 兼容再导出");
  ok(typeof ops.saveDraft === "function" && typeof ops.publish === "function", "写路径 API");
  ok(typeof ops.validateOpsConfig === "function", "校验规则在 ops");

  ok(ops.scriptValue({ code313:"-" }, "313") === "", "'-' 不当作可发送话术");
  ok(ops.scriptValue({ "code联络表":"联络表提示" }, "联络表") === "联络表提示", "中文编号可读");
  ok(ops.render("您好【患者称呼】", { patient:"王先生" }) === "您好王先生", "render 友好占位");
  ok(!/\{senderId\}/.test(ops.render("x{senderId}y", {})), "render 去掉 senderId");

  const scripts = ops.scripts(lv.id);
  ok(scripts && typeof scripts === "object", "scripts(doctorId) 返回对象");
  ok(ops.hasCodeScript(lv.id, "101") === true || ops.scriptValue(scripts, "code101") !== "", "吕医生有默认/发布话术口径");

  const bad = ops.validateOpsConfig("safety", { redFlags:[], humanTriggers:["x"], levels:{} });
  ok(!bad.ok && bad.errors.length > 0, "safety 空红线校验失败");

  const nowIso = new Date().toISOString();
  const row = ops.ensure({
    domain: "scripts",
    doctorId: lv.id,
    nowIso,
    getDefault: ()=>({ code101:"ensure-default-101", transferHuman:"转人工" }),
    onSeeded: ()=>{}
  });
  ok(!!row && row.domain === "scripts", "ensure 返回 scripts 行");

  const draftCfg = Object.assign({}, ops.parseConfigJson(row.draft_json, {}), {
    code101: "draft-101-owned",
    transferHuman: "转人工草稿"
  });
  const saved = ops.saveDraft({
    id: row.id, domain: row.domain, cfg: draftCfg, actor: "unit", updatedAt: nowIso
  });
  ok(saved.ok, "saveDraft 成功");
  const afterDraft = ops.getById(row.id);
  ok(/draft-101-owned/.test(afterDraft.draft_json || ""), "draft_json 已更新");

  let published = null;
  eventBus.on("ops.config.published", (p)=>{ published = p; });
  const pub = ops.publish({
    row: afterDraft, cfg: draftCfg, actor: "unit", publishedAt: nowIso
  });
  ok(pub.ok && pub.version >= 1, "publish 成功");
  ok(published && published.domain === "scripts", "emitPublished 事件");
  const afterPub = ops.getById(row.id);
  ok(afterPub.status === "published" && /draft-101-owned/.test(afterPub.published_json || ""), "published_json 同步");

  // 源码结构
  const rootSrc = fs.readFileSync(path.join(__dirname, "ops_config.js"), "utf8");
  ok(/module\.exports\s*=\s*require\("\.\/modules\/ops"\)/.test(rootSrc), "ops_config 为兼容层");
  ok(fs.existsSync(path.join(__dirname, "routes/config-center.js")), "存在 config-center 路由");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
