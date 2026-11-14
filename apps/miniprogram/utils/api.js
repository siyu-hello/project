// 统一请求层：可配置的 API 地址、Bearer token、401 跳登录、以及 {message, details} 错误转中文提示。
// 注意：本文件必须保持零依赖（单元测试会在无 require 的沙箱中加载它）。
const DEFAULT_BASE = 'http://10.133.41.214:3000';
const TOKEN_KEY = 'session';

let redirecting = false;

function pad2(value) { return value < 10 ? '0' + value : '' + value; }

function moment(value) {
  if (!value) return '';
  const text = String(value);
  const date = value instanceof Date ? value : new Date(text.indexOf('T') >= 0 ? text : text.replace(' ', 'T'));
  if (isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function baseUrl() {
  try {
    const stored = wx.getStorageSync('apiBase');
    const environment = wx.getAccountInfoSync?.()?.miniProgram?.envVersion;
    if (stored && (!environment || environment === 'develop')) return stored;
  } catch (error) { /* 存储不可用时回退到 globalData */ }
  const app = typeof getApp === 'function' ? getApp() : null;
  const configured = app && app.globalData && app.globalData.apiBase;
  return configured || DEFAULT_BASE;
}

function setBaseUrl(value) {
  const clean = String(value || '').trim().replace(/\/+$/, '');
  if (!clean) { wx.removeStorageSync('apiBase'); return ''; }
  wx.setStorageSync('apiBase', clean);
  return clean;
}

// 图片等静态资源：站内相对地址拼上当前 API 地址，外链原样返回。
function assetUrl(path) {
  const value = String(path || '');
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.indexOf('data:') === 0) return value;
  return baseUrl() + (value.charAt(0) === '/' ? value : '/' + value);
}

function getToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || ''; } catch (error) { return ''; }
}

// 把接口 details 拼成可读的中文补充说明：禁报天数、冲突活动、积分缺口、首次核销时间等。
function describeDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const parts = [];
  if (details.remainingDays !== undefined) {
    let text = '禁报剩余 ' + details.remainingDays + ' 天';
    if (details.bannedUntil) text += '，' + moment(details.bannedUntil) + ' 解除';
    parts.push(text);
  }
  if (details.nextBanUntil) parts.push('再旷一次顺延至 ' + moment(details.nextBanUntil));
  if (details.title) {
    let text = '与「' + details.title + '」时间冲突';
    if (details.startsAt) text += '（' + moment(details.startsAt) + ' 至 ' + moment(details.endsAt) + '）';
    parts.push(text);
  }
  if (details.required !== undefined && details.available !== undefined) {
    parts.push('需 ' + details.required + ' 积分，当前可用 ' + details.available + ' 积分');
  }
  if (details.redeemedAt) parts.push('首次核销时间 ' + moment(details.redeemedAt));
  if (details.remainingSeconds !== undefined) parts.push('剩余 ' + details.remainingSeconds + ' 秒');
  if (details.lockedUntil) parts.push('解锁时间 ' + moment(details.lockedUntil));
  return parts.join('；');
}

function describe(body) {
  const message = (body && body.message) || '请求失败，请稍后重试';
  const extra = describeDetails(body && body.details);
  return extra ? message + '：' + extra : message;
}

function ApiError(message, status, details) {
  this.name = 'ApiError';
  this.message = message;
  this.status = status;
  this.details = details || null;
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

// 会话失效：清掉本地 token 并回到登录页。仅在非 /auth/* 请求上触发。
function handleUnauthorized() {
  clearSession();
  if (redirecting) return;
  redirecting = true;
  try {
    wx.reLaunch({ url: '/pages/login/index' });
  } finally {
    redirecting = false;
  }
}

function request(path, method, data) {
  const verb = (method || 'GET').toUpperCase();
  return new Promise(function (resolve, reject) {
    wx.request({
      url: baseUrl() + path,
      method: verb,
      data: data === undefined ? undefined : data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + getToken()
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(body); return; }
        // 登录类接口的 401 属于凭据错误，保留表单与本地会话，交给页面提示。
        if (res.statusCode === 401 && String(path).indexOf('/auth/') !== 0) handleUnauthorized();
        reject(new ApiError(describe(body), res.statusCode, body.details));
      },
      fail() { reject(new ApiError('网络连接失败，请检查网络或服务器地址后重试', 0, null)); }
    });
  });
}

function get(path) { return request(path, 'GET'); }
function post(path, data) { return request(path, 'POST', data === undefined ? {} : data); }
function del(path) { return request(path, 'DELETE'); }

function saveSession(result) {
  if (!result || !result.token) return;
  wx.setStorageSync(TOKEN_KEY, result.token);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
}

function logout() {
  return request('/auth/logout', 'POST').catch(function () { return null; }).then(function () {
    clearSession();
  });
}

// 角色落地页：学生进首页标签页，核销员只有核销页，发布者/管理员无小程序入口。
function homeFor(role) {
  if (role === 'STUDENT') return '/pages/catalog/index';
  if (role === 'REDEEMER') return '/pages/redeem/index';
  return '';
}

module.exports = {
  DEFAULT_BASE,
  baseUrl,
  setBaseUrl,
  assetUrl,
  request,
  get,
  post,
  del,
  saveSession,
  getToken,
  clearSession,
  logout,
  homeFor,
  ApiError
};
