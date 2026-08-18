"use strict";

/**
 * 社群公开入站回调（模块化试点）。
 * @param {Function} route
 * @param {object} ctx
 */
function registerCommunityPublicRoutes(route, ctx){
  const { parseBody, json, community, authz, COMMUNITY_DEMO_TOKEN } = ctx;

  route("POST", /^\/api\/community\/inbound$/, async (req, res)=>{
    if(!authz.communityInboundAuthorized(process.env.COMMUNITY_WEBHOOK_TOKEN, req.headers["x-community-token"], COMMUNITY_DEMO_TOKEN)){
      return json(res, 401, { error:"社群回调 token 不正确或未配置" });
    }
    const b = await parseBody(req);
    if(b.__oversize) return json(res, 413, { error:"请求体过大（上限 1MB）" });
    try{ json(res, 200, await community.handleInbound({ ...b, dataSource:"simulation" })); }
    catch(e){ json(res, 400, { error:e.message }); }
  });
}

module.exports = { registerCommunityPublicRoutes };
