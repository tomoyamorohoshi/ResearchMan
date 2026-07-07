import type { CSSProperties, HTMLAttributes } from "react";
import Link from "next/link";
import {
  CONTENT_GAP_RATIO,
  DATE_LETTER_SPACING_EM,
  DESC_LINE_HEIGHT_MULT,
  estimateReservedLinksHeightPx,
  estimateTextWidthEm,
  fitDescription,
  LINE_BUDGET_SAFETY_RATIO,
  LINK_FONT_RATIO,
  LINK_LABEL_FONT_RATIO,
  LINK_LABEL_TRACKING_EM,
  LINK_ROW_GAP_EM,
  LINK_TITLE_MAX_LINES,
  shapeForIdea,
  TITLE_LETTER_SPACING_EM,
  truncateToEmBudget,
} from "@/lib/ideaShapes";
import { dateLabelOf, type Category, type Idea } from "@/lib/ideas";

// /ideas ポスターUIの1枚 = 1つの不定形SVGシェイプ（DESIGN: goofy-hatching-mango.md）。
// 輪郭沿いに投稿日・タイトルを実テキスト(textPath)で流し、内部のforeignObjectに
// 説明文→罫線→参照リンクを収める。サーバーコンポーネント（JS不要・SEO/a11y向けの実テキスト）。
//
// A: タイトル/日付の弧・フォントサイズはshapeForIdea(idea.id, idea.title, dateLabel, content)が
// 輪郭全周からの曲率ベース選定で確定済み（切り詰めは行わない。DESIGN差分参照）。
// このコンポーネントは算出済みの値をそのまま描画するだけで、フォントフィッティングや
// 省略記号の計算は一切行わない。
//
// G: 説明文(idea.seed)の「…」クランプは全廃した（goofy-hatching-mango.md 2026-07-07第4バッチ。
// 実装中のフィードバックで追加）。旧実装はDESC_FONT_RATIO固定+truncateToEmBudgetで説明文を
// 切り詰めていたが、「本文は必ず全文表示する」という要件に変更されたため、固定フォントサイズに
// 文章を合わせて切るのではなく、コンテンツ量に応じてフォントサイズ(と、必要ならshapeForIdea側の
// safeAreaの目標サイズ)を決める方式に反転した。フォント比率・行高・安全係数などの定数は
// ideaShapes.ts側(shapeForIdea内の事前見積りと同じ式)からインポートし、値のズレによる
// 不整合を防ぐ（旧: このファイルにDESC_FONT_RATIO等を個別に定義していた）

// foreignObject直下のdivにはxmlns指定が必要（SVG2仕様）だが、React.HTMLAttributesの型には
// xmlnsが存在しないためHTMLAttributes型にキャストして渡す
const xhtmlNsProps = { xmlns: "http://www.w3.org/1999/xhtml" } as unknown as HTMLAttributes<HTMLDivElement>;

export default function IdeaShapeCard({ idea, category }: { idea: Idea; category: Category }) {
  const dateLabel = dateLabelOf(idea);
  // G: idea.seed(説明文)・refsをshapeForIdeaに渡し、safeArea探索が説明文全文＋参照リンクに
  // 必要な高さを最優先で確保しようとするようにする（ideaShapes.tsのcomputeSafeArea参照）
  const shape = shapeForIdea(idea.id, idea.title, dateLabel, { seed: idea.seed, refs: idea.refs });
  const dateArcId = `idea-date-arc-${idea.id}`;
  const titleArcId = `idea-title-arc-${idea.id}`;
  const ruleColor = category.text === "#1f1f1f" ? "rgba(31,31,31,0.32)" : "rgba(244,240,230,0.4)";
  const w = shape.viewBoxW;

  // E/G: 罫線＋参照リンク領域の高さを必ず確保したうえで、残りの高さに説明文全文が収まる
  // 最大のフォントサイズを選ぶ（foreignObject内はCSS px = viewBox単位。DESIGN差分参照）。
  // 参照リンクのタイトルはtruncate(1行+…)をやめ最大LINK_TITLE_MAX_LINES行の折返しで全文表示
  // するため、行数はタイトル文字幅に応じて1〜2行で変動する。その実測行数ぶんを罫線・リンク
  // 領域の高さ予約に反映してから、残りを説明文のフォントサイズ探索に充てる
  const hasRefs = idea.refs.length > 0;
  const linkFontSizePx = w * LINK_FONT_RATIO;
  const linkLabelFontSizePx = w * LINK_LABEL_FONT_RATIO;

  // 各refのタイトルをLINK_TITLE_MAX_LINES行に収まる文字数へ切り詰め、実際に必要な行数を見積もる
  // （ラベル(CASE/TECH)+gap分を差し引いた残り幅がタイトルの折返し幅）。参照リンクのタイトル
  // 切り詰め(truncateToEmBudget)自体は本バッチのスコープ外（前バッチで完了済みの2行折返しを維持）
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

  // ideaShapes.tsの事前見積り(shapeForIdea内)と同じ式で罫線＋リンクの予約高さを求める
  // （二重実装によるズレを避けるため共有関数を使う）
  const reservedHeightPx = hasRefs ? estimateReservedLinksHeightPx(w, shape.safeArea.w, idea.refs) : 0;

  // G: 説明文は「…」で切り詰めず、DESC_FONT_MAX_RATIOから縮小探索して全文が収まる最大の
  // フォントサイズを採用する（fitDescription内でMIN_DESC_AVAILABLE_RATIOによる下限保証も
  // 適用済み）。DESC_FONT_FLOOR_RATIOでも収まらない場合(fits=false)でも、切り詰めない方を
  // 優先してfloor比率のまま全文を描画する（要件: クランプ全廃が最優先）。
  // safeArea.hではなくshape.safeAreaMaxGrowH(title/date弧との重なり・輪郭外はみ出しを検査
  // 済みの安全な拡張上限)を高さ予算として渡すことで、拡張の余地があるシェイプではより
  // 大きく読みやすいフォントを選べるようにする（下記のforeignObject拡張と一貫させる）
  const descFit = fitDescription(w, shape.safeArea.w, shape.safeAreaMaxGrowH, reservedHeightPx, idea.seed);
  const descText = idea.seed;

  // ラッパーの明示heightは、実際に必要な高さ(descFit.requiredHeightPx)にそのまま合わせる
  // （旧実装のようにavailableForDescPxで頭打ちにはしない＝クランプ全廃）。overflow-hiddenは
  // 万一の見積り誤差(半角/全角の簡易推定・単語境界での折返し等)に対する最終安全網として残す
  const descWrapperStyle: CSSProperties = { height: `${descFit.requiredHeightPx}px` };
  const descStyle: CSSProperties = {
    fontSize: `${descFit.fontSizePx}px`,
    lineHeight: DESC_LINE_HEIGHT_MULT,
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };
  const linkStyle: CSSProperties = { fontSize: `${linkFontSizePx}px` };
  const linkLabelStyle: CSSProperties = { fontSize: `${linkLabelFontSizePx}px`, opacity: 0.75 };

  // G: DESC_FONT_FLOOR_RATIO(可読性を保つ下限)でも説明文＋罫線＋リンクの合計がsafeArea.hに
  // 収まらない場合、foreignObject自体をsafeArea中心から上下均等に必要なぶんだけ拡張する。
  // 実装上の判断（計画への疑義）: 当初はtitle/date弧の位置を考慮せず無条件に拡張していたが、
  // 実測(Playwrightスクショの目視確認)でsafeArea自体が非常にタイトな形状(archive-5の
  // notchedCircle: 中心近くの安全な矩形が12.9viewBox単位ほどしかない)において、拡張後の
  // 矩形がtitle弧の描画範囲に食い込み、説明文と重なって読めなくなるバグを発見した。
  // shape.safeAreaMaxGrowH(computeSafeAreaが同じ包含・クリアランス判定で算出した安全な拡張
  // 上限)を超えないようMath.minでキャップすることで、この重なりを防ぐ。安全な上限まででも
  // なお全文の必要高さに届かない極端なケース(実運用データでは未発生)は、そのぶん軽微な
  // はみ出しを許容する（フォントをさらに縮めて読めなくするより、この方が実害が小さい判断）
  const totalContentHeightPx = descFit.requiredHeightPx + reservedHeightPx;
  const foHeight = Math.min(shape.safeAreaMaxGrowH, Math.max(shape.safeArea.h, totalContentHeightPx));
  const foY = shape.safeArea.y - (foHeight - shape.safeArea.h) / 2;
  // G: 罫線＋参照リンクの予約高さ(reservedHeightPx)自体が安全な拡張上限を超える極端なケース
  // （実測: archive-5のnotchedCircle。safeAreaMaxGrowHが12.9viewBox単位しかなく、reservedHeightPx
  // だけで22.2に達する）では、totalContentHeightPx > foHeightとなり、justify-centerのまま
  // だと超過分が上下均等に切り詰められ、最重要である説明文の先頭が丸ごと見えなくなる回帰が
  // あった（実測・目視確認）。この場合のみ上詰め(justify-start)に切り替え、切り詰めが
  // 発生するとしても常に末尾(参照リンクの下端)側に限定し、説明文は必ず先頭から表示されるようにする
  const contentOverflowsBox = totalContentHeightPx > foHeight + 1e-6;
  const contentJustifyClass = contentOverflowsBox ? "justify-start" : "justify-center";

  return (
    <svg
      // F: viewBoxを輪郭の実bbox±小マージンにクロップする（goofy-hatching-mango.md
      // 2026-07-07第4バッチ）。「箱≒シルエット」にすることで、IdeasPoster側の素直なCSS gapが
      // そのままシルエット間の近接距離になる。outlinePath/textPath/foreignObjectはすべて元の
      // (0..viewBoxW, 0..viewBoxH)座標系のままなので、viewBox属性を変えるだけで無変換で成立する
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

      <foreignObject x={shape.safeArea.x} y={foY} width={shape.safeArea.w} height={foHeight}>
        <div
          // foreignObject直下はXHTML名前空間の明示が必要（SVG2仕様）。xmlnsはReact.HTMLAttributesの
          // 型に無いためxhtmlNsPropsでキャストして渡す
          {...xhtmlNsProps}
          style={{ color: category.text, gap: `${w * CONTENT_GAP_RATIO}px` }}
          className={`h-full flex flex-col ${contentJustifyClass} overflow-hidden pointer-events-auto`}
        >
          {/* shrink-0: このflexコンテナは既定でflex-shrink:1のため、内容全体がreservedHeightPxの
              見積もり誤差等でoverflowした場合にブラウザが子を圧縮しうる。圧縮されると行の
              途中で中途半端な高さに切り詰められる恐れがあるため、3ブロック
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
