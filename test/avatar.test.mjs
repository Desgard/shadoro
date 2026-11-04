import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { removeAvatar, saveAvatar } from '../scripts/avatar.mjs';
import { ExtractError } from '../scripts/extract.mjs';

const realFetch = globalThis.fetch;
let dir;
let requested;

const stubImage = (type, bytes = 3) => {
  globalThis.fetch = async (url) => {
    requested = String(url);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': type } });
  };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shadoro-'));
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

test('saveAvatar 保存图片、升级到 https，文件名不含原始 ID', async () => {
  stubImage('image/webp; charset=binary');
  const path = await saveAvatar(dir, 'wechat', 'MzA4==', 'http://wx.qlogo.test/a');
  assert.equal(requested, 'https://wx.qlogo.test/a');
  assert.match(path, /^avatars\/[0-9a-f]{16}\.webp$/);
  assert.equal((await readFile(join(dir, path))).length, 3);
});

test('saveAvatar 拒绝非图片和过大的文件', async () => {
  stubImage('image/svg+xml');
  await assert.rejects(saveAvatar(dir, 'douyin', 'a', 'https://cdn.test/a'), ExtractError);
  stubImage('image/png', 2 * 1024 * 1024 + 1);
  await assert.rejects(saveAvatar(dir, 'douyin', 'a', 'https://cdn.test/a'), ExtractError);
});

test('removeAvatar 只删除 avatars 下生成的文件', async () => {
  stubImage('image/png');
  const path = await saveAvatar(dir, 'douyin', 'a', 'https://cdn.test/a');
  await removeAvatar(dir, '../leaderboard.json');
  await access(join(dir, path));
  await removeAvatar(dir, path);
  await assert.rejects(access(join(dir, path)));
});
