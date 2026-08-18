"use strict";

const { createRepo } = require("./repo.js");
const { generatePlanDraft } = require("./planGenerator.js");
const { getServiceCenter } = require("./servicesCatalog.js");
const feed = require("./feed.js");

function createMpV32(db, deps) {
  const repo = createRepo(db);
  return {
    repo,
    generatePlanDraft,
    getServiceCenter,
    buildHomeFeed: (ctx) => feed.buildHomeFeed({ ...ctx, repo }),
    buildMineAssets: (ctx) => feed.buildMineAssets({ ...ctx, repo }),
    buildRecordList: (ctx) => feed.buildRecordList({ ...ctx, repo }),
    buildPlanDetail: (ctx) => feed.buildPlanDetail({ ...ctx, repo }),
    buildFamilyData: (ctx) => feed.buildFamilyData({ ...ctx, repo }),
  };
}

module.exports = { createMpV32 };
