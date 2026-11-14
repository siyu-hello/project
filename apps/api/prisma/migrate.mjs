import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MysqlStore } from '../src/store.mjs';
const int = 'mysql/int@1';

async function runFile(store, name) {
  const source = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
  // MySQL DDL autocommits; each statement is idempotent so an interrupted run resumes.
  for (const statement of source.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await store.exec(statement);
}

async function hasColumn(store, table, column) {
  const rows = await store.rows('SELECT 1 AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [table, column], { c: int });
  return rows.length > 0;
}

async function ensureColumn(store, table, column, definition) {
  if (!await hasColumn(store, table, column)) await store.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function ensureIndex(store, table, index, definition) {
  const rows = await store.rows('SELECT 1 AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [table, index], { c: int });
  if (!rows.length) await store.exec(`ALTER TABLE ${table} ADD ${definition}`);
}

// MySQL 8 没有 ADD COLUMN IF NOT EXISTS；按 information_schema 判断，保证重复执行安全。
async function migrate002(store) {
  const columns = [
    ['activity', 'type', "type ENUM('POINT','MINUTE') NOT NULL DEFAULT 'POINT' AFTER title"],
    ['activity', 'points', 'points INT NULL AFTER type'],
    ['activity', 'description', 'description TEXT NULL AFTER points'],
    ['activity', 'location', 'location VARCHAR(200) NULL AFTER grade'],
    ['activity', 'checkinMode', "checkinMode ENUM('QR','BOTH') NOT NULL DEFAULT 'QR' AFTER location"],
    ['activity', 'evidenceUrl', 'evidenceUrl VARCHAR(500) NULL AFTER checkinMode'],
    ['activity', 'reviewStatus', "reviewStatus ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' AFTER status"],
    ['activity', 'reviewReason', 'reviewReason VARCHAR(500) NULL AFTER reviewStatus'],
    ['activity', 'reviewedBy', 'reviewedBy VARCHAR(36) NULL'],
    ['activity', 'reviewedAt', 'reviewedAt DATETIME(3) NULL'],
    ['activity', 'publishedAt', 'publishedAt DATETIME(3) NULL'],
    ['activity', 'createdAt', 'createdAt DATETIME(3) NULL'],
    ['activity', 'updatedAt', 'updatedAt DATETIME(3) NULL'],
    ['activity', 'cancelReason', 'cancelReason VARCHAR(500) NULL'],
    ['account', 'noShowCount', 'noShowCount INT NOT NULL DEFAULT 0'],
    ['account', 'bannedUntil', 'bannedUntil DATETIME(3) NULL']
  ];
  for (const [table, column, definition] of columns) await ensureColumn(store, table, column, definition);
  await runFile(store, '002_activities.sql');
  await ensureIndex(store, 'ledger_entry', 'ledger_source', 'UNIQUE KEY ledger_source (studentId, unit, kind, sourceId)');
}

async function migrate003(store) {
  // 礼品封面图：站内上传后保存 /uploads/... 相对地址，小程序按服务地址拼接展示。
  await ensureColumn(store, 'gift', 'imageUrl', 'imageUrl VARCHAR(500) NULL AFTER description');
  await store.exec('INSERT IGNORE INTO schema_migration (name, appliedAt) VALUES (?, ?)', ['003_images', new Date()]);
}

export async function migrate(store, log = () => {}) {
  await runFile(store, '001_identity.sql');
  log('001_identity applied');
  await migrate002(store);
  log('002_activities applied');
  await migrate003(store);
  log('003_images applied');
  await store.exec('INSERT IGNORE INTO schema_migration (name, appliedAt) VALUES (?, ?)', ['001_identity', new Date()]);
  await store.exec('INSERT IGNORE INTO schema_migration (name, appliedAt) VALUES (?, ?)', ['002_activities', new Date()]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = await MysqlStore.connect(process.env.DATABASE_URL);
  try { await migrate(store, name => console.log(`${name} applied`)); console.log('Migrations applied'); } finally { await store.close(); }
}