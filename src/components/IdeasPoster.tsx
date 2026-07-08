import type { CSSProperties } from "react";
import { TIER_REF_WIDTH_PX, type CollageTier } from "@/lib/ideaCollageLayout";
import { tierLayout } from "@/lib/ideaLayouts";
import { categoryOf, existingCategories, type Idea } from "@/lib/ideas";
import IdeaShapeCard from "@/components/IdeaShapeCard";

// /ideas ポスターレイアウト（DESIGN: goofy-hatching-mango.md 2026-07-08改訂・事前計算方式）。
// 旧CSS Grid行詰め(computeColStarts)+widthPct/marginジッタによる近似的な「ニアタッチ」を、
// サーバー計算の絶対配置コラージュ（src/lib/ideaCollageLayout.ts）に置換した。輪郭サンプル点
// 同士の実測距離を使い、隣接シルエットの隙間を0.5〜3pxまで詰める「パズルカーニング」を行毎に
// 行う。サーバーコンポーネント（JSなしで完結。ホバーの持ち上がりはCSSの:hover +
// motion-safe:のみ）。
//
// H: 固定2サイズタイポグラフィ（設計の反転）。フォントは全カード共通の固定2サイズ
// (タイトル=サイズA・日付/本文/リンク=サイズB)。カード(シェイプ)のスケールを内容量から解き、
// 固定サイズで全文が収まる大きさにする。
//
// 事前計算方式（2026-07-08改訂・必読）: solveFixedSizeShape/assignShapeKinds/computeCollageLayout
// の実行はscripts/precompute-idea-layouts.mjsがdata/ideas.json更新のたびに行い、結果を
// data/idea-layouts.json へ書き出す。本コンポーネントはその結果(@/lib/ideaLayouts)を読んで
// 描画するだけで、ビルド時の重計算はゼロ（初回実装がVercelビルドでSSGタイムアウトし本番を
// 21時間凍結させた事故の再発防止。detail: ~/.claude/plans/goofy-hatching-mango.md）。
//
// コンテナはティア基準幅をmax-widthとして使い、旧来の「無限%拡大」をやめた(A: 固定サイズを
// 維持するため、ティア基準幅を超える画面幅では拡大せずセンタリングする。ティア基準幅より
// 狭い画面ではwidth:100%により比例縮小する＝ティア切替の谷間や極端に狭い端末のみ許容)。
//
// 3ティア構成（実装詳細補足B.1）: mobile(<640px)/compact(640-1024px)/wide(1024px〜)を、
// Tailwindのレスポンシブdisplayクラスで切替える（display:noneの要素はaccessibility treeから
// 除外されるため、3ティア分レンダリングしてもa11yの二重読み上げは発生しない）。
const TIERS: readonly CollageTier[] = ["mobile", "compact", "wide"];

// Tailwindの動的クラス名はJITスキャン対象外になるため、使用するクラスは必ずリテラル文字列で
// 用意する。sm=640px・lg=1024pxという標準ブレークポイントが、そのままTIER_REF_WIDTH_PXの
// 各ティア境界(<640/640-1024/1024〜)と一致する
const TIER_VISIBILITY_CLASS: Record<CollageTier, string> = {
  mobile: "block sm:hidden",
  compact: "hidden sm:block lg:hidden",
  wide: "hidden lg:block",
};

export default function IdeasPoster({ ideas, techDomainById }: { ideas: Idea[]; techDomainById: Map<string, string> }) {
  const legend = existingCategories(ideas, techDomainById);
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const categoryByIdeaId = new Map(ideas.map((idea) => [idea.id, categoryOf(idea, techDomainById)]));

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-8 pt-6 pb-16 sm:pt-8 sm:pb-24">
      {/* カテゴリ凡例: 実在するカテゴリのみ、色チップ+ラベルの1行 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-8 sm:mb-14">
        {legend.map((cat) => (
          <span
            key={cat.key}
            className="flex items-center gap-1.5 text-[9px] tracking-widest uppercase text-gray-400"
          >
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: cat.fill }}
              aria-hidden="true"
            />
            {cat.label}
          </span>
        ))}
      </div>

      {TIERS.map((tier) => {
        const layout = tierLayout(tier);
        const refWidthPx = TIER_REF_WIDTH_PX[tier];
        const containerHeightPx = Math.max(1, layout.containerHeightPx);
        // 事前計算(data/idea-layouts.json)にエントリが無いidea(=precompute未実行のまま
        // ideas.jsonへ追加された等、鮮度検査がすり抜けた場合)は、ここで黙って古い/存在しない
        // レイアウトを補うのではなく描画からスキップする（計画の明示禁止事項:
        // 「黙って古いレイアウトを出す方が有害」）。鮮度自体の担保はpre-pushフック
        // (scripts/check-idea-layouts-freshness.mjs)が本務として行う
        const renderableIds = ideas.map((idea) => idea.id).filter((id) => layout.cards[id]);
        return (
          <div
            key={tier}
            className={`relative mx-auto ${TIER_VISIBILITY_CLASS[tier]}`}
            // A: ティア基準幅をmax-widthとして使い、無限%拡大をやめる(固定物理フォントサイズを
            // 維持するため)。画面がティア基準幅より狭い場合はwidth:100%により比例縮小する
            // (許容: ティア境界の谷間や極端に狭い端末のみ)
            style={{ width: "100%", maxWidth: `${refWidthPx}px`, aspectRatio: `${refWidthPx} / ${containerHeightPx}` }}
          >
            {renderableIds.map((id) => {
              const idea = ideaById.get(id);
              const category = categoryByIdeaId.get(id);
              if (!idea || !category) return null;
              const card = layout.cards[id];
              const placement = card.placement;
              const style = {
                left: `${(placement.leftPx / refWidthPx) * 100}%`,
                top: `${(placement.topPx / containerHeightPx) * 100}%`,
                width: `${(placement.widthPx / refWidthPx) * 100}%`,
                height: `${(placement.heightPx / containerHeightPx) * 100}%`,
                "--rotate": `${placement.rotateDeg.toFixed(2)}deg`,
              } as CSSProperties;
              return (
                <div
                  key={id}
                  // group: 子のSVGへ影(drop-shadow)をgroup-hover:で伝える（矩形box-shadowの
                  // 「下敷き」を避けるため、影自体はIdeaShapeCard側のsvg要素に付与する）。
                  // パズルカーニングは非重なり(距離≥0)を保証するため静止時のz-index分散は不要
                  // (旧実装のZ_CLASSES 5段階ジッタを撤去)。ホバー時のわずかな拡大
                  // (scale 1.02)が隣接カードへ視覚的に食い込まないよう、ホバー中だけz-50に上げる
                  className="group absolute pointer-events-none z-0 transition-transform duration-150 ease-out [transform:rotate(var(--rotate))] motion-safe:hover:[transform:rotate(var(--rotate))_scale(1.02)] motion-safe:hover:z-50"
                  style={style}
                >
                  <IdeaShapeCard idea={idea} category={category} shape={card.shape} scale={card.scale} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
