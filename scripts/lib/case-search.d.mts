// scripts/lib/case-search.mjs の型定義。
// TSから .mjs を import する際の型解決用（実装は case-search.mjs 側の純関数）。

export interface CaseRecord {
  id: string;
  title: string;
  summary?: string;
  year?: string;
  client?: string;
  agency?: string;
  award?: string;
  link?: string;
  tags?: string[];
  categories?: string[];
  regions?: string[];
  sources?: string[];
  overview?: string;
  background?: string;
  execution?: string;
  evaluationImpact?: string;
  [key: string]: unknown;
}

export interface SearchCasesOptions {
  keywords?: string[];
  tags?: string[];
  yearRange?: string | null;
  region?: string | null;
  source?: string | null;
  limit?: number;
  requireAll?: boolean;
}

export interface SearchCasesResultItem {
  c: CaseRecord;
  score: number;
}

export interface SearchCasesResult {
  total: number;
  results: SearchCasesResultItem[];
}

export declare function norm(v: unknown): string;
export declare function scoreCase(c: CaseRecord, kws: string[], requireAll?: boolean): number;
export declare function inYearRange(c: CaseRecord, yearRange: string | null | undefined): boolean;
export declare function searchCases(
  cases: CaseRecord[],
  options?: SearchCasesOptions
): SearchCasesResult;
