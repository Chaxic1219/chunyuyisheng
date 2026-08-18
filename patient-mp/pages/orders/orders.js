// 我的服务（订单列表）
const { request } = require('../../utils/request');
const { fen2yuan, fmtDate, statusText } = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    loading: true,
    error: '',
    orders: []
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login?redirect=/pages/orders/orders' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request({ path: '/api/mp/orders', auth: true })
      .then((data) => {
        const orders = (data.orders || []).map((o) => ({
          ...o,
          amountLabel: fen2yuan(o.totalAmountCents),
          statusLabel: statusText(o.status),
          createdAtLabel: fmtDate(o.createdAt)
        }));
        this.setData({ orders });
      })
      .catch((e) => this.setData({ error: e.message || '加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/result/result?orderId=${id}` });
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/services' });
  }
});
