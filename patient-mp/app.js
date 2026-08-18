// 医患通 · 患者端小程序（支付链路演示版）
const auth = require('./utils/auth');

App({
  globalData: {
    // 后端正式域名（nginx 已反代 3200）。开发阶段请勾选"不校验合法域名"
    apiBase: 'https://yht.chunyutianxia.com',
    doctorId: 5 // 王云程医生（商品所属医生）
  },

  onLaunch() {
    const info = auth.getSession();
    if (info && info.mpToken && info.phoneBound) {
      auth.refreshMe().catch(() => {});
    }
  }
});
