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

// D: 外箱基準をやめ「シルエット基準」の近接パッキングにする（ユーザーフィードバック修正バッチ）。
// shape.outlineInset(輪郭の実bboxが外箱=viewBoxの四辺からどれだけ引っ込んでいるか)の実ピクセル
// 換算ぶんをネガティブマージンで相殺し、外箱ではなく実際のシルエット同士がニアタッチする間隔にする。
//
// マージンのパーセンテージ値はCSS仕様上「containing blockの幅」(=グリッドエリア幅。margin-top/
// bottomも含め、垂直方向のパーセンテージも常に幅基準というCSSの伝統的挙動)を基準に解決される。
// カード自身の幅はwidthPct(このグリッドエリア幅に対する割合)で決まり、SVGはviewBoxとCSS
// aspect-ratioを一致させているため常に等倍(uniform)スケールで描画される(ファイル冒頭コメント
// 参照。歪み回避のための既存設計)。したがって「viewBox単位のインセット」×「等倍スケール」で
// 求まる実ピクセル値を、そのままareaWidth比のパーセンテージへ変換するには widthPct を掛けるだけ
// でよい(= insetUnits/viewBoxW × widthPct)。上下左右どの辺でも同じ式が成り立つ
// (垂直方向のインセットも、常に等倍スケールなのでviewBoxWを分母に使ってよい)。
//
// 実装上の判断（計画への疑義）: 当初はマージンのみで相殺する設計だったが、CSS Gridは列トラック
// 幅が固定(grid-cols-N)で、marginは対応するjustify-self(start/end)側のみが実際に位置へ効く
// (逆側は無効)ことが実測で判明した。左右の一方だけをマージンで動かしても、固定幅ボックスの
// もう一方の辺は連動して同じ距離だけ動くため、反対側のインセットはむしろ相殺されない
// （実測: 有効側だけの相殺では隣接シルエット間が50〜180px级のまま残り、目標の0〜12pxに
// 遠く届かなかった）。そこで、box自体をgrowScaleForで算出した倍率ぶんだけ拡大したうえで
// (aspect-ratioは維持=歪みなし。widthPctの既存ジッター機構の延長)、アンカー側のみ
// マージンで追加補正する。この2つを組み合わせると、拡大していないボックスの元の外周位置に
// シルエットの両端がちょうど届く計算になる(数式的に導出・確認済み)。マージン/translateのみ
// では目標の近接度に届かないという実測結果を報告に明記する。
// 実測(Playwrightスクショ)で1.4は特に細いviewBox(tallOval等)のカードを他カードに対して
// 著しく肥大化させ、ページ左右にはみ出す/周囲に不自然な空白を作る視覚的破綻を起こした。
// S/M/Lの意図したサイズ階層を壊さない範囲に抑えるため、大幅に低い上限に変更する
// （相殺しきれない残差はネガティブマージンとCSS gapの縮小に委ねる）
const GROW_SCALE_MAX = 1.18;

function growScaleFor(shape: { viewBoxW: number; viewBoxH: number; outlineInset: { top: number; right: number; bottom: number; left: number } }): number {
  const bboxW = shape.viewBoxW - shape.outlineInset.left - shape.outlineInset.right;
  const bboxH = shape.viewBoxH - shape.outlineInset.top - shape.outlineInset.bottom;
  const gsX = bboxW > 0 ? shape.viewBoxW / bboxW : 1;
  const gsY = bboxH > 0 ? shape.viewBoxH / bboxH : 1;
  return Math.min(GROW_SCALE_MAX, Math.max(gsX, gsY, 1));
}

function insetMarginPercent(insetUnits: number, viewBoxW: number, widthPct: number): number {
  return (insetUnits / viewBoxW) * widthPct;
}

function layoutFor(idea: Idea): CardLayout {
  const h = hashId(idea.id);
  const tier: SizeTier = h % 3 === 0 ? "S" : h % 3 === 1 ? "M" : "L";
  const spanOptions = DESKTOP_SPAN_OPTIONS[tier];
  const desktopSpan = spanOptions[Math.floor(h / 3) % spanOptions.length];
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
    const shape = shapeForIdea(idea.id, idea.title, dateLabelOf(idea));
    const layout = layoutFor(idea);
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

      {/* C: 密パッキング（GOOD SUMMER級。gap 4〜10px級・ニアタッチ〜軽い重なり） */}
      <div className="grid grid-cols-4 sm:grid-cols-12 gap-x-1 sm:gap-x-2 gap-y-1 sm:gap-y-2 items-start">
        {cards.map(({ idea, category, shape, layout }, i) => {
          // D: シルエット基準の近接パッキング。box自体をgrowScale倍だけ拡大(aspect-ratio維持=
          // 歪みなし)したうえで、各辺のインセットをネガティブマージンに変換する
          // （insetMarginPercent参照。growScaleFor/GROW_SCALE_MAXのコメントに導出根拠）。
          // 上下の既存ジッター(marginTopPx/marginBottomPx)は「呼吸感」を保つためそのまま残し、
          // インセット相殺ぶんをcalc()で追加で差し引く
          const growScale = growScaleFor(shape);
          const effectiveWidthPct = layout.widthPct * growScale;
          const insetTopPct = insetMarginPercent(shape.outlineInset.top, shape.viewBoxW, effectiveWidthPct);
          const insetRightPct = insetMarginPercent(shape.outlineInset.right, shape.viewBoxW, effectiveWidthPct);
          const insetBottomPct = insetMarginPercent(shape.outlineInset.bottom, shape.viewBoxW, effectiveWidthPct);
          const insetLeftPct = insetMarginPercent(shape.outlineInset.left, shape.viewBoxW, effectiveWidthPct);
          const style = {
            aspectRatio: shape.aspect,
            width: `${effectiveWidthPct}%`,
            marginTop: `calc(${layout.marginTopPx}px - ${insetTopPct}%)`,
            marginBottom: `calc(${layout.marginBottomPx}px - ${insetBottomPct}%)`,
            marginLeft: `-${insetLeftPct}%`,
            marginRight: `-${insetRightPct}%`,
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
