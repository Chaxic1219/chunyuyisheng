// 服务列表页
const { request } = require('../../utils/request');
const { fen2yuan } = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    loading: true,
    error: '',
    products: []
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login?redirect=/pages/services/services' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request({ path: '/api/mp/service-products', auth: false })
      .then((data) => {
        const products = (data.products || []).map((p) => ({
          ...p,
          amountLabel: fen2yuan(p.totalAmountCents)
        }));
        this.setData({ products });
      })
      .catch((e) => this.setData({ error: e.message || '加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },

  onProductTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(key)}` });
  }
});
