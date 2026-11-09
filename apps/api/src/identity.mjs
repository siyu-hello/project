import { randomUUID } from 'node:crypto';
import { DomainError, requireText, assertActive, authorize, hashPassword, verifyPassword, newToken, tokenHash } from './security.mjs';
import { parseRoster } from './roster.mjs';
const publicAccount = a => ({ id: a.id, identifier: a.identifier, name: a.name, college: a.college, grade: a.grade, role: a.role, enabled: Boolean(a.enabled), mustChangePassword: Boolean(a.mustChangePassword), authorizationExpiresAt: a.authorizationExpiresAt, activityId: a.activityId });
export class IdentityService {
  constructor(store, wechat, config = {}) { this.store = store; this.wechat = wechat; this.config = config; }
  async authenticate(token) {
    if (!token || typeof token !== 'string') throw new DomainError(401, '请先登录');
    const session = await this.store.session(tokenHash(token));
    if (!session || new Date(session.expiresAt) <= new Date()) throw new DomainError(401, '登录已过期');
    const account = await this.store.account(session.accountId);
    assertActive(account);
    if (account.activityId) {
      const activity = await this.store.activity(account.activityId);
      if (!activity || new Date(activity.endsAt) <= new Date()) throw new DomainError(403, '活动临时授权已到期');
    }
    return account;
  }
  async issue(tx, account) {
    await this.checkLogin(tx, account);
    const token = newToken();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await tx.createSession({ hash: tokenHash(token), accountId: account.id, expiresAt });
    return { token, expiresAt, account: publicAccount(account) };
  }
  async checkLogin(tx, account) {
    assertActive(account);
    if (account.lockedUntil && new Date(account.lockedUntil) > new Date()) throw new DomainError(423, '连续失败5次，账号锁定10分钟', { lockedUntil: account.lockedUntil, remainingSeconds: Math.ceil((new Date(account.lockedUntil) - Date.now()) / 1000) });
    if (account.activityId) {
      const activity = await tx.activity(account.activityId);
      if (!activity || new Date(activity.endsAt) <= new Date()) throw new DomainError(403, '活动临时授权已到期');
    }
  }
  async credentialFailure(tx, account, ip, status = 401, message = '账号或密码错误') {
    const failures = (account.lockedUntil ? 0 : account.failedAttempts) + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 600000) : null;
    await tx.setFailures(account.id, failures, lockedUntil);
    await tx.loginFailure(account.id, account.identifier, ip, 'INVALID_CREDENTIALS');
    return { error: new DomainError(lockedUntil ? 423 : status, lockedUntil ? '连续失败5次，账号锁定10分钟' : message, lockedUntil ? { lockedUntil, remainingSeconds: 600 } : undefined) };
  }
  async loginAdmin(input, ip) {
    const identifier = requireText(input.identifier, '账号', 40);
    const password = requireText(input.password, '密码', 128);
    return this.credentials({ identifier, password, ip, admin: true });
  }
  async loginWechat(input, ip) {
    const openid = await this.wechat.exchange(requireText(input.code, '微信code', 256));
    // One WeChat identity may own separate role accounts, never a merged role set.
    if (input.identifier !== undefined || input.password !== undefined) {
      return this.credentials({ identifier: requireText(input.identifier, '账号', 40), password: requireText(input.password, '初始密码', 128), ip, openid });
    }
    const accounts = await this.store.accountsForWechat(openid);
    const selected = input.accountId ? accounts.find(a => a.id === input.accountId) : accounts.length === 1 ? accounts[0] : null;
    if (!accounts.length) throw new DomainError(403, '账号尚未开通或绑定，请输入管理员提供的账号和初始密码');
    if (input.accountId && !selected) throw new DomainError(403, '无权使用该账号');
    if (!selected) return { selectAccount: accounts.map(a => ({ id: a.id, identifier: a.identifier, role: a.role })) };
    return this.store.transaction(async tx => {
      const current = await tx.lockAccount(selected.id);
      assertActive(current);
      return this.issue(tx, current);
    });
  }
  async credentials({ identifier, password, ip, admin = false, openid }) {
    // The account row is locked by a no-op UPDATE, supported by Prisma 8 MySQL raw SQL.
    const result = await this.store.transaction(async tx => {
      const account = await tx.lockIdentifier(identifier);
      if (!account || (admin ? account.role !== 'ADMIN' : account.role === 'ADMIN')) {
        await tx.loginFailure(null, identifier, ip, 'INVALID_CREDENTIALS');
        return { error: new DomainError(401, '账号或密码错误') };
      }
      await this.checkLogin(tx, account);
      if (!await verifyPassword(password, account.passwordHash)) {
        return this.credentialFailure(tx, account, ip);
      }
      assertActive(account);
      if (openid && account.wechatOpenid && account.wechatOpenid !== openid) {
        await tx.loginFailure(account.id, identifier, ip, 'ALREADY_BOUND');
        return { error: new DomainError(403, '账号已绑定其他微信，不能重新绑定') };
      }
      if (openid && !account.wechatOpenid) {
        await tx.bindWechat(account.id, openid);
        await tx.audit(account.id, account.id, 'WECHAT_BIND', '首次凭初始密码绑定', { bound: false }, { bound: true });
      }
      await tx.setFailures(account.id, 0, null);
      return this.issue(tx, { ...account, failedAttempts: 0, lockedUntil: null });
    });
    if (result.error) throw result.error;
    return result;
  }
  async changePassword(account, input, ip) {
    authorize(account, ['ADMIN'], { allowPasswordChange: true });
    const oldPassword = requireText(input.oldPassword, '原密码', 128);
    const password = requireText(input.newPassword, '新密码', 128);
    if (password.length < 10 || password === oldPassword) throw new DomainError(400, '新密码至少10字符且不能与原密码相同');
    const result = await this.store.transaction(async tx => {
      const current = await tx.lockAccount(account.id);
      await this.checkLogin(tx, current);
      if (!await verifyPassword(oldPassword, current.passwordHash)) return this.credentialFailure(tx, current, ip, 400, '原密码错误');
      await tx.changePassword(account.id, await hashPassword(password));
      await tx.setFailures(account.id, 0, null);
      await tx.deleteSessions(account.id);
      await tx.audit(account.id, account.id, 'PASSWORD_CHANGE', '管理员修改密码', { mustChangePassword: Boolean(current.mustChangePassword) }, { mustChangePassword: false });
      return this.issue(tx, { ...current, mustChangePassword: false, failedAttempts: 0, lockedUntil: null });
    });
    if (result.error) throw result.error;
    return result;
  }
  async importRoster(actor, input) {
    authorize(actor, ['ADMIN']);
    const rows = parseRoster(input.csv);
    const reason = requireText(input.reason, '原因', 500);
    const initial = requireText(this.config.initialPassword, '环境配置 INITIAL_ACCOUNT_PASSWORD', 128);
    return this.store.transaction(async tx => {
      await tx.lockCapacity();
      const existing = await tx.identifiers(rows.map(r => r.identifier));
      const conflicts = existing.filter(a => a.pool !== 'students');
      if (conflicts.length) throw new DomainError(409, '学号与独立角色账号冲突', { identifiers: conflicts.map(a => a.identifier) });
      const additions = rows.filter(r => !existing.some(a => a.identifier === r.identifier));
      if (!await tx.reserveCapacity('students', additions.length, 20)) throw new DomainError(409, '超出账号池容量（20）', { existing: existing.length });
      for (const row of additions) {
        const account = { ...row, id: randomUUID(), role: 'STUDENT', passwordHash: await hashPassword(initial), enabled: true, mustChangePassword: false };
        await tx.createAccount(account);
        await tx.audit(actor.id, account.id, 'ACCOUNT_CREATE', reason, null, publicAccount(account));
      }
      return { created: additions.length, existing: existing.length };
    });
  }
  async listAccounts(actor) { authorize(actor, ['ADMIN']); return (await this.store.accounts()).map(publicAccount); }
  async createAccount(actor, input) {
    authorize(actor, ['ADMIN']);
    if (!['PUBLISHER', 'REDEEMER'].includes(input.role)) throw new DomainError(400, '只允许创建独立发布者或核销员账号');
    const identifier = requireText(input.identifier, '账号', 40);
    if (!/^[A-Za-z0-9_-]+$/.test(identifier)) throw new DomainError(400, '账号格式错误');
    const reason = requireText(input.reason, '原因', 500);
    const account = { id: randomUUID(), identifier, name: requireText(input.name, '姓名'), role: input.role, passwordHash: await hashPassword(requireText(this.config.initialPassword, '环境配置 INITIAL_ACCOUNT_PASSWORD', 128)), enabled: true, mustChangePassword: false, college: null, grade: null };
    return this.store.transaction(async tx => {
      await tx.lockCapacity();
      if ((await tx.identifiers([identifier])).length) throw new DomainError(409, '账号已存在');
      if (!await tx.reserveCapacity('staff', 1, 10)) throw new DomainError(409, '发布者与核销员账号合计最多10个');
      await tx.createAccount(account);
      await tx.audit(actor.id, account.id, 'ACCOUNT_CREATE', reason, null, publicAccount(account));
      return publicAccount(account);
    });
  }
  async updateAccount(actor, id, input) {
    authorize(actor, ['ADMIN']);
    const reason = requireText(input.reason, '原因', 500);
    return this.store.transaction(async tx => {
      await tx.lockCapacity();
      const account = await tx.lockAccount(id);
      if (!account) throw new DomainError(404, '账号不存在');
      if (actor.id === id) throw new DomainError(403, '管理员不能回收或停用自身账号');
      if (account.role === 'ADMIN') throw new DomainError(403, '本模块不变更管理员账号');
      const role = input.role ?? account.role;
      if (!['STUDENT', 'PUBLISHER', 'REDEEMER', 'REVOKED'].includes(role)) throw new DomainError(400, '角色无效');
      // Original pool membership is immutable, including after revocation.
      if ((account.pool === 'students' && !['STUDENT', 'REVOKED'].includes(role)) || (account.pool === 'staff' && role === 'STUDENT')) throw new DomainError(400, '学生与发布者、核销员需分别建号');
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new DomainError(400, '停用状态必须为布尔值');
      let authorizationExpiresAt = account.authorizationExpiresAt, activityId = account.activityId;
      if (input.activityId === '' || role !== 'REDEEMER') { authorizationExpiresAt = null; activityId = null; }
      if (input.activityId) {
        if (role !== 'REDEEMER') throw new DomainError(400, '仅核销员可设置活动临时授权');
        const activity = await tx.activity(requireText(input.activityId, '活动ID', 36));
        if (!activity || new Date(activity.endsAt) <= new Date()) throw new DomainError(400, '临时授权活动不存在或已结束');
        authorizationExpiresAt = activity.endsAt; activityId = activity.id;
      }
      // 回收角色同时停用账号，避免 role 与 enabled 出现相互矛盾的状态。
      const enabled = role === 'REVOKED' ? false : input.enabled ?? Boolean(account.enabled);
      const updated = { ...account, role, enabled, authorizationExpiresAt, activityId };
      await tx.updateAccount(updated);
      await tx.audit(actor.id, id, 'ACCOUNT_UPDATE', reason, publicAccount(account), publicAccount(updated));
      return publicAccount(updated);
    });
  }
  async home(account, studentId = account.id) {
    authorize(account, ['STUDENT'], { studentId });
    const summary = await this.store.summary(account.id);
    const activities = await this.store.availableActivities(account);
    return { account: publicAccount(account), summary, activities };
  }
  async me(account) {
    authorize(account, ['STUDENT', 'PUBLISHER', 'REDEEMER', 'ADMIN'], { allowPasswordChange: true });
    return publicAccount(account);
  }
  async audits(actor) { authorize(actor, ['ADMIN']); return this.store.audits(); }
}
