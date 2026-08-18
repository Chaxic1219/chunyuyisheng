// wx.request Promise 封装：自动附加 Bearer token，统一错误处理
const config = require('./config');
const auth = require('./auth');

function request(options) {
  const { path, method = 'GET', data = {}, auth: needAuth = true } = options;
  const header = { 'Content-Type': 'application/json' };
  if (needAuth) {
    const token = auth.getToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBase}${path}`,
      method,
      data,
      header,
      timeout: 15000,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 400 || body.error) {
          const err = new Error(body.error || `请求失败(${res.statusCode})`);
          err.code = body.error || String(res.statusCode);
          err.statusCode = res.statusCode;
          if (res.statusCode === 401) {
            auth.clearSession();
            wx.redirectTo({ url: '/pages/login/login' });
          }
          reject(err);
          return;
        }
        // 后端统一包一层 { data }，login 等接口直接返回对象
        resolve(body.data != null ? body.data : body);
      },
      fail(err) {
        const e = new Error(err.errMsg || '网络错误，请检查域名配置');
        e.code = 'network_error';
        reject(e);
      }
    });
  });
}

module.exports = { request };
