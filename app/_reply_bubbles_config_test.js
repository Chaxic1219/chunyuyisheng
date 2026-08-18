const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_reply_bubble_cfg_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;

const { db } = require("./db.js");
const { resolveReplyBubbleConfig, splitReplyBubbles } = require("./reply_bubbles.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
const did = lv.id;
const ownerDoctorId = 0; // ops_config.js：prompts / safety 为 GLOBAL_DOMAINS，读取 doctor_id=0 的已发布配置
let row = db.prepare("SELECT id,draft_json,published_json FROM ops_configs WHERE doctor_id=? AND domain='prompts'").get(ownerDoctorId);
if(!row){
  db.prepare(`INSERT INTO ops_configs(doctor_id,domain,title,scope,draft_json,published_json,published_version,status,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    ownerDoctorId,
    "prompts",
    "global",
    "global",
    "{}",
    "{}",
    0,
    "published",
    new Date().toISOString()
  );
  row = db.prepare("SELECT id,draft_json,published_json FROM ops_configs WHERE doctor_id=? AND domain='prompts'").get(ownerDoctorId);
}
const cfg = JSON.parse(row.published_json || row.draft_json || "{}");
cfg.replySplitMinTotal = 40;
cfg.replySplitMaxBubble = 70;
cfg.replySplitDelayMs = 250;
db.prepare("UPDATE ops_configs SET draft_json=?,published_json=? WHERE id=?").run(JSON.stringify(cfg), JSON.stringify(cfg), row.id);

console.log("== reply bubble config ==");
const c = resolveReplyBubbleConfig(did);
ok(c.minTotal === 40 && c.maxBubble === 70 && c.delayMs === 250, "读取运营配置数值");

const text = "肚子疼确实难受，先别急。您具体是哪个位置疼？是上腹、下腹还是肚脐周围？疼了多久了？有没有发烧、恶心或者拉肚子？";
const parts = splitReplyBubbles(text, c);
ok(parts.length >= 2, "按配置拆条生效");

console.log("\n== 汇总 ==");
console.log("断言 " + n + " 条，失败 " + fails.length);
if(fails.length){
  fails.forEach(f=>console.log("FAIL: " + f));
  process.exit(1);
}
console.log("ALL PASS");
process.exit(0);
