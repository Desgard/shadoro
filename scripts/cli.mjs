#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { removeAvatar, saveAvatar } from './avatar.mjs';
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
import { APPROVED_LABEL, GhError, closeIssue, isApproved, listOpenIssues, parseSubmission } from './issues.mjs';
import { buildLeaderboard } from './leaderboard.mjs';
import { loadStore, saveRecords } from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = join(ROOT, 'data', 'shadoro.yaml');
const DOCS_DIR = join(ROOT, 'docs');
const LEADERBOARD_PATH = join(DOCS_DIR, 'leaderboard.json');

const USAGE = `用法：
  npm run add -- <搬运链接> <原作链接> [选项]   收录一条（不带链接则逐项询问）
  npm run remove -- <搬运链接>                  撤销一条收录
  npm run avatar -- <个人页链接> <头像图片链接>  设置已收录账号的头像
  npm run sync                                  收录带「${APPROVED_LABEL}」标签的 Issue 并关闭，作品已收录的 Issue 也一并关闭
  npm run sync -- --issue <编号> --name <昵称> --profile <链接>
                                                自动提取失败时，手动指定某个 Issue 的发布者
  npm run build                                 由 data/shadoro.yaml 重新生成榜单

add 选项：
  --type <类型>         直接搬运、改图搬运、AI融图（或序号 1-3），默认 直接搬运
  --note <文字>         备注
  --date <YYYY-MM-DD>   收录日期，默认今天
  --name <昵称>         手动指定发布者昵称（自动提取失败时使用）
  --profile <链接>      手动指定发布者个人页
  --id <ID>             手动指定平台用户 ID（有个人页时可省略）
  --alias <ID>          小红书号 / 抖音号等可搜索的公开 ID
  --avatar <链接>       手动指定头像图片（自动提取失败时使用）`;

/** 手动指定发布者的选项，add 和 sync --issue 共用。 */
const USER_OPTIONS = ['name', 'profile', 'id', 'alias', 'avatar'];

/** 可预期的错误：单条命令以它退出，sync 则跳过当前 Issue 继续处理。 */
class CliError extends Error {}

const fail = (message) => {
  throw new CliError(message);
};

const isExpected = (error) => error instanceof CliError || error instanceof GhError;

async function save({ doc, author, records }) {
  const leaderboard = buildLeaderboard(records);
  await saveRecords(STORE_PATH, doc, records);
  await writeFile(LEADERBOARD_PATH, `${JSON.stringify({ author, ...leaderboard }, null, 2)}\n`);
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

/** 头像不影响收录，下载失败时只提示。 */
async function fetchAvatar(platform, userId, url) {
  if (!url) return '';
  try {
    return await saveAvatar(DOCS_DIR, platform, userId, url);
  } catch (error) {
    console.warn(`! 头像未保存：${error.message}，可稍后用 npm run avatar 补上`);
    return '';
  }
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

/** 在终端里提供询问函数，非终端环境传 null。 */
async function withPrompt(run) {
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    return await run(prompt ? (question) => prompt.question(question) : null);
  } finally {
    prompt?.close();
  }
}

/** 收录一条作品。返回收录结果，作品已存在时返回 { added: false }。 */
async function addRecord(rawWork, rawOriginal, values, ask) {
  const presetType = values.type === undefined ? null : normalizeType(values.type);
  if (values.type !== undefined && !presetType) fail(`--type 只能是 ${TYPES.join('、')}，或序号 1-3`);
  if (values.date && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) fail('--date 格式应为 YYYY-MM-DD');

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
  const originalPlatform = detectPlatform(originalUrl);
  const originalWork = originalPlatform ? canonicalWork(originalPlatform, originalUrl) : null;
  if (originalUrl === workUrl || originalWork?.key === work.key) fail('搬运链接与原作链接指向同一作品');

  const store = await loadStore(STORE_PATH);
  const { records } = store;
  const existing = records.find((r) => r.id === work.key || r.workUrl === work.url);
  if (existing) {
    console.log(`· 该作品已收录（${existing.addedAt}，${existing.user.name}），未重复计数`);
    return { added: false };
  }

  const type = presetType ?? (await askType(ask));

  let title = '';
  let workKey = work.key;
  let user;
  let source = 'auto';
  let avatarUrl = values.avatar ?? '';
  const hasManual = values.name && (values.profile || values.id);
  if (hasManual) {
    user = await manualUser(platform, values, null);
    source = 'manual';
  } else {
    try {
      const extracted = await extractWork(platform, workUrl);
      ({ title, user } = extracted);
      workKey = extracted.workKey ?? work.key;
      avatarUrl ||= extracted.avatarUrl;
      if (values.alias) user.alias = values.alias;
      if (records.some((r) => r.id === workKey)) {
        console.log('· 该作品已收录（同一作品的另一种链接），未重复计数');
        return { added: false };
      }
    } catch (error) {
      if (!(error instanceof ExtractError) && error.name !== 'TimeoutError' && error.name !== 'TypeError') throw error;
      console.warn(`! 自动提取失败：${error.message}，转手动录入`);
      user = await manualUser(platform, values, ask);
      source = 'manual';
      if (ask && !avatarUrl) avatarUrl = pickUrl(await ask('头像图片链接（可留空）：')) ?? '';
    }
  }

  // 已收录过的账号沿用原有的公开 ID 和头像；显式传 --avatar 时才重新下载。
  const known = records.findLast((r) => r.platform === platform && r.user.id === user.id)?.user;
  user.alias ||= known?.alias ?? '';
  const avatar = (!values.avatar && known?.avatar) || (await fetchAvatar(platform, user.id, avatarUrl));
  if (avatar) user.avatar = avatar;
  records.push({
    id: workKey,
    platform,
    type,
    title,
    workUrl: work.url,
    originalUrl: originalWork?.url ?? originalUrl,
    user,
    note: values.note ?? '',
    source,
    addedAt: values.date ?? today(),
  });
  const leaderboard = await save(store);
  const entry = leaderboard.entries.find((e) => e.key === `${platform}:${user.id}`);
  console.log(`✔ 已收录：${user.name}（${PLATFORMS[platform].label}）`);
  console.log(`  累计 ${entry.count} 次，当前第 ${entry.rank} 名（共 ${leaderboard.totalUsers} 人）`);
  console.log(`  个人页：${user.profileUrl}`);
  return { added: true, user, count: entry.count, platform };
}

async function add([rawWork, rawOriginal], values) {
  const result = await withPrompt((ask) => addRecord(rawWork, rawOriginal, values, ask));
  if (result.added) console.log('  提交并推送 data/ 与 docs/ 后，榜单页面即更新');
}

/** 收录一个 Issue 并关闭。关闭失败时下次运行会判定为已收录，再次关闭。 */
async function syncIssue(issue, ask, userOptions) {
  const { work, original, profile, type, note } = parseSubmission(issue.body);
  if (!pickUrl(work) || !pickUrl(original)) fail('正文里没有可识别的搬运链接和原作链接');
  const result = await addRecord(work, original, { type, note, profile: pickUrl(profile) ?? '', ...userOptions }, ask);
  await closeIssue(
    issue.number,
    result.added
      ? `已收录：${result.user.name}（${PLATFORMS[result.platform].label}），累计 ${result.count} 次。感谢提交。`
      : '该作品此前已收录，不重复计数。感谢提交。',
  );
  console.log(`✔ 已关闭 #${issue.number}`);
}

/** 作品已在数据里，说明维护者处理过，Issue 不必再等标签。 */
async function isRecorded(issue, records) {
  const input = pickUrl(parseSubmission(issue.body).work);
  if (!input) return false;
  const url = await resolveUrl(input);
  const platform = detectPlatform(url);
  const key = platform && canonicalWork(platform, url)?.key;
  return records.some((record) => record.id === key);
}

async function sync(values) {
  const userOptions = Object.fromEntries(USER_OPTIONS.filter((key) => values[key]).map((key) => [key, values[key]]));
  if (Object.keys(userOptions).length && !values.issue) fail('手动指定发布者时需要用 --issue 选定一个 Issue');
  const issues = await listOpenIssues();
  const { records } = await loadStore(STORE_PATH);
  const ready = await Promise.all(issues.map(async (issue) => isApproved(issue) || (await isRecorded(issue, records))));
  const runnable = issues.filter((_, index) => ready[index]);
  const approved = values.issue ? runnable.filter((issue) => String(issue.number) === values.issue) : runnable;
  if (values.issue && !approved.length) fail(`#${values.issue} 不是带「${APPROVED_LABEL}」标签的未关闭 Issue`);
  const waiting = issues.filter((issue, index) => !ready[index] && parseSubmission(issue.body).work);
  let skipped = 0;
  await withPrompt(async (ask) => {
    for (const issue of approved) {
      console.log(`\n#${issue.number} ${issue.title}\n  ${issue.url}`);
      try {
        await syncIssue(issue, ask, userOptions);
      } catch (error) {
        if (!isExpected(error)) throw error;
        console.error(`✖ 已跳过，Issue 保持打开：${error.message}`);
        skipped += 1;
      }
    }
  });
  console.log(`\n完成：处理 ${approved.length - skipped} 个，跳过 ${skipped} 个，${waiting.length} 个等待打「${APPROVED_LABEL}」标签`);
  for (const issue of waiting) console.log(`  #${issue.number} ${issue.title}  ${issue.url}`);
  if (skipped) console.log('被跳过的 Issue 可在 Claude Code 里运行 /issue-sync，由 AI 打开页面补全发布者信息');
  if (approved.length > skipped) console.log('提交并推送 data/ 与 docs/ 后，榜单页面即更新');
}

async function remove(positionals) {
  const input = pickUrl(positionals[0]);
  if (!input) fail(USAGE);
  const url = await resolveUrl(input);
  const platform = detectPlatform(url);
  const work = platform ? canonicalWork(platform, url) : null;
  const store = await loadStore(STORE_PATH);
  const { records } = store;
  const kept = records.filter((r) => r.id !== work?.key && r.workUrl !== work?.url);
  if (kept.length === records.length) fail(`未找到该收录：${url}`);
  await save({ ...store, records: kept });
  const inUse = new Set(kept.map((r) => r.user.avatar));
  for (const record of records) {
    if (!inUse.has(record.user.avatar)) await removeAvatar(DOCS_DIR, record.user.avatar);
  }
  console.log(`✔ 已撤销 ${records.length - kept.length} 条收录`);
}

async function setAvatar([rawProfile, rawImage]) {
  const profile = pickUrl(rawProfile);
  const image = pickUrl(rawImage);
  if (!profile || !image) fail(USAGE);
  const url = await resolveUrl(profile);
  const platform = detectPlatform(url);
  const id = platform ? userIdFromProfile(platform, url) : null;
  const store = await loadStore(STORE_PATH);
  const owned = store.records.filter((r) => r.platform === platform && r.user.id === id);
  if (!owned.length) fail(`榜单中没有该账号：${url}`);
  let avatar;
  try {
    avatar = await saveAvatar(DOCS_DIR, platform, id, image);
  } catch (error) {
    fail(error.message);
  }
  for (const record of owned) record.user.avatar = avatar;
  await save(store);
  console.log(`✔ 已更新头像：${owned[0].user.name}（${avatar}）`);
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
    avatar: { type: 'string' },
    issue: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, ...args] = positionals;

try {
  if (values.help || !command) console.log(USAGE);
  else if (command === 'add') await add(args, values);
  else if (command === 'remove') await remove(args);
  else if (command === 'sync') await sync(values);
  else if (command === 'avatar') await setAvatar(args);
  else if (command === 'build') console.log(`✔ 榜单共 ${(await save(await loadStore(STORE_PATH))).totalUsers} 人`);
  else fail(USAGE);
} catch (error) {
  if (!isExpected(error)) throw error;
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
