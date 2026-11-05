// 给页面引用的 JS、CSS 加内容哈希。GitHub Pages 固定缓存 10 分钟，文件名不变时发布后可能读到旧资源。
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 被引用的文件排在引用它的文件之前：submit.js 引用 issue-url.js，哈希要算上这处引用。 */
const FILES = ['issue-url.js', 'style.css', 'app.js', 'submit.js', 'index.html', 'submit.html'];

/** 把 "app.js"、"./app.js" 这类引用改写为带版本号的形式，已有版本号时替换。 */
export function stampRefs(text, versions) {
  return text.replace(/(["'])((?:\.\/)?)([\w-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?\1/g, (match, quote, prefix, name) =>
    versions[name] ? `${quote}${prefix}${name}?v=${versions[name]}${quote}` : match,
  );
}

/** 返回每个文件带版本号后的内容，不写盘。 */
export async function renderAssets(docsDir) {
  const versions = {};
  const rendered = {};
  for (const name of FILES) {
    rendered[name] = stampRefs(await readFile(join(docsDir, name), 'utf8'), versions);
    versions[name] = createHash('sha256').update(rendered[name]).digest('hex').slice(0, 8);
  }
  return rendered;
}

export async function stampAssets(docsDir) {
  const rendered = await renderAssets(docsDir);
  for (const [name, text] of Object.entries(rendered)) await writeFile(join(docsDir, name), text);
}
