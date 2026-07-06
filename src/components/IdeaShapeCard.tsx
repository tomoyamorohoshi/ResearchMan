import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import { shapeForIdea } from "@/lib/ideaShapes";
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
const TITLE_FONT_RATIO = 0.076; // 下辺タイトル（大きめ・font-black相当。基準=このratioで収まる場合の上限サイズ）
const TITLE_FONT_MIN_RATIO = 0.038; // タイトルの最小フォントサイズ（これ以上は縮めない。収まらなければ僅かな溢れを許容）
const DATE_FONT_RATIO = 0.036; // 上辺投稿日
const DESC_FONT_RATIO = 0.031; // 説明文
const LINK_FONT_RATIO = 0.028; // 参照リンクのタイトル
const LINK_LABEL_FONT_RATIO = 0.022; // 参照リンクのCASE/TECHラベル
// タイトル弧に対して使ってよい実長の割合（残りは余白）。titleArcLengthは折れ線近似で実測より
// 1〜5%長めに出るため、それを相殺する分も込みでやや控えめに設定
const TITLE_ARC_FILL_RATIO = 0.86;
const CONTENT_GAP_RATIO = 0.014; // 説明文/罫線/リンク間の縦ギャップ（viewBoxW比）

// idea.titleの推定表示幅（em単位）。全角(CJK仮名漢字等)は1.0em、半角(ASCII等)は0.6em という
// 実測（getComputedTextLength）に基づく簡易ヒューリスティック。フォントの実測はサーバー側では
// できないため、可変フォントサイズの見積もりに使う
function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e7f ? 1.0 : 0.6; // 0x2e7fはCJK記号・仮名・漢字より前の境界のおおよその目安
  }
  return width;
}

// foreignObject直下のdivにはxmlns指定が必要（SVG2仕様）だが、React.HTMLAttributesの型には
// xmlnsが存在しないためHTMLAttributes型にキャストして渡す
const xhtmlNsProps = { xmlns: "http://www.w3.org/1999/xhtml" } as unknown as HTMLAttributes<HTMLDivElement>;

export default function IdeaShapeCard({ idea, category }: { idea: Idea; category: Category }) {
  const shape = shapeForIdea(idea.id);
  const dateLabel = dateLabelOf(idea);
  const titleTextId = `idea-title-${idea.id}`;
  const dateArcId = `idea-date-arc-${idea.id}`;
  const titleArcId = `idea-title-arc-${idea.id}`;
  const ruleColor = category.text === "#1f1f1f" ? "rgba(31,31,31,0.32)" : "rgba(244,240,230,0.4)";
  const w = shape.viewBoxW;

  const descStyle: CSSProperties = { fontSize: `${w * DESC_FONT_RATIO}px` };
  const linkStyle: CSSProperties = { fontSize: `${w * LINK_FONT_RATIO}px` };
  const linkLabelStyle: CSSProperties = { fontSize: `${w * LINK_LABEL_FONT_RATIO}px`, opacity: 0.75 };

  // タイトルは長さ可変（8〜15文字超まで実データで幅がある）のため、弧の実長に収まるよう
  // 上限〜下限の間でフォントサイズを縮める（長い題は少し小さく・短い題は基準サイズのまま）
  const titleBaseFontSize = w * TITLE_FONT_RATIO;
  const titleMinFontSize = w * TITLE_FONT_MIN_RATIO;
  const titleWidthEm = estimateTextWidthEm(idea.title);
  const titleBudget = shape.titleArcLength * TITLE_ARC_FILL_RATIO;
  const titleFitFontSize = titleWidthEm > 0 ? titleBudget / titleWidthEm : titleBaseFontSize;
  const titleFontSize = Math.min(titleBaseFontSize, Math.max(titleMinFontSize, titleFitFontSize));

  return (
    <svg
      viewBox={`0 0 ${shape.viewBoxW} ${shape.viewBoxH}`}
      className="block w-full h-full overflow-visible"
      role="img"
      aria-labelledby={titleTextId}
    >
      <title id={titleTextId}>{`${idea.title}（${dateLabel}）`}</title>
      <path d={shape.outlinePath} fill={category.fill} />
      <path id={dateArcId} d={shape.dateArcPath} fill="none" />
      <path id={titleArcId} d={shape.titleArcPath} fill="none" />

      {/* 投稿日: 上辺の輪郭に沿う小さめの文字 */}
      <text
        fontSize={w * DATE_FONT_RATIO}
        fontWeight={700}
        letterSpacing="0.14em"
        style={{ fill: category.text }}
        className="uppercase tabular-nums select-none"
      >
        <textPath href={`#${dateArcId}`} startOffset="50%" textAnchor="middle">
          {dateLabel}
        </textPath>
      </text>

      {/* タイトル: 下辺の輪郭に沿う大きめの文字（font-black相当）。長い題は弧に収まるよう自動縮小 */}
      <text fontSize={titleFontSize} fontWeight={900} style={{ fill: category.text }} className="select-none">
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
          className="h-full flex flex-col justify-center overflow-hidden"
        >
          <p className="leading-snug line-clamp-3" style={descStyle}>
            {idea.seed}
          </p>
          <div className="h-px shrink-0" style={{ backgroundColor: ruleColor }} />
          <div className="flex flex-col min-h-0 overflow-hidden">
            {idea.refs.map((ref) => (
              <Link
                key={`${ref.type}-${ref.id}`}
                href={ref.type === "tech" ? `/technology/${ref.id}` : `/cases/${ref.id}`}
                title={ref.desc}
                className="group flex items-center gap-[0.5em] py-[0.2em] hover:underline"
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
