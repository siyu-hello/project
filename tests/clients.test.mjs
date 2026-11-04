import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createApi } from '../apps/admin/src/api.js';
test('admin client propagates server lock/error details and clears unauthorized sessions', async () => {
  let cleared = false, sent;
  const api = createApi({ getToken: () => 'token', onUnauthorized: () => { cleared = true; }, fetcher: async (url, init) => { sent = init; return { ok: false, status: 401, json: async () => ({ message: '登录已过期' }) }; } });
  await assert.rejects(api('/admin/accounts'), /登录已过期/); assert.equal(cleared, true); assert.equal(sent.headers.Authorization, 'Bearer token');
  const locked = createApi({ getToken: () => '', onUnauthorized() {}, fetcher: async () => ({ ok: false, status: 423, json: async () => ({ message: '锁定', details: { lockedUntil: '2026-11-04T12:00:00Z' } }) }) });
  await assert.rejects(locked('/auth/admin/login', 'POST', {}), /lockedUntil/);
});
async function loadPage(path, request, wx = {}) {
  let page;
  vm.runInNewContext(await readFile(new URL(path, import.meta.url), 'utf8'), { require: () => ({ request }), wx, Page: definition => { page = definition; } });
  page.setData = values => Object.assign(page.data, values);
  return page;
}
test('mini-program first binding, one-click account selection and login failure keep secrets out of storage', async () => {
  const saved = [], calls = [], navigations = [];
  const page = await loadPage('../apps/miniprogram/pages/login/index.js', async (path, method, body) => { calls.push(body); return { token: 'opaque', account: { role: 'STUDENT' } }; }, { login: ({success}) => success({code:'wx-code'}), setStorageSync: (...args) => saved.push(args), reLaunch: args => navigations.push(args) });
  page.data.identifier = '001'; page.data.password = '123456';
  await page.login({ currentTarget: { dataset: { bind: true } } });
  assert.equal(calls[0].identifier, '001'); assert.equal(calls[0].password, '123456'); assert.equal(saved.length, 1); assert.equal(saved[0][0], 'session'); assert.equal(page.data.password, ''); assert.equal(navigations[0].url, '/pages/home/index');
  const fail = await loadPage('../apps/miniprogram/pages/login/index.js', async () => { throw new Error('账号尚未开通'); }, { login: ({success}) => success({code:'code'}) });
  fail.data.identifier = '001';
  await fail.login({currentTarget:{dataset:{}}}); assert.match(fail.data.error, /尚未开通/); assert.equal(fail.data.busy, false); assert.equal(fail.data.identifier, '001');
});
test('mini-program requests student query only for students and clears stale data before retry', async () => {
  const paths = [];
  const page = await loadPage('../apps/miniprogram/pages/home/index.js', async path => { paths.push(path); return { id: 'p', role: 'PUBLISHER' }; });
  page.data.summary = { availablePoints: 999 }; await page.onShow(); assert.deepEqual(paths, ['/me']); assert.equal(page.data.summary, null); assert.equal(page.data.account.role, 'PUBLISHER');
  const student = await loadPage('../apps/miniprogram/pages/home/index.js', async path => path === '/me' ? {role:'STUDENT'} : { account:{role:'STUDENT'}, summary:{availablePoints:0,volunteerMinutes:0}, activities:[] });
  await student.onShow(); assert.equal(student.data.summary.availablePoints, 0);
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
  const home = await readFile(new URL('../apps/miniprogram/pages/home/index.wxml', import.meta.url),'utf8'); assert.match(home, /<\/block><button bindtap="logout">/);
});
