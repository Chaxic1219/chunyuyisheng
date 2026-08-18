// 服务详情页
const { request } = require('../../utils/request');
const { fen2yuan } = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    loading: true,
    error: '',
    product: null
  },

  onLoad(query) {
    this.productKey = query.id || '';
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request({ path: `/api/mp/service-products/${encodeURIComponent(this.productKey)}`, auth: false })
      .then((product) => {
        this.setData({
          product: {
            ...product,
            serviceAmountLabel: fen2yuan(product.serviceAmountCents),
            goodsAmountLabel: fen2yuan(product.goodsAmountCents),
            totalAmountLabel: fen2yuan(product.totalAmountCents)
          }
        });
      })
      .catch((e) => this.setData({ error: e.message || '加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },

  onBuy() {
    const p = this.data.product;
    if (!p) return;
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login?redirect=/pages/detail/detail?id=' + encodeURIComponent(this.productKey) });
      return;
    }
    wx.navigateTo({
      url: `/pages/checkout/checkout?key=${encodeURIComponent(this.productKey)}&productId=${p.productId}&versionId=${p.versionId}`
    });
  }
});
