import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, authorize, tokenHash } from '../apps/api/src/security.mjs';
import { parseRoster } from '../apps/api/src/roster.mjs';
import { WechatIdentity } from '../apps/api/src/wechat.mjs';
test('password hashes are salted, one-way and verify securely', async () => {
  const a = await hashPassword('123456'), b = await hashPassword('123456');
  assert.notEqual(a, b); assert.ok(!a.includes('123456'));
  assert.ok(await verifyPassword('123456', a)); assert.equal(await verifyPassword('incorrect', a), false);
  assert.equal(tokenHash('token').length, 64);
});
test('CSV preserves leading zeros and rejects missing columns, duplicates, malformed and oversized batches', () => {
  assert.equal(parseRoster('\uFEFF学号,姓名,学院,年级\n001,张三,计算机,26')[0].identifier, '001');
  assert.throws(() => parseRoster('学号,姓名,年级\n1,张三,26'), e => e.details.missing.includes('学院'));
  assert.throws(() => parseRoster('学号,姓名,学院,年级\n1,A,C,26\n1,B,C,26'), e => e.details.rows.join() === '2,3');
  assert.throws(() => parseRoster('学号,姓名,学院,年级\n' + Array.from({length:21}, (_, n) => `${n},A,C,26`).join('\n')), /容量/);
  assert.throws(() => parseRoster('学号,姓名,学院,年级\n1,,C,26'), /不能为空/);
  assert.throws(() => parseRoster('学号,姓名,学院,年级\n"unclosed'), /CSV/);
});
test('authorization enforces session-independent role, ownership, expiry and mandatory password change', () => {
  const student = { id: 'A', role: 'STUDENT', enabled: true };
  authorize(student, ['STUDENT'], { studentId: 'A' });
  assert.throws(() => authorize(student, ['STUDENT'], { studentId: 'B' }), e => e.status === 403);
  assert.throws(() => authorize(student, ['ADMIN']), e => e.status === 403);
  assert.throws(() => authorize({ ...student, enabled: false }, ['STUDENT']), e => e.status === 403);
  assert.throws(() => authorize({ ...student, authorizationExpiresAt: new Date(0) }, ['STUDENT']), e => e.status === 403);
  assert.throws(() => authorize({ ...student, mustChangePassword: true }, ['STUDENT']), /修改密码/);
  assert.throws(() => authorize({ id: 'P', role: 'PUBLISHER', enabled: true }, ['PUBLISHER'], { ownerId: 'Q' }), /本人活动/);
});
test('code2session validates provider response and never exposes session_key', async () => {
  let seen;
  const wx = new WechatIdentity({ appId: 'id', secret: 'secret', fetcher: async url => { seen = url; return { ok: true, json: async () => ({ openid: 'real-identity', session_key: 'private' }) }; } });
  assert.equal(await wx.exchange('code'), 'real-identity'); assert.equal(seen.hostname, 'api.weixin.qq.com');
  assert.equal(seen.searchParams.get('js_code'), 'code');
  await assert.rejects(new WechatIdentity({ appId: 'id', secret: 's', fetcher: async () => ({ ok: true, json: async () => ({ errcode: 40029 }) }) }).exchange('bad'), e => e.status === 401);
  await assert.rejects(new WechatIdentity({}).exchange('code'), e => e.status === 503);
});
