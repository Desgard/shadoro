import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLeaderboard } from '../scripts/leaderboard.mjs';

const record = (platform, id, name, addedAt, extra = {}) => ({
  id: `${platform}:${addedAt}:${id}`,
  platform,
  type: '直接搬运',
  title: '',
  workUrl: `https://example.test/${addedAt}`,
  originalUrl: 'https://example.test/original',
  user: { id, name, alias: '', profileUrl: `https://example.test/u/${id}` },
  note: '',
  addedAt,
  ...extra,
});

test('按次数降序，所有人都在榜', () => {
  const { entries, totalUsers, totalWorks } = buildLeaderboard([
    record('douyin', 'a', 'A', '2026-01-01'),
    record('douyin', 'b', 'B', '2026-01-02'),
    record('douyin', 'b', 'B', '2026-01-03'),
    record('wechat', 'c', 'C', '2026-01-04'),
  ]);
  assert.deepEqual(entries.map((e) => [e.id, e.count]), [['b', 2], ['c', 1], ['a', 1]]);
  assert.equal(totalUsers, 3);
  assert.equal(totalWorks, 4);
});

test('并列同名次，下一名跳号', () => {
  const { entries } = buildLeaderboard([
    record('douyin', 'a', 'A', '2026-01-01'),
    record('douyin', 'a', 'A', '2026-01-02'),
    record('douyin', 'b', 'B', '2026-01-03'),
    record('douyin', 'b', 'B', '2026-01-04'),
    record('douyin', 'c', 'C', '2026-01-05'),
  ]);
  assert.deepEqual(entries.map((e) => e.rank), [1, 1, 3]);
});

test('不同平台的相同 ID 视为不同账号', () => {
  const { entries } = buildLeaderboard([record('douyin', 'x', 'X', '2026-01-01'), record('wechat', 'x', 'X', '2026-01-02')]);
  assert.equal(entries.length, 2);
});

test('昵称取最新值，旧昵称进入曾用名，alias 不被空值覆盖', () => {
  const first = record('douyin', 'a', '旧名', '2026-01-01');
  first.user.alias = 'dy_a';
  const [entry] = buildLeaderboard([record('douyin', 'a', '新名', '2026-02-01'), first]).entries;
  assert.equal(entry.name, '新名');
  assert.deepEqual(entry.formerNames, ['旧名']);
  assert.equal(entry.alias, 'dy_a');
  assert.equal(entry.works[0].addedAt, '2026-02-01');
});

test('每条作品带上各自的原作者，缺失时为 null', () => {
  const originalAuthor = { name: '原作者', profileUrl: 'https://example.test/u/o', avatar: 'avatars/o.webp' };
  const [entry] = buildLeaderboard([
    record('douyin', 'a', 'A', '2026-01-01'),
    record('douyin', 'a', 'A', '2026-01-02', { originalAuthor }),
  ]).entries;
  assert.deepEqual(entry.works.map((work) => work.originalAuthor), [originalAuthor, null]);
});

test('头像取最新的非空值', () => {
  const first = record('douyin', 'a', 'A', '2026-01-01');
  first.user.avatar = 'avatars/a.webp';
  const [entry] = buildLeaderboard([first, record('douyin', 'a', 'A', '2026-02-01')]).entries;
  assert.equal(entry.avatar, 'avatars/a.webp');
});
