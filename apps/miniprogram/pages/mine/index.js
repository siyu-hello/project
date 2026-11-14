const api = require('../../utils/api');
const fmt = require('../../utils/format');

const { decorate } = require('../../utils/registration');

Page({
  data: {
    account: null,
    points: 0,
    minutes: 0,
    registrationCount: 0,
    items: [],
    banText: '',
    error: '',
    loading: true
  },

  onShow() {
    wx.setNavigationBarTitle({ title: '我的' });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(function () { wx.stopPullDownRefresh(); });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const me = await api.get('/me');
      if (me.role === 'REDEEMER') { wx.reLaunch({ url: '/pages/redeem/index' }); return; }
      if (me.role !== 'STUDENT') {
        wx.showToast({ title: '请使用网页管理后台', icon: 'none' });
        api.clearSession();
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      const results = await Promise.all([api.get('/students/me/home'), api.get('/students/me/registrations')]);
      const summary = results[0] && results[0].summary ? results[0].summary : {};
      const records = results[1] || [];
      this.setData({
        account: me,
        registrationCount: records.length,
        items: records.slice(0, 2).map(decorate),
        points: Number(summary.availablePoints || 0),
        minutes: Number(summary.volunteerMinutes || 0),
        banText: fmt.banNotice(me),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message || '加载失败', loading: false });
    }
  },

  openRegistrations() { wx.navigateTo({ url: '/pages/registrations/index' }); },

  openActivity(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id });
  },

  openCheckin(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id + '&action=checkin' });
  },

  openCheckout(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id + '&action=checkout' });
  },

  openLedger() { wx.navigateTo({ url: '/pages/ledger/index' }); },
  openOrders() { wx.navigateTo({ url: '/pages/orders/index' }); },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号？',
      success: (res) => { if (res.confirm) { api.logout().then(function () { wx.reLaunch({ url: '/pages/login/index' }); }); } }
    });
  },

  refresh() { this.load(); }
});