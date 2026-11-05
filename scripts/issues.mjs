// 读取并关闭 GitHub Issue。认证和仓库定位都交给 gh CLI，本地不保存 token。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class GhError extends Error {}

/** 维护者核实后打上这个标签，脚本才会收录。投稿者没有打标签的权限。 */
export const APPROVED_LABEL = '收录';

/** 与 .github/ISSUE_TEMPLATE/submission.yml 的字段 label 一一对应。 */
export const FIELDS = {
  work: '搬运作品链接',
  profile: '搬运者主页链接',
  original: '原作链接',
  originalProfile: '原作者主页链接',
  type: '类型',
  note: '备注',
};

/** 解析 Issue 表单生成的正文。同名标题以第一个为准，避免备注里的内容覆盖前面的字段。 */
export function parseSubmission(body) {
  const sections = new Map();
  let lines = null;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      lines = [];
      if (!sections.has(heading[1])) sections.set(heading[1], lines);
    } else {
      lines?.push(line);
    }
  }
  const read = (label) => {
    const value = (sections.get(label) ?? []).join('\n').trim();
    return value === '_No response_' ? '' : value;
  };
  return Object.fromEntries(Object.entries(FIELDS).map(([key, label]) => [key, read(label)]));
}

export const isApproved = (issue) => issue.labels.some((label) => label.name === APPROVED_LABEL);

async function gh(args) {
  try {
    return (await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new GhError('需要 GitHub CLI：brew install gh && gh auth login');
    throw new GhError(`gh ${args[0]} ${args[1]} 失败：${error.stderr?.trim() || error.message}`);
  }
}

/** 按编号升序返回所有未关闭的 Issue，先提交的先收录。 */
export async function listOpenIssues() {
  const output = await gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body,url,labels']);
  return JSON.parse(output).sort((a, b) => a.number - b.number);
}

export async function closeIssue(number, comment) {
  await gh(['issue', 'close', String(number), '--comment', comment]);
}
