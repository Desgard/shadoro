# Shadoro

用户要收录搬运记录时，按 [.agents/skills/record-repost/SKILL.md](.agents/skills/record-repost/SKILL.md) 的步骤执行。

收录数据写入后，按 [.agents/skills/submit-repost-pr/SKILL.md](.agents/skills/submit-repost-pr/SKILL.md) 的步骤向 `main` 分支发起 Pull Request。

收录数据只通过 `npm run` 命令写入，不要手改 `data/shadoro.yaml` 和 `docs/leaderboard.json`。
