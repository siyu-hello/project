const api = require('../../utils/api');
const fmt = require('../../utils/format');

const { parseCode } = require('../../utils/gift-qr');

Page({
  data: {
    account: null,
    code: '',
    result: null,
    error: '',
    notice: '',
    busy: false
  },

  onShow() {
    wx.setNavigationBarTitle({ title: '核销兑换码' });
    this.loadMe();
  },

  async loadMe() {
    try {
      const me = await api.get('/me');
      this.setData({ account: me });
      if (me.role !== 'REDEEMER' && me.role !== 'ADMIN') {
        this.setData({ notice: '当前账号没有核销权限，请使用核销员账号登录。' });
      }
    } catch (error) {
      this.setData({ error: error.message || '获取账号信息失败' });
    }
  },

  codeInput(e) { this.setData({ code: (e.detail.value || '').toUpperCase() }); },

  scan() {
    if (this.data.busy) return;
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        const code = parseCode(res.result);
        if (!code) {
          this.setData({ error: '未识别到 12 位兑换码，请手动输入', result: null });
          return;
        }
        this.submitCode(code);
      },
      fail: () => this.setData({ error: '扫码已取消，也可以手动输入兑换码', result: null })
    });
  },

  submitInput() {
    const code = parseCode(this.data.code);
    if (!code) {
      this.setData({ error: '兑换码为 12 位数字或字母，请核对后重试', result: null });
      return;
    }
    this.submitCode(code);
  },

  submitCode(code) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', result: null });
    api.post('/redeemer/redeem', { code: code })
      .then((order) => {
        this.setData({
          busy: false,
          code: '',
          result: {
            giftName: order.giftName || '礼品',
            pointsText: order.pointsCost + ' 积分',
            codeText: fmt.groupCode(order.code),
            code: order.code,
            redeemedText: fmt.fmtDateTime(order.redeemedAt)
          }
        });
        wx.showToast({ title: '核销成功', icon: 'success' });
      })
      .catch((error) => this.setData({ busy: false, error: error.message || '核销失败' }));
  },

  continueScan() { this.setData({ result: null, error: '' }); this.scan(); },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录，确定继续？',
      success(res) {
        if (!res.confirm) return;
        api.logout().then(function () { wx.reLaunch({ url: '/pages/login/index' }); });
      }
    });
  }
});