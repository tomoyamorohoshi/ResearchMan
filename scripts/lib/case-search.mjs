/**
 * 事例DB (data/cases.json) の検索コアロジック（単一ソース）。
 * scripts/search-cases.mjs（CLI）と src/app/api/mcp/route.ts（MCPツール search_cases）が共用する。
 *
 * 純粋関数のみ。ファイルI/O・ネットワークアクセスは一切行わない。
 * スコアリング・フィルタの挙動は元の scripts/search-cases.mjs から変更していない
 * （CLIの既存出力を変えないため）。
 */

// フィールド重み: タイトル・タグの一致を本文一致より優先する
const WEIGHTS = [
  ["title", 5],
  ["tags", 4],
  ["categories", 4],
  ["summary", 3],
  ["client", 2],
  ["agency", 2],
  ["award", 2],
  ["overview", 1],
  ["background", 1],
  ["execution", 1],
  ["evaluationImpact", 1],
];

export const norm = (v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase();

/** 1事例に対する複数キーワードのスコア合計。requireAll指定時は全キーワード非ヒットで0。 */
export function scoreCase(c, kws, requireAll = false) {
  let total = 0;
  const hits = new Set();
  for (const kw of kws) {
    let kwScore = 0;
    for (const [field, w] of WEIGHTS) {
      if (norm(c[field]).includes(kw)) kwScore += w;
    }
    if (kwScore > 0) hits.add(kw);
    total += kwScore;
  }
  if (requireAll && hits.size < kws.length) return 0;
  return hits.size > 0 ? total : 0;
}

/** yearRange は "2024" または "2024-2026" 形式。未指定(null/空)は常にtrue。 */
export function inYearRange(c, yearRange) {
  if (!yearRange) return true;
  const y = parseInt(c.year, 10);
  if (Number.isNaN(y)) return false;
  const m = yearRange.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) return true;
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : from;
  return y >= from && y <= to;
}

/**
 * 事例配列を検索する。
 * @param {Array<object>} cases - data/cases.json の cases 配列
 * @param {object} [options]
 * @param {string[]} [options.keywords] - キーワード（大文字小文字は内部で無視）
 * @param {string[]} [options.tags] - tags/categories に部分一致させるタグ（AND）
 * @param {string|null} [options.yearRange] - "2024" or "2024-2026"
 * @param {string|null} [options.region] - regions に部分一致
 * @param {string|null} [options.source] - sources に部分一致
 * @param {number} [options.limit] - 返却件数の上限（デフォルト12）
 * @param {boolean} [options.requireAll] - キーワードをANDで評価するか
 * @returns {{ total: number, results: Array<{ c: object, score: number }> }}
 *   total は limit 適用前のヒット件数、results は limit 適用後（スコア降順・同点は年降順）。
 */
export function searchCases(cases, options = {}) {
  const {
    keywords = [],
    tags = [],
    yearRange = null,
    region = null,
    source = null,
    limit = 12,
    requireAll = false,
  } = options;

  const kws = keywords.map((k) => String(k).toLowerCase());

  let results = cases
    .filter((c) =>
      tags.every(
        (t) => norm(c.tags).includes(t.toLowerCase()) || norm(c.categories).includes(t.toLowerCase())
      )
    )
    .filter((c) => inYearRange(c, yearRange))
    .filter((c) => !region || norm(c.regions).includes(region.toLowerCase()))
    .filter((c) => !source || norm(c.sources).includes(source.toLowerCase()))
    .map((c) => ({ c, score: kws.length ? scoreCase(c, kws, requireAll) : 1 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (parseInt(b.c.year, 10) || 0) - (parseInt(a.c.year, 10) || 0));

  const total = results.length;
  results = results.slice(0, limit);

  return { total, results };
}
