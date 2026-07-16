/**
 * idea パイプラインの各フェーズでAgent SDKに渡すプロンプト組み立て（純粋関数・文字列生成のみ）。
 * prompts.ts（Research系）と同じ役割分担: ここでは「今回のタスク入力」と「機械可読な出力形式」
 * の指定のみ行う。
 */
import { formatCaseLine, formatTechLine, type CaseRecord, type ChewedAngle, type TechRecord } from "./ideaPure.js";
import type { IdeaAngle } from "./ideaAngles.js";

export function buildKeywordExtractionPrompt(theme: string, constraint: string): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  return `次のお題から、事例データベースを検索するための日本語キーワードを3〜6個抽出してください。

お題: ${theme}${constraintNote}

- 固有名詞よりも、検索に使える一般名詞・技術名・表現手法の語を優先する
- お題の言い換えではなく、事例の説明文に実際に出現しそうな単語にする

出力はJSON配列のみ（前置き・後書きなし）: ["キーワード1", "キーワード2", ...]`;
}

export interface AngleWithExemplars {
  angle: IdeaAngle;
  exemplars: CaseRecord[];
}

export interface IdeaWriterPromptInput {
  theme: string;
  constraint: string;
  angles: AngleWithExemplars[];
  caseCandidates: CaseRecord[];
  techCandidates: TechRecord[];
  /** 咀嚼フェーズ（buildIdeaChewPrompt）の結果。省略可・空配列可（咀嚼失敗時のフォールバック）。 */
  chewedAngles?: ChewedAngle[];
}

/**
 * 咀嚼フェーズ（ヤング『アイデアのつくり方』②相当）: 生成前に素材を要素分解し、
 * 切り口ごとに有望な組み合わせ候補（部分アイデア）を書き出させる。1回のLLM呼び出しで
 * 全切り口分をまとめて行う。結果は buildIdeaWriterPrompt の chewedAngles に渡して
 * 生成の下敷きにする（enhancerであり必須ゲートではない。失敗時は呼び出し側が空配列に
 * フォールバックする）。
 */
export function buildIdeaChewPrompt({ theme, constraint, angles, caseCandidates, techCandidates }: IdeaWriterPromptInput): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  const angleBlocks = angles
    .map((a) => {
      const exemplarLines = a.exemplars.map(formatCaseLine).join("\n") || "（参考事例なし）";
      return `### 切り口: ${a.angle.label}
説明: ${a.angle.description}
参考事例:
${exemplarLines}`;
    })
    .join("\n\n");
  const caseLines = caseCandidates.map(formatCaseLine).join("\n") || "（該当なし）";
  const techLines = techCandidates.map(formatTechLine).join("\n") || "（該当なし）";

  return `あなたは広告のアイデア開発の下ごしらえをする壁打ち相手です。
いきなり完成したアイデアを書くのではなく、素材を要素に分解し、有望な組み合わせの
「部分アイデア」の候補をまず洗い出してください（まだ完成形でなくてよい）。

# お題
${theme}${constraintNote}

# 切り口ごとの参考事例
${angleBlocks}

# お題に関連する具体的な事例・技術（触発材料）
## Case
${caseLines}
## Technology
${techLines}

# 手順
切り口ごとに:
1. 素材を要素に分解する（課題・文脈・手法・技術などの粒度で3〜6個）
2. その要素から有望な組み合わせ候補（部分アイデア）を2〜3個列挙する

# 出力
JSON配列のみ（前置き・後書きなし、切り口の数ちょうど。angleは切り口のlabelをそのまま転記）:
[{"angle": "切り口ラベル", "elements": ["要素1", "要素2", ...], "partials": ["部分アイデア1", "部分アイデア2", ...]}]`;
}

/**
 * angles は生成すべきアイデアと1:1対応する（angles[i] を使ってi番目のアイデアを作る）。
 * 各アイデアの pattern は必ずそのアイデアに割り当てられた切り口の label と一致させる。
 */
export function buildIdeaWriterPrompt({ theme, constraint, angles, caseCandidates, techCandidates, chewedAngles }: IdeaWriterPromptInput): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  const angleBlocks = angles
    .map((a, i) => {
      const exemplarLines = a.exemplars.map(formatCaseLine).join("\n") || "（参考事例なし）";
      const chewed = chewedAngles?.find((c) => c.angle === a.angle.label);
      const partialsNote =
        chewed && chewed.partials.length > 0
          ? `\nこの切り口の咀嚼結果（部分アイデア候補。有望なものを選んで膨らませてもよいし、
明確により良い組み合わせがあればそちらで作ってもよい）:
${chewed.partials.map((p) => `- ${p}`).join("\n")}`
          : "";
      return `### アイデア${i + 1}の切り口: ${a.angle.label}
説明: ${a.angle.description}
この切り口を体現する参考事例:
${exemplarLines}${partialsNote}`;
    })
    .join("\n\n");
  const caseLines = caseCandidates.map(formatCaseLine).join("\n") || "（該当なし）";
  const techLines = techCandidates.map(formatTechLine).join("\n") || "（該当なし）";

  return `あなたは広告会社のクリエイティブディレクターの壁打ち相手です。以下のお題に対して、
Case Studyデータベースから学んだ「発想の型（切り口）」をお題に適用し、アイデアを${angles.length}個作ってください。

# お題
${theme}${constraintNote}

# 各アイデアに割り当てる切り口（必ずこの順番・この切り口通りに1案ずつ作ること）
${angleBlocks}

# お題に関連する具体的な事例・技術（触発材料。参照する場合はrefsのidにそのまま使う）
## Case
${caseLines}
## Technology
${techLines}

# ルール
- 各アイデアは「切り口の発想パターンをお題に適用したら何ができるか」の仮説。汎用的な提案ではなく、
  お題（${theme}）に具体的に効くアイデアにすること
- アイデアは既存要素の新しい組み合わせである。seedを書く前に、なぜこの要素の組み合わせが
  効くのかを1行で言語化し、rationaleに入れること（40字前後の目安）
- seed は日本語1〜2文・80〜140字。**必ず「〜かも。」で終える（例外なし）**
- title は10〜18字・体言止め推奨・記号や絵文字なし
- pattern は割り当てられた切り口のlabelをそのまま転記する（改変禁止）
- refs は、そのアイデアが参照した事例・技術を列挙する（0件も可）。id は上記の「参考事例」
  「触発材料」に載っているidのみ使用可（それ以外のidを創作しない）。type は "case" か "tech"
- desc は参照した事例/技術が何なのか高校生でもわかる言葉で1文（40〜70字）

# 出力
JSON配列のみ（前置き・後書きなし、${angles.length}個ちょうど）:
[{"title": "...", "pattern": "...", "seed": "...かも。", "rationale": "...", "refs": [{"type": "case", "id": "...", "desc": "..."}]}]`;
}

// ── 批評（ヤング⑤相当。質の批評→育成） ──────────────────────────────

export interface IdeaCritiqueTarget {
  id: string;
  title: string;
  pattern: string;
  seed: string;
  rationale: string;
}

/** 機械検証を通過した案をまとめて採点させる（1回のLLM呼び出しでbatch）。 */
export function buildIdeaCritiquePrompt(entries: IdeaCritiqueTarget[]): string {
  const lines = entries
    .map((e) => `- id:${e.id} 【${e.pattern}】${e.title}\n  seed: ${e.seed}\n  rationale: ${e.rationale || "(なし)"}`)
    .join("\n");
  return `以下のアイデア案を、広告賞の審査基準に近い3つの軸で採点してください（各1〜5の整数）。

# 採点軸
- discovery（発見）: 誰も気づいていなかった視点・洞察があるか
- surprise（意外性）: 予想を裏切る組み合わせ・飛躍があるか
- conviction（納得感）: 実現可能性・ロジックの筋が通っているか

# 案一覧
${lines}

# 出力
JSON配列のみ（前置き・後書きなし、案の数ちょうど。idは上記のidをそのまま転記）:
[{"id": "...", "discovery": 1-5の整数, "surprise": 1-5の整数, "conviction": 1-5の整数, "note": "改善するなら一言（20〜40字）"}]`;
}

// ── 改稿（批評で改稿対象となった案の書き直し） ────────────────────────────

export interface IdeaReviseTarget {
  id: string;
  pattern: string;
  title: string;
  seed: string;
  rationale: string;
  note: string;
}

export interface IdeaRevisePromptInput {
  theme: string;
  constraint: string;
  items: IdeaReviseTarget[];
  caseCandidates: CaseRecord[];
  techCandidates: TechRecord[];
}

/**
 * 批評で改稿対象となった案をまとめて改稿させる（1回のLLM呼び出しでbatch）。
 * 切り口（pattern）は変更禁止のため出力に含めない（呼び出し側 ideaResearch.ts が
 * 元のpatternをそのまま維持する）。
 */
export function buildIdeaRevisePrompt({ theme, constraint, items, caseCandidates, techCandidates }: IdeaRevisePromptInput): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  const itemLines = items
    .map(
      (i) =>
        `- id:${i.id} 【${i.pattern}】${i.title}\n  seed: ${i.seed}\n  rationale: ${i.rationale || "(なし)"}\n  指摘: ${i.note || "(特になし。より発見・意外性・納得感を強めること)"}`,
    )
    .join("\n");
  const caseLines = caseCandidates.map(formatCaseLine).join("\n") || "（該当なし）";
  const techLines = techCandidates.map(formatTechLine).join("\n") || "（該当なし）";

  return `以下のアイデア案は審査で伸び悩むと判定されました。指摘を踏まえて改稿してください。
**切り口は変更禁止。必ず同じ切り口のまま、タイトル・seed・rationale・refsだけを練り直すこと。**

# お題
${theme}${constraintNote}

# 改稿対象と指摘
${itemLines}

# 参照可能な事例・技術（refsのidに使う。ここに無いidを創作しないこと）
## Case
${caseLines}
## Technology
${techLines}

# ルール
- seed は日本語1〜2文・80〜140字。**必ず「〜かも。」で終える（例外なし）**
- title は10〜18字・体言止め推奨・記号や絵文字なし
- rationale はなぜこの組み合わせが効くのかの1行言語化（40字前後の目安）
- refs は参照した事例・技術（0件も可）。id は上記の一覧に載っているidのみ使用可

# 出力
JSON配列のみ（前置き・後書きなし、改稿対象の数ちょうど。idは上記のidをそのまま転記）:
[{"id": "...", "title": "...", "seed": "...かも。", "rationale": "...", "refs": [{"type": "case", "id": "...", "desc": "..."}]}]`;
}
