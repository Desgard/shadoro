// 从作品链接提取发布者。只发普通的公开页面请求：遇到登录页、验证页或无作者数据时
// 抛出 ExtractError，由 CLI 转入手动录入，不尝试绕过平台的反爬措施。

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const PLATFORMS = {
  xiaohongshu: { label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] },
  douyin: { label: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  wechat: { label: '微信公众号', hosts: ['mp.weixin.qq.com'] },
};

export const TYPES = ['直接搬运', '改图搬运', 'AI融图'];

/** 接受类型全名（不区分大小写）或序号 1-3，无法识别时返回 null。 */
export function normalizeType(input) {
  const value = String(input ?? '').trim().toLowerCase();
  return TYPES.find((type, index) => value === type.toLowerCase() || value === String(index + 1)) ?? null;
}

export class ExtractError extends Error {}

/**
 * 从粘贴内容中取出第一个链接，如「复制打开抖音 https://v.douyin.com/xx/ ...」。
 * 同时兼容终端转义的反斜杠，以及缺少协议头的三个平台链接。
 */
export function pickUrl(text) {
  const input = String(text ?? '').replace(/\\/g, '');
  const tail = String.raw`[^\s<>"'，。！？、；）】》]+`;
  const hosts = String.raw`(?:[\w-]+\.)*(?:xiaohongshu\.com|xhslink\.com|douyin\.com|iesdouyin\.com|mp\.weixin\.qq\.com)`;
  const match = input.match(new RegExp(`https?://${tail}|(?<![\\w.-])${hosts}/${tail}`));
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?)\]]+$/, '');
  return /^https?:/.test(url) ? url : `https://${url}`;
}

export function detectPlatform(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [platform, { hosts }] of Object.entries(PLATFORMS)) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return platform;
  }
  return null;
}

/** 由链接得到作品的规范形式；key 用于去重，url 用于榜单展示。短链解析前可能返回 null。 */
export function canonicalWork(platform, rawUrl) {
  const url = new URL(rawUrl);
  if (platform === 'xiaohongshu') {
    const id = url.pathname.match(/\/(?:explore|discovery\/item|note)\/([0-9a-f]{24})/i)?.[1];
    if (!id) return null;
    const token = url.searchParams.get('xsec_token');
    const query = token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_share` : '';
    return { key: `xiaohongshu:${id}`, url: `https://www.xiaohongshu.com/explore/${id}${query}` };
  }
  if (platform === 'douyin') {
    const modal = url.searchParams.get('modal_id');
    const hit = url.pathname.match(/\/(video|note|slides)\/(\d+)/);
    const id = hit?.[2] ?? modal;
    if (!id) return null;
    const kind = hit?.[1] === 'note' || hit?.[1] === 'slides' ? 'note' : 'video';
    return { key: `douyin:${id}`, url: `https://www.douyin.com/${kind}/${id}` };
  }
  const short = url.pathname.match(/^\/s\/([\w-]+)/)?.[1];
  if (short) return { key: `wechat:${short}`, url: `https://mp.weixin.qq.com/s/${short}` };
  const [biz, mid, idx, sn] = ['__biz', 'mid', 'idx', 'sn'].map((k) => url.searchParams.get(k));
  if (!biz || !mid) return null;
  const query = new URLSearchParams({ __biz: biz, mid, idx: idx ?? '1', sn: sn ?? '' });
  return { key: `wechat:${biz}:${mid}:${idx ?? '1'}`, url: `https://mp.weixin.qq.com/s?${query}` };
}

/** 由个人页链接推出用户 ID，保证手动录入与自动提取落到同一个人。 */
export function userIdFromProfile(platform, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (platform === 'xiaohongshu') return url.pathname.match(/\/user\/profile\/([0-9a-z]+)/i)?.[1] ?? null;
  if (platform === 'douyin') return url.pathname.match(/\/(?:user|share\/user)\/([\w-]+)/)?.[1] ?? null;
  return url.searchParams.get('__biz');
}

export function profileUrl(platform, id) {
  if (platform === 'xiaohongshu') return `https://www.xiaohongshu.com/user/profile/${id}`;
  if (platform === 'douyin') return `https://www.douyin.com/user/${id}`;
  return `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(id)}&scene=124#wechat_redirect`;
}

function parseEmbeddedJson(html, pattern, label) {
  const raw = html.match(pattern)?.[1];
  if (!raw) throw new ExtractError(`页面中没有${label}（可能被要求登录或验证）`);
  try {
    return JSON.parse(raw.replace(/([:[,])undefined(?=[,}\]])/g, '$1null'));
  } catch {
    throw new ExtractError(`${label}解析失败，页面结构可能已变化`);
  }
}

export function parseXiaohongshu(html, finalUrl) {
  if (new URL(finalUrl).pathname.startsWith('/login')) throw new ExtractError('小红书要求登录后才能查看');
  const state = parseEmbeddedJson(html, /window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s, '笔记数据');
  const details = state.note?.noteDetailMap ?? {};
  const note = (details[state.note?.currentNoteId] ?? Object.values(details)[0])?.note;
  if (!note?.user?.userId) throw new ExtractError('未找到笔记作者（笔记可能已删除或不可见）');
  return {
    title: note.title || note.desc?.slice(0, 40) || '',
    avatarUrl: note.user.avatar || '',
    user: {
      id: note.user.userId,
      name: note.user.nickname || note.user.nickName || note.user.userId,
      alias: '',
      profileUrl: profileUrl('xiaohongshu', note.user.userId),
    },
  };
}

export function parseDouyin(html) {
  const data = parseEmbeddedJson(html, /window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s, '作品数据');
  const pages = Object.values(data.loaderData ?? {});
  const item = pages.map((page) => page?.videoInfoRes?.item_list?.[0]).find(Boolean);
  const author = item?.author;
  if (!author?.sec_uid) throw new ExtractError('抖音分享页未返回作者信息');
  const alias = author.unique_id || (author.short_id && author.short_id !== '0' ? author.short_id : '');
  return {
    title: item.desc ?? '',
    avatarUrl: author.avatar_thumb?.url_list?.[0] ?? '',
    user: {
      id: author.sec_uid,
      name: author.nickname || alias || author.sec_uid,
      alias,
      profileUrl: profileUrl('douyin', author.sec_uid),
    },
  };
}

function decodeEntities(text) {
  return text
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseWechat(html) {
  const biz = html.match(/var biz\s*=\s*"([^"]+)"/)?.[1];
  const rawName =
    html.match(/var nickname\s*=\s*htmlDecode\("([^"]*)"\)/)?.[1] ?? html.match(/var nickname\s*=\s*"([^"]*)"/)?.[1];
  if (!biz || !rawName) throw new ExtractError('未找到公众号信息（文章可能已删除，或触发了环境验证）');
  const rawTitle = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '';
  // 同一篇文章有短链、长链两种形式，用 mid + idx 归一。
  const mid = html.match(/var mid\s*=\s*"(\d+)"/)?.[1];
  const idx = html.match(/var idx\s*=\s*"(\d+)"/)?.[1];
  return {
    workKey: mid && idx ? `wechat:${biz}:${mid}:${idx}` : undefined,
    title: decodeEntities(rawTitle),
    avatarUrl: html.match(/var round_head_img\s*=\s*"([^"]+)"/)?.[1] ?? '',
    user: {
      id: biz,
      name: decodeEntities(rawName),
      alias: html.match(/user_name\s*[:=]\s*['"](gh_[0-9a-z]+)['"]/i)?.[1] ?? '',
      profileUrl: profileUrl('wechat', biz),
    },
  };
}

async function fetchPage(url, userAgent) {
  const response = await fetch(url, {
    headers: { 'user-agent': userAgent, 'accept-language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ExtractError(`请求失败：HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

/** 把短链跟随到真实地址；失败时返回原链接，由调用方决定如何处理。 */
export async function resolveUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (host !== 'xhslink.com' && !host.endsWith('.xhslink.com') && host !== 'v.douyin.com') return url;
    const response = await fetch(url, {
      headers: { 'user-agent': MOBILE_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    return response.url || url;
  } catch {
    return url;
  }
}

/** 抓取并解析作品页。作者信息拿不到时抛 ExtractError。 */
export async function extractWork(platform, url) {
  if (platform === 'xiaohongshu') {
    const { html, finalUrl } = await fetchPage(url, DESKTOP_UA);
    return parseXiaohongshu(html, finalUrl);
  }
  if (platform === 'wechat') {
    return parseWechat((await fetchPage(url, DESKTOP_UA)).html);
  }
  // douyin.com 网页版返回 JS 挑战页，只读分享页。
  const parsed = new URL(url);
  let shareUrl = url;
  if (parsed.hostname !== 'www.iesdouyin.com') {
    const work = canonicalWork('douyin', url);
    if (!work) throw new ExtractError('无法识别抖音作品 ID');
    const [, kind, id] = new URL(work.url).pathname.split('/');
    shareUrl = `https://www.iesdouyin.com/share/${kind}/${id}/`;
  }
  return parseDouyin((await fetchPage(shareUrl, MOBILE_UA)).html);
}
