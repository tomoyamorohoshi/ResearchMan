import type { CSSProperties } from "react";
import { shapeForIdea } from "@/lib/ideaShapes";
import {
  assignShapeKinds,
  computeCollageLayout,
  TIER_REF_WIDTH_PX,
  type CollageCardInput,
  type CollageTier,
  type IdeaContentInput,
} from "@/lib/ideaCollageLayout";
import { categoryOf, dateLabelOf, existingCategories, type Idea } from "@/lib/ideas";
import IdeaShapeCard from "@/components/IdeaShapeCard";

// /ideas ポスターレイアウト（DESIGN: goofy-hatching-mango.md 2026-07-07バッチ・パズルカーニング
// 配置）。旧CSS Grid行詰め(computeColStarts)+widthPct/marginジッタによる近似的な「ニアタッチ」を、
// サーバー計算の絶対配置コラージュ（src/lib/ideaCollageLayout.ts）に置換した。輪郭サンプル点
// 同士の実測距離を使い、隣接シルエットの隙間を2〜8pxまで詰める「パズルカーニング」を行毎に
// 行う。サーバーコンポーネント（JSなしで完結。ホバーの持ち上がりはCSSの:hover +
// motion-safe:のみ）。
//
// 3ティア構成（実装詳細補足B.1）: mobile(<640px)/compact(640-1024px)/wide(1024px〜)を、
// Tailwindのレスポンシブdisplayクラスで切替える。各ティアはサーバーで基準幅1回だけ計算し、
// 子要素はCSS %で位置・サイズを表現することで、任意の実viewport幅へ比率保存のまま連続的に
// フルイドスケールする（display:noneの要素はaccessibility treeから除外されるため、
// 3ティア分レンダリングしてもa11yの二重読み上げは発生しない）。
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

  // A.5/A.6: コンテンツ量に応じたシェイプ割り当て（goofy-hatching-mango.md 2026-07-07バッチ・
  // 可読性の根治）。assignShapeKindsを1回呼び、得たMapのkind/generousでshapeForIdeaを
  // 1回だけ呼んでshapeを確定させる（IdeaShapeCardは受け取ったshapeをそのまま使い、
  // 内部で再度shapeForIdeaを呼ばない＝呼び出しを1箇所に集約）
  const contentInputs: IdeaContentInput[] = ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    dateLabel: dateLabelOf(idea),
    seed: idea.seed,
    refs: idea.refs,
  }));
  const assignments = assignShapeKinds(contentInputs);
  const shapeById = new Map(
    ideas.map((idea) => {
      const assignment = assignments.get(idea.id);
      const shape = shapeForIdea(
        idea.id,
        idea.title,
        dateLabelOf(idea),
        { seed: idea.seed, refs: idea.refs },
        assignment && { forceKind: assignment.kind, generous: assignment.generous },
      );
      return [idea.id, shape] as const;
    }),
  );
  const cards: CollageCardInput[] = ideas.map((idea) => ({
    id: idea.id,
    shape: shapeById.get(idea.id)!,
    seedText: idea.seed,
    refs: idea.refs,
  }));
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
        const layout = computeCollageLayout(cards, tier);
        const refWidthPx = TIER_REF_WIDTH_PX[tier];
        const containerHeightPx = Math.max(1, layout.containerHeightPx);
        return (
          <div
            key={tier}
            className={`relative w-full ${TIER_VISIBILITY_CLASS[tier]}`}
            style={{ aspectRatio: `${refWidthPx} / ${containerHeightPx}` }}
          >
            {layout.placements.map((placement) => {
              const idea = ideaById.get(placement.id);
              const category = categoryByIdeaId.get(placement.id);
              if (!idea || !category) return null;
              const style = {
                left: `${(placement.leftPx / refWidthPx) * 100}%`,
                top: `${(placement.topPx / containerHeightPx) * 100}%`,
                width: `${(placement.widthPx / refWidthPx) * 100}%`,
                height: `${(placement.heightPx / containerHeightPx) * 100}%`,
                "--rotate": `${placement.rotateDeg.toFixed(2)}deg`,
              } as CSSProperties;
              return (
                <div
                  key={placement.id}
                  // group: 子のSVGへ影(drop-shadow)をgroup-hover:で伝える（矩形box-shadowの
                  // 「下敷き」を避けるため、影自体はIdeaShapeCard側のsvg要素に付与する）。
                  // パズルカーニングは非重なり(距離≥0)を保証するため静止時のz-index分散は不要に
                  // なった(旧実装のZ_CLASSES 5段階ジッタを撤去)。ホバー時のわずかな拡大
                  // (scale 1.02)が隣接カードへ視覚的に食い込まないよう、ホバー中だけz-50に上げる
                  className="group absolute pointer-events-none z-0 transition-transform duration-150 ease-out [transform:rotate(var(--rotate))] motion-safe:hover:[transform:rotate(var(--rotate))_scale(1.02)] motion-safe:hover:z-50"
                  style={style}
                >
                  <IdeaShapeCard idea={idea} category={category} shape={shapeById.get(idea.id)!} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
