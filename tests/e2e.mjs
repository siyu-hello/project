// 端到端验收：Epic 2–7 主流程（活动发布/审核、报名、签到入账、兑换、核销）。
// 运行前需要独立测试库与测试 API：E2E_BASE 默认 http://127.0.0.1:3100，DATABASE_URL 指向 *_e2e。
import { MysqlStore } from '../apps/api/src/store.mjs';
import { seedAdmin } from '../apps/api/prisma/seed.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const store = await MysqlStore.connect(process.env.DATABASE_URL);
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
  passed += 1;
}
async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
async function reset() {
  await store.exec('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of ['gift_order', 'gift', 'no_show', 'registration', 'activity_review', 'ledger_entry', 'activity', 'audit', 'login_failure', 'session', 'account', 'capacity']) await store.exec(`TRUNCATE TABLE ${table}`);
  await store.exec('SET FOREIGN_KEY_CHECKS = 1');
  await store.exec('INSERT INTO capacity (id, students, staff) VALUES (1, 0, 0)');
  await seedAdmin(store, 'admin', 'AdminCampus2026');
}
const iso = ms => new Date(Date.now() + ms).toISOString();

await reset();

// ---- 管理员登录与首次改密 ----
let r = await call('/auth/admin/login', { method: 'POST', body: { identifier: 'admin', password: 'AdminCampus2026' } });
assert(r.status === 200 && r.data.account.mustChangePassword === true, '管理员首次登录需强制改密');
r = await call('/auth/password', { method: 'POST', token: r.data.token, body: { oldPassword: 'AdminCampus2026', newPassword: 'AdminE2E2026!' } });
assert(r.status === 200 && r.data.account.mustChangePassword === false, '改密成功并返回新会话');
const admin = r.data.token;
r = await call('/auth/admin/login', { method: 'POST', body: { identifier: 'admin', password: 'AdminCampus2026' } });
assert(r.status === 401, '旧密码失效');

// ---- 名单与独立角色账号 ----
const csv = '学号,姓名,学院,年级\n20260001,张三,计算机与大数据学院,26\n20260002,李四,计算机与大数据学院,26';
r = await call('/admin/roster/import', { method: 'POST', token: admin, body: { csv, reason: 'E2E 导入' } });
assert(r.status === 200 && r.data.created === 2, '导入两行学生');
r = await call('/admin/roster/import', { method: 'POST', token: admin, body: { csv, reason: 'E2E 重复导入' } });
assert(r.status === 200 && r.data.created === 0 && r.data.existing === 2, '重复导入只返回已存在计数');
r = await call('/admin/roster/import', { method: 'POST', token: admin, body: { csv: '姓名,学院\n张三,计算机', reason: '坏表头' } });
assert(r.status === 400, '缺列整批拒绝');

for (const [identifier, role] of [['pub1', 'PUBLISHER'], ['red1', 'REDEEMER']]) {
  r = await call('/admin/accounts', { method: 'POST', token: admin, body: { identifier, name: identifier, role, reason: 'E2E 建号' } });
  assert(r.status === 201, `创建 ${role} 账号`);
}
r = await call('/auth/student/login', { method: 'POST', body: { identifier: '20260001', password: '123456' } });
assert(r.status === 200 && r.data.account.role === 'STUDENT', '学生账号密码登录');
const student1 = r.data.token;
r = await call('/auth/student/login', { method: 'POST', body: { identifier: '20260002', password: '123456' } });
const student2 = r.data.token;
r = await call('/auth/student/login', { method: 'POST', body: { identifier: 'pub1', password: '123456' } });
assert(r.status === 200 && r.data.account.role === 'PUBLISHER', '发布者登录');
const publisher = r.data.token;
r = await call('/auth/student/login', { method: 'POST', body: { identifier: 'red1', password: '123456' } });
const redeemer = r.data.token;

// ---- 发布者创建活动与校验 ----
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005fa02fdb4f9d8f30000000049454e44ae426082', 'hex');
let upload = await fetch(BASE + '/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${publisher}` }, body: png });
assert(upload.status === 201, '发布者上传活动凭证图片');
const uploaded = await upload.json();
assert(/^\/uploads\/.+\.png$/.test(uploaded.url), '上传返回站内图片地址');
let image = await fetch(BASE + uploaded.url);
assert(image.status === 200 && image.headers.get('content-type').includes('image/png'), '图片可通过静态地址访问');
const baseActivity = { title: '秩序维护志愿岗', type: 'POINT', points: 3, description: '维持现场秩序', college: '计算机与大数据学院', grade: '26', location: '体育馆', capacity: 5, startsAt: iso(90 * 1000), endsAt: iso(70 * 60 * 1000), checkinMode: 'QR', evidenceUrl: uploaded.url };
r = await call('/activities', { method: 'POST', token: publisher, body: { ...baseActivity, points: 5, description: '太短' } });
assert(r.status === 400, '5分活动说明不足20字被拒');
r = await call('/activities', { method: 'POST', token: publisher, body: { ...baseActivity, endsAt: iso(5 * 60 * 1000) } });
assert(r.status === 400, '时长不足10分钟被拒');
r = await call('/activities', { method: 'POST', token: publisher, body: { ...baseActivity, capacity: 21 } });
assert(r.status === 400, '人数上限超过20被拒');
r = await call('/activities', { method: 'POST', token: publisher, body: baseActivity });
assert(r.status === 201 && r.data.status === 'PENDING', '发布者创建待审核活动');
const activity = r.data;
r = await call(`/activities/${activity.id}`, { method: 'PATCH', token: publisher, body: { ...baseActivity, type: 'MINUTE' } });
assert(r.status === 400, '类型创建后不可修改');
r = await call('/admin/activities', { token: admin });
assert(r.status === 200 && r.data.some(a => a.id === activity.id), '管理员看到待审核队列');
r = await call(`/admin/activities/${activity.id}/review`, { method: 'POST', token: admin, body: { decision: 'REJECTED' } });
assert(r.status === 400, '驳回必须填原因');
r = await call(`/admin/activities/${activity.id}/review`, { method: 'POST', token: admin, body: { decision: 'REJECTED', reason: '凭证模糊' } });
assert(r.status === 200 && r.data.reviewStatus === 'REJECTED', '驳回成功');
r = await call(`/activities/${activity.id}`, { method: 'PATCH', token: publisher, body: baseActivity });
assert(r.status === 200 && r.data.reviewStatus === 'PENDING', '修改后重新提交待审核');
r = await call(`/activities/${activity.id}`, { token: admin });
assert(r.data.reviews.length === 1, '审核历史保留');
r = await call(`/admin/activities/${activity.id}/review`, { method: 'POST', token: admin, body: { decision: 'APPROVED' } });
assert(r.status === 200 && r.data.status === 'PUBLISHED', '审核通过并发布');

// ---- 学生浏览、报名 ----
r = await call('/activities', { token: student1 });
assert(r.status === 200 && r.data.some(a => a.id === activity.id), '学生看到已发布活动');
r = await call(`/activities/${activity.id}`, { token: student1 });
assert(r.status === 200 && r.data.remainingCapacity === 5, '详情显示剩余名额');
r = await call(`/activities/${activity.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 201 && r.data.status === 'REGISTERED', '学生报名成功');
const registration1 = r.data;
r = await call(`/activities/${activity.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 409 && /已报名/.test(r.data.message), '重复报名被拒');
r = await call('/students/me/registrations', { token: student1 });
assert(r.status === 200 && r.data.length === 1, '我的活动出现报名记录');

// ---- 动态码签到（积分活动完成即入账） ----
r = await call(`/activities/${activity.id}/checkin-code`, { token: publisher });
assert(r.status === 200 && /^[A-F0-9]{6}$/.test(r.data.code), '发布者取得当前周期签到码');
let code = r.data.code;
r = await call(`/activities/${activity.id}/checkin`, { method: 'POST', token: student1, body: { code } });
if (r.status === 400 && /失效/.test(r.data.message)) {
  code = (await call(`/activities/${activity.id}/checkin-code`, { token: publisher })).data.code;
  r = await call(`/activities/${activity.id}/checkin`, { method: 'POST', token: student1, body: { code } });
}
assert(r.status === 200 && r.data.registration.status === 'COMPLETED' && r.data.credited.amount === 3, '扫码签到并 +3 积分');
r = await call(`/activities/${activity.id}/checkin`, { method: 'POST', token: student1, body: { code } });
assert(r.status === 409, '重复签到被拒');
r = await call('/students/me/ledger', { token: student1 });
assert(r.status === 200 && r.data.summary.availablePoints === 3 && r.data.total === 1, '账本余额与流水一致');

// ---- 第二名学生的错误码 ----
await call(`/activities/${activity.id}/registrations`, { method: 'POST', token: student2 });
r = await call(`/activities/${activity.id}/checkin`, { method: 'POST', token: student2, body: { code: 'AAAAAA' } });
assert(r.status === 400 && /无效/.test(r.data.message), '错误签到码被拒');
code = (await call(`/activities/${activity.id}/checkin-code`, { token: publisher })).data.code;
r = await call(`/activities/${activity.id}/checkin`, { method: 'POST', token: student2, body: { code } });
assert(r.status === 200 && r.data.registration.status === 'COMPLETED', '第二名学生在同周期同码签到成功');
r = await call(`/activities/${activity.id}`, { token: student1 });
assert(r.data.enrolled === 2 && r.data.remainingCapacity === 3, '报名人数与剩余名额同步');

// ---- 名额与时间冲突 ----
const capacityActivity = { ...baseActivity, title: '限额活动', capacity: 1, startsAt: iso(2 * 3600 * 1000), endsAt: iso(3 * 3600 * 1000) };
r = await call('/activities', { method: 'POST', token: publisher, body: capacityActivity });
const limited = r.data;
await call(`/admin/activities/${limited.id}/review`, { method: 'POST', token: admin, body: { decision: 'APPROVED' } });
r = await call(`/activities/${limited.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 201, '第一名学生占用唯一名额');
r = await call(`/activities/${limited.id}/registrations`, { method: 'POST', token: student2 });
assert(r.status === 409 && /名额已满/.test(r.data.message), '名额满后拒绝');
const conflictActivity = { ...baseActivity, title: '冲突活动', startsAt: iso(2.5 * 3600 * 1000), endsAt: iso(3.5 * 3600 * 1000) };
r = await call('/activities', { method: 'POST', token: publisher, body: conflictActivity });
const conflict = r.data;
await call(`/admin/activities/${conflict.id}/review`, { method: 'POST', token: admin, body: { decision: 'APPROVED' } });
r = await call(`/activities/${conflict.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 409 && /时间冲突/.test(r.data.message), '时间冲突被拒');

// ---- 取消与重报 ----
r = await call(`/activities/${limited.id}/registrations`, { method: 'DELETE', token: student1 });
assert(r.status === 200 && r.data.status === 'CANCELLED', '开始前可取消报名');
r = await call(`/activities/${limited.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 201 && r.data.id === (await call('/students/me/registrations', { token: student1 })).data.find(x => x.activityId === limited.id).id, '取消后重报复用原记录');

// ---- 礼品兑换与核销 ----
r = await call('/admin/gifts', { method: 'POST', token: admin, body: { name: '文创帆布袋', description: '校园限定', points: 2, stock: 2 } });
assert(r.status === 201, '管理员新增礼品');
const gift = r.data;
r = await call('/gifts', { token: student1 });
assert(r.status === 200 && r.data.some(g => g.id === gift.id), '学生看到上架礼品');
const requestId = crypto.randomUUID();
r = await call(`/gifts/${gift.id}/redeem`, { method: 'POST', token: student1, body: { requestId } });
assert(r.status === 201 && r.data.order.status === 'RESERVED' && r.data.order.code, '学生兑换生成兑换码');
const order = r.data.order;
r = await call(`/gifts/${gift.id}/redeem`, { method: 'POST', token: student1, body: { requestId } });
assert(r.status === 201 && r.data.duplicated === true && r.data.order.id === order.id, '同一 requestId 幂等返回同一订单');
r = await call('/students/me/ledger', { token: student1 });
assert(r.data.summary.availablePoints === 1, '兑换扣减后余额 1');
r = await call('/students/me/orders', { token: student1 });
assert(r.status === 200 && r.data[0].id === order.id, '我的订单显示兑换码');
r = await call('/redeemer/redeem', { method: 'POST', token: redeemer, body: { code: order.code } });
assert(r.status === 200 && r.data.status === 'REDEEMED', '核销员扫码核销');
r = await call('/redeemer/redeem', { method: 'POST', token: redeemer, body: { code: order.code } });
assert(r.status === 409 && r.data.details.redeemedAt, '重复核销被拒并显示首次时间');

// ---- 图片上传与动态二维码签到签退 ----
upload = await fetch(BASE + '/uploads', { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${publisher}` }, body: 'not an image' });
assert(upload.status === 400, '非图片内容被拒绝');

const minute = { ...baseActivity, title: '志愿签到签退演练', type: 'MINUTE', points: undefined, capacity: 5, startsAt: iso(2 * 60 * 1000), endsAt: iso(15 * 60 * 1000), evidenceUrl: uploaded.url };
r = await call('/activities', { method: 'POST', token: publisher, body: minute });
assert(r.status === 201, '志愿活动创建（' + r.status + ' ' + (r.data && r.data.message) + '）');
const volunteer = r.data;
r = await call(`/admin/activities/${volunteer.id}/review`, { method: 'POST', token: admin, body: { decision: 'APPROVED' } });
assert(r.status === 200 && r.data.status === 'PUBLISHED', '志愿活动审核发布（' + r.status + ' ' + (r.data && r.data.message) + '）');
r = await call(`/activities/${volunteer.id}/registrations`, { method: 'POST', token: student1 });
assert(r.status === 201, '学生报名志愿活动（' + r.status + ' ' + (r.data && r.data.message) + '）');
const dbTime = ms => new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
await store.exec('UPDATE activity SET startsAt = ?, endsAt = ? WHERE id = ?', [dbTime(Date.now() - 60 * 1000), dbTime(Date.now() + 2 * 60 * 1000), volunteer.id]);
r = await call(`/activities/${volunteer.id}/checkin-code`, { token: publisher });
assert(r.status === 200 && r.data.kind === 'checkin' && /^[A-F0-9]{6}$/.test(r.data.code), '发布者取得签到动态码');
r = await call(`/activities/${volunteer.id}/checkin`, { method: 'POST', token: student1, body: { code: r.data.code } });
assert(r.status === 200 && r.data.registration.status === 'CHECKED_IN', '学生扫码签到，等待签退');
await store.exec("UPDATE registration SET checkedInAt = ? WHERE activityId = ? AND status = 'CHECKED_IN'", [dbTime(Date.now() - 20 * 60 * 1000), volunteer.id]);
r = await call(`/activities/${volunteer.id}/checkout-code`, { token: publisher });
assert(r.status === 200 && r.data.kind === 'checkout' && /^[A-F0-9]{6}$/.test(r.data.code), '发布者取得签退动态码');
const checkoutCode = r.data.code;
r = await call(`/activities/${volunteer.id}/checkout`, { method: 'POST', token: student1, body: { code: 'AAAAAA' } });
assert(r.status === 400 && /无效/.test(r.data.message), '错误签退码被拒');
r = await call(`/activities/${volunteer.id}/checkout`, { method: 'POST', token: student1, body: { code: checkoutCode } });
assert(r.status === 200 && r.data.registration.status === 'COMPLETED', '学生扫码签退并结算时长（' + r.status + ' ' + (r.data && r.data.message) + '）');
r = await call(`/activities/${volunteer.id}/checkout-code`, { token: student1 });
assert(r.status === 403, '学生不能获取签退码');

// ---- 越权 ----
r = await call('/admin/accounts', { token: student1 });
assert(r.status === 403, '学生访问管理员接口被拒');
r = await call(`/activities/${activity.id}`, { token: student2 });
assert(r.status === 200, '同学院同年级学生可看详情');

await store.close();
console.log(`\nE2E 通过：${passed} 项断言`);