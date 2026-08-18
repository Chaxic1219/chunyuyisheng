"use strict";

/** 创建 { route, routes } —— 与 server.js 历史口径一致 */
function createRouter(){
  const routes = [];
  function route(method, re, fn){
    routes.push({ method, re, fn });
  }
  return { route, routes };
}

module.exports = { createRouter };
