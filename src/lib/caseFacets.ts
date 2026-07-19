// Case[]からfacet（categories/years/regions/sources/tags）を導出する純粋関数。
// src/lib/cases.ts はモジュール先頭でdata/cases.json(2MB)を即時importするため、
// クライアントコンポーネントがそこから値をimportするとバンドルに巨大JSONが
// 引きずり込まれるリスクがある。facet導出ロジックだけをこの独立モジュールに切り出し、
// クライアント側（GalleryClient.tsx）はここだけをimportする（cases.tsの37-57行目付近の
// ロジックと同一）。
import { ALL_TAGS } from "./tags";
import type { Case } from "./cases";

export type CaseFacets = {
  categories: string[];
  years: string[];
  regions: string[];
  sources: string[];
  tags: string[];
};

export function deriveCaseFacets(cases: Case[]): CaseFacets {
  const categories = Array.from(new Set(cases.flatMap((c) => c.categories))).sort();

  const years = Array.from(new Set(cases.map((c) => c.year))).sort(
    (a, b) => Number(b) - Number(a)
  );

  const regions = Array.from(new Set(cases.flatMap((c) => c.regions))).sort();

  const sources = Array.from(new Set(cases.flatMap((c) => c.sources ?? []))).sort();

  // 実データに登場するタグのみ（語彙順を保つため tags.ts の ALL_TAGS でソート）
  const usedTags = new Set(cases.flatMap((c) => c.tags ?? []));
  const tags = ALL_TAGS.filter((t) => usedTags.has(t));

  return { categories, years, regions, sources, tags };
}
