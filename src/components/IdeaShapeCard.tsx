import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import {
  CONTENT_GAP_RATIO,
  DATE_LETTER_SPACING_EM,
  DESC_FONT_MAX_RATIO,
  DESC_LINE_HEIGHT_MULT,
  estimateTextWidthEm,
  LINE_BUDGET_SAFETY_RATIO,
  LINK_LABEL_TRACKING_EM,
  LINK_ROW_GAP_EM,
  LINK_TITLE_MAX_LINES,
  TITLE_LETTER_SPACING_EM,
  truncateToEmBudget,
  type IdeaShape,
} from "@/lib/ideaShapes";
import { dateLabelOf, type Category, type Idea } from "@/lib/ideas";

// /ideas ポスターUIの1枚 = 1つの不定形SVGシェイプ（DESIGN: goofy-hatching-mango.md）。
// 輪郭沿いに投稿日・タイトルを実テキスト(textPath)で流し、内部のforeignObjectに
// 説明文→罫線→参照リンクを収める。サーバーコンポーネント（JS不要・SEO/a11y向けの実テキスト）。
//
// H: 固定2サイズタイポグラフィ（goofy-hatching-mango.md 2026-07-07バッチ・改訂計画）。
// タイトル/日付/本文/リンクのフォントサイズ・safeAreaサイズ・説明文の行数・必要高さ・
// 参照リンクの折返し行数は、すべてsolveFixedSizeShape(ideaShapes.ts)がカードのレンダリング
// スケールを解く過程で確定済み（shape.dateFontSize=サイズB, shape.titleFontSize=サイズA,
// shape.descRequiredHeightPx, shape.reservedLinksHeightPx, shape.linkLabelFontSize等）。
// このコンポーネントは算出済みの値をそのまま描画するだけで、フォントフィッティング
// (旧shrink-to-fit探索)は一切行わない。

// foreignObject直下のdivにはxmlns指定が必要（SVG2仕様）だが、React.HTMLAttributesの型には
// xmlnsが存在しないためHTMLAttributes型にキャストして渡す
const xhtmlNsProps = { xmlns: "http://www.w3.org/1999/xhtml" } as unknown as HTMLAttributes<HTMLDivElement>;

// H: shapeはIdeasPoster.tsx側でsolveFixedSizeShapeを1回だけ呼んで確定させたものを受け取る。
// 呼び出しを1箇所に集約しているため、本コンポーネント内でシェイプ関連の再計算は行わない
export default function IdeaShapeCard({ idea, category, shape }: { idea: Idea; category: Category; shape: IdeaShape }) {
  const dateLabel = dateLabelOf(idea);
  const dateArcId = `idea-date-arc-${idea.id}`;
  const titleArcId = `idea-title-arc-${idea.id}`;
  const ruleColor = category.text === "#1f1f1f" ? "rgba(31,31,31,0.32)" : "rgba(244,240,230,0.4)";

  // H: 日付・本文・参照リンクのタイトルはすべてサイズB(shape.dateFontSize)で統一されている。
  // CASE/TECHラベルはsolveFixedSizeShape側で計算済みのlinkLabelFontSizeを使う
  const bodyFontSizePx = shape.dateFontSize;
  const linkLabelFontSizePx = shape.linkLabelFontSize ?? bodyFontSizePx;
  const hasRefs = idea.refs.length > 0;

  // 各refのタイトルをLINK_TITLE_MAX_LINES行に収まる文字数へ切り詰める(表示側の切り詰め幅は
  // 従来どおりLINK_TITLE_MAX_LINES=2行分の文字数のまま。予約高さ側(shape.refLineCounts経由の
  // reservedLinksHeightPx)は実測係数により3行相当を見込む場合があるが、切り詰めロジック自体は
  // 前バッチのスコープ外のため変更しない)
  const refInfos = idea.refs.map((ref) => {
    const labelText = ref.type === "tech" ? "Tech" : "Case";
    const labelWidthPx = (estimateTextWidthEm(labelText) + labelText.length * LINK_LABEL_TRACKING_EM) * linkLabelFontSizePx;
    const availableTitlePx = Math.max(1, shape.safeArea.w - labelWidthPx - LINK_ROW_GAP_EM * bodyFontSizePx);
    const availableTitleEm = availableTitlePx / bodyFontSizePx;
    const titleBudgetEm = availableTitleEm * LINK_TITLE_MAX_LINES * LINE_BUDGET_SAFETY_RATIO;
    const truncatedTitle = truncateToEmBudget(ref.title, titleBudgetEm);
    return { ref, labelText, truncatedTitle };
  });

  const reservedHeightPx = hasRefs ? (shape.reservedLinksHeightPx ?? 0) : 0;
  const descRequiredHeightPx = shape.descRequiredHeightPx ?? 0;
  const descText = idea.seed;

  // H: コンテンツ間の縦ギャップ(説明文/罫線/リンク間)は、solveFixedSizeShape内の
  // estimateReservedLinksDetail呼び出しが仮定したgapPxと厳密に同じ式(bodyVB×
  // CONTENT_GAP_RATIO/DESC_FONT_MAX_RATIO)を使う必要がある(旧w*CONTENT_GAP_RATIOのままだと
  // 予約高さ計算の前提とズレて、実際のflexギャップが予約より大きくなり下端が食み出しうる)
  const gapPx = bodyFontSizePx * (CONTENT_GAP_RATIO / DESC_FONT_MAX_RATIO);

  const descWrapperStyle: CSSProperties = { height: `${descRequiredHeightPx}px` };
  const descStyle: CSSProperties = {
    fontSize: `${bodyFontSizePx}px`,
    lineHeight: DESC_LINE_HEIGHT_MULT,
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };
  // H: 行重なり調査バッチ(2026-07-07)で、参照リンクタイトル(2行折返しあり)がlineHeight未指定
  // ゆえ継承値(Tailwind preflightのhtml{line-height:1.5})に頼っていたことを発見した。
  // DESC_LINE_HEIGHT_MULT校正の根拠(ideaShapes.ts参照)は本文と同じviewBox局所フォントサイズの
  // ラスタライズ特性に基づくため、継承任せの1.5(実測必要比1.4816に対し安全余裕1.3%しかない
  // 薄氷の値)ではなく、本文と同じ校正済み倍率を明示指定する
  const linkStyle: CSSProperties = { fontSize: `${bodyFontSizePx}px`, lineHeight: DESC_LINE_HEIGHT_MULT };
  const linkLabelStyle: CSSProperties = { fontSize: `${linkLabelFontSizePx}px`, opacity: 0.75 };

  // H: solveFixedSizeShapeはsafeArea自体をdescRequiredHeightPx+reservedHeightPxがsafeAreaMaxGrowH
  // 以内に収まるよう解いた上で確定させているため、原則としてfoHeight=safeArea.hで十分収まる。
  // 数式上のごく僅かな余裕や安全網として、旧モデルと同じMath.min/Math.maxのクランプ・
  // justify切替(内容がsafeArea.hを僅かに超える場合のみ上詰めにして末尾側を優先的に切り詰める)
  // をそのまま維持する
  const totalContentHeightPx = descRequiredHeightPx + reservedHeightPx;
  const foHeight = Math.min(shape.safeAreaMaxGrowH, Math.max(shape.safeArea.h, totalContentHeightPx));
  const foY = shape.safeArea.y - (foHeight - shape.safeArea.h) / 2;
  const contentOverflowsBox = totalContentHeightPx > foHeight + 1e-6;
  const contentJustifyClass = contentOverflowsBox ? "justify-start" : "justify-center";

  return (
    <svg
      // F: viewBoxを輪郭の実bbox±小マージンにクロップする。「箱≒シルエット」にすることで、
      // IdeasPoster側の素直なCSS gapがそのままシルエット間の近接距離になる
      viewBox={`${shape.cropViewBox.x} ${shape.cropViewBox.y} ${shape.cropViewBox.w} ${shape.cropViewBox.h}`}
      // F: ホバー時の影はラッパー(透明な矩形)のbox-shadowではなく、この要素へのfilter:
      // drop-shadow(...)にする。drop-shadowはアルファチャンネル(=シェイプの輪郭)に沿って
      // 落ちるため、box-shadowで起きていた「矩形の下敷きが見える」問題が起きない
      // （ラッパー側のgroupクラスとgroup-hover:で連動。IdeasPoster.tsx参照）
      className="block w-full h-full overflow-visible pointer-events-none transition-[filter] duration-150 ease-out motion-safe:group-hover:drop-shadow-xl"
      role="group"
      aria-label={`${idea.title}（${dateLabel}）`}
    >
      <path d={shape.outlinePath} fill={category.fill} className="pointer-events-auto" />
      <path id={dateArcId} d={shape.dateArcPath} fill="none" />
      <path id={titleArcId} d={shape.titleArcPath} fill="none" />

      {/* 投稿日: 輪郭に沿う小さめの文字（サイズB）。弧・フォントサイズはsolveFixedSizeShape側で
          固定サイズちょうどに確定済み(切り詰めなし)。aria-hidden: 親svgのaria-label（同内容）
          との二重読み上げを避ける */}
      <text
        fontSize={shape.dateFontSize}
        fontWeight={700}
        letterSpacing={`${DATE_LETTER_SPACING_EM}em`}
        style={{ fill: category.text }}
        className="uppercase tabular-nums select-none pointer-events-auto"
        aria-hidden="true"
      >
        <textPath href={`#${dateArcId}`} startOffset="50%" textAnchor="middle">
          {dateLabel}
        </textPath>
      </text>

      {/* タイトル: 輪郭に沿う大きめの文字（font-black相当、サイズA）。弧・フォントサイズは
          solveFixedSizeShape側で固定サイズちょうどに確定済み(切り詰めなし。縦走・斜め走もあり得る)。
          aria-hiddenの理由は投稿日と同じ。曲率がきつい弧でグリフ同士が視覚的に詰まって見える対策
          として字間を少し空ける（幅見積もり側にも同じ値を反映済み。ideaShapes.ts参照） */}
      <text
        fontSize={shape.titleFontSize}
        fontWeight={900}
        letterSpacing={`${TITLE_LETTER_SPACING_EM}em`}
        style={{ fill: category.text }}
        className="select-none pointer-events-auto"
        aria-hidden="true"
      >
        <textPath href={`#${titleArcId}`} startOffset="50%" textAnchor="middle">
          {idea.title}
        </textPath>
      </text>

      <foreignObject x={shape.safeArea.x} y={foY} width={shape.safeArea.w} height={foHeight}>
        <div
          // foreignObject直下はXHTML名前空間の明示が必要（SVG2仕様）。xmlnsはReact.HTMLAttributesの
          // 型に無いためxhtmlNsPropsでキャストして渡す
          {...xhtmlNsProps}
          style={{ color: category.text, gap: `${gapPx}px` }}
          className={`h-full flex flex-col ${contentJustifyClass} overflow-hidden pointer-events-auto`}
        >
          {/* shrink-0/min-h-0の理由は前バッチと同じ(flexの自動圧縮・自動最小サイズを無効化し、
              明示heightを実効させる) */}
          <div className="shrink-0 min-h-0 overflow-hidden" style={descWrapperStyle}>
            <p style={descStyle}>{descText}</p>
          </div>
          {idea.refs.length > 0 && <div className="h-px shrink-0" style={{ backgroundColor: ruleColor }} />}
          <div className="flex flex-col shrink-0 min-h-0 overflow-hidden">
            {refInfos.map(({ ref, labelText, truncatedTitle }) => (
              <Link
                key={`${ref.type}-${ref.id}`}
                href={ref.type === "tech" ? `/technology/${ref.id}` : `/cases/${ref.id}`}
                title={ref.desc}
                className="group flex items-center gap-[0.5em] py-[0.2em] hover:underline focus-visible:outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current rounded-sm"
                style={linkStyle}
              >
                <span className="font-black tracking-[0.18em] uppercase shrink-0" style={linkLabelStyle}>
                  {labelText}
                </span>
                {/* truncate(1行+…)をやめ、最大LINK_TITLE_MAX_LINES行の折返しで全文表示する。
                    truncatedTitleはtruncateToEmBudgetでその行数に収まるよう既に確定済み（万一の
                    見積もり誤差でも、単純な折返し表示自体はグリフを欠けさせない） */}
                <span className="font-bold flex-1 min-w-0">{truncatedTitle}</span>
              </Link>
            ))}
          </div>
        </div>
      </foreignObject>
    </svg>
  );
}
