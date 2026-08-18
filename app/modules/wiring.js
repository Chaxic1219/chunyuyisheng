"use strict";

/**
 * 模块间副作用订阅（P2：真正干活，且不阻塞请求路径）。
 * 启动时 require 一次即可；失败不得阻断主流程。
 */
const eventBus = require("../shared/eventBus.js");

let wired = false;

function defer(fn){
  try{
    setImmediate(()=>{
      try{ fn(); }catch(e){ console.error("[wiring]", e && e.message); }
    });
  }catch(e){
    try{ fn(); }catch(e2){ console.error("[wiring]", e2 && e2.message); }
  }
}

function wireModuleEvents(hooks){
  if(wired) return;
  wired = true;
  const h = hooks || {};

  eventBus.on("outbox.enqueued", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] outbox.enqueued", p && p.id, p && p.source);
      }
      // 轻量维护：顺手清过期 admin 会话，降低表膨胀（只删过期行，不碰业务出站数据）
      if(typeof h.purgeAdminSessions === "function") h.purgeAdminSessions();
    });
  });
  eventBus.on("outbox.sent", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] outbox.sent", p && p.id);
      }
      if(typeof h.purgeAdminSessions === "function") h.purgeAdminSessions();
    });
  });
  eventBus.on("community.inbound.archived", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] community.inbound.archived", p && p.messageId);
      }
    });
  });
  eventBus.on("community.moderation.flagged", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] community.moderation.flagged", p && p.flag, p && p.level);
      }
      if(typeof h.notifyModeration === "function") h.notifyModeration(p);
    });
  });
  eventBus.on("ops.config.published", (p)=>{
    defer(()=>{
      console.log("[ops] config published", p && p.domain, "v" + (p && p.version), "doctor=" + (p && p.doctorId));
    });
  });
  eventBus.on("ops.config.rolled_back", (p)=>{
    defer(()=>{
      console.log("[ops] config rolled_back", p && p.domain, "v" + (p && p.version), "doctor=" + (p && p.doctorId));
    });
  });
  eventBus.on("followup.enrolled", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] followup.enrolled", p && p.id, p && p.planKey);
      }
    });
  });
  eventBus.on("followup.node.updated", (p)=>{
    defer(()=>{
      if(process.env.MODULAR_EVENT_LOG === "1"){
        console.log("[event] followup.node.updated", p && p.id, p && p.status);
      }
    });
  });
}

module.exports = { wireModuleEvents };
