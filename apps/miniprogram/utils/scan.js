// 现场动态二维码：后台投屏内容形如 CAMPUS|CHECKIN|<activityId>|<6位码>，也兼容仅含 6 位码的二维码。
function scan() {
  return new Promise(function (resolve, reject) {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode'],
      success(res) { resolve(String((res && res.result) || '')); },
      fail(err) {
        const message = (err && err.errMsg) || '';
        reject(new Error(message.indexOf('cancel') >= 0 ? '已取消扫码' : '扫码失败，请重试或手动输入动态码'));
      }
    });
  });
}

function parse(text) {
  const raw = String(text || '').trim();
  const parts = raw.split('|');
  const last = (parts[parts.length - 1] || '').trim().toUpperCase();
  const code = /^[A-F0-9]{6}$/.test(last) ? last : (/^[A-F0-9]{6}$/.test(raw.toUpperCase()) ? raw.toUpperCase() : '');
  const kind = parts.length >= 2 ? parts[1].toUpperCase() : '';
  const activityId = parts.length >= 4 ? parts[2] : '';
  return { code: code, kind: kind, activityId: activityId, raw: raw };
}

module.exports = { scan, parse };