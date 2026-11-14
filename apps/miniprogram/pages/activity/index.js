const api = require('../../utils/api');
const fmt = require('../../utils/format');
const scanner = require('../../utils/scan');

const WINDOW_MS = 5 * 60 * 1000;
const CODE_RE = /^[A-F0-9]{6}$/;

function minuteText(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes >= 60) return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分钟';
  return minutes + ' 分钟';
}

Page({
  data: {
    id: '',
    view: null,
    banText: '',
    error: '',
    actionError: '',
    actionNote: '',
    checkinHint: '',
    checkinWindowText: '',
    checkoutWindowText: '',
    loading: true,
    busy: '',
    code: '',
    checkoutCode: '',
    checkinOpen: false,
    checkoutOpen: false,
    canRegister: false,
    canCancel: false,
    canCheckin: false,
    canCheckout: false
  },

  onLoad(query) {
    this.activityId = (query && query.id) || '';
    this.autoAction = (query && query.action) || '';
    wx.setNavigationBarTitle({ title: '活动详情' });
    this.setData({ id: this.activityId });
  },

  onShow() {
    this.load();
    this.windowTimer = setInterval(() => {
      if (this.activityState) this.render(...this.activityState);
    }, 1000);
  },
  onHide() { clearInterval(this.windowTimer); },
  onUnload() { this.onHide(); },

  onPullDownRefresh() {
    this.load().then(function () { wx.stopPullDownRefresh(); });
  },

  async load(silent) {
    if (!this.activityId) {
      this.setData({ error: '缺少活动编号，请从活动列表进入', loading: false });
      return;
    }
    this.activityState = null;
    if (!silent) this.setData({ loading: true, error: '', view: null });
    try {
      const me = await api.get('/me');
      if (me.role === 'REDEEMER') { wx.reLaunch({ url: '/pages/redeem/index' }); return; }
      if (me.role !== 'STUDENT') {
        this.setData({ error: '小程序仅面向学生查看活动，发布者与管理员请使用网页管理后台', loading: false });
        return;
      }
      const results = await Promise.all([
        api.get('/activities/' + this.activityId),
        api.get('/students/me/registrations?_=' + Date.now())
      ]);
      const detail = results[0];
      const registration = (results[1] || []).find(item => String(item.activityId) === String(detail.id || this.activityId));
      this.serverOffset = Number.isFinite(detail.serverTime) ? detail.serverTime - Date.now() : 0;
      this.activityState = [detail, registration || null, me];
      this.render(...this.activityState);
    } catch (error) {
      if (silent) this.setData({ actionError: error.message || '操作后刷新失败，请手动刷新' });
      else this.setData({ error: error.message || '加载失败', loading: false });
    }
  },

  render(activity, registration, me) {
    const now = Date.now() + (this.serverOffset || 0);
    const start = fmt.toDate(activity.startsAt);
    const end = fmt.toDate(activity.endsAt);
    const startMs = start ? start.getTime() : 0;
    const endMs = end ? end.getTime() : 0;
    const banned = Boolean(fmt.banNotice(me));
    const published = activity.status === 'PUBLISHED';
    const status = registration ? registration.status : '';
    const active = status === 'REGISTERED' || status === 'CHECKED_IN' || status === 'COMPLETED';
    const checkinWindow = now >= startMs - WINDOW_MS && now <= startMs + WINDOW_MS;
    const checkoutWindow = now >= endMs - WINDOW_MS && now <= endMs + WINDOW_MS;

    const view = {
      title: activity.title || '未命名活动',
      cancelled: activity.status === 'CANCELLED',
      cancelReason: activity.cancelReason || '',
      typeText: fmt.typeText(activity.type),
      badgeClass: activity.type === 'MINUTE' ? 'badge green' : 'badge',
      pointsText: fmt.pointsText(activity.type, activity.points),
      timeText: fmt.fmtDateTime(activity.startsAt) + ' 至 ' + fmt.fmtDateTime(activity.endsAt),
      placeText: activity.location || '地点待定',
      targetText: (activity.college || '—') + ' · ' + (activity.grade || '—') + ' 级',
      capacityText: activity.remainingCapacity > 0
        ? '剩余 ' + activity.remainingCapacity + ' / 共 ' + activity.capacity + ' 个名额'
        : '名额已满（共 ' + activity.capacity + ' 个）',
      full: activity.remainingCapacity <= 0,
      description: activity.description || '',
      checkinText: fmt.checkinText(activity.type, activity.checkinMode),
      statusText: status ? fmt.registrationStatusText(status) : '',
      statusClass: status ? fmt.registrationStatusClass(status) : '',
      registeredAtText: registration && registration.registeredAt ? fmt.fmtDateTime(registration.registeredAt) : '',
      checkedInText: registration && registration.checkedInAt ? fmt.fmtDateTime(registration.checkedInAt) : '',
      checkedOutText: registration && registration.checkedOutAt ? fmt.fmtDateTime(registration.checkedOutAt) : ''
    };

    let checkinWindowText = '';
    if (now < startMs - WINDOW_MS) checkinWindowText = '签到窗口将在 ' + fmt.fmtDateTime(startMs - WINDOW_MS) + ' 开放（还差 ' + minuteText(startMs - WINDOW_MS - now) + '）';
    else if (now <= startMs + WINDOW_MS) checkinWindowText = '签到窗口开放中，剩余 ' + minuteText(startMs + WINDOW_MS - now);
    else checkinWindowText = '签到窗口已于 ' + fmt.fmtDateTime(startMs + WINDOW_MS) + ' 关闭';

    let checkoutWindowText = '';
    if (now < endMs - WINDOW_MS) checkoutWindowText = '签退码将在 ' + fmt.fmtDateTime(endMs - WINDOW_MS) + ' 开放（还差 ' + minuteText(endMs - WINDOW_MS - now) + '）';
    else if (now <= endMs + WINDOW_MS) checkoutWindowText = '签退窗口开放中，剩余 ' + minuteText(endMs + WINDOW_MS - now);
    else checkoutWindowText = '签退窗口已于 ' + fmt.fmtDateTime(endMs + WINDOW_MS) + ' 关闭';

    let hint = '尚未报名，报名成功即占用一个名额。';
    if (activity.status === 'CANCELLED') {
      hint = '活动已取消。';
    } else if (status === 'REGISTERED') {
      hint = checkinWindow ? '请在现场扫描动态二维码完成签到。' : '活动开始前后 5 分钟内开放扫码签到。';
    } else if (status === 'CHECKED_IN') {
      hint = '已签到。请在活动结束前后 5 分钟内扫描现场签退码。';
    } else if (status === 'COMPLETED') {
      hint = activity.type === 'MINUTE' ? '已完成，志愿时长已按实际时长入账。' : '已完成，积分已入账。';
    } else if (status === 'CANCELLED') {
      hint = '你已取消报名，名额已释放，开始前可重新报名。';
    }

    this.setData({
      view: view,
      checkinHint: hint,
      checkinWindowText: checkinWindowText,
      checkoutWindowText: checkoutWindowText,
      attendanceWindowText: status === 'CHECKED_IN' && activity.checkinMode === 'BOTH' ? checkoutWindowText : status === 'REGISTERED' ? checkinWindowText : '',
      banText: fmt.banNotice(me),
      canRegister: activity.status === 'PUBLISHED' && !active && activity.remainingCapacity > 0 && now < startMs && !banned,
      canCancel: published && status === 'REGISTERED' && now < startMs,
      canCheckin: status === 'REGISTERED' && checkinWindow && activity.status === 'PUBLISHED',
      canCheckout: published && status === 'CHECKED_IN' && activity.checkinMode === 'BOTH' && checkoutWindow,
      loading: false
    });
    if (this.autoAction) {
      const action = this.autoAction;
      this.autoAction = '';
      if (action === 'checkin' && this.data.canCheckin) this.scanCheckin();
      if (action === 'checkout' && this.data.canCheckout) this.scanCheckout();
    }
  },

  register() {
    if (this.data.busy) return;
    this.setData({ busy: 'register', actionError: '', actionNote: '' });
    api.post('/activities/' + this.activityId + '/registrations')
      .then((result) => {
        this.setData({ actionNote: result && result.status === 'REGISTERED' ? '报名成功，名额已为你保留，请按时到场扫码签到。' : '报名成功。' });
        wx.showToast({ title: '报名成功', icon: 'success' });
        return this.load(true);
      })
      .catch(async (error) => {
        if (error.status === 409 && error.message === '已报名') {
          await this.load(true);
          if (this.activityState?.[1]?.status) {
            this.setData({ actionNote: '报名状态已更新。' });
            return;
          }
          this.setData({ canRegister: false, actionError: '服务器已有报名记录，请下拉刷新后查看签到入口。' });
          return;
        }
        this.setData({ actionError: error.message || '报名失败' });
      })
      .then(() => this.setData({ busy: '' }));
  },

  cancel() {
    wx.showModal({
      title: '取消报名',
      content: '取消后名额立即释放，开始前可重新报名。确定取消？',
      success: (res) => { if (res.confirm) this.doCancel(); }
    });
  },

  doCancel() {
    if (this.data.busy) return;
    this.setData({ busy: 'cancel', actionError: '', actionNote: '' });
    api.del('/activities/' + this.activityId + '/registrations')
      .then(() => {
        this.setData({ actionNote: '已取消报名，名额已释放。' });
        wx.showToast({ title: '已取消报名', icon: 'success' });
        return this.load(true);
      })
      .catch((error) => this.setData({ actionError: error.message || '取消失败' }))
      .then(() => this.setData({ busy: '' }));
  },

  toggleCheckinInput() { this.setData({ checkinOpen: !this.data.checkinOpen, actionError: '' }); },
  toggleCheckoutInput() { this.setData({ checkoutOpen: !this.data.checkoutOpen, actionError: '' }); },
  codeInput(e) { this.setData({ code: (e.detail.value || '').toUpperCase() }); },
  checkoutCodeInput(e) { this.setData({ checkoutCode: (e.detail.value || '').toUpperCase() }); },

  submitCheckinCode() {
    const code = (this.data.code || '').replace(/\s/g, '').toUpperCase();
    if (!CODE_RE.test(code)) {
      this.setData({ actionError: '动态码为 6 位字母或数字，请扫描现场二维码或向工作人员确认' });
      return;
    }
    this.doCheckin(code);
  },

  submitCheckoutCode() {
    const code = (this.data.checkoutCode || '').replace(/\s/g, '').toUpperCase();
    if (!CODE_RE.test(code)) {
      this.setData({ actionError: '动态码为 6 位字母或数字，请扫描现场签退二维码' });
      return;
    }
    this.doCheckout(code);
  },

  async scanFor(kind) {
    if (this.data.busy) return;
    this.setData({ actionError: '', actionNote: '' });
    try {
      const text = await scanner.scan();
      const parsed = scanner.parse(text);
      if (!parsed.code) throw new Error('未识别到 6 位动态码，请对准现场投屏二维码');
      if (parsed.activityId && parsed.activityId !== this.activityId) throw new Error('该二维码不属于当前活动');
      if (parsed.kind && parsed.kind !== (kind === 'checkin' ? 'CHECKIN' : 'CHECKOUT')) {
        throw new Error(parsed.kind === 'CHECKIN' ? '这是签到二维码，请扫描现场签退码' : '这是签退二维码，请扫描现场签到码');
      }
      if (kind === 'checkin') this.doCheckin(parsed.code);
      else this.doCheckout(parsed.code);
    } catch (error) {
      this.setData({ actionError: error.message || '扫码失败' });
    }
  },

  scanCheckin() { this.scanFor('checkin'); },
  scanCheckout() { this.scanFor('checkout'); },

  doCheckin(code) {
    if (this.data.busy) return;
    this.setData({ busy: 'checkin', actionError: '', actionNote: '' });
    api.post('/activities/' + this.activityId + '/checkin', { code: code })
      .then((result) => {
        const credited = result && result.credited;
        let note = '签到成功。';
        if (credited) {
          note = credited.unit === 'MINUTE'
            ? '签到成功，' + credited.amount + ' 分钟已入账。'
            : '签到成功，' + credited.amount + ' 积分已入账。';
        }
        this.setData({ actionNote: note, code: '', checkinOpen: false });
        wx.showToast({ title: '签到成功', icon: 'success' });
        return this.load(true);
      })
      .catch((error) => this.setData({ actionError: error.message || '签到失败' }))
      .then(() => this.setData({ busy: '' }));
  },

  doCheckout(code) {
    if (this.data.busy) return;
    this.setData({ busy: 'checkout', actionError: '', actionNote: '' });
    api.post('/activities/' + this.activityId + '/checkout', { code: code })
      .then((result) => {
        const credited = result && result.credited;
        this.setData({ actionNote: '签退成功' + (credited ? '，' + credited.amount + (credited.unit === 'MINUTE' ? ' 分钟已入账' : ' 积分已入账') : '') + '。', checkoutCode: '', checkoutOpen: false });
        wx.showToast({ title: '签退成功', icon: 'success' });
        return this.load(true);
      })
      .catch((error) => this.setData({ actionError: error.message || '签退失败' }))
      .then(() => this.setData({ busy: '' }));
  },

  retry() { this.load(); }
});