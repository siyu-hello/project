// 领域验收：签退时长、缺席结算、禁报公式、兑换过期返还（直接调用服务与真实 MySQL）。
import { MysqlStore } from '../apps/api/src/store.mjs';
import { seedAdmin } from '../apps/api/prisma/seed.mjs';
import { IdentityService } from '../apps/api/src/identity.mjs';
import { ActivityService } from '../apps/api/src/activities.mjs';
import { RegistrationService } from '../apps/api/src/registrations.mjs';
import { AttendanceService } from '../apps/api/src/attendance.mjs';
import { LedgerService } from '../apps/api/src/ledger.mjs';
import { GiftService, expireOrders } from '../apps/api/src/gifts.mjs';
import { settleNoShows } from '../apps/api/src/scheduling.mjs';
import { readFile } from 'node:fs/promises';
import { saveImage } from '../apps/api/src/uploads.mjs';
import { DAY } from '../apps/api/src/domain.mjs';

const store = await MysqlStore.connect(process.env.DATABASE_URL);
let passed = 0;
function assert(condition, message) { if (!condition) throw new Error(`断言失败：${message}`); passed += 1; }
const iso = ms => new Date(Date.now() + ms).toISOString();

await store.exec('SET FOREIGN_KEY_CHECKS = 0');
for (const table of ['gift_order', 'gift', 'no_show', 'registration', 'activity_review', 'ledger_entry', 'activity', 'audit', 'login_failure', 'session', 'account', 'capacity']) await store.exec(`TRUNCATE TABLE ${table}`);
await store.exec('SET FOREIGN_KEY_CHECKS = 1');
await store.exec('INSERT INTO capacity (id, students, staff) VALUES (1, 0, 0)');
await seedAdmin(store, 'admin', 'AdminCampus2026');
const admin = await store.account((await store.rows('SELECT id FROM account WHERE identifier = ?', ['admin'], { id: 'mysql/text@1' }))[0].id);
await store.exec('UPDATE account SET mustChangePassword = 0 WHERE id = ?', [admin.id]);
admin.mustChangePassword = 0;
const identity = new IdentityService(store, {}, { initialPassword: '123456' });
await identity.createAccount(admin, { identifier: 'pubx', name: '发布者', role: 'PUBLISHER', reason: '测试' });
const publisher = await store.account((await store.rows('SELECT id FROM account WHERE identifier = ?', ['pubx'], { id: 'mysql/text@1' }))[0].id);
await identity.importRoster(admin, { csv: '学号,姓名,学院,年级\nS1,学生一,计算机学院,26', reason: '测试' });
const student = await store.account((await store.rows('SELECT id FROM account WHERE identifier = ?', ['S1'], { id: 'mysql/text@1' }))[0].id);
const activities = new ActivityService(store, { checkinSecret: 'test-secret' });
const registrations = new RegistrationService(store);
const attendance = new AttendanceService(store, { checkinSecret: 'test-secret' });
const ledger = new LedgerService(store);
const gifts = new GiftService(store);
const base = { title: '测试活动', description: '说明', college: '计算机学院', grade: '26', location: '场地', capacity: 5, checkinMode: 'QR', evidenceUrl: await saveImage(await readFile(new URL('../samples/images/activity-clean.png', import.meta.url)), 'image/png') };

async function publish(input) {
  const created = await activities.create(publisher, { ...base, ...input });
  return activities.review(admin, created.id, { decision: 'APPROVED' });
}

// ---- 志愿时长：签到 + 签退 ----
const minute = await publish({ type: 'MINUTE', startsAt: iso(60 * 1000), endsAt: iso(12 * 60 * 1000) });
await registrations.register(student, minute.id);
await store.exec('UPDATE activity SET startsAt = ?, endsAt = ? WHERE id = ?', [new Date(Date.now() - 60 * 1000), new Date(Date.now() + 11 * 60 * 1000), minute.id]);
let code = activities.code(minute.id).code;
await attendance.checkin(student, minute.id, { code });
await store.exec('UPDATE activity SET endsAt = ? WHERE id = ?', [new Date(Date.now() - 60 * 1000), minute.id]);
await store.exec('UPDATE registration SET checkedInAt = ? WHERE activityId = ? AND studentId = ?', [new Date(Date.now() - 25 * 60 * 1000), minute.id, student.id]);
const checkout = await attendance.checkout(student, minute.id, { code: activities.code(minute.id, Date.now(), 'checkout').code });
assert(checkout.minutes >= 24, '签退按实际差值计算分钟');
assert(checkout.credited.unit === 'MINUTE' && checkout.credited.amount === checkout.minutes, '志愿时长入账单位为分钟');
assert((await ledger.entries(student)).summary.volunteerMinutes === checkout.minutes, '账本累计志愿分钟');

// ---- 缺席结算与禁报 ----
async function missedActivity(offsetMin) {
  const activity = await publish({ title: `缺席${offsetMin}`, type: 'POINT', points: 2, startsAt: iso(60 * 60 * 1000), endsAt: iso(2 * 60 * 60 * 1000) });
  await registrations.register(student, activity.id);
  await store.exec('UPDATE activity SET startsAt = ?, endsAt = ? WHERE id = ?', [new Date(Date.now() - offsetMin * 60 * 1000), new Date(Date.now() + 3600 * 1000), activity.id]);
  return activity;
}
await missedActivity(10);
assert(await settleNoShows(store) === 1, '窗口关闭后结算 1 条旷活动');
assert(await settleNoShows(store) === 0, '重复结算不产生第二条旷活动');
let ban = (await store.rows('SELECT noShowCount, bannedUntil FROM account WHERE id = ?', [student.id], { noShowCount: 'mysql/int@1', bannedUntil: { codecId: 'mysql/datetime@1', nullable: true } }))[0];
assert(ban.noShowCount === 1 && ban.bannedUntil === null, '第一次旷活动不触发禁报');
await missedActivity(20);
await settleNoShows(store);
await missedActivity(30);
await settleNoShows(store);
ban = (await store.rows('SELECT noShowCount, bannedUntil FROM account WHERE id = ?', [student.id], { noShowCount: 'mysql/int@1', bannedUntil: { codecId: 'mysql/datetime@1', nullable: true } }))[0];
assert(ban.noShowCount === 3 && ban.bannedUntil, '第三次旷活动触发禁报');
const days = (new Date(ban.bannedUntil) - Date.now()) / DAY;
assert(days > 6.9 && days < 7.1, '解除时间 = 触发时刻 + 7 天');

const upcoming = await publish({ title: '禁报期报名', type: 'POINT', points: 1, startsAt: iso(3 * 60 * 60 * 1000), endsAt: iso(4 * 60 * 60 * 1000) });
try { await registrations.register(student, upcoming.id); assert(false, '禁报期应拒绝报名'); }
catch (error) { assert(error.status === 403 && error.details.remainingDays === 7, '禁报期拒绝并提示剩余天数'); }
const before = new Date(ban.bannedUntil);
await store.exec("INSERT INTO registration (id, activityId, studentId, status, registeredAt) VALUES (?, ?, ?, 'REGISTERED', ?)", [crypto.randomUUID(), upcoming.id, student.id, new Date()]);
await store.exec('UPDATE activity SET startsAt = ?, endsAt = ? WHERE id = ?', [new Date(Date.now() - 40 * 60 * 1000), new Date(Date.now() + 3600 * 1000), upcoming.id]);
await settleNoShows(store);
const after = (await store.rows('SELECT bannedUntil FROM account WHERE id = ?', [student.id], { bannedUntil: { codecId: 'mysql/datetime@1', nullable: true } }))[0].bannedUntil;
assert((new Date(after) - before) / DAY > 2.9, '禁报期内再旷一次按公式延长 3 天');

// 禁报到期重置
await store.exec('UPDATE account SET bannedUntil = ? WHERE id = ?', [new Date(Date.now() - 1000), student.id]);
const reset = await store.rows('SELECT noShowCount, bannedUntil FROM account WHERE id = ?', [student.id], { noShowCount: 'mysql/int@1', bannedUntil: { codecId: 'mysql/datetime@1', nullable: true } });
assert(reset[0].noShowCount === 4, '到期前计数保留');
const next = await publish({ title: '到期后可报名', type: 'POINT', points: 1, startsAt: iso(3 * 60 * 60 * 1000), endsAt: iso(4 * 60 * 60 * 1000) });
await registrations.register(student, next.id);
assert(true, '禁报到期后可再次报名');

// ---- 兑换过期返还 ----
await store.exec('INSERT INTO ledger_entry (id, studentId, unit, amount, kind, sourceId, reversesId, ruleSnapshot, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), student.id, 'POINT', 10, 'CREDIT', 'seed-credit', null, '{}', new Date()]);
const gift = await gifts.create(admin, { name: '测试礼品', points: 4, stock: 3 });
const redeemed = await gifts.redeem(student, gift.id, { requestId: crypto.randomUUID() });
assert(redeemed.order.status === 'RESERVED' && (await ledger.balance(student.id)).availablePoints === 6, '兑换扣减积分与库存');
await store.exec('UPDATE gift_order SET expiresAt = ? WHERE id = ?', [new Date(Date.now() - 1000), redeemed.order.id]);
assert(await expireOrders(store) === 1, '过期任务处理 1 笔订单');
const order = (await store.rows('SELECT status FROM gift_order WHERE id = ?', [redeemed.order.id], { status: 'mysql/text@1' }))[0];
assert(order.status === 'EXPIRED', '订单置为已过期');
assert((await ledger.balance(student.id)).availablePoints === 10, '过期返还积分');
const stock = (await store.rows('SELECT stock FROM gift WHERE id = ?', [gift.id], { stock: 'mysql/int@1' }))[0];
assert(stock.stock === 3, '过期返还库存');
assert(await expireOrders(store) === 0, '过期任务幂等');

await store.close();
console.log(`\n领域验收通过：${passed} 项断言`);