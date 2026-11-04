import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ExtractError,
  TYPES,
  canonicalWork,
  detectPlatform,
  normalizeType,
  parseDouyin,
  parseWechat,
  parseXiaohongshu,
  pickUrl,
  userIdFromProfile,
} from '../scripts/extract.mjs';

const XHS_ID = '69fc955e000000003700f8d6';
const XHS_URL = `https://www.xiaohongshu.com/explore/${XHS_ID}`;

test('normalizeType 接受全名、序号，不区分大小写', () => {
  assert.deepEqual(TYPES, ['直接搬运', '改图搬运', 'AI融图']);
  assert.equal(normalizeType('改图搬运'), '改图搬运');
  assert.equal(normalizeType(' ai融图 '), 'AI融图');
  assert.equal(normalizeType('1'), '直接搬运');
  assert.equal(normalizeType('3'), 'AI融图');
  assert.equal(normalizeType('洗稿'), null);
  assert.equal(normalizeType('4'), null);
  assert.equal(normalizeType(''), null);
});

test('pickUrl 从分享文案中取链接', () => {
  assert.equal(pickUrl('7.43 复制打开抖音，看看 https://v.douyin.com/AbCd/ 【作品】'), 'https://v.douyin.com/AbCd/');
  assert.equal(pickUrl('看这个 https://xhslink.com/a/xyz，太离谱了'), 'https://xhslink.com/a/xyz');
  assert.equal(pickUrl('没有链接'), null);
});

test('detectPlatform 不被相似域名欺骗', () => {
  assert.equal(detectPlatform('https://v.douyin.com/x'), 'douyin');
  assert.equal(detectPlatform('https://xhslink.com/x'), 'xiaohongshu');
  assert.equal(detectPlatform('https://mp.weixin.qq.com/s/x'), 'wechat');
  assert.equal(detectPlatform('https://notdouyin.com/x'), null);
  assert.equal(detectPlatform('https://weixin.qq.com/x'), null);
});

test('canonicalWork 让同一作品的不同链接得到同一 key', () => {
  const plain = canonicalWork('xiaohongshu', XHS_URL);
  const shared = canonicalWork('xiaohongshu', `https://www.xiaohongshu.com/discovery/item/${XHS_ID}?xsec_token=abc&x=1`);
  assert.equal(plain.key, shared.key);
  assert.match(shared.url, /xsec_token=abc/);
  assert.equal(
    canonicalWork('douyin', 'https://www.douyin.com/jingxuan?modal_id=123').key,
    canonicalWork('douyin', 'https://www.iesdouyin.com/share/video/123/?region=CN').key,
  );
  assert.equal(canonicalWork('douyin', 'https://www.douyin.com/note/9').url, 'https://www.douyin.com/note/9');
  assert.equal(canonicalWork('wechat', 'https://mp.weixin.qq.com/s/tok-1?scene=2').key, 'wechat:tok-1');
  assert.equal(canonicalWork('xiaohongshu', 'https://www.xiaohongshu.com/explore'), null);
});

test('userIdFromProfile 与自动提取的 ID 对齐', () => {
  assert.equal(userIdFromProfile('xiaohongshu', 'https://www.xiaohongshu.com/user/profile/abc123?x=1'), 'abc123');
  assert.equal(userIdFromProfile('douyin', 'https://www.douyin.com/user/MS4w_Ab-c?from=x'), 'MS4w_Ab-c');
  assert.equal(userIdFromProfile('wechat', 'https://mp.weixin.qq.com/mp/profile_ext?__biz=MzA4==&action=home'), 'MzA4==');
});

const xhsHtml = (state) => `<script>window.__INITIAL_STATE__=${state}</script>`;

test('parseXiaohongshu 取笔记作者，并容忍 undefined', () => {
  const state = `{"a":undefined,"note":{"currentNoteId":"n1","noteDetailMap":{"n1":{"note":{"title":"标题","user":{"userId":"u1","nickname":"测试作者"}}}}}}`;
  const { title, user } = parseXiaohongshu(xhsHtml(state), XHS_URL);
  assert.equal(title, '标题');
  assert.deepEqual(user, {
    id: 'u1',
    name: '测试作者',
    alias: '',
    profileUrl: 'https://www.xiaohongshu.com/user/profile/u1',
  });
});

test('parseXiaohongshu 对登录页和空笔记抛 ExtractError', () => {
  assert.throws(() => parseXiaohongshu('', 'https://www.xiaohongshu.com/login?redirectPath=x'), ExtractError);
  assert.throws(() => parseXiaohongshu('<html></html>', XHS_URL), ExtractError);
  assert.throws(() => parseXiaohongshu(xhsHtml('{"note":{"noteDetailMap":{}}}'), XHS_URL), ExtractError);
});

const dyHtml = (page) => `<script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { 'video_(id)/page': page } })}</script>`;

test('parseDouyin 取作者，抖音号优先于短 ID', () => {
  const page = { videoInfoRes: { item_list: [{ desc: '描述', author: { sec_uid: 'MS4w', nickname: '抖音测试', unique_id: 'dy_test', short_id: '0' } }] } };
  const { title, user } = parseDouyin(dyHtml(page));
  assert.equal(title, '描述');
  assert.deepEqual(user, { id: 'MS4w', name: '抖音测试', alias: 'dy_test', profileUrl: 'https://www.douyin.com/user/MS4w' });
});

test('parseDouyin 在无作者数据时抛 ExtractError（线上实测的情形）', () => {
  assert.throws(() => parseDouyin(dyHtml({ itemId: '1', isSpider: false })), ExtractError);
});

test('parseWechat 取公众号信息并解码实体', () => {
  const html = `<meta property="og:title" content="A &amp; B" />
    <script>var nickname = htmlDecode("测试&amp;公众号");
    var biz = "MzA4==" || "";
    var mid = "26" || "" || "";
    var idx = "1" || "" || "";
    d = { user_name: 'gh_0b9985a3da42', };</script>`;
  const { workKey, title, user } = parseWechat(html);
  assert.equal(workKey, 'wechat:MzA4==:26:1');
  assert.equal(title, 'A & B');
  assert.equal(user.id, 'MzA4==');
  assert.equal(user.name, '测试&公众号');
  assert.equal(user.alias, 'gh_0b9985a3da42');
});

test('parseWechat 对验证页抛 ExtractError', () => {
  assert.throws(() => parseWechat('<html>环境异常</html>'), ExtractError);
});
