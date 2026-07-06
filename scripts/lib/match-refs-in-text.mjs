/**
 * 本文（アイデアの種のseed文）に登場する事例/技術タイトルを、正規化タイトルの
 * 部分一致で検出する（backfill-idea-seeds.mjs 専用。generate-idea-seeds.mjs の
 * resolveRef はモデルが返したidを直引きするのに対し、履歴には参照idが無いため
 * 文中のタイトル出現を機械的にスキャンする必要がある）。
 *
 * normTitle は generate-idea-seeds.mjs と共用（scripts/lib/norm-title.mjs）。
 * 短すぎるタイトル（例: "AI"）は本文中にほぼ必ず出現し誤検出の元になるため対象外にする。
 */
import { normTitle } from "./norm-title.mjs";

const MIN_NORM_TITLE_LEN = 4;

/**
 * @param {string} text 走査対象の本文
 * @param {{type: "case"|"tech", id: string, title: string, summary?: string}[]} catalog
 * @returns catalog のうち text 中にタイトルが出現した要素（catalog順・id重複なし）
 */
export function matchRefsInText(text, catalog) {
  const norm = normTitle(text);
  const seen = new Set();
  const matched = [];
  for (const entry of catalog) {
    if (seen.has(entry.id)) continue;
    const nt = normTitle(entry.title);
    if (nt.length < MIN_NORM_TITLE_LEN) continue;
    if (norm.includes(nt)) {
      matched.push(entry);
      seen.add(entry.id);
    }
  }
  return matched;
}
