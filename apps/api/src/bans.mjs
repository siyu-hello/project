import { nullable, raw, int, DAY } from './domain.mjs';

const banSpec = { noShowCount: int, bannedUntil: nullable(raw) };

export async function banState(store, studentId, now = new Date()) {
  const row = (await store.rows('SELECT noShowCount, bannedUntil FROM account WHERE id = ?', [studentId], banSpec))[0];
  if (!row) return { count: 0, bannedUntil: null };
  if (row.bannedUntil && new Date(row.bannedUntil) <= now) {
    await store.exec('UPDATE account SET noShowCount = 0, bannedUntil = NULL WHERE id = ?', [studentId]);
    return { count: 0, bannedUntil: null };
  }
  return { count: row.noShowCount, bannedUntil: row.bannedUntil ? new Date(row.bannedUntil) : null };
}

// R-5：解除时间 = 触发时刻 + 7 天 + 3 天 × max(0, 计数 − 3)；计数 < 3 无禁报期。
export function banUntilFor(count, now = new Date()) {
  if (count < 3) return null;
  return new Date(now.getTime() + (7 + 3 * (count - 3)) * DAY);
}

export async function applyNoShow(store, studentId, now = new Date()) {
  await store.exec('UPDATE account SET id = id WHERE id = ?', [studentId]);
  const state = await banState(store, studentId, now);
  const count = state.count + 1;
  let bannedUntil = banUntilFor(count, now);
  if (state.bannedUntil && bannedUntil && state.bannedUntil > bannedUntil) bannedUntil = state.bannedUntil;
  await store.exec('UPDATE account SET noShowCount = ?, bannedUntil = ? WHERE id = ?', [count, bannedUntil, studentId]);
  return { count, bannedUntil };
}

export function banDetails(state, now = new Date()) {
  if (!state.bannedUntil) return null;
  const remainingDays = Math.max(1, Math.ceil((state.bannedUntil - now) / DAY));
  return { remainingDays, bannedUntil: state.bannedUntil, nextBanUntil: banUntilFor(state.count + 1, now) };
}