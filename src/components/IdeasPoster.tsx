import type { CSSProperties } from "react";
import { hashId } from "@/lib/graph";
import { shapeForIdea } from "@/lib/ideaShapes";
import { categoryOf, dateLabelOf, existingCategories, type Idea } from "@/lib/ideas";
import IdeaShapeCard from "@/components/IdeaShapeCard";

// /ideas ポスターレイアウト（DESIGN: goofy-hatching-mango.md）。
// 厳密グリッドにせず、hashId(idea.id)由来の決定論的な揺らぎ（サイズ・傾き・左右寄せ・
// マージン・重なり順）で「大小の形が呼吸を持って散らばる」印象を作る。サーバーコンポーネント
// （JSなしで完結。ホバーの持ち上がりはCSSの:hover + motion-safe:のみで実現）。
//
// Tailwindの動的クラス名はJITスキャン対象外になるため、候補は必ずリテラル文字列の配列で
// 用意し、hashで添字を選ぶ。
type SizeTier = "S" | "M" | "L";

// デスクトップ(sm:以上)のcol-span候補（数値。行詰め計算にも使う）。Sは常に3、M/Lはさらに
// 2択ずつ持たせてcol-span 3〜6に散らす（1画面によりの多くのカードが収まり形状の多様性が
// 視認しやすくなるよう、当初の4〜7から縮小）
const DESKTOP_SPAN_OPTIONS: Record<SizeTier, readonly number[]> = {
  S: [3],
  M: [4, 5],
  L: [5, 6],
};
const TOTAL_COLS = 12;
// col-span-N・col-start-Nはいずれも標準のTailwindユーティリティだが、JITスキャナはソース上の
// リテラル文字列しか拾わない（`sm:col-span-${n}`のような動的生成は生成されない）ため、
// 使う可能性のある値をすべて列挙しておく
const SPAN_CLASS_BY_NUM: Record<number, string> = {
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  5: "sm:col-span-5",
  6: "sm:col-span-6",
};
const COL_START_CLASS_BY_NUM: Record<number, string> = {
  1: "sm:col-start-1",
  2: "sm:col-start-2",
  3: "sm:col-start-3",
  4: "sm:col-start-4",
  5: "sm:col-start-5",
  6: "sm:col-start-6",
  7: "sm:col-start-7",
  8: "sm:col-start-8",
  9: "sm:col-start-9",
  10: "sm:col-start-10",
};
// C3: <smでは常にフル幅1カラム（半カラムだと極小フォントで説明文・リンクが読めなくなる
// カードが出るため、シェイプの安全領域比率で半カラムを許可する分岐は撤去した。根治のため
// モバイルは常にMOBILE_FULLの1択にする）
const MOBILE_FULL = "col-span-4";
const JUSTIFY_CLASSES = ["justify-self-start", "justify-self-end"] as const;
const Z_CLASSES = ["z-0", "z-10", "z-20", "z-30", "z-40"] as const;

// C: カードの幅をグリッドセル幅の92〜104%にランダム化する（GOOD SUMMERポスター級の密度。
// 100%を超える値も許容し、小さくしたgap（下記grid gap-x-1〜2/gap-y-1〜2）と組み合わせて
// 隣接カードがニアタッチ〜わずかに重なる密度を作る。重なり時のクリックはpointer-events
// 形状追従で既に安全（IdeaShapeCard参照）
const WIDTH_PCT_MIN = 92;
const WIDTH_PCT_MAX = 104;

type CardLayout = {
  desktopSpan: number;
  justifyClass: string;
  zClass: string;
  rotateDeg: number;
  marginTopPx: number;
  marginBottomPx: number;
  widthPct: number;
};

// F: 「箱≒シルエット」化（goofy-hatching-mango.md 2026-07-07第4バッチ。本命の根本解決）。
// 前バッチ(9488fcf)はCSS Gridのjustify-self側マージンしか実際には効かない制約の下で、
// box自体をgrowScaleFor倍だけ拡大＋ネガティブマージンで相殺する迂回策を採っていたが、
// デスクトップ横方向の実測中央値が120pxに留まり「接するか接しないか」の目標に届かなかった
// （実測分析: 拡大率をGROW_SCALE_MAX以上にすると細いviewBox形状が破綻するため上限があり、
// 相殺しきれない残差が残っていた）。
// 根本解決として、SVGのviewBoxをshape.cropViewBox(輪郭の実bbox±小マージン)にクロップし、
// カードのaspect-ratioもshape.cropAspectに合わせることで、ボックス自体をシルエットの形に
// ほぼ一致させた（IdeaShapeCard.tsx参照）。box≈シルエットなので、この先は素直なCSS gap
// (下記grid gap-x-1〜2/gap-y-1〜2 = 4〜8px)がそのままシルエット間の近接距離になり、
// growScale/ネガティブマージンによる相殺ロジックは不要になったため撤去した。
// F: col-spanをcropAspectで補正する（goofy-hatching-mango.md 2026-07-07第4バッチ・実測で
// 発覚した回帰の修正）。cropAspect(輪郭の実bbox比)は元のshape.aspect(0.64〜1.25の狭い範囲で
// 設計値)と異なり、実際に描かれた輪郭のジッタ次第で0.49〜1.34まで広く分布する。col-spanは
// tier(S/M/L)のみで決まりcropAspectを考慮しないため、狭い(cropAspect小)シェイプに広いcol-span
// が割り当たると「幅は広いが高さがviewBoxH方向に何倍にも伸びる」極端に縦長のカードになり、
// CSS Grid(grid-auto-rows: auto)は同じ行の全カードの行高をその最大高さに合わせるため、
// 同じ行の他カードが本来の位置から数百px単位で引き離される回帰を実測で発見した(near-touch
// 中央値が115px前後のまま改善しなかった原因)。col-span ∝ cropAspect(高さ一定を保つ線形関係。
// 冪0.85で補正を緩め、tierによるサイズの意図的なバリエーションもある程度残す)で補正する。
// CARD_ASPECT_CLAMP_MIN/MAXはcol-spanが下限(3)に貼り付いてもなお極端に縦長/横長になる
// シェイプ(実測: tallOvalでcropAspect0.49、col-span最小の3でも高さ790px級になり、上の
// col-span補正だけでは吸収しきれなかった)向けに、実際にCSS aspect-ratioへ渡す値そのものにも
// 同じ範囲でクランプをかける（下記style参照）。SVG側は元のcropViewBox比のままなので
// preserveAspectRatio(既定xMidYMid meet)がわずかな余白を生むが、行全体が数百px引き離される
// 実害の方が大きいため、この少数の外れ値ケースでは「箱≒シルエット」の厳密さより優先する
const CARD_ASPECT_CLAMP_MIN = 0.55;
const CARD_ASPECT_CLAMP_MAX = 1.7;

function spanForAspect(baseSpan: number, cropAspect: number): number {
  const clampedAspect = Math.min(CARD_ASPECT_CLAMP_MAX, Math.max(CARD_ASPECT_CLAMP_MIN, cropAspect));
  const factor = clampedAspect ** 0.85;
  const adjusted = Math.round(baseSpan * factor);
  return Math.min(6, Math.max(3, adjusted));
}

function layoutFor(idea: Idea, cropAspect: number): CardLayout {
  const h = hashId(idea.id);
  const tier: SizeTier = h % 3 === 0 ? "S" : h % 3 === 1 ? "M" : "L";
  const spanOptions = DESKTOP_SPAN_OPTIONS[tier];
  const desktopSpan = spanForAspect(spanOptions[Math.floor(h / 3) % spanOptions.length], cropAspect);
  const justifyClass = JUSTIFY_CLASSES[(h >>> 14) % JUSTIFY_CLASSES.length];
  const zClass = Z_CLASSES[(h >>> 26) % Z_CLASSES.length];
  // C: 密パッキング（GOOD SUMMER級）。回転は±5度→±3度に抑え（密度が上がると大回転は
  // 衝突感が出る）、縦マージンは正負を織り交ぜてニアタッチ〜わずかな重なりを作る
  // （バウンディングボックスの空白部分が重なるのは歓迎＝形と形の噛み合い）
  const rotateDeg = (((h >>> 4) % 1000) / 1000 - 0.5) * 6; // -3..3deg
  const marginTopPx = (((h >>> 18) % 1000) / 1000) * 14 - 8; // -8..6px
  const marginBottomPx = (((h >>> 22) % 1000) / 1000) * 10 - 6; // -6..4px
  const widthPct = WIDTH_PCT_MIN + (((h >>> 9) % 1000) / 1000) * (WIDTH_PCT_MAX - WIDTH_PCT_MIN);
  return { desktopSpan, justifyClass, zClass, rotateDeg, marginTopPx, marginBottomPx, widthPct };
}

// CSS Gridの既定の自動配置（auto-flow: row）は各行を左詰めで敷き詰めるため、1行に収まりきらず
// 余った列は必ず「行の右端」に残る。全行で毎回右側にだけ空白が寄ると、ポスターというより
// 単なる左詰めレイアウトの余白バグに見えてしまう。そこで行の詰め込み自体は同じロジックで
// シミュレートしつつ、各行の余り列数(slack)ぶんだけ行頭の開始列をhashでずらし（0〜slack列）、
// 空白が行ごとに左右どちらへ寄るかをばらけさせる
function computeColStarts(spans: readonly number[], seeds: readonly number[]): number[] {
  const rows: number[][] = [];
  let currentRow: number[] = [];
  let used = 0;
  for (let i = 0; i < spans.length; i++) {
    if (used + spans[i] > TOTAL_COLS && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
      used = 0;
    }
    currentRow.push(i);
    used += spans[i];
  }
  if (currentRow.length > 0) rows.push(currentRow);

  const colStarts: number[] = new Array(spans.length).fill(1);
  for (const row of rows) {
    const rowUsed = row.reduce((sum, i) => sum + spans[i], 0);
    const slack = TOTAL_COLS - rowUsed;
    const offset = slack > 0 ? seeds[row[0]] % (slack + 1) : 0;
    let col = 1 + offset;
    for (const i of row) {
      colStarts[i] = col;
      col += spans[i];
    }
  }
  return colStarts;
}

export default function IdeasPoster({ ideas, techDomainById }: { ideas: Idea[]; techDomainById: Map<string, string> }) {
  const legend = existingCategories(ideas, techDomainById);

  const cards = ideas.map((idea) => {
    const category = categoryOf(idea, techDomainById);
    // G: IdeaShapeCardと同じcontent引数を渡す(shapeForIdeaは純関数なので、両呼び出し元で
    // 同じ引数を渡さないとcropAspect/safeAreaが食い違い、レイアウトのaspect-ratioと実際の
    // 描画がズレてしまう。goofy-hatching-mango.md 2026-07-07第4バッチ)
    const shape = shapeForIdea(idea.id, idea.title, dateLabelOf(idea), { seed: idea.seed, refs: idea.refs });
    const layout = layoutFor(idea, shape.cropAspect);
    return { idea, category, shape, layout };
  });
  const colStarts = computeColStarts(
    cards.map((c) => c.layout.desktopSpan),
    cards.map((c) => hashId(c.idea.id)),
  );

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

      {/* F: 箱≒シルエット化のうえで素直なgap 4〜8px（gap-x/y-1=4px, sm:gap-x/y-2=8px）。
          box自体がシルエットの実bboxにクロップ済みのため、このgapがそのままシルエット間の
          近接距離になる（ニアタッチ〜軽い重なり。widthPct 92〜104%の既存ジッターと組み合わさる） */}
      <div className="grid grid-cols-4 sm:grid-cols-12 gap-x-1 sm:gap-x-2 gap-y-1 sm:gap-y-2 items-start">
        {cards.map(({ idea, category, shape, layout }, i) => {
          // F: box≈シルエットなので、growScale/ネガティブマージンによる相殺は不要。
          // aspect-ratioはクロップ後のbbox比(shape.cropAspect)を使う（歪みなし）。
          // 極端なcropAspect(spanForAspectのコメント参照)はCARD_ASPECT_CLAMP_MIN/MAXでクランプし、
          // 行全体を数百px引き離す破綻を防ぐ（少数の外れ値でわずかな余白が生じるが許容する）
          const style = {
            aspectRatio: Math.min(CARD_ASPECT_CLAMP_MAX, Math.max(CARD_ASPECT_CLAMP_MIN, shape.cropAspect)),
            width: `${layout.widthPct}%`,
            marginTop: `${layout.marginTopPx}px`,
            marginBottom: `${layout.marginBottomPx}px`,
            "--rotate": `${layout.rotateDeg.toFixed(2)}deg`,
          } as CSSProperties;
          const spanClass = SPAN_CLASS_BY_NUM[layout.desktopSpan];
          const colStartClass = COL_START_CLASS_BY_NUM[colStarts[i]];

          return (
            <div
              key={idea.id}
              // group: 子のSVGへ影(drop-shadow)をgroup-hover:で伝える（矩形box-shadowの
              // 「下敷き」を避けるため、影自体はIdeaShapeCard側のsvg要素に付与する。DESIGN差分参照）
              className={`${MOBILE_FULL} ${spanClass} ${colStartClass} ${layout.justifyClass} ${layout.zClass} group relative pointer-events-none transition-transform duration-150 ease-out [transform:rotate(var(--rotate))] motion-safe:hover:[transform:rotate(var(--rotate))_scale(1.02)] motion-safe:hover:z-50`}
              style={style}
            >
              <IdeaShapeCard idea={idea} category={category} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
