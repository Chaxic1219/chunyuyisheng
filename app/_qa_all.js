/* 一键全量质检（冲100分作业的主验证脚本）
   用法：
     node _qa_all.js            # 仅跑回归（_fulltest + _uitest）
     node _qa_all.js --shots    # 回归 + 全量截图扫查（_qa_populate + _qa_sweep）
   前置：服务以 demo 模式运行 → node server.js --demo（另开一个终端 / 后台） */
const { spawnSync } = require("child_process");
const BASE = "http://localhost:3000";
const withShots = process.argv.includes("--shots");

function run(label, file, args){
  process.stdout.write(`\n──────── ${label} ────────\n`);
  const r = spawnSync("node", [file, ...(args||[])], { cwd: __dirname, stdio: "inherit" });
  return r.status === 0;
}

(async()=>{
  // 0. 探活 + 模式检查
  let demo = false;
  try{
    const r = await fetch(BASE + "/api/sms/send", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({phone:"13800000000"}) });
    const j = await r.json();
    demo = !!j.code;
  }catch(e){
    console.error(`✗ 服务未启动（${BASE}）。请先：cd app && node server.js --demo`);
    process.exit(1);
  }
  if(!demo){
    console.error("✗ 服务在生产模式（短信不回明文 code）。回归/截图依赖 demo 模式，请用：node server.js --demo");
    process.exit(1);
  }
  console.log("✓ 服务在线且为 demo 模式");

  const results = [];
  results.push(["接口回归 _fulltest", run("接口回归 _fulltest.js", "_fulltest.js")]);
  results.push(["UI 回归 _uitest", run("UI 回归 _uitest.js", "_uitest.js")]);
  if(withShots){
    results.push(["灌数据 _qa_populate", run("灌数据 _qa_populate.js", "_qa_populate.js")]);
    results.push(["全量截图 _qa_sweep", run("全量截图 _qa_sweep.js", "_qa_sweep.js")]);
  }

  console.log("\n════════ 质检汇总 ════════");
  let allOk = true;
  for(const [name, ok] of results){ console.log(`${ok ? "✅" : "❌"} ${name}`); if(!ok) allOk = false; }
  console.log(allOk ? "\n🎉 全部通过" : "\n⚠️ 存在失败项，见上方输出");
  process.exit(allOk ? 0 : 1);
})();
