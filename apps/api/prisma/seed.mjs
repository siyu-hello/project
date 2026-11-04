import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MysqlStore } from '../src/store.mjs';
import { hashPassword, requireText } from '../src/security.mjs';
export async function seedAdmin(store, identifier, password) {
  identifier = requireText(identifier, 'ADMIN_IDENTIFIER', 40); password = requireText(password, 'ADMIN_INITIAL_PASSWORD', 128);
  if (password.length < 10) throw new Error('ADMIN_INITIAL_PASSWORD must be at least 10 characters');
  const passwordHash = await hashPassword(password);
  return store.transaction(async tx => {
    await tx.lockCapacity();
    const existing = (await tx.identifiers([identifier]))[0];
    if (existing) {
      if (existing.role !== 'ADMIN' || existing.pool !== 'admin') throw new Error('ADMIN_IDENTIFIER conflicts with an existing non-administrator account');
      return;
    }
    const a = { id: randomUUID(), identifier, name: '超级管理员', role: 'ADMIN', passwordHash, enabled: true, mustChangePassword: true };
    await tx.createAccount(a); await tx.audit(a.id, a.id, 'ACCOUNT_CREATE', '环境配置初始化管理员', null, { role: 'ADMIN', mustChangePassword: true });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = await MysqlStore.connect(process.env.DATABASE_URL);
  try { await seedAdmin(store, process.env.ADMIN_IDENTIFIER, process.env.ADMIN_INITIAL_PASSWORD); console.log('Administrator initialized (existing account unchanged)'); } finally { await store.close(); }
}
