// 支付结果页
const { request } = require('../../utils/request');
const { fen2yuan, statusText } = require('../../utils/format');

Page({
  data: {
    orderId: 0,
    loading: true,
    paid: false,
    orderStatus: '',
    statusText: '',
    amountLabel: '',
    hint: ''
  },

  onLoad(query) {
    this.orderId = Number(query.orderId || 0);
    if (this.orderId) this.refresh();
  },

  refresh() {
    if (!this.orderId) return;
    this.setData({ loading: true });
    return request({ path: `/api/mp/orders/${this.orderId}/payment-status` })
      .then((data) => {
        const paid = !!data.paid;
        let hint = '';
        if (data.orderStatus === 'paid_pending_profile') hint = '支付成功，请补充手术资料';
        else if (data.orderStatus === 'pending_review') hint = '资料已提交，等待运营审核';
        else if (data.orderStatus === 'active') hint = '服务已开通';
        else if (!paid) hint = '支付尚未完成，可返回收银台继续支付';
        else hint = '订单状态：' + statusText(data.orderStatus);
        this.setData({
          paid,
          orderStatus: data.orderStatus,
          statusText: statusText(data.orderStatus),
          amountLabel: fen2yuan(data.amountCents),
          hint,
          loading: false
        });
      })
      .catch((e) => {
        this.setData({ loading: false, hint: e.message || '查询失败' });
      });
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  goPay() {
    wx.redirectTo({ url: `/pages/pay/pay?orderId=${this.orderId}` });
  }
});
