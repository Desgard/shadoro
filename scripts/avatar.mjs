// 把账号头像下载到 docs/avatars/。平台 CDN 的链接可能失效或限制外站引用，页面只读本地副本。
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ExtractError } from './extract.mjs';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 2 * 1024 * 1024;

/** 下载头像，返回相对 docs/ 的路径。用户 ID 可能含 = 等字符，文件名取哈希。 */
export async function saveAvatar(docsDir, platform, userId, rawUrl) {
  const url = new URL(String(rawUrl).replace(/^(?:https?:)?\/\//, 'https://'));
  if (url.protocol !== 'https:') throw new ExtractError(`头像链接不是 http(s)：${rawUrl}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new ExtractError(`头像下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new ExtractError(`头像不是支持的图片格式：${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new ExtractError('头像超过 2 MB');

  const name = createHash('sha256').update(`${platform}:${userId}`).digest('hex').slice(0, 16);
  const relative = `avatars/${name}.${extension}`;
  await mkdir(join(docsDir, 'avatars'), { recursive: true });
  await writeFile(join(docsDir, relative), bytes);
  return relative;
}

/** 删除不再被任何记录引用的头像。 */
export async function removeAvatar(docsDir, avatar) {
  if (/^avatars\/[0-9a-f]{16}\.[a-z]+$/.test(avatar ?? '')) await rm(join(docsDir, avatar), { force: true });
}
