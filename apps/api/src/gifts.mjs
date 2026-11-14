import { randomUUID, randomBytes } from 'node:crypto';
import { DomainError, authorize, requireText } from './security.mjs';
import { str, int, raw, nullable, text, optionalText, requireInt, DAY } from './domain.mjs';

const giftSpec = { id: str, name: str, description: nullable(str), imageUrl: nullable(str), points: int, stock: int, enabled: int, createdAt: raw, updatedAt: raw };
const orderSpec = { id: str, studentId: str, giftId: str, requestId: str, code: str, pointsCost: int, status: str, createdAt: raw, expiresAt: raw, redeemedAt: nullable(raw), redeemedBy: nullable(raw) };
const orderJoinSpec = () => ({ ...orderSpec, giftName: nullable(str) });
const textJoinSpec = { id: str, studentId: str, giftId: str, requestId: str, code: str, pointsCost: int, status: str, createdAt: str, expiresAt: str, redeemedAt: nullable(str), redeemedBy: nullable(str), giftName: nullable(str), giftImage: nullable(str) };
const ORDER_DAYS = 7;
const publicGift = g => ({ id: g.id, name: g.name, description: g.description ?? '', imageUrl: g.imageUrl ?? '', points: g.points, stock: g.stock, enabled: Boolean(g.enabled), soldOut: g.stock <= 0 });

// 只接受站内上传地址或 http(s) 外链，避免把任意脚本地址写进商城。
function optionalImage(value, label) {
  const url = optionalText(value, label, 500);
  if (!url) return null;
  if (!/^\/uploads\/[\w.-]+$/.test(url) && !/^https?:\/\//i.test(url)) throw new DomainError(400, `${label}必须是上传的图片地址`);
  return url;
}
const publicOrder = o => ({ id: o.id, giftId: o.giftId, giftName: o.giftName ?? null, giftImage: o.giftImage ?? null, code: o.code, pointsCost: o.pointsCost, status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt, redeemedAt: o.redeemedAt ?? null, redeemedBy: o.redeemedBy ?? null });

export class GiftService {
  constructor(store) { this.store = store; }
  async list(actor) {
    authorize(actor, ['STUDENT']);
    const rows = await this.store.rows('SELECT * FROM gift WHERE enabled = 1 ORDER BY points ASC, createdAt ASC', [], giftSpec);
    return rows.map(publicGift);
  }
  async adminList(actor) {
    authorize(actor, ['ADMIN']);
    return (await this.store.rows('SELECT * FROM gift ORDER BY createdAt DESC, id DESC', [], giftSpec)).map(publicGift);
  }
  async create(actor, input) {
    authorize(actor, ['ADMIN']);
    const gift = {
      id: randomUUID(), name: text(input.name, '礼品名称', 100), description: optionalText(input.description, '礼品说明', 500),
      imageUrl: optionalImage(input.imageUrl, '礼品图片'),
      points: requireInt(input.points, '所需积分', 1, 9999), stock: requireInt(input.stock, '库存', 0, 9999),
      enabled: input.enabled === false ? 0 : 1
    };
    const now = new Date();
    return this.store.transaction(async tx => {
      await tx.exec('INSERT INTO gift (id, name, description, imageUrl, points, stock, enabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [gift.id, gift.name, gift.description, gift.imageUrl, gift.points, gift.stock, gift.enabled, now, now]);
      await tx.audit(actor.id, actor.id, 'GIFT_CREATE', '新增礼品', null, publicGift(gift));
      return publicGift(gift);
    });
  }
  async update(actor, id, input) {
    authorize(actor, ['ADMIN']);
    const reason = requireText(input.reason, '变更原因', 500);
    return this.store.transaction(async tx => {
      await tx.exec('UPDATE gift SET id = id WHERE id = ?', [id]);
      const gift = (await tx.rows('SELECT * FROM gift WHERE id = ?', [id], giftSpec))[0];
      if (!gift) throw new DomainError(404, '礼品不存在');
      const next = {
        ...gift,
        name: input.name === undefined ? gift.name : text(input.name, '礼品名称', 100),
        description: input.description === undefined ? gift.description : optionalText(input.description, '礼品说明', 500),
        imageUrl: input.imageUrl === undefined ? gift.imageUrl : optionalImage(input.imageUrl, '礼品图片'),
        points: input.points === undefined ? gift.points : requireInt(input.points, '所需积分', 1, 9999),
        stock: input.stock === undefined ? gift.stock : requireInt(input.stock, '库存', 0, 9999),
        enabled: input.enabled === undefined ? gift.enabled : (input.enabled ? 1 : 0)
      };
      await tx.exec('UPDATE gift SET name = ?, description = ?, imageUrl = ?, points = ?, stock = ?, enabled = ?, updatedAt = ? WHERE id = ?', [next.name, next.description, next.imageUrl, next.points, next.stock, next.enabled, new Date(), id]);
      await tx.audit(actor.id, actor.id, 'GIFT_UPDATE', reason, publicGift(gift), publicGift(next));
      return publicGift(next);
    });
  }
  async redeem(actor, giftId, input) {
    authorize(actor, ['STUDENT']);
    const requestId = text(input.requestId, '请求号', 64);
    return this.store.transaction(async tx => {
      // 串行化余额判断，避免并发下单超扣积分。
      await tx.exec('UPDATE capacity SET students = students WHERE id = 1');
      const existing = (await tx.rows('SELECT * FROM gift_order WHERE studentId = ? AND giftId = ? AND requestId = ?', [actor.id, giftId, requestId], orderSpec))[0];
      if (existing) return { order: publicOrder(existing), duplicated: true };
      const gift = (await tx.rows('SELECT * FROM gift WHERE id = ?', [giftId], giftSpec))[0];
      if (!gift) throw new DomainError(404, '礼品不存在');
      if (!gift.enabled) throw new DomainError(400, '礼品已下架');
      const balance = Number((await tx.rows('SELECT CAST(COALESCE(SUM(amount), 0) AS CHAR) AS total FROM ledger_entry WHERE studentId = ? AND unit = ?', [actor.id, 'POINT'], { total: str }))[0]?.total || 0);
      if (balance < gift.points) throw new DomainError(400, '积分不足', { required: gift.points, available: balance });
      const stocked = await tx.exec('UPDATE gift SET stock = stock - 1, updatedAt = ? WHERE id = ? AND stock >= 1 AND enabled = 1', [new Date(), giftId]);
      if (stocked !== 1) throw new DomainError(409, '库存不足');
      const now = new Date(), orderId = randomUUID(), code = randomBytes(6).toString('hex').toUpperCase();
      const expiresAt = new Date(now.getTime() + ORDER_DAYS * DAY);
      await tx.exec('INSERT INTO ledger_entry (id, studentId, unit, amount, kind, sourceId, reversesId, ruleSnapshot, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), actor.id, 'POINT', -gift.points, 'REDEEM', orderId, null, JSON.stringify({ giftId, name: gift.name, points: gift.points, requestId }), now]);
      await tx.exec("INSERT INTO gift_order (id, studentId, giftId, requestId, code, pointsCost, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)", [orderId, actor.id, giftId, requestId, code, gift.points, now, expiresAt]);
      await tx.audit(actor.id, actor.id, 'GIFT_REDEEM', '学生兑换礼品', null, { orderId, giftId, points: gift.points });
      return { order: publicOrder({ id: orderId, giftId, giftName: gift.name, code, pointsCost: gift.points, status: 'RESERVED', createdAt: now, expiresAt }), duplicated: false };
    });
  }
  async myOrders(actor) {
    authorize(actor, ['STUDENT']);
    const rows = await this.store.rows("SELECT o.id, o.studentId, o.giftId, o.requestId, o.code, o.pointsCost, o.status, CAST(o.createdAt AS CHAR) AS createdAt, CAST(o.expiresAt AS CHAR) AS expiresAt, CAST(o.redeemedAt AS CHAR) AS redeemedAt, o.redeemedBy, g.name AS giftName, g.imageUrl AS giftImage FROM gift_order o JOIN gift g ON g.id = o.giftId WHERE o.studentId = ? ORDER BY o.createdAt DESC, o.id DESC", [actor.id], textJoinSpec);
    return rows.map(publicOrder);
  }
  async redeemByCode(actor, input) {
    authorize(actor, ['REDEEMER', 'ADMIN']);
    const code = String(input.code || '').trim().toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code)) throw new DomainError(400, '兑换码格式错误');
    return this.store.transaction(async tx => {
      const now = new Date();
      const order = (await tx.rows("SELECT o.id, o.studentId, o.giftId, o.requestId, o.code, o.pointsCost, o.status, CAST(o.createdAt AS CHAR) AS createdAt, CAST(o.expiresAt AS CHAR) AS expiresAt, CAST(o.redeemedAt AS CHAR) AS redeemedAt, o.redeemedBy, g.name AS giftName, g.imageUrl AS giftImage FROM gift_order o JOIN gift g ON g.id = o.giftId WHERE o.code = ?", [code], textJoinSpec))[0];
      if (!order) throw new DomainError(404, '兑换码不存在');
      if (order.status !== 'RESERVED') {
        if (order.status === 'REDEEMED') throw new DomainError(409, '该兑换码已核销', { redeemedAt: order.redeemedAt });
        if (order.status === 'EXPIRED') throw new DomainError(400, '订单已过期，积分已退回');
        throw new DomainError(400, '订单不可核销');
      }
      const affected = await tx.exec("UPDATE gift_order SET status = 'REDEEMED', redeemedAt = ?, redeemedBy = ? WHERE id = ? AND status = 'RESERVED'", [now, actor.id, order.id]);
      if (affected !== 1) throw new DomainError(409, '该兑换码已核销');
      await tx.audit(actor.id, order.studentId, 'ORDER_REDEEM', '核销员扫码核销', null, { orderId: order.id, code });
      return publicOrder({ ...order, status: 'REDEEMED', redeemedAt: now.toISOString(), redeemedBy: actor.id });
    });
  }
}

export async function expireOrders(store, now = new Date(), limit = 100) {
  const due = await store.rows("SELECT id FROM gift_order WHERE status = 'RESERVED' AND expiresAt <= ? ORDER BY expiresAt ASC LIMIT ?", [now, limit], { id: str });
  let expired = 0;
  for (const row of due) {
    const done = await store.transaction(async tx => {
      const affected = await tx.exec("UPDATE gift_order SET status = 'EXPIRED' WHERE id = ? AND status = 'RESERVED'", [row.id]);
      if (affected !== 1) return false;
      const order = (await tx.rows('SELECT * FROM gift_order WHERE id = ?', [row.id], orderSpec))[0];
      await tx.exec('INSERT IGNORE INTO ledger_entry (id, studentId, unit, amount, kind, sourceId, reversesId, ruleSnapshot, occurredAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), order.studentId, 'POINT', order.pointsCost, 'REFUND', order.id, null, JSON.stringify({ orderId: order.id, giftId: order.giftId, reason: 'EXPIRED' }), now]);
      await tx.exec('UPDATE gift SET stock = stock + 1, updatedAt = ? WHERE id = ?', [now, order.giftId]);
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}