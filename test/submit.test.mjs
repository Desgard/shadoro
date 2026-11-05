import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';
import { FIELD_IDS, buildIssueUrl, pickLink, validate } from '../docs/issue-url.js';

const values = {
  work: '看看这篇 https://www.xiaohongshu.com/explore/abc?a=1&b=2，复制后打开',
  profile: 'https://www.xiaohongshu.com/user/profile/u1',
  original: 'https://example.test/original',
  originalProfile: 'https://example.test/author',
  type: 'AI融图',
  note: '',
};

test('pickLink 从分享文案取出链接', () => {
  assert.equal(pickLink(values.work), 'https://www.xiaohongshu.com/explore/abc?a=1&b=2');
  assert.equal(pickLink('没有链接'), null);
});

test('validate 要求四个链接，且作品与原作、搬运者与原作者不同', () => {
  assert.equal(validate(values), null);
  assert.equal(validate({ ...values, profile: '' }).id, 'profile');
  assert.equal(validate({ ...values, originalProfile: '' }).id, 'originalProfile');
  assert.equal(validate({ ...values, originalProfile: values.profile }).id, 'originalProfile');
  assert.equal(validate({ ...values, original: 'abc' }).id, 'original');
  assert.equal(validate({ ...values, original: pickLink(values.work) }).id, 'original');
});

test('buildIssueUrl 指向模板并按字段 id 预填，转义特殊字符，跳过空字段', () => {
  const { origin, pathname, searchParams } = new URL(buildIssueUrl(values));
  assert.equal(`${origin}${pathname}`, 'https://github.com/Desgard/shadoro/issues/new');
  assert.equal(searchParams.get('template'), 'submission.yml');
  assert.equal(searchParams.get('title'), '[线索] AI融图 www.xiaohongshu.com');
  assert.equal(searchParams.get('work'), values.work);
  assert.equal(searchParams.get('type'), 'AI融图');
  assert.equal(searchParams.has('note'), false);
});

test('提交页面的字段与 Issue 模板保持一致', async () => {
  const template = parse(await readFile(new URL('../.github/ISSUE_TEMPLATE/submission.yml', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../docs/submit.html', import.meta.url), 'utf8');
  const inputs = template.body.filter((item) => item.id);
  assert.deepEqual(inputs.map((item) => item.id), FIELD_IDS);
  assert.deepEqual([...html.matchAll(/ id="\w+" name="(\w+)"/g)].map((match) => match[1]), FIELD_IDS);
  assert.deepEqual(
    [...html.matchAll(/<option>(.+?)<\/option>/g)].map((match) => match[1]),
    inputs.find((item) => item.id === 'type').attributes.options,
  );
  for (const item of inputs.filter((input) => input.type === 'input')) {
    assert.ok(html.includes(`${item.attributes.label} <em>必填</em>`), item.attributes.label);
  }
});
