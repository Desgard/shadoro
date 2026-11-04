const PLATFORM_LABELS = { xiaohongshu: '小红书', douyin: '抖音', wechat: '微信公众号' };
const TOP_RANK = 3;
const ANIMATED_FRAMES = 14;
const SNS_ICONS = {
  xiaohongshu: `<svg class="sns-icon" viewBox="0 0 64 64" role="img" aria-label="小红书" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" rx="14" fill="#ff2442"/>
    <text x="32" y="39.5" fill="#fff" font-size="16.5" font-weight="700" text-anchor="middle" font-family="-apple-system, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif">小红书</text>
  </svg>`,
};

const $ = (id) => document.getElementById(id);
const board = $('board');
const empty = $('empty');
const verdict = $('verdict');
const tabs = $('tabs');
const search = $('search');

let entries = [];
let platform = 'all';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 收录内容来自外部页面，只放行 http(s) 链接。 */
function link(href, text) {
  try {
    if (!['http:', 'https:'].includes(new URL(href).protocol)) return el('span', '', text);
  } catch {
    return el('span', '', text);
  }
  const anchor = el('a', '', text);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer nofollow';
  return anchor;
}

function pad(rank) {
  return String(rank).padStart(2, '0');
}

/** 并列同名次，与生成脚本的规则一致；筛选单个平台时重新计算。 */
function rerank(list) {
  let rank = 0;
  return list.map((entry, index) => {
    if (index === 0 || list[index - 1].count !== entry.count) rank = index + 1;
    return { ...entry, shownRank: rank };
  });
}

function matches(entry, query) {
  const fields = [entry.id, entry.alias, entry.name, ...entry.formerNames];
  return (
    fields.some((field) => field && field.toLowerCase().includes(query)) ||
    query.includes(entry.id.toLowerCase())
  );
}

/** 没有头像或图片加载失败时，显示昵称首字。 */
function renderAvatar(entry) {
  const box = el('span', 'avatar', Array.from(entry.name)[0] ?? '?');
  box.setAttribute('aria-hidden', 'true');
  if (entry.avatar) {
    const image = el('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = entry.avatar;
    image.addEventListener('error', () => image.remove());
    box.append(image);
  }
  return box;
}

function renderWork(work) {
  const item = el('li');
  const head = el('div', 'work-head');
  head.append(el('span', 'work-type', work.type), el('span', 'work-date', work.addedAt));
  if (work.title) head.append(el('span', 'work-title', work.title));
  const links = el('div', 'work-links');
  links.append(link(work.url, `被收录作品 ↗`), link(work.originalUrl, `原作 ↗`));
  item.append(head, links);
  if (work.note) item.append(el('p', 'work-note', work.note));
  return item;
}

function renderEntry(entry, index) {
  const frame = el('li', entry.shownRank <= TOP_RANK ? 'frame top' : 'frame');
  frame.style.setProperty('--i', Math.min(index, ANIMATED_FRAMES));

  const details = el('details');
  const summary = el('summary');
  const who = el('span', 'who');
  who.append(
    el('strong', '', entry.name),
    el('small', '', `${PLATFORM_LABELS[entry.platform]} · ${entry.alias || entry.id}`),
  );
  const count = el('span', 'count', entry.count);
  count.prepend(el('small', '', '做贼'));
  count.append(el('small', '', '次'));
  summary.append(renderAvatar(entry), el('span', 'rank', pad(entry.shownRank)), who, count);

  const evidence = el('div', 'evidence');
  const identity = el('p', 'identity');
  identity.append(`ID：${entry.id}`);
  if (entry.alias) identity.append(` · 平台号：${entry.alias}`);
  if (entry.formerNames.length) identity.append(` · 曾用名：${entry.formerNames.join('、')}`);
  identity.append(' · ', link(entry.profileUrl, '个人页 ↗'));
  const works = el('ul', 'works');
  works.append(...entry.works.map(renderWork));
  evidence.append(identity, works);

  details.append(summary, evidence);
  frame.append(details);
  return frame;
}

function renderTabs() {
  const options = [['all', '全部', entries.length]];
  for (const [key, label] of Object.entries(PLATFORM_LABELS)) {
    options.push([key, label, entries.filter((entry) => entry.platform === key).length]);
  }
  tabs.replaceChildren(
    ...options.map(([key, label, total]) => {
      const button = el('button', '', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(key === platform));
      button.append(el('span', '', total));
      button.addEventListener('click', () => {
        platform = key;
        search.value = '';
        render();
      });
      return button;
    }),
  );
}

function renderVerdict(query, found) {
  verdict.hidden = !query;
  if (!query) return;
  if (!found.length) {
    verdict.className = 'verdict miss';
    verdict.textContent = `未在榜：底片里没有“${query}”`;
    return;
  }
  verdict.className = 'verdict hit';
  verdict.textContent =
    found.length === 1
      ? `在榜：${found[0].name}，第 ${found[0].rank} 名，已收录 ${found[0].count} 次`
      : `在榜：找到 ${found.length} 个匹配账号`;
}

function render() {
  const query = search.value.trim();
  const needle = query.toLowerCase();
  // 查询始终覆盖全部平台，避免当前筛选造成“未在榜”的误判。
  if (query) platform = 'all';
  renderTabs();

  let shown;
  if (query) {
    shown = entries.filter((entry) => matches(entry, needle)).map((entry) => ({ ...entry, shownRank: entry.rank }));
  } else if (platform === 'all') {
    shown = entries.map((entry) => ({ ...entry, shownRank: entry.rank }));
  } else {
    shown = rerank(entries.filter((entry) => entry.platform === platform));
  }

  renderVerdict(query, shown);
  board.replaceChildren(...shown.map(renderEntry));
  empty.hidden = shown.length > 0 || Boolean(query);
  empty.textContent = '暗房里还没有这卷底片。';
}

function renderAuthor(author) {
  const cards = (author?.sns ?? []).map((sns) => {
    const card = link(sns.url, '');
    if (card.tagName !== 'A') return null;
    card.className = 'author-card';
    card.rel = 'noopener noreferrer';
    card.insertAdjacentHTML('afterbegin', SNS_ICONS[sns.platform] ?? '');
    const text = el('span', 'author-text');
    text.append(el('strong', '', sns.title ?? ''), el('small', '', sns.description ?? ''));
    card.append(text);
    if (sns.cta) card.append(el('span', 'author-cta', `${sns.cta} ↗`));
    return card;
  });
  $('author-cards').replaceChildren(...cards.filter(Boolean));
  $('author').hidden = !$('author-cards').children.length;
}

async function main() {
  search.addEventListener('input', render);
  try {
    const response = await fetch('leaderboard.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    entries = data.entries;
    renderAuthor(data.author);
    $('total-users').textContent = data.totalUsers;
    $('total-works').textContent = data.totalWorks;
    // 显影动画只在首次加载时播放，搜索和筛选时不重播。
    board.classList.add('developing');
    render();
    setTimeout(() => board.classList.remove('developing'), 2500);
  } catch (error) {
    console.error(error);
    empty.hidden = false;
    empty.textContent = '榜单加载失败，请稍后刷新。';
  }
}

main();
