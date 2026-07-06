import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import { shapeForIdea, TITLE_FONT_RATIO } from "@/lib/ideaShapes";
import { dateLabelOf, type Category, type Idea } from "@/lib/ideas";

// /ideas ポスターUIの1枚 = 1つの不定形SVGシェイプ（DESIGN: goofy-hatching-mango.md）。
// 輪郭沿いに投稿日(上辺)・タイトル(下辺)を実テキスト(textPath)で流し、内部のforeignObjectに
// 説明文→罫線→参照リンクを収める。サーバーコンポーネント（JS不要・SEO/a11y向けの実テキスト）。
//
// フォントサイズについて: foreignObject内のCSS px・SVG<text>のfontSizeはどちらもSVGのviewBox座標系
// （＝shape.viewBoxWを幅の基準にした「user unit」）で解釈される。シェイプごとにviewBoxWが違う
// （tallOval=64〜waveRect=125）ため、絶対値で固定すると同じ物理サイズのカードでもシェイプによって
// 見た目の文字サイズがバラついてしまう。viewBoxWに対する比率で計算することで、どのシェイプでも
// カード幅が同じなら文字の物理サイズも揃う。
// TITLE_FONT_RATIO（下辺タイトルの基準フォントサイズ比率）はsrc/lib/ideaShapes.tsからimportする
// （safeAreaのタイトル側マージン予約(A3)と同じ値を共有する単一の真実源。二重定義によるズレを防ぐ）
const TITLE_FONT_MIN_RATIO = 0.038; // タイトルの最小フォントサイズ（これ以上は縮めない。収まらなければ末尾を省略記号で切り詰める）
const DATE_FONT_RATIO = 0.036; // 上辺投稿日（基準サイズ。弧が短い縦長シェイプ等では下限まで縮める）
const DATE_FONT_MIN_RATIO = 0.02; // 日付の最小フォントサイズ（これ以上は縮めない。収まらなければ末尾を省略記号で切り詰める）
const DATE_LETTER_SPACING_EM = 0.14; // <text letterSpacing>と同じ値。幅見積もりにも使う単一の真実源
const DESC_FONT_RATIO = 0.031; // 説明文
const LINK_FONT_RATIO = 0.028; // 参照リンクのタイトル
const LINK_LABEL_FONT_RATIO = 0.022; // 参照リンクのCASE/TECHラベル
// タイトル弧・日付弧に対して使ってよい実長の割合（残りは余白）。arcLengthは折れ線近似で実測より
// 1〜5%長めに出るため、それを相殺する分も込みでやや控えめに設定
const ARC_FILL_RATIO = 0.86;
const CONTENT_GAP_RATIO = 0.014; // 説明文/罫線/リンク間の縦ギャップ（viewBoxW比）

// idea.titleの推定表示幅（em単位）。全角(CJK仮名漢字等)は1.0em、半角(ASCII等)は0.6em という
// 実測（getComputedTextLength）に基づく簡易ヒューリスティック。フォントの実測はサーバー側では
// できないため、可変フォントサイズの見積もりに使う（スモークテストからも参照するためexport）
export function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e7f ? 1.0 : 0.6; // 0x2e7fはCJK記号・仮名・漢字より前の境界のおおよその目安
  }
  return width;
}

// C1: タイトル/日付がフォント下限まで縮めても弧の実長budgetLengthPxに収まらない場合、
// 末尾を"…"で切り詰める。textPathはCSSのtext-overflow相当の自動省略をしないため、
// はみ出しっぱなしで文字が輪郭の外へ流れる/隣のカードと衝突する事態を避けるための事前計算
// （自動生成タイトルが将来長文化しても壊れない保険。スモークテストからも参照するためexport）。
// extraEmPerCharは<text letterSpacing>分の追加幅（日付ラベルのuppercase letterSpacing="0.14em"を
// 幅見積もりに含めるためのオプション。タイトル側はletterSpacing無しなので既定0=後方互換）
export function truncateToArcBudget(
  title: string,
  budgetLengthPx: number,
  fontSizePx: number,
  extraEmPerChar = 0,
): string {
  const ELLIPSIS = "…";
  const widthPx = (s: string) => (estimateTextWidthEm(s) + s.length * extraEmPerChar) * fontSizePx;
  if (widthPx(title) <= budgetLengthPx) return title;
  const chars = Array.from(title);
  for (let n = chars.length - 1; n >= 1; n--) {
    const candidate = chars.slice(0, n).join("") + ELLIPSIS;
    if (widthPx(candidate) <= budgetLengthPx) return candidate;
  }
  return ELLIPSIS;
}

// foreignObject直下のdivにはxmlns指定が必要（SVG2仕様）だが、React.HTMLAttributesの型には
// xmlnsが存在しないためHTMLAttributes型にキャストして渡す
const xhtmlNsProps = { xmlns: "http://www.w3.org/1999/xhtml" } as unknown as HTMLAttributes<HTMLDivElement>;

export default function IdeaShapeCard({ idea, category }: { idea: Idea; category: Category }) {
  const shape = shapeForIdea(idea.id);
  const dateLabel = dateLabelOf(idea);
  const dateArcId = `idea-date-arc-${idea.id}`;
  const titleArcId = `idea-title-arc-${idea.id}`;
  const ruleColor = category.text === "#1f1f1f" ? "rgba(31,31,31,0.32)" : "rgba(244,240,230,0.4)";
  const w = shape.viewBoxW;

  const descStyle: CSSProperties = { fontSize: `${w * DESC_FONT_RATIO}px` };
  const linkStyle: CSSProperties = { fontSize: `${w * LINK_FONT_RATIO}px` };
  const linkLabelStyle: CSSProperties = { fontSize: `${w * LINK_LABEL_FONT_RATIO}px`, opacity: 0.75 };

  // タイトルは長さ可変（8〜15文字超まで実データで幅がある）のため、弧の実長に収まるよう
  // 上限〜下限の間でフォントサイズを縮める（長い題は少し小さく・短い題は基準サイズのまま）。
  // 下限まで縮めてもなお弧の実長budgetに収まらない場合は、C1: 末尾を"…"で切り詰める
  // （textPathはtext-overflow相当の自動省略をしないため事前計算が必須）
  const titleBaseFontSize = w * TITLE_FONT_RATIO;
  const titleMinFontSize = w * TITLE_FONT_MIN_RATIO;
  const titleWidthEm = estimateTextWidthEm(idea.title);
  const titleBudget = shape.titleArcLength * ARC_FILL_RATIO;
  const titleFitFontSize = titleWidthEm > 0 ? titleBudget / titleWidthEm : titleBaseFontSize;
  const titleFontSize = Math.min(titleBaseFontSize, Math.max(titleMinFontSize, titleFitFontSize));
  const displayTitle =
    titleFitFontSize < titleMinFontSize ? truncateToArcBudget(idea.title, titleBudget, titleMinFontSize) : idea.title;

  // 投稿日も同様（A: 浅い弧の制約で日付弧が短くなる縦長シェイプ等では、基準サイズのままだと
  // "ARCHIVE"や"YYYY.MM.DD"がtextPathの弧長を超え、両端が自動的に描画されず欠けて見える。
  // letterSpacing分の追加幅もextraEmPerCharで見積もりに含める）
  const dateBaseFontSize = w * DATE_FONT_RATIO;
  const dateMinFontSize = w * DATE_FONT_MIN_RATIO;
  const dateWidthEm = estimateTextWidthEm(dateLabel) + dateLabel.length * DATE_LETTER_SPACING_EM;
  const dateBudget = shape.dateArcLength * ARC_FILL_RATIO;
  const dateFitFontSize = dateWidthEm > 0 ? dateBudget / dateWidthEm : dateBaseFontSize;
  const dateFontSize = Math.min(dateBaseFontSize, Math.max(dateMinFontSize, dateFitFontSize));
  const displayDateLabel =
    dateFitFontSize < dateMinFontSize
      ? truncateToArcBudget(dateLabel, dateBudget, dateMinFontSize, DATE_LETTER_SPACING_EM)
      : dateLabel;

  return (
    <svg
      viewBox={`0 0 ${shape.viewBoxW} ${shape.viewBoxH}`}
      className="block w-full h-full overflow-visible pointer-events-none"
      role="group"
      aria-label={`${idea.title}（${dateLabel}）`}
    >
      <path d={shape.outlinePath} fill={category.fill} className="pointer-events-auto" />
      <path id={dateArcId} d={shape.dateArcPath} fill="none" />
      <path id={titleArcId} d={shape.titleArcPath} fill="none" />

      {/* 投稿日: 上辺の輪郭に沿う小さめの文字。長い日付ラベル・弧が短いシェイプでは自動縮小・
          それでも収まらなければ省略記号で切り詰め済み(displayDateLabel)。
          aria-hidden: 親svgのaria-label（省略前の原文）と内容が重複する上、切り詰め後は
          むしろ不完全な情報になるため、スクリーンリーダーへの二重読み上げを避ける */}
      <text
        fontSize={dateFontSize}
        fontWeight={700}
        letterSpacing={`${DATE_LETTER_SPACING_EM}em`}
        style={{ fill: category.text }}
        className="uppercase tabular-nums select-none pointer-events-auto"
        aria-hidden="true"
      >
        <textPath href={`#${dateArcId}`} startOffset="50%" textAnchor="middle">
          {displayDateLabel}
        </textPath>
      </text>

      {/* タイトル: 下辺の輪郭に沿う大きめの文字（font-black相当）。長い題は弧に収まるよう自動縮小・
          それでも収まらなければ省略記号で切り詰め済み(displayTitle)。aria-hiddenの理由は投稿日と同じ */}
      <text
        fontSize={titleFontSize}
        fontWeight={900}
        style={{ fill: category.text }}
        className="select-none pointer-events-auto"
        aria-hidden="true"
      >
        <textPath href={`#${titleArcId}`} startOffset="50%" textAnchor="middle">
          {displayTitle}
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
          <p className="leading-snug line-clamp-3" style={descStyle}>
            {idea.seed}
          </p>
          {idea.refs.length > 0 && <div className="h-px shrink-0" style={{ backgroundColor: ruleColor }} />}
          <div className="flex flex-col min-h-0 overflow-hidden">
            {idea.refs.map((ref) => (
              <Link
                key={`${ref.type}-${ref.id}`}
                href={ref.type === "tech" ? `/technology/${ref.id}` : `/cases/${ref.id}`}
                title={ref.desc}
                className="group flex items-center gap-[0.5em] py-[0.2em] hover:underline focus-visible:outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current rounded-sm"
                style={linkStyle}
              >
                <span className="font-black tracking-[0.18em] uppercase shrink-0" style={linkLabelStyle}>
                  {ref.type === "tech" ? "Tech" : "Case"}
                </span>
                <span className="font-bold flex-1 min-w-0 truncate">{ref.title}</span>
              </Link>
            ))}
          </div>
        </div>
      </foreignObject>
    </svg>
  );
}
