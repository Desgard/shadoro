# 写真泥棒 Shadoro

**shadoro** 取自日语「写真泥棒（shashin dorobō）」，意为照片贼。这是一个部署在 GitHub Pages 上的静态站点，
收录小红书、抖音、微信公众号上搬运、洗稿他人作品的账号，按收录作品数排成黑榜，并可按 ID 查询。

线上地址：<https://desgard.github.io/shadoro/>

## 收录

需要 Node.js 20 及以上，首次使用先运行 `npm install`。

```bash
npm run add -- "<搬运作品链接>" "<原作链接>"
```

链接也可以直接粘贴 App 的分享文案（整段加引号），脚本会从中取出链接并跟随短链。原作可以是任意平台。
不带参数运行 `npm run add` 会逐项询问。在终端运行且未指定 `--type` 时，脚本会询问类型，直接回车选直接搬运。

脚本提取发布者和原作者的昵称、个人页和头像，写入 `data/shadoro.yaml`，重新生成 `docs/leaderboard.json`，
并输出此人的累计次数和名次。之后提交并推送即可更新线上榜单：

```bash
git add data docs && git commit -m "收录：<昵称>" && git push
```

常用选项：

| 选项 | 说明 |
| --- | --- |
| `--type <类型>` | `直接搬运`（默认）、`改图搬运`、`AI融图`，也可写序号 `1`-`3` |
| `--note "..."` | 备注，显示在榜单的对照记录中 |
| `--date 2026-11-04` | 收录日期，默认今天 |
| `--alias <ID>` | 小红书号、抖音号等公开 ID，可被搜索 |
| `--name <昵称> --profile <个人页>` | 手动指定发布者，跳过自动提取 |
| `--avatar <图片链接>` | 手动指定头像 |
| `--original-name <昵称>` | 手动指定原作者，跳过从原作页面提取 |
| `--original-profile <个人页>` | 原作者个人页 |
| `--original-avatar <图片链接>` | 原作者头像 |

撤销一条收录：`npm run remove -- "<搬运作品链接>"`，账号不再在榜时头像文件一并删除。

头像下载到 `docs/avatars/`，页面只读这份副本。自动提取拿不到时显示昵称首字，可以在浏览器打开账号个人页，复制头像图片地址后补上：

```bash
npm run avatar -- "<个人页链接>" "<头像图片链接>"
```

原作者显示在榜单展开后的每条作品里。没取到时收录照常完成，之后可以补全或修改：

```bash
npm run original -- "<搬运作品链接>" --original-name 昵称 --original-profile "<个人页>" --original-avatar "<头像图片链接>"
```

不带原作者选项时，脚本重新尝试从原作页面提取。

## 用 AI 客户端收录

项目带有通用的 Skill [`record-repost`](.agents/skills/record-repost/SKILL.md)。把搬运作品链接和原作链接发给 AI，它会控制浏览器读取两位作者的昵称、个人页和头像，再运行 `npm run add` 写入 `data/shadoro.yaml`。
类型默认是直接搬运，只有明确说明时才会改成其他类型。

| 客户端 | 接入方式 |
| --- | --- |
| Claude Code | 打开项目即可用，`.claude/skills/` 下是软链接 |
| Codex | 打开项目即可用，读取 `.agents/skills/` |
| WorkBuddy | 打开项目即可用，`.workbuddy/skills/` 下是软链接 |
| 只读 `AGENTS.md` 的客户端 | 由 [`AGENTS.md`](AGENTS.md) 指向 Skill |
| ChatGPT 网页版等不能访问本地文件的客户端 | 把 `SKILL.md` 的内容发给它，再把生成的命令拿到本地运行 |

Skill 只修改 `.agents/skills/record-repost/SKILL.md` 这一份。需要浏览器和命令行工具才能走完全程，缺浏览器时由脚本尝试提取，缺命令行时由 AI 给出命令。

## 通过 Issue 收录

任何人都可以在站点的[提交线索页面](https://desgard.github.io/shadoro/submit.html)，或直接用 Issue 模板「提交搬运线索」提交搬运链接、搬运者主页、原作链接、原作者主页和类型。
页面是静态的，不保存 token：点击提交后带着内容跳转到 GitHub 的 Issue 模板，由提交者登录后确认创建，因此需要 GitHub 账号。
Issue 不会直接进入榜单，要先由维护者核实。自动提取失败时，脚本优先使用 Issue 里的主页链接。

本地需要安装并登录 [GitHub CLI](https://cli.github.com/)，并创建一次 `收录` 标签：

```bash
brew install gh
```

```bash
gh auth login
```

```bash
gh label create 收录 --color B60205 --description "已核实，运行 npm run sync 时收录"
```

核实线索后给 Issue 打上 `收录` 标签，然后运行：

```bash
npm run sync
```

脚本遍历所有未关闭的 Issue，只处理带 `收录` 标签的，写入 `data/shadoro.yaml` 和 `docs/leaderboard.json` 后，留言并关闭 Issue。
Issue 必须取到原作者昵称才会收录，否则跳过并保持打开。已收录过的作品不重复计数，同样关闭；作品已在数据里的 Issue 即使没打标签也会关闭，比如用 `npm run add` 手动收录过的线索。自动提取失败时会在终端询问发布者信息，直接回车可跳过，Issue 保持打开。
已收录过的账号沿用原有的公开 ID 和头像，要换头像用 `npm run avatar`。

小红书常常要求登录，脚本遇到这种情况不会绕过，只会跳过。这时在 Claude Code 里运行 `/issue-sync`：
AI 先跑一遍 sync，再用本地浏览器打开被跳过的页面读取搬运者和原作者的昵称、头像，核对两者不同后完成收录。
也可以自己查好后手动指定：

```bash
npm run sync -- --issue 1 --name 昵称 --profile 个人页链接 --original-name 原作者昵称 --original-profile 原作者个人页链接
```

脚本不会自动提交，运行结束后照常提交并推送 `data/` 和 `docs/`。
## 数据

所有数据都在 [`data/shadoro.yaml`](data/shadoro.yaml)：`records` 是收录记录，`author` 是页面底部的作者链接。
GitHub Pages 只发布 `docs/`，页面读取的是由 YAML 生成的 `docs/leaderboard.json`，这个文件不要手改。
手动改过 YAML 后运行 `npm run build`，再提交 `data/` 和 `docs/`。

在 `author.sns` 下增加条目就能增加作者链接，每一条共用 `author.avatar` 头像。

### 各平台提取情况

| 平台 | 自动提取 | 说明 |
| --- | --- | --- |
| 微信公众号 | 名称、`__biz`、`gh_` 原始 ID、头像 | 个人页链接只能在微信内打开 |
| 小红书 | 昵称、用户 ID、头像 | 小红书号要登录才可见，需要时用 `--alias` 补 |
| 抖音 | 解析分享页，失败时手动录入 | 多数情况下需要手动补昵称和个人页 |

脚本只发普通的公开页面请求，遇到登录页、验证页或页面缺少作者数据时不会尝试绕过，而是转为手动录入。
在终端运行时会逐项询问，也可以用 `--name` 和 `--profile` 直接指定。

## 统计规则

- 账号以「平台 + 用户 ID」区分，昵称变更后旧昵称保留为曾用名，仍可搜索。
- 同一作品只计一次，公众号文章的长短链接也会归一。
- 榜单按次数降序，并列同名次；所有账号都会展示。
- 查询匹配 ID、平台号、昵称、曾用名，也可粘贴个人页链接，范围始终覆盖全部平台。

## 本地预览与测试

```bash
npm run dev    # http://localhost:8317
npm test
```

## 部署

仓库 Settings → Pages → Build and deployment：Source 选 **Deploy from a branch**，分支选 `main`，目录选 `/docs`。
