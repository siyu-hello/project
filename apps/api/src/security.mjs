import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [scheme, salt, hex] = String(encoded).split(':');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export class DomainError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export function requireText(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DomainError(400, `${label}不能为空且不得超过${max}字符`);
  return value.trim();
}
export function assertActive(account, now = new Date()) {
  if (!account || !account.enabled || account.role === 'REVOKED' || (account.authorizationExpiresAt && new Date(account.authorizationExpiresAt) <= now)) throw new DomainError(403, '账号已停用、角色已回收或授权已到期');
}
export function authorize(account, roles, { studentId, ownerId, allowPasswordChange = false } = {}) {
  assertActive(account);
  if (account.mustChangePassword && !allowPasswordChange) throw new DomainError(403, '首次登录请先修改密码');
  if (!roles.includes(account.role)) throw new DomainError(403, '无权访问');
  if (studentId && (account.role !== 'STUDENT' || account.id !== studentId)) throw new DomainError(403, '仅可访问本人数据');
  if (ownerId && account.role === 'PUBLISHER' && account.id !== ownerId) throw new DomainError(403, '仅可管理本人活动');
}
