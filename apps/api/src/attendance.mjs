import { randomUUID } from 'node:crypto';
import { DomainError, authorize } from './security.mjs';
import { activitySpec, publicActivity, str, raw, nullable } from './domain.mjs';
import { ActivityService } from './activities.mjs';

const registrationSpec = { id: str, activityId: str, studentId: str, status: str, registeredAt: raw, checkedInAt: nullable(raw), checkedOutAt: nullable(raw) };
const WINDOW_MS = 5 * 60 * 1000;

export class AttendanceService {
  constructor(store, { checkinSecret = 'dev-checkin-secret' } = {}) { this.store = store; this.codes = new ActivityService(store, { checkinSecret }); }
  async credit(tx, activity, studentId, unit, amount, now) {
    const snapshot = { activityId: activity.id, title: activity.title, type: activity.type, points: activity.points, startsAt: activity.startsAt, endsAt: activity.endsAt };
    const inserted = await tx.exec('INSERT IGNORE INTO ledger_entry (id, studentId, unit, amount, kind, sourceId, reversesId, ruleSnapshot, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), studentId, unit, amount, 'CREDIT', activity.id, null, JSON.stringify(snapshot), now]);
    return inserted === 1 ? { unit, amount } : null;
  }
  async checkin(actor, activityId, input) {
    authorize(actor, ['STUDENT']);
    const now = new Date();
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE account SET id = id WHERE id = ?', [actor.id]);
      const activity = (await tx.rows('SELECT * FROM activity WHERE id = ? FOR UPDATE', [activityId], activitySpec))[0];
      if (!activity || activity.status !== 'PUBLISHED') throw new DomainError(400, '活动不可签到');
      const startsAt = new Date(activity.startsAt);
      if (now < new Date(startsAt.getTime() - WINDOW_MS)) throw new DomainError(400, '签到窗口未开始');
      if (now > new Date(startsAt.getTime() + WINDOW_MS)) throw new DomainError(400, '签到窗口已关闭');
      const registration = (await tx.rows('SELECT * FROM registration WHERE activityId = ? AND studentId = ?', [activityId, actor.id], registrationSpec))[0];
      if (!registration || registration.status === 'CANCELLED') throw new DomainError(400, '未报名本活动');
      if (registration.status !== 'REGISTERED') throw new DomainError(409, '已签到');
      const verdict = this.codes.verifyCode(activityId, input.code, now.getTime());
      if (verdict === 'EXPIRED') throw new DomainError(400, '签到码已失效');
      if (verdict !== 'OK') throw new DomainError(400, '签到码无效');
      const affected = await tx.exec("UPDATE registration SET status = 'CHECKED_IN', checkedInAt = ? WHERE id = ? AND status = 'REGISTERED'", [now, registration.id]);
      if (affected !== 1) throw new DomainError(409, '已签到');
      let credited = null;
      const completed = activity.checkinMode !== 'BOTH';
      if (completed) {
        await tx.exec("UPDATE registration SET status = 'COMPLETED' WHERE id = ? AND status = 'CHECKED_IN'", [registration.id]);
        credited = await this.credit(tx, activity, actor.id, 'POINT', activity.points, now);
      }
      await tx.audit(actor.id, actor.id, 'CHECKIN', '学生扫码签到', null, { activityId, registrationId: registration.id });
      return { registration: { ...registration, status: completed ? 'COMPLETED' : 'CHECKED_IN', checkedInAt: now }, activity: publicActivity(activity), credited };
    });
  }
  async checkout(actor, activityId, input = {}) {
    authorize(actor, ['STUDENT']);
    const now = new Date();
    const verdict = this.codes.verifyCode(activityId, input.code, now.getTime(), 'checkout');
    if (verdict === 'EXPIRED') throw new DomainError(400, '签退二维码已失效，请扫描现场最新二维码');
    if (verdict !== 'OK') throw new DomainError(400, '签退二维码无效，请扫描现场动态二维码');
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE account SET id = id WHERE id = ?', [actor.id]);
      const activity = (await tx.rows('SELECT * FROM activity WHERE id = ? FOR UPDATE', [activityId], activitySpec))[0];
      if (!activity) throw new DomainError(404, '活动不存在');
      if (activity.status !== 'PUBLISHED') throw new DomainError(400, '活动不可签退');
      if (activity.checkinMode !== 'BOTH') throw new DomainError(400, '该活动无需签退');
      const endsAt = new Date(activity.endsAt);
      if (now < new Date(endsAt.getTime() - WINDOW_MS)) throw new DomainError(400, '签退窗口未开始');
      if (now > new Date(endsAt.getTime() + WINDOW_MS)) throw new DomainError(400, '签退窗口已关闭');
      const registration = (await tx.rows('SELECT * FROM registration WHERE activityId = ? AND studentId = ?', [activityId, actor.id], registrationSpec))[0];
      if (!registration || registration.status === 'CANCELLED' || !registration.checkedInAt) throw new DomainError(400, '请先签到');
      if (registration.status !== 'CHECKED_IN') throw new DomainError(409, '已签退');
      const minutes = Math.round((now - new Date(registration.checkedInAt)) / 60000);
      if (minutes <= 0) throw new DomainError(400, '签退时间早于签到时间');
      const affected = await tx.exec("UPDATE registration SET status = 'COMPLETED', checkedOutAt = ?, checkedInAt = checkedInAt WHERE id = ? AND status = 'CHECKED_IN'", [now, registration.id]);
      if (affected !== 1) throw new DomainError(409, '已签退');
      const credited = activity.type === 'MINUTE'
        ? await this.credit(tx, activity, actor.id, 'MINUTE', minutes, now)
        : await this.credit(tx, activity, actor.id, 'POINT', activity.points, now);
      await tx.audit(actor.id, actor.id, 'CHECKOUT', '学生签退并入账', null, { activityId, minutes });
      return { registration: { ...registration, status: 'COMPLETED', checkedOutAt: now }, activity: publicActivity(activity), minutes, credited };
    });
  }
}