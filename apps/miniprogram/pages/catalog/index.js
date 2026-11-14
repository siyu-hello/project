const api = require('../../utils/api');
const fmt = require('../../utils/format');

const TYPES = [
  { value: '', label: '全部活动' },
  { value: 'POINT', label: '积分活动' },
  { value: 'MINUTE', label: '志愿时长' }
];

function decorate(activity) {
  const start = fmt.toDate(activity.startsAt);
  const startMs = start ? start.getTime() : 0;
  const enrolled = Number(activity.enrolled || 0);
  const capacity = Number(activity.capacity || 0);
  const remaining = activity.remainingCapacity === undefined ? Math.max(0, capacity - enrolled) : activity.remainingCapacity;
  return {
    id: activity.id,
    title: activity.title || '未命名活动',
    dateKey: start ? fmt.fmtDate(start) : '',
    dateLabel: start ? (start.getMonth() + 1) + ' 月 ' + start.getDate() + ' 日 · 星期' + '日一二三四五六'[start.getDay()] : '日期待定',
    startMs: startMs,
    typeText: fmt.typeText(activity.type),
    tagClass: activity.type === 'MINUTE' ? 'badge green' : 'badge',
    timeText: fmt.fmtRange(activity.startsAt, activity.endsAt).replace(/^\d{2}-\d{2} /, '') || '时间待定',
    placeText: activity.location || '地点待定',
    full: remaining <= 0,
    capacityText: remaining > 0 ? '剩余 ' + remaining + ' / ' + capacity + ' 个名额' : '名额已满'
  };
}

function groupByDate(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.dateKey)) groups.set(item.dateKey, { key: item.dateKey, label: item.dateLabel, items: [] });
    groups.get(item.dateKey).items.push(item);
  }
  return Array.from(groups.values());
}

Page({
  data: {
    types: TYPES,
    typeIndex: 0,
    ascending: true,
    sortLabel: '时间正序',
    items: [],
    groups: [],
    error: '',
    loading: true
  },

  onShow() {
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '发现活动' });
    this.refreshTimer = setInterval(() => { if (!this.data.loading) this.load(true); }, 15000);
    return this.load();
  },

  onHide() { clearInterval(this.refreshTimer); },
  onUnload() { this.onHide(); },

  onPullDownRefresh() {
    this.load().then(function () { wx.stopPullDownRefresh(); });
  },

  async load(silent) {
    const requestId = this.requestId = (this.requestId || 0) + 1;
    const type = TYPES[this.data.typeIndex].value;
    if (silent !== true) this.setData({ loading: true, error: '' });
    try {
      const me = await api.get('/me');
      if (me.role === 'REDEEMER') { wx.reLaunch({ url: '/pages/redeem/index' }); return; }
      if (me.role !== 'STUDENT') {
        api.clearSession();
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      const list = await api.get('/activities' + (type ? '?type=' + type : ''));
      if (requestId !== this.requestId) return;
      const items = this.sort((list || []).map(decorate));
      this.setData({
        items,
        groups: groupByDate(items),
        error: '',
        loading: false
      });
    } catch (error) {
      if (requestId !== this.requestId || silent === true) return;
      this.setData({ error: error.message || '加载失败，请下拉重试', loading: false });
    }
  },

  sort(items) {
    const ascending = this.data.ascending;
    return items.slice().sort(function (a, b) {
      return ascending ? a.startMs - b.startMs : b.startMs - a.startMs;
    });
  },

  pickType(e) {
    if (this.data.loading) return;
    this.setData({ typeIndex: Number(e.currentTarget.dataset.index) });
    this.load();
  },

  toggleSort() {
    const ascending = !this.data.ascending;
    this.setData({ ascending: ascending, sortLabel: ascending ? '时间正序' : '时间倒序' });
    const items = this.sort(this.data.items);
    this.setData({ items, groups: groupByDate(items) });
  },

  openActivity(e) {
    wx.navigateTo({ url: '/pages/activity/index?id=' + e.currentTarget.dataset.id });
  },

  refresh() { this.load(); }
});