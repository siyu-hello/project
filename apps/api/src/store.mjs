import mysql from '@prisma/orm-mysql/runtime';
import { contractFromJson } from '@prisma/orm-mysql/static';
import { param } from '@prisma/orm-mysql/relational-core';
import contractJson from '../prisma/contract.json' with { type: 'json' };
import { randomUUID } from 'node:crypto';
import { tokenHash } from './security.mjs';
const str = 'mysql/text@1', int = 'mysql/int@1', raw = 'mysql/datetime@1';
const nullable = codecId => ({ codecId, nullable: true });
const accountSpec = { id: str, identifier: str, name: str, college: nullable(str), grade: nullable(str), role: str, pool: str, passwordHash: str, wechatOpenid: nullable(str), enabled: int, mustChangePassword: int, failedAttempts: int, lockedUntil: nullable(raw), authorizationExpiresAt: nullable(raw), activityId: nullable(str), createdAt: raw };
const activitySpec = { id: str, publisherId: str, title: str, college: str, grade: str, status: str, startsAt: raw, endsAt: raw, capacity: int, enrolled: int };
// All templates and identifiers originate in this module. Values are driver parameters.
const utc = value => value instanceof Date ? value.toISOString().slice(0, 23).replace('T', ' ') : value;
const dates = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key, /(?:At|Until)$/.test(key) && typeof value === 'string' ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z') : value]));
export class MysqlStore {
  constructor(db, root = db) { this.db = db; this.root = root; }
  static async connect(url) {
    if (!url) throw new Error('DATABASE_URL is required');
    const db = mysql({ contract: contractFromJson(contractJson), url, verifyMarker: false, log: { query: false } });
    await db.connect();
    return new MysqlStore(db);
  }
  async close() { await this.root.close(); }
  plan(text, values = []) {
    const chunks = text.split('?');
    if (chunks.length !== values.length + 1) throw new Error('SQL parameter count mismatch');
    Object.defineProperty(chunks, 'raw', { value: [...chunks] });
    return this.db.raw.sql(chunks, ...values.map(value => value === null || value === undefined ? param(null, { codecId: str }) : utc(value)));
  }
  async rows(text, values, spec) { return (await this.db.query(this.plan(text, values).returnsRow(spec).build())).map(dates); }
  async exec(text, values = []) { return Number((await this.db.execute(this.plan(text, values).affectedCount().build())).affectedRows); }
  async transaction(callback) { return this.root.transaction(tx => callback(new MysqlStore(tx, this.root))); }
  async account(id) { return (await this.rows('SELECT * FROM account WHERE id = ?', [id], accountSpec))[0]; }
  async lockAccount(id) { await this.exec('UPDATE account SET failedAttempts = failedAttempts WHERE id = ?', [id]); return this.account(id); }
  async lockIdentifier(identifier) { await this.exec('UPDATE account SET failedAttempts = failedAttempts WHERE identifier = ?', [identifier]); return (await this.rows('SELECT * FROM account WHERE identifier = ?', [identifier], accountSpec))[0]; }
  async accounts() { return this.rows('SELECT * FROM account ORDER BY createdAt, id', [], accountSpec); }
  async accountsForWechat(openid) { return this.rows('SELECT * FROM account WHERE wechatOpenid = ? AND role <> ?', [openid, 'ADMIN'], accountSpec); }
  async session(hash) { return (await this.rows('SELECT accountId, expiresAt FROM session WHERE hash = ?', [hash], { accountId: str, expiresAt: raw }))[0]; }
  async createSession(session) { await this.exec('INSERT INTO session (hash, accountId, expiresAt) VALUES (?, ?, ?)', [session.hash, session.accountId, session.expiresAt]); }
  async deleteSessions(id) { await this.exec('DELETE FROM session WHERE accountId = ?', [id]); }
  async deleteSession(token) { await this.exec('DELETE FROM session WHERE hash = ?', [tokenHash(token)]); }
  async setFailures(id, count, until) { await this.exec('UPDATE account SET failedAttempts = ?, lockedUntil = ? WHERE id = ?', [count, until, id]); }
  async bindWechat(id, openid) { await this.exec('UPDATE account SET wechatOpenid = ? WHERE id = ? AND wechatOpenid IS NULL', [openid, id]); }
  async changePassword(id, hash) { await this.exec('UPDATE account SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [hash, id]); }
  async loginFailure(accountId, identifier, ip, reason) { await this.exec('INSERT INTO login_failure (id, accountId, identifier, ip, reason, occurredAt) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), accountId, identifier, ip || 'unknown', reason, new Date()]); }
  async audit(actorId, targetId, action, reason, before, after) { await this.exec('INSERT INTO audit (id, actorId, targetId, action, reason, beforeValue, afterValue, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), actorId, targetId, action, reason, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), new Date()]); }
  async audits() { return this.rows('SELECT id, actorId, targetId, action, reason, CAST(beforeValue AS CHAR) AS beforeValue, CAST(afterValue AS CHAR) AS afterValue, occurredAt FROM audit ORDER BY occurredAt DESC', [], { id: str, actorId: str, targetId: str, action: str, reason: str, beforeValue: nullable(str), afterValue: nullable(str), occurredAt: raw }); }
  async lockCapacity() { await this.exec('UPDATE capacity SET students = students WHERE id = 1'); }
  async identifiers(ids) {
    if (!ids.length) return [];
    return this.rows(`SELECT * FROM account WHERE identifier IN (${ids.map(() => '?').join(',')})`, ids, accountSpec);
  }
  async reserveCapacity(pool, count, limit) {
    if (!count) return true;
    if (!['students', 'staff'].includes(pool)) throw new Error('Invalid pool');
    return (await this.exec(`UPDATE capacity SET ${pool} = ${pool} + ? WHERE id = 1 AND ${pool} + ? <= ?`, [count, count, limit])) === 1;
  }
  async createAccount(a) {
    await this.exec('INSERT INTO account (id, identifier, name, college, grade, role, pool, passwordHash, enabled, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [a.id, a.identifier, a.name, a.college ?? null, a.grade ?? null, a.role, a.role === 'STUDENT' ? 'students' : a.role === 'ADMIN' ? 'admin' : 'staff', a.passwordHash, a.enabled ? 1 : 0, a.mustChangePassword ? 1 : 0, new Date()]);
  }
  async updateAccount(a) { await this.exec('UPDATE account SET role = ?, enabled = ?, authorizationExpiresAt = ?, activityId = ? WHERE id = ?', [a.role, a.enabled ? 1 : 0, a.authorizationExpiresAt, a.activityId, a.id]); }
  async activity(id) { return (await this.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0]; }
  async summary(id) {
    const rows = await this.rows('SELECT unit, CAST(SUM(amount) AS CHAR) AS total FROM ledger_entry WHERE studentId = ? GROUP BY unit', [id], { unit: str, total: str });
    return { availablePoints: Number(rows.find(r => r.unit === 'POINT')?.total || 0), volunteerMinutes: Number(rows.find(r => r.unit === 'MINUTE')?.total || 0), source: 'ledger_entry' };
  }
  async availableActivities(a) {
    const rows = await this.rows('SELECT * FROM activity WHERE status = ? AND college = ? AND grade = ? AND startsAt > ? AND enrolled < capacity ORDER BY startsAt, id', ['PUBLISHED', a.college, a.grade, new Date()], activitySpec);
    return rows.map(({ id, title, startsAt, endsAt, capacity, enrolled }) => ({ id, title, startsAt, endsAt, remainingCapacity: capacity - enrolled }));
  }
}
