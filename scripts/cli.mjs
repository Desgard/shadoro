#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  PLATFORMS,
  TYPES,
  ExtractError,
  canonicalWork,
  detectPlatform,
  extractWork,
  normalizeType,
  pickUrl,
  profileUrl,
  resolveUrl,
  userIdFromProfile,
} from './extract.mjs';
import { buildLeaderboard } from './leaderboard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS_PATH = join(ROOT, 'data', 'records.json');
const LEADERBOARD_PATH = join(ROOT, 'docs', 'leaderboard.json');

const USAGE = `用法：
  npm run add -- <搬运链接> <原作链接> [选项]   收录一条（不带链接则逐项询问）
  npm run remove -- <搬运链接>                  撤销一条收录
  npm run build                                 由 data/records.json 重新生成榜单

add 选项：
  --type <类型>         直接搬运、改图搬运、AI融图（或序号 1-3），默认 直接搬运
  --note <文字>         备注
  --date <YYYY-MM-DD>   收录日期，默认今天
  --name <昵称>         手动指定发布者昵称（自动提取失败时使用）
  --profile <链接>      手动指定发布者个人页
  --id <ID>             手动指定平台用户 ID（有个人页时可省略）
  --alias <ID>          小红书号 / 抖音号等可搜索的公开 ID`;

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

async function loadRecords() {
  return JSON.parse(await readFile(RECORDS_PATH, 'utf8'));
}

async function save(records) {
  const leaderboard = buildLeaderboard(records);
  await writeFile(RECORDS_PATH, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(LEADERBOARD_PATH, `${JSON.stringify(leaderboard, null, 2)}\n`);
  return leaderboard;
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** 手动录入发布者。缺字段时在终端询问；非终端环境直接报错。 */
async function manualUser(platform, values, ask) {
  let { name, profile, id, alias } = values;
  if (ask) {
    profile ||= pickUrl(await ask('发布者个人页链接：')) ?? '';
    name ||= (await ask('发布者昵称：')).trim();
    alias ||= (await ask('公开 ID（小红书号/抖音号，可留空）：')).trim();
  }
  if (profile) profile = await resolveUrl(profile);
  id ||= profile ? userIdFromProfile(platform, profile) : '';
  if (!id && ask) id = (await ask('无法从个人页识别用户 ID，请输入：')).trim();
  if (!name || !id) fail('手动录入至少需要昵称，以及个人页链接或用户 ID（--name 与 --profile/--id）');
  return { id, name, alias: alias ?? '', profileUrl: profile || profileUrl(platform, id) };
}

/** 未指定 --type 时在终端询问，直接回车取第一项；非终端环境用默认值。 */
async function askType(ask) {
  if (!ask) return TYPES[0];
  const menu = TYPES.map((type, index) => `${index + 1}. ${type}`).join('  ');
  for (;;) {
    const answer = (await ask(`类型（${menu}，回车选 1）：`)).trim();
    const type = answer ? normalizeType(answer) : TYPES[0];
    if (type) return type;
  }
}

async function add(positionals, values) {
  const presetType = values.type === undefined ? null : normalizeType(values.type);
  if (values.type !== undefined && !presetType) fail(`--type 只能是 ${TYPES.join('、')}，或序号 1-3`);
  if (values.date && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) fail('--date 格式应为 YYYY-MM-DD');

  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = prompt ? (question) => prompt.question(question) : null;
  try {
    const [rawWork, rawOriginal] = positionals;
    const workInput = pickUrl(rawWork ?? (ask ? await ask('搬运作品链接（可粘贴分享文案）：') : ''));
    const originalUrl = pickUrl(rawOriginal ?? (ask ? await ask('原始作品链接：') : ''));
    if (!workInput || !originalUrl) fail(`需要搬运链接和原作链接两个参数\n\n${USAGE}`);

    const workUrl = await resolveUrl(workInput);
    const platform = detectPlatform(workUrl);
    if (!platform) {
      const supported = Object.values(PLATFORMS).map((p) => p.label).join('、');
      fail(`暂不支持该平台的搬运作品：${workUrl}\n目前支持：${supported}`);
    }
    const work = canonicalWork(platform, workUrl);
    if (!work) fail(`无法从链接识别作品：${workUrl}`);
    const originalKey = detectPlatform(originalUrl) && canonicalWork(detectPlatform(originalUrl), originalUrl)?.key;
    if (originalUrl === workUrl || originalKey === work.key) fail('搬运链接与原作链接指向同一作品');

    const records = await loadRecords();
    const existing = records.find((r) => r.id === work.key || r.workUrl === work.url);
    if (existing) {
      console.log(`· 该作品已收录（${existing.addedAt}，${existing.user.name}），未重复计数`);
      return;
    }

    const type = presetType ?? (await askType(ask));

    let title = '';
    let workKey = work.key;
    let user;
    let source = 'auto';
    const hasManual = values.name && (values.profile || values.id);
    if (hasManual) {
      user = await manualUser(platform, values, null);
      source = 'manual';
    } else {
      try {
        const extracted = await extractWork(platform, workUrl);
        ({ title, user } = extracted);
        workKey = extracted.workKey ?? work.key;
        if (values.alias) user.alias = values.alias;
        if (records.some((r) => r.id === workKey)) {
          console.log('· 该作品已收录（同一作品的另一种链接），未重复计数');
          return;
        }
      } catch (error) {
        if (!(error instanceof ExtractError) && error.name !== 'TimeoutError' && error.name !== 'TypeError') throw error;
        console.warn(`! 自动提取失败：${error.message}，转手动录入`);
        user = await manualUser(platform, values, ask);
        source = 'manual';
      }
    }

    records.push({
      id: workKey,
      platform,
      type,
      title,
      workUrl: work.url,
      originalUrl,
      user,
      note: values.note ?? '',
      source,
      addedAt: values.date ?? today(),
    });
    const leaderboard = await save(records);
    const entry = leaderboard.entries.find((e) => e.key === `${platform}:${user.id}`);
    console.log(`✔ 已收录：${user.name}（${PLATFORMS[platform].label}）`);
    console.log(`  累计 ${entry.count} 次，当前第 ${entry.rank} 名（共 ${leaderboard.totalUsers} 人）`);
    console.log(`  个人页：${user.profileUrl}`);
    console.log('  提交并推送 data/ 与 docs/ 后，榜单页面即更新');
  } finally {
    prompt?.close();
  }
}

async function remove(positionals) {
  const input = pickUrl(positionals[0]);
  if (!input) fail(USAGE);
  const url = await resolveUrl(input);
  const platform = detectPlatform(url);
  const work = platform ? canonicalWork(platform, url) : null;
  const records = await loadRecords();
  const kept = records.filter((r) => r.id !== work?.key && r.workUrl !== work?.url);
  if (kept.length === records.length) fail(`未找到该收录：${url}`);
  await save(kept);
  console.log(`✔ 已撤销 ${records.length - kept.length} 条收录`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    type: { type: 'string' },
    note: { type: 'string' },
    date: { type: 'string' },
    name: { type: 'string' },
    profile: { type: 'string' },
    id: { type: 'string' },
    alias: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, ...args] = positionals;

if (values.help || !command) console.log(USAGE);
else if (command === 'add') await add(args, values);
else if (command === 'remove') await remove(args);
else if (command === 'build') console.log(`✔ 榜单共 ${(await save(await loadRecords())).totalUsers} 人`);
else fail(USAGE);
