import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';
import { TYPES } from '../scripts/extract.mjs';
import { APPROVED_LABEL, FIELDS, isApproved, parseSubmission } from '../scripts/issues.mjs';

const form = (fields) => Object.entries(fields).map(([label, value]) => `### ${label}\n\n${value}\n`).join('\n');

test('parseSubmission 读取表单字段', () => {
  const body = form({
    搬运作品链接: 'https://www.xiaohongshu.com/explore/abc',
    原作链接: 'https://example.test/original',
    搬运者主页链接: 'https://www.xiaohongshu.com/user/profile/u1',
    原作者主页链接: 'https://example.test/author',
    类型: 'AI融图',
    备注: '第一行\n第二行',
  });
  assert.deepEqual(parseSubmission(body), {
    work: 'https://www.xiaohongshu.com/explore/abc',
    original: 'https://example.test/original',
    profile: 'https://www.xiaohongshu.com/user/profile/u1',
    originalProfile: 'https://example.test/author',
    type: 'AI融图',
    note: '第一行\n第二行',
  });
});

test('parseSubmission 把未填写的选填项视为空，兼容 CRLF', () => {
  const body = form({ 搬运作品链接: 'a', 备注: '_No response_' }).replaceAll('\n', '\r\n');
  const { work, original, note } = parseSubmission(body);
  assert.deepEqual({ work, original, note }, { work: 'a', original: '', note: '' });
});

test('parseSubmission 不让后文的同名标题覆盖前面的字段', () => {
  const body = form({ 搬运作品链接: 'a', 备注: '说明\n\n### 搬运作品链接\n\nb' });
  assert.equal(parseSubmission(body).work, 'a');
});

test('parseSubmission 容忍非表单正文', () => {
  assert.equal(parseSubmission('随便写的内容').work, '');
  assert.equal(parseSubmission(null).work, '');
});

test('isApproved 只认收录标签', () => {
  assert.equal(isApproved({ labels: [{ name: 'bug' }, { name: APPROVED_LABEL }] }), true);
  assert.equal(isApproved({ labels: [{ name: 'bug' }] }), false);
});

test('Issue 模板与解析字段、收录类型保持一致', async () => {
  const template = parse(await readFile(new URL('../.github/ISSUE_TEMPLATE/submission.yml', import.meta.url), 'utf8'));
  const inputs = template.body.filter((item) => item.id);
  assert.deepEqual(Object.fromEntries(inputs.map((item) => [item.id, item.attributes.label])), FIELDS);
  assert.deepEqual(inputs.find((item) => item.id === 'type').attributes.options, TYPES);
});
