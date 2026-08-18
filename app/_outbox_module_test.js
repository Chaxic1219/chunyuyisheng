/* outbox 模块门面 + eventBus 冒烟（离线） */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_outbox_mod_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const eventBus = require("./shared/eventBus.js");
const outbox = require("./modules/outbox");

let n = 0, fails = [];
const ok = (c, m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async ()=>{
  eventBus.clearAllForTests();
  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  let enqueued = null;
  eventBus.on("outbox.enqueued", (p)=>{ enqueued = p; });

  const id = outbox.enqueueDirect({
    doctorId: lv.id,
    targetId: "room-test-1",
    text: "模块化出站测试",
    source: "unit_outbox",
    channelType: "qiwe",
    isGroup: true
  });
  ok(Number(id) > 0, "enqueueDirect 返回 id");
  const row = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(id);
  ok(row && row.status === "pending" && row.source === "unit_outbox", "直发行 pending + source");
  ok(enqueued && enqueued.id === id && enqueued.via === "enqueueDirect", "发出 outbox.enqueued 事件");

  const group = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? ORDER BY id LIMIT 1").get(lv.id);
  ok(!!group, "存在社群行");
  enqueued = null;
  const queued = outbox.enqueue({
    doctorId: lv.id,
    group,
    text: "社群入队测试",
    status: "pending",
    source: "unit_enqueue"
  });
  ok(queued && queued.id && queued.status === "pending", "enqueue 经 outbox service 成功");
  ok(enqueued && enqueued.via === "enqueue", "enqueue 也发 outbox.enqueued");

  const shaped = outbox.outboxOut(row);
  ok(shaped && shaped.id === row.id && shaped.status === "pending", "outboxOut 门面可用");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
