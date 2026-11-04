import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MysqlStore } from '../src/store.mjs';
export async function migrate(store) {
  const source = await readFile(new URL('./migrations/001_identity.sql', import.meta.url), 'utf8');
  // MySQL DDL autocommits; each statement is idempotent so an interrupted run resumes.
  for (const statement of source.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await store.exec(statement);
  await store.exec('INSERT IGNORE INTO schema_migration (name, appliedAt) VALUES (?, ?)', ['001_identity', new Date()]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = await MysqlStore.connect(process.env.DATABASE_URL);
  try { await migrate(store); console.log('Identity migration applied'); } finally { await store.close(); }
}
