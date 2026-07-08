// /ideas ポスターの事前計算済みレイアウト読み込み（DESIGN: goofy-hatching-mango.md
// 2026-07-08改訂・事前計算方式）。
//
// 背景: 初回実装(9dcc197〜faaa62a)はsolveFixedSizeShape/assignShapeKinds/computeCollageLayoutを
// IdeasPoster.tsx（Server Component）が直接呼んでいたため、Vercelビルド(2コア・SSG1ワーカー)で
// /ideasのSSGが300秒×3回タイムアウトし、9デプロイ連続失敗・本番21時間凍結を起こして
// revert済み(68fd009)。再投入にあたり、重い計算(solveFixedSizeShape等)はビルド時から完全に
// 追い出し、scripts/precompute-idea-layouts.mjsがdata/ideas.json更新のたびに事前計算した結果を
// data/idea-layouts.json へ書き出す方式にした。本ファイルはその事前計算結果を読むだけの
// 薄いアクセサで、重計算を一切呼ばない（IdeasPoster.tsx/IdeaShapeCard.tsxはこの結果を
// 描画するだけ）。
//
// 鮮度の機械保証はpre-pushフック(scripts/check-idea-layouts-freshness.mjs)が担う
// （data/idea-layouts.jsonの入力ハッシュ==現data/ideas.jsonでなければpushを拒否する）。
// ここでは「古いレイアウトを黙って使う」フォールバックを作らない（計画の明示禁止事項）ため、
// 本ファイル自体にビルド時フォールバック処理は持たせない。
import type { IdeaShape } from "./ideaShapes";
import type { CardPlacement, CollageTier } from "./ideaCollageLayout";
import rawLayouts from "../../data/idea-layouts.json";

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

// JSON importはTypeScriptの構造的型チェック対象外（as constで得られるリテラル型とずれるため）
// unknown経由でキャストする。実データの形はprecompute-idea-layouts.mjs側の書き出しと
// 1:1で一致させている
export const ideaLayouts: IdeaLayoutsFile = rawLayouts as unknown as IdeaLayoutsFile;

export function tierLayout(tier: CollageTier): IdeaLayoutTier {
  return ideaLayouts.tiers[tier];
}
