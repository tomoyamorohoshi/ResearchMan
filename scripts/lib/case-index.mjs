// TOPギャラリー用の「軽量インデックス」(cases-index.json)を作る純関数群。
// 一覧・絞り込み・検索（summary全文を含む）・ソート・カード・3Dグラフ・パネルが使う項目だけを残し、
// 長文（overview/background/execution/...）は落とす（サーバ側ページは data/cases.json を直接読む）。
// 使う側: scripts/lib/public-data.mjs（配信用テキスト）

// クライアントが全件に対して参照する項目（GalleryClient/CaseCard/CasePanel/caseGraphAdapter/
// awards.ts(getCaseAwardRefs・compareByAward*)/researchSources.isRadarCase）。
// summary は検索対象のため全文のまま残す（挙動不変）。
export const INDEX_FIELDS = [
  "id",
  "title",
  "summary",
  "client",
  "agency",
  "categories",
  "award",
  "awardEntries",
  "year",
  "regions",
  "link",
  "thumbnail",
  "sources",
  "tags",
];

export function pickIndexEntry(c) {
  const out = {};
  for (const k of INDEX_FIELDS) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  return out;
}

export function activeCases(cases) {
  return cases.filter((c) => !c.quarantined);
}

export function buildCasesIndex(cases) {
  return activeCases(cases).map(pickIndexEntry);
}
