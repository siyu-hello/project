const api = require('../../utils/api');
const fmt = require('../../utils/format');
const { parseCode, drawCode } = require('../../utils/gift-qr');

function decorate(order) {
  const reserved = order.status === 'RESERVED';
  return {
    id: order.id,
    giftName: order.giftName || '礼品',
    imageUrl: api.assetUrl(order.giftImage),
    pointsCost: order.pointsCost,
    pointsText: order.pointsCost + ' 积分',
    code: order.code,
    canShowQr: reserved && Date.parse(order.expiresAt) > Date.now() && Boolean(parseCode(order.code)),
    codeText: fmt.groupCode(order.code),
    status: order.status,
    statusText: fmt.orderStatusText(order.status),
    statusClass: fmt.orderStatusClass(order.status),
    createdText: fmt.fmtDateTime(order.createdAt),
    expiresAt: order.expiresAt,
    expiresText: fmt.fmtDateTime(order.expiresAt),
    redeemedText: order.redeemedAt ? fmt.fmtDateTime(order.redeemedAt) : '',
    countdown: reserved ? fmt.countdownText(order.expiresAt) : '',
    tipText: reserved ? '请在到期前到文创点出示兑换码' : (order.status === 'EXPIRED' ? '已过期，积分已退回' : '已核销')
  };
}

Page({
  data: {
    items: [],
    qrOrder: null,
    loading: true,
    error: ''
  },

  onLoad(query) { this.requestedOrderId = query && query.orderId; },

  onShow() {
    wx.setNavigationBarTitle({ title: '我的订单' });
    this.load();
    this.startTimer();
  },

  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const list = await api.get('/students/me/orders');
      const items = (list || []).map(decorate);
      this.setData({ items, loading: false, error: '' });
      const orderId = this.requestedOrderId || this.data.qrOrder?.id;
      this.requestedOrderId = '';
      if (orderId) this.showQr(orderId);
    } catch (error) {
      this.setData({ error: error.message || '加载失败', loading: false });
    }
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.data.qrOrder) this.load(true);
      const items = (this.data.items || []).map(function (item) {
        if (item.status !== 'RESERVED') return item;
        return Object.assign({}, item, { countdown: fmt.countdownText(item.expiresAt), canShowQr: item.canShowQr && Date.parse(item.expiresAt) > Date.now() });
      });
      this.setData({ items: items });
    }, 30000);
  },

  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  openQr(e) { this.showQr(e.currentTarget.dataset.id); },

  showQr(id) {
    const order = this.data.items.find(item => item.id === id);
    if (!order || order.status !== 'RESERVED' || Date.parse(order.expiresAt) <= Date.now() || !parseCode(order.code)) {
      this.closeQr();
      return;
    }
    this.setData({ qrOrder: order }, () => drawCode(wx.createCanvasContext('giftQr', this), order.code, 240));
  },

  closeQr() { this.setData({ qrOrder: null }); },

  copyCode(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success() { wx.showToast({ title: '兑换码已复制', icon: 'none' }); }
    });
  },

  refresh() { this.load(); }
});