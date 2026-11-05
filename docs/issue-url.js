// 生成预填好的 GitHub Issue 链接。站点是静态页面，不持有 token，Issue 由提交者本人在 GitHub 上确认创建。
const NEW_ISSUE_URL = 'https://github.com/Desgard/shadoro/issues/new';
const TEMPLATE = 'submission.yml';

/** GitHub 对过长的链接返回 414，文档没有给出具体上限，这里取保守值。 */
export const MAX_URL_LENGTH = 8000;

/** 与 .github/ISSUE_TEMPLATE/submission.yml 的字段 id 一一对应。 */
export const FIELD_IDS = ['work', 'profile', 'original', 'originalProfile', 'type', 'note'];

/** 取出第一个链接，作品链接允许粘贴带链接的分享文案。 */
export function pickLink(text) {
  return String(text ?? '').match(/https?:\/\/[^\s<>"'，。！？、；）】》]+/i)?.[0] ?? null;
}

/** 返回第一个问题及其字段，全部通过时返回 null。 */
export function validate(values) {
  const required = [
    ['work', '搬运作品链接'],
    ['profile', '搬运者主页链接'],
    ['original', '原作链接'],
    ['originalProfile', '原作者主页链接'],
  ];
  for (const [id, label] of required) {
    if (!pickLink(values[id])) return { id, message: `${label}需要包含 http:// 或 https:// 开头的链接` };
  }
  if (pickLink(values.work) === pickLink(values.original)) {
    return { id: 'original', message: '搬运作品和原作不能是同一个链接' };
  }
  if (pickLink(values.profile) === pickLink(values.originalProfile)) {
    return { id: 'originalProfile', message: '搬运者和原作者不能是同一个账号' };
  }
  return null;
}

export function buildIssueUrl(values) {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set('template', TEMPLATE);
  url.searchParams.set('title', `[线索] ${values.type} ${new URL(pickLink(values.work)).hostname}`);
  for (const id of FIELD_IDS) {
    if (values[id]) url.searchParams.set(id, values[id]);
  }
  return url.href;
}
