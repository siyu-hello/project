const { request } = require('../../utils/api');
Page({
  data: { identifier: '', password: '', error: '', accounts: [], busy: false },
  identifierInput(e) { this.setData({ identifier: e.detail.value }); },
  passwordInput(e) { this.setData({ password: e.detail.value }); },
  async login(e) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error('微信登录失败')), fail: reject }));
      const binding = e.currentTarget.dataset.bind;
      const accountId = e.currentTarget.dataset.id;
      const result = await request('/auth/wechat/login', 'POST', { code, ...(binding ? { identifier: this.data.identifier, password: this.data.password } : {}), ...(accountId ? { accountId } : {}) });
      if (result.selectAccount) { this.setData({ accounts: result.selectAccount }); return; }
      wx.setStorageSync('session', result.token);
      this.setData({ password: '' });
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) { this.setData({ error: error.message || '微信登录失败，请重试' }); }
    finally { this.setData({ busy: false }); }
  }
});
