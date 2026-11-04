function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => wx.request({
    url: getApp().globalData.apiBase + path, method, data,
    header: { Authorization: 'Bearer ' + (wx.getStorageSync('session') || '') },
    success(res) {
      if (res.statusCode === 401 && path !== '/auth/wechat/login') { wx.removeStorageSync('session'); wx.reLaunch({ url: '/pages/login/index' }); }
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
      else reject(new Error((res.data.message || '请求失败') + (res.data.details && res.data.details.remainingSeconds ? '，剩余' + res.data.details.remainingSeconds + '秒' : '')));
    }, fail() { reject(new Error('网络连接失败，请重试')); }
  }));
}
module.exports = { request };
