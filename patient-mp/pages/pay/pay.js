// 支付收银台页（核心）
// 双分支：
//   1. provider=wechat → wx.requestPayment 拉起真实微信支付收银台
//   2. provider=mock   → 展示仿真收银台，点击"确认支付"走 mock 完成
const { request } = require('../../utils/request');
const { fen2yuan } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    orderId: 0,
    order: null,
    payment: null,
    mockMode: false, // 当前是否为 mock 仿真收银台
    paying: false,
    amountLabel: ''
  },

  onLoad(query) {
    this.orderId = Number(query.orderId || 0);
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少订单号' });
      return;
    }
    this.initPay();
  },

  // 发起支付：后端返回 prepay（真实微信）或 mock 标记
  initPay() {
    this.setData({ loading: true, error: '' });
    return request({
      path: `/api/mp/orders/${this.orderId}/pay`,
      method: 'POST'
    })
      .then((data) => {
        const payment = data.payment || {};
        const order = data.order || {};
        this.setData({
          order,
          payment,
          orderId: this.orderId,
          amountLabel: fen2yuan(payment.amountCents != null ? payment.amountCents : order.totalAmountCents),
          loading: false
        });
        if (payment.provider === 'wechat') {
          // ---- 分支一：真实微信支付 ----
          this.requestWechatPayment(payment.prepay);
        } else {
          // ---- 分支二：mock 仿真收银台 ----
          this.setData({ mockMode: true });
        }
      })
      .catch((e) => {
        this.setData({ loading: false, error: e.message || '发起支付失败' });
      });
  },

  // 拉起微信支付收银台
  requestWechatPayment(prepay) {
    if (!prepay) {
      this.setData({ error: '缺少支付参数', loading: false });
      return;
    }
    wx.requestPayment({
      timeStamp: prepay.timeStamp,
      nonceStr: prepay.nonceStr,
      package: prepay.package,
      signType: prepay.signType || 'RSA',
      paySign: prepay.paySign,
      success: () => this.goResult('success'),
      fail: (err) => {
        // 用户取消或支付失败
        this.setData({
          error: err && err.errMsg && err.errMsg.indexOf('cancel') >= 0 ? '支付已取消' : (err.errMsg || '支付失败'),
          loading: false
        });
      }
    });
  },

  // mock 收银台：确认支付 → 调 mock-complete
  async onMockConfirm() {
    if (this.data.paying) return;
    this.setData({ paying: true });
    try {
      await request({
        path: `/api/mp/orders/${this.orderId}/pay/mock-complete`,
        method: 'POST'
      });
      this.goResult('success');
    } catch (e) {
      wx.showToast({ title: e.message || '支付失败', icon: 'none' });
      this.setData({ paying: false });
    }
  },

  // 取消/关闭收银台
  onMockCancel() {
    wx.showModal({
      title: '提示',
      content: '确定取消支付吗？',
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({ url: `/pages/result/result?orderId=${this.orderId}` });
        }
      }
    });
  },

  // 去支付结果页
  goResult() {
    wx.redirectTo({ url: `/pages/result/result?orderId=${this.orderId}` });
  },

  onRetry() {
    this.initPay();
  }
});
