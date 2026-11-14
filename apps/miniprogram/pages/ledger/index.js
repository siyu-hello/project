const api = require('../../utils/api');
const fmt = require('../../utils/format');

function decorate(entry) {
  const amount = Number(entry.amount);
  return {
    id: entry.id,
    kindText: fmt.ledgerKindText(entry.kind),
    kindClass: entry.kind === 'REDEEM' ? 'badge orange' : (entry.kind === 'REFUND' ? 'badge green' : 'badge'),
    amountText: (amount > 0 ? '+' : '') + amount,
    amountClass: amount >= 0 ? 'amount positive' : 'amount negative',
    unitText: fmt.unitText(entry.unit),
    title: fmt.ledgerTitle(entry),
    ruleText: fmt.ledgerRuleText(entry),
    timeText: fmt.fmtDateTime(entry.occurredAt)
  };
}

Page({
  data: {
    summary: null,
    items: [],
    page: 1,
    total: 0,
    hasMore: false,
    loading: true,
    more: false,
    error: ''
  },

  onShow() {
    wx.setNavigationBarTitle({ title: '积分与时长明细' });
    this.load(1);
  },

  async load(page) {
    const first = page === 1;
    this.setData({ loading: first, error: '', more: !first });
    try {
      const data = await api.get('/students/me/ledger?page=' + page);
      const fresh = (data.items || []).map(decorate);
      const items = first ? fresh : this.data.items.concat(fresh);
      this.setData({
        summary: data.summary || null,
        items: items,
        page: data.page || page,
        total: data.total || items.length,
        hasMore: items.length < (data.total || 0),
        loading: false,
        more: false
      });
    } catch (error) {
      this.setData({ error: error.message || '加载失败', loading: false, more: false });
    }
  },

  loadMore() {
    if (!this.data.hasMore || this.data.more) return;
    this.load(this.data.page + 1);
  },

  refresh() { this.load(1); }
});