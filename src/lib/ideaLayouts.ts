// /ideas ポスターの事前計算済みレイアウト読み込み（DESIGN: goofy-hatching-mango.md
// 2026-07-08改訂・事前計算方式）。
//
// 背景: 初回実装(9dcc197〜faaa62a)はsolveFixedSizeShape/assignShapeKinds/computeCollageLayoutを
// IdeasPoster.tsx（Server Component）が直接呼んでいたため、Vercelビルド(2コア・SSG1ワーカー)で
// /ideasのSSGが300秒×3回タイムアウトし、9デプロイ連続失敗・本番21時間凍結を起こして
// revert済み(68fd009)。再投入にあたり、重い計算(solveFixedSizeShape等)はビルド時から完全に
// 追い出し、scripts/precompute-idea-layouts.mjsがdata/ideas.json更新のたびに事前計算した結果を
// data/idea-layouts.json へ書き出す方式にした。
//
// ISR Reads削減対応（2026-07-19）: data/idea-layouts.json(14.5MB)の即時importをこのモジュールから
// 撤去した。IdeasPoster.tsx（Client Component）が値として本ファイルをimportしていたため、
// 巨大JSONがまるごとクライアントバンドル/RSCペイロードに引きずり込まれ、/ideasのISR Reads
// 消費が肥大化していた。本ファイルは純粋にtierLayoutの読み出しロジック（型定義含む）だけを
// 提供し、実データ(IdeaLayoutsFile)は呼び出し側がpublic/data/idea-layouts.jsonをfetchして渡す。
//
// 鮮度の機械保証はpre-pushフック(scripts/check-idea-layouts-freshness.mjs)が担う
// （data/idea-layouts.jsonの入力ハッシュ==現data/ideas.jsonでなければpushを拒否する）。
// ここでは「古いレイアウトを黙って使う」フォールバックを作らない（計画の明示禁止事項）ため、
// 本ファイル自体にビルド時フォールバック処理は持たせない。
import type { IdeaShape } from "./ideaShapes";
import type { CardPlacement, CollageTier } from "./ideaCollageLayout";

export type IdeaLayoutCard = {
  shape: IdeaShape;
  scale: number; // solveFixedSizeShapeが解いたレンダリングスケール(物理px/viewBox単位)
  placement: CardPlacement;
};

export type IdeaLayoutTier = {
  containerWidthPx: number;
  containerHeightPx: number;
  cards: Record<string, IdeaLayoutCard>; // key = idea.id
};

export type IdeaLayoutsFile = {
  inputHash: string; // ideas.json生テキスト＋アルゴリズムバージョンのハッシュ（鮮度検査用）
  algoVersion: string;
  generatedAt: string;
  tiers: Record<CollageTier, IdeaLayoutTier>;
};

export function tierLayout(layoutsFile: IdeaLayoutsFile, tier: CollageTier): IdeaLayoutTier {
  return layoutsFile.tiers[tier];
}
