import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createApi } from '../apps/admin/src/api.js';
const nodeRequire = createRequire(import.meta.url);
const format = nodeRequire('../apps/miniprogram/utils/format.js');
test('admin client propagates server lock/error details and clears unauthorized sessions', async () => {
  let cleared = false, sent;
  const api = createApi({ getToken: () => 'token', onUnauthorized: () => { cleared = true; }, fetcher: async (url, init) => { sent = init; return { ok: false, status: 401, json: async () => ({ message: '登录已过期' }) }; } });
  await assert.rejects(api('/admin/accounts'), /登录已过期/); assert.equal(cleared, true); assert.equal(sent.headers.Authorization, 'Bearer token');
  const locked = createApi({ getToken: () => '', onUnauthorized() {}, fetcher: async () => ({ ok: false, status: 423, json: async () => ({ message: '锁定', details: { lockedUntil: '2026-11-04T12:00:00Z' } }) }) });
  await assert.rejects(locked('/auth/admin/login', 'POST', {}), /lockedUntil/);
});
async function loadPage(path, request, wx = {}) {
  let page;
  const api = { request, get: target => request(target), post: (target, body) => request(target, 'POST', body), del: target => request(target, 'DELETE'), clearSession() {}, logout: () => Promise.resolve() };
  vm.runInNewContext(await readFile(new URL(path, import.meta.url), 'utf8'), { require: spec => (String(spec).includes('format') ? format : String(spec).includes('registration') ? nodeRequire('../apps/miniprogram/utils/registration.js') : api), wx, setInterval: () => 1, clearInterval() {}, Page: definition => { page = definition; } });
  page.setData = values => Object.assign(page.data, values);
  return page;
}
test('mini-program first binding, one-click account selection and login failure keep secrets out of storage', async () => {
  const saved = [], calls = [], navigations = [];
  const page = await loadPage('../apps/miniprogram/pages/login/index.js', async (path, method, body) => { calls.push(body); return { token: 'opaque', account: { role: 'STUDENT' } }; }, { login: ({success}) => success({code:'wx-code'}), setStorageSync: (...args) => saved.push(args), reLaunch: args => navigations.push(args) });
  page.data.identifier = '001'; page.data.password = '123456';
  await page.login({ currentTarget: { dataset: { bind: true } } });
  assert.equal(calls[0].identifier, '001'); assert.equal(calls[0].password, '123456'); assert.equal(saved.length, 1); assert.equal(saved[0][0], 'session'); assert.equal(page.data.password, ''); assert.equal(navigations[0].url, '/pages/catalog/index');
  const fail = await loadPage('../apps/miniprogram/pages/login/index.js', async () => { throw new Error('账号尚未开通'); }, { login: ({success}) => success({code:'code'}) });
  fail.data.identifier = '001';
  await fail.login({currentTarget:{dataset:{}}}); assert.match(fail.data.error, /尚未开通/); assert.equal(fail.data.busy, false); assert.equal(fail.data.identifier, '001');
});
test('mini-program catalog only asks students for the activity feed and keeps personal profile out of it', async () => {
  const paths = [], navigations = [];
  const page = await loadPage('../apps/miniprogram/pages/catalog/index.js', async path => { paths.push(path); return path === '/me' ? { id: 'p', role: 'PUBLISHER' } : []; }, { setNavigationBarTitle() {}, reLaunch: value => navigations.push(value), removeStorageSync() {} });
  await page.onShow();
  assert.deepEqual(paths, ['/me']);
  assert.equal(page.data.account, undefined);
  assert.equal(navigations[0].url, '/pages/login/index');

  const studentPaths = [];
  const student = await loadPage('../apps/miniprogram/pages/catalog/index.js', async path => {
    studentPaths.push(path);
    return path === '/me' ? { role: 'STUDENT', college: '计算机学院', grade: '26' } : [{ id: 'a1', title: '清洁志愿', type: 'MINUTE', points: 0, capacity: 10, enrolled: 2, remainingCapacity: 8, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() }];
  }, { setNavigationBarTitle() {}, reLaunch() {}, removeStorageSync() {} });
  await student.onShow();
  assert.deepEqual(studentPaths, ['/me', '/activities']);
  assert.equal(student.data.items.length, 1);
  assert.equal(student.data.items[0].capacityText, '剩余 8 / 10 个名额');
  assert.equal(student.data.items[0].typeText, '志愿时长');
});
test('mini-program preserves binding form on credential 401 but redirects expired sessions', async () => {
  const redirects = [], removals = [], exported = {};
  vm.runInNewContext(await readFile(new URL('../apps/miniprogram/utils/api.js', import.meta.url), 'utf8'), { module: exported, getApp: () => ({globalData:{apiBase:'https://example.test'}}), wx: { getStorageSync: () => '', removeStorageSync: key => removals.push(key), reLaunch: value => redirects.push(value), request: options => options.success({statusCode:401,data:{message:'账号或密码错误'}}) } });
  await assert.rejects(exported.exports.request('/auth/wechat/login','POST',{}), /账号或密码错误/);
  assert.equal(redirects.length, 0); assert.equal(removals.length, 0);
  await assert.rejects(exported.exports.request('/me'), /账号或密码错误/);
  assert.equal(redirects.length, 1); assert.equal(removals.length, 1);
});
test('mini-program renders distinguishable account choices and retries either account with a fresh code', async () => {
  const calls = [], saved = [], accounts = [{id:'one',identifier:'publisher-a',role:'PUBLISHER'},{id:'two',identifier:'publisher-b',role:'PUBLISHER'}];
  let codes = 0;
  const page = await loadPage('../apps/miniprogram/pages/login/index.js', async (path, method, body) => { calls.push(body); return body.accountId ? {token:body.accountId,account:accounts.find(a=>a.id===body.accountId)} : {selectAccount:accounts}; }, {login:({success})=>success({code:'code-'+(++codes)}),setStorageSync:(key,value)=>saved.push(value),reLaunch(){} });
  await page.login({currentTarget:{dataset:{}}}); assert.equal(page.data.accounts[0].identifier,'publisher-a');
  for (const id of ['one','two']) await page.login({currentTarget:{dataset:{id}}});
  assert.deepEqual(saved,['one','two']); assert.equal(calls[1].accountId,'one'); assert.equal(calls[2].accountId,'two'); assert.notEqual(calls[1].code,calls[2].code);
  const markup = await readFile(new URL('../apps/miniprogram/pages/login/index.wxml', import.meta.url),'utf8'); assert.ok(markup.includes('{{item.identifier}}'));
  const home = await readFile(new URL('../apps/miniprogram/pages/catalog/index.wxml', import.meta.url),'utf8'); assert.match(home, /bindtap="openActivity"/); assert.doesNotMatch(home, /availablePoints|volunteerMinutes/);
  const mine = await readFile(new URL('../apps/miniprogram/pages/mine/index.wxml', import.meta.url),'utf8'); assert.match(mine, /class="profile-heading"/); assert.match(mine, /bindtap="logout"/);
  const app = JSON.parse(await readFile(new URL('../apps/miniprogram/app.json', import.meta.url),'utf8')); assert.deepEqual(app.tabBar.list.map(item => item.text), ['活动', '商城', '我的']);
});

test('cancelled activities appear in the cancelled filter without attendance actions', async () => {
  const page = await loadPage('../apps/miniprogram/pages/registrations/index.js', async path => {
    if (path === '/me') return { role: 'STUDENT', name: '学生' };
    if (path === '/students/me/home') return { summary: {} };
    return [
      { activityId: 'a1', status: 'CHECKED_IN', activityStatus: 'CANCELLED', checkinMode: 'BOTH' },
      { activityId: 'a2', status: 'REGISTERED', activityStatus: 'PUBLISHED' }
    ];
  });
  await page.load();
  page.pickFilter({ currentTarget: { dataset: { index: 4 } } });
  assert.equal(page.data.items.length, 1);
  assert.equal(page.data.items[0].activityId, 'a1');
  assert.equal(page.data.items[0].statusText, '活动已取消');
  assert.equal(page.data.items[0].canCheckout, false);
});

test('activity detail updates attendance availability when the window opens', async () => {
  const page = await loadPage('../apps/miniprogram/pages/activity/index.js', async () => ({}));
  const now = Date.now();
  const activity = {
    title: '活动', type: 'POINT', checkinMode: 'BOTH', status: 'PUBLISHED',
    startsAt: new Date(now - 30 * 60000).toISOString(),
    endsAt: new Date(now + 6 * 60000).toISOString()
  };
  const registration = { status: 'CHECKED_IN' };
  page.render(activity, registration, {});
  assert.equal(page.data.canCheckout, false);
  page.serverOffset = 2 * 60000;
  page.render(activity, registration, {});
  assert.equal(page.data.canCheckout, true);
  page.render({ ...activity, status: 'CANCELLED' }, registration, {});
  assert.equal(page.data.canCheckout, false);
});

test('profile shows only two registrations while retaining the total count', async () => {
  const records = Array.from({ length: 24 }, (_, index) => ({ activityId: 'a' + index, title: '活动' }));
  const page = await loadPage('../apps/miniprogram/pages/mine/index.js', async path => {
    if (path === '/me') return { role: 'STUDENT', name: '学生' };
    if (path === '/students/me/home') return { summary: {} };
    return records;
  });
  await page.load();
  assert.equal(page.data.registrationCount, 24);
  assert.equal(page.data.items.length, 2);
});
