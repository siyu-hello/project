import { randomUUID } from 'node:crypto';
import { DomainError, authorize } from './security.mjs';
import { activitySpec, publicActivity, str, int, raw, nullable, requireDate } from './domain.mjs';
import { banState, banDetails } from './bans.mjs';

const registrationSpec = { id: str, activityId: str, studentId: str, status: str, registeredAt: raw, cancelledAt: nullable(raw), checkedInAt: nullable(raw), checkedOutAt: nullable(raw) };
const mySpec = {
  id: str, status: str, registeredAt: raw, cancelledAt: nullable(raw), checkedInAt: nullable(raw), checkedOutAt: nullable(raw),
  activityId: str, title: str, type: str, points: nullable(int), college: str, grade: str, location: nullable(str),
  startsAt: raw, endsAt: raw, capacity: int, enrolled: int, activityStatus: str, checkinMode: str
};

export class RegistrationService {
  constructor(store) { this.store = store; }
  async register(actor, activityId) {
    authorize(actor, ['STUDENT']);
    const now = new Date();
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE account SET id = id WHERE id = ?', [actor.id]);
      const ban = await banState(tx, actor.id, now);
      if (ban.bannedUntil) throw new DomainError(403, '禁报期内不能报名', banDetails(ban, now));
      const activity = (await tx.rows('SELECT * FROM activity WHERE id = ?', [activityId], activitySpec))[0];
      if (!activity || activity.status !== 'PUBLISHED') throw new DomainError(400, '活动不可报名');
      if (now >= new Date(activity.startsAt)) throw new DomainError(400, '活动已开始，无法报名');
      if (activity.college !== actor.college || activity.grade !== actor.grade) throw new DomainError(403, '面向对象不符');
      const registration = (await tx.rows('SELECT * FROM registration WHERE activityId = ? AND studentId = ?', [activityId, actor.id], registrationSpec))[0];
      if (registration && registration.status !== 'CANCELLED') throw new DomainError(409, '已报名');
      const conflict = (await tx.rows("SELECT a.title, a.startsAt, a.endsAt FROM registration r JOIN activity a ON a.id = r.activityId WHERE r.studentId = ? AND r.status IN ('REGISTERED','CHECKED_IN') AND a.status = 'PUBLISHED' AND a.startsAt < ? AND a.endsAt > ? AND r.activityId <> ? LIMIT 1", [actor.id, activity.endsAt, activity.startsAt, activityId], { title: str, startsAt: raw, endsAt: raw }))[0];
      if (conflict) throw new DomainError(409, `与「${conflict.title}」时间冲突`, { title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt });
      const affected = await tx.exec('UPDATE activity SET enrolled = enrolled + 1 WHERE id = ? AND enrolled < capacity AND status = ?', [activityId, 'PUBLISHED']);
      if (affected !== 1) throw new DomainError(409, '名额已满');
      try {
        if (registration) {
          const reused = await tx.exec("UPDATE registration SET status = 'REGISTERED', registeredAt = ?, cancelledAt = NULL WHERE id = ? AND status = 'CANCELLED'", [now, registration.id]);
          if (reused !== 1) throw new DomainError(409, '已报名');
          await tx.audit(actor.id, actor.id, 'REGISTER', '学生重新报名', { status: 'CANCELLED' }, { activityId });
          return { ...registration, status: 'REGISTERED', registeredAt: now, cancelledAt: null };
        }
        const id = randomUUID();
        await tx.exec("INSERT INTO registration (id, activityId, studentId, status, registeredAt) VALUES (?, ?, ?, 'REGISTERED', ?)", [id, activityId, actor.id, now]);
        await tx.audit(actor.id, actor.id, 'REGISTER', '学生报名', null, { activityId, registrationId: id });
        return { id, activityId, studentId: actor.id, status: 'REGISTERED', registeredAt: now, cancelledAt: null, checkedInAt: null, checkedOutAt: null };
      } catch (error) {
        await tx.exec('UPDATE activity SET enrolled = enrolled - 1 WHERE id = ? AND enrolled > 0', [activityId]);
        throw error;
      }
    });
  }
  async cancel(actor, activityId) {
    authorize(actor, ['STUDENT']);
    const now = new Date();
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE account SET id = id WHERE id = ?', [actor.id]);
      const activity = (await tx.rows('SELECT * FROM activity WHERE id = ?', [activityId], activitySpec))[0];
      if (!activity) throw new DomainError(404, '活动不存在');
      const registration = (await tx.rows('SELECT * FROM registration WHERE activityId = ? AND studentId = ?', [activityId, actor.id], registrationSpec))[0];
      if (!registration || registration.status !== 'REGISTERED') throw new DomainError(409, '没有可取消的报名');
      if (now >= new Date(activity.startsAt)) throw new DomainError(409, '活动已开始，无法取消报名');
      const affected = await tx.exec("UPDATE registration SET status = 'CANCELLED', cancelledAt = ? WHERE id = ? AND status = 'REGISTERED'", [now, registration.id]);
      if (affected !== 1) throw new DomainError(409, '没有可取消的报名');
      await tx.exec('UPDATE activity SET enrolled = enrolled - 1 WHERE id = ? AND enrolled > 0', [activityId]);
      await tx.audit(actor.id, actor.id, 'REGISTER_CANCEL', '学生主动取消报名', { status: 'REGISTERED' }, { status: 'CANCELLED' });
      return { ...registration, status: 'CANCELLED', cancelledAt: now };
    });
  }
  async listMine(actor) {
    authorize(actor, ['STUDENT']);
    const rows = await this.store.rows('SELECT r.id, r.status, r.registeredAt, r.cancelledAt, r.checkedInAt, r.checkedOutAt, a.id AS activityId, a.title, a.type, a.points, a.college, a.grade, a.location, a.startsAt, a.endsAt, a.capacity, a.enrolled, a.status AS activityStatus, a.checkinMode FROM registration r JOIN activity a ON a.id = r.activityId WHERE r.studentId = ? ORDER BY a.startsAt DESC, r.id DESC', [actor.id], mySpec);
    return rows;
  }
}