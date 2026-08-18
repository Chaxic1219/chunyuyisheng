/* community 群/成员所有权：业务源码不得直写 community_groups / community_members */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_community_own_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.TRIAGE_AI_DISABLED = "1";

const { db } = require("./db.js");
const community = require("./modules/community");
const service = require("./modules/community/service.js");

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
  const root = __dirname;
  const files = listJsFiles(root, []);
  const offenders = [];
  for(const f of files){
    const rel = path.relative(root, f).replace(/\\/g, "/");
    if(rel === "modules/community/repo.js") continue;
    if(rel === "db.js") continue;
    if(rel.startsWith("_") && rel.endsWith(".js")) continue;
    const src = fs.readFileSync(f, "utf8");
    if(/INSERT\s+INTO\s+community_groups\b/i.test(src) ||
       /UPDATE\s+community_groups\b/i.test(src) ||
       /DELETE\s+FROM\s+community_groups\b/i.test(src) ||
       /INSERT\s+INTO\s+community_members\b/i.test(src) ||
       /UPDATE\s+community_members\b/i.test(src) ||
       /DELETE\s+FROM\s+community_members\b/i.test(src) ||
       /INSERT\s+INTO\s+community_messages\b/i.test(src) ||
       /UPDATE\s+community_messages\b/i.test(src) ||
       /DELETE\s+FROM\s+community_messages\b/i.test(src)){
      offenders.push(rel);
    }
  }
  ok(offenders.length === 0, "业务源码无直写 community_groups/members/messages（仅 repo；db 种子除外）");
  if(offenders.length) console.log("  offenders:", offenders.join(", "));

  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  ok(!!lv, "种子医生存在");

  const created = community.createGroup({ doctorId: lv.id, name: "ownership-test-group" });
  ok(created && created.id && created.name === "ownership-test-group", "createGroup 经模块");

  const found = community.findQiweBusinessGroupByRoom("no-such-room-xyz");
  ok(found && found.accepted === false, "findQiwe 未知群拒绝");

  const g = service.ensureDefaultGroup(lv.id);
  ok(!!g && g.id, "ensureDefaultGroup 可用");

  const mem = community.upsertMember(lv.id, created.id, {
    externalUserId: "uid-own-1", senderName: "测试群友", dataSource: "manual"
  });
  ok(mem && mem.id && mem.display_name === "测试群友", "upsertMember 经模块");

  const msg = community.repo.insertMessage({
    doctorId: lv.id, groupId: created.id, memberId: mem.id,
    externalMsgId: "msg-own-1", senderName: mem.display_name, text: "hello",
    processStatus: "received", dataSource: "manual"
  });
  ok(msg && msg.id, "insertMessage 经 repo");
  community.repo.setProcessStatus(msg.id, "manual_only");
  ok(community.repo.getMessageById(msg.id).process_status === "manual_only", "setProcessStatus 经 repo");

  ok(typeof community.archiveQiweInbound === "function", "门面仍导出归档");
  ok(fs.existsSync(path.join(root, "modules/community/inbound.js")), "存在 community/inbound");
  ok(fs.existsSync(path.join(root, "modules/community/orchestrate.js")), "存在 community/orchestrate");
  ok(fs.existsSync(path.join(root, "modules/community/moderation.js")), "存在 community/moderation");
  ok(fs.existsSync(path.join(root, "modules/community/workspace.js")), "存在 community/workspace");
  ok(fs.existsSync(path.join(root, "modules/community/campaigns.js")), "存在 community/campaigns");
  const indexSrc = fs.readFileSync(path.join(root, "modules/community/index.js"), "utf8");
  ok(indexSrc.includes('require("./inbound.js")') && !/impl\(\)\.archiveQiweInbound/.test(indexSrc),
    "门面归档走 inbound（非懒加载 community.js）");
  ok(indexSrc.includes("orchestrate.handleInbound") && !/impl\(\)\.handleInbound/.test(indexSrc),
    "门面 handleInbound 走 orchestrate");
  ok(indexSrc.includes("moderation.recordGroupModeration") && !/impl\(\)\.recordGroupModeration/.test(indexSrc),
    "门面风控走 moderation");
  ok(indexSrc.includes("workspace.overview") && !/impl\(\)\.overview/.test(indexSrc),
    "门面 overview 走 workspace");
  const shellSrc = fs.readFileSync(path.join(root, "community.js"), "utf8");
  ok(shellSrc.includes('require("./modules/community/') && !/function overview\(/.test(shellSrc),
    "community.js 已收成兼容壳（无 overview 实现）");
  ok(fs.existsSync(path.join(root, "modules/community/repo.js")), "存在 community/repo");
  ok(fs.existsSync(path.join(root, "routes/community-admin.js")), "存在 community-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/doctors-admin.js")), "存在 doctors-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/patients-admin.js")), "存在 patients-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/triage-admin.js")), "存在 triage-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/messages-admin.js")), "存在 messages-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/patient-public.js")), "存在 patient-public 路由");
  ok(fs.existsSync(path.join(root, "routes/auth-admin.js")), "存在 auth-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/content-admin.js")), "存在 content-admin 路由");
  ok(fs.existsSync(path.join(root, "routes/channel-bridges.js")), "存在 channel-bridges 路由");
  ok(fs.existsSync(path.join(root, "routes/wecom-sidebar.js")), "存在 wecom-sidebar 路由");
  ok(fs.existsSync(path.join(root, "routes/ops-desk.js")), "存在 ops-desk 路由");
  const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
  ok(serverSrc.includes("registerDoctorsAdminRoutes") && serverSrc.includes("registerPatientsAdminRoutes")
    && serverSrc.includes("registerTriageAdminRoutes") && serverSrc.includes("registerMessagesAdminRoutes")
    && serverSrc.includes("registerPatientPublicRoutes") && serverSrc.includes("registerAuthAdminRoutes")
    && serverSrc.includes("registerContentAdminRoutes") && serverSrc.includes("registerChannelBridgeRoutes")
    && serverSrc.includes("registerWecomSidebarRoutes") && serverSrc.includes("registerOpsDeskRoutes"),
    "server 已挂载主要 routes 注册器（含 sidebar/ops-desk）");

  console.log("\n断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL:", f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
