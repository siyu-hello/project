const api = require('../../utils/api');

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'REGISTERED', label: '已报名' },
  { value: 'CHECKED_IN', label: '已签到' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' }
];

const { decorate } = require('../../utils/registration');

Page({
  data: {
    filters: FILTERS,
    filterIndex: 0,
    items: [],
    visibleItems: [],
    error: '',
    loading: true
  },

  onShow() {
    wx.setNavigationBarTitle({ title: '我的报名' });
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
      const records = await api.get('/students/me/registrations');
      this.all = (records || []).map(decorate);
      this.setData({ loading: false });
      this.applyFilter();
    } catch (error) {
      this.setData({ error: error.message || '加载失败', loading: false });
    }
  },

  applyFilter() {
    const value = FILTERS[this.data.filterIndex].value;
    const items = value ? (this.all || []).filter(function (item) { return item.status === value; }) : (this.all || []);
    this.setData({ items, visibleItems: items.slice(0, 10) });
  },

  showMore() { this.setData({ visibleItems: this.data.items.slice(0, this.data.visibleItems.length + 10) }); },

  pickFilter(e) {
    this.setData({ filterIndex: Number(e.currentTarget.dataset.index) });
    this.applyFilter();
  },

  openActivity(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id });
  },

  openCheckin(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id + '&action=checkin' });
  },

  openCheckout(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id + '&action=checkout' });
  },

  refresh() { this.load(); }
});