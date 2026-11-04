import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadStore, saveRecords } from '../scripts/store.mjs';

const SOURCE = `# 顶部注释
author:
  sns:
    - platform: xiaohongshu # 行内注释
      url: https://example.test/me
records: []
`;

async function tempStore(content) {
  const path = join(await mkdtemp(join(tmpdir(), 'shadoro-')), 'store.yaml');
  await writeFile(path, content);
  return path;
}

const record = {
  id: 'wechat:Mz==:1:1',
  platform: 'wechat',
  type: 'AI融图',
  title: '标题: 带冒号 # 和井号',
  workUrl: 'https://mp.weixin.qq.com/s?__biz=Mz%3D%3D&mid=1',
  originalUrl: 'https://example.test/' + 'x'.repeat(120),
  user: { id: 'Mz==', name: '12345', alias: '007', profileUrl: 'https://example.test/u' },
  note: '',
  source: 'auto',
  addedAt: '2026-11-04',
};

test('写回后记录不失真，注释和 author 保留', async () => {
  const path = await tempStore(SOURCE);
  const { doc } = await loadStore(path);
  await saveRecords(path, doc, [record]);
  const text = await readFile(path, 'utf8');
  assert.match(text, /# 顶部注释/);
  assert.match(text, /# 行内注释/);
  const loaded = await loadStore(path);
  assert.deepEqual(loaded.records, [record]);
  assert.equal(loaded.author.sns[0].platform, 'xiaohongshu');
});

test('手写的纯数字 ID 转为字符串', async () => {
  const path = await tempStore(`records:
  - addedAt: 2026-11-04
    user: { id: 123, name: 456, alias: 789 }
`);
  const { records } = await loadStore(path);
  assert.deepEqual(records[0].user, { id: '123', name: '456', alias: '789' });
  assert.equal(records[0].addedAt, '2026-11-04');
});

test('缺少 author、records 时取默认值', async () => {
  const { author, records } = await loadStore(await tempStore('# 空文件\n'));
  assert.equal(author, null);
  assert.deepEqual(records, []);
});

test('YAML 语法错误时报错而不是当作空数据', async () => {
  await assert.rejects(loadStore(await tempStore('records: [\n')), /格式错误/);
});
