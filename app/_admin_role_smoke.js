/* 四角色后台 UI smoke（jsdom × 运行中 demo 服务） */
const { JSDOM } = require("jsdom");
const BASE = process.env.TEST_BASE || "http://localhost:3000";
const wait = ms => new Promise(r=>setTimeout(r,ms));
let fails=[], n=0; const ok=(c,m)=>{ n++; if(!c){ fails.push(m); console.log("  ✗ "+m); } else console.log("  ✓ "+m); };

async function api(method, url, body, cookie){
  const headers = {};
  if(body) headers["Content-Type"] = "application/json";
  if(cookie) headers.Cookie = cookie;
  const r = await globalThis.fetch(BASE+url, { method, headers, body:body ? JSON.stringify(body) : undefined });
  let j = null; try{ j = await r.json(); }catch(e){}
  return { status:r.status, j, headers:r.headers };
}
function setCookieFrom(headers){
  const v = headers.getSetCookie ? headers.getSetCookie()[0] : headers.get("set-cookie");
  return v ? v.split(";")[0] : "";
}
async function waitFor(fn, label, tries=60){
  for(let i=0;i<tries;i++){
    try{ if(fn()) return true; }catch(e){}
    await wait(150);
  }
  throw new Error("等待超时："+label);
}
async function adminDom(username, password){
  let cookie = "";
  const dom = await JSDOM.fromURL(BASE+"/admin", {
    runScripts:"dangerously", resources:"usable", pretendToBeVisual:true,
    beforeParse(w){
      w.fetch = async (u,o={})=>{
        const headers = Object.assign({}, o.headers || {});
        if(cookie) headers.Cookie = cookie;
        const r = await globalThis.fetch(new URL(u, BASE), Object.assign({}, o, { headers }));
        const set = r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie");
        if(set) cookie = set.split(";")[0];
        return r;
      };
      w.alert = msg => { w.__lastAlert = String(msg || ""); };
      w.confirm = () => true;
      w.prompt = () => "";
    }
  });
  const doc = dom.window.document;
  await waitFor(()=>doc.readyState==="complete", "admin load");
  doc.querySelector("#lu").value = username;
  doc.querySelector("#lp").value = password;
  doc.querySelector("#loginBtn").click();
  await waitFor(()=>!doc.querySelector("#appView").classList.contains("hidden"), username+" login");
  await waitFor(()=>doc.querySelector("#nav") && doc.querySelector("#nav").textContent.trim().length>0, username+" nav");
  await wait(300);
  return { dom, doc };
}
function navText(doc){ return (doc.querySelector("#nav")||{}).textContent || ""; }
async function clickNav(doc, label){
  const btn = [...doc.querySelectorAll("#nav button")].find(b=>b.textContent.includes(label));
  if(!btn) return false;
  btn.click();
  await wait(500);
  return true;
}

(async()=>{
  const RID = Date.now().toString(36).slice(-6);
  const login = await api("POST","/api/admin/login",{username:"admin",password:"admin888"});
  const COOKIE = setCookieFrom(login.headers);
  ok(login.status===200 && COOKIE, "准备：super API 登录成功");
  const users = {
    ops:{ u:"smoke_ops_"+RID, p:"ops888", role:"ops_manager" },
    assistant:{ u:"smoke_asst_"+RID, p:"asst888", role:"assistant" },
    viewer:{ u:"smoke_view_"+RID, p:"view888", role:"viewer" }
  };
  for(const x of Object.values(users)){
    const r = await api("POST","/api/admin/admins",{username:x.u,password:x.p,role:x.role,doctorIds:[1]},COOKIE);
    ok(r.status===200, "准备：创建 "+x.role+" 账号");
  }

  const sup = await adminDom("admin","admin888");
  ok(/账户与权限/.test(navText(sup.doc)) && /企微配置/.test(navText(sup.doc)) && /审计日志/.test(navText(sup.doc)),
    "super UI：可见账户、企微、审计入口");
  await clickNav(sup.doc, "账户与权限");
  ok(/权限矩阵/.test(sup.doc.querySelector("#main").textContent) && /角色说明/.test(sup.doc.querySelector("#main").textContent),
    "super UI：账户页显示角色说明和权限矩阵");
  sup.dom.window.close();

  const ops = await adminDom(users.ops.u, users.ops.p);
  ok(/审计日志/.test(navText(ops.doc)) && /运营配置/.test(navText(ops.doc)) && !/账户与权限/.test(navText(ops.doc)) && !/企微配置/.test(navText(ops.doc)),
    "ops_manager UI：可见审计/配置，不可见账户/企微");
  await clickNav(ops.doc, "社群工作台");
  await waitFor(()=>!!ops.doc.querySelector("#opsCandidateBtn"), "ops community");
  ok(!!ops.doc.querySelector("#opsCandidateBtn") && !ops.doc.querySelector("#opsCandidateBtn").disabled,
    "ops_manager UI：运营候选按钮可点");
  ops.dom.window.close();

  const asst = await adminDom(users.assistant.u, users.assistant.p);
  ok(/社群工作台/.test(navText(asst.doc)) && !/审计日志/.test(navText(asst.doc)) && !/运营配置/.test(navText(asst.doc)) && !/账户与权限/.test(navText(asst.doc)),
    "assistant UI：可见日常工作，不可见审计/配置/账户");
  await clickNav(asst.doc, "社群工作台");
  await waitFor(()=>!!asst.doc.querySelector("#opsCandidateBtn"), "assistant community");
  ok(!!asst.doc.querySelector("#opsCandidateBtn") && asst.doc.querySelector("#opsCandidateBtn").disabled,
    "assistant UI：运营候选按钮禁用并保留原因");
  asst.dom.window.close();

  const viewer = await adminDom(users.viewer.u, users.viewer.p);
  ok(/审计日志/.test(navText(viewer.doc)) && /社群工作台/.test(navText(viewer.doc)) && !/账户与权限/.test(navText(viewer.doc)) && !/企微配置/.test(navText(viewer.doc)),
    "viewer UI：可见审计摘要和业务只读入口，不可见账户/企微");
  await clickNav(viewer.doc, "社群工作台");
  await waitFor(()=>!!viewer.doc.querySelector("#opsCandidateBtn"), "viewer community");
  ok(viewer.doc.querySelector("#weeklyOpsBtn").disabled && viewer.doc.querySelector("#addGroupBtn").disabled && viewer.doc.querySelector("#opsCandidateBtn").disabled,
    "viewer UI：社群关键写按钮禁用");
  await clickNav(viewer.doc, "审计日志");
  await waitFor(()=>/审计日志/.test(viewer.doc.querySelector("#main").textContent), "viewer audit");
  ok(/审计日志/.test(viewer.doc.querySelector("#main").textContent) && /当前医生只读摘要/.test(viewer.doc.querySelector("#main").textContent),
    "viewer UI：审计页为当前医生摘要");
  viewer.dom.window.close();

  console.log(`\n检查项: ${n}  失败: ${fails.length}`);
  console.log(fails.length?"✗ 四角色 UI smoke 存在失败":"✓ 四角色 UI smoke 全部通过");
  process.exit(fails.length?1:0);
})().catch(e=>{ console.error("测试异常:", e); process.exit(2); });
