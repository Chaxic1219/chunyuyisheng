// 登录页：微信登录 + 绑定手机号
const config = require('../../utils/config');
const auth = require('../../utils/auth');

Page({
  data: {
    loading: false,
    step: 'login', // login → bind
    phone: '',
    smsCode: '',
    smsSending: false,
    smsSent: false,
    smsCountdown: 0,
    error: '',
    bindError: ''
  },

  onLoad(query) {
    // 支持从其他页面跳来后返回
    this.redirect = query.redirect || '/pages/services/services';
  },

  async onWechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const session = await auth.loginWithWechat(config.doctorId);
      if (session.phoneBound) {
        wx.switchTab({ url: this.redirect === '/pages/services/services' ? '/pages/services/services' : this.redirect });
        return;
      }
      this.setData({ step: 'bind' });
    } catch (e) {
      this.setData({ error: e.message || '登录失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 微信一键授权手机号（需小程序已认证；开发者工具可在"模拟器-接口模拟"中模拟）
  async onGetPhoneNumber(e) {
    if (!e.detail || !e.detail.code) {
      this.setData({ bindError: '未获得手机号授权（getPhoneNumber 需小程序认证后可用）' });
      return;
    }
    this.setData({ bindError: '' });
    wx.showLoading({ title: '绑定中…', mask: true });
    try {
      const session = await auth.bindPhoneByCode(e.detail.code, config.doctorId);
      if (session.phoneBound) {
        wx.showToast({ title: '绑定成功', icon: 'success' });
        setTimeout(() => {
          if (this.redirect && this.redirect !== '/pages/login/login') {
            wx.redirectTo({ url: this.redirect });
          } else {
            wx.switchTab({ url: '/pages/services/services' });
          }
        }, 600);
      }
    } catch (err) {
      this.setData({ bindError: err.message || '绑定失败' });
    } finally {
      wx.hideLoading();
    }
  },

  // ---- 短信验证码路径（备用；生产未配置短信通道时后端返回 sms_unavailable）----
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onSmsCodeInput(e) {
    this.setData({ smsCode: e.detail.value });
  },

  async onSendSms() {
    const phone = this.data.phone.trim();
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ bindError: '请输入正确的手机号' });
      return;
    }
    this.setData({ smsSending: true, bindError: '' });
    try {
      await auth.sendSms(phone);
      this.setData({ smsSent: true });
      this.startCountdown();
    } catch (e) {
      this.setData({ bindError: e.message === 'sms_unavailable' ? '短信通道未开通，请使用微信一键授权' : (e.message || '发送失败') });
    } finally {
      this.setData({ smsSending: false });
    }
  },

  async onBindBySms() {
    const phone = this.data.phone.trim();
    const code = this.data.smsCode.trim();
    if (!/^1\d{10}$/.test(phone) || !code) {
      this.setData({ bindError: '请填写手机号和验证码' });
      return;
    }
    wx.showLoading({ title: '绑定中…', mask: true });
    try {
      const session = await auth.bindPhoneBySms(phone, code, config.doctorId);
      if (session.phoneBound) {
        wx.showToast({ title: '绑定成功', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/services/services' }), 600);
      }
    } catch (e) {
      this.setData({ bindError: e.message || '绑定失败' });
    } finally {
      wx.hideLoading();
    }
  },

  startCountdown() {
    let n = 60;
    this.setData({ smsCountdown: n });
    this.timer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(this.timer);
        this.setData({ smsCountdown: 0, smsSent: false });
      } else {
        this.setData({ smsCountdown: n });
      }
    }, 1000);
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  }
});
