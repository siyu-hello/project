import { randomUUID } from 'node:crypto';
import { applyNoShow } from './bans.mjs';
import { str, raw } from './domain.mjs';
import { expireOrders } from './gifts.mjs';

const candidateSpec = { id: str, activityId: str, studentId: str, startsAt: raw, endsAt: raw };

export async function settleNoShows(store, now = new Date(), limit = 200) {
  const due = await store.rows(`SELECT r.id, r.activityId, r.studentId, a.startsAt, a.endsAt FROM registration r JOIN activity a ON a.id = r.activityId
    WHERE r.status = 'REGISTERED' AND a.status = 'PUBLISHED' AND a.startsAt < ? AND NOT EXISTS (SELECT 1 FROM no_show n WHERE n.registrationId = r.id)
    ORDER BY a.startsAt ASC LIMIT ?`, [new Date(now.getTime() - 5 * 60 * 1000), limit], candidateSpec);
  let settled = 0;
  for (const row of due) {
    const done = await store.transaction(async tx => {
      const inserted = await tx.exec('INSERT IGNORE INTO no_show (id, activityId, studentId, registrationId, occurredAt) VALUES (?, ?, ?, ?, ?)', [randomUUID(), row.activityId, row.studentId, row.id, now]);
      if (inserted !== 1) return false;
      await applyNoShow(tx, row.studentId, now);
      return true;
    });
    if (done) settled += 1;
  }
  return settled;
}

export function startScheduler(store, { intervalMs = 30000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await settleNoShows(store);
      await expireOrders(store);
    } catch (error) {
      console.error('[scheduler]', error && error.message ? error.message : '任务失败');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}