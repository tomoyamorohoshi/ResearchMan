import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import {
  DATE_LETTER_SPACING_EM,
  estimateTextWidthEm,
  shapeForIdea,
  TITLE_LETTER_SPACING_EM,
  truncateToEmBudget,
} from "@/lib/ideaShapes";
import { dateLabelOf, type Category, type Idea } from "@/lib/ideas";

// /ideas ポスターUIの1枚 = 1つの不定形SVGシェイプ（DESIGN: goofy-hatching-mango.md）。
// 輪郭沿いに投稿日・タイトルを実テキスト(textPath)で流し、内部のforeignObjectに
// 説明文→罫線→参照リンクを収める。サーバーコンポーネント（JS不要・SEO/a11y向けの実テキスト）。
//
// A: タイトル/日付の弧・フォントサイズはshapeForIdea(idea.id, idea.title, dateLabel)が
// 輪郭全周からの曲率ベース選定で確定済み（切り詰めは行わない。DESIGN差分参照）。
// このコンポーネントは算出済みの値をそのまま描画するだけで、フォントフィッティングや
// 省略記号の計算は一切行わない。
const DESC_FONT_RATIO = 0.031; // 説明文
const LINK_FONT_RATIO = 0.028; // 参照リンクのタイトル
const LINK_LABEL_FONT_RATIO = 0.022; // 参照リンクのCASE/TECHラベル
const CONTENT_GAP_RATIO = 0.014; // 説明文/罫線/リンク間の縦ギャップ（viewBoxW比）

// E: 説明文クランプの整数行化（ユーザーフィードバック修正バッチ）。safeArea.hは輪郭形状ごとに
// 大きく変わる(輪郭が狭い形状では最小8%まで縮む)のに対し、旧実装は行数を固定3行にしていたため、
// 罫線・参照リンクぶんの高さを差し引いた「本当に描画できる行数」を超えることがあった。overflow-
// hiddenの外枠が中途半端な高さで裁ち落とすと、行の途中でグリフが上下半分に切れたり、罫線が
// 直前の行の文字と重なって見える(スクショで実測)。foreignObject内はCSS pxがviewBox単位と等価
// （x/y/width/heightをviewBox座標系で指定しているため）なので、利用可能高さから整数行数を
// 逆算できる。
//
// 実装上の判断（計画への疑義）: 当初は-webkit-line-clamp(inline style)で行数を制御する設計
// だったが、実測(Playwright)でSVG foreignObject内にネストした-webkit-line-clampは
// 「指定した行数を超えて描画される」「親に明示heightを与えても無視される」という信頼できない
// 挙動を示した(まさにユーザー報告の「行の途中でグリフが半分だけ見える／罫線が文字に重なる」
// バグの原因)。この環境では-webkit-line-clampに頼れないと判断し、行数計算(整数行)自体は維持
// しつつ、実際にDOMへ渡す文字列をtruncateToEmBudget(ideaShapes.ts)でJS側に確定させる方式に
// 変更した。参照リンクのタイトルも同じ理由で同じ関数を使う（下記）
const DESC_LINE_HEIGHT_MULT = 1.375; // Tailwindのleading-snug相当（実際の描画にもそのまま使う値）
// 1行あたりの文字幅予算(estimateTextWidthEm)は単語境界での折返しロス(英単語が丸ごと次行に
// 送られる等)を考慮しないため、安全側に少し削って見積もる
const LINE_BUDGET_SAFETY_RATIO = 0.92;
const LINK_ROW_LINE_HEIGHT_MULT = 1.3; // 参照リンク1行の推定行高係数（フォントサイズ比。py-[0.2em]の
// 上下パディングは別途LINK_ROW_PADDING_Y_EMで加算する）
const LINK_ROW_PADDING_Y_EM = 0.2; // 参照リンク行のpy-[0.2em]（上下）
const LINK_LABEL_TRACKING_EM = 0.18; // ラベル(CASE/TECH)のtracking-[0.18em]（1文字ごとの追加字間）
const LINK_ROW_GAP_EM = 0.5; // ラベル-タイトル間のgap-[0.5em]
// G: 参照リンクのタイトルは「…」切り詰め(truncate=1行+ellipsis)をやめ、最大2行の折返しで
// 全文表示する（ユーザーフィードバック修正バッチ）
const LINK_TITLE_MAX_LINES = 2;
// 罫線・参照リンク行の実測値は、単純計算(行高+padding)より系統的に大きい(実測: 罫線は理論値の
// 最大約3.3倍・リンク行1行あたり最大約2.35倍。line-height:normalの既定値やレンダリングの丸め
// など複数要因が重なり正確な理論値の特定が困難だったため、実測の最大値に余裕を持たせた安全係数
// で乗せる方針にした)
const RULE_HEIGHT_SAFETY_MULT = 6; // 罫線のh-px(1px)に掛ける安全係数
const LINK_ROW_HEIGHT_SAFETY_MULT = 1.6; // 参照リンク1行の推定行高に掛ける安全係数
const MIN_DESC_LINES = 1; // 罫線・リンクぶんを差し引いてなお不足する極端なケースの下限（0行にはしない）

// foreignObject直下のdivにはxmlns指定が必要（SVG2仕様）だが、React.HTMLAttributesの型には
// xmlnsが存在しないためHTMLAttributes型にキャストして渡す
const xhtmlNsProps = { xmlns: "http://www.w3.org/1999/xhtml" } as unknown as HTMLAttributes<HTMLDivElement>;

export default function IdeaShapeCard({ idea, category }: { idea: Idea; category: Category }) {
  const dateLabel = dateLabelOf(idea);
  const shape = shapeForIdea(idea.id, idea.title, dateLabel);
  const dateArcId = `idea-date-arc-${idea.id}`;
  const titleArcId = `idea-title-arc-${idea.id}`;
  const ruleColor = category.text === "#1f1f1f" ? "rgba(31,31,31,0.32)" : "rgba(244,240,230,0.4)";
  const w = shape.viewBoxW;

  // E/G: 罫線＋参照リンク領域の高さを必ず確保したうえで、残りの高さに収まる整数行数を説明文に
  // 使う（foreignObject内はCSS px = viewBox単位。DESIGN差分参照）。参照リンクのタイトルは
  // truncate(1行+…)をやめ最大LINK_TITLE_MAX_LINES行の折返しで全文表示するため、行数は
  // タイトル文字幅に応じて1〜2行で変動する。その実測行数ぶんを罫線・リンク領域の高さ予約に
  // 反映してから、残りを説明文の行数に充てる
  const hasRefs = idea.refs.length > 0;
  const descFontSizePx = w * DESC_FONT_RATIO;
  const linkFontSizePx = w * LINK_FONT_RATIO;
  const linkLabelFontSizePx = w * LINK_LABEL_FONT_RATIO;
  const gapPx = w * CONTENT_GAP_RATIO;

  // 各refのタイトルをLINK_TITLE_MAX_LINES行に収まる文字数へ切り詰め、実際に必要な行数を見積もる
  // （ラベル(CASE/TECH)+gap分を差し引いた残り幅がタイトルの折返し幅）
  const refInfos = idea.refs.map((ref) => {
    const labelText = ref.type === "tech" ? "Tech" : "Case";
    const labelWidthPx = (estimateTextWidthEm(labelText) + labelText.length * LINK_LABEL_TRACKING_EM) * linkLabelFontSizePx;
    const availableTitlePx = Math.max(1, shape.safeArea.w - labelWidthPx - LINK_ROW_GAP_EM * linkFontSizePx);
    const availableTitleEm = availableTitlePx / linkFontSizePx;
    const titleBudgetEm = availableTitleEm * LINK_TITLE_MAX_LINES * LINE_BUDGET_SAFETY_RATIO;
    const truncatedTitle = truncateToEmBudget(ref.title, titleBudgetEm);
    const lines = Math.min(
      LINK_TITLE_MAX_LINES,
      Math.max(1, Math.ceil(estimateTextWidthEm(truncatedTitle) / availableTitleEm)),
    );
    return { ref, labelText, truncatedTitle, lines };
  });

  const linkRowHeightPxFor = (lines: number) =>
    linkFontSizePx * (LINK_ROW_LINE_HEIGHT_MULT * lines + LINK_ROW_PADDING_Y_EM * 2) * LINK_ROW_HEIGHT_SAFETY_MULT;
  const ruleHeightPx = RULE_HEIGHT_SAFETY_MULT; // RULE_HEIGHT_UNITS(1px)×安全係数
  const reservedHeightPx = hasRefs
    ? ruleHeightPx + refInfos.reduce((sum, r) => sum + linkRowHeightPxFor(r.lines), 0) + 2 * gapPx // p<->rule, rule<->linksの2ギャップ
    : 0;
  const descLineHeightPx = descFontSizePx * DESC_LINE_HEIGHT_MULT;
  const availableForDescPx = Math.max(0, shape.safeArea.h - reservedHeightPx);
  const maxDescLines = Math.max(MIN_DESC_LINES, Math.floor(availableForDescPx / descLineHeightPx));

  // 説明文もリンクタイトルと同じ理由でtruncateToEmBudgetによりJS側で文字列を確定する
  const descAvailableEmPerLine = shape.safeArea.w / descFontSizePx;
  const descBudgetEm = descAvailableEmPerLine * maxDescLines * LINE_BUDGET_SAFETY_RATIO;
  const descText = truncateToEmBudget(idea.seed, descBudgetEm);

  // ラッパーの明示height+overflow-hiddenは、文字幅見積もりの誤差(半角/全角の簡易推定・単語境界
  // での折返し等)による万一のわずかなはみ出しに対する安全網。-webkit-line-clampには頼らない
  // （通常のブロックレイアウトなのでheightの解決に上記のような信頼性問題は生じない。実測確認済み）
  const descWrapperStyle: CSSProperties = { height: `${maxDescLines * descLineHeightPx}px` };
  const descStyle: CSSProperties = { fontSize: `${descFontSizePx}px`, lineHeight: DESC_LINE_HEIGHT_MULT };
  const linkStyle: CSSProperties = { fontSize: `${linkFontSizePx}px` };
  const linkLabelStyle: CSSProperties = { fontSize: `${linkLabelFontSizePx}px`, opacity: 0.75 };

  return (
    <svg
      viewBox={`0 0 ${shape.viewBoxW} ${shape.viewBoxH}`}
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

      {/* 投稿日: 輪郭に沿う小さめの文字。弧・フォントサイズはshapeForIdea側で全文が収まるよう
          確定済み(切り詰めなし)。aria-hidden: 親svgのaria-label（同内容）との二重読み上げを避ける */}
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

      {/* タイトル: 輪郭に沿う大きめの文字（font-black相当）。弧・フォントサイズはshapeForIdea側で
          全文が収まるよう確定済み(切り詰めなし。縦走・斜め走もあり得る)。aria-hiddenの理由は投稿日と同じ。
          H: 曲率がきついサーブでグリフ同士が視覚的に詰まって見える対策として字間を少し空ける
          （幅見積もり側にも同じ値を反映済み。shapeForIdea参照） */}
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

      <foreignObject x={shape.safeArea.x} y={shape.safeArea.y} width={shape.safeArea.w} height={shape.safeArea.h}>
        <div
          // foreignObject直下はXHTML名前空間の明示が必要（SVG2仕様）。xmlnsはReact.HTMLAttributesの
          // 型に無いためxhtmlNsPropsでキャストして渡す
          {...xhtmlNsProps}
          style={{ color: category.text, gap: `${w * CONTENT_GAP_RATIO}px` }}
          className="h-full flex flex-col justify-center overflow-hidden pointer-events-auto"
        >
          {/* shrink-0: このflexコンテナは既定でflex-shrink:1のため、内容全体がreservedHeightPxの
              見積もり誤差等でoverflowした場合にブラウザが子を圧縮しうる。圧縮されると整数行の
              境界を無視して中途半端な高さに切り詰められる恐れがあるため、3ブロック
              (説明文ラッパー/罫線/リンク一覧)とも圧縮自体を禁止する。
              min-h-0: flex子要素は既定でmin-height:autoとなり、これは中身のcontent-basedな
              最小サイズとして解決されるため、明示heightを指定してもそれより小さくはならない
              (実測: heightを与えてもラッパー自身のgetBoundingClientRectが変化しなかった)。
              min-h-0でこの自動最小サイズを無効化し、明示heightを実効させる */}
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
                {/* G: truncate(1行+…)をやめ、最大LINK_TITLE_MAX_LINES行の折返しで全文表示する。
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
