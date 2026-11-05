// 读写 data/shadoro.yaml。用 Document API 写回，保留文件里手写的注释。
import { readFile, writeFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

/** YAML 里未加引号的纯数字 ID 会被解析成数字，统一转回字符串。 */
function normalizeRecord(record) {
  const { user, originalAuthor } = record;
  return {
    ...record,
    addedAt: String(record.addedAt),
    user: { ...user, id: String(user.id), name: String(user.name), alias: String(user.alias ?? '') },
    ...(originalAuthor && { originalAuthor: { ...originalAuthor, name: String(originalAuthor.name) } }),
  };
}

export async function loadStore(path) {
  const doc = parseDocument(await readFile(path, 'utf8'));
  if (doc.errors.length) throw new Error(`${path} 格式错误：${doc.errors[0].message}`);
  const { author = null, records = [] } = doc.toJS() ?? {};
  return { doc, author, records: (records ?? []).map(normalizeRecord) };
}

export async function saveRecords(path, doc, records) {
  doc.set('records', doc.createNode(records));
  await writeFile(path, doc.toString({ lineWidth: 0 }));
}
