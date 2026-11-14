const fmt = require('./format');

function decorate(item) {
  const cancelled = item.activityStatus === 'CANCELLED';
  const status = cancelled ? 'CANCELLED' : item.status;
  return {
    activityId: item.activityId,
    title: item.title || '未命名活动',
    typeText: fmt.typeText(item.type),
    badgeClass: item.type === 'MINUTE' ? 'badge green' : 'badge',
    pointsText: fmt.pointsText(item.type, item.points),
    timeText: fmt.fmtRange(item.startsAt, item.endsAt),
    placeText: item.location || '地点待定',
    status: status,
    statusText: cancelled ? '活动已取消' : fmt.registrationStatusText(status),
    statusClass: fmt.registrationStatusClass(status),
    checkedInText: item.checkedInAt ? fmt.fmtDateTime(item.checkedInAt) : '',
    canCheckin: status === 'REGISTERED' && item.activityStatus === 'PUBLISHED',
    canCheckout: status === 'CHECKED_IN' && item.checkinMode === 'BOTH',
    checkoutHint: status === 'CHECKED_IN' && item.checkinMode === 'BOTH'
      ? '签退码在活动结束前后 5 分钟开放'
      : ''
  };
}

module.exports = { decorate };
