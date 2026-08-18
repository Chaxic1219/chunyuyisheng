// 登录态管理：wx.login → /api/mp/login → mpToken
const config = require('./config');
const { request } = require('./request');

const SESSION_KEY = 'mpSession';

function getSession() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null;
  } catch (e) {
    return null;
  }
}

function getToken() {
  const s = getSession();
  return s && s.mpToken ? s.mpToken : '';
}

function setSession(session) {
  wx.setStorageSync(SESSION_KEY, session || {});
}

function clearSession() {
  try {
    wx.removeStorageSync(SESSION_KEY);
  } catch (e) {
    /* ignore */
  }
}

function isLoggedIn() {
  const s = getSession();
  return !!(s && s.mpToken && s.phoneBound);
}

// wx.login → 后端 code2session → 返回 { mpToken, phoneBound, ... }
function loginWithWechat(doctorId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error('wx.login 未返回 code'));
          return;
        }
        request({
          path: '/api/mp/login',
          method: 'POST',
          data: { code: res.code, doctorId: doctorId || config.doctorId },
          auth: false
        })
          .then((session) => {
            setSession(session);
            resolve(session);
          })
          .catch(reject);
      },
      fail: (err) => reject(new Error(err.errMsg || '微信登录失败'))
    });
  });
}

// 微信一键授权手机号（button open-type="getPhoneNumber" 的 e.detail.code）
function bindPhoneByCode(phoneCode, doctorId) {
  const token = getToken();
  return request({
    path: '/api/mp/bind-phone',
    method: 'POST',
    data: { phoneCode, doctorId: doctorId || config.doctorId },
    auth: true
  }).then((session) => {
    setSession(session);
    return session;
  });
}

// 短信验证码路径（生产未配置 SMS_PROVIDER 时后端返回 sms_unavailable）
function sendSms(phone) {
  return request({
    path: '/api/sms/send',
    method: 'POST',
    data: { phone },
    auth: false
  });
}

function bindPhoneBySms(phone, smsCode, doctorId) {
  const token = getToken();
  return request({
    path: '/api/mp/bind-phone',
    method: 'POST',
    data: { phone, smsCode, doctorId: doctorId || config.doctorId },
    auth: true
  }).then((session) => {
    setSession(session);
    return session;
  });
}

// 刷新 /api/mp/me，回写最新会话
function refreshMe() {
  return request({ path: '/api/mp/me', auth: true })
    .then((me) => {
      const s = getSession();
      if (s && s.mpToken) setSession(Object.assign({}, s, me));
      return me;
    })
    .catch(() => null);
}

module.exports = {
  getSession,
  getToken,
  setSession,
  clearSession,
  isLoggedIn,
  loginWithWechat,
  bindPhoneByCode,
  bindPhoneBySms,
  sendSms,
  refreshMe
};
