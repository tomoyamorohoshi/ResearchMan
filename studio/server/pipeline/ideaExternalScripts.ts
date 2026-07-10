/**
 * scripts/search-cases.mjs（既存・無改変）を子プロセスで呼ぶラッパー。DESIGN.md §6 idea:
 * 「お題に関連するCase/Techをsearch-cases.mjs＋techデータからretrieve」のCase側を担当する
 * （Tech側はtech.jsonが48件程度と小さいためideaPure.ts::scoreTechCandidatesでin-process処理）。
 *
 * 独立レビュー指摘#1: 従来は spawnSync を直接使っており、他のspawnSync同様イベントループを
 * ブロックしていた（search-cases.mjs自体は高速だが、audit.tsの非ブロッキング化の趣旨を
 * 一貫させるため）。audit.ts::run()（非同期spawn）経由に統一する。
 */
import type { CaseRecord } from "./ideaPure.js";
import { run } from "./audit.js";

export interface SearchCaseHit extends CaseRecord {
  score: number;
  award?: string;
  link: string;
}

/**
 * search-cases.mjs --format json をキーワードOR検索で呼ぶ。失敗・空ヒットは空配列
 * （呼び出し側は「テーマ関連事例が0件」を許容し、切り口の exemplarCaseIds を頼りにフォールバックする）。
 */
export async function runSearchCases(cwd: string, keywords: string[], limit = 12): Promise<SearchCaseHit[]> {
  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return [];
  const r = await run(
    "node",
    ["scripts/search-cases.mjs", ...kws, "--format", "json", "--limit", String(limit)],
    cwd,
    30_000,
  );
  if (!r.ok || !r.stdout) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? (parsed as SearchCaseHit[]) : [];
  } catch {
    return [];
  }
}
