// 图片上传：仅接受常见位图格式，按魔数校验后落盘到仓库根目录 uploads/，返回可直接访问的相对地址。
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || join(here, '../../..', 'uploads'));
const MAX_BYTES = 4 * 1024 * 1024;

const TYPES = {
  'image/png': { ext: '.png', magic: buf => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 },
  'image/jpeg': { ext: '.jpg', magic: buf => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  'image/webp': { ext: '.webp', magic: buf => buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP' },
  'image/gif': { ext: '.gif', magic: buf => buf.length > 6 && buf.subarray(0, 3).toString('ascii') === 'GIF' }
};

mkdirSync(UPLOAD_DIR, { recursive: true });

export async function saveImage(buffer, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const rule = TYPES[type];
  if (!rule) throw Object.assign(new Error('仅支持 PNG、JPEG、WebP、GIF 图片'), { status: 400 });
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('图片内容为空'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('图片不得超过 4MB'), { status: 400 });
  if (!rule.magic(buffer)) throw Object.assign(new Error('图片内容与格式不符'), { status: 400 });
  const name = randomUUID().replace(/-/g, '') + rule.ext;
  await writeFile(join(UPLOAD_DIR, name), buffer);
  return '/uploads/' + name;
}

export function isImageUrl(value) {
  return typeof value === 'string' && (value.startsWith('/uploads/') || /^https?:\/\//i.test(value));
}
export function isUploadedImage(value) {
  const match = /^\/uploads\/([a-z0-9_-]+\.(?:png|jpe?g|webp|gif))$/i.exec(value);
  return Boolean(match && existsSync(join(UPLOAD_DIR, match[1])));
}
