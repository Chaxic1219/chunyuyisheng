// API 基础配置
const app = getApp();

module.exports = {
  get apiBase() {
    const app2 = getApp();
    return (app2 && app2.globalData && app2.globalData.apiBase) || 'https://yht.chunyutianxia.com';
  },
  get doctorId() {
    const app2 = getApp();
    return (app2 && app2.globalData && app2.globalData.doctorId) || 5;
  }
};
