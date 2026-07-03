// リサーチ文脈（ソースタグ）のレジストリと種別分類（client/server 両用の純粋関数）。
//
// 各ケースの `sources: string[]` に入るタグを、3種別に分類する：
//   - "award" … 受賞アワードの収集（例: Cannes 2026）。Gallery では「#」ハッシュタグフィルターで切る。
//   - "order" … 私が依頼したリサーチオーダー（例: Web/SNS、音楽プロモ）。Gallery ではタブで切る。
//   - "radar" … 3日に1回の定期自動リサーチ。タブで切れるうえ、TOPカードを専用色で強調する。
//
// 新しいリサーチオーダーを追加したら、ここに1行足してタグ名を `data/cases.json` の sources に付与する。
//
// `sources` は optional（型は `Case["sources"]?: string[]`）。cases.json 全454件中164件が
// sources なしで、これは初期アーカイブ（映画・ゲームのARG/歴代名作等）のレガシーデータで仕様どおり
// （2026-07-04監査で確認: Cannes 2026分290件はsourcesすべて付与済み、欠落はゼロ）。
// sourcesなし事例はタブ/ハッシュタグフィルターの対象外になるだけで、通常のギャラリー表示・
// 検索には支障しない。データは触らず、この仕様をコードコメントとして明記するに留める。

export type SourceKind = "award" | "order" | "radar";

export type ResearchSource = {
  tag: string; // case.sources に格納される値（表示名そのまま）
  kind: SourceKind;
  label: string; // タブ/チップ表示名
};

export const RESEARCH_SOURCES: ResearchSource[] = [
  { tag: "Cannes 2026", kind: "award", label: "Cannes 2026" },
  { tag: "Music", kind: "order", label: "Music" },
  { tag: "Album Sites", kind: "order", label: "Album Sites" },
  { tag: "Launch & Reveal", kind: "order", label: "Launch & Reveal" },
  { tag: "Radar", kind: "radar", label: "Radar" },
];

const byTag = new Map(RESEARCH_SOURCES.map((s) => [s.tag, s]));

export function getSourceKind(tag: string): SourceKind | undefined {
  return byTag.get(tag)?.kind;
}

// タブとして表示するソース（order + radar）を登録順で返す
export const tabSources: ResearchSource[] = RESEARCH_SOURCES.filter(
  (s) => s.kind === "order" || s.kind === "radar",
);

// 「#」ハッシュタグフィルターに出すソース（award）
export const awardSourceTags: string[] = RESEARCH_SOURCES.filter(
  (s) => s.kind === "award",
).map((s) => s.tag);

// 定期自動リサーチ（Radar）由来のケースか
export function isRadarCase(c: { sources?: string[] }): boolean {
  return (c.sources ?? []).some((t) => getSourceKind(t) === "radar");
}
