import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MysqlStore } from '../apps/api/src/store.mjs';
import { migrate } from '../apps/api/prisma/migrate.mjs';
import { seedAdmin } from '../apps/api/prisma/seed.mjs';
import { IdentityService } from '../apps/api/src/identity.mjs';
import { createApp } from '../apps/api/src/app.mjs';
const url = process.env.TEST_DATABASE_URL;
const csv = ids => '学号,姓名,学院,年级\n' + ids.map(id => `${id},学生${id},计算机,26`).join('\n');
test('MySQL 8.4 real API, atomic imports, binding races, per-request authorization and persistence', { skip: !url, timeout: 120000 }, async t => {
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL database must end in _test (destructive fixture reset)');
  const store = await MysqlStore.connect(url);
  let app;
  t.after(async () => { await app?.close(); await store.close(); });
  await migrate(store);
  for (const table of ['session', 'login_failure', 'audit', 'ledger_entry', 'activity', 'account']) await store.exec(`DELETE FROM ${table}`);
  await store.exec('UPDATE capacity SET students = 0, staff = 0 WHERE id = 1');
  await seedAdmin(store, 'admin', 'test-admin-123');
  const service = new IdentityService(store, { exchange: async code => code }, { initialPassword: '123456' });
  app = await createApp(service);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function api(path, { method = 'GET', body, token } = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const loginAdmin = password => api('/auth/admin/login', { method: 'POST', body: { identifier: 'admin', password } });
  let admin;
  await t.test('unauthenticated requests have no business data; first login blocks management until password changed', async () => {
    assert.equal((await api('/admin/accounts')).status, 401);
    const first = await loginAdmin('test-admin-123'); assert.equal(first.status, 200); assert.equal(first.data.account.mustChangePassword, true);
    assert.equal((await api('/admin/accounts', { token: first.data.token })).status, 403);
    const changed = await api('/auth/password', { method: 'POST', token: first.data.token, body: { oldPassword: 'test-admin-123', newPassword: 'changed-admin-123' } });
    assert.equal(changed.status, 200); admin = changed.data.token;
    assert.equal((await api('/me', { token: first.data.token })).status, 401);
    assert.equal((await api('/admin/accounts', { token: admin })).status, 200);
  });
  await t.test('failed credentials lock at five, persist time/IP and unlock after expiry', async () => {
    for (let n = 0; n < 5; n++) assert.equal((await loginAdmin('wrong-password')).status, n === 4 ? 423 : 401);
    assert.equal((await loginAdmin('changed-admin-123')).status, 423);
    const failures = await store.rows('SELECT ip, occurredAt FROM login_failure', [], { ip: 'mysql/text@1', occurredAt: 'mysql/datetime@1' });
    assert.equal(failures.length, 5); assert.ok(failures[0].ip); assert.ok(failures[0].occurredAt instanceof Date);
    const a = (await store.identifiers(['admin']))[0]; await store.setFailures(a.id, 5, new Date(0));
    assert.equal((await loginAdmin('changed-admin-123')).status, 200);
  });
  await t.test('password-change failures retain the session, persist failure audit and enforce shared lockout', async () => {
    const a = (await store.identifiers(['admin']))[0];
    const before = (await store.rows('SELECT id FROM login_failure', [], {id:'mysql/text@1'})).length;
    for (let n=0;n<5;n++) {
      const failed = await api('/auth/password',{method:'POST',token:admin,body:{oldPassword:'wrong',newPassword:'another-admin-123'}});
      assert.equal(failed.status,n===4?423:400);
      assert.equal((await api('/me',{token:admin})).status,200);
    }
    assert.equal((await api('/auth/password',{method:'POST',token:admin,body:{oldPassword:'changed-admin-123',newPassword:'another-admin-123'}})).status,423);
    const failures = await store.rows('SELECT ip, occurredAt FROM login_failure',[],{ip:'mysql/text@1',occurredAt:'mysql/datetime@1'});
    assert.equal(failures.length,before+5); assert.ok(failures.at(-1).ip); assert.ok(failures.at(-1).occurredAt instanceof Date);
    await store.setFailures(a.id,0,null);
  });
  await t.test('bad roster batches never partially write; concurrent imports cannot exceed capacity', async () => {
    const importCsv = value => api('/admin/roster/import', { method: 'POST', token: admin, body: { csv: value, reason: '开通26级学生' } });
    assert.equal((await importCsv('学号,姓名,年级\n1,A,26')).status, 400);
    assert.equal((await importCsv(csv(['1','1']))).status, 400);
    assert.equal((await importCsv(csv(Array.from({length:21}, (_, n) => String(n))))).status, 400);
    assert.equal((await store.accounts()).filter(a => a.role === 'STUDENT').length, 0);
    assert.equal((await importCsv(csv(Array.from({length:19}, (_, n) => 'S' + n)))).status, 200);
    const race = await Promise.all([importCsv(csv(['S19'])), importCsv(csv(['S20']))]);
    assert.deepEqual(race.map(r => r.status).sort(), [200,409]);
    assert.equal((await store.accounts()).filter(a => a.pool === 'students').length, 20);
    const existing = await importCsv(csv(['S0'])); assert.equal(existing.data.existing, 1); assert.equal(existing.data.created, 0);
    const before = (await store.accounts()).length;
    assert.equal((await importCsv(csv(['S0','S21']))).status, 409);
    assert.equal((await store.accounts()).length, before);
    const students = (await store.accounts()).filter(a=>a.pool==='students');
    assert.equal(new Set(students.map(a=>a.passwordHash)).size,20);
    const revoked = students.find(a=>a.identifier==='S3');
    await api('/admin/accounts/'+revoked.id,{method:'PATCH',token:admin,body:{role:'REVOKED',reason:'重导入测试'}});
    const reimport = await importCsv(csv(['S3'])); assert.equal(reimport.status,200); assert.equal(reimport.data.existing,1); assert.equal(reimport.data.created,0);
    assert.equal((await store.account(revoked.id)).role,'REVOKED');
    await api('/admin/accounts/'+revoked.id,{method:'PATCH',token:admin,body:{role:'STUDENT',reason:'恢复后续测试'}});
    await assert.rejects(seedAdmin(store,'S3','test-admin-123'),/non-administrator/);
    await seedAdmin(store,'admin','do-not-reset-123');
    assert.equal((await loginAdmin('changed-admin-123')).status,200);
  });
  let studentToken, student;
  await t.test('unopened WeChat does not create accounts; binding is atomic and cannot be stolen', async () => {
    const wx = body => api('/auth/wechat/login', { method: 'POST', body });
    const before = (await store.accounts()).length;
    assert.equal((await wx({ code: 'unknown' })).status, 403);
    assert.equal((await store.accounts()).length, before);
    const race = await Promise.all(['wx-a','wx-b'].map(code => wx({ code, identifier: 'S0', password: '123456' })));
    assert.deepEqual(race.map(r => r.status).sort(), [200,403]);
    const winner = race.findIndex(r => r.status === 200), openid = ['wx-a','wx-b'][winner];
    studentToken = race[winner].data.token; student = race[winner].data.account;
    const oneClick = await wx({ code: openid }); assert.equal(oneClick.status, 200); assert.equal(oneClick.data.account.id, student.id);
    await store.setFailures(student.id,5,new Date(Date.now()+600000));
    assert.equal((await wx({code:openid})).status,423);
    await store.setFailures(student.id,0,null);
    assert.equal((await wx({ code: 'attacker', identifier: 'S0', password: '123456' })).status, 403);
    assert.equal((await store.account(student.id)).wechatOpenid, openid);
    for (let n = 0; n < 5; n++) assert.equal((await wx({ code: 'wrong', identifier: 'S1', password: 'wrong' })).status, n === 4 ? 423 : 401);
    assert.equal((await wx({ code: 'correct', identifier: 'S1', password: '123456' })).status, 423);
  });
  await t.test('all twenty imported students can bind and each homepage contains only its own identity', async () => {
    const students = (await store.accounts()).filter(a => a.pool === 'students');
    const existing = await api('/admin/roster/import', { method: 'POST', token: admin, body: { csv: csv(students.map(a => a.identifier)), reason: '重复整批导入20人' } });
    assert.equal(existing.data.existing, 20); assert.equal(existing.data.created, 0);
    for (const a of students) {
      if (a.lockedUntil) await store.setFailures(a.id, 0, null);
      const session = await api('/auth/wechat/login', { method: 'POST', body: { code: a.wechatOpenid || `wx-${a.identifier}`, identifier: a.identifier, password: '123456' } });
      assert.equal(session.status, 200);
      const home = await api('/students/me/home', { token: session.data.token });
      assert.equal(home.status, 200); assert.equal(home.data.account.id, a.id);
      assert.equal(home.data.summary.availablePoints, 0);
      for (const other of students.filter(s => s.id !== a.id)) {
        assert.ok(!JSON.stringify(home.data).includes(`"${other.identifier}"`));
        assert.ok(!JSON.stringify(home.data).includes(`"${other.name}"`));
      }
    }
  });
  await t.test('every student sees only own ledger and eligible activities; forged ownership and roles return 403', async () => {
    const other = (await store.identifiers(['S2']))[0];
    await store.exec('INSERT INTO ledger_entry (id,studentId,unit,amount,kind,sourceId,ruleSnapshot,occurredAt) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(),student.id,'POINT',7,'CREDIT',randomUUID(),'{}',new Date()]);
    await store.exec('INSERT INTO ledger_entry (id,studentId,unit,amount,kind,sourceId,ruleSnapshot,occurredAt) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(),other.id,'POINT',999,'CREDIT',randomUUID(),'{}',new Date()]);
    const home = await api('/students/me/home', { token: studentToken }); assert.equal(home.status, 200); assert.equal(home.data.summary.availablePoints, 7); assert.equal(home.data.summary.volunteerMinutes, 0); assert.deepEqual(home.data.activities, []);
    assert.ok(!JSON.stringify(home).includes(other.identifier)); assert.ok(!JSON.stringify(home).includes(other.name));
    assert.equal((await api(`/students/${other.id}/home`, { token: studentToken })).status, 403);
    assert.equal((await api('/admin/accounts', { token: studentToken })).status, 403);
    assert.ok(!JSON.stringify(home).includes('passwordHash')); assert.ok(!JSON.stringify(home).includes('wechatOpenid'));
    assert.equal((await api('/admin/accounts/' + student.id, { method: 'PATCH', token: admin, body: { role: 'PUBLISHER', reason: '试图叠加权限' } })).status, 400);
  });
  let staff, staffToken, activity;
  await t.test('independent staff accounts share a ten-account lifetime pool with atomic concurrent reservation', async () => {
    const create = n => api('/admin/accounts', { method: 'POST', token: admin, body: { identifier: 'staff' + n, name: '角色账号' + n, role: 'PUBLISHER', reason: '开通独立角色' } });
    const results = await Promise.all(Array.from({length:11}, (_, n) => create(n)));
    assert.equal(results.filter(r => r.status === 201).length, 10); assert.equal(results.filter(r => r.status === 409).length, 1);
    staff = results.find(r => r.status === 201).data;
    const login = await api('/auth/wechat/login', { method: 'POST', body: { code: 'staff-wx', identifier: staff.identifier, password: '123456' } });
    assert.equal(login.status, 200); staffToken = login.data.token;
    assert.equal((await api('/students/me/home', { token: staffToken })).status, 403);
    assert.equal((await api('/admin/audits', { token: staffToken })).status, 403);
    assert.equal((await store.accounts()).filter(a => a.pool === 'students').length, 20);
    activity = { id: randomUUID(), endsAt: new Date(Date.now() + 3600000) };
    await store.exec('INSERT INTO activity (id,publisherId,title,college,grade,status,startsAt,endsAt,capacity,enrolled) VALUES (?,?,?,?,?,?,?,?,?,?)', [activity.id,staff.id,'真实测试活动','计算机','26','PUBLISHED',new Date(Date.now()+600000),activity.endsAt,20,0]);
    const visible = await api('/students/me/home', { token: studentToken }); assert.equal(visible.data.activities.length, 1);
    for (const difference of [{status:'PENDING'},{college:'其他学院'},{grade:'27'},{startsAt:new Date(0)},{enrolled:20}]) {
      const fixture = {id:randomUUID(),college:'计算机',grade:'26',status:'PUBLISHED',startsAt:new Date(Date.now()+600000),enrolled:0,...difference};
      await store.exec('INSERT INTO activity (id,publisherId,title,college,grade,status,startsAt,endsAt,capacity,enrolled) VALUES (?,?,?,?,?,?,?,?,?,?)',[fixture.id,staff.id,'不匹配活动',fixture.college,fixture.grade,fixture.status,fixture.startsAt,activity.endsAt,20,fixture.enrolled]);
    }
    const filtered = await api('/students/me/home',{token:studentToken}); assert.deepEqual(filtered.data.activities.map(a=>a.id),[activity.id]);
    const another = (await store.accounts()).find(a=>a.pool==='staff'&&a.id!==staff.id);
    await assert.rejects(seedAdmin(store,another.identifier,'test-admin-123'),/non-administrator/);
    const wx = body=>api('/auth/wechat/login',{method:'POST',body});
    assert.equal((await wx({code:'staff-wx',identifier:another.identifier,password:'123456'})).status,200);
    const choices = await wx({code:'staff-wx'}); assert.equal(choices.status,200); assert.equal(choices.data.selectAccount.length,2);
    assert.deepEqual(choices.data.selectAccount.map(a=>a.identifier).sort(),[staff.identifier,another.identifier].sort());
    for(const selected of [staff,another]) {
      const chosen = await wx({code:'staff-wx',accountId:selected.id}); assert.equal(chosen.status,200); assert.equal(chosen.data.account.id,selected.id); assert.equal(chosen.data.account.role,'PUBLISHER'); assert.equal((await api('/students/me/home',{token:chosen.data.token})).status,403);
    }
    assert.equal((await wx({code:'staff-wx',accountId:student.id})).status,403);
  });
  await t.test('old sessions immediately follow current role, enabled status and activity expiry; audit before/after preserved', async () => {
    const update = body => api('/admin/accounts/' + staff.id, { method: 'PATCH', token: admin, body: { ...body, reason: '授权变更测试' } });
    assert.equal((await update({ role: 'REDEEMER', activityId: activity.id })).status, 200);
    assert.equal((await api('/me', { token: staffToken })).data.role, 'REDEEMER');
    await store.exec('UPDATE activity SET endsAt = ? WHERE id = ?', [new Date(0), activity.id]);
    assert.equal((await api('/me', { token: staffToken })).status, 403);
    assert.equal((await api('/auth/wechat/login',{method:'POST',body:{code:'staff-wx',accountId:staff.id}})).status,403);
    assert.equal((await api('/auth/wechat/login',{method:'POST',body:{code:'staff-wx',identifier:staff.identifier,password:'123456'}})).status,403);
    await update({ activityId: '', enabled: false });
    assert.equal((await api('/me', { token: staffToken })).status, 403);
    await update({ enabled: true, role: 'REVOKED' });
    assert.equal((await api('/me', { token: staffToken })).status, 403);
    const adminAccount = (await store.identifiers(['admin']))[0];
    assert.equal((await api('/admin/accounts/' + adminAccount.id, { method: 'PATCH', token: admin, body: { role: 'REVOKED', reason: '自我回收' } })).status, 403);
    const audits = await api('/admin/audits', { token: admin }); assert.equal(audits.status, 200);
    const updateAudit = audits.data.find(a => a.targetId === staff.id && a.action === 'ACCOUNT_UPDATE');
    assert.ok(updateAudit.actorId); assert.ok(updateAudit.occurredAt); assert.ok(updateAudit.reason); assert.ok(updateAudit.beforeValue); assert.ok(updateAudit.afterValue);
    assert.ok(!JSON.stringify(audits.data).includes('123456')); assert.ok(!JSON.stringify(audits.data).includes('scrypt:'));
    const secondConnection = await MysqlStore.connect(url);
    try { assert.equal((await secondConnection.accounts()).length, 31); assert.ok(await secondConnection.session((await import('../apps/api/src/security.mjs')).tokenHash(studentToken))); } finally { await secondConnection.close(); }
  });
});
