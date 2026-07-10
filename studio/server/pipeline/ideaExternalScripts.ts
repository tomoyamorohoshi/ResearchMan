/**
 * scripts/search-cases.mjs（既存・無改変）を子プロセスで呼ぶラッパー。DESIGN.md §6 idea:
 * 「お題に関連するCase/Techをsearch-cases.mjs＋techデータからretrieve」のCase側を担当する
 * （Tech側はtech.jsonが48件程度と小さいためideaPure.ts::scoreTechCandidatesでin-process処理）。
 *
 * 子プロセスを伴うため自動テスト対象外（audit.ts::run()と同じ位置づけ）。
 */
import { spawnSync } from "node:child_process";
import type { CaseRecord } from "./ideaPure.js";

export interface SearchCaseHit extends CaseRecord {
  score: number;
  award?: string;
  link: string;
}

/**
 * search-cases.mjs --format json をキーワードOR検索で呼ぶ。失敗・空ヒットは空配列
 * （呼び出し側は「テーマ関連事例が0件」を許容し、切り口の exemplarCaseIds を頼りにフォールバックする）。
 */
export function runSearchCases(cwd: string, keywords: string[], limit = 12): SearchCaseHit[] {
  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return [];
  const r = spawnSync("node", ["scripts/search-cases.mjs", ...kws, "--format", "json", "--limit", String(limit)], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
  });
  if (r.error || r.status !== 0 || !r.stdout) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? (parsed as SearchCaseHit[]) : [];
  } catch {
    return [];
  }
}
