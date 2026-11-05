import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderAssets, stampRefs } from '../scripts/assets.mjs';

const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));

test('stampRefs 写入版本号，重复运行时替换旧版本，不碰其他引用', () => {
  const versions = { 'app.js': 'abc12345', 'style.css': 'def67890' };
  const html = `<link href="style.css"><script src="app.js?v=00000000"></script><a href="submit.html"></a>`;
  assert.equal(
    stampRefs(html, versions),
    `<link href="style.css?v=def67890"><script src="app.js?v=abc12345"></script><a href="submit.html"></a>`,
  );
});

test('stampRefs 保留模块引用的相对路径', () => {
  assert.equal(stampRefs(`from './a.js';`, { 'a.js': '12345678' }), `from './a.js?v=12345678';`);
});

test('已提交的页面版本号是最新的，改过 docs 下的 JS、CSS 后要运行 npm run build', async () => {
  for (const [name, text] of Object.entries(await renderAssets(DOCS))) {
    assert.equal(await readFile(`${DOCS}${name}`, 'utf8'), text, name);
  }
});
