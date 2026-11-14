const api = require('../../utils/api');

const REQUEST_KEY = 'redeemRequests';

function readRequests() {
  const map = wx.getStorageSync(REQUEST_KEY);
  return map && typeof map === 'object' ? map : {};
}

function writeRequests(map) { wx.setStorageSync(REQUEST_KEY, map); }

// 每个礼品本次兑换的请求号：首次点击生成，失败重试沿用同一个，保证不重复扣分。
function requestIdFor(giftId) {
  const map = readRequests();
  if (!map[giftId]) {
    map[giftId] = 'mp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    writeRequests(map);
  }
  return map[giftId];
}

function clearRequest(giftId) {
  const map = readRequests();
  if (map[giftId]) {
    delete map[giftId];
    writeRequests(map);
  }
}

Page({
  data: {
    items: [],
    balance: 0,
    error: '',
    notice: '',
    loading: true,
    busy: ''
  },

  onShow() {
    wx.setNavigationBarTitle({ title: '文创商城' });
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
      const results = await Promise.all([api.get('/gifts'), api.get('/students/me/home')]);
      const summary = results[1] && results[1].summary ? results[1].summary : {};
      const balance = Number(summary.availablePoints || 0);
      const items = (results[0] || []).map(function (gift) {
        return {
          id: gift.id,
          name: gift.name,
          description: gift.description || '暂无说明',
          imageUrl: api.assetUrl(gift.imageUrl),
          points: gift.points,
          pointsText: gift.points + ' 积分',
          stockText: gift.soldOut ? '已兑完' : '仅剩 ' + gift.stock + ' 件',
          soldOut: Boolean(gift.soldOut),
          canRedeem: !gift.soldOut && balance >= gift.points,
          tip: gift.soldOut ? '已兑完，等待补货' : (balance < gift.points ? '还差 ' + (gift.points - balance) + ' 积分' : '可兑换')
        };
      });
      this.setData({ items: items, balance: balance, loading: false });
    } catch (error) {
      this.setData({ error: error.message || '加载失败', loading: false });
    }
  },

  redeem(e) {
    const id = e.currentTarget.dataset.id;
    const gift = (this.data.items || []).filter(function (item) { return item.id === id; })[0];
    if (!gift) return;
    if (this.data.busy) return;
    if (gift.soldOut) { wx.showToast({ title: '该礼品已兑完', icon: 'none' }); return; }
    if (!gift.canRedeem) {
      wx.showToast({ title: '积分不足，还差 ' + (gift.points - this.data.balance) + ' 分', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认兑换',
      content: '使用 ' + gift.points + ' 积分兑换「' + gift.name + '」？兑换后请在 7 天内到文创点核销。',
      confirmText: '确认兑换',
      success: (res) => { if (res.confirm) this.doRedeem(gift); }
    });
  },

  doRedeem(gift) {
    const requestId = requestIdFor(gift.id);
    this.setData({ busy: gift.id, error: '', notice: '' });
    api.post('/gifts/' + gift.id + '/redeem', { requestId: requestId })
      .then((result) => {
        clearRequest(gift.id);
        const order = result && result.order ? result.order : {};
        this.setData({ busy: '' });
        wx.navigateTo({ url: '/pages/orders/index?orderId=' + encodeURIComponent(order.id) });
        this.load();
      })
      .catch((error) => {
        this.setData({
          error: (error.message || '兑换失败') + '（再次点击兑换会沿用同一请求号，不会重复扣积分）',
          busy: ''
        });
      });
  },

  imageError(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ ['items[' + index + '].imageUrl']: '' });
  },

  openOrders() { wx.navigateTo({ url: '/pages/orders/index' }); },
  refresh() { this.load(); }
});