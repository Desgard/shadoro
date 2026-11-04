// 由收录记录生成榜单。纯函数，页面与 CLI 共用同一份统计结果。

export function buildLeaderboard(records) {
  const byUser = new Map();
  const ordered = [...records].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  for (const record of ordered) {
    const key = `${record.platform}:${record.user.id}`;
    const entry = byUser.get(key) ?? {
      key,
      platform: record.platform,
      id: record.user.id,
      alias: '',
      names: [],
      profileUrl: '',
      works: [],
    };
    // 记录按时间升序遍历，后写入的昵称、个人页即最新值。
    if (!entry.names.includes(record.user.name)) entry.names.push(record.user.name);
    entry.name = record.user.name;
    entry.alias = record.user.alias || entry.alias;
    entry.profileUrl = record.user.profileUrl || entry.profileUrl;
    entry.works.push({
      type: record.type,
      title: record.title,
      url: record.workUrl,
      originalUrl: record.originalUrl,
      note: record.note,
      addedAt: record.addedAt,
    });
    byUser.set(key, entry);
  }

  const entries = [...byUser.values()]
    .map(({ names, ...entry }) => ({
      ...entry,
      formerNames: names.filter((name) => name !== entry.name),
      count: entry.works.length,
      lastAddedAt: entry.works.at(-1).addedAt,
      works: entry.works.reverse(),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || b.lastAddedAt.localeCompare(a.lastAddedAt) || a.key.localeCompare(b.key),
    );

  // 并列同名次（1, 1, 3）。
  entries.forEach((entry, index) => {
    entry.rank = index > 0 && entries[index - 1].count === entry.count ? entries[index - 1].rank : index + 1;
  });

  return { totalWorks: records.length, totalUsers: entries.length, entries };
}
