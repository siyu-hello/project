import { parse } from 'csv-parse/sync';
import { DomainError, requireText } from './security.mjs';
export const rosterColumns = ['学号', '姓名', '学院', '年级'];
export function parseRoster(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 65536) throw new DomainError(400, 'CSV 文件为空或超过64KB');
  let records;
  try { records = parse(csv, { bom: true, skip_empty_lines: true, trim: true }); }
  catch { throw new DomainError(400, 'CSV 格式错误'); }
  const header = records.shift() || [];
  const missing = rosterColumns.filter(c => !header.includes(c));
  if (missing.length) throw new DomainError(400, '名单缺少必填列', { missing });
  if (header.length !== 4 || new Set(header).size !== 4) throw new DomainError(400, '名单仅允许学号、姓名、学院、年级四列');
  if (!records.length || records.length > 20) throw new DomainError(400, '名单应为1至20行，超出账号池容量（20）');
  const seen = new Map();
  return records.map((record, index) => {
    if (record.length !== 4) throw new DomainError(400, '名单列数不一致', { row: index + 2 });
    const row = Object.fromEntries(header.map((c, n) => [c, requireText(record[n], `第${index + 2}行${c}`)]));
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(row.学号)) throw new DomainError(400, '学号格式错误', { row: index + 2 });
    if (seen.has(row.学号)) throw new DomainError(400, '文件内重复学号', { rows: [seen.get(row.学号), index + 2] });
    seen.set(row.学号, index + 2);
    return { identifier: row.学号, name: row.姓名, college: row.学院, grade: row.年级 };
  });
}
