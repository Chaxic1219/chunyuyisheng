"use strict";

/**
 * 进程内轻量事件总线（模块化单体阶段）。
 * 同步强依赖仍走 service；异步扩展/副作用用 emit。
 */
const listeners = new Map();

function on(event, handler){
  if(typeof event !== "string" || !event) throw new Error("eventBus.on: invalid event");
  if(typeof handler !== "function") throw new Error("eventBus.on: handler must be function");
  if(!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

function once(event, handler){
  const wrap = (payload)=>{
    off(event, wrap);
    handler(payload);
  };
  return on(event, wrap);
}

function off(event, handler){
  const set = listeners.get(event);
  if(!set) return;
  set.delete(handler);
  if(!set.size) listeners.delete(event);
}

function emit(event, payload){
  const set = listeners.get(event);
  if(!set || !set.size) return 0;
  let n = 0;
  for(const handler of [...set]){
    try{
      handler(payload);
      n++;
    }catch(e){
      console.error("[eventBus]", event, e && e.message);
    }
  }
  return n;
}

/** 不阻塞调用方：下一 macrotask 再派发（副作用/日志用；强一致业务仍用 emit） */
function emitDeferred(event, payload){
  try{
    setImmediate(()=>{ emit(event, payload); });
    return 1;
  }catch(e){
    return emit(event, payload);
  }
}

function clearAllForTests(){
  listeners.clear();
}

function listenerCount(event){
  const set = listeners.get(event);
  return set ? set.size : 0;
}

module.exports = { on, once, off, emit, emitDeferred, clearAllForTests, listenerCount };
