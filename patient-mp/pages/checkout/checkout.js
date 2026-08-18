// 结算页：填写收货信息 → 下单 → 跳支付收银台
const config = require('../../utils/config');
const { request } = require('../../utils/request');
const { fen2yuan } = require('../../utils/format');
const auth = require('../../utils/auth');

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    product: null,
    productKey: '',
    productId: 0,
    versionId: 0,
    form: {
      contactPhone: '',
      receiverName: '',
      receiverPhone: '',
      receiverAddress: ''
    },
    agreement: false,
    privacy: false
  },

  onLoad(query) {
    this.setData({
      productKey: query.key || '',
      productId: Number(query.productId || 0),
      versionId: Number(query.versionId || 0)
    });
    this.loadProduct();
  },

  loadProduct() {
    this.setData({ loading: true });
    return request({ path: `/api/mp/service-products/${encodeURIComponent(this.data.productKey)}`, auth: false })
      .then((product) => {
        this.setData({
          product: {
            ...product,
            totalAmountLabel: fen2yuan(product.totalAmountCents),
            serviceAmountLabel: fen2yuan(product.serviceAmountCents)
          }
        });
      })
      .catch((e) => this.setData({ error: e.message || '加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  toggleAgreement() {
    this.setData({ agreement: !this.data.agreement });
  },

  togglePrivacy() {
    this.setData({ privacy: !this.data.privacy });
  },

  async onSubmit() {
    const { product, productId, versionId, form, agreement, privacy } = this.data;
    if (!product) return;
    if (!agreement || !privacy) {
      wx.showToast({ title: '请先阅读并勾选协议', icon: 'none' });
      return;
    }
    if (!form.receiverName || !form.receiverPhone || !form.receiverAddress) {
      wx.showToast({ title: '请填写收件人、手机号和地址', icon: 'none' });
      return;
    }
    if (!/^1\d{10}$/.test(form.receiverPhone)) {
      wx.showToast({ title: '收件手机号格式不正确', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const { order } = await request({
        path: '/api/mp/orders',
        method: 'POST',
        data: {
          versionId,
          productId,
          serviceFor: 'self',
          contactPhone: form.contactPhone || form.receiverPhone,
          receiverName: form.receiverName,
          receiverPhone: form.receiverPhone,
          receiverAddress: form.receiverAddress,
          agreementAccepted: true,
          privacyAccepted: true,
          idempotencyKey: `mp-${versionId}-${Date.now()}`,
          sourceDoctorId: config.doctorId
        }
      });
      // 下单成功 → 进入支付收银台
      wx.redirectTo({ url: `/pages/pay/pay?orderId=${order.id}` });
    } catch (e) {
      wx.showToast({ title: e.message || '下单失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
