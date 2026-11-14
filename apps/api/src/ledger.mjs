import { DomainError, authorize } from './security.mjs';
import { str, int, raw, nullable } from './domain.mjs';

const entrySpec = { id: str, unit: str, amount: int, kind: str, sourceId: str, ruleSnapshot: nullable(str), occurredAt: raw };
const balanceSpec = { unit: str, total: str };
const PAGE_SIZE = 20;

export class LedgerService {
  constructor(store) { this.store = store; }
  async balance(studentId) {
    const rows = await this.store.rows('SELECT unit, CAST(SUM(amount) AS CHAR) AS total FROM ledger_entry WHERE studentId = ? GROUP BY unit', [studentId], balanceSpec);
    return { availablePoints: Number(rows.find(r => r.unit === 'POINT')?.total || 0), volunteerMinutes: Number(rows.find(r => r.unit === 'MINUTE')?.total || 0), source: 'ledger_entry' };
  }
  async entries(actor, page = 1) {
    authorize(actor, ['STUDENT']);
    const current = Math.max(1, Number(page) || 1);
    const total = Number((await this.store.rows('SELECT COUNT(*) AS c FROM ledger_entry WHERE studentId = ?', [actor.id], { c: int }))[0]?.c || 0);
    const rows = await this.store.rows('SELECT id, unit, amount, kind, sourceId, CAST(ruleSnapshot AS CHAR) AS ruleSnapshot, occurredAt FROM ledger_entry WHERE studentId = ? ORDER BY occurredAt DESC, id DESC LIMIT ? OFFSET ?', [actor.id, PAGE_SIZE, (current - 1) * PAGE_SIZE], entrySpec);
    const summary = await this.balance(actor.id);
    return {
      page: current, pageSize: PAGE_SIZE, total,
      summary,
      items: rows.map(r => ({ ...r, ruleSnapshot: r.ruleSnapshot ? JSON.parse(r.ruleSnapshot) : null }))
    };
  }
}