// Technology(tech.json)向けの3Dノードグラフ・ドメインアダプタ（GraphDomainAdapter<TechItem>実装）。
// 類似度・クラスタの基礎は domains[]（語彙7種。data/tech-tag-vocabulary.json）。
// スラッシュは「軸/キーワード」でなく名前の一部なので、Caseのようにkeyword部分だけ抜かず
// フル文字列を大文字化して表示する（クラスタ見出し・チップ共通。計画書参照）。
import type { TechItem } from "./tech";
import type { GraphDomainAdapter } from "./graphDomain";

export const techGraphAdapter: GraphDomainAdapter<TechItem> = {
  id: (t) => t.id,
  title: (t) => t.title,
  // ?? [] : TechItem型上domainsは必須だが、tech.jsonはas castで実行時未検証のため
  // 欠落エントリが混入すると for...of undefined でクラスタ/整列がクラッシュする。
  // caseGraphAdapter(c.tags ?? [])と同じ防御を張る（空配列は孤立ノードとして安全）
  groupKeys: (t) => t.domains ?? [],
  groupLabel: (key) => key.toUpperCase(),
  keyWeight: () => 1.0, // Caseと異なりDomainに軸の重み付けは無い(全域名を等価に扱う)
  minClusterSize: 2, // データが44件しかないためCaseの5より小さくする(計画書参照)
  thumbSources: (t) => [`/thumbnails-graph/tech/${t.id}.jpg`, t.thumbnail],
  cardIdAttr: "data-tech-id",
  detailHrefPrefix: "/technology/",
};
