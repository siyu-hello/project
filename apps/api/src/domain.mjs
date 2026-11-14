import { DomainError } from './security.mjs';

export const str = 'mysql/text@1';
export const int = 'mysql/int@1';
export const raw = 'mysql/datetime@1';
export const nullable = codecId => ({ codecId, nullable: true });

export const activitySpec = {
  id: str, publisherId: str, title: str, type: str, points: nullable(int), description: nullable(str),
  college: str, grade: str, location: nullable(str), capacity: int, enrolled: int, status: str,
  reviewStatus: str, checkinMode: str, evidenceUrl: nullable(str), startsAt: raw, endsAt: raw,
  reviewReason: nullable(str), createdAt: raw, publishedAt: nullable(raw), cancelReason: nullable(str)
};

export function publicActivity(a, extra = {}) {
  if (!a) return null;
  return {
    id: a.id, publisherId: a.publisherId, title: a.title, type: a.type, points: a.points ?? null,
    description: a.description ?? '', college: a.college, grade: a.grade, location: a.location ?? '',
    capacity: a.capacity, enrolled: a.enrolled, remainingCapacity: Math.max(0, a.capacity - a.enrolled),
    status: a.status, reviewStatus: a.reviewStatus, reviewReason: a.reviewReason ?? null,
    checkinMode: a.checkinMode, evidenceUrl: a.evidenceUrl ?? '', startsAt: a.startsAt, endsAt: a.endsAt,
    createdAt: a.createdAt ?? null, publishedAt: a.publishedAt ?? null, cancelReason: a.cancelReason ?? null,
    ...extra
  };
}

export function requireDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new DomainError(400, `${label}格式错误`);
  return date;
}

export function requireInt(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new DomainError(400, `${label}必须是${min}到${max}的整数`);
  return value;
}

export function clampInt(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new DomainError(400, `${label}必须是${min}到${max}的整数`);
  return n;
}

export const DAY = 24 * 60 * 60 * 1000;

export async function lockRow(store, table, id) {
  await store.exec(`UPDATE ${table} SET id = id WHERE id = ?`, [id]);
}

export function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DomainError(400, `${label}不能为空且不得超过${max}字符`);
  return value.trim();
}

export function optionalText(value, label, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new DomainError(400, `${label}不得超过${max}字符`);
  return value.trim();
}