import { randomUUID, createHmac } from 'node:crypto';
import { DomainError, authorize, requireText } from './security.mjs';
import { activitySpec, publicActivity, requireDate, requireInt, text, optionalText, str, nullable, raw, int } from './domain.mjs';
import { isUploadedImage } from './uploads.mjs';

const reviewSpec = { id: str, decision: str, reason: nullable(str), snapshot: nullable(str), decidedAt: raw };
const queueSpec = { ...activitySpec, publisherName: str };

const PERIOD_MS = 10000;

function normalize(input, existing = null) {
  const type = existing ? existing.type : input.type;
  if (type !== 'POINT' && type !== 'MINUTE') throw new DomainError(400, '活动类型必须为积分或志愿时长');
  const title = text(input.title, '活动标题', 200);
  const college = text(input.college, '面向学院', 100);
  const grade = text(input.grade, '面向年级', 100);
  const location = text(input.location, '活动地点', 200);
  const evidenceUrl = text(input.evidenceUrl, '组织与盖章凭证', 500);
  if (!isUploadedImage(evidenceUrl)) throw new DomainError(400, '请上传活动凭证图片');
  const capacity = requireInt(input.capacity, '人数上限', 1, 20);
  const startsAt = requireDate(input.startsAt, '开始时间');
  const endsAt = requireDate(input.endsAt, '结束时间');
  if (endsAt <= startsAt) throw new DomainError(400, '结束时间必须晚于开始时间');
  if (endsAt - startsAt <= 10 * 60 * 1000) throw new DomainError(400, '活动时长必须大于10分钟');
  let points = null, description = optionalText(input.description, '分值说明', 2000);
  let checkinMode;
  if (type === 'MINUTE') {
    if (existing && input.points !== undefined && input.points !== null) throw new DomainError(400, '活动类型与分值创建后不可修改');
    checkinMode = 'BOTH';
  } else {
    points = requireInt(input.points ?? (existing ? existing.points : undefined), '积分分值', 1, 5);
    if (existing && input.points !== undefined && input.points !== existing.points) throw new DomainError(400, '活动类型与分值创建后不可修改');
    if (points === 5 && (!description || description.length < 20)) throw new DomainError(400, '5分活动的分值说明不得少于20字');
    checkinMode = input.checkinMode === 'BOTH' ? 'BOTH' : 'QR';
  }
  if (existing && input.type !== undefined && input.type !== existing.type) throw new DomainError(400, '活动类型与分值创建后不可修改');
  return { type, title, college, grade, location, evidenceUrl, capacity, startsAt, endsAt, points, description, checkinMode };
}

export class ActivityService {
  constructor(store, { checkinSecret = 'dev-checkin-secret' } = {}) { this.store = store; this.secret = checkinSecret; }
  async create(actor, input) {
    authorize(actor, ['PUBLISHER']);
    const a = normalize(input || {});
    const id = randomUUID(), now = new Date();
    return this.store.transaction(async tx => {
      await tx.exec('INSERT INTO activity (id, publisherId, title, type, points, description, college, grade, location, checkinMode, evidenceUrl, status, reviewStatus, startsAt, endsAt, capacity, enrolled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, actor.id, a.title, a.type, a.points, a.description, a.college, a.grade, a.location, a.checkinMode, a.evidenceUrl, 'PENDING', 'PENDING', a.startsAt, a.endsAt, a.capacity, 0, now, now]);
      await tx.audit(actor.id, actor.id, 'ACTIVITY_CREATE', '发布者提交活动', null, { id, title: a.title, type: a.type, points: a.points });
      return publicActivity({ ...a, id, publisherId: actor.id, status: 'PENDING', reviewStatus: 'PENDING', enrolled: 0, createdAt: now });
    });
  }
  async update(actor, id, input) {
    authorize(actor, ['PUBLISHER']);
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE activity SET id = id WHERE id = ?', [id]);
      const existing = (await tx.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
      if (!existing) throw new DomainError(404, '活动不存在');
      if (existing.publisherId !== actor.id) throw new DomainError(403, '仅可管理本人活动');
      if (existing.status !== 'PENDING') throw new DomainError(409, '已发布或已取消的活动不能修改');
      const a = normalize(input || {}, existing);
      const now = new Date();
      await tx.exec('UPDATE activity SET title = ?, description = ?, college = ?, grade = ?, location = ?, checkinMode = ?, evidenceUrl = ?, capacity = ?, startsAt = ?, endsAt = ?, reviewStatus = ?, reviewReason = NULL, reviewedBy = NULL, reviewedAt = NULL, updatedAt = ? WHERE id = ?',
        [a.title, a.description, a.college, a.grade, a.location, a.checkinMode, a.evidenceUrl, a.capacity, a.startsAt, a.endsAt, 'PENDING', now, id]);
      await tx.audit(actor.id, actor.id, 'ACTIVITY_UPDATE', '发布者修改后重新提交', publicActivity(existing), { id, title: a.title });
      return publicActivity({ ...existing, ...a, reviewStatus: 'PENDING', reviewReason: null });
    });
  }
  async listMine(actor) {
    authorize(actor, ['PUBLISHER']);
    const rows = await this.store.rows('SELECT * FROM activity WHERE publisherId = ? ORDER BY createdAt DESC, id DESC', [actor.id], activitySpec);
    return rows.map(a => publicActivity(a));
  }
  // 发布活动时的面向对象候选：只列出真实存在的学生学院/年级，避免手输不一致导致学生看不到活动。
  async targets(actor) {
    authorize(actor, ['PUBLISHER', 'ADMIN']);
    return this.store.rows("SELECT college, grade, COUNT(*) AS students FROM account WHERE role = 'STUDENT' AND enabled = 1 AND college IS NOT NULL AND college <> '' AND grade IS NOT NULL AND grade <> '' GROUP BY college, grade ORDER BY college ASC, grade ASC", [], { college: str, grade: str, students: int });
  }
  async list(actor, query = {}) {
    authorize(actor, ['STUDENT']);
    const type = query.type;
    if (type && !['POINT', 'MINUTE'].includes(type)) throw new DomainError(400, '活动类型无效');
    const params = ['PUBLISHED', actor.college, actor.grade, new Date()];
    let sql = 'SELECT * FROM activity WHERE status = ? AND college = ? AND grade = ? AND startsAt > ?';
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY startsAt ASC, id ASC';
    const rows = await this.store.rows(sql, params, activitySpec);
    return rows.map(a => publicActivity(a));
  }
  async detail(actor, id) {
    authorize(actor, ['STUDENT', 'PUBLISHER', 'ADMIN']);
    const a = (await this.store.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
    if (!a) throw new DomainError(404, '活动不存在');
    if (actor.role === 'STUDENT') {
      const registered = a.status === 'CANCELLED' && (await this.store.rows(
        'SELECT id FROM registration WHERE activityId = ? AND studentId = ?', [id, actor.id], { id: str }
      )).length > 0;
      const visible = a.status === 'PUBLISHED' && a.college === actor.college && a.grade === actor.grade;
      if (!visible && !registered) throw new DomainError(404, '活动不存在');
    }
    if (actor.role === 'PUBLISHER' && a.publisherId !== actor.id) throw new DomainError(403, '仅可查看本人活动');
    let reviews = [];
    if (actor.role === 'ADMIN' || a.publisherId === actor.id) reviews = await this.store.rows('SELECT id, decision, reason, snapshot, decidedAt FROM activity_review WHERE activityId = ? ORDER BY decidedAt ASC', [id], reviewSpec);
    return publicActivity(a, { serverTime: Date.now(), reviews: reviews.map(r => ({ ...r, snapshot: r.snapshot ? JSON.parse(r.snapshot) : null })) });
  }
  async reviewQueue(actor) {
    authorize(actor, ['ADMIN']);
    const rows = await this.store.rows("SELECT a.*, p.name AS publisherName FROM activity a JOIN account p ON p.id = a.publisherId WHERE a.status = 'PENDING' AND a.reviewStatus = 'PENDING' ORDER BY a.createdAt ASC, a.id ASC", [], queueSpec);
    return rows.map(a => publicActivity(a, { publisherName: a.publisherName }));
  }
  async review(actor, id, input) {
    authorize(actor, ['ADMIN']);
    const decision = input.decision;
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new DomainError(400, '审核结论无效');
    const reason = decision === 'REJECTED' ? requireText(input.reason, '驳回原因', 500) : optionalText(input.reason, '审核备注', 500);
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE activity SET id = id WHERE id = ?', [id]);
      const a = (await tx.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
      if (!a) throw new DomainError(404, '活动不存在');
      if (a.status !== 'PENDING' || a.reviewStatus !== 'PENDING') throw new DomainError(409, '该活动不在待审核状态');
      const now = new Date();
      await tx.exec('INSERT INTO activity_review (id, activityId, reviewerId, decision, reason, snapshot, decidedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), id, actor.id, decision, reason, JSON.stringify(publicActivity(a)), now]);
      if (decision === 'APPROVED') await tx.exec("UPDATE activity SET status = 'PUBLISHED', reviewStatus = 'APPROVED', reviewedBy = ?, reviewedAt = ?, publishedAt = ?, updatedAt = ? WHERE id = ?", [actor.id, now, now, now, id]);
      else await tx.exec("UPDATE activity SET reviewStatus = 'REJECTED', reviewReason = ?, reviewedBy = ?, reviewedAt = ?, updatedAt = ? WHERE id = ?", [reason, actor.id, now, now, id]);
      await tx.audit(actor.id, a.publisherId, 'ACTIVITY_REVIEW', reason || '审核通过', publicActivity(a), { id, decision });
      return publicActivity({ ...a, reviewStatus: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', status: decision === 'APPROVED' ? 'PUBLISHED' : 'PENDING', reviewReason: decision === 'REJECTED' ? reason : null, publishedAt: decision === 'APPROVED' ? now : a.publishedAt });
    });
  }
  async cancel(actor, id, input) {
    authorize(actor, ['PUBLISHER', 'ADMIN']);
    const reason = requireText(input.reason, '取消原因', 500);
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE activity SET id = id WHERE id = ?', [id]);
      const a = (await tx.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
      if (!a) throw new DomainError(404, '活动不存在');
      if (actor.role === 'PUBLISHER' && a.publisherId !== actor.id) throw new DomainError(403, '仅可管理本人活动');
      if (a.status === 'CANCELLED') throw new DomainError(409, '活动已取消');
      const now = new Date();
      await tx.exec("UPDATE activity SET status = 'CANCELLED', cancelReason = ?, updatedAt = ? WHERE id = ?", [reason, now, id]);
      await tx.audit(actor.id, a.publisherId, 'ACTIVITY_CANCEL', reason, publicActivity(a), { id, status: 'CANCELLED' });
      return publicActivity({ ...a, status: 'CANCELLED', cancelReason: reason });
    });
  }
  code(activityId, now = Date.now(), kind = 'checkin') {
    const period = Math.floor(now / PERIOD_MS);
    const code = createHmac('sha256', this.secret).update(`${activityId}:${kind}:${period}`).digest('hex').slice(0, 6).toUpperCase();
    const endsAt = (period + 1) * PERIOD_MS;
    return { code, period, periodEndsAt: new Date(endsAt), secondsLeft: Math.max(0, Math.ceil((endsAt - now) / 1000)) };
  }
  verifyCode(activityId, code, now = Date.now(), kind = 'checkin') {
    const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!/^[A-F0-9]{6}$/.test(clean)) return '无效';
    const period = Math.floor(now / PERIOD_MS);
    if (clean === this.code(activityId, now, kind).code) return 'OK';
    if (clean === this.code(activityId, now - PERIOD_MS, kind).code) return 'EXPIRED';
    return '无效';
  }
  async checkinCode(actor, id) {
    authorize(actor, ['PUBLISHER', 'ADMIN']);
    const a = (await this.store.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
    if (!a) throw new DomainError(404, '活动不存在');
    if (actor.role === 'PUBLISHER' && a.publisherId !== actor.id) throw new DomainError(403, '仅可管理本人活动');
    if (a.status !== 'PUBLISHED') throw new DomainError(409, '活动尚未发布');
    return { activityId: id, title: a.title, kind: 'checkin', type: a.type, ...this.code(id), periodMs: PERIOD_MS };
  }
  async checkoutCode(actor, id) {
    authorize(actor, ['PUBLISHER', 'ADMIN']);
    const a = (await this.store.rows('SELECT * FROM activity WHERE id = ?', [id], activitySpec))[0];
    if (!a) throw new DomainError(404, '活动不存在');
    if (actor.role === 'PUBLISHER' && a.publisherId !== actor.id) throw new DomainError(403, '仅可管理本人活动');
    if (a.status !== 'PUBLISHED') throw new DomainError(409, '活动尚未发布');
    if (a.checkinMode !== 'BOTH') throw new DomainError(400, '该活动无需签退');
    return { activityId: id, title: a.title, kind: 'checkout', type: a.type, ...this.code(id, Date.now(), 'checkout'), periodMs: PERIOD_MS };
  }
}