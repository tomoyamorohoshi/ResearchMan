"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TIER_REF_WIDTH_PX, type CollageTier } from "@/lib/ideaCollageLayout";
import { tierLayout, type IdeaLayoutsFile } from "@/lib/ideaLayouts";
import { categoryOf, existingCategories, sortIdeas, type Idea } from "@/lib/ideaCategory";
import IdeaShapeCard from "@/components/IdeaShapeCard";
import IdeaCardControls from "@/components/IdeaCardControls";
import { useIdeaLikes } from "@/hooks/useIdeaLikes";
import { useIdeaTrash } from "@/hooks/useIdeaTrash";

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

export default function IdeasPoster({
  techDomainEntries,
}: {
  // Server Component(page.tsx)からClient Componentへ渡すため、Mapではなくシリアライズ
  // 可能なタプル配列で受け取り、ここでMapへ復元する（[id, domains[0]][]）
  techDomainEntries: [string, string][];
}) {
  const techDomainById = useMemo(() => new Map(techDomainEntries), [techDomainEntries]);

  // ISR Reads削減対応（2026-07-19）: ideas/idea-layoutsはpropsで受け取らず、マウント後に
  // public/data/配下の静的アセットをfetchする（scripts/prepare-public-data.mjsがビルド時に
  // data/ideas.json・data/idea-layouts.jsonをそのままコピーして書き出す）。ページHTML/RSC
  // ペイロードに巨大JSONを埋め込まないための変更で、見た目・挙動は変えない
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [layoutsFile, setLayoutsFile] = useState<IdeaLayoutsFile | null>(null);
  // fetch失敗（404・ネットワーク断・JSON破損等）時に「読み込み中」のまま固まらないよう、
  // エラー状態を別途持ち、簡易エラー表示へ遷移させる（レビュー指摘対応）
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/ideas.json")
      .then((res) => res.json())
      .then((data: Idea[]) => {
        if (!cancelled) setIdeas(sortIdeas(data));
      })
      .catch((err) => {
        console.error("Failed to load /data/ideas.json", err);
        if (!cancelled) setFetchFailed(true);
      });
    fetch("/data/idea-layouts.json")
      .then((res) => res.json())
      .then((data: IdeaLayoutsFile) => {
        if (!cancelled) setLayoutsFile(data);
      })
      .catch((err) => {
        console.error("Failed to load /data/idea-layouts.json", err);
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // いいね・ゴミ箱（/ideas 機能追加）。同期機構はcases/tech側と同じcreateSyncedIdSet
  // ファクトリだが、localStorageキー・APIエンドポイントは独立している（互いに影響しない）
  const { likes, toggle: toggleLike, mounted: likesMounted } = useIdeaLikes();
  const { trashed, toggle: toggleTrash, mounted: trashMounted } = useIdeaTrash();
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  // 件数表示: hydration前(mounted=false)は0を表示し、ローカルの実際の件数が瞬間的に
  // 誤表示されるのを防ぐ(GalleryClient.tsxのtrashCountと同じパターン)
  const trashCount = trashMounted ? trashed.size : 0;

  // fetch完了前/失敗時は、既存の「Trash is empty」等と同じ視覚言語の簡素な表示にする
  // （レイアウトシフトを最小にしつつ、この早期returnより前に全フックを呼び終えているため
  // フックの呼び出し順序・回数は変わらない）
  if (fetchFailed || !ideas || !layoutsFile) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 pt-6 pb-16 sm:pt-8 sm:pb-24">
        <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
          {fetchFailed ? "Failed to load" : "Loading…"}
        </div>
      </div>
    );
  }

  const legend = existingCategories(ideas, techDomainById);
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const categoryByIdeaId = new Map(ideas.map((idea) => [idea.id, categoryOf(idea, techDomainById)]));

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-8 pt-6 pb-16 sm:pt-8 sm:pb-24">
      {/* カテゴリ凡例: 実在するカテゴリのみ、色チップ+ラベルの1行。ゴミ箱ビュー切替は
          GalleryClient.tsxのTrashボタンと同じ見た目・ラベル規約(Trash n)にする */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mb-8 sm:mb-14">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
        <button
          type="button"
          onClick={() => setShowTrashOnly((v) => !v)}
          className={`flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
            showTrashOnly ? "text-red-500" : "text-gray-400 hover:text-gray-900"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.867 12.142A2 2 0 0115.138 21H8.862a2 2 0 01-1.995-1.858L6 7z"
            />
          </svg>
          Trash{trashCount > 0 ? ` ${trashCount}` : ""}
        </button>
      </div>

      {TIERS.map((tier) => {
        const layout = tierLayout(layoutsFile, tier);
        const refWidthPx = TIER_REF_WIDTH_PX[tier];
        const containerHeightPx = Math.max(1, layout.containerHeightPx);
        // 事前計算(data/idea-layouts.json)にエントリが無いidea(=precompute未実行のまま
        // ideas.jsonへ追加された等、鮮度検査がすり抜けた場合)は、ここで黙って古い/存在しない
        // レイアウトを補うのではなく描画からスキップする（計画の明示禁止事項:
        // 「黙って古いレイアウトを出す方が有害」）。鮮度自体の担保はpre-pushフック
        // (scripts/check-idea-layouts-freshness.mjs)が本務として行う
        // ゴミ箱行きのideaは通常表示から除外し、ゴミ箱ビュー中はゴミ箱行きのみ表示する
        // (GalleryClient.tsxのfilteredと同じ分岐)。レイアウトはprecomputed(絶対配置)のため、
        // 対象を配列から除いても残りのカードの位置はそのまま=詰め直しは発生しない(要件どおり)
        const renderableIds = ideas
          .map((idea) => idea.id)
          .filter((id) => layout.cards[id])
          .filter((id) => (showTrashOnly ? trashed.has(id) : !trashed.has(id)));
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
                  data-idea-id={id} // いいね/ゴミ箱のスモークテスト・将来のDOM連携用の識別子
                  // group: 子のSVGへ影(drop-shadow)をgroup-hover:で伝える（矩形box-shadowの
                  // 「下敷き」を避けるため、影自体はIdeaShapeCard側のsvg要素に付与する）。
                  // パズルカーニングは非重なり(距離≥0)を保証するため静止時のz-index分散は不要
                  // (旧実装のZ_CLASSES 5段階ジッタを撤去)。ホバー時のわずかな拡大
                  // (scale 1.02)が隣接カードへ視覚的に食い込まないよう、ホバー中だけz-50に上げる
                  className="group absolute pointer-events-none z-0 transition-transform duration-150 ease-out [transform:rotate(var(--rotate))] motion-safe:hover:[transform:rotate(var(--rotate))_scale(1.02)] motion-safe:hover:z-50"
                  style={style}
                >
                  <IdeaShapeCard idea={idea} category={category} shape={card.shape} scale={card.scale} />
                  <IdeaCardControls
                    liked={likesMounted && likes.has(id)}
                    onToggleLike={() => toggleLike(id)}
                    trashed={trashMounted && trashed.has(id)}
                    trashMode={showTrashOnly}
                    onToggleTrash={() => toggleTrash(id)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {showTrashOnly && trashCount === 0 && (
        <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
          Trash is empty
        </div>
      )}
    </div>
  );
}
