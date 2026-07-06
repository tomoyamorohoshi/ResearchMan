// 3Dノードグラフをドメイン非依存にするための共通契約（純粋・ランタイムimportゼロ）。
// Case Study(cases.json)・Technology(tech.json)等、各ドメインはこのインタフェースを満たす
// アダプタを1つ用意するだけで Graph3DView / useGraphViewTransition 一式を再利用できる
// （計画書「アダプタ定義」参照）。実装は src/lib/caseGraphAdapter.ts・techGraphAdapter.ts。
export type GraphDomainAdapter<T> = {
  id(item: T): string;
  title(item: T): string;
  groupKeys(item: T): string[]; // 類似度・クラスタ名・整列列の基礎
  groupLabel(key: string): string; // 見出し・チップの最終表示文字列（呼び出し側で追加加工しない）
  keyWeight(key: string): number; // 類似度計算のキー別重み
  minClusterSize: number; // クラスタ見出しの最小所属数
  thumbSources(item: T): string[]; // [縮小版URL, フル解像度URL, ...] 優先順
  cardIdAttr: string; // グリッドカードのid属性名 ("data-case-id" / "data-tech-id")
  detailHref(item: T): string; // 詳細ページURL
};

// createNodeObject/warmThumbnailCache等(graphSprites.ts)が扱う汎用ノード仕様。
// imageCacheのキーはthumbSources[0]のURLにする（Case/Techのid衝突回避。計画書参照）
export type NodeSpec = { id: string; title: string; thumbSources: string[] };

export function toNodeSpec<T>(adapter: GraphDomainAdapter<T>, item: T): NodeSpec {
  return { id: adapter.id(item), title: adapter.title(item), thumbSources: adapter.thumbSources(item) };
}
