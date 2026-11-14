const { request } = require('../../utils/api');

const WEB_ADMIN_TIP = '发布者与管理员请使用网页管理后台登录，小程序仅提供学生参与与核销员核销入口。';

function wxCode() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new Error('微信登录未返回 code，请重试'));
      },
      fail() { reject(new Error('微信登录失败，请重试')); }
    });
  });
}

Page({
  data: {
    mode: 'wechat',
    bindingOpen: false,
    identifier: '',
    password: '',
    accounts: [],
    error: '',
    notice: '',
    busy: false
  },

  onLoad() {
    this.navigating = false;
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '登录' });
    let token = '';
    try {
      token = wx.getStorageSync('session') || '';
    } catch (error) { token = ''; }
    if (token) this.resume();
  },

  // 已登录（2 小时内）时直接按角色落地，避免每次都要重新点击登录。
  resume() {
    request('/me')
      .then((account) => {
        const role = account && account.role;
        if (role === 'STUDENT') wx.reLaunch({ url: '/pages/catalog/index' });
        else if (role === 'REDEEMER') wx.reLaunch({ url: '/pages/redeem/index' });
        else if (role === 'PUBLISHER' || role === 'ADMIN') this.setData({ notice: WEB_ADMIN_TIP });
      })
      .catch(function () { return null; });
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, bindingOpen: false, password: '', accounts: [], error: '', notice: '' });
  },

  toggleBinding() {
    this.setData({ bindingOpen: !this.data.bindingOpen, password: '', accounts: [], error: '', notice: '' });
  },

  identifierInput(e) { this.setData({ identifier: e.detail.value }); },
  passwordInput(e) { this.setData({ password: e.detail.value }); },

  // 微信登录入口：
  // - dataset.bind：携带学号与初始密码完成首次绑定并登录
  // - dataset.id：从多身份列表中选择指定账号（每次都换新的 wx.login code）
  // - 都不传：直接尝试一键登录
  login(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const accountId = dataset.id || '';
    const binding = Boolean(dataset.bind);
    if (this.data.busy) return Promise.resolve();
    this.navigating = false;
    this.setData({ busy: true, error: '', notice: '' });

    return wxCode()
      .then((code) => {
        const payload = { code: code };
        if (accountId) payload.accountId = accountId;
        if (binding) {
          payload.identifier = this.data.identifier;
          payload.password = this.data.password;
        }
        return request('/auth/wechat/login', 'POST', payload);
      })
      .then((result) => this.finish(result))
      .catch((error) => {
        this.setData({
          error: (error && error.message) || '登录失败，请重试',
          notice: '',
          accounts: [],
          busy: false
        });
      });
  },

  // 学生账号密码登录（POST /auth/student/login），不依赖微信。
  passwordLogin() {
    const identifier = String(this.data.identifier || '').trim();
    const password = this.data.password;
    if (!identifier || !password) {
      this.setData({ error: '请输入学号或账号，以及密码', notice: '' });
      return Promise.resolve();
    }
    if (this.data.busy) return Promise.resolve();
    this.navigating = false;
    this.setData({ busy: true, error: '', notice: '' });
    return request('/auth/student/login', 'POST', { identifier: identifier, password: password })
      .then((result) => this.finish(result))
      .catch((error) => this.setData({ error: (error && error.message) || '登录失败，请重试', busy: false }));
  },

  chooseAccount(e) { return this.login(e); },

  finish(result) {
    if (!result) {
      this.setData({ error: '登录返回为空，请重试', busy: false });
      return;
    }
    if (result.selectAccount) {
      this.setData({
        bindingOpen: false,
        accounts: result.selectAccount,
        notice: '该微信绑定多个身份，请选择本次要使用的账号。',
        busy: false
      });
      return;
    }
    const account = result.account || {};
    // 只持久化 token；账号信息留在内存，避免把敏感信息写进缓存。
    wx.setStorageSync('session', result.token);
    this.setData({ password: '', busy: false });

    if (account.role === 'REDEEMER') {
      this.navigating = true;
      wx.reLaunch({ url: '/pages/redeem/index' });
      return;
    }
    if (account.role === 'STUDENT' || !account.role) {
      this.navigating = true;
      wx.reLaunch({ url: '/pages/catalog/index' });
      return;
    }
    // 发布者 / 管理员在小程序没有入口，保留提示并清除选择列表。
    this.setData({ accounts: [], notice: WEB_ADMIN_TIP });
  }
});