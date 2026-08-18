"use strict";
/**
 * HTTP 路由索引：method 分桶 + 无捕获精确路径快表。
 * 不改变 handler 语义；仅加速匹配。
 */

function exactPathFromRe(re){
  if(!(re instanceof RegExp)) return null;
  const src = re.source;
  if(!src.startsWith("^") || !src.endsWith("$")) return null;
  const inner = src.slice(1, -1);
  // 允许 \/ 与普通字面量；一旦含捕获/量词/字符类则不是精确路径
  if(/[.*+?^${}()|[\]\\]/.test(inner.replace(/\\\//g, ""))) return null;
  return inner.replace(/\\\//g, "/");
}

function createRouteIndex(){
  const all = [];
  const byMethod = Object.create(null);
  const exact = Object.create(null);

  function add(method, re, fn){
    const entry = { method, re, fn };
    all.push(entry);
    if(!byMethod[method]) byMethod[method] = [];
    byMethod[method].push(entry);
    const path = exactPathFromRe(re);
    if(path){
      if(!exact[method]) exact[method] = Object.create(null);
      if(!exact[method][path]) exact[method][path] = entry;
    }
    return entry;
  }

  function match(method, pathname){
    const ex = exact[method] && exact[method][pathname];
    if(ex){
      return { entry: ex, match: [pathname], exact: true };
    }
    const list = byMethod[method] || [];
    for(let i = 0; i < list.length; i++){
      const entry = list[i];
      const mm = pathname.match(entry.re);
      if(mm) return { entry, match: mm, exact: false };
    }
    return null;
  }

  return {
    add,
    match,
    get routes(){ return all; },
    stats(){
      let exactCount = 0;
      for(const m of Object.keys(exact)) exactCount += Object.keys(exact[m]).length;
      return { total: all.length, exact: exactCount, methods: Object.keys(byMethod) };
    }
  };
}

module.exports = { createRouteIndex, exactPathFromRe };
