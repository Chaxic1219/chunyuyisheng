/* Dialogue Agent — 开关与对外 API */
const { agentEnabled, agentDryRun } = require("./flags.js");
const runtime = require("./runtime.js");

async function runTurn(input){
  return runtime.runTurn(input || {});
}

module.exports = {
  agentEnabled,
  agentDryRun,
  runTurn
};
