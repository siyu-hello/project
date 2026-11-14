// 演示数据：幂等补齐发布者/核销员/学生、活动与礼品，不改动既有管理员密码。
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MysqlStore } from '../apps/api/src/store.mjs';
import { IdentityService } from '../apps/api/src/identity.mjs';
import { ActivityService } from '../apps/api/src/activities.mjs';
import { GiftService } from '../apps/api/src/gifts.mjs';

const store = await MysqlStore.connect(process.env.DATABASE_URL);
const identity = new IdentityService(store, {}, { initialPassword: '123456' });
const activities = new ActivityService(store, { checkinSecret: process.env.CHECKIN_SECRET || 'local-checkin-secret-2026' });
const gifts = new GiftService(store);

// 演示图片随仓库提供，首次运行时复制到 uploads，作为活动凭证与礼品图片。
const uploadDir = process.env.UPLOAD_DIR || fileURLToPath(new URL('../uploads', import.meta.url));
async function demoImage(name) {
  await mkdir(uploadDir, { recursive: true });
  const target = path.join(uploadDir, name);
  if (!existsSync(target)) await copyFile(fileURLToPath(new URL('../samples/images/' + name, import.meta.url)), target);
  return '/uploads/' + name;
}
const ACTIVITY_IMAGES = { '校园清洁志愿行动': 'activity-clean.png', '图书馆整理志愿服务': 'activity-library.png', '运动会志愿保障': 'activity-sports.png', '创新创业分享会': 'activity-talk.png', '即时签到演示': 'activity-clean.png', '现场签退演示': 'activity-sports.png' };
const GIFT_IMAGES = { '文创帆布袋': 'gift-bag.png', '定制笔记本': 'gift-notebook.png', '校徽徽章': 'gift-badge.png' };

const adminRow = (await store.rows("SELECT id FROM account WHERE role = 'ADMIN' ORDER BY createdAt ASC LIMIT 1", [], { id: 'mysql/text@1' }))[0];
if (!adminRow) throw new Error('请先初始化管理员账号');
const admin = await store.account(adminRow.id);
admin.mustChangePassword = false; // 仅内存中跳过首次改密校验，用于脚本化开通演示账号

async function ensureAccount(identifier, name, role) {
  const found = (await store.rows('SELECT id FROM account WHERE identifier = ?', [identifier], { id: 'mysql/text@1' }))[0];
  if (found) return store.account(found.id);
  try { return await identity.createAccount(admin, { identifier, name, role, reason: '演示数据初始化' }); }
  catch (error) { console.warn(`跳过 ${identifier}：${error.message}`); return null; }
}

const publisher = await ensureAccount('pub1', '李发布', 'PUBLISHER');
await ensureAccount('red1', '王核销', 'REDEEMER');

try {
  await identity.importRoster(admin, { csv: '学号,姓名,学院,年级\nS2026001,陈同学,计算机学院,26\nS2026002,林同学,计算机学院,26\nS2026003,赵同学,计算机学院,26', reason: '演示数据初始化' });
} catch (error) { console.warn(`学生名单导入跳过：${error.message}`); }

const student = (await store.rows("SELECT id FROM account WHERE identifier = 'S2026001'", [], { id: 'mysql/text@1' }))[0];
if (student) {
  const credit = (await store.rows("SELECT id FROM ledger_entry WHERE studentId = ? AND sourceId = 'demo-welcome'", [student.id], { id: 'mysql/text@1' }))[0];
  if (!credit) await store.exec("INSERT INTO ledger_entry (id, studentId, unit, amount, kind, sourceId, reversesId, ruleSnapshot, occurredAt) VALUES (?, ?, 'POINT', 10, 'CREDIT', 'demo-welcome', NULL, ?, ?)", [randomUUID(), student.id, JSON.stringify({ reason: '演示新生礼包', points: 10 }), new Date()]);
}

const now = Date.now();
const H = 3600 * 1000, D = 24 * H;
const samples = [
  { title: '校园清洁志愿行动', type: 'POINT', points: 3, description: '清理教学楼周边与绿化带垃圾，按实际参与记 3 积分。', college: '计算机学院', grade: '26', capacity: 20, location: '主楼南门集合', checkinMode: 'QR', startsAt: new Date(now + D + 9 * H), endsAt: new Date(now + D + 11 * H) },
  { title: '图书馆整理志愿服务', type: 'MINUTE', college: '计算机学院', grade: '26', capacity: 8, location: '图书馆三层', checkinMode: 'BOTH', startsAt: new Date(now + 2 * D + 14 * H), endsAt: new Date(now + 2 * D + 17 * H) },
  { title: '运动会志愿保障', type: 'MINUTE', college: '计算机学院', grade: '26', capacity: 12, location: '东区体育场', checkinMode: 'BOTH', startsAt: new Date(now + 3 * D + 8 * H), endsAt: new Date(now + 3 * D + 12 * H) },
  { title: '创新创业分享会', type: 'POINT', points: 2, description: '邀请校友分享创业经验，签到并全程参与记 2 分。', college: '计算机学院', grade: '26', capacity: 20, location: '报告厅', checkinMode: 'QR', startsAt: new Date(now + 4 * D + 19 * H), endsAt: new Date(now + 4 * D + 21 * H) }
];

if (publisher) {
  for (const sample of samples) {
    const evidenceUrl = ACTIVITY_IMAGES[sample.title] ? await demoImage(ACTIVITY_IMAGES[sample.title]) : 'demo://凭证';
    const existed = (await store.rows('SELECT id FROM activity WHERE title = ? AND publisherId = ?', [sample.title, publisher.id], { id: 'mysql/text@1' }))[0];
    if (existed) { await store.exec('UPDATE activity SET evidenceUrl = ? WHERE id = ?', [evidenceUrl, existed.id]); continue; }
    const created = await activities.create(publisher, { ...sample, evidenceUrl });
    if (sample.title !== '图书馆整理志愿服务') await activities.review(admin, created.id, { decision: 'APPROVED' });
    console.log(`活动已创建：${sample.title}${sample.title === '图书馆整理志愿服务' ? '（待审核）' : '（已发布）'}`);
  }
}

for (const item of [{ name: '文创帆布袋', points: 5, stock: 10, description: '校庆限定帆布袋' }, { name: '定制笔记本', points: 3, stock: 20, description: 'A5 硬壳笔记本' }, { name: '校徽徽章', points: 2, stock: 0, description: '金属校徽徽章' }]) {
  const imageUrl = GIFT_IMAGES[item.name] ? await demoImage(GIFT_IMAGES[item.name]) : undefined;
  const existed = (await store.rows('SELECT id FROM gift WHERE name = ?', [item.name], { id: 'mysql/text@1' }))[0];
  if (!existed) { await gifts.create(admin, { ...item, imageUrl }); console.log(`礼品已创建：${item.name}`); }
  else if (imageUrl) await gifts.update(admin, existed.id, { imageUrl, reason: '补齐演示图片' });
}

// 即时演示活动：每次运行刷新时间窗，便于现场演示签到/签退与入账。
const live = [
  { title: '即时签到演示', type: 'POINT', points: 2, description: '演示扫码签到与积分入账，窗口为开始前后 5 分钟。', startsAt: new Date(now + 5 * 60 * 1000), endsAt: new Date(now + 65 * 60 * 1000), checkinMode: 'QR' },
  { title: '现场签退演示', type: 'MINUTE', startsAt: new Date(now - 30 * 60 * 1000), endsAt: new Date(now + 5 * 60 * 1000), checkinMode: 'BOTH' }
];
if (publisher && student) {
  for (const item of live) {
    let row = (await store.rows('SELECT id FROM activity WHERE title = ? AND publisherId = ?', [item.title, publisher.id], { id: 'mysql/text@1' }))[0];
    const evidenceUrl = ACTIVITY_IMAGES[item.title] ? await demoImage(ACTIVITY_IMAGES[item.title]) : 'demo://即时演示';
    if (!row) {
      const created = await activities.create(publisher, { ...item, college: '计算机学院', grade: '26', capacity: 20, location: '演示场地', evidenceUrl });
      await activities.review(admin, created.id, { decision: 'APPROVED' });
      row = { id: created.id };
    }
    await store.exec("UPDATE activity SET status = 'PUBLISHED', reviewStatus = 'APPROVED', startsAt = ?, endsAt = ?, enrolled = 1, evidenceUrl = ? WHERE id = ?", [item.startsAt, item.endsAt, evidenceUrl, row.id]);
    if (item.title === '即时签到演示') await store.exec("INSERT INTO registration (id, activityId, studentId, status, registeredAt) VALUES (?, ?, ?, 'REGISTERED', ?) ON DUPLICATE KEY UPDATE status = 'REGISTERED', cancelledAt = NULL, checkedInAt = NULL, checkedOutAt = NULL, registeredAt = VALUES(registeredAt)", [randomUUID(), row.id, student.id, new Date()]);
    else await store.exec("INSERT INTO registration (id, activityId, studentId, status, registeredAt, checkedInAt) VALUES (?, ?, ?, 'CHECKED_IN', ?, ?) ON DUPLICATE KEY UPDATE status = 'CHECKED_IN', cancelledAt = NULL, checkedInAt = VALUES(checkedInAt), checkedOutAt = NULL", [randomUUID(), row.id, student.id, new Date(), new Date(now - 18 * 60 * 1000)]);
  }
  const wait = (await store.rows("SELECT id FROM activity WHERE title = '即时签到演示' AND publisherId = ?", [publisher.id], { id: 'mysql/text@1' }))[0];
  if (wait) console.log('即时演示活动已刷新：S2026001 可立即签到（即时签到演示）与签退（现场签退演示）');
}

console.log('演示数据就绪：pub1 / red1 / S2026001，初始密码 123456');
await store.close();