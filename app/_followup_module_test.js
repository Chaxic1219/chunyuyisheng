/* followup 真模块冒烟 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_followup_mod_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const eventBus = require("./shared/eventBus.js");
const followup = require("./modules/followup");
const followupCompat = require("./followup.js");

let n = 0, fails = [];
const ok = (c, m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async ()=>{
  eventBus.clearAllForTests();
  const lv = db.prepare("SELECT id, content FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  // 注入可控方案（覆盖种子方案，保证断言稳定）
  let content = {};
  try{ content = JSON.parse(lv.content || "{}"); }catch(e){ content = {}; }
  content.followupPlans = [{
    key: "unit_plan",
    name: "单元测试方案",
    nodes: [
      { day:0, title:"入组当日", edu:"注意休息", reminder:"打卡", action:"consult" },
      { day:7, title:"一周复查", edu:"复诊提醒", reminder:"电话", action:"call" }
    ]
  }];
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), lv.id);

  const plans = followup.plansFor(lv.id);
  ok(plans.length === 1 && plans[0].key === "unit_plan", "plansFor 可读方案");
  const plan = followup.findPlan(lv.id, "unit_plan");
  ok(!!plan && plan.nodes.length === 2, "findPlan 命中");

  let enrolledEvt = null;
  eventBus.on("followup.enrolled", (p)=>{ enrolledEvt = p; });
  const row = followup.enroll(lv.id, {
    name: "测患者",
    phone: "13800138000",
    planKey: plan.key || plan.name,
    enrolledAt: "2026-07-01"
  });
  ok(row && row.id, "enroll 入库");
  ok(enrolledEvt && enrolledEvt.id === row.id, "发出 followup.enrolled");

  const detail = followup.detail(row.id);
  ok(detail && detail.total === 2 && detail.patientName === "测患者", "detail 时间轴");
  ok(detail.nodes[0].state === "due" || detail.nodes[0].state === "upcoming" || detail.nodes[0].state === "done", "节点 state 计算");

  const mine = followup.mine(lv.id, "13800138000");
  ok(mine.some(x => x.id === row.id), "mine 按手机号");

  const queue = followup.listQueue(lv.id);
  ok(queue.some(x => x.id === row.id), "listQueue 含入组行");

  let nodeEvt = null;
  eventBus.on("followup.node.updated", (p)=>{ nodeEvt = p; });
  const after = followup.markNode(row.id, 0, "done", "tester");
  ok(after && after.nodes[0].status === "done", "markNode done");
  ok(nodeEvt && nodeEvt.status === "done", "发出 followup.node.updated");

  const after2 = followup.markNode(row.id, 1, "done", "tester");
  ok(after2 && after2.status === "completed", "全部完成 → completed");

  ok(followupCompat.enroll === followup.enroll, "根 followup.js 兼容再导出");

  // 空方案拒绝
  content.followupPlans.push({ key:"empty", name:"空方案", nodes:[] });
  db.prepare("UPDATE doctors SET content=? WHERE id=?").run(JSON.stringify(content), lv.id);
  ok(followup.enroll(lv.id, { name:"x", phone:"139", planKey:"empty" }) === null, "空方案不入组");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
