/* outbox 所有权硬闭环：业务源码不得直写 outbound_queue */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_outbox_own_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const eventBus = require("./shared/eventBus.js");
const outbox = require("./modules/outbox");

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
  const updateOffenders = [];
  for(const f of files){
    const rel = path.relative(root, f).replace(/\\/g, "/");
    if(rel === "modules/outbox/repo.js") continue;
    if(rel.startsWith("_") && rel.endsWith(".js")) continue; // 测试夹具可直写
    const src = fs.readFileSync(f, "utf8");
    if(/db\.prepare\s*\(\s*[`'"]INSERT\s+INTO\s+outbound_queue/i.test(src) ||
       /INSERT\s+INTO\s+outbound_queue\s*\(/i.test(src)){
      offenders.push(rel);
    }
    if(/UPDATE\s+outbound_queue\b/i.test(src) || /DELETE\s+FROM\s+outbound_queue\b/i.test(src)){
      updateOffenders.push(rel);
    }
  }
  ok(offenders.length === 0, "业务源码无 INSERT INTO outbound_queue（仅 repo 允许）");
  if(offenders.length) console.log("  offenders:", offenders.join(", "));
  ok(updateOffenders.length === 0, "业务源码无 UPDATE/DELETE outbound_queue（仅 repo 允许）");
  if(updateOffenders.length) console.log("  updateOffenders:", updateOffenders.join(", "));

  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  let via = null;
  eventBus.on("outbox.enqueued", (p)=>{ via = p && p.via; });

  const id = outbox.insert({
    doctorId: lv.id,
    targetType: "qiwe_room",
    targetName: "room-own",
    channelType: "qiwe",
    text: "ownership insert",
    payload: { qiwe:{ toId:"room-own" } },
    status: "pending",
    source: "unit_own",
    priority: "normal",
    sentMode: "real",
    dataSource: "qiwe"
  }, { via: "unit_insert" });
  ok(Number(id) > 0, "outbox.insert 返回 id");
  const row = db.prepare("SELECT * FROM outbound_queue WHERE id=?").get(id);
  ok(row && row.source === "unit_own" && row.sent_mode === "real" && row.data_source === "qiwe", "repo 写入含 sent_mode/data_source");
  ok(via === "unit_insert", "insert 发 outbox.enqueued");

  const group = db.prepare("SELECT * FROM community_groups WHERE doctor_id=? ORDER BY id LIMIT 1").get(lv.id);
  via = null;
  const queued = outbox.enqueue({
    doctorId: lv.id,
    group,
    text: "社群 enqueue",
    status: "pending",
    source: "unit_enq"
  });
  ok(queued && queued.id && queued.status === "pending", "enqueue 返回公开对象");
  ok(via === "enqueue", "enqueue 事件 via");

  // community 委托路径
  const community = require("./community.js");
  const q2 = community.enqueue({
    doctorId: lv.id,
    group,
    text: "via community",
    status: "pending",
    source: "unit_comm"
  });
  ok(q2 && q2.id && db.prepare("SELECT source FROM outbound_queue WHERE id=?").get(q2.id).source === "unit_comm", "community.enqueue 委托 outbox");

  // 状态机归属 outbox（community 仅委托）
  const communitySrc = fs.readFileSync(path.join(root, "community.js"), "utf8");
  ok(/setOutboxStatus:\s*\(\.\.\.a\)=>outbox\.setOutboxStatus/.test(communitySrc)
    || /outbox\.setOutboxStatus/.test(communitySrc), "community.setOutboxStatus 委托 outbox");
  ok(!/preemptSending\s*=/.test(communitySrc), "community 不再含 preemptSending 状态机");

  let sentEvt = null;
  eventBus.on("outbox.sent", (p)=>{ sentEvt = p; });
  const idManual = outbox.enqueueDirect({
    doctorId: lv.id, targetId: "room-manual", text: "manual mark", source: "unit_manual",
    channelType: "wechat", isGroup: true
  });
  const cancelled = await outbox.setOutboxStatus(idManual, "cancelled", "tester");
  ok(cancelled && cancelled.status === "cancelled", "cancel pending 成功");

  const idEdit = outbox.enqueueDirect({
    doctorId: lv.id, targetId: "room-edit", text: "before", source: "unit_edit",
    channelType: "wechat", isGroup: true
  });
  const edited = outbox.editOutboxText(idEdit, "after edit", "tester");
  ok(edited && edited.text === "after edit" && edited.status === "pending", "editOutboxText 仅改 pending 正文");

  const idSent = outbox.enqueueDirect({
    doctorId: lv.id, targetId: "room-sent", text: "v1 fallback", source: "unit_sent",
    channelType: "wechat", isGroup: true
  });
  const marked = await outbox.setOutboxStatus(idSent, "sent", "tester");
  ok(marked && marked.status === "sent" && marked.sentMode === "manual", "无真发凭证时 V1 manual sent");
  ok(sentEvt && sentEvt.id === idSent, "发出 outbox.sent 事件");

  const viaComm = await community.setOutboxStatus(
    outbox.enqueueDirect({ doctorId: lv.id, targetId: "r2", text: "c", source: "x", channelType: "wechat", isGroup: true }),
    "ignored", "tester"
  );
  ok(viaComm && viaComm.status === "ignored", "community.setOutboxStatus 委托可用");

  // pending 草稿 text+payload
  const idDraft = outbox.enqueueDirect({
    doctorId: lv.id, targetId: "room-draft", text: "orig", source: "unit_draft",
    channelType: "wechat", isGroup: true
  });
  const drafted = outbox.updatePendingDraft(idDraft, {
    text: "ai rewrite",
    payload: { assistantDraft: { source: "assistant_draft" } }
  }, "tester");
  ok(drafted && drafted.text === "ai rewrite" && drafted.status === "pending", "updatePendingDraft 改 pending 正文");
  const rawDraft = db.prepare("SELECT payload FROM outbound_queue WHERE id=?").get(idDraft);
  ok(/assistant_draft/.test(rawDraft.payload || ""), "updatePendingDraft 写入 payload");

  // 群合并重挂
  const gKeep = db.prepare("INSERT INTO community_groups(doctor_id,name,channel_type,status) VALUES(?,?,?,?)")
    .run(lv.id, "keep-g", "wechat", "active").lastInsertRowid;
  const gDrop = db.prepare("INSERT INTO community_groups(doctor_id,name,channel_type,status) VALUES(?,?,?,?)")
    .run(lv.id, "drop-g", "wechat", "active").lastInsertRowid;
  const idRe = outbox.insert({
    doctorId: lv.id, groupId: gDrop, targetType: "group", targetName: "drop-g",
    channelType: "wechat", text: "reassign", payload: {}, status: "pending", source: "unit_re"
  }, { via: "unit_re" });
  const nRe = outbox.reassignGroup(gDrop, gKeep);
  ok(nRe === 1, "reassignGroup 影响 1 行");
  ok(db.prepare("SELECT group_id FROM outbound_queue WHERE id=?").get(idRe).group_id === gKeep, "group_id 已挂到 keep");

  const campaignsSrc = fs.readFileSync(path.join(root, "modules/community/campaigns.js"), "utf8");
  ok(/updatePendingDraft/.test(campaignsSrc), "community AI 草稿走 updatePendingDraft");
  const cgdSrc = fs.readFileSync(path.join(root, "community_group_doctors.js"), "utf8");
  ok(/reassignGroup/.test(cgdSrc), "群合并走 outbox.reassignGroup");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
