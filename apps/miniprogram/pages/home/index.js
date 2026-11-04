const { request } = require('../../utils/api');
Page({
  data: { account: null, summary: null, activities: [], error: '' },
  async onShow() {
    this.setData({ account: null, summary: null, activities: [], error: '' });
    try {
      const account = await request('/me');
      if (account.role === 'STUDENT') {
        const home = await request('/students/me/home');
        this.setData({ account: home.account, summary: home.summary, activities: home.activities });
      } else this.setData({ account });
    } catch (error) { this.setData({ error: error.message }); }
  },
  async logout() { try { await request('/auth/logout', 'POST'); } finally { wx.removeStorageSync('session'); wx.reLaunch({ url: '/pages/login/index' }); } }
});
