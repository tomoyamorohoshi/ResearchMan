import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import { DATE_LETTER_SPACING_EM, shapeForIdea } from "@/lib/ideaShapes";
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

  const descStyle: CSSProperties = { fontSize: `${w * DESC_FONT_RATIO}px` };
  const linkStyle: CSSProperties = { fontSize: `${w * LINK_FONT_RATIO}px` };
  const linkLabelStyle: CSSProperties = { fontSize: `${w * LINK_LABEL_FONT_RATIO}px`, opacity: 0.75 };

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
          全文が収まるよう確定済み(切り詰めなし。縦走・斜め走もあり得る)。aria-hiddenの理由は投稿日と同じ */}
      <text
        fontSize={shape.titleFontSize}
        fontWeight={900}
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
