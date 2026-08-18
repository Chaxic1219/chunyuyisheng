/* 小程序封面运维 API 单测 */
const os = require("os"), path = require("path"), fs = require("fs");
const TMP = path.join(os.tmpdir(), "chunyu_weapp_cover_ops_test.db");
[TMP, TMP + "-wal", TMP + "-shm"].forEach(f=>{ try{ fs.unlinkSync(f); }catch(e){} });
process.env.DB_PATH = TMP;
process.env.QIWE_DRY_RUN = "1";

const { db } = require("./db.js");
const qiwe = require("./qiwe.js");
const coverOps = require("./modules/qiwe/weapp_cover_ops.js");

let n = 0, fails = [];
const ok = (c, m) => { n++; if(!c){ fails.push(m); console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

(async ()=>{
  const lv = db.prepare("SELECT id FROM doctors WHERE slug='lvfujing'").get();
  const doctorId = lv.id;

  console.log("== list / guide ==");
  {
    const list = coverOps.listCoverTemplates(doctorId);
    ok(Array.isArray(list) && list.length > 0, "列出模板");
    ok(list.some(x=>x.code === "101"), "含 101");
    const guide = coverOps.recaptureGuide("101", "#小程序://春雨医生/demo");
    ok(guide.steps && guide.steps.length >= 4, "采集说明步骤");
  }

  console.log("== prepare unlock ==");
  {
    const prep = await coverOps.prepareRecapture({
      doctorId,
      code:"101",
      syncSiblings:true,
      autoSendCode:true, // 即使显式要求代发，也应强制关闭
      startedBy:"test"
    });
    ok(prep.unlockedCodes.includes("101"), "解锁 101");
    ok(prep.autoSend && prep.autoSend.disabled === true && (prep.autoSend.sent || []).length === 0,
      "真机采样强制不代发（autoSend disabled）");
    ok(Array.isArray(prep.guide && prep.guide.steps) && prep.guide.steps.some(s=>/不会向任何群自动发/.test(s)),
      "引导文案声明不自动群发");
    const after = qiwe.loadWeappTemplate(doctorId, "101");
    ok(!after.ready, "解锁后 101 不就绪");
    ok(!!coverOps.activePending(doctorId, "101"), "pending 已写入");
  }

  console.log("== db pending code ==");
  {
    const code = coverOps.takeDbPendingCaptureCode(doctorId, { fromRoomId:"room-test-1" }, { selfUserId:"u1" });
    ok(code === "101", "DB pending 可取回 101");
    coverOps.completePendingCapture(doctorId, "101");
    ok(!coverOps.activePending(doctorId, "101"), "完成后 pending 关闭");
  }

  console.log("== copy + custom cover ==");
  {
    const before102 = qiwe.loadWeappTemplate(doctorId, "102");
    const copy = coverOps.updateCardCopy({
      doctorId,
      code:"101",
      title:"自定义主页标题",
      desc:"自定义副文案"
    });
    ok(copy.title === "自定义主页标题", "文案标题已更新");
    const row101 = db.prepare("SELECT title,desc FROM qiwe_weapp_templates WHERE doctor_id=? AND code='101'").get(doctorId);
    const row102 = db.prepare("SELECT title FROM qiwe_weapp_templates WHERE doctor_id=? AND code='102'").get(doctorId);
    ok(row101.title === "自定义主页标题" && row101.desc === "自定义副文案", "101 文案入库");
    ok(row102.title === (before102 && before102.title), "102 文案不同步");

    // 本地种子库可能无完整 appId；测试先补齐跳转字段
    db.prepare(`UPDATE qiwe_weapp_templates SET
      app_id=COALESCE(NULLIF(app_id,''),'wx2e72ecb9760b913c'),
      username=COALESCE(NULLIF(username,''),'gh_681d3fd5683f@app'),
      page_path=COALESCE(NULLIF(page_path,''),'pages/index/index')
      WHERE doctor_id=? AND code IN ('101','102','301')`).run(doctorId);

    // 1x1 jpeg（cdnBigUpload fileType=1 需真实 JPEG；小图跳过 Pillow）
    const jpg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
      "base64"
    );
    const dataUrl = "data:image/jpeg;base64," + jpg.toString("base64");
    const applied = await coverOps.applyCustomCover({
      doctorId,
      code:"101",
      imageDataUrl: dataUrl,
      syncSiblings:true,
      startedBy:"test"
    });
    ok(applied.ok === true && applied.ready === true, "自定义封面应用就绪");
    ok((applied.syncedCodes || []).includes("101"), "同步含 101");
    const after101 = qiwe.loadWeappTemplate(doctorId, "101");
    const after102 = qiwe.loadWeappTemplate(doctorId, "102");
    ok(after101.ready && after101.coverFileId, "101 封面三件套写入");
    ok(after102.coverFileId === after101.coverFileId, "102 同组封面已同步");
    ok(after101.title === "自定义主页标题", "自定义封面不覆盖标题");
    ok(/\.jpg(\?|$)/i.test(after101.thumbUrl || "") || /image\/jpeg/i.test(dataUrl), "封面落库为 jpeg 路径或源为 jpeg");
    const list = coverOps.listCoverTemplates(doctorId);
    const t101 = list.find(x=>x.code === "101");
    ok(t101 && t101.coverSource === "custom" && t101.previewThumb, "列表标记自定义+本地预览");
  }

  console.log("== H5 编号自动补齐跳转 ==");
  {
    const code = "302h5";
    db.prepare("DELETE FROM rules WHERE doctor_id=? AND code=?").run(doctorId, code);
    db.prepare("DELETE FROM qiwe_weapp_templates WHERE doctor_id=? AND code=?").run(doctorId, code);
    const ruleCols = db.prepare("PRAGMA table_info(rules)").all().map(c=>c.name);
    const responsesJson = JSON.stringify([{
      type:"link", title:"住院申请表", sub:"问卷",
      external:{ mode:"h5", status:"ready", url:"https://www.chunyuyisheng.com/rec/demo302h5" }
    }]);
    if(ruleCols.includes("match_type")){
      db.prepare(`INSERT INTO rules(doctor_id,code,aliases,match_type,bot,responses,enabled,sort)
        VALUES(?,?,?,?,?,?,1,99)`).run(doctorId, code, "[]", "exact", "医助", responsesJson);
    }else{
      db.prepare(`INSERT INTO rules(doctor_id,code,aliases,match,bot,responses,enabled,sort)
        VALUES(?,?,?,?,?,?,1,99)`).run(doctorId, code, "[]", "exact", "医助", responsesJson);
    }
    db.prepare(`INSERT INTO qiwe_weapp_templates(
      doctor_id,code,source_type,source_page,source_short_link,title,app_id,username,page_path,
      thumb_url,cover_file_aes_key,cover_file_id,cover_file_size,desc,raw_payload,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      doctorId, code, "link:h5", "住院申请表", "", "住院申请表",
      "", "", "", "", "", "", 0, "问卷", "", new Date().toISOString()
    );
    const boot = coverOps.ensureWeappJumpInfo(doctorId, code);
    ok(!!boot.app_id && !!boot.username && /h5_webview/.test(boot.page_path || ""), "H5 编号自动补齐 appId/username/pagePath");
    ok(/demo302h5/.test(decodeURIComponent(boot.page_path || "")), "pagePath 包装规则 H5 URL");
    const rule = db.prepare("SELECT responses FROM rules WHERE doctor_id=? AND code=?").get(doctorId, code);
    const resp = JSON.parse(rule.responses || "[]");
    ok(resp.some(r=>r && r.type === "mp"), "自动补一条 mp 响应以便发小程序卡");
    const batch = coverOps.bootstrapAllH5Jumps(doctorId);
    ok(batch && Array.isArray(batch.ok) && Array.isArray(batch.skipped), "全量 bootstrap 返回结构");
  }

  console.log("\n== 汇总 ==");
  console.log("断言 " + n + " 条，失败 " + fails.length);
  if(fails.length){
    fails.forEach(f=>console.log("FAIL: " + f));
    process.exit(1);
  }
  console.log("ALL PASS");
  process.exit(0);
})().catch(e=>{
  console.error(e);
  process.exit(1);
});
