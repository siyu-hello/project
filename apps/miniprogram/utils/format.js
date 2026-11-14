// 展示层格式化：所有页面共用，保持中文文案与时间口径一致。
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) { return value < 10 ? '0' + value : '' + value; }

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value);
  const parsed = new Date(text.indexOf('T') >= 0 ? text : text.replace(' ', 'T'));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return fmtDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtShort(value) {
  const d = toDate(value);
  if (!d) return '';
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function sameDay(a, b) { return fmtDate(a) === fmtDate(b); }

function fmtRange(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return '';
  if (!e) return fmtShort(s);
  if (sameDay(s, e)) return fmtShort(s) + ' - ' + pad2(e.getHours()) + ':' + pad2(e.getMinutes());
  return fmtShort(s) + ' - ' + fmtShort(e);
}

function typeText(type) { return type === 'MINUTE' ? '志愿时长' : '积分'; }

function unitText(unit) { return unit === 'MINUTE' ? '分钟' : '积分'; }

function pointsText(type, points) {
  if (type === 'MINUTE') return '完成签退后按实际时长入账';
  return '完成可得 ' + (points === null || points === undefined ? 0 : points) + ' 积分';
}

function checkinText(type, mode) {
  if (type === 'MINUTE') return '现场扫码签到，活动结束后签退结算时长';
  if (mode === 'BOTH') return '现场扫码签到，需签退后完成';
  return '现场扫码签到，签到即完成';
}

function registrationStatusText(status) {
  const map = { REGISTERED: '已报名', CHECKED_IN: '已签到', COMPLETED: '已完成', CANCELLED: '已取消' };
  return map[status] || status || '';
}

function registrationStatusClass(status) {
  const map = { REGISTERED: 'badge', CHECKED_IN: 'badge orange', COMPLETED: 'badge green', CANCELLED: 'badge gray' };
  return map[status] || 'badge gray';
}

function orderStatusText(status) {
  const map = { RESERVED: '待核销', REDEEMED: '已核销', EXPIRED: '已过期' };
  return map[status] || status || '';
}

function orderStatusClass(status) {
  const map = { RESERVED: 'badge', REDEEMED: 'badge green', EXPIRED: 'badge gray' };
  return map[status] || 'badge gray';
}

function ledgerKindText(kind) {
  const map = { CREDIT: '入账', REDEEM: '兑换扣减', REFUND: '过期返还', ADJUST: '调整' };
  return map[kind] || kind || '';
}

function ledgerTitle(entry) {
  const snapshot = entry.ruleSnapshot || {};
  if (entry.kind === 'CREDIT') return snapshot.title || '活动入账';
  if (entry.kind === 'REDEEM') return snapshot.name || '兑换礼品';
  if (entry.kind === 'REFUND') return '订单过期返还';
  return '账户变动';
}

function ledgerRuleText(entry) {
  const snapshot = entry.ruleSnapshot || {};
  if (entry.kind === 'CREDIT') {
    if (snapshot.type === 'MINUTE') return '志愿活动 · ' + fmtRange(snapshot.startsAt, snapshot.endsAt);
    const points = snapshot.points === null || snapshot.points === undefined ? '' : ' · ' + snapshot.points + ' 分';
    return '活动时间 ' + fmtRange(snapshot.startsAt, snapshot.endsAt) + points;
  }
  if (entry.kind === 'REDEEM') return '兑换码下单扣减' + (snapshot.points ? ' · ' + snapshot.points + ' 积分' : '');
  if (entry.kind === 'REFUND') return '订单 7 天未核销，积分自动退回';
  return '';
}

function groupCode(code) {
  const text = String(code || '');
  const groups = text.match(/.{1,4}/g);
  return groups ? groups.join(' ') : '';
}

function countdownText(expiresAt) {
  const d = toDate(expiresAt);
  if (!d) return '';
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return '已超过核销期限';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return '还剩 ' + days + ' 天 ' + hours + ' 小时';
  if (hours > 0) return '还剩 ' + hours + ' 小时 ' + minutes + ' 分';
  return '还剩 ' + minutes + ' 分钟';
}

// 禁报提示：剩余天数 + 解除日期；若再旷一次会顺延，按 R-5 公式给出预计日期。
function banNotice(account) {
  if (!account || !account.bannedUntil) return '';
  const until = toDate(account.bannedUntil);
  if (!until || until.getTime() <= Date.now()) return '';
  const remainingDays = Math.max(1, Math.ceil((until.getTime() - Date.now()) / DAY_MS));
  const count = Number(account.noShowCount || 0);
  let text = '禁报期内：剩余 ' + remainingDays + ' 天，' + fmtDate(until) + ' 解除。';
  if (count + 1 >= 3) {
    const next = new Date(Date.now() + (7 + 3 * (count + 1 - 3)) * DAY_MS);
    text += '若再旷一次，解除时间顺延至 ' + fmtDate(next) + '。';
  }
  return text;
}

module.exports = {
  DAY_MS,
  toDate,
  fmtDate,
  fmtDateTime,
  fmtShort,
  fmtRange,
  typeText,
  unitText,
  pointsText,
  checkinText,
  registrationStatusText,
  registrationStatusClass,
  orderStatusText,
  orderStatusClass,
  ledgerKindText,
  ledgerTitle,
  ledgerRuleText,
  groupCode,
  countdownText,
  banNotice
};